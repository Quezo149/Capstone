"""
KONTADORIA-67, 69, 72, 74, 75 — HU10–HU13: importación masiva desde CSV/XLSX (motor híbrido).

El navegador lee la planilla y manda solo las filas interpretadas; el backend no confía en ellas.

- Confirmar crea la importación y sus movimientos (origen importacion_masiva, a nombre de quien
  importa) en una transacción; el contador importa aunque no registre a mano (D1); el empleado no.
- El mismo envío repetido (client_request_id) se guarda una vez.
- Filas con categoría de otro tipo, de otra empresa u oculta, huella que no corresponde a los
  datos o conteos que no cuadran → 422 y no queda nada.
- Formatos recordados y categorías asociadas: se guardan, se reutilizan sin duplicarse y se olvidan.
- Anular una importación completa y restaurarla devuelve exactamente lo que se anuló; no se
  restaura si sus movimientos ya se importaron de nuevo.
- Otra empresa no ve ni toca nada (RLS).
"""

import uuid

import pytest

from tests.utils import agregar_miembro, auth, registrar_empresa


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client)
    e["contador"] = agregar_miembro(sql, e["empresa"]["id"], "contador")
    e["empleado"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    cats = client.get("/categorias", headers=auth(e["token"])).json()
    e["cat"] = {c["nombre"]: c["id"] for c in cats}
    return e


def _fila(e, n, **cambios):
    f = {
        "n": n,
        "tipo": "gasto",
        "fecha": "2026-11-03",
        "monto": 1000 * n,
        "categoria_id": e["cat"]["Insumos"],
        "proveedor": "Librería Central",
        "descripcion": f"Compra {n}",
        "tipo_documento": "otro",
        **cambios,
    }
    f.setdefault("huella", f"{f['tipo']}|{f['fecha']}|{f['monto']}|{f['descripcion'].lower()}|0")
    return f


def _importacion(e, filas=None, **cambios):
    filas = filas if filas is not None else [_fila(e, 2), _fila(e, 3), _fila(e, 4, tipo="ingreso", categoria_id=e["cat"]["Ventas"])]
    return {
        "client_request_id": str(uuid.uuid4()),
        "nombre_archivo": "caja-noviembre.xlsx",
        "tipo_archivo": "xlsx",
        "archivo_sha256": "a" * 64,
        "total_filas": len(filas),
        "filas_con_error": 0,
        "filas_omitidas": 2,
        "filas": filas,
        **cambios,
    }


def _importar(client, token, datos):
    return client.post("/importaciones", json=datos, headers=auth(token))


def _movimientos(client, token):
    return client.get("/movimientos", headers=auth(token)).json()


# ---------------------------------------------------------------------------------------------
# Confirmar
# ---------------------------------------------------------------------------------------------


def test_confirmar_crea_importacion_y_movimientos(client, empresa):
    r = _importar(client, empresa["token"], _importacion(empresa))
    assert r.status_code == 201, r.text
    imp = r.json()
    assert imp["total_filas"] == 3 and imp["filas_importadas"] == 3 and imp["filas_con_error"] == 0
    assert imp["filas_omitidas"] == 2 and imp["estado"] == "completada"
    assert imp["formato"] == "Plantilla KontadorIA" and imp["archivo_sha256"] == "a" * 64

    movs = [m for m in _movimientos(client, empresa["token"]) if m["importacion_id"] == imp["id"]]
    assert len(movs) == 3
    assert {m["origen"] for m in movs} == {"importacion_masiva"}
    assert {m["usuario_id"] for m in movs} == {imp["usuario_id"]}
    assert all(m["huella_importacion"].startswith(f"{m['tipo']}|") for m in movs)


def test_contador_importa_a_su_nombre_y_el_empleado_no(client, empresa):
    r = _importar(client, empresa["contador"]["token"], _importacion(empresa))
    assert r.status_code == 201, r.text
    assert r.json()["usuario_id"] == empresa["contador"]["usuario_id"]

    r = _importar(client, empresa["empleado"]["token"], _importacion(empresa))
    assert r.status_code == 403
    assert client.get("/importaciones", headers=auth(empresa["empleado"]["token"])).status_code == 403


def test_con_errores_y_excluidas_cuadran_los_conteos(client, empresa):
    datos = _importacion(empresa, total_filas=6, filas_con_error=2)  # 3 enviadas + 2 con error + 1 excluida
    imp = _importar(client, empresa["token"], datos).json()
    assert imp["estado"] == "completada_con_errores"
    assert (imp["filas_importadas"], imp["filas_con_error"], imp["filas_excluidas"]) == (3, 2, 1)


def test_envio_repetido_se_guarda_una_vez(client, empresa):
    datos = _importacion(empresa)
    a = _importar(client, empresa["token"], datos).json()
    b = _importar(client, empresa["token"], datos)
    assert b.status_code in (200, 201) and b.json()["id"] == a["id"]
    assert len(client.get("/importaciones", headers=auth(empresa["token"])).json()) == 1
    assert len(_movimientos(client, empresa["token"])) == 3


@pytest.mark.parametrize("categoria", ["Ventas", "inexistente"])  # de ingresos en un gasto, o no existe
def test_categoria_invalida_no_guarda_nada(client, empresa, categoria):
    cat_id = empresa["cat"]["Ventas"] if categoria == "Ventas" else str(uuid.uuid4())
    datos = _importacion(empresa, filas=[_fila(empresa, 2), _fila(empresa, 3, categoria_id=cat_id)])
    r = _importar(client, empresa["token"], datos)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["codigo"] == "filas_invalidas"
    assert [f["n"] for f in r.json()["detail"]["filas"]] == [3]
    assert client.get("/importaciones", headers=auth(empresa["token"])).json() == []
    assert _movimientos(client, empresa["token"]) == []


def test_categoria_de_otra_empresa_u_oculta(client, empresa):
    otra = registrar_empresa(client, "Otra")
    propia = client.post(
        "/categorias", json={"nombre": "Secreta", "tipo": "gasto", "color": "#7a4fa0"}, headers=auth(otra["token"])
    ).json()
    r = _importar(client, empresa["token"], _importacion(empresa, filas=[_fila(empresa, 2, categoria_id=propia["id"])]))
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "filas_invalidas"

    client.put(f"/categorias/{empresa['cat']['Arriendo']}/oculta", json={"oculta": True}, headers=auth(empresa["token"]))
    r = _importar(client, empresa["token"], _importacion(empresa, filas=[_fila(empresa, 2, categoria_id=empresa["cat"]["Arriendo"])]))
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "filas_invalidas"


@pytest.mark.parametrize(
    "cambio",
    [
        {"monto": 0},
        {"monto": 1.5},
        {"fecha": "1999-12-31"},
        {"tipo": "transferencia"},
        {"descripcion": "x" * 501},
        {"huella": "gasto|2026-11-03|999999|otra cosa|0"},  # no corresponde a los datos de la fila
    ],
)
def test_fila_invalida_es_422(client, empresa, cambio):
    r = _importar(client, empresa["token"], _importacion(empresa, filas=[_fila(empresa, 2), {**_fila(empresa, 3), **cambio}]))
    assert r.status_code == 422, r.text
    assert _movimientos(client, empresa["token"]) == []


def test_conteos_que_no_cuadran_y_limites(client, empresa):
    assert _importar(client, empresa["token"], _importacion(empresa, total_filas=2)).status_code == 422
    assert _importar(client, empresa["token"], _importacion(empresa, filas=[])).status_code == 422
    repetida = [_fila(empresa, 2), _fila(empresa, 2)]
    assert _importar(client, empresa["token"], _importacion(empresa, filas=repetida)).status_code == 422
    assert _importar(client, empresa["token"], _importacion(empresa, archivo_sha256="no-es-un-hash")).status_code == 422
    assert _importar(client, empresa["token"], _importacion(empresa, tipo_archivo="pdf")).status_code == 422


def test_ignora_empresa_y_usuario_enviados_por_el_navegador(client, empresa):
    otra = registrar_empresa(client, "Otra")
    filas = [{**_fila(empresa, 2), "empresa_id": otra["empresa"]["id"], "usuario_id": empresa["empleado"]["usuario_id"]}]
    imp = _importar(client, empresa["token"], _importacion(empresa, filas=filas, empresa_id=otra["empresa"]["id"])).json()
    m = _movimientos(client, empresa["token"])[0]
    assert m["empresa_id"] == empresa["empresa"]["id"] and m["usuario_id"] == imp["usuario_id"]
    assert _movimientos(client, otra["token"]) == []


# ---------------------------------------------------------------------------------------------
# Formatos recordados y categorías asociadas
# ---------------------------------------------------------------------------------------------


def _formato(**cambios):
    return {"guardar": True, "nombre": "Control de caja", "huella": "fecha|detalle|egresos|ingresos", "mapeo": {"cols": {"fecha": 0}}, **cambios}


def test_recordar_formato_y_reutilizarlo(client, empresa):
    t = empresa["token"]
    imp = _importar(client, t, _importacion(empresa, formato=_formato())).json()
    assert imp["formato"] == "Control de caja"
    formatos = client.get("/importaciones/formatos", headers=auth(t)).json()
    assert len(formatos) == 1 and formatos[0]["usos"] == 1 and formatos[0]["mapeo"] == {"cols": {"fecha": 0}}

    # Reconocido la próxima vez (con su id): suma un uso y actualiza el mapeo
    f_id = formatos[0]["id"]
    datos = _importacion(empresa, filas=[_fila(empresa, 7)], formato=_formato(id=f_id, guardar=False, mapeo={"cols": {"fecha": 1}}))
    assert _importar(client, t, datos).json()["formato"] == "Control de caja"
    # Guardar de nuevo el mismo encabezado no lo duplica
    _importar(client, t, _importacion(empresa, filas=[_fila(empresa, 8)], formato=_formato(nombre="Caja 2")))
    formatos = client.get("/importaciones/formatos", headers=auth(t)).json()
    assert len(formatos) == 1 and formatos[0]["usos"] == 3 and formatos[0]["nombre"] == "Caja 2"
    assert formatos[0]["mapeo"] == {"cols": {"fecha": 0}}

    # Sin guardar ni id: queda como "Planilla propia" y no se recuerda
    imp = _importar(client, t, _importacion(empresa, filas=[_fila(empresa, 9)], formato=_formato(guardar=False, huella="otra"))).json()
    assert imp["formato"] == "Planilla propia"

    assert client.delete(f"/importaciones/formatos/{f_id}", headers=auth(t)).status_code == 204
    assert client.get("/importaciones/formatos", headers=auth(t)).json() == []
    assert client.delete(f"/importaciones/formatos/{f_id}", headers=auth(t)).status_code == 404


def test_formato_de_otra_empresa_no_existe(client, empresa):
    otra = registrar_empresa(client, "Otra")
    _importar(client, empresa["token"], _importacion(empresa, formato=_formato()))
    f_id = client.get("/importaciones/formatos", headers=auth(empresa["token"])).json()[0]["id"]
    assert client.get("/importaciones/formatos", headers=auth(otra["token"])).json() == []
    assert client.delete(f"/importaciones/formatos/{f_id}", headers=auth(otra["token"])).status_code == 404
    otra["cat"] = empresa["cat"]  # predefinidas: mismos ids
    r = _importar(client, otra["token"], _importacion(otra, formato=_formato(id=f_id, guardar=False)))
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "formato_no_encontrado"


def test_formato_enorme_es_422(client, empresa):
    r = _importar(client, empresa["token"], _importacion(empresa, formato=_formato(mapeo={"x": "y" * 9000})))
    assert r.status_code == 422


def test_categorias_asociadas_se_recuerdan(client, empresa):
    t = empresa["token"]
    _importar(client, t, _importacion(empresa, alias={"bencina": empresa["cat"]["Transporte"]}))
    _importar(client, t, _importacion(empresa, filas=[_fila(empresa, 9)], alias={"bencina": empresa["cat"]["Mantención"], "luz": empresa["cat"]["Servicios básicos"]}))
    assert client.get("/importaciones/alias", headers=auth(t)).json() == {
        "bencina": empresa["cat"]["Mantención"],
        "luz": empresa["cat"]["Servicios básicos"],
    }
    otra = registrar_empresa(client, "Otra")
    assert client.get("/importaciones/alias", headers=auth(otra["token"])).json() == {}
    r = _importar(client, t, _importacion(empresa, filas=[_fila(empresa, 10)], alias={"x": str(uuid.uuid4())}))
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "alias_invalido"


# ---------------------------------------------------------------------------------------------
# Historial, anular y restaurar
# ---------------------------------------------------------------------------------------------


def test_historial_de_la_empresa(client, empresa):
    _importar(client, empresa["token"], _importacion(empresa))
    _importar(client, empresa["contador"]["token"], _importacion(empresa, filas=[_fila(empresa, 9)]))
    hist = client.get("/importaciones", headers=auth(empresa["contador"]["token"])).json()
    assert [h["filas_importadas"] for h in hist] == [1, 3]  # la más reciente primero
    assert all(h["usuario_nombre"] for h in hist)
    otra = registrar_empresa(client, "Otra")
    assert client.get("/importaciones", headers=auth(otra["token"])).json() == []


def test_anular_y_restaurar_devuelve_exactamente_lo_anulado(client, empresa):
    t = empresa["contador"]["token"]
    imp = _importar(client, empresa["token"], _importacion(empresa)).json()
    movs = _movimientos(client, empresa["token"])
    # Uno se anuló a mano antes: al restaurar la importación debe seguir anulado
    assert client.delete(f"/movimientos/{movs[0]['id']}", headers=auth(empresa["token"])).status_code == 204

    r = client.post(f"/importaciones/{imp['id']}/anular", headers=auth(t))
    assert r.status_code == 200, r.text
    assert r.json()["anulada_en"] and r.json()["anulada_por_nombre"]
    assert _movimientos(client, empresa["token"]) == []
    assert client.post(f"/importaciones/{imp['id']}/anular", headers=auth(t)).json()["detail"]["codigo"] == "ya_anulada"

    r = client.post(f"/importaciones/{imp['id']}/restaurar", headers=auth(t))
    assert r.status_code == 200, r.text
    assert r.json()["anulada_en"] is None
    assert len(_movimientos(client, empresa["token"])) == 2
    assert client.post(f"/importaciones/{imp['id']}/restaurar", headers=auth(t)).json()["detail"]["codigo"] == "no_anulada"


def test_no_restaura_si_ya_se_importo_de_nuevo(client, empresa):
    t = empresa["token"]
    a = _importar(client, t, _importacion(empresa)).json()
    client.post(f"/importaciones/{a['id']}/anular", headers=auth(t))
    _importar(client, t, _importacion(empresa))  # el mismo archivo otra vez
    r = client.post(f"/importaciones/{a['id']}/restaurar", headers=auth(t))
    assert r.status_code == 409 and r.json()["detail"]["codigo"] == "ya_reimportada"
    assert len(_movimientos(client, t)) == 3


def test_anular_permisos_y_aislamiento(client, empresa):
    imp = _importar(client, empresa["token"], _importacion(empresa)).json()
    assert client.post(f"/importaciones/{imp['id']}/anular", headers=auth(empresa["empleado"]["token"])).status_code == 403
    otra = registrar_empresa(client, "Otra")
    assert client.post(f"/importaciones/{imp['id']}/anular", headers=auth(otra["token"])).status_code == 404
    assert client.post("/importaciones/no-es-un-id/anular", headers=auth(empresa["token"])).status_code == 404
    assert len(_movimientos(client, empresa["token"])) == 3


def test_dos_mil_filas_y_el_limite(client, empresa):
    filas = [_fila(empresa, n, monto=1000 + n, descripcion=f"Venta {n}", tipo="ingreso", categoria_id=empresa["cat"]["Ventas"]) for n in range(2, 2002)]
    r = _importar(client, empresa["token"], _importacion(empresa, filas=filas))
    assert r.status_code == 201, r.text
    assert r.json()["filas_importadas"] == 2000
    demasiadas = filas + [_fila(empresa, 2002)]
    assert _importar(client, empresa["token"], _importacion(empresa, filas=demasiadas)).status_code == 422
