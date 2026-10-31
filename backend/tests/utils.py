"""
Utilidades compartidas por las pruebas: configuración, tokens y datos de ejemplo.
(Van aquí y no en conftest.py porque pytest puede importar conftest dos veces, y cada
copia generaría su propia clave RSA.)

Pruebas del backend. Corren contra SQL Server en Docker (compose.yaml), en una base
`kontadoria_test` que se borra y se vuelve a crear con todas las migraciones al inicio.
NUNCA apuntar estas pruebas a Azure.

Uso (desde backend/, con `docker compose up -d sqlserver` corriendo):
    .venv/bin/python -m pytest

Los tokens se firman con una clave RSA generada en la prueba y se reemplaza la descarga
del JWKS de Entra por esa clave: así se prueba la validación real sin depender del tenant.
"""

import os
import random
import time
import uuid
from pathlib import Path


RAIZ = Path(__file__).resolve().parents[2]
BASE_PRUEBAS = "kontadoria_test"


def _sa_password() -> str:
    if os.environ.get("MSSQL_SA_PASSWORD"):
        return os.environ["MSSQL_SA_PASSWORD"]
    env = RAIZ / ".env"
    for linea in env.read_text(encoding="utf-8").splitlines() if env.exists() else []:
        if linea.startswith("MSSQL_SA_PASSWORD="):
            return linea.split("=", 1)[1].strip()
    raise RuntimeError("Falta MSSQL_SA_PASSWORD (en el entorno o en .env de la raíz del repo)")


SA_PASSWORD = _sa_password()
SQL_HOST = os.environ.get("TEST_SQL_SERVER", "127.0.0.1")

# Configuración de la app ANTES de importarla (get_settings() se cachea).
os.environ.update(
    SQL_SERVER=SQL_HOST,
    SQL_DATABASE=BASE_PRUEBAS,
    SQL_USER="sa",
    SQL_PASSWORD=SA_PASSWORD,
    SQL_TRUST_SERVER_CERTIFICATE="true",
    SQL_LOGIN_TIMEOUT="15",
    STORAGE_ACCOUNT_NAME="prueba",
    STORAGE_ACCOUNT_KEY="prueba",
    ENTRA_TENANT_ID="11111111-1111-1111-1111-111111111111",
    ENTRA_CLIENT_ID="22222222-2222-2222-2222-222222222222",
    ENTRA_ISSUER="https://prueba.ciamlogin.com/11111111-1111-1111-1111-111111111111/v2.0",
    DOCUMENT_INTELLIGENCE_ENDPOINT="https://prueba",
    DOCUMENT_INTELLIGENCE_KEY="prueba",
)

import pyodbc  # noqa: E402

from app.core.politica import POLITICA_VERSION  # noqa: E402

# Igual que app/core/db.py: sin el pool del driver ODBC (entregaba conexiones con
# transacciones abiertas de la conexión anterior y bloqueaba las pruebas).
pyodbc.pooling = False
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from jose import jwk, jwt  # noqa: E402

from app.core.rut import digito_verificador  # noqa: E402

CLIENT_ID = os.environ["ENTRA_CLIENT_ID"]
ISSUER_TOKEN = "https://11111111-1111-1111-1111-111111111111.ciamlogin.com/11111111-1111-1111-1111-111111111111/v2.0"
KID = "clave-prueba"


def _conn_str(base: str) -> str:
    return (
        f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SQL_HOST};DATABASE={base};"
        f"UID=sa;PWD={SA_PASSWORD};TrustServerCertificate=yes;Connection Timeout=10"
    )


# ---------- Base de datos de pruebas ----------


# ---------- Tokens ----------

_PRIVADA = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_OTRA_PRIVADA = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _pem(clave) -> bytes:
    return clave.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def _jwk_publica(clave, kid: str) -> dict:
    pub = clave.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    d = jwk.construct(pub, "RS256").to_dict()
    return {**{k: (v.decode() if isinstance(v, bytes) else v) for k, v in d.items()}, "kid": kid, "use": "sig"}


