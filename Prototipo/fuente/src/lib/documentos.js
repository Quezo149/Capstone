// PROTOTIPO: documentos de ejemplo y lectura de la IA (HU08/HU09).
// En la app real esto lo hace POST /documentos/extraer: guarda el archivo en Blob Storage y lo
// manda a Azure AI Document Intelligence.
// - Ejemplos: fotos reales (public/ejemplos/) y lo que Document Intelligence leyó de verdad en
//   ellas (data/ejemplos-lectura.json, generado con backend/scripts/probar_lectura.py, es-CL).
// - Historial sembrado: boletas y facturas dibujadas en SVG, con comercios y RUT inventados.
import { leerDb } from './proto'
import { hoyISO } from './format'
import LECTURAS from '../data/ejemplos-lectura.json'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const pesos = (n) => '$' + Math.round(n).toLocaleString('es-CL')
const fechaCl = (iso) => iso.split('-').reverse().join('-')
// Número estable a partir de un texto: folios y RUT que no cambian entre recargas
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

function rutDe(texto) {
  const cuerpo = 76_000_000 + (hash(texto) % 999_999)
  let suma = 0
  let mul = 2
  for (const d of String(cuerpo).split('').reverse()) {
    suma += +d * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const dv = 11 - (suma % 11)
  return `${cuerpo.toLocaleString('es-CL')}-${dv === 11 ? 0 : dv === 10 ? 'K' : dv}`
}

export function diasAtras(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Cajas que marca la IA sobre el documento (vista "Lo que leyó la IA")
function caja([x, y, w, h], etiqueta) {
  return `<g class="ia-box"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="rgba(245,197,53,.28)" stroke="#d9a800" stroke-width="2"/>
  <rect x="${x}" y="${y - 17}" width="${etiqueta.length * 6.6 + 12}" height="16" rx="3" fill="#0b2620"/>
  <text x="${x + 6}" y="${y - 5}" font-family="Manrope,Arial,sans-serif" font-size="10.5" font-weight="700" fill="#f5c535">${esc(etiqueta)}</text></g>`
}

/** Boleta térmica fotografiada sobre un mesón. */
export function svgBoleta(d, { resaltar = false, borrosa = false } = {}) {
  const items = d.items?.length ? d.items : [[d.descripcion ?? 'Compra', d.total]]
  const folio = 100000 + (hash(d.comercio + d.fecha) % 899999)
  const W = 300
  let y = 40
  const L = []
  const t = (txt, { x = W / 2, size = 12, bold = false, anchor = 'middle' } = {}) =>
    L.push(`<text x="${x}" y="${y}" font-size="${size}" ${bold ? 'font-weight="700"' : ''} text-anchor="${anchor}">${esc(txt)}</text>`)
  const cajas = {}
  cajas.proveedor = [14, y - 15, W - 28, 20]
  t(d.comercio.toUpperCase(), { size: 14, bold: true })
  y += 17
  t(`R.U.T.: ${rutDe(d.comercio)}`, { size: 11 })
  y += 15
  t(d.giro ?? 'Comercio al por menor', { size: 10 })
  y += 26
  L.push(`<rect x="40" y="${y - 16}" width="${W - 80}" height="40" fill="none" stroke="#222" stroke-width="1.4"/>`)
  t('BOLETA ELECTRÓNICA', { size: 12, bold: true })
  y += 17
  t(`N° ${folio}`, { size: 12, bold: true })
  y += 34
  cajas.fecha = [14, y - 14, 170, 19]
  t(`FECHA: ${fechaCl(d.fecha)}  ${String(9 + (folio % 10)).padStart(2, '0')}:${String(folio % 60).padStart(2, '0')}`, { x: 18, anchor: 'start', size: 11 })
  y += 16
  t(`CAJA 0${(folio % 4) + 1}  CAJERO: ${(folio % 90) + 10}`, { x: 18, anchor: 'start', size: 11 })
  y += 12
  L.push(`<line x1="14" x2="${W - 14}" y1="${y}" y2="${y}" stroke="#444" stroke-dasharray="3 3"/>`)
  y += 20
  for (const [desc, monto] of items) {
    t(desc.toUpperCase().slice(0, 24), { x: 18, anchor: 'start', size: 11 })
    t(pesos(monto), { x: W - 18, anchor: 'end', size: 11 })
    y += 17
  }
  L.push(`<line x1="14" x2="${W - 14}" y1="${y - 4}" y2="${y - 4}" stroke="#444" stroke-dasharray="3 3"/>`)
  y += 18
  cajas.monto = [14, y - 17, W - 28, 24]
  t('TOTAL', { x: 18, anchor: 'start', size: 15, bold: true })
  t(pesos(d.total), { x: W - 18, anchor: 'end', size: 15, bold: true })
  y += 18
  t(`El IVA de esta boleta es: ${pesos(d.total - Math.round(d.total / 1.19))}`, { size: 9.5 })
  y += 26
  // Timbre electrónico (PDF417 de mentira)
  const barras = []
  for (let i = 0; i < 46; i++) {
    for (let j = 0; j < 6; j++) {
      if ((hash(`${folio}${i}${j}`) & 3) !== 0) barras.push(`<rect x="${40 + i * 4.8}" y="${y + j * 8}" width="${3 + (i % 3)}" height="7"/>`)
    }
  }
  L.push(`<g fill="#222">${barras.join('')}</g>`)
  y += 62
  t('Timbre Electrónico SII', { size: 9.5 })
  y += 13
  t('Verifique documento: www.sii.cl', { size: 9.5 })
  const H = y + 24
  // Borde inferior en zigzag, como papel cortado
  const zig = Array.from({ length: 31 }, (_, i) => `${i * 10},${H + (i % 2 ? 6 : 0)}`).join(' ')
  const papel = `<polygon points="0,0 ${W},0 ${W},${H} ${zig.split(' ').reverse().join(' ')}" fill="#fbfaf6"/>`
  const VW = 380
  const VH = H + 90
  const giro = borrosa ? 9 : -2.2
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}">
<defs>
  <linearGradient id="mesa" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8d6e52"/><stop offset="1" stop-color="#6b5038"/></linearGradient>
  <filter id="sombra" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="8" stdDeviation="9" flood-opacity=".35"/></filter>
  <filter id="mov"><feGaussianBlur stdDeviation="${borrosa ? 4.2 : 0}"/></filter>
  <linearGradient id="luz" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
</defs>
<rect width="${VW}" height="${VH}" fill="url(#mesa)"/>
<g opacity=".18" stroke="#3b2a1b">${Array.from({ length: 12 }, (_, i) => `<path d="M0 ${i * 70 + 20} C ${VW / 3} ${i * 70 + 5}, ${(2 * VW) / 3} ${i * 70 + 40}, ${VW} ${i * 70 + 18}" fill="none"/>`).join('')}</g>
<g transform="translate(40 40) rotate(${giro} ${W / 2} ${H / 2})" filter="url(#mov)">
  <g filter="url(#sombra)">${papel}</g>
  <g font-family="'IBM Plex Mono','Courier New',monospace" fill="#1d1d1d">${L.join('')}</g>
  <rect width="${W}" height="${H}" fill="url(#luz)"/>
  ${resaltar ? Object.entries(cajas).map(([k, c]) => caja(c, { proveedor: 'Proveedor', fecha: 'Fecha', monto: 'Total' }[k])).join('') : ''}
</g>
${borrosa ? `<rect width="${VW}" height="${VH}" fill="#000" opacity=".28"/>` : ''}
</svg>`,
  }
}

/** Factura electrónica en PDF (vista de la primera página). */
export function svgFactura(d, { resaltar = false } = {}) {
  const folio = 2000 + (hash(d.emisor + d.fecha) % 7999)
  const neto = Math.round(d.total / 1.19)
  const iva = d.total - neto
  const items = d.items?.length ? d.items : [[d.descripcion ?? 'Servicios', 1, neto]]
  const empresa = leerDb().empresa
  const W = 595
  const H = 700
  const filas = items
    .map(
      ([desc, cant, precio], i) => `
    <text x="40" y="${352 + i * 22}">${esc(desc)}</text>
    <text x="370" y="${352 + i * 22}" text-anchor="end">${cant}</text>
    <text x="460" y="${352 + i * 22}" text-anchor="end">${pesos(precio / cant)}</text>
    <text x="555" y="${352 + i * 22}" text-anchor="end">${pesos(precio)}</text>`,
    )
    .join('')
  const cajas = {
    proveedor: [36, 46, 290, 26],
    fecha: [36, 196, 200, 20],
    monto: [380, 556, 180, 26],
  }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#fff"/>
<g font-family="Arial,Helvetica,sans-serif" fill="#1f2a2a" font-size="11">
  <text x="40" y="66" font-size="19" font-weight="700">${esc(d.emisor)}</text>
  <text x="40" y="86">${esc(d.giro ?? 'Venta al por mayor de alimentos')}</text>
  <text x="40" y="102">Camino Interior 1450, Temuco</text>
  <text x="40" y="118">contacto@ejemplo.cl · +56 45 200 0000</text>
  <rect x="360" y="36" width="200" height="96" fill="none" stroke="#c0262d" stroke-width="2.5"/>
  <g fill="#c0262d" font-weight="700" text-anchor="middle">
    <text x="460" y="64" font-size="13">R.U.T.: ${rutDe(d.emisor)}</text>
    <text x="460" y="88" font-size="13">FACTURA ELECTRÓNICA</text>
    <text x="460" y="112" font-size="13">N° ${folio}</text>
  </g>
  <text x="460" y="150" text-anchor="middle" fill="#c0262d" font-weight="700">S.I.I. - TEMUCO</text>
  <line x1="40" x2="555" y1="172" y2="172" stroke="#d5dcda"/>
  <text x="40" y="211" font-weight="700">Fecha emisión: ${fechaCl(d.fecha)}</text>
  <text x="40" y="236">Señor(es): ${esc(empresa.nombre)}</text>
  <text x="40" y="254">R.U.T.: ${esc(empresa.rut)}</text>
  <text x="40" y="272">Giro: ${esc(empresa.giro || '—')}</text>
  <text x="330" y="236">Condición de pago: 30 días</text>
  <text x="330" y="254">Vendedor: Ventas Sur</text>
  <rect x="36" y="314" width="523" height="22" fill="#eef2f1"/>
  <g font-weight="700"><text x="40" y="329">Descripción</text><text x="370" y="329" text-anchor="end">Cant.</text><text x="460" y="329" text-anchor="end">Precio</text><text x="555" y="329" text-anchor="end">Total</text></g>
  ${filas}
  <line x1="36" x2="559" y1="520" y2="520" stroke="#d5dcda"/>
  <text x="460" y="540" text-anchor="end">Monto neto</text><text x="555" y="540" text-anchor="end">${pesos(neto)}</text>
  <text x="460" y="574" text-anchor="end" font-size="14" font-weight="700">TOTAL</text><text x="555" y="574" text-anchor="end" font-size="14" font-weight="700">${pesos(d.total)}</text>
  <text x="460" y="557" text-anchor="end">IVA 19%</text><text x="555" y="557" text-anchor="end">${pesos(iva)}</text>
  <g fill="#222">${Array.from({ length: 40 }, (_, i) => Array.from({ length: 5 }, (_, j) => ((hash(`${folio}${i}${j}`) & 3) ? `<rect x="${40 + i * 5}" y="${560 + j * 9}" width="3.5" height="8"/>` : '')).join('')).join('')}</g>
  <text x="140" y="622" text-anchor="middle" font-size="9">Timbre Electrónico SII · Res. 80 de 2014</text>
  <text x="297" y="680" text-anchor="middle" font-size="9" fill="#7b8a86">Página 1 de 1</text>
</g>
${resaltar ? Object.entries(cajas).map(([k, c]) => caja(c, { proveedor: 'Proveedor', fecha: 'Fecha', monto: 'Total' }[k])).join('') : ''}
</svg>`,
  }
}

const aUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/**
 * URL para mostrar el documento de un movimiento.
 * documento = { plantilla: 'boleta'|'factura', datos } | { imagen: dataURL } | { pdf: nombre }
 *           | { foto: 'ejemplos/x.jpg', cajas } (foto real de ejemplo, con dónde leyó cada dato)
 * En la app real: GET /movimientos/{id}/documento devuelve un link temporal (SAS) a Blob Storage.
 */
export function urlDocumento(doc, opciones) {
  if (!doc) return null
  if (doc.imagen) return doc.imagen
  if (doc.foto) return doc.foto
  if (doc.plantilla === 'boleta') return aUrl(svgBoleta(doc.datos, { borrosa: doc.borrosa, ...opciones }).svg)
  if (doc.plantilla === 'factura') return aUrl(svgFactura(doc.datos, opciones).svg)
  return null
}

// ---------- Ejemplos: fotos reales y lo que leyó Document Intelligence ----------
const FICHAS = [
  ['farmacia', 'Boleta de farmacia', 'Boleta electrónica de la caja'],
  ['lider', 'Boleta de supermercado', 'Líder, con el voucher Getnet abajo'],
  ['pronto', 'Comprobante de Pronto', 'Dice "comprobante de venta", no "boleta"'],
  ['transbank', 'Voucher Transbank', 'Máquina POS "válido como boleta"'],
  ['voucher-mp', 'Voucher Mercado Pago', 'Pago con Pluxee: no es boleta'],
  ['xsmarket', 'Boleta de XS Market', 'Misma compra que el voucher de Mercado Pago'],
  ['movida', 'Foto movida', 'Para ver qué pasa si falla'],
]

