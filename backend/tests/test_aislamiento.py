"""
KONTADORIA-31 / KONTADORIA-32 / KONTADORIA-33 — HU05: aislamiento con Row-Level Security.

- Un usuario de la empresa A no obtiene datos de la empresa B (lista ni por id).
- Un empleado solo ve los movimientos que él registró; admin y contador ven todos.
- Se cumple aunque se llame a la API directamente y aunque se consulte la base sin filtros.
- SESSION_CONTEXT no se hereda entre requests por las conexiones reutilizadas del pool.
"""

import pyodbc
import pytest
from sqlalchemy import text

from app.core import db as db_mod
from tests.utils import agregar_miembro, auth, insertar_movimiento, registrar_empresa, usuario_id_de


@pytest.fixture
def dos_empresas(client, sql):
    a = registrar_empresa(client, "Empresa A")
    b = registrar_empresa(client, "Empresa B")
    a["usuario_id"], b["usuario_id"] = usuario_id_de(sql, a["oid"]), usuario_id_de(sql, b["oid"])
    a["empleado1"] = agregar_miembro(sql, a["empresa"]["id"], "empleado")
    a["empleado2"] = agregar_miembro(sql, a["empresa"]["id"], "empleado")
    a["contador"] = agregar_miembro(sql, a["empresa"]["id"], "contador")
    a["movs"] = {
        "admin": insertar_movimiento(sql, a["empresa"]["id"], a["usuario_id"], 1000),
        "empleado1": insertar_movimiento(sql, a["empresa"]["id"], a["empleado1"]["usuario_id"], 2000),
        "empleado2": insertar_movimiento(sql, a["empresa"]["id"], a["empleado2"]["usuario_id"], 3000),
    }
    b["movs"] = {"admin": insertar_movimiento(sql, b["empresa"]["id"], b["usuario_id"], 9000)}
    return a, b


def _ids(r):
    assert r.status_code == 200, r.text
    return {m["id"] for m in r.json()}


def test_empresa_a_no_ve_movimientos_de_b(client, dos_empresas):
    a, b = dos_empresas
    ids_a = _ids(client.get("/movimientos", headers=auth(a["token"])))
    ids_b = _ids(client.get("/movimientos", headers=auth(b["token"])))
    assert ids_a == set(a["movs"].values())
    assert ids_b == set(b["movs"].values())


def test_empresa_a_no_obtiene_movimiento_de_b_por_id(client, dos_empresas):
    a, b = dos_empresas
    r = client.get(f"/movimientos/{b['movs']['admin']}", headers=auth(a["token"]))
    assert r.status_code == 404  # igual que si no existiera
    assert client.get(f"/movimientos/{b['movs']['admin']}", headers=auth(b["token"])).status_code == 200


def test_restriccion_entre_empresas_aplica_a_todos_los_roles(client, dos_empresas):
    a, b = dos_empresas
    for quien in (a["token"], a["empleado1"]["token"], a["contador"]["token"]):
        assert client.get(f"/movimientos/{b['movs']['admin']}", headers=auth(quien)).status_code == 404
        assert b["movs"]["admin"] not in _ids(client.get("/movimientos", headers=auth(quien)))


def test_empleado_solo_ve_sus_movimientos(client, dos_empresas):
    a, _ = dos_empresas
    assert _ids(client.get("/movimientos", headers=auth(a["empleado1"]["token"]))) == {a["movs"]["empleado1"]}
    r = client.get(f"/movimientos/{a['movs']['empleado2']}", headers=auth(a["empleado1"]["token"]))
    assert r.status_code == 404


def test_admin_y_contador_ven_todos_los_de_su_empresa(client, dos_empresas):
    a, _ = dos_empresas
    for quien in (a["token"], a["contador"]["token"]):
        assert _ids(client.get("/movimientos", headers=auth(quien))) == set(a["movs"].values())


def test_categorias_propias_de_otra_empresa_no_se_ven(client, sql, dos_empresas):
    a, b = dos_empresas
    cur = sql.cursor()
    cur.execute("EXEC sp_set_session_context N'empresa_id', ?", b["empresa"]["id"])
    cur.execute("INSERT INTO dbo.categorias (empresa_id, nombre, tipo, color) VALUES (?, N'Secreta de B', 'gasto', '#000000')", b["empresa"]["id"])
    cur.execute("EXEC sp_set_session_context N'empresa_id', NULL")
    cur.close()
    nombres_a = {c["nombre"] for c in client.get("/categorias", headers=auth(a["token"])).json()}
    nombres_b = {c["nombre"] for c in client.get("/categorias", headers=auth(b["token"])).json()}
    assert "Secreta de B" not in nombres_a
    assert "Secreta de B" in nombres_b


# ---------- Directo en la base (aunque alguien se salte la API) ----------

def _contexto(cur, empresa_id, usuario_id, rol):
    cur.execute(
        "EXEC sp_set_session_context N'empresa_id', ?; EXEC sp_set_session_context N'usuario_id', ?;"
        "EXEC sp_set_session_context N'rol', ?;",
        empresa_id, usuario_id, rol,
    )


