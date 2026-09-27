from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_engine: Engine | None = None
_SessionLocal: sessionmaker | None = None


def _get_engine() -> Engine:
    global _engine, _SessionLocal
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
        # pool_pre_ping evita usar conexiones muertas; NO evita el problema
        # de SESSION_CONTEXT "sucio" de una conexión reciclada — por eso
        # set_session_context() de abajo se ejecuta en CADA request, sin excepción.
        _engine = create_engine(
            url,
            pool_pre_ping=True,
            connect_args={"timeout": settings.sql_login_timeout},  # login timeout de pyodbc
        )
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
    return _engine


def set_session_context(db: Session, empresa_id: str, usuario_id: str, rol: str) -> None:
    """
    Fija el contexto que consumen las políticas de RLS de Azure SQL.
    Debe llamarse al inicio de CADA request autenticado — ver 07 Autenticación
    y Multi-tenancy.md, sección "Riesgo no obvio: SESSION_CONTEXT en conexiones
    reutilizadas". Nunca asumir que una conexión del pool llega "limpia".
    """
    db.execute(text("EXEC sp_set_session_context 'empresa_id', :empresa_id"), {"empresa_id": empresa_id})
    db.execute(text("EXEC sp_set_session_context 'usuario_id', :usuario_id"), {"usuario_id": usuario_id})
    db.execute(text("EXEC sp_set_session_context 'rol', :rol"), {"rol": rol})


def get_db() -> Generator[Session, None, None]:
    """
    Dependency de FastAPI. OJO: esto NO fija SESSION_CONTEXT por sí sola —
    eso requiere conocer al usuario autenticado, así que se hace en
    app.core.auth.get_current_user_db (que envuelve esta dependency).
    """
    _get_engine()
    assert _SessionLocal is not None
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()