export const EJEMPLOS = FICHAS.map(([id, titulo, detalle]) => {
  const l = LECTURAS[id]
  return {
    id,
    titulo,
    detalle,
    origen: 'foto',
    falla: !l.ok,
    lectura: l,
    documento: () => ({ foto: `ejemplos/${id}.jpg`, cajas: l.cajas }),
  }
})

export const urlEjemplo = (ej) => `ejemplos/${ej.id}.jpg`

// Mismos umbrales que probar_lectura.py: ≥ 0,85 alta; menos que eso, a revisar
const nivel = (c) => (c == null ? 'media' : c >= 0.85 ? 'alta' : 'media')

/**
 * Confianza que ve el usuario por campo, con el motivo cuando pide revisar.
 * No basta con la confianza del modelo: en XS Market leyó "market" con 99 %.
 */
function evaluar(l) {
  const confianza = { monto: nivel(l.conf_monto), fecha: nivel(l.conf_fecha) }
  const motivos = {}
  if (l.proveedor_respaldo) {
    confianza.proveedor = 'media'
    motivos.proveedor = 'La IA no encontró el nombre del comercio: lo tomamos de la razón social o la web impresa.'
  } else if (l.proveedor && l.proveedor.trim().split(/\s+/).length < 2) {
    confianza.proveedor = 'media'
    motivos.proveedor = 'El nombre parece incompleto (una sola palabra, a veces es parte del logo).'
  } else confianza.proveedor = nivel(l.conf_proveedor)
  if (l.confianza_tipo === 'alta') confianza.tipo_documento = 'alta'
  else {
    confianza.tipo_documento = 'media'
    motivos.tipo_documento =
      l.tipo_documento === 'otro'
        ? 'No dice "boleta" ni "factura": parece un comprobante de pago. Si tienes la boleta, carga esa.'
        : `Dice "${l.evidencia_tipo?.toLowerCase()}" y no "boleta electrónica": confirma que sea una boleta.`
  }
  if (confianza.monto === 'media') motivos.monto = 'El total se ve poco claro en la foto.'
  confianza.descripcion = 'media'
  motivos.descripcion = 'Armada con los productos de la boleta: suelen venir abreviados.'
  return { confianza, motivos }
}

