"""
KONTADORIA-59 — HU09: categoría sugerida y aviso de compra repetida en POST /documentos/extraer.

Corre contra la base de Docker (el historial es real); la IA y Blob Storage son los dobles de
test_documentos.py.

- Por RUT primero (aunque el nombre cambie), si no por nombre sin mayúsculas ni tildes; gana el
  movimiento más reciente; los anulados no cuentan; el historial de otra empresa no se ve (RLS).
- Proveedor nuevo: pista por tipo de comercio (supermercado → Insumos); sin pista → null.
- Compra repetida: mismo monto y fecha, y mismo RUT o nombre. Solo avisa, no bloquea.
"""

from datetime import date, timedelta
from types import SimpleNamespace as N

from tests.test_documentos import _subir, empresa, nube  # noqa: F401 — fixtures
from tests.test_lectura import campo, resultado
from tests.utils import auth, registrar_empresa


def _gasto(client, e, categoria, **cambios):
    cuerpo = {
        "tipo": "gasto",
        "fecha": "2026-09-01",
        "monto": 5000,
        "categoria_id": e["cat"][categoria],
        "proveedor": "Otro nombre",
        "tipo_documento": "boleta",
        **cambios,
    }
    r = client.post("/movimientos", json=cuerpo, headers=auth(e["token"]))
    assert r.status_code == 201, r.text
    return r.json()


def _lectura(nombre, total=8450.0, fecha=date(2026, 10, 20), texto="Boleta Electrónica"):
    return resultado(
        texto,
        {
            "MerchantName": campo(0.95, value_string=nombre),
            "TransactionDate": campo(0.99, value_date=fecha),
            "Total": campo(0.99, value_currency=N(amount=total)),
        },
    )


def test_sin_historial_ni_pista(client, nube, empresa):
    r = _subir(client, empresa["token"]).json()
    assert r["sugerencia"] is None and r["duplicado"] is None


def test_por_rut_aunque_el_nombre_cambie(client, nube, empresa):
    # BOLETA trae el RUT 79.610.730-8; el historial lo tiene con otro nombre
    _gasto(client, empresa, "Arriendo", proveedor="Farmacias del Sur", proveedor_rut="79610730-8")
    s = _subir(client, empresa["token"]).json()["sugerencia"]
    assert s["categoria_id"] == empresa["cat"]["Arriendo"] and s["fuente"] == "historial"
    assert s["motivo"] == "La última vez que registraste algo del RUT 79.610.730-8 usaste Arriendo."


def test_gana_el_mas_reciente_y_no_cuentan_los_anulados(client, nube, empresa):
    _gasto(client, empresa, "Insumos", fecha="2026-08-01", proveedor_rut="79610730-8")
    reciente = _gasto(client, empresa, "Mantención", fecha="2026-09-15", proveedor_rut="79610730-8")
    assert _subir(client, empresa["token"]).json()["sugerencia"]["nombre"] == "Mantención"

    client.delete(f"/movimientos/{reciente['id']}", headers=auth(empresa["token"]))
    assert _subir(client, empresa["token"]).json()["sugerencia"]["nombre"] == "Insumos"


def test_por_nombre_sin_mayusculas_ni_tildes_si_no_hay_rut(client, nube, empresa):
    _gasto(client, empresa, "Marketing", proveedor="Café Aroma del Sur")
    nube.lectura = _lectura("CAFE AROMA  DEL SUR")  # sin RUT en el texto
    s = _subir(client, empresa["token"]).json()["sugerencia"]
    assert s["nombre"] == "Marketing"
    assert s["motivo"] == "La última vez que registraste algo de CAFE AROMA DEL SUR usaste Marketing."


def test_proveedor_nuevo_usa_la_pista_del_tipo_de_comercio(client, nube, empresa):
    nube.lectura = _lectura("Supermercado El Trébol")
    s = _subir(client, empresa["token"]).json()["sugerencia"]
    assert s == {
        "categoria_id": empresa["cat"]["Insumos"],
        "nombre": "Insumos",
        "motivo": "Por el tipo de comercio que aparece en el documento.",
        "fuente": "pista",
    }
    nube.lectura = _lectura("Estación de Servicio Copec")
    assert _subir(client, empresa["token"]).json()["sugerencia"]["nombre"] == "Transporte"


