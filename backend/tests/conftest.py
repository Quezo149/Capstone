"""
Fixtures de las pruebas del backend. Corren contra SQL Server en Docker (compose.yaml),
en una base `kontadoria_test` que se borra y se vuelve a crear con todas las migraciones
al inicio. NUNCA apuntar estas pruebas a Azure.

Uso (desde backend/, con `docker compose up -d sqlserver` corriendo en la raíz):
    .venv/bin/python -m pytest
"""

import sys

import pyodbc
import pytest
from fastapi.testclient import TestClient

from tests.utils import BASE_PRUEBAS, ISSUER_TOKEN, KID, RAIZ, _PRIVADA, _conn_str, _jwk_publica  # configura el entorno

from app.core import auth as auth_mod  # noqa: E402 — después de tests.utils
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def base_datos():
    try:
        master = pyodbc.connect(_conn_str("master"), autocommit=True)
    except pyodbc.Error as exc:
        pytest.skip(f"SQL Server local no disponible (¿docker compose up -d sqlserver?): {exc}")
    master.cursor().execute(
        f"IF DB_ID('{BASE_PRUEBAS}') IS NOT NULL BEGIN "
        f"ALTER DATABASE {BASE_PRUEBAS} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE {BASE_PRUEBAS}; END; "
        f"CREATE DATABASE {BASE_PRUEBAS};"
    )
    master.close()

    sys.path.insert(0, str(RAIZ / "db"))
    import run_migrations

    conn = pyodbc.connect(_conn_str(BASE_PRUEBAS))
    cur = conn.cursor()
    run_migrations.ensure_migrations_table(cur)
    conn.commit()
    for version, archivo in run_migrations.get_pending_migrations(set()):
        run_migrations.apply_migration(cur, conn, version, archivo)
    conn.close()
    yield


@pytest.fixture
def sql(base_datos):
    """Conexión directa (como sa) para preparar datos y revisar resultados."""
    conn = pyodbc.connect(_conn_str(BASE_PRUEBAS), autocommit=True)
    yield conn
    conn.close()


@pytest.fixture(autouse=True)
def entra_falso(monkeypatch):
    """Reemplaza la descarga de metadatos/JWKS de Entra por la clave de prueba."""
    descargas = []

    def descargar(url: str) -> dict:
        descargas.append(url)
        if url.endswith("/.well-known/openid-configuration"):
            return {"issuer": ISSUER_TOKEN, "jwks_uri": "https://prueba/keys"}
        return {"keys": [_jwk_publica(_PRIVADA, KID)]}

    monkeypatch.setattr(auth_mod, "_descargar_json", descargar)
    auth_mod.claves_entra.reiniciar()
    yield descargas
    auth_mod.claves_entra.reiniciar()


@pytest.fixture
def client(base_datos):
    return TestClient(app)