def crear_token(
    oid: str | None = None,
    email: str | None = "persona@prueba.cl",
    *,
    aud: str = CLIENT_ID,
    iss: str = ISSUER_TOKEN,
    scp: str | None = "access_as_user",
    expira_en: int = 3600,
    clave=None,
    kid: str = KID,
    extra: dict | None = None,
) -> str:
    ahora = int(time.time())
    claims = {
        "oid": oid or str(uuid.uuid4()),
        "aud": aud,
        "iss": iss,
        "iat": ahora,
        "nbf": ahora,
        "exp": ahora + expira_en,
        "name": "Persona de Prueba",
        **({"email": email} if email else {}),
        **({"scp": scp} if scp else {}),
        **(extra or {}),
    }
    return jwt.encode(claims, _pem(clave or _PRIVADA), algorithm="RS256", headers={"kid": kid})


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- Datos ----------

# Casilla de la política de privacidad marcada (obligatoria al registrar empresa o aceptar invitación)
ACEPTA = {"acepta_politica": True, "politica_version": POLITICA_VERSION}

def rut_valido() -> str:
    cuerpo = random.randint(5_000_000, 99_999_999)
    return f"{cuerpo}-{digito_verificador(cuerpo)}"


def registrar_empresa(client, nombre: str = "Empresa de prueba") -> dict:
    """Registra una empresa por la API (HU17) y devuelve oid, token y empresa del admin."""
    oid = str(uuid.uuid4())
    token = crear_token(oid, f"admin.{oid[:8]}@prueba.cl")
    r = client.post("/empresas", json={"nombre": nombre, "rut": rut_valido(), "giro": "Comercio", **ACEPTA}, headers=auth(token))
    assert r.status_code == 201, r.text
    return {"oid": oid, "token": token, "empresa": r.json()["empresa"]}


def agregar_miembro(sql, empresa_id: str, rol: str, activo: bool = True) -> dict:
    """
    Agrega un usuario a una empresa directo en la base (las invitaciones llegan con HU02).
    """
    oid = str(uuid.uuid4())
    cur = sql.cursor()
    usuario_id = cur.execute(
        "INSERT INTO dbo.usuarios (entra_oid, email, politica_version, politica_aceptada_en) OUTPUT inserted.id"
        " VALUES (?, ?, ?, SYSUTCDATETIME())",
        oid, f"{rol}.{oid[:8]}@prueba.cl", POLITICA_VERSION,
    ).fetchall()[0][0]  # fetchall: con fetchone el INSERT queda a medias y su transacción abierta
    cur.execute(
        "INSERT INTO dbo.usuarios_empresa (usuario_id, empresa_id, rol, activo) VALUES (?, ?, ?, ?)",
        usuario_id, empresa_id, rol, int(activo),
    )
    # Cerrar el cursor: el driver ODBC no termina de leer la respuesta del último INSERT
    # hasta la siguiente sentencia, y mientras tanto la transacción sigue abierta y bloquea a la app.
    cur.close()
    return {"oid": oid, "usuario_id": str(usuario_id), "token": crear_token(oid, f"{rol}.{oid[:8]}@prueba.cl")}


def usuario_id_de(sql, oid: str) -> str:
    cur = sql.cursor()
    usuario_id = cur.execute("SELECT id FROM dbo.usuarios WHERE entra_oid = ?", oid).fetchone()[0]
    cur.close()
    return str(usuario_id)


def insertar_movimiento(sql, empresa_id: str, usuario_id: str, monto: int = 1000) -> str:
    """
    Inserta un movimiento con el contexto de su propia empresa (RLS bloquea cualquier otro).
    """
    cur = sql.cursor()
    cur.execute(
        "EXEC sp_set_session_context N'empresa_id', ?; EXEC sp_set_session_context N'usuario_id', ?;"
        "EXEC sp_set_session_context N'rol', 'admin';",
        empresa_id, usuario_id,
    )
    categoria = cur.execute("SELECT TOP 1 id FROM dbo.categorias WHERE tipo = 'gasto' AND empresa_id IS NULL").fetchone()[0]
    mov_id = cur.execute(
        """
        INSERT INTO dbo.movimientos (empresa_id, usuario_id, categoria_id, tipo, fecha, monto, tipo_documento, origen)
        OUTPUT inserted.id VALUES (?, ?, ?, 'gasto', CAST(SYSUTCDATETIME() AS DATE), ?, 'boleta', 'manual')
        """,
        empresa_id, usuario_id, categoria, monto,
    ).fetchall()[0][0]  # ver agregar_miembro
    cur.execute(
        "EXEC sp_set_session_context N'empresa_id', NULL; EXEC sp_set_session_context N'usuario_id', NULL;"
        "EXEC sp_set_session_context N'rol', NULL;"
    )
    cur.close()  # ver agregar_miembro
    return str(mov_id)
