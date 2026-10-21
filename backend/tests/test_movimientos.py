"""
KONTADORIA-48, 50 — HU06: registro manual de ingresos y gastos.
KONTADORIA-51, 52 — HU07: consultar y filtrar movimientos.

- Registro válido: queda asociado a la empresa y al usuario del token (no a lo que mande el body).
- Monto inválido, categoría de otro tipo o de otra empresa → 422; contador → 403 (D1).
- Un envío repetido con el mismo client_request_id se guarda una sola vez.
- Editar y eliminar: el empleado solo alcanza lo suyo.
- Filtros por tipo, categoría, fechas y usuario; el empleado no filtra por usuario.
- Eliminar anula (queda la fila con quién y cuándo) y "Deshacer" restaura el mismo movimiento.
"""

import uuid

import pytest

from tests.utils import agregar_miembro, auth, registrar_empresa, usuario_id_de


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client)
    e["usuario_id"] = usuario_id_de(sql, e["oid"])
    e["contador"] = agregar_miembro(sql, e["empresa"]["id"], "contador")
    e["empleado"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    e["empleado2"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    cats = client.get("/categorias", headers=auth(e["token"])).json()
    e["cat"] = {c["nombre"]: c["id"] for c in cats}
    return e


def _mov(e, **cambios):
    return {
        "tipo": "gasto",
        "fecha": "2026-10-10",
        "monto": 12500,
        "categoria_id": e["cat"]["Insumos"],
        "proveedor": "Mayorista Central",
        "descripcion": "Papas y aceite",
        "tipo_documento": "boleta",
        **cambios,
    }


def _crear(client, token, datos):
    return client.post("/movimientos", json=datos, headers=auth(token))


def test_registro_valido_queda_asociado_a_empresa_y_usuario(client, empresa):
    r = _crear(client, empresa["empleado"]["token"], _mov(empresa))
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["empresa_id"] == empresa["empresa"]["id"]
    assert m["usuario_id"] == empresa["empleado"]["usuario_id"]
    assert m["monto"] == 12500 and m["origen"] == "manual" and m["fecha"] == "2026-10-10"


def test_ignora_empresa_y_usuario_enviados_por_el_navegador(client, empresa):
    otra = registrar_empresa(client, "Otra")
    datos = _mov(empresa, empresa_id=otra["empresa"]["id"], usuario_id=empresa["empleado2"]["usuario_id"])
    m = _crear(client, empresa["empleado"]["token"], datos).json()
    assert m["empresa_id"] == empresa["empresa"]["id"] and m["usuario_id"] == empresa["empleado"]["usuario_id"]


def test_ingreso_con_campos_opcionales_vacios(client, empresa):
    r = _crear(client, empresa["token"], _mov(empresa, tipo="ingreso", categoria_id=empresa["cat"]["Ventas"], proveedor="", descripcion=None))
    assert r.status_code == 201, r.text
    assert r.json()["proveedor"] is None


@pytest.mark.parametrize("monto", [0, -1000, 12.5, "mil", 10**13])
def test_monto_invalido(client, empresa, monto):
    assert _crear(client, empresa["token"], _mov(empresa, monto=monto)).status_code == 422


@pytest.mark.parametrize(
    "cambios", [{"tipo_documento": "vale"}, {"tipo": "otro"}, {"fecha": "1999-12-31"}, {"fecha": "no-es-fecha"}, {"proveedor": "x" * 151}]
)
def test_otros_datos_invalidos(client, empresa, cambios):
    assert _crear(client, empresa["token"], _mov(empresa, **cambios)).status_code == 422


def test_categoria_de_otro_tipo(client, empresa):
    r = _crear(client, empresa["token"], _mov(empresa, categoria_id=empresa["cat"]["Ventas"]))
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "categoria_invalida"


def test_categoria_de_otra_empresa(client, empresa):
    otra = registrar_empresa(client, "Otra")
    ajena = client.post("/categorias", json={"nombre": "Ajena", "tipo": "gasto", "color": "#4d625b"}, headers=auth(otra["token"])).json()
    r = _crear(client, empresa["token"], _mov(empresa, categoria_id=ajena["id"]))
    assert r.status_code == 422


def test_contador_no_registra_movimientos(client, empresa):
    r = _crear(client, empresa["contador"]["token"], _mov(empresa))
    assert r.status_code == 403 and r.json()["detail"]["codigo"] == "rol_sin_permiso"


def test_envio_repetido_se_guarda_una_vez(client, empresa):
    datos = _mov(empresa, client_request_id=str(uuid.uuid4()))
    a = _crear(client, empresa["token"], datos).json()
    b = _crear(client, empresa["token"], datos).json()
    assert a["id"] == b["id"]
    assert len(client.get("/movimientos", headers=auth(empresa["token"])).json()) == 1


def test_editar_movimiento(client, empresa):
    m = _crear(client, empresa["empleado"]["token"], _mov(empresa)).json()
    r = client.put(f"/movimientos/{m['id']}", json=_mov(empresa, monto=9900, descripcion="Corregido"), headers=auth(empresa["empleado"]["token"]))
    assert r.status_code == 200, r.text
    assert r.json()["monto"] == 9900 and r.json()["usuario_id"] == empresa["empleado"]["usuario_id"]


def test_empleado_no_edita_ni_elimina_lo_ajeno(client, empresa):
    m = _crear(client, empresa["empleado"]["token"], _mov(empresa)).json()
    otro = empresa["empleado2"]["token"]
    assert client.put(f"/movimientos/{m['id']}", json=_mov(empresa), headers=auth(otro)).status_code == 404
    assert client.delete(f"/movimientos/{m['id']}", headers=auth(otro)).status_code == 404
    # El admin sí, porque ve todos los de su empresa
    assert client.delete(f"/movimientos/{m['id']}", headers=auth(empresa["token"])).status_code == 204
    assert client.get(f"/movimientos/{m['id']}", headers=auth(empresa["token"])).status_code == 404


def test_contador_no_edita_ni_elimina(client, empresa):
    m = _crear(client, empresa["token"], _mov(empresa)).json()
    c = empresa["contador"]["token"]
    assert client.put(f"/movimientos/{m['id']}", json=_mov(empresa), headers=auth(c)).status_code == 403
    assert client.delete(f"/movimientos/{m['id']}", headers=auth(c)).status_code == 403


# ---------- HU07: filtros ----------


@pytest.fixture
def con_movimientos(client, empresa):
    e = empresa
    crear = lambda token, **c: _crear(client, token, _mov(e, **c)).json()["id"]  # noqa: E731
    e["ids"] = {
        "venta_admin": crear(e["token"], tipo="ingreso", categoria_id=e["cat"]["Ventas"], fecha="2026-09-15"),
        "insumo_admin": crear(e["token"], fecha="2026-10-01"),
        "arriendo_emp": crear(e["empleado"]["token"], categoria_id=e["cat"]["Arriendo"], fecha="2026-10-05"),
        "insumo_emp2": crear(e["empleado2"]["token"], fecha="2026-10-20"),
    }
    return e


def _listar(client, token, **filtros):
    r = client.get("/movimientos", params=filtros, headers=auth(token))
    assert r.status_code == 200, r.text
    return {m["id"] for m in r.json()}


def test_filtro_por_tipo(client, con_movimientos):
    e = con_movimientos
    assert _listar(client, e["token"], tipo="ingreso") == {e["ids"]["venta_admin"]}


def test_filtro_por_categoria(client, con_movimientos):
    e = con_movimientos
    assert _listar(client, e["token"], categoria_id=e["cat"]["Insumos"]) == {e["ids"]["insumo_admin"], e["ids"]["insumo_emp2"]}


def test_filtro_por_rango_de_fechas(client, con_movimientos):
    e = con_movimientos
    assert _listar(client, e["token"], desde="2026-10-01", hasta="2026-10-05") == {e["ids"]["insumo_admin"], e["ids"]["arriendo_emp"]}


def test_admin_y_contador_filtran_por_usuario(client, con_movimientos):
    e = con_movimientos
    for quien in (e["token"], e["contador"]["token"]):
        assert _listar(client, quien, usuario_id=e["empleado"]["usuario_id"]) == {e["ids"]["arriendo_emp"]}


def test_empleado_no_filtra_por_usuario(client, con_movimientos):
    e = con_movimientos
    r = client.get("/movimientos", params={"usuario_id": e["empleado2"]["usuario_id"]}, headers=auth(e["empleado"]["token"]))
    assert r.status_code == 403


def test_filtros_del_empleado_solo_sobre_lo_suyo(client, con_movimientos):
    e = con_movimientos
    assert _listar(client, e["empleado"]["token"]) == {e["ids"]["arriendo_emp"]}
    assert _listar(client, e["empleado"]["token"], categoria_id=e["cat"]["Insumos"]) == set()


def test_resultados_solo_de_la_empresa(client, con_movimientos):
    e = con_movimientos
    otra = registrar_empresa(client, "Otra")
    assert _listar(client, otra["token"]) == set()
    assert _listar(client, e["token"]) == set(e["ids"].values())


def test_filtro_con_valor_invalido(client, con_movimientos):
    assert client.get("/movimientos", params={"desde": "ayer"}, headers=auth(con_movimientos["token"])).status_code == 422


# ---------- Anulación (0008): eliminar no borra la fila ----------


def _estado_en_base(sql, empresa_id, mov_id):
    """eliminado_en / eliminado_por leídos directo en la base, con el contexto de la empresa."""
    cur = sql.cursor()
    cur.execute("EXEC sp_set_session_context N'empresa_id', ?; EXEC sp_set_session_context N'rol', 'admin';", empresa_id)
    row = cur.execute(
        "SELECT eliminado_en, CAST(eliminado_por AS VARCHAR(36)) FROM dbo.movimientos WHERE id = ?", mov_id
    ).fetchone()
    cur.execute("EXEC sp_set_session_context N'empresa_id', NULL; EXEC sp_set_session_context N'rol', NULL;")
    cur.close()
    return row


def test_eliminar_anula_y_guarda_quien_fue(client, sql, empresa):
    m = _crear(client, empresa["empleado"]["token"], _mov(empresa)).json()
    assert client.delete(f"/movimientos/{m['id']}", headers=auth(empresa["empleado"]["token"])).status_code == 204
    # Para la app ya no existe...
    assert client.get(f"/movimientos/{m['id']}", headers=auth(empresa["token"])).status_code == 404
    assert m["id"] not in {x["id"] for x in client.get("/movimientos", headers=auth(empresa["token"])).json()}
    # ...pero la fila sigue en la base, con quién y cuándo
    eliminado_en, eliminado_por = _estado_en_base(sql, empresa["empresa"]["id"], m["id"])
    assert eliminado_en is not None
    assert eliminado_por.lower() == empresa["empleado"]["usuario_id"].lower()


def test_restaurar_recupera_el_mismo_movimiento(client, empresa):
    token = empresa["empleado"]["token"]
    m = _crear(client, token, _mov(empresa)).json()
    client.delete(f"/movimientos/{m['id']}", headers=auth(token))
    r = client.post(f"/movimientos/{m['id']}/restaurar", headers=auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["id"] == m["id"] and r.json()["creado_en"] == m["creado_en"]
    assert m["id"] in {x["id"] for x in client.get("/movimientos", headers=auth(token)).json()}


def test_anulado_no_se_edita_ni_se_anula_dos_veces(client, empresa):
    m = _crear(client, empresa["token"], _mov(empresa)).json()
    client.delete(f"/movimientos/{m['id']}", headers=auth(empresa["token"]))
    assert client.put(f"/movimientos/{m['id']}", json=_mov(empresa), headers=auth(empresa["token"])).status_code == 404
    assert client.delete(f"/movimientos/{m['id']}", headers=auth(empresa["token"])).status_code == 404


def test_restaurar_uno_vigente_o_inexistente(client, empresa):
    m = _crear(client, empresa["token"], _mov(empresa)).json()
    assert client.post(f"/movimientos/{m['id']}/restaurar", headers=auth(empresa["token"])).status_code == 404
    assert client.post(f"/movimientos/{uuid.uuid4()}/restaurar", headers=auth(empresa["token"])).status_code == 404


def test_quien_puede_restaurar(client, empresa):
    m = _crear(client, empresa["empleado"]["token"], _mov(empresa)).json()
    client.delete(f"/movimientos/{m['id']}", headers=auth(empresa["empleado"]["token"]))
    # Otro empleado no lo alcanza (RLS) y el contador no tiene el permiso
    assert client.post(f"/movimientos/{m['id']}/restaurar", headers=auth(empresa["empleado2"]["token"])).status_code == 404
    assert client.post(f"/movimientos/{m['id']}/restaurar", headers=auth(empresa["contador"]["token"])).status_code == 403
    # El admin sí
    assert client.post(f"/movimientos/{m['id']}/restaurar", headers=auth(empresa["token"])).status_code == 200


def test_otra_empresa_no_anula_ni_restaura(client, empresa):
    otra = registrar_empresa(client, "Otra")
    m = _crear(client, empresa["token"], _mov(empresa)).json()
    assert client.delete(f"/movimientos/{m['id']}", headers=auth(otra["token"])).status_code == 404
    client.delete(f"/movimientos/{m['id']}", headers=auth(empresa["token"]))
    assert client.post(f"/movimientos/{m['id']}/restaurar", headers=auth(otra["token"])).status_code == 404


def test_anulados_no_cuentan_en_filtros(client, empresa):
    a = _crear(client, empresa["token"], _mov(empresa, fecha="2026-10-02")).json()
    b = _crear(client, empresa["token"], _mov(empresa, fecha="2026-10-03")).json()
    client.delete(f"/movimientos/{a['id']}", headers=auth(empresa["token"]))
    r = client.get("/movimientos", params={"desde": "2026-10-01", "categoria_id": empresa["cat"]["Insumos"]}, headers=auth(empresa["token"]))
    assert {x["id"] for x in r.json()} == {b["id"]}


def test_categoria_con_movimiento_anulado_no_se_elimina(client, empresa):
    cat = client.post("/categorias", json={"nombre": "Temporal", "tipo": "gasto", "color": "#2f5d8a"}, headers=auth(empresa["token"])).json()
    m = _crear(client, empresa["token"], _mov(empresa, categoria_id=cat["id"])).json()
    client.delete(f"/movimientos/{m['id']}", headers=auth(empresa["token"]))
    r = client.delete(f"/categorias/{cat['id']}", headers=auth(empresa["token"]))
    assert r.status_code == 409 and r.json()["detail"]["codigo"] == "categoria_en_uso"
