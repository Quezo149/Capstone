"""
KONTADORIA-36 — HU14: gestión de categorías.

- El admin crea, edita y elimina categorías propias; las predefinidas no se modifican.
- Contador y empleado ven las categorías, pero no las gestionan (403).
- No se repite un nombre dentro del mismo tipo, tampoco contra una predefinida.
- Una categoría usada por movimientos no se elimina; las de otra empresa no se alcanzan.
"""

import pytest

from tests.utils import agregar_miembro, auth, registrar_empresa


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client)
    e["contador"] = agregar_miembro(sql, e["empresa"]["id"], "contador")
    e["empleado"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    return e


def _crear(client, token, **datos):
    return client.post("/categorias", json={"nombre": "Delivery", "tipo": "gasto", "color": "#2F5D8A", **datos}, headers=auth(token))


def _predefinida(client, token, nombre="Ventas"):
    return next(c for c in client.get("/categorias", headers=auth(token)).json() if c["nombre"] == nombre)


def test_admin_crea_categoria_propia(client, empresa):
    r = _crear(client, empresa["token"])
    assert r.status_code == 201, r.text
    cat = r.json()
    assert cat["nombre"] == "Delivery" and cat["tipo"] == "gasto" and cat["color"] == "#2f5d8a" and not cat["predefinida"]
    assert cat["id"] in {c["id"] for c in client.get("/categorias", headers=auth(empresa["token"])).json()}


def test_contador_y_empleado_ven_pero_no_gestionan(client, empresa):
    propia = _crear(client, empresa["token"]).json()
    for quien in (empresa["contador"], empresa["empleado"]):
        assert client.get("/categorias", headers=auth(quien["token"])).status_code == 200
        assert _crear(client, quien["token"], nombre="Otra").status_code == 403
        r = client.put(f"/categorias/{propia['id']}", json={"nombre": "X", "color": "#4d625b"}, headers=auth(quien["token"]))
        assert r.status_code == 403
        assert client.delete(f"/categorias/{propia['id']}", headers=auth(quien["token"])).status_code == 403


def test_admin_edita_nombre_y_color(client, empresa):
    cat = _crear(client, empresa["token"]).json()
    r = client.put(f"/categorias/{cat['id']}", json={"nombre": "Reparto", "color": "#b8382a"}, headers=auth(empresa["token"]))
    assert r.status_code == 200, r.text
    assert r.json()["nombre"] == "Reparto" and r.json()["color"] == "#b8382a" and r.json()["tipo"] == "gasto"


def test_predefinidas_no_se_modifican(client, empresa):
    ventas = _predefinida(client, empresa["token"])
    r = client.put(f"/categorias/{ventas['id']}", json={"nombre": "Mías", "color": "#4d625b"}, headers=auth(empresa["token"]))
    assert r.status_code == 403 and r.json()["detail"]["codigo"] == "categoria_predefinida"
    assert client.delete(f"/categorias/{ventas['id']}", headers=auth(empresa["token"])).status_code == 403


@pytest.mark.parametrize("nombre", ["Delivery", "delivery", " Delivery "])
def test_nombre_repetido_en_el_mismo_tipo(client, empresa, nombre):
    assert _crear(client, empresa["token"]).status_code == 201
    r = _crear(client, empresa["token"], nombre=nombre)
    assert r.status_code == 409 and r.json()["detail"]["codigo"] == "categoria_repetida"


def test_no_se_repite_el_nombre_de_una_predefinida(client, empresa):
    r = _crear(client, empresa["token"], nombre="Ventas", tipo="ingreso")
    assert r.status_code == 409


def test_mismo_nombre_en_otro_tipo_si_se_permite(client, empresa):
    assert _crear(client, empresa["token"], nombre="Arriendo", tipo="ingreso").status_code == 201


@pytest.mark.parametrize(
    "datos", [{"nombre": ""}, {"nombre": "x" * 51}, {"color": "rojo"}, {"color": "#12345"}, {"tipo": "otro"}]
)
def test_datos_invalidos(client, empresa, datos):
    assert _crear(client, empresa["token"], **datos).status_code == 422


@pytest.mark.parametrize("color", ["#000000", "#1a1a1a", "#ffffff", "#e0e0e0", "#bbbbbb"])
def test_colores_que_no_se_verian_en_un_tema(client, empresa, color):
    """Negro y blancos casi no se ven en el tema oscuro o en el claro: se rechazan."""
    r = _crear(client, empresa["token"], color=color)
    assert r.status_code == 422


@pytest.mark.parametrize("color", ["#17804f", "#0f6e55", "#2f5d8a", "#c48a12", "#7d8d87", "#5aa37f"])
def test_colores_de_la_paleta_se_aceptan(client, empresa, color):
    assert _crear(client, empresa["token"], nombre=f"C {color}", color=color).status_code == 201


def test_eliminar_sin_uso_y_con_uso(client, empresa):
    libre = _crear(client, empresa["token"], nombre="Libre").json()
    assert client.delete(f"/categorias/{libre['id']}", headers=auth(empresa["token"])).status_code == 204

    usada = _crear(client, empresa["token"], nombre="Usada").json()
    r = client.post(
        "/movimientos",
        json={"tipo": "gasto", "fecha": "2026-10-01", "monto": 5000, "categoria_id": usada["id"], "tipo_documento": "boleta"},
        headers=auth(empresa["token"]),
    )
    assert r.status_code == 201, r.text
    r = client.delete(f"/categorias/{usada['id']}", headers=auth(empresa["token"]))
    assert r.status_code == 409 and r.json()["detail"]["codigo"] == "categoria_en_uso"


def test_categoria_de_otra_empresa_no_se_alcanza(client, empresa):
    otra = registrar_empresa(client, "Otra")
    ajena = _crear(client, otra["token"], nombre="Ajena").json()
    assert ajena["id"] not in {c["id"] for c in client.get("/categorias", headers=auth(empresa["token"])).json()}
    r = client.put(f"/categorias/{ajena['id']}", json={"nombre": "Robada", "color": "#4d625b"}, headers=auth(empresa["token"]))
    assert r.status_code == 404
    assert client.delete(f"/categorias/{ajena['id']}", headers=auth(empresa["token"])).status_code == 404
