"""
KONTADORIA-79/81 — HU16: exportar movimientos a Excel o CSV.

- Mismas columnas que la plantilla de importación, en orden cronológico, para volver a importarlo.
- Mismos filtros que el listado; los anulados no salen.
- Solo dueño y contador (el empleado recibe 403). Nunca aparecen movimientos de otra empresa.
- El CSV usa ";" y BOM (Excel en Chile) y neutraliza textos que Excel tomaría como fórmula.
"""

import io
import xml.etree.ElementTree as ET
import zipfile

import pytest

from app.core.exportacion import ENCABEZADO
from tests.utils import agregar_miembro, auth, registrar_empresa

NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


@pytest.fixture
def empresa(client, sql):
    e = registrar_empresa(client)
    e["contador"] = agregar_miembro(sql, e["empresa"]["id"], "contador")
    e["empleado"] = agregar_miembro(sql, e["empresa"]["id"], "empleado")
    return e


def _categoria(client, token, nombre):
    return next(c["id"] for c in client.get("/categorias", headers=auth(token)).json() if c["nombre"] == nombre)


def _mov(client, token, **datos):
    base = {"tipo": "gasto", "fecha": "2026-10-10", "monto": 1000, "tipo_documento": "otro"}
    r = client.post("/movimientos", json={**base, **datos}, headers=auth(token))
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def con_movimientos(client, empresa):
    t = empresa["token"]
    insumos, ventas = _categoria(client, t, "Insumos"), _categoria(client, t, "Ventas")
    _mov(client, t, fecha="2026-10-15", monto=12990, categoria_id=insumos, proveedor="El Trébol", descripcion="Papas y aceite")
    _mov(client, t, tipo="ingreso", fecha="2026-10-03", monto=250000, categoria_id=ventas, descripcion="Ventas del día")
    _mov(client, t, fecha="2026-11-02", monto=8000, categoria_id=insumos, proveedor="Ferretería Sur")  # sin descripción
    anulado = _mov(client, t, fecha="2026-10-20", monto=777, categoria_id=insumos, descripcion="Anulado")
    assert client.delete(f"/movimientos/{anulado['id']}", headers=auth(t)).status_code == 204
    _mov(client, empresa["empleado"]["token"], fecha="2026-10-25", monto=3500, categoria_id=insumos, descripcion="Del empleado")
    return {**empresa, "insumos": insumos}


def _exportar(client, token, **params):
    return client.get("/movimientos/exportar", params=params, headers=auth(token))


def _xlsx(contenido: bytes) -> list[list]:
    """Lee la hoja como lo haría una planilla: textos y números por fila."""
    with zipfile.ZipFile(io.BytesIO(contenido)) as z:
        assert z.testzip() is None
        hoja = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    filas = []
    for row in hoja.iterfind(".//x:sheetData/x:row", NS):
        fila = []
        for c in row.iterfind("x:c", NS):
            if c.get("t") == "inlineStr":
                fila.append(c.find("x:is/x:t", NS).text or "")
            else:
                fila.append(int(c.find("x:v", NS).text))
        filas.append(fila)
    return filas


def _csv(contenido: bytes) -> list[list[str]]:
    assert contenido.startswith(b"\xef\xbb\xbf")
    texto = contenido.decode("utf-8-sig")
    assert texto.endswith("\r\n")
    return [linea.split(";") for linea in texto.split("\r\n")[:-1]]


def test_xlsx_con_las_columnas_de_la_plantilla(client, con_movimientos):
    r = _exportar(client, con_movimientos["token"])
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert r.headers["content-disposition"] == 'attachment; filename="kontadoria-movimientos-todos.xlsx"'
    assert r.headers["cache-control"] == "no-store"
    assert _xlsx(r.content) == [
        list(ENCABEZADO),
        ["03-10-2026", 250000, "ingreso", "Ventas", "", "Ventas del día"],
        ["15-10-2026", 12990, "gasto", "Insumos", "El Trébol", "Papas y aceite"],
        ["25-10-2026", 3500, "gasto", "Insumos", "", "Del empleado"],
        # Sin descripción: va el proveedor, porque la plantilla la exige al volver a importar
        ["02-11-2026", 8000, "gasto", "Insumos", "Ferretería Sur", "Ferretería Sur"],
    ]


def test_csv_con_punto_y_coma_y_bom(client, con_movimientos):
    r = _exportar(client, con_movimientos["token"], formato="csv")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "text/csv; charset=utf-8"
    assert r.headers["content-disposition"].endswith('.csv"')
    filas = _csv(r.content)
    assert filas[0] == list(ENCABEZADO)
    assert filas[1] == ["03-10-2026", "250000", "ingreso", "Ventas", "", "Ventas del día"]
    assert len(filas) == 5