const sinTildes = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

// Pistas por tipo de comercio, cuando el proveedor es nuevo para la empresa
const PISTAS = [
  [/bencina|combustible|gasolina|diesel|estacion de servicio/, 'c-transporte'],
  [/supermercado|lider|mayorista|distribuidora|avicola|carniceria|verduleria|market/, 'c-insumos'],
  [/electric|agua|gas |gas$|internet|telefon/, 'c-servicios'],
  [/ferreteria|tecnico|repuesto/, 'c-mantencion'],
  [/imprenta|publicidad/, 'c-marketing'],
]

/**
 * Categoría sugerida (decisión a): por historial, sin un modelo extra.
 * 1) La que la empresa usó la última vez con ese mismo proveedor: primero por RUT, que no
 *    cambia aunque cada documento escriba el nombre distinto ("Pronto" / "Comercial y
 *    Servicios Roca Ltda"); si no hay RUT, por nombre.
 * 2) Si el proveedor es nuevo, una pista por el tipo de comercio.
 */
export function sugerirCategoria(proveedor, texto = '', rut = null) {
  const db = leerDb()
  const p = sinTildes(proveedor)
  const mismo = (m) => (rut && m.proveedor_rut ? m.proveedor_rut === rut : sinTildes(m.proveedor) === p)
  const previos = db.movimientos
    .filter((m) => !m.eliminado && m.tipo === 'gasto' && mismo(m))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
  if (previos.length) {
    const c = db.categorias.find((x) => x.id === previos[0].categoria_id)
    const quien = rut && previos[0].proveedor_rut === rut ? `del RUT ${formatearRut(rut)}` : `de ${proveedor}`
    if (c) return { id: c.id, motivo: `La última vez que registraste algo ${quien} usaste ${c.nombre}.`, fuente: 'historial' }
  }
  const t = sinTildes(`${proveedor} ${texto}`)
  for (const [re, id] of PISTAS) {
    const c = db.categorias.find((x) => x.id === id)
    if (re.test(t) && c) return { id, motivo: `Por el tipo de comercio que aparece en el documento.`, fuente: 'pista' }
  }
  return null
}

