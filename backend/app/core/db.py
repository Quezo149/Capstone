import re
import time
from collections.abc import Generator

import pyodbc
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import URL, Engine
from sqlalchemy.orm import Session

from app.core.config import get_settings

# El pool lo maneja SQLAlchemy. El pool propio del driver ODBC (activo por defecto en pyodbc)
# es una segunda capa que reparte conexiones sin pasar por _limpiar_contexto, y puede
# entregar una conexión con una transacción abierta de quien la usó antes.
pyodbc.pooling = False

_engine: Engine | None = None

# Claves de SESSION_CONTEXT que leen las políticas de RLS (db/migrations/0007_rls.sql y,
# para invitaciones, 0009_invitaciones.sql).
_CLAVES_CONTEXTO = ("empresa_id", "usuario_id", "rol", "invitacion_token", "invitacion_email")


# Errores con que Azure SQL dice "aún no, intenta de nuevo". El más común es 40613: la base
# serverless estaba en pausa y el primer login la despierta pero falla de inmediato; los
# siguientes intentos fallan igual hasta que termina de despertar (~1 minuto).
# https://learn.microsoft.com/azure/azure-sql/database/troubleshoot-common-connectivity-issues
_ERRORES_TRANSITORIOS = {4060, 4221, 10928, 10929, 40197, 40501, 40613, 49918, 49919, 49920}
_CODIGO_SQL = re.compile(r"\((\d+)\)")


def es_transitorio(exc: BaseException) -> bool:
    """Error de conexión que se arregla solo esperando (base despertando, failover, timeout)."""
    if not isinstance(exc, pyodbc.Error):
        return False
    if exc.args and exc.args[0] in ("HYT00", "HYT01", "08001", "08S01"):  # timeouts y conexión caída
        return True
    return any(int(c) in _ERRORES_TRANSITORIOS for c in _CODIGO_SQL.findall(str(exc)))


def _conectar_con_reintentos(dialect, conn_rec, cargs, cparams):
    """
    Reintenta la conexión mientras la base serverless despierta, en vez de responder 500 al
    primer intento (que es lo que veía quien iniciaba sesión con la base en pausa).
    """
    limite = time.monotonic() + get_settings().sql_reintentos_segundos
    espera = 2.0
    while True:
        try:
            return dialect.loaded_dbapi.connect(*cargs, **cparams)
        except pyodbc.Error as exc:
            if not es_transitorio(exc) or time.monotonic() + espera > limite:
                raise
            time.sleep(espera)
            espera = min(espera * 1.5, 10.0)


def _limpiar_contexto(dbapi_connection, connection_record, connection_proxy) -> None:
    """
    Al sacar una conexión del pool, borra el SESSION_CONTEXT que haya dejado el request anterior.

    SESSION_CONTEXT vive en la conexión, no en el request, y el pool de SQLAlchemy no lo
    resetea (solo hace rollback). Sin esto, un endpoint que no fija contexto (por ejemplo
    POST /piloto, o un bug futuro) podría heredar la empresa del usuario anterior. Es una
    segunda barrera: get_current_user igual lo vuelve a fijar en cada request — ver 07
    Autenticación y Multi-tenancy.md, "SESSION_CONTEXT en conexiones reutilizadas".
    """
    cursor = dbapi_connection.cursor()
    try:
        # Una sentencia por clave: con un solo lote de varios EXEC el driver ODBC deja
        # resultados pendientes y la transacción implícita queda abierta (bloquea a otros).
        for clave in _CLAVES_CONTEXTO:
            cursor.execute(f"EXEC sp_set_session_context N'{clave}', NULL")
    finally:
        cursor.close()
    dbapi_connection.commit()


def _get_engine() -> Engine:
    global _engine
    if _engine is None:
        settings = get_settings()
        query = {"driver": "ODBC Driver 18 for SQL Server"}
        if settings.sql_trust_server_certificate:
            query["TrustServerCertificate"] = "yes"
        # URL.create escapa usuario y contraseña: una contraseña con @, /, # o ?
        # rompería la URL si se armara pegando strings.
        url = URL.create(
            "mssql+pyodbc",
            username=settings.sql_user,
            password=settings.sql_password,
            host=settings.sql_server,
            database=settings.sql_database,
            query=query,
        )
        _engine = create_engine(
            url,
            pool_pre_ping=True,
            connect_args={"timeout": settings.sql_login_timeout},  # login timeout de pyodbc
        )
        event.listen(_engine, "do_connect", _conectar_con_reintentos)
        event.listen(_engine, "checkout", _limpiar_contexto)
    return _engine


def set_session_context(db: Session, empresa_id: str, usuario_id: str, rol: str) -> None:
    """
    Fija el contexto que consumen las políticas de RLS de Azure SQL.
    Debe llamarse al inicio de CADA request autenticado (lo hace get_current_user).
    Nunca asumir que una conexión del pool llega "limpia".
    """
    db.execute(text("EXEC sp_set_session_context N'empresa_id', :empresa_id"), {"empresa_id": empresa_id})
    db.execute(text("EXEC sp_set_session_context N'usuario_id', :usuario_id"), {"usuario_id": usuario_id})
    db.execute(text("EXEC sp_set_session_context N'rol', :rol"), {"rol": rol})


def set_contexto_invitacion(db: Session, *, token_hash: bytes | None = None, email: str | None = None) -> None:
    """
    Contexto para quien aún no tiene empresa (HU02): con el hash del token del link ve solo esa
    invitación; con su correo verificado, solo las dirigidas a él. Ver 0009_invitaciones.sql.
    """
    if token_hash is not None:
        db.execute(text("EXEC sp_set_session_context N'invitacion_token', :v"), {"v": token_hash})
    if email is not None:
        db.execute(text("EXEC sp_set_session_context N'invitacion_email', :v"), {"v": email})


def get_db() -> Generator[Session, None, None]:
    """
    Dependency de FastAPI: una sesión atada a UNA sola conexión durante todo el request.

    Una Session normal devuelve la conexión al pool en cada commit() y toma otra en la
    siguiente consulta, que no tendría el SESSION_CONTEXT fijado por get_current_user
    (o tendría el de otro usuario). Atándola a una Connection, el contexto se mantiene
    aunque el endpoint haga commit y siga consultando.

    OJO: esto NO fija SESSION_CONTEXT por sí sola — eso requiere conocer al usuario
    autenticado, así que lo hace app.core.auth.get_current_user con este mismo `db`.
    """
    connection = _get_engine().connect()
    db = Session(bind=connection, autoflush=False)
    try:
        yield db
    finally:
        db.close()
        connection.close()