def test_respeta_los_filtros_del_listado(client, con_movimientos):
    t = con_movimientos["token"]
    r = _exportar(client, t, tipo="gasto", desde="2026-10-01", hasta="2026-10-31")
    assert r.headers["content-disposition"] == 'attachment; filename="kontadoria-movimientos-2026-10-01_al_2026-10-31.xlsx"'
    assert [f[0] for f in _xlsx(r.content)[1:]] == ["15-10-2026", "25-10-2026"]

    r = _exportar(client, t, categoria_id=con_movimientos["insumos"], usuario_id=con_movimientos["empleado"]["usuario_id"])
    assert [f[5] for f in _xlsx(r.content)[1:]] == ["Del empleado"]

    r = _exportar(client, t, desde="2027-01-01")
    assert r.headers["content-disposition"] == 'attachment; filename="kontadoria-movimientos-desde_2027-01-01.xlsx"'
    assert _xlsx(r.content) == [list(ENCABEZADO)]  # sin filas: solo el encabezado


def test_contador_exporta_y_empleado_no(client, con_movimientos):
    r = _exportar(client, con_movimientos["contador"]["token"], formato="csv")
    assert r.status_code == 200 and len(_csv(r.content)) == 5
    r = _exportar(client, con_movimientos["empleado"]["token"])
    assert r.status_code == 403
    assert r.json()["detail"]["codigo"] == "rol_sin_permiso"


def test_no_incluye_movimientos_de_otra_empresa(client, con_movimientos):
    otra = registrar_empresa(client, "Otra empresa")
    _mov(client, otra["token"], categoria_id=_categoria(client, otra["token"], "Insumos"), descripcion="De la otra")
    assert len(_xlsx(_exportar(client, otra["token"]).content)) == 2
    assert "De la otra" not in str(_xlsx(_exportar(client, con_movimientos["token"]).content))


def test_rango_y_formato_invalidos(client, empresa):
    r = _exportar(client, empresa["token"], desde="2026-11-01", hasta="2026-10-01")
    assert r.status_code == 422
    assert r.json()["detail"]["codigo"] == "rango_invalido"
    assert _exportar(client, empresa["token"], formato="pdf").status_code == 422


def test_textos_especiales(client, empresa):
    """Comillas, ";" y saltos de línea quedan en una celda; lo que parece fórmula no se ejecuta."""
    t = empresa["token"]
    insumos = _categoria(client, t, "Insumos")
    _mov(client, t, categoria_id=insumos, proveedor='Bazar "La Esquina"; sucursal 2', descripcion="=HYPERLINK(\"http://x\")")
    _mov(client, t, fecha="2026-10-11", categoria_id=insumos, descripcion="Dos\nlíneas <&>")

    texto = _exportar(client, t, formato="csv").content.decode("utf-8-sig")
    assert '"Bazar ""La Esquina""; sucursal 2"' in texto
    assert ';"\'=HYPERLINK(""http://x"")"' in texto  # con ' delante: Excel lo muestra como texto
    assert '"Dos\nlíneas <&>"' in texto

    filas = _xlsx(_exportar(client, t).content)
    assert filas[1][4] == 'Bazar "La Esquina"; sucursal 2'
    assert filas[1][5] == '=HYPERLINK("http://x")'  # en el XLSX es texto (inlineStr), no fórmula
    assert filas[2][5] == "Dos\nlíneas <&>"


def test_busqueda_como_en_la_pantalla(client, con_movimientos):
    """q busca en descripción, proveedor y categoría, sin importar tildes ni mayúsculas."""
    t = con_movimientos["token"]
    descripciones = lambda **p: [f[5] for f in _xlsx(_exportar(client, t, **p).content)[1:]]  # noqa: E731
    assert descripciones(q="ACEITE") == ["Papas y aceite"]
    assert descripciones(q="trebol") == ["Papas y aceite"]  # proveedor "El Trébol"
    assert descripciones(q="ventas") == ["Ventas del día"]  # descripción y categoría
    assert descripciones(q="insumos", usuario_id=con_movimientos["empleado"]["usuario_id"]) == ["Del empleado"]
    assert descripciones(q="  ") == descripciones()  # vacía = sin búsqueda


def test_busqueda_con_comodines_de_sql(client, empresa):
    """%, _ y [ se buscan como texto, no como comodines de LIKE."""
    t = empresa["token"]
    insumos = _categoria(client, t, "Insumos")
    _mov(client, t, categoria_id=insumos, descripcion="Descuento 10% socio")
    _mov(client, t, categoria_id=insumos, descripcion="Descuento 10 socio")
    _mov(client, t, categoria_id=insumos, descripcion="Código A_B [lote]")
    descripciones = lambda q: [f[5] for f in _xlsx(_exportar(client, t, q=q).content)[1:]]  # noqa: E731
    assert descripciones("10%") == ["Descuento 10% socio"]
    assert descripciones("a_b") == ["Código A_B [lote]"]
    assert descripciones("[lote]") == ["Código A_B [lote]"]
    assert descripciones("%") == ["Descuento 10% socio"]
