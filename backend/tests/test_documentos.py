"""
KONTADORIA-55 — HU08: subir una foto o PDF y leerlo con IA (POST /documentos/extraer).

Blob Storage y Document Intelligence se reemplazan por dobles en memoria: las pruebas no gastan
lecturas del plan F0 ni dejan archivos en Azure. Lo que se prueba es el endpoint: quién puede
subir, qué archivos acepta, dónde los guarda, qué modelo usa y qué pasa si algo falla.

- Foto (JPG/PNG) → prebuilt-receipt, origen "foto"; PDF → prebuilt-invoice, origen "pdf".
- El tipo sale de los primeros bytes: un .txt renombrado a .jpg → 415. Más de 4 MB → 413.
- El archivo queda en pendientes/<empresa del token>/ y la base no cambia.
- Si la IA falla, el archivo se borra y responde 503; si no lee el total, el archivo se conserva.
- Cancelar borra el archivo de la propia empresa; un id con otra forma → 404.
- El contador no sube ni cancela (D1); sin token → 401.

KONTADORIA-61 / 56 — HU09: guardar el movimiento confirmado (POST /movimientos con archivo_id).
- Queda con origen foto/pdf, el RUT del proveedor normalizado y el comprobante en
  <empresa>/<año>/<mes>/; el pendiente se borra.
- Archivo cancelado, vencido o de otra empresa → 422 sin guardar nada.
- Si el almacenamiento falla → 503 sin guardar; si el movimiento no se guarda, no se copia nada.
- El mismo envío repetido (client_request_id) se guarda una vez, con un solo comprobante.
"""

import uuid

from datetime import date
from types import SimpleNamespace as N

import pytest
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError, ServiceRequestError

from app.core import almacenamiento, ia
from tests.test_lectura import campo, resultado
from tests.utils import agregar_miembro, auth, registrar_empresa

JPG = b"\xff\xd8\xff\xe0" + b"0" * 100
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100
PDF = b"%PDF-1.7\n" + b"0" * 100

BOLETA = resultado(
    "VICTORIA CANALES Y COMPANIA LTDA.\nRUT: 79.610.730-8\nBoleta Electronica Nro.: 27932989\nTOTAL 29.320",
    {
        "MerchantName": campo(0.94, value_string="VICTORIA, CANALES Y COMPANIA LTDA"),
        "TransactionDate": campo(0.99, value_date=date(2026, 10, 23)),
        "Total": campo(0.99, value_currency=N(amount=29320.0)),
    },
)
FACTURA = resultado(
    "FACTURA ELECTRONICA N° 9831",
    {
        "InvoiceTotal": campo(0.93, value_currency=N(amount=4879000.0)),
        "InvoiceDate": campo(0.95, value_date=date(2026, 10, 24)),
        "VendorName": campo(0.92, value_string="Constructora Vial del Norte S.A."),
        "VendorTaxId": campo(0.96, value_string="96.332.110-4"),
    },
)


