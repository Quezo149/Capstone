// PROTOTIPO Sprint 5 — HU16 (KONTADORIA-79/80): exportar los movimientos filtrados.
// Mismas columnas que la plantilla de importación (lib/importacion.js → COLUMNAS), para que el
// archivo se pueda volver a importar tal cual (KONTADORIA-81). En la app real lo arma el backend
// (GET /movimientos/exportar con los mismos filtros); aquí se genera en el navegador.
import { fechaCorta } from './format'
import { COLUMNAS } from './importacion'

const ENCABEZADO = COLUMNAS.map((c) => c.nombre)

// [fecha DD-MM-AAAA, monto (número), tipo, categoría, proveedor, descripción]
export const filasExportables = (movs, categoria) =>
  movs.map((m) => [fechaCorta(m.fecha), m.monto, m.tipo, categoria(m.categoria_id).nombre, m.proveedor ?? '', m.descripcion ?? ''])

function bajar(nombre, partes, tipo) {
  const url = URL.createObjectURL(new Blob(partes, { type: tipo }))
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------- CSV: ";" y BOM, como lo abre Excel en Chile ----------
// Un texto que empieza con = + - @ se antepone con ' para que Excel no lo ejecute como fórmula
const celdaCsv = (v) => {
  if (typeof v === 'number') return String(v)
  let s = String(v ?? '')
  if (/^[=+\-@\t\r＝＋－＠]/.test(s)) s = `'${s}`
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportarCsv(nombre, filas) {
  const texto = [ENCABEZADO, ...filas].map((f) => f.map(celdaCsv).join(';')).join('\r\n') + '\r\n'
  bajar(`${nombre}.csv`, ['﻿', texto], 'text/csv;charset=utf-8')
}

// ---------- XLSX mínimo: un ZIP sin comprimir con 6 XML ----------
const xml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caracteres de control que el XML no admite
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

const letra = (i) => String.fromCharCode(65 + i) // 6 columnas: A–F

function hoja(filas) {
  const anchos = [12, 14, 10, 22, 30, 40]
  const fila = (celdas, r, estilo) =>
    `<row r="${r}">${celdas
      .map((v, i) => {
        const ref = `${letra(i)}${r}`
        if (typeof v === 'number') return `<c r="${ref}" s="2"><v>${v}</v></c>`
        return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`
      })
      .join('')}</row>`
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${fila(ENCABEZADO, 1, 1)}${filas.map((f, i) => fila(f, i + 2)).join('')}</sheetData>` +
    `<autoFilter ref="A1:F${filas.length + 1}"/>` +
    '</worksheet>'
  )
}

const ARCHIVOS_FIJOS = {
  '[Content_Types].xml':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  '_rels/.rels':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Movimientos" sheetId="1" r:id="rId1"/></sheets>' +
    '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Movimientos!$A$1:$F$1</definedName></definedNames></workbook>',
  'xl/_rels/workbook.xml.rels':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  // Estilos: 0 normal, 1 encabezado en negrita, 2 número con separador de miles (formato 3 = #,##0)
  'xl/styles.xml':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
}

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes) => {
  let c = 0xffffffff
  for (const b of bytes) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ZIP "stored" (sin compresión): suficiente para Excel, Google Sheets y LibreOffice
function zip(archivos) {
  const enc = new TextEncoder()
  const partes = []
  const central = []
  let offset = 0
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const n = enc.encode(nombre)
    const datos = enc.encode(contenido)
    const crc = crc32(datos)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // nombres en UTF-8
    local.setUint32(14, crc, true)
    local.setUint32(18, datos.length, true)
    local.setUint32(22, datos.length, true)
    local.setUint16(26, n.length, true)
    partes.push(local, n, datos)
    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(8, 0x0800, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, datos.length, true)
    cd.setUint32(24, datos.length, true)
    cd.setUint16(28, n.length, true)
    cd.setUint32(42, offset, true)
    central.push(cd, n)
    offset += 30 + n.length + datos.length
  }
  const tamCentral = central.reduce((s, p) => s + p.byteLength, 0)
  const fin = new DataView(new ArrayBuffer(22))
  fin.setUint32(0, 0x06054b50, true)
  fin.setUint16(8, Object.keys(archivos).length, true)
  fin.setUint16(10, Object.keys(archivos).length, true)
  fin.setUint32(12, tamCentral, true)
  fin.setUint32(16, offset, true)
  return [...partes, ...central, fin]
}

export function xlsxBytes(filas) {
  return zip({ ...ARCHIVOS_FIJOS, 'xl/worksheets/sheet1.xml': hoja(filas) })
}

export function exportarXlsx(nombre, filas) {
  bajar(`${nombre}.xlsx`, xlsxBytes(filas), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}