def test_sin_contexto_la_base_no_devuelve_movimientos(sql, dos_empresas):
    assert sql.cursor().execute("SELECT COUNT(*) FROM dbo.movimientos").fetchone()[0] == 0


def test_no_se_puede_insertar_movimiento_en_otra_empresa(sql, dos_empresas):
    a, b = dos_empresas
    cur = sql.cursor()
    _contexto(cur, a["empresa"]["id"], a["usuario_id"], "admin")
    categoria = cur.execute("SELECT TOP 1 id FROM dbo.categorias").fetchone()[0]
    with pytest.raises(pyodbc.Error, match="block predicate"):
        cur.execute(
            "INSERT INTO dbo.movimientos (empresa_id, usuario_id, categoria_id, tipo, fecha, monto, tipo_documento, origen)"
            " VALUES (?, ?, ?, 'gasto', '2026-10-17', 1, 'otro', 'manual')",
            b["empresa"]["id"], b["usuario_id"], categoria,
        )


def test_no_se_puede_mover_un_movimiento_a_otra_empresa(sql, dos_empresas):
    a, b = dos_empresas
    cur = sql.cursor()
    _contexto(cur, a["empresa"]["id"], a["usuario_id"], "admin")
    with pytest.raises(pyodbc.Error, match="block predicate"):
        cur.execute("UPDATE dbo.movimientos SET empresa_id = ? WHERE id = ?", b["empresa"]["id"], a["movs"]["admin"])


def test_no_se_puede_borrar_ni_editar_lo_de_otra_empresa(sql, dos_empresas):
    a, b = dos_empresas
    cur = sql.cursor()
    _contexto(cur, a["empresa"]["id"], a["usuario_id"], "admin")
    assert cur.execute("UPDATE dbo.movimientos SET monto = 1 WHERE id = ?", b["movs"]["admin"]).rowcount == 0
    assert cur.execute("DELETE FROM dbo.movimientos WHERE id = ?", b["movs"]["admin"]).rowcount == 0


def test_empleado_no_puede_registrar_a_nombre_de_otro(sql, dos_empresas):
    a, _ = dos_empresas
    cur = sql.cursor()
    _contexto(cur, a["empresa"]["id"], a["empleado1"]["usuario_id"], "empleado")
    categoria = cur.execute("SELECT TOP 1 id FROM dbo.categorias").fetchone()[0]
    with pytest.raises(pyodbc.Error, match="block predicate"):
        cur.execute(
            "INSERT INTO dbo.movimientos (empresa_id, usuario_id, categoria_id, tipo, fecha, monto, tipo_documento, origen)"
            " VALUES (?, ?, ?, 'gasto', '2026-10-17', 1, 'otro', 'manual')",
            a["empresa"]["id"], a["empleado2"]["usuario_id"], categoria,
        )


def test_categorias_predefinidas_no_se_pueden_modificar(sql, dos_empresas):
    a, _ = dos_empresas
    cur = sql.cursor()
    _contexto(cur, a["empresa"]["id"], a["usuario_id"], "admin")
    with pytest.raises(pyodbc.Error, match="block predicate"):
        cur.execute("UPDATE dbo.categorias SET nombre = N'Hackeada' WHERE empresa_id IS NULL")


# ---------- SESSION_CONTEXT y el pool de conexiones (KONTADORIA-32) ----------

def test_conexion_reutilizada_llega_sin_contexto(client, dos_empresas):
    """Tras un request de A, la misma conexión del pool no conserva la empresa de A."""
    a, _ = dos_empresas
    assert client.get("/movimientos", headers=auth(a["token"])).status_code == 200
    with db_mod._get_engine().connect() as conn:
        assert conn.execute(text("SELECT CAST(SESSION_CONTEXT(N'empresa_id') AS NVARCHAR(64))")).scalar() is None
        assert conn.execute(text("SELECT COUNT(*) FROM dbo.movimientos")).scalar() == 0


def test_contexto_sobrevive_a_un_commit_dentro_del_request(dos_empresas):
    """La sesión queda atada a una conexión: después de commit() sigue viendo con el mismo contexto."""
    a, _ = dos_empresas
    gen = db_mod.get_db()
    db = next(gen)
    try:
        db_mod.set_session_context(db, a["empresa"]["id"], a["usuario_id"], "admin")
        antes = db.execute(text("SELECT COUNT(*) FROM dbo.movimientos")).scalar()
        db.commit()
        despues = db.execute(text("SELECT COUNT(*) FROM dbo.movimientos")).scalar()
        assert antes == despues == 3
    finally:
        gen.close()


def test_requests_alternados_no_mezclan_empresas(client, dos_empresas):
    a, b = dos_empresas
    for _ in range(5):
        assert _ids(client.get("/movimientos", headers=auth(a["token"]))) == set(a["movs"].values())
        assert _ids(client.get("/movimientos", headers=auth(b["token"]))) == set(b["movs"].values())