@pytest.fixture
def nube(monkeypatch):
    """Blob Storage y Document Intelligence falsos. `lectura` se puede cambiar en cada prueba."""
    estado = N(archivos={}, modelos=[], lectura=BOLETA, falla_confirmar=None)

    def subir(empresa_id, contenido, extension, content_type):
        archivo_id = f"{'0' * 8}-0000-4000-8000-{len(estado.archivos):012d}.{extension}"
        estado.archivos[almacenamiento.ruta_pendiente(empresa_id, archivo_id)] = (contenido, content_type)
        return archivo_id

    def borrar(empresa_id, archivo_id):
        estado.archivos.pop(almacenamiento.ruta_pendiente(empresa_id, archivo_id), None)

    def confirmar(empresa_id, archivo_id, fecha):
        if estado.falla_confirmar:
            raise estado.falla_confirmar
        pendiente = almacenamiento.ruta_pendiente(empresa_id, archivo_id)
        if pendiente not in estado.archivos:
            raise ResourceNotFoundError("no está")
        destino = almacenamiento.ruta_definitiva(empresa_id, archivo_id, fecha)
        estado.archivos[destino] = estado.archivos[pendiente]
        return destino

    def borrar_ruta(ruta):
        estado.archivos.pop(ruta, None)

    def analizar(contenido, modelo):
        estado.modelos.append(modelo)
        if isinstance(estado.lectura, Exception):
            raise estado.lectura
        return estado.lectura

    monkeypatch.setattr(almacenamiento, "subir_pendiente", subir)
    monkeypatch.setattr(almacenamiento, "borrar_pendiente", borrar)
    monkeypatch.setattr(almacenamiento, "url_lectura", lambda ruta: f"https://prueba.blob/comprobantes/{ruta}?sas")
    monkeypatch.setattr(almacenamiento, "confirmar", confirmar)
    monkeypatch.setattr(almacenamiento, "borrar", borrar_ruta)
    monkeypatch.setattr(ia, "analizar", analizar)
    return estado


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client)
    e["empleado"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    e["contador"] = agregar_miembro(sql, e["empresa"]["id"], "contador")
    cats = client.get("/categorias", headers=auth(e["token"])).json()
    e["cat"] = {c["nombre"]: c["id"] for c in cats}
    return e


def _subir(client, token, contenido=JPG, nombre="boleta.jpg", tipo="image/jpeg"):
    return client.post("/documentos/extraer", files={"archivo": (nombre, contenido, tipo)}, headers=auth(token))


def _movimientos(sql):
    cur = sql.cursor()
    n = cur.execute("SELECT COUNT(*) FROM dbo.movimientos").fetchone()[0]
    cur.close()
    return n


@pytest.mark.parametrize("rol", ["admin", "empleado"])
def test_foto_se_guarda_en_pendientes_y_se_lee_como_boleta(client, sql, nube, empresa, rol):
    token = empresa["token"] if rol == "admin" else empresa["empleado"]["token"]
    antes = _movimientos(sql)

    r = _subir(client, token)

    assert r.status_code == 200, r.text
    cuerpo = r.json()
    assert cuerpo["origen"] == "foto" and cuerpo["ok"] is True
    assert cuerpo["datos"]["monto"] == 29320 and cuerpo["datos"]["proveedor_rut"] == "79610730-8"
    assert almacenamiento.es_archivo_id(cuerpo["archivo_id"])
    ruta = f"pendientes/{empresa['empresa']['id']}/{cuerpo['archivo_id']}"
    assert nube.archivos[ruta] == (JPG, "image/jpeg")
    assert nube.modelos == ["prebuilt-receipt"]
    assert _movimientos(sql) == antes  # nada se guarda hasta que el usuario confirme


def test_png_es_foto(client, nube, empresa):
    r = _subir(client, empresa["token"], PNG, "captura.png", "image/png")
    assert r.status_code == 200 and r.json()["origen"] == "foto"
    assert r.json()["archivo_id"].endswith(".png")


def test_pdf_se_lee_como_factura(client, nube, empresa):
    nube.lectura = FACTURA
    r = _subir(client, empresa["token"], PDF, "factura.pdf", "application/pdf")
    assert r.status_code == 200, r.text
    assert r.json()["origen"] == "pdf" and r.json()["archivo_id"].endswith(".pdf")
    assert r.json()["datos"]["proveedor"] == "Constructora Vial del Norte S.A."
    assert nube.modelos == ["prebuilt-invoice"]
    assert list(nube.archivos.values())[0][1] == "application/pdf"


def test_el_tipo_sale_del_contenido_no_del_nombre(client, nube, empresa):
    # Un texto renombrado a .jpg, con Content-Type de imagen
    r = _subir(client, empresa["token"], b"hola, no soy una foto", "boleta.jpg", "image/jpeg")
    assert r.status_code == 415 and r.json()["detail"]["codigo"] == "formato_no_soportado"
    # Y un PDF real con nombre de foto se trata como PDF
    nube.lectura = FACTURA
    assert _subir(client, empresa["token"], PDF, "foto.jpg", "image/jpeg").json()["origen"] == "pdf"


def test_archivo_vacio_o_muy_grande(client, nube, empresa):
    assert _subir(client, empresa["token"], b"").status_code == 415
    grande = JPG + b"0" * (4 * 1024 * 1024)
    r = _subir(client, empresa["token"], grande)
    assert r.status_code == 413 and r.json()["detail"]["codigo"] == "archivo_muy_grande"
    assert nube.archivos == {} and nube.modelos == []


def test_contador_no_sube_y_sin_token_401(client, nube, empresa):
    r = _subir(client, empresa["contador"]["token"])
    assert r.status_code == 403 and r.json()["detail"]["codigo"] == "rol_sin_permiso"
    assert client.post("/documentos/extraer", files={"archivo": ("b.jpg", JPG, "image/jpeg")}).status_code == 401
    assert nube.archivos == {} and nube.modelos == []


@pytest.mark.parametrize("falla", [HttpResponseError("429 Too Many Requests"), ServiceRequestError("sin red")])
def test_si_la_ia_falla_se_borra_el_archivo(client, nube, empresa, falla):
    nube.lectura = falla
    r = _subir(client, empresa["token"])
    assert r.status_code == 503 and r.json()["detail"]["codigo"] == "lectura_no_disponible"
    assert nube.archivos == {}


def test_si_falla_el_almacenamiento_no_se_llama_a_la_ia(client, nube, empresa, monkeypatch):
    def caido(*_):
        raise ServiceRequestError("storage caído")

    monkeypatch.setattr(almacenamiento, "subir_pendiente", caido)
    r = _subir(client, empresa["token"])
    assert r.status_code == 503 and r.json()["detail"]["codigo"] == "almacenamiento_no_disponible"
    assert nube.modelos == []


def test_sin_total_se_conserva_el_archivo_para_registrar_a_mano(client, nube, empresa):
    nube.lectura = resultado("texto borroso", {})
    r = _subir(client, empresa["token"])
    assert r.status_code == 200
    assert r.json()["ok"] is False and "a mano" in r.json()["motivo"]
    assert len(nube.archivos) == 1 and almacenamiento.es_archivo_id(r.json()["archivo_id"])


def test_cancelar_borra_el_archivo_de_la_propia_empresa(client, nube, empresa):
    archivo_id = _subir(client, empresa["empleado"]["token"]).json()["archivo_id"]
    assert client.delete(f"/documentos/pendientes/{archivo_id}", headers=auth(empresa["empleado"]["token"])).status_code == 204
    assert nube.archivos == {}
    # Repetirlo no da error
    assert client.delete(f"/documentos/pendientes/{archivo_id}", headers=auth(empresa["empleado"]["token"])).status_code == 204


def test_otra_empresa_no_borra_mis_archivos(client, nube, empresa):
    archivo_id = _subir(client, empresa["token"]).json()["archivo_id"]
    otra = registrar_empresa(client, "Otra empresa")
    assert client.delete(f"/documentos/pendientes/{archivo_id}", headers=auth(otra["token"])).status_code == 204
    # Borró (nada) en su propia carpeta: el archivo de la primera empresa sigue ahí
    assert list(nube.archivos) == [f"pendientes/{empresa['empresa']['id']}/{archivo_id}"]


@pytest.mark.parametrize("archivo_id", ["no-es-un-id.jpg", "00000000-0000-4000-8000-000000000000.exe", "..%2F..%2Fotra.jpg"])
def test_cancelar_con_id_invalido(client, nube, empresa, archivo_id):
    r = client.delete(f"/documentos/pendientes/{archivo_id}", headers=auth(empresa["token"]))
    assert r.status_code == 404


def test_contador_no_cancela(client, nube, empresa):
    archivo_id = _subir(client, empresa["token"]).json()["archivo_id"]
    r = client.delete(f"/documentos/pendientes/{archivo_id}", headers=auth(empresa["contador"]["token"]))
    assert r.status_code == 403
    assert len(nube.archivos) == 1


# ---------- Guardar el movimiento confirmado (KONTADORIA-61, 56) ----------


def _confirmado(e, archivo_id, **cambios):
    return {
        "tipo": "gasto",
        "fecha": "2026-10-23",
        "monto": 29320,
        "categoria_id": e["cat"]["Insumos"],
        "proveedor": "Victoria Canales y Compañía Ltda.",
        "proveedor_rut": "79.610.730-8",
        "descripcion": "Aceite y arroz",
        "tipo_documento": "boleta",
        "archivo_id": archivo_id,
        **cambios,
    }


def test_confirmar_foto_guarda_origen_rut_y_comprobante(client, sql, nube, empresa):
    token = empresa["empleado"]["token"]
    archivo_id = _subir(client, token).json()["archivo_id"]

    r = client.post("/movimientos", json=_confirmado(empresa, archivo_id), headers=auth(token))

    assert r.status_code == 201, r.text
    mov = r.json()
    assert mov["origen"] == "foto" and mov["proveedor_rut"] == "79610730-8" and mov["tiene_comprobante"] is True
    definitiva = f"{empresa['empresa']['id']}/2026/10/{archivo_id}"
    # El comprobante quedó en su carpeta del mes y el pendiente ya no está
    assert list(nube.archivos) == [definitiva]
    blob = client.get(f"/movimientos/{mov['id']}", headers=auth(token)).json()
    assert blob["tiene_comprobante"] is True


def test_confirmar_pdf_queda_con_origen_pdf(client, nube, empresa):
    nube.lectura = FACTURA
    archivo_id = _subir(client, empresa["token"], PDF, "factura.pdf", "application/pdf").json()["archivo_id"]
    r = client.post(
        "/movimientos", json=_confirmado(empresa, archivo_id, tipo_documento="factura"), headers=auth(empresa["token"])
    )
    assert r.status_code == 201, r.text
    assert r.json()["origen"] == "pdf"


def test_manual_sigue_igual(client, nube, empresa):
    r = client.post("/movimientos", json=_confirmado(empresa, None, proveedor_rut=None), headers=auth(empresa["token"]))
    assert r.status_code == 201, r.text
    assert r.json()["origen"] == "manual" and r.json()["tiene_comprobante"] is False
    assert r.json()["proveedor_rut"] is None
    assert nube.archivos == {}


def test_archivo_cancelado_o_de_otra_empresa_no_se_guarda(client, nube, empresa):
    archivo_id = _subir(client, empresa["token"]).json()["archivo_id"]
    otra = registrar_empresa(client, "Otra empresa")
    cats = {c["nombre"]: c["id"] for c in client.get("/categorias", headers=auth(otra["token"])).json()}
    # La otra empresa usa el id de un archivo ajeno: se busca en SU carpeta y no está
    r = client.post(
        "/movimientos", json={**_confirmado(empresa, archivo_id), "categoria_id": cats["Insumos"]}, headers=auth(otra["token"])
    )
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "archivo_no_encontrado"
    assert client.get("/movimientos", headers=auth(otra["token"])).json() == []

    # Cancelado antes de confirmar
    client.delete(f"/documentos/pendientes/{archivo_id}", headers=auth(empresa["token"]))
    r = client.post("/movimientos", json=_confirmado(empresa, archivo_id), headers=auth(empresa["token"]))
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "archivo_no_encontrado"
    assert client.get("/movimientos", headers=auth(empresa["token"])).json() == []


@pytest.mark.parametrize(
    "cambios",
    [
        {"archivo_id": "../../otra-empresa/archivo.jpg"},
        {"archivo_id": "00000000-0000-4000-8000-000000000000.exe"},
        {"proveedor_rut": "76.771.304-1"},  # dígito verificador malo
        {"proveedor_rut": "hola"},
    ],
)
def test_archivo_o_rut_invalidos(client, nube, empresa, cambios):
    archivo_id = _subir(client, empresa["token"]).json()["archivo_id"]
    r = client.post("/movimientos", json={**_confirmado(empresa, archivo_id), **cambios}, headers=auth(empresa["token"]))
    assert r.status_code == 422
    assert client.get("/movimientos", headers=auth(empresa["token"])).json() == []


def test_si_falla_el_almacenamiento_no_se_guarda(client, nube, empresa):
    archivo_id = _subir(client, empresa["token"]).json()["archivo_id"]
    nube.falla_confirmar = ServiceRequestError("storage caído")
    r = client.post("/movimientos", json=_confirmado(empresa, archivo_id), headers=auth(empresa["token"]))
    assert r.status_code == 503 and r.json()["detail"]["codigo"] == "almacenamiento_no_disponible"
    assert client.get("/movimientos", headers=auth(empresa["token"])).json() == []
    # El pendiente sigue: el usuario puede reintentar
    assert list(nube.archivos) == [f"pendientes/{empresa['empresa']['id']}/{archivo_id}"]
    nube.falla_confirmar = None
    assert client.post("/movimientos", json=_confirmado(empresa, archivo_id), headers=auth(empresa["token"])).status_code == 201


def test_categoria_invalida_no_copia_el_archivo(client, nube, empresa):
    archivo_id = _subir(client, empresa["token"]).json()["archivo_id"]
    r = client.post(
        "/movimientos", json=_confirmado(empresa, archivo_id, categoria_id=empresa["cat"]["Ventas"]), headers=auth(empresa["token"])
    )
    assert r.status_code == 422
    assert list(nube.archivos) == [f"pendientes/{empresa['empresa']['id']}/{archivo_id}"]


def test_envio_repetido_se_guarda_una_vez(client, nube, empresa):
    archivo_id = _subir(client, empresa["token"]).json()["archivo_id"]
    cuerpo = _confirmado(empresa, archivo_id, client_request_id=str(uuid.uuid4()))
    primero = client.post("/movimientos", json=cuerpo, headers=auth(empresa["token"]))
    # El reintento llega cuando el pendiente ya se borró: igual responde el mismo movimiento
    segundo = client.post("/movimientos", json=cuerpo, headers=auth(empresa["token"]))
    assert primero.status_code == 201 and segundo.status_code == 201
    assert primero.json()["id"] == segundo.json()["id"]
    assert len(client.get("/movimientos", headers=auth(empresa["token"])).json()) == 1
    assert len(nube.archivos) == 1


def test_editar_corrige_el_rut_sin_cambiar_origen_ni_comprobante(client, nube, empresa):
    archivo_id = _subir(client, empresa["token"]).json()["archivo_id"]
    mov = client.post("/movimientos", json=_confirmado(empresa, archivo_id), headers=auth(empresa["token"])).json()
    datos = {k: v for k, v in _confirmado(empresa, None).items() if k != "archivo_id"}
    r = client.put(f"/movimientos/{mov['id']}", json={**datos, "proveedor_rut": "96332110-4"}, headers=auth(empresa["token"]))
    assert r.status_code == 200, r.text
    assert r.json()["proveedor_rut"] == "96332110-4"
    assert r.json()["origen"] == "foto" and r.json()["tiene_comprobante"] is True


def test_editar_sin_mandar_el_rut_lo_conserva(client, nube, empresa):
    # La pantalla de edición anterior no enviaba proveedor_rut: no debe borrarlo
    archivo_id = _subir(client, empresa["token"]).json()["archivo_id"]
    mov = client.post("/movimientos", json=_confirmado(empresa, archivo_id), headers=auth(empresa["token"])).json()
    datos = {k: v for k, v in _confirmado(empresa, None).items() if k not in ("archivo_id", "proveedor_rut")}
    r = client.put(f"/movimientos/{mov['id']}", json={**datos, "monto": 30000}, headers=auth(empresa["token"]))
    assert r.status_code == 200 and r.json()["monto"] == 30000
    assert r.json()["proveedor_rut"] == "79610730-8"
    # Mandarlo vacío sí lo borra (el usuario lo quitó a propósito)
    r = client.put(f"/movimientos/{mov['id']}", json={**datos, "proveedor_rut": ""}, headers=auth(empresa["token"]))
    assert r.json()["proveedor_rut"] is None


def test_la_misma_foto_dos_veces_pide_confirmar_al_guardar(client, nube, empresa):
    # Caso real (28-10): un colaborador subió 3 veces la misma boleta y quedaron 3 gastos iguales,
    # porque la IA no leyó la fecha y el aviso al leer no se pudo calcular
    token = empresa["empleado"]["token"]
    primero = _subir(client, token).json()["archivo_id"]
    assert client.post("/movimientos", json=_confirmado(empresa, primero), headers=auth(token)).status_code == 201

    segundo = _subir(client, token).json()["archivo_id"]
    r = client.post("/movimientos", json=_confirmado(empresa, segundo), headers=auth(token))
    assert r.status_code == 409
    detalle = r.json()["detail"]
    assert detalle["codigo"] == "posible_duplicado"
    assert detalle["duplicado"]["monto"] == 29320 and detalle["duplicado"]["fecha"] == "2026-10-23"
    # No se guardó ni se copió nada: el segundo archivo sigue en pendientes/
    assert len(client.get("/movimientos", headers=auth(token)).json()) == 1
    assert f"pendientes/{empresa['empresa']['id']}/{segundo}" in nube.archivos

    # "Guardar igual"
    r = client.post("/movimientos", json={**_confirmado(empresa, segundo), "aceptar_duplicado": True}, headers=auth(token))
    assert r.status_code == 201
    assert len(client.get("/movimientos", headers=auth(token)).json()) == 2


def test_al_guardar_se_revisa_con_los_datos_finales(client, nube, empresa):
    # El usuario corrigió el monto y la fecha: se compara con lo que guarda, no con lo que leyó la IA
    _ = client.post(
        "/movimientos",
        json={**_confirmado(empresa, None), "monto": 31000, "fecha": "2026-10-25"},
        headers=auth(empresa["token"]),
    )
    archivo_id = _subir(client, empresa["token"]).json()["archivo_id"]
    r = client.post(
        "/movimientos", json={**_confirmado(empresa, archivo_id), "monto": 31000, "fecha": "2026-10-25"}, headers=auth(empresa["token"])
    )
    assert r.status_code == 409


def test_el_registro_manual_repetido_no_se_bloquea(client, nube, empresa):
    for _ in range(2):
        r = client.post("/movimientos", json=_confirmado(empresa, None), headers=auth(empresa["token"]))
        assert r.status_code == 201


# ---------- Ver el comprobante guardado (HU09) ----------


def _con_foto(client, e, token=None, **cambios):
    token = token or e["token"]
    archivo_id = _subir(client, token).json()["archivo_id"]
    r = client.post("/movimientos", json=_confirmado(e, archivo_id, **cambios), headers=auth(token))
    assert r.status_code == 201, r.text
    return r.json(), archivo_id


def test_ver_comprobante_entrega_un_link_temporal(client, nube, empresa):
    mov, archivo_id = _con_foto(client, empresa)
    r = client.get(f"/movimientos/{mov['id']}/comprobante", headers=auth(empresa["token"]))
    assert r.status_code == 200, r.text
    assert r.json() == {
        "url": f"https://prueba.blob/comprobantes/{empresa['empresa']['id']}/2026/10/{archivo_id}?sas",
        "origen": "foto",
        "tipo": "image/jpeg",
        "vence_en_minutos": 10,
    }


def test_comprobante_pdf(client, nube, empresa):
    nube.lectura = FACTURA
    archivo_id = _subir(client, empresa["token"], PDF, "factura.pdf", "application/pdf").json()["archivo_id"]
    mov = client.post("/movimientos", json=_confirmado(empresa, archivo_id, tipo_documento="factura"), headers=auth(empresa["token"])).json()
    assert client.get(f"/movimientos/{mov['id']}/comprobante", headers=auth(empresa["token"])).json()["tipo"] == "application/pdf"


def test_quien_puede_ver_el_comprobante(client, nube, empresa, sql):
    del_empleado, _ = _con_foto(client, empresa, token=empresa["empleado"]["token"])
    url = f"/movimientos/{del_empleado['id']}/comprobante"
    # El empleado ve el suyo; admin y contador ven los de toda la empresa (el contador revisa)
    for token in (empresa["empleado"]["token"], empresa["token"], empresa["contador"]["token"]):
        assert client.get(url, headers=auth(token)).status_code == 200
    # Otro empleado y otra empresa: 404, como si no existiera (RLS)
    otro = agregar_miembro(sql, empresa["empresa"]["id"], "empleado")
    assert client.get(url, headers=auth(otro["token"])).status_code == 404
    assert client.get(url, headers=auth(registrar_empresa(client, "Otra")["token"])).status_code == 404
    assert client.get(url).status_code == 401


def test_sin_comprobante_o_anulado(client, nube, empresa):
    manual = client.post("/movimientos", json=_confirmado(empresa, None), headers=auth(empresa["token"])).json()
    r = client.get(f"/movimientos/{manual['id']}/comprobante", headers=auth(empresa["token"]))
    assert r.status_code == 404 and r.json()["detail"]["codigo"] == "sin_comprobante"

    mov, _ = _con_foto(client, empresa, fecha="2026-10-24", monto=1000)
    client.delete(f"/movimientos/{mov['id']}", headers=auth(empresa["token"]))
    assert client.get(f"/movimientos/{mov['id']}/comprobante", headers=auth(empresa["token"])).status_code == 404
    assert client.get("/movimientos/no-es-un-id/comprobante", headers=auth(empresa["token"])).status_code == 404


def test_url_lectura_firma_solo_lectura_de_un_archivo(monkeypatch):
    """Sin Azure: la firma se calcula con la clave (de mentira aquí)."""
    import base64
    from datetime import datetime, timezone
    from urllib.parse import parse_qs, urlsplit

    falsa = N(
        storage_account_name="cuentaprueba",
        storage_container_comprobantes="comprobantes",
        storage_account_key=base64.b64encode(b"clave-de-prueba").decode(),
    )
    monkeypatch.setattr(almacenamiento, "get_settings", lambda: falsa)
    ahora = datetime(2026, 10, 28, 15, 0, tzinfo=timezone.utc)
    url = almacenamiento.url_lectura("e1/2026/10/a.jpg", ahora)
    partes = urlsplit(url)
    q = {k: v[0] for k, v in parse_qs(partes.query).items()}
    assert partes.netloc == "cuentaprueba.blob.core.windows.net" and partes.path == "/comprobantes/e1/2026/10/a.jpg"
    assert q["sp"] == "r" and q["sr"] == "b" and q["rscd"] == "inline"
    assert q["st"] == "2026-10-28T14:55:00Z" and q["se"] == "2026-10-28T15:10:00Z"
    assert q["sig"]