export function formatearRut(rut) {
  if (!rut) return ''
  const [cuerpo, dv] = rut.split('-')
  return `${Number(cuerpo).toLocaleString('es-CL')}-${dv}`
}

/**
 * ¿Ya hay un gasto de esta misma compra? Pasa cuando se sube el voucher de la máquina POS y
 * también la boleta (XS Market + Mercado Pago: mismo RUT, monto y día).
 * Mismo monto y fecha, y mismo RUT o nombre de proveedor.
 */
export function buscarDuplicado({ monto, fecha, proveedor, proveedor_rut }) {
  if (!monto || !fecha) return null
  const p = sinTildes(proveedor)
  return (
    leerDb().movimientos.find(
      (m) =>
        !m.eliminado &&
        m.tipo === 'gasto' &&
        m.monto === monto &&
        m.fecha === fecha &&
        ((proveedor_rut && m.proveedor_rut === proveedor_rut) || (p && sinTildes(m.proveedor) === p)),
    ) ?? null
  )
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

// Achica la foto en el navegador antes de subirla. 1600 px y no menos: a 1100 px Document
// Intelligence empezó a leer mal (prueba del 23-10: "CRNALES" en vez de "CANALES").
async function comprimir(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = mal
      i.src = url
    })
    const k = Math.min(1, 1600 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * k)
    c.height = Math.round(img.height * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.8)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Simula POST /documentos/extraer. `fuente` = { ejemplo } o { archivo: File }.
 * onPaso('subiendo' | 'leyendo' | 'categoria') para el indicador de avance.
 * Devuelve { ok, documento, origen, datos, confianza, motivos, sugerencia, duplicado, simulado }
 * o { ok: false, motivo }.
 */
export async function extraer(fuente, onPaso = () => {}) {
  onPaso('subiendo')
  let documento
  let origen
  let ej = null
  if (fuente.ejemplo) {
    ej = fuente.ejemplo
    documento = ej.documento()
    origen = ej.origen
  } else {
    const f = fuente.archivo
    origen = f.type === 'application/pdf' ? 'pdf' : 'foto'
    documento = origen === 'pdf' ? { pdf: f.name } : { imagen: await comprimir(f).catch(() => null) }
  }
  await espera(800)
  onPaso('leyendo')
  await espera(1500)
  if (ej?.falla) return { ok: false, documento, origen, motivo: 'La foto salió movida y no se alcanzan a leer el total ni la fecha.' }
  onPaso('categoria')
  await espera(700)

  let datos
  let confianza
  let motivos = {}
  let simulado = false
  if (ej) {
    const l = ej.lectura
    datos = {
      tipo: 'gasto',
      monto: l.monto,
      fecha: l.fecha,
      proveedor: l.proveedor ?? '',
      proveedor_rut: l.rut,
      descripcion: (l.items ?? []).slice(0, 2).join(', ').slice(0, 120),
      tipo_documento: l.tipo_documento,
    }
    ;({ confianza, motivos } = evaluar(l))
    if (!datos.descripcion) delete confianza.descripcion
  } else {
    // Archivo propio: el prototipo no lee de verdad, propone datos de muestra
    simulado = true
    datos = {
      tipo: 'gasto',
      monto: origen === 'pdf' ? 89250 : 18990,
      fecha: hoyISO(),
      proveedor: origen === 'pdf' ? 'Distribuidora Avícola del Sur' : 'Supermercado El Trébol',
      descripcion: origen === 'pdf' ? 'Compra de insumos' : 'Compra en supermercado',
      tipo_documento: origen === 'pdf' ? 'factura' : 'boleta',
    }
    confianza = { proveedor: 'media', fecha: 'alta', monto: 'alta', tipo_documento: 'alta' }
  }
  const sugerencia = sugerirCategoria(datos.proveedor, datos.descripcion, datos.proveedor_rut)
  return { ok: true, documento, origen, datos, confianza, motivos, sugerencia, duplicado: buscarDuplicado(datos), simulado }
}
