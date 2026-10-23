"""KONTADORIA-55/59 — interpretar la lectura de Document Intelligence (sin Azure ni base de datos).

Los textos vienen de fotos reales leídas el 23-10-2026 (boletas y vouchers POS); las respuestas
se arman con la misma forma que devuelve el SDK, así las pruebas no gastan lecturas del plan F0.
"""

from datetime import date
from types import SimpleNamespace as N

import pytest

from app.core.lectura import detectar_tipo, interpretar, proveedor_respaldo, rut_emisor


@pytest.mark.parametrize(
    "texto, tipo, confianza",
    [
        ("R.U.T.: 76.111.222-3\nBOLETA ELECTRÓNICA\nN° 12345", "boleta", "alta"),
        ("FACTURA\nELECTRONICA N 88", "factura", "alta"),  # el título partido en dos líneas
        ("Factura no afecta o exenta electrónica", "factura", "alta"),
        ("Bol. Electronica 202693101155 Caja: C1", "boleta", "alta"),  # Líder
        ("TRANSBANK\nVALIDO COMO BOLETA\n20/10/2026", "boleta", "alta"),
        ("NOTA DE CRÉDITO ELECTRÓNICA", "otro", "alta"),
        ("Boleta N°55", "boleta", "media"),  # foto cortada: solo la palabra
        ("COMPROBANTE DE VENTA\nPRONTO", "boleta", "media"),
        ("Comprobante Cheque Restaurant Electrónico", "otro", "media"),  # voucher Mercado Pago
    ],
)
def test_detectar_tipo(texto, tipo, confianza):
    assert detectar_tipo(texto)[:2] == (tipo, confianza)


def test_rut_prefiere_el_etiquetado():
    assert rut_emisor("Cliente 12.345.678-5\nRUT: 78071589-8") == "78071589-8"


def test_rut_ignora_el_de_la_persona_que_paga():
    # Voucher Pluxee: primero el RUT de quien paga, después el de la empresa sin etiqueta
    assert rut_emisor("Tarjeta N°1111  12.345.678-5\nKCINCO SPA 76.218.671-3") == "76218671-3"


def test_rut_descarta_los_mal_leidos():
    # El OCR leyó un 8 como 1: el dígito verificador no calza
    assert rut_emisor("RUT: 76213671-3") is None


def test_proveedor_respaldo():
    assert proveedor_respaldo("RUT: 78071589-8\nR.Social: Comercial Y Servicios Roca\nLimitada\nGiro: Alimentos") == (
        "Comercial Y Servicios Roca Limitada"
    )
    assert proveedor_respaldo("Revisa tu boleta en WWW.LIDER.CL") == "Lider"
    assert proveedor_respaldo("GRACIAS POR SU COMPRA") is None


# ---------- interpretar(): respuesta con la forma del SDK ----------


def campo(confianza, poligono=(10, 10, 50, 10, 50, 20, 10, 20), **valor):
    base = dict(value_currency=None, value_date=None, value_string=None, content=None, value_array=None, value_object=None)
    return N(**{**base, **valor}, confidence=confianza, bounding_regions=[N(polygon=list(poligono))])


def linea(texto, poligono=(0, 0, 10, 0, 10, 5, 0, 5)):
    return N(content=texto, polygon=list(poligono))


def resultado(texto, campos):
    return N(
        content=texto,
        pages=[N(width=100, height=200, lines=[linea(l) for l in texto.splitlines()])],
        documents=[N(fields=campos)],
    )


TEXTO_FARMACIA = "VICTORIA CANALES Y COMPANIA LTDA.\nRUT: 79.610.730-8\nBoleta Electronica Nro.: 27932989\nTOTAL 29.320"


def test_interpretar_boleta_completa():
    r = interpretar(
        resultado(
            TEXTO_FARMACIA,
            {
                "MerchantName": campo(0.94, value_string="VICTORIA, CANALES Y COMPANIA LTDA"),
                "TransactionDate": campo(0.99, value_date=date(2026, 10, 23)),
                "Total": campo(0.99, value_currency=N(amount=29320.0)),
                "Items": N(
                    value_array=[
                        N(value_object={"Description": N(content="ACEITE MARAVILLA\n1 LT")}),
                        N(value_object={"Description": N(content="ARROZ GRADO 2 1KG")}),
                        N(value_object={"Description": N(content="AZUCAR 1KG")}),
                    ]
                ),
            },
        )
    )
    assert r["ok"]
    assert r["datos"] == {
        "monto": 29320,
        "fecha": "2026-10-23",
        "proveedor": "VICTORIA, CANALES Y COMPANIA LTDA",
        "proveedor_rut": "79610730-8",
        "tipo_documento": "boleta",
        "descripcion": "ACEITE MARAVILLA 1 LT, ARROZ GRADO 2 1KG",  # solo los 2 primeros productos
    }
    assert r["confianza"] == {
        "monto": "alta",
        "fecha": "alta",
        "proveedor": "alta",
        "tipo_documento": "alta",
        "descripcion": "media",
    }
    assert set(r["motivos"]) == {"descripcion"}
    # Cajas en fracciones de la página (100 x 200): x 10→0.1, y 10→0.05
    assert r["cajas"]["monto"] == [0.1, 0.05, 0.4, 0.05]
    assert {"proveedor", "fecha", "rut", "tipo_documento"} <= set(r["cajas"])


def test_interpretar_sin_total_no_sirve():
    r = interpretar(resultado("texto borroso", {"TransactionDate": campo(0.4, value_date=date(2026, 10, 23))}))
    assert r == {"ok": False, "motivo": "No alcanzamos a leer el total. Prueba con otra foto o regístralo a mano."}


def test_interpretar_foto_ilegible():
    r = interpretar(N(content="", pages=[N(width=100, height=200, lines=[])], documents=[]))
    assert r["ok"] is False


def test_nombre_de_una_palabra_pide_revisar_aunque_venga_con_99():
    r = interpretar(
        resultado(
            "market\nBoleta Electrónica\n$ 2.200",
            {"MerchantName": campo(0.99, value_string="market"), "Total": campo(0.99, value_currency=N(amount=2200.0))},
        )
    )
    assert r["confianza"]["proveedor"] == "media"
    assert "incompleto" in r["motivos"]["proveedor"]
    # Sin fecha: no se inventa, se pide
    assert r["datos"]["fecha"] is None and r["confianza"]["fecha"] == "media"


def test_sin_comercio_usa_respaldo_y_pide_revisar():
    r = interpretar(
        resultado(
            "COMPROBANTE DE VENTA\nPRONTO\nRUT: 78071589-8\nR.Social: Comercial Y Servicios Roca\nLimitada\n$4.100",
            {"Total": campo(0.98, value_currency=N(amount=4100.0))},
        )
    )
    assert r["datos"]["proveedor"] == "Comercial Y Servicios Roca Limitada"
    assert r["datos"]["proveedor_rut"] == "78071589-8"
    assert r["confianza"]["proveedor"] == "media"
    assert r["confianza"]["tipo_documento"] == "media"
    assert "comprobante de venta" in r["motivos"]["tipo_documento"]


def test_total_poco_claro_pide_revisar():
    r = interpretar(resultado("KCINCO SPA\n$ 2.200", {"Total": campo(0.51, value_currency=N(amount=2200.0))}))
    assert r["confianza"]["monto"] == "media"
    assert "poco claro" in r["motivos"]["monto"]
