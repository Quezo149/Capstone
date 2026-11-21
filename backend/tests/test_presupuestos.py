"""
KONTADORIA-77 — HU15: CRUD de presupuestos por categoría y mes.

- El admin crea, consulta, edita (el monto) y elimina presupuestos.
- El contador los consulta; ni él ni el empleado los gestionan (403). El empleado no los ve.
- Un solo presupuesto por categoría y mes (409).
- Solo categorías de gasto visibles para la empresa; las de otra empresa no se alcanzan.
- La lista trae lo gastado en el mes: solo movimientos vigentes de gasto de esa categoría y mes.
"""

import pytest

from tests.utils import agregar_miembro, auth, registrar_empresa


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client)
    e["contador"] = agregar_miembro(sql, e["empresa"]["id"], "contador")
    e["empleado"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    return e


def _categoria(client, token, nombre="Insumos"):
    return next(c["id"] for c in client.get("/categorias", headers=auth(token)).json() if c["nombre"] == nombre)


def _crear(client, token, categoria_id, mes="2026-12", monto=500000):
    return client.post("/presupuestos", json={"categoria_id": categoria_id, "mes": mes, "monto": monto}, headers=auth(token))


def _gasto(client, token, categoria_id, fecha, monto):
    r = client.post(
        "/movimientos",
        json={"tipo": "gasto", "fecha": fecha, "monto": monto, "categoria_id": categoria_id, "tipo_documento": "otro"},
        headers=auth(token),
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_admin_crea_y_consulta(client, empresa):
    cat = _categoria(client, empresa["token"])
    r = _crear(client, empresa["token"], cat)
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["categoria_id"] == cat and p["categoria"] == "Insumos" and p["mes"] == "2026-12"
    assert p["monto"] == 500000 and p["gastado"] == 0 and p["color"].startswith("#")

    assert client.get(f"/presupuestos/{p['id']}", headers=auth(empresa["token"])).json() == p
    assert client.get("/presupuestos?mes=2026-12", headers=auth(empresa["token"])).json() == [p]
    assert client.get("/presupuestos?mes=2027-01", headers=auth(empresa["token"])).json() == []
    assert client.get("/presupuestos", headers=auth(empresa["token"])).json() == [p]


def test_un_solo_presupuesto_por_categoria_y_mes(client, empresa):
    cat = _categoria(client, empresa["token"])
    assert _crear(client, empresa["token"], cat).status_code == 201
    r = _crear(client, empresa["token"], cat, monto=900000)
    assert r.status_code == 409
    assert r.json()["detail"]["codigo"] == "presupuesto_repetido"
    assert _crear(client, empresa["token"], cat, mes="2027-01").status_code == 201


def test_admin_edita_el_monto(client, empresa):
    p = _crear(client, empresa["token"], _categoria(client, empresa["token"])).json()
    r = client.put(f"/presupuestos/{p['id']}", json={"monto": 750000}, headers=auth(empresa["token"]))
    assert r.status_code == 200, r.text
    assert r.json() == {**p, "monto": 750000}


def test_admin_elimina(client, empresa):
    p = _crear(client, empresa["token"], _categoria(client, empresa["token"])).json()
    assert client.delete(f"/presupuestos/{p['id']}", headers=auth(empresa["token"])).status_code == 204
    assert client.get(f"/presupuestos/{p['id']}", headers=auth(empresa["token"])).status_code == 404
    # Se puede volver a crear para la misma categoría y mes
    assert _crear(client, empresa["token"], p["categoria_id"]).status_code == 201


def test_contador_consulta_pero_no_gestiona(client, empresa):
    p = _crear(client, empresa["token"], _categoria(client, empresa["token"])).json()
    t = empresa["contador"]["token"]
    assert client.get("/presupuestos", headers=auth(t)).json() == [p]
    assert _crear(client, t, p["categoria_id"], mes="2027-02").status_code == 403
    assert client.put(f"/presupuestos/{p['id']}", json={"monto": 1}, headers=auth(t)).status_code == 403
    assert client.delete(f"/presupuestos/{p['id']}", headers=auth(t)).status_code == 403


def test_empleado_no_ve_ni_gestiona(client, empresa):
    p = _crear(client, empresa["token"], _categoria(client, empresa["token"])).json()
    t = empresa["empleado"]["token"]
    assert client.get("/presupuestos", headers=auth(t)).status_code == 403
    assert client.get(f"/presupuestos/{p['id']}", headers=auth(t)).status_code == 403
    assert _crear(client, t, p["categoria_id"], mes="2027-02").status_code == 403


def test_solo_categorias_de_gasto(client, empresa):
    r = _crear(client, empresa["token"], _categoria(client, empresa["token"], "Ventas"))
    assert r.status_code == 422
    assert r.json()["detail"]["codigo"] == "categoria_no_gasto"


def test_categoria_inexistente_o_de_otra_empresa(client, empresa):
    otra = registrar_empresa(client, "Otra")
    propia_de_otra = client.post(
        "/categorias", json={"nombre": "Secreta", "tipo": "gasto", "color": "#2f5d8a"}, headers=auth(otra["token"])
    ).json()["id"]
    for cat in (propia_de_otra, "00000000-0000-0000-0000-000000000000", "no-es-uuid"):
        r = _crear(client, empresa["token"], cat)
        assert r.status_code == 422, cat
        assert r.json()["detail"]["codigo"] == "categoria_invalida"


def test_categoria_propia_sirve(client, empresa):
    cat = client.post(
        "/categorias", json={"nombre": "Bencina", "tipo": "gasto", "color": "#2f5d8a"}, headers=auth(empresa["token"])
    ).json()["id"]
    assert _crear(client, empresa["token"], cat).json()["categoria"] == "Bencina"


@pytest.mark.parametrize(
    "datos",
    [
        {"mes": "2026-13"},
        {"mes": "2026-1"},
        {"mes": "diciembre"},
        {"monto": 0},
        {"monto": -5},
        {"monto": 1_000_000_000_000},
    ],
)
def test_datos_invalidos(client, empresa, datos):
    body = {"categoria_id": _categoria(client, empresa["token"]), "mes": "2026-12", "monto": 500000, **datos}
    assert client.post("/presupuestos", json=body, headers=auth(empresa["token"])).status_code == 422


def test_editar_monto_invalido(client, empresa):
    p = _crear(client, empresa["token"], _categoria(client, empresa["token"])).json()
    assert client.put(f"/presupuestos/{p['id']}", json={"monto": 0}, headers=auth(empresa["token"])).status_code == 422


def test_otra_empresa_no_alcanza_el_presupuesto(client, empresa):
    p = _crear(client, empresa["token"], _categoria(client, empresa["token"])).json()
    otra = registrar_empresa(client, "Otra")
    t = otra["token"]
    assert client.get("/presupuestos", headers=auth(t)).json() == []
    assert client.get(f"/presupuestos/{p['id']}", headers=auth(t)).status_code == 404
    assert client.put(f"/presupuestos/{p['id']}", json={"monto": 1}, headers=auth(t)).status_code == 404
    assert client.delete(f"/presupuestos/{p['id']}", headers=auth(t)).status_code == 404
    assert client.get(f"/presupuestos/{p['id']}", headers=auth(empresa["token"])).json()["monto"] == 500000


def test_gastado_cuenta_solo_gastos_vigentes_del_mes_y_la_categoria(client, empresa):
    admin = empresa["token"]
    insumos, arriendo = _categoria(client, admin), _categoria(client, admin, "Arriendo")
    p = _crear(client, admin, insumos, mes="2026-10").json()

    _gasto(client, admin, insumos, "2026-10-01", 1000)
    _gasto(client, empresa["empleado"]["token"], insumos, "2026-10-31", 2000)  # de otro usuario: cuenta
    _gasto(client, admin, insumos, "2026-09-30", 4000)  # otro mes
    _gasto(client, admin, insumos, "2026-11-01", 8000)  # otro mes
    _gasto(client, admin, arriendo, "2026-10-15", 16000)  # otra categoría
    anulado = _gasto(client, admin, insumos, "2026-10-15", 32000)
    assert client.delete(f"/movimientos/{anulado}", headers=auth(admin)).status_code in (200, 204)

    assert client.get(f"/presupuestos/{p['id']}", headers=auth(admin)).json()["gastado"] == 3000
