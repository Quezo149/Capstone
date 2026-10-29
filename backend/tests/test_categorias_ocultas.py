"""
Mejora a HU14 (28-10-2026): ocultar categorías predefinidas por empresa (0011_categorias_ocultas.sql).

- El admin oculta y vuelve a mostrar una predefinida; GET /categorias trae `oculta`. Repetir no falla.
- Solo para su empresa: otra empresa la sigue viendo (RLS, también directo en la base).
- Contador y empleado → 403; categoría propia → 422; inexistente → 404.
- Siempre queda al menos una visible de cada tipo: ocultar la última → 409 `ultima_visible`, y
  eliminar la última propia visible también → 409.
- Los movimientos con una categoría oculta siguen listándose y editándose.
- La sugerencia por tipo de comercio no propone una categoría oculta.
"""

import pytest

from tests.test_documentos import _subir, nube  # noqa: F401 — fixture
from tests.test_lectura import campo, resultado
from tests.utils import agregar_miembro, auth, registrar_empresa

from datetime import date
from types import SimpleNamespace as N


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client)
    e["empleado"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    e["contador"] = agregar_miembro(sql, e["empresa"]["id"], "contador")
    e["cats"] = {c["nombre"]: c for c in client.get("/categorias", headers=auth(e["token"])).json()}
    return e


def _ocultar(client, e, nombre, oculta=True, token=None):
    return client.put(f"/categorias/{e['cats'][nombre]['id']}/oculta", json={"oculta": oculta}, headers=auth(token or e["token"]))


def _estado(client, e, token=None):
    return {c["nombre"]: c["oculta"] for c in client.get("/categorias", headers=auth(token or e["token"])).json()}


def test_ocultar_y_volver_a_mostrar(client, empresa):
    assert _estado(client, empresa)["Marketing"] is False
    r = _ocultar(client, empresa, "Marketing")
    assert r.status_code == 200 and r.json()["oculta"] is True
    assert _estado(client, empresa)["Marketing"] is True
    assert _ocultar(client, empresa, "Marketing").status_code == 200  # repetir no falla
    # Todos los roles ven qué está oculto (la app no la muestra en el formulario)
    assert _estado(client, empresa, empresa["empleado"]["token"])["Marketing"] is True

    r = _ocultar(client, empresa, "Marketing", oculta=False)
    assert r.status_code == 200 and r.json()["oculta"] is False
    assert _estado(client, empresa)["Marketing"] is False
    assert _ocultar(client, empresa, "Marketing", oculta=False).status_code == 200


def test_solo_para_su_empresa(client, sql, empresa):
    _ocultar(client, empresa, "Marketing")
    otra = registrar_empresa(client, "Otra empresa")
    otra["cats"] = {c["nombre"]: c for c in client.get("/categorias", headers=auth(otra["token"])).json()}
    assert _estado(client, otra)["Marketing"] is False
    # Directo en la base, con el contexto de la otra empresa: no ve la fila
    cur = sql.cursor()
    cur.execute("EXEC sp_set_session_context N'empresa_id', ?", otra["empresa"]["id"])
    assert cur.execute("SELECT COUNT(*) FROM dbo.categorias_ocultas").fetchone()[0] == 0
    cur.execute("EXEC sp_set_session_context N'empresa_id', ?", empresa["empresa"]["id"])
    assert cur.execute("SELECT COUNT(*) FROM dbo.categorias_ocultas").fetchone()[0] == 1
    cur.close()


@pytest.mark.parametrize("rol", ["empleado", "contador"])
def test_solo_el_admin(client, empresa, rol):
    r = _ocultar(client, empresa, "Marketing", token=empresa[rol]["token"])
    assert r.status_code == 403 and r.json()["detail"]["codigo"] == "rol_sin_permiso"


def test_propias_e_inexistentes(client, empresa):
    propia = client.post(
        "/categorias", json={"nombre": "Fletes", "tipo": "gasto", "color": "#2f5d8a"}, headers=auth(empresa["token"])
    ).json()
    r = client.put(f"/categorias/{propia['id']}/oculta", json={"oculta": True}, headers=auth(empresa["token"]))
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "solo_predefinidas"
    assert client.put("/categorias/no-existe/oculta", json={"oculta": True}, headers=auth(empresa["token"])).status_code == 404


def test_no_se_puede_ocultar_la_ultima_de_un_tipo(client, empresa):
    # Ingresos predefinidos: Ventas y Otros ingresos
    assert _ocultar(client, empresa, "Otros ingresos").status_code == 200
    r = _ocultar(client, empresa, "Ventas")
    assert r.status_code == 409 and r.json()["detail"] == {
        "codigo": "ultima_visible",
        "mensaje": "Debe quedar al menos una categoría de ingresos.",
    }
    assert _estado(client, empresa)["Ventas"] is False
    # Volver a mostrar siempre se puede
    assert _ocultar(client, empresa, "Otros ingresos", oculta=False).status_code == 200


def test_con_una_propia_se_pueden_ocultar_todas_las_predefinidas(client, empresa):
    propia = client.post(
        "/categorias", json={"nombre": "Fletes", "tipo": "gasto", "color": "#2f5d8a"}, headers=auth(empresa["token"])
    ).json()
    gastos = [n for n, c in empresa["cats"].items() if c["tipo"] == "gasto"]
    for nombre in gastos:
        assert _ocultar(client, empresa, nombre).status_code == 200, nombre
    # Ahora la propia es la única visible: no se puede eliminar
    r = client.delete(f"/categorias/{propia['id']}", headers=auth(empresa["token"]))
    assert r.status_code == 409 and r.json()["detail"]["codigo"] == "ultima_visible"
    # Mostrando una predefinida, sí
    _ocultar(client, empresa, "Insumos", oculta=False)
    assert client.delete(f"/categorias/{propia['id']}", headers=auth(empresa["token"])).status_code == 204


def test_movimientos_con_categoria_oculta_siguen_igual(client, empresa):
    cat = empresa["cats"]["Marketing"]["id"]
    mov = client.post(
        "/movimientos",
        json={"tipo": "gasto", "fecha": "2026-10-10", "monto": 5000, "categoria_id": cat, "descripcion": "Volantes", "tipo_documento": "boleta"},
        headers=auth(empresa["token"]),
    ).json()
    _ocultar(client, empresa, "Marketing")
    assert [m["id"] for m in client.get("/movimientos", headers=auth(empresa["token"])).json()] == [mov["id"]]
    r = client.put(
        f"/movimientos/{mov['id']}",
        json={"tipo": "gasto", "fecha": "2026-10-10", "monto": 6000, "categoria_id": cat, "descripcion": "Volantes", "tipo_documento": "boleta"},
        headers=auth(empresa["token"]),
    )
    assert r.status_code == 200 and r.json()["categoria_id"] == cat


def test_la_sugerencia_no_propone_una_oculta(client, nube, empresa):
    nube.lectura = resultado(
        "Boleta Electrónica",
        {
            "MerchantName": campo(0.95, value_string="Supermercado El Trébol"),
            "TransactionDate": campo(0.99, value_date=date(2026, 10, 20)),
            "Total": campo(0.99, value_currency=N(amount=8450.0)),
        },
    )
    assert _subir(client, empresa["token"]).json()["sugerencia"]["nombre"] == "Insumos"
    _ocultar(client, empresa, "Insumos")
    assert _subir(client, empresa["token"]).json()["sugerencia"] is None
