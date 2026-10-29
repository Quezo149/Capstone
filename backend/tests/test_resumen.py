"""
KONTADORIA-62 — HU18: resumen mensual del dashboard (GET /movimientos/resumen?mes=AAAA-MM).
KONTADORIA-64 — un empleado solo ve el resumen de sus propios movimientos.

- Ingresos, gastos y saldo del mes, solo movimientos vigentes y con fecha dentro del mes.
- Mes en curso: se compara con el mismo tramo del mes anterior (del 1 al día de hoy, sin pasar
  del fin de ese mes). Mes cerrado: con el mes anterior completo.
- Gastos por categoría de mayor a menor, con su color; los 6 últimos movimientos del mes.
- El empleado solo suma lo suyo (RLS); otra empresa no aparece; mes con formato malo → 422.
"""

import datetime as dt

import pytest

from app.routers import expenses
from tests.utils import agregar_miembro, auth, registrar_empresa


@pytest.fixture
def hoy(monkeypatch):
    """Fija "hoy" (hora de Chile) en el 28-10-2026; cada prueba lo puede cambiar."""
    dia = {"valor": dt.date(2026, 10, 28)}
    monkeypatch.setattr(expenses, "_hoy", lambda: dia["valor"])
    return dia


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client)
    e["empleado"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    e["contador"] = agregar_miembro(sql, e["empresa"]["id"], "contador")
    cats = client.get("/categorias", headers=auth(e["token"])).json()
    e["cat"] = {c["nombre"]: c["id"] for c in cats}
    return e


def _mov(client, e, fecha, monto, categoria="Insumos", tipo="gasto", token=None, descripcion="Compra"):
    r = client.post(
        "/movimientos",
        json={"tipo": tipo, "fecha": fecha, "monto": monto, "categoria_id": e["cat"][categoria], "descripcion": descripcion, "tipo_documento": "boleta"},
        headers=auth(token or e["token"]),
    )
    assert r.status_code == 201, r.text
    return r.json()


def _resumen(client, token, mes=None):
    r = client.get("/movimientos/resumen", params={"mes": mes} if mes else None, headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()


def test_totales_del_mes_y_solo_vigentes(client, hoy, empresa):
    _mov(client, empresa, "2026-10-01", 500_000, "Ventas", "ingreso")
    _mov(client, empresa, "2026-10-31", 100_000, "Ventas", "ingreso")
    _mov(client, empresa, "2026-10-15", 80_000)
    anulado = _mov(client, empresa, "2026-10-16", 999_000)
    client.delete(f"/movimientos/{anulado['id']}", headers=auth(empresa["token"]))
    _mov(client, empresa, "2026-09-30", 7_000)  # otro mes
    _mov(client, empresa, "2026-11-01", 7_000, "Ventas", "ingreso")  # otro mes

    r = _resumen(client, empresa["token"], "2026-10")
    assert (r["mes"], r["ingresos"], r["gastos"], r["saldo"]) == ("2026-10", 600_000, 80_000, 520_000)
    assert r["primer_mes"] == "2026-09"


def test_sin_mes_es_el_actual(client, hoy, empresa):
    _mov(client, empresa, "2026-10-02", 1_000)
    r = _resumen(client, empresa["token"])
    assert r["mes"] == "2026-10" and r["en_curso"] is True and r["gastos"] == 1_000


def test_mes_en_curso_se_compara_con_el_mismo_tramo(client, hoy, empresa):
    hoy["valor"] = dt.date(2026, 10, 10)
    _mov(client, empresa, "2026-09-10", 3_000)  # entra (día 10)
    _mov(client, empresa, "2026-09-11", 50_000)  # no entra: después del día 10
    r = _resumen(client, empresa["token"], "2026-10")
    assert r["anterior"] == {"mes": "2026-09", "hasta": "2026-09-10", "ingresos": 0, "gastos": 3_000, "saldo": -3_000}


def test_el_tramo_no_pasa_del_fin_del_mes_anterior(client, hoy, empresa):
    # 31 de marzo: febrero tiene 28 días, se compara con febrero completo
    hoy["valor"] = dt.date(2027, 3, 31)
    _mov(client, empresa, "2027-02-28", 4_000)
    _mov(client, empresa, "2027-03-01", 1_000)
    r = _resumen(client, empresa["token"], "2027-03")
    assert r["anterior"]["hasta"] == "2027-02-28" and r["anterior"]["gastos"] == 4_000
    assert r["gastos"] == 1_000


def test_mes_cerrado_se_compara_con_el_anterior_completo(client, hoy, empresa):
    _mov(client, empresa, "2026-08-31", 2_000)
    _mov(client, empresa, "2026-09-05", 9_000)
    r = _resumen(client, empresa["token"], "2026-09")
    assert r["en_curso"] is False
    assert r["anterior"]["mes"] == "2026-08" and r["anterior"]["hasta"] == "2026-08-31" and r["anterior"]["gastos"] == 2_000


def test_gastos_por_categoria_de_mayor_a_menor(client, hoy, empresa):
    _mov(client, empresa, "2026-10-03", 10_000, "Transporte")
    _mov(client, empresa, "2026-10-04", 40_000, "Insumos")
    _mov(client, empresa, "2026-10-05", 5_000, "Insumos")
    _mov(client, empresa, "2026-10-06", 900_000, "Ventas", "ingreso")  # los ingresos no van al gráfico
    cats = _resumen(client, empresa["token"], "2026-10")["por_categoria"]
    assert [(c["nombre"], c["monto"], c["cantidad"]) for c in cats] == [("Insumos", 45_000, 2), ("Transporte", 10_000, 1)]
    assert cats[0]["categoria_id"] == empresa["cat"]["Insumos"] and cats[0]["color"].startswith("#")


def test_ultimos_seis_del_mes(client, hoy, empresa):
    for dia in range(1, 9):
        _mov(client, empresa, f"2026-10-{dia:02d}", 1_000 * dia, descripcion=f"Día {dia}")
    _mov(client, empresa, "2026-11-01", 1, descripcion="Noviembre")
    ultimos = _resumen(client, empresa["token"], "2026-10")["ultimos"]
    assert [m["descripcion"] for m in ultimos] == [f"Día {d}" for d in range(8, 2, -1)]
    assert {"id", "monto", "categoria_id", "usuario_nombre", "origen"} <= set(ultimos[0])


def test_mes_sin_movimientos(client, hoy, empresa):
    r = _resumen(client, empresa["token"], "2026-10")
    assert (r["ingresos"], r["gastos"], r["saldo"], r["por_categoria"], r["ultimos"], r["primer_mes"]) == (0, 0, 0, [], [], None)


def test_empleado_solo_ve_el_resumen_de_lo_suyo(client, hoy, empresa):
    """KONTADORIA-64."""
    _mov(client, empresa, "2026-10-05", 70_000, "Arriendo")  # del admin
    _mov(client, empresa, "2026-10-06", 3_000, token=empresa["empleado"]["token"])
    r = _resumen(client, empresa["empleado"]["token"], "2026-10")
    assert r["gastos"] == 3_000
    assert [c["nombre"] for c in r["por_categoria"]] == ["Insumos"]
    assert len(r["ultimos"]) == 1
    # Admin y contador ven toda la empresa
    assert _resumen(client, empresa["token"], "2026-10")["gastos"] == 73_000
    assert _resumen(client, empresa["contador"]["token"], "2026-10")["gastos"] == 73_000


def test_otra_empresa_no_aparece(client, hoy, empresa):
    otra = registrar_empresa(client, "Otra empresa")
    otra["cat"] = {c["nombre"]: c["id"] for c in client.get("/categorias", headers=auth(otra["token"])).json()}
    _mov(client, otra, "2026-10-05", 55_000)
    assert _resumen(client, empresa["token"], "2026-10")["gastos"] == 0


@pytest.mark.parametrize("mes", ["2026-13", "2026-1", "octubre", "2026-10-01"])
def test_mes_invalido(client, hoy, empresa, mes):
    assert client.get("/movimientos/resumen", params={"mes": mes}, headers=auth(empresa["token"])).status_code == 422


def test_sin_token(client, hoy):
    assert client.get("/movimientos/resumen").status_code == 401
