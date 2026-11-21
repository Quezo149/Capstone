"""
KONTADORIA-76 — HU15: tabla dbo.presupuestos (migración 0015).

Prueba las reglas que garantiza la base, sin pasar por la API (el CRUD es KONTADORIA-77):
- un solo presupuesto por empresa, categoría y mes;
- el mes es el día 1 y el monto es positivo y de 12 dígitos como máximo;
- RLS: cada empresa ve y escribe solo sus presupuestos;
- al eliminar una categoría propia se van sus presupuestos.
"""

import pyodbc
import pytest

from tests.utils import registrar_empresa, usuario_id_de


def _contexto(cur, empresa_id):
    cur.execute("EXEC sp_set_session_context N'empresa_id', ?", empresa_id)


def _categoria_predefinida(cur, nombre="Insumos"):
    cur.execute("SELECT id FROM dbo.categorias WHERE empresa_id IS NULL AND nombre = ?", nombre)
    return str(cur.fetchone()[0])


def _insertar(cur, empresa_id, categoria_id, usuario_id, mes="2026-12-01", monto=500000):
    cur.execute(
        "INSERT INTO dbo.presupuestos (empresa_id, categoria_id, mes, monto, creado_por) "
        "OUTPUT CAST(inserted.id AS VARCHAR(36)) VALUES (?, ?, ?, ?, ?)",
        empresa_id, categoria_id, mes, monto, usuario_id,
    )
    return cur.fetchone()[0]


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client, "Empresa presupuestos")
    e["usuario_id"] = usuario_id_de(sql, e["oid"])
    cur = sql.cursor()
    _contexto(cur, e["empresa"]["id"])
    yield e, cur
    _contexto(cur, None)


def test_un_solo_presupuesto_por_categoria_y_mes(empresa):
    e, cur = empresa
    cat = _categoria_predefinida(cur)
    _insertar(cur, e["empresa"]["id"], cat, e["usuario_id"])
    with pytest.raises(pyodbc.IntegrityError):
        _insertar(cur, e["empresa"]["id"], cat, e["usuario_id"], monto=700000)
    # Otro mes u otra categoría sí se pueden
    _insertar(cur, e["empresa"]["id"], cat, e["usuario_id"], mes="2027-01-01")
    _insertar(cur, e["empresa"]["id"], _categoria_predefinida(cur, "Arriendo"), e["usuario_id"])


def test_mes_debe_ser_el_dia_1(empresa):
    e, cur = empresa
    with pytest.raises(pyodbc.IntegrityError):
        _insertar(cur, e["empresa"]["id"], _categoria_predefinida(cur), e["usuario_id"], mes="2026-12-15")


@pytest.mark.parametrize("monto", [0, -1, 1_000_000_000_000])
def test_monto_fuera_de_rango(empresa, monto):
    e, cur = empresa
    with pytest.raises(pyodbc.IntegrityError):
        _insertar(cur, e["empresa"]["id"], _categoria_predefinida(cur), e["usuario_id"], monto=monto)


def test_actualizado_por_y_en_van_juntos(empresa):
    e, cur = empresa
    pid = _insertar(cur, e["empresa"]["id"], _categoria_predefinida(cur), e["usuario_id"])
    with pytest.raises(pyodbc.IntegrityError):
        cur.execute("UPDATE dbo.presupuestos SET actualizado_por = ? WHERE id = ?", e["usuario_id"], pid)
    cur.execute(
        "UPDATE dbo.presupuestos SET monto = 600000, actualizado_por = ?, actualizado_en = SYSUTCDATETIME() WHERE id = ?",
        e["usuario_id"], pid,
    )
    assert cur.rowcount == 1


def test_rls_otra_empresa_no_ve_ni_escribe(client, sql, empresa):
    e, cur = empresa
    pid = _insertar(cur, e["empresa"]["id"], _categoria_predefinida(cur), e["usuario_id"])

    b = registrar_empresa(client, "Otra empresa")
    _contexto(cur, b["empresa"]["id"])
    cur.execute("SELECT COUNT(*) FROM dbo.presupuestos WHERE id = ?", pid)
    assert cur.fetchone()[0] == 0
    cur.execute("UPDATE dbo.presupuestos SET monto = 1 WHERE id = ?", pid)
    assert cur.rowcount == 0  # FILTER: la fila ajena no existe para B
    # BLOCK AFTER INSERT: B no puede escribir a nombre de A
    with pytest.raises(pyodbc.Error):
        _insertar(cur, e["empresa"]["id"], _categoria_predefinida(cur, "Arriendo"), usuario_id_de(sql, b["oid"]))

    # Sin contexto no se ve nada
    _contexto(cur, None)
    cur.execute("SELECT COUNT(*) FROM dbo.presupuestos")
    assert cur.fetchone()[0] == 0


def test_eliminar_categoria_propia_elimina_sus_presupuestos(empresa):
    e, cur = empresa
    cur.execute(
        "INSERT INTO dbo.categorias (empresa_id, nombre, tipo, color) OUTPUT CAST(inserted.id AS VARCHAR(36)) "
        "VALUES (?, N'Bencina', 'gasto', '#123456')",
        e["empresa"]["id"],
    )
    cat = cur.fetchone()[0]
    pid = _insertar(cur, e["empresa"]["id"], cat, e["usuario_id"])
    cur.execute("DELETE FROM dbo.categorias WHERE id = ?", cat)
    cur.execute("SELECT COUNT(*) FROM dbo.presupuestos WHERE id = ?", pid)
    assert cur.fetchone()[0] == 0
