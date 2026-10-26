"""
Base serverless en pausa (Azure SQL): el primer login falla con 40613 mientras despierta.
La API reintenta en vez de responder 500, y si no alcanza responde 503 con código estable.
"""

import pyodbc
from sqlalchemy.exc import OperationalError

from app.core import db as db_mod

PAUSADA = pyodbc.OperationalError("HY000", "[Microsoft][ODBC Driver 18 for SQL Server][SQL Server]Database 'x' on server 'y' is not currently available. (40613) (SQLDriverConnect)")
CLAVE_MALA = pyodbc.InterfaceError("28000", "[Microsoft][ODBC Driver 18 for SQL Server][SQL Server]Login failed for user 'x'. (18456) (SQLDriverConnect)")


class _Dialecto:
    def __init__(self, fallas):
        self.fallas = list(fallas)
        self.intentos = 0
        self.loaded_dbapi = self

    def connect(self, *args, **kwargs):
        self.intentos += 1
        if self.fallas:
            raise self.fallas.pop(0)
        return "conexion"


def test_clasifica_errores():
    assert db_mod.es_transitorio(PAUSADA)
    assert db_mod.es_transitorio(pyodbc.OperationalError("HYT00", "Login timeout expired"))
    assert not db_mod.es_transitorio(CLAVE_MALA)
    assert not db_mod.es_transitorio(ValueError("x"))


def test_reintenta_mientras_la_base_despierta(monkeypatch):
    monkeypatch.setattr(db_mod.time, "sleep", lambda s: None)
    dialecto = _Dialecto([PAUSADA, PAUSADA])
    assert db_mod._conectar_con_reintentos(dialecto, None, (), {}) == "conexion"
    assert dialecto.intentos == 3


def test_no_reintenta_errores_permanentes(monkeypatch):
    monkeypatch.setattr(db_mod.time, "sleep", lambda s: None)
    dialecto = _Dialecto([CLAVE_MALA])
    try:
        db_mod._conectar_con_reintentos(dialecto, None, (), {})
        raise AssertionError("debió fallar")
    except pyodbc.InterfaceError:
        pass
    assert dialecto.intentos == 1


def test_se_rinde_al_pasar_el_limite(monkeypatch):
    reloj = [0.0]
    monkeypatch.setattr(db_mod.time, "monotonic", lambda: reloj[0])
    monkeypatch.setattr(db_mod.time, "sleep", lambda s: reloj.__setitem__(0, reloj[0] + s))
    dialecto = _Dialecto([PAUSADA] * 1000)
    try:
        db_mod._conectar_con_reintentos(dialecto, None, (), {})
        raise AssertionError("debió fallar")
    except pyodbc.OperationalError:
        pass
    assert reloj[0] <= db_mod.get_settings().sql_reintentos_segundos


def test_base_no_disponible_responde_503(client):
    from app.main import app

    def sin_base():
        raise OperationalError("SELECT 1", {}, PAUSADA)

    app.dependency_overrides[db_mod.get_db] = sin_base
    try:
        r = client.get("/health/db")
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 503
    assert r.json()["detail"]["codigo"] == "base_no_disponible"


def test_health_db(client):
    r = client.get("/health/db")
    assert r.status_code == 200