def test_el_historial_de_otra_empresa_no_se_ve(client, nube, empresa):
    otra = registrar_empresa(client, "Otra empresa")
    otra["cat"] = {c["nombre"]: c["id"] for c in client.get("/categorias", headers=auth(otra["token"])).json()}
    _gasto(client, otra, "Arriendo", proveedor_rut="79610730-8", fecha="2026-10-23", monto=29320)
    r = _subir(client, empresa["token"]).json()
    assert r["sugerencia"] is None and r["duplicado"] is None


def test_compra_repetida_mismo_rut_monto_y_fecha(client, nube, empresa):
    # BOLETA: 29.320 el 23-10-2026, RUT 79.610.730-8 (como el voucher y la boleta de una compra)
    previo = _gasto(client, empresa, "Insumos", fecha="2026-10-23", monto=29320, proveedor="Voucher Transbank", proveedor_rut="79610730-8")
    d = _subir(client, empresa["token"]).json()["duplicado"]
    assert d["id"] == previo["id"] and d["monto"] == 29320 and d["fecha"] == "2026-10-23"
    assert d["proveedor"] == "Voucher Transbank" and d["usuario_nombre"]


def test_compra_repetida_por_nombre_sin_rut(client, nube, empresa):
    _gasto(client, empresa, "Insumos", fecha="2026-10-20", monto=8450, proveedor="Minimarket Don Tito")
    nube.lectura = _lectura("MINIMARKET DON TITO")
    assert _subir(client, empresa["token"]).json()["duplicado"] is not None


def test_no_es_repetida_con_otro_monto_otro_dia_o_si_es_ingreso(client, nube, empresa):
    _gasto(client, empresa, "Insumos", fecha="2026-10-23", monto=29000, proveedor_rut="79610730-8")
    _gasto(client, empresa, "Insumos", fecha="2026-10-22", monto=29320, proveedor_rut="79610730-8")
    client.post(
        "/movimientos",
        json={"tipo": "ingreso", "fecha": "2026-10-23", "monto": 29320, "categoria_id": empresa["cat"]["Ventas"],
              "proveedor": "VICTORIA, CANALES Y COMPANIA LTDA", "tipo_documento": "boleta"},
        headers=auth(empresa["token"]),
    )
    assert _subir(client, empresa["token"]).json()["duplicado"] is None


def test_sin_lectura_no_hay_sugerencia(client, nube, empresa):
    nube.lectura = resultado("texto borroso", {})
    r = _subir(client, empresa["token"]).json()
    assert r["ok"] is False and "sugerencia" not in r and "duplicado" not in r



def test_sin_fecha_leida_busca_en_los_ultimos_60_dias(client, nube, empresa):
    # Foto con la fecha borrosa: la IA no la lee y el formulario propone la de hoy
    hoy = date.today()
    reciente = _gasto(client, empresa, "Insumos", fecha=(hoy - timedelta(days=20)).isoformat(), monto=16015, proveedor_rut="76134941-4")
    _gasto(client, empresa, "Insumos", fecha=(hoy - timedelta(days=90)).isoformat(), monto=16015, proveedor_rut="76134941-4")
    sin_fecha = resultado(
        "LIDER\nRUT: 76.134.941-4\nBoleta Electrónica",
        {"MerchantName": campo(0.9, value_string="Lider"), "Total": campo(0.99, value_currency=N(amount=16015.0))},
    )
    nube.lectura = sin_fecha
    r = _subir(client, empresa["token"]).json()
    assert r["datos"]["fecha"] is None
    assert r["duplicado"]["id"] == reciente["id"]


def test_sin_fecha_leida_y_solo_compras_antiguas_no_avisa(client, nube, empresa):
    viejo = (date.today() - timedelta(days=90)).isoformat()
    _gasto(client, empresa, "Insumos", fecha=viejo, monto=16015, proveedor_rut="76134941-4")
    nube.lectura = resultado(
        "RUT: 76.134.941-4\nBoleta Electrónica",
        {"MerchantName": campo(0.9, value_string="Lider"), "Total": campo(0.99, value_currency=N(amount=16015.0))},
    )
    assert _subir(client, empresa["token"]).json()["duplicado"] is None
