"""
Archivos de exportación de movimientos (HU16 — KONTADORIA-79): XLSX y CSV con las columnas de la
plantilla de importación (Prototipo/fuente/src/lib/importacion.js → COLUMNAS), para que el archivo
se pueda volver a importar tal cual (KONTADORIA-81).

Sin dependencias: el XLSX es un ZIP con 6 XML, como el del prototipo (src/lib/exportar.js).
No toca la base de datos: recibe las filas ya leídas.
"""

import datetime as dt
import io
import zipfile
from xml.sax.saxutils import escape

ENCABEZADO = ("fecha", "monto", "tipo", "categoría", "proveedor", "descripción")


def fila(fecha: dt.date, monto: int, tipo: str, categoria: str, proveedor: str | None, descripcion: str | None) -> list:
    """
    [fecha DD-MM-AAAA, monto (número), tipo, categoría, proveedor, descripción].

    La plantilla exige descripción y el registro manual no: sin ella, se usa el proveedor o la
    categoría, igual que la importación hace con una planilla propia. Así nada vuelve con error.
    """
    return [f"{fecha:%d-%m-%Y}", int(monto), tipo, categoria, proveedor or "", descripcion or proveedor or categoria]


# ---------- CSV: ";" y BOM, como lo abre Excel en Chile ----------

# Un texto que empieza con estos caracteres Excel lo ejecutaría como fórmula: se antepone '
_FORMULA = ("=", "+", "-", "@", "\t", "\r", "＝", "＋", "－", "＠")


def _celda_csv(v) -> str:
    if isinstance(v, int):
        return str(v)
    s = str(v)
    if s.startswith(_FORMULA):
        s = "'" + s
    if any(c in s for c in ';"\n\r'):
        s = '"' + s.replace('"', '""') + '"'
    return s


def csv_bytes(filas: list[list]) -> bytes:
    texto = "".join(";".join(_celda_csv(v) for v in f) + "\r\n" for f in [list(ENCABEZADO), *filas])
    return ("﻿" + texto).encode("utf-8")


# ---------- XLSX mínimo ----------

_CONTROL = {c: None for c in (*range(0x00, 0x09), 0x0B, 0x0C, *range(0x0E, 0x20))}  # el XML no los admite


def _xml(s: str) -> str:
    return escape(str(s).translate(_CONTROL), {'"': "&quot;"})


def _hoja(filas: list[list]) -> str:
    anchos = (12, 14, 10, 22, 30, 40)

    def fila_xml(celdas, r: int, estilo: int | None = None) -> str:
        partes = []
        for i, v in enumerate(celdas):
            ref = f"{'ABCDEF'[i]}{r}"
            if isinstance(v, int):
                partes.append(f'<c r="{ref}" s="2"><v>{v}</v></c>')
            else:
                s = f' s="{estilo}"' if estilo else ""
                partes.append(f'<c r="{ref}" t="inlineStr"{s}><is><t xml:space="preserve">{_xml(v)}</t></is></c>')
        return f'<row r="{r}">{"".join(partes)}</row>'

    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(anchos))
    datos = fila_xml(ENCABEZADO, 1, 1) + "".join(fila_xml(f, i + 2) for i, f in enumerate(filas))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        f"<cols>{cols}</cols><sheetData>{datos}</sheetData>"
        f'<autoFilter ref="A1:F{len(filas) + 1}"/></worksheet>'
    )


_FIJOS = {
    "[Content_Types].xml": (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
    ),
    "_rels/.rels": (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    ),
    "xl/workbook.xml": (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Movimientos" sheetId="1" r:id="rId1"/></sheets>'
        '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Movimientos!$A$1:$F$1</definedName></definedNames></workbook>'
    ),
    "xl/_rels/workbook.xml.rels": (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    ),
    # Estilos: 0 normal, 1 encabezado en negrita, 2 número con separador de miles (formato 3 = #,##0)
    "xl/styles.xml": (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>'
    ),
}


def xlsx_bytes(filas: list[list]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for nombre, contenido in {**_FIJOS, "xl/worksheets/sheet1.xml": _hoja(filas)}.items():
            z.writestr(nombre, contenido)
    return buf.getvalue()
