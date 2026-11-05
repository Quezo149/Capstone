// PROTOTIPO HU10–HU13 + mapeo de planillas propias: importación masiva desde CSV/XLSX.
// En la app real, leer y validar lo hace el backend (POST /importaciones/analizar, /validar y
// POST /importaciones). Aquí corre en el navegador con las MISMAS reglas, para probarlas antes de
// construirlas. Nada sale del navegador.
//
// Dos caminos:
//   1. La plantilla de KontadorIA (recomendada): se reconoce sola y no hay que configurar nada.
//   2. La planilla propia del usuario: se detecta el encabezado y las columnas por sinónimos, el
//      usuario confirma o corrige el mapeo una vez y queda guardado como "formato" de la empresa.
import { clp, fechaCorta, hoyISO, moverMes } from './format'

// Columnas fijas de la plantilla (HU10). `clave` = nombre normalizado que se busca en el encabezado.
export const COLUMNAS = [
  { clave: 'fecha', nombre: 'fecha', ayuda: 'DD-MM-AAAA', ejemplo: '05-10-2026', obligatoria: true },
  { clave: 'monto', nombre: 'monto', ayuda: 'Pesos, sin decimales', ejemplo: '12.990', obligatoria: true },
  { clave: 'tipo', nombre: 'tipo', ayuda: 'ingreso o gasto', ejemplo: 'gasto', obligatoria: true },
  { clave: 'categoria', nombre: 'categoría', ayuda: 'Una de tus categorías', ejemplo: 'Insumos', obligatoria: true },
  { clave: 'proveedor', nombre: 'proveedor', ayuda: 'Opcional', ejemplo: 'Supermercado El Trébol', obligatoria: false },
  { clave: 'descripcion', nombre: 'descripción', ayuda: 'Qué fue, en pocas palabras', ejemplo: 'Papas y aceite', obligatoria: true },
]

export const MAX_FILAS = 2000
export const MAX_MB = 2
const MAX_MONTO = 999_999_999_999 // igual que el formulario manual
const FILAS_BUSCAR_ENCABEZADO = 30

// "Categoría " → "categoria": sin tildes, sin mayúsculas, sin espacios de sobra
export const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

// "N° Documento (CLP)" → "n documento": para comparar encabezados
const limpiar = (s) =>
  normalizar(s)
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export const letraColumna = (i) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const vacia = (fila) => !fila || fila.every((c) => !String(c ?? '').trim())

// ---------------------------------------------------------------------------------------------
// Lectura de archivos
// ---------------------------------------------------------------------------------------------

// CSV como lo exporta Excel en Chile: separado por ";" (o ","), con comillas, UTF-8 o Windows-1252
export function leerCsv(texto) {
  texto = texto.replace(/^\uFEFF/, '')
  const primera = texto.split(/\r?\n/, 1)[0]
  const sep = (primera.match(/;/g) || []).length >= (primera.match(/,/g) || []).length ? ';' : ','
  const filas = []
  let fila = []
  let celda = ''
  let comillas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') {
        celda += '"'
        i++
      } else if (c === '"') comillas = false
      else celda += c
    } else if (c === '"') comillas = true
    else if (c === sep) {
      fila.push(celda)
      celda = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      fila.push(celda)
      filas.push(fila)
      fila = []
      celda = ''
    } else celda += c
  }
  if (celda || fila.length) {
    fila.push(celda)
    filas.push(fila)
  }
  return filas
}

async function textoDe(archivo) {
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes) // Excel en Windows guarda así los CSV
  }
}

// XLSX mínimo: un .xlsx es un ZIP con XML adentro. Se leen las hojas con las APIs del navegador
// (DecompressionStream), sin librerías. En el backend se usará openpyxl.
async function leerZip(buffer) {
  const v = new DataView(buffer)
  let fin = buffer.byteLength - 22
  while (fin >= 0 && v.getUint32(fin, true) !== 0x06054b50) fin--
  if (fin < 0) throw new Error('zip')
  const total = v.getUint16(fin + 10, true)
  let p = v.getUint32(fin + 16, true)
  const archivos = {}
  const dec = new TextDecoder()
  for (let i = 0; i < total; i++) {
    const metodo = v.getUint16(p + 10, true)
    const tam = v.getUint32(p + 20, true)
    const largoNombre = v.getUint16(p + 28, true)
    const largoExtra = v.getUint16(p + 30, true)
    const largoComentario = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const nombre = dec.decode(new Uint8Array(buffer, p + 46, largoNombre))
    archivos[nombre] = { metodo, tam, local }
    p += 46 + largoNombre + largoExtra + largoComentario
  }
  return async (nombre) => {
    const a = archivos[nombre]
    if (!a) return null
    const inicio = a.local + 30 + v.getUint16(a.local + 26, true) + v.getUint16(a.local + 28, true)
    const datos = new Uint8Array(buffer, inicio, a.tam)
    if (a.metodo === 0) return dec.decode(datos)
    const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Response(flujo).text()
  }
}

// "AB12" → 27. Sin referencia (algunos exportadores no la escriben) se usa la posición.
const columnaDe = (ref, pos) => (ref ? [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1 : pos)

async function leerXlsx(archivo) {
  const leer = await leerZip(await archivo.arrayBuffer())
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml')
  const libro = xml(await leer('xl/workbook.xml'))
  const rels = xml(await leer('xl/_rels/workbook.xml.rels'))
  const compartidosXml = await leer('xl/sharedStrings.xml')
  // Solo los <t> del texto, no los de la guía fonética (<rPh>)
  const compartidos = compartidosXml
    ? [...xml(compartidosXml).getElementsByTagName('si')].map((si) =>
        [...si.getElementsByTagName('t')]
          .filter((t) => t.parentNode?.nodeName !== 'rPh')
          .map((t) => t.textContent)
          .join(''),
      )
    : []
  const hojas = []
  for (const hoja of libro.getElementsByTagName('sheet')) {
    if (['hidden', 'veryHidden'].includes(hoja.getAttribute('state'))) continue
    const rid = hoja.getAttribute('r:id') ?? hoja.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const destino = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target')
    if (!destino) continue
    const ruta = destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`
    const contenido = await leer(ruta)
    if (!contenido) continue
    const filas = []
    let numFila = 0
    for (const row of xml(contenido).getElementsByTagName('row')) {
      numFila = row.getAttribute('r') ? +row.getAttribute('r') : numFila + 1
      const fila = []
      let col = -1
      for (const c of row.getElementsByTagName('c')) {
        col = columnaDe(c.getAttribute('r'), col + 1)
        const t = c.getAttribute('t')
        const valor = c.getElementsByTagName('v')[0]?.textContent ?? ''
        let texto = valor
        if (t === 's') texto = compartidos[+valor] ?? ''
        else if (t === 'inlineStr') texto = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('')
        fila[col] = texto
      }
      filas[numFila - 1] = Array.from(fila, (x) => x ?? '')
    }
    hojas.push({ nombre: hoja.getAttribute('name') ?? `Hoja ${hojas.length + 1}`, filas: Array.from(filas, (x) => x ?? []) })
  }
  if (!hojas.length) throw new Error('sin hojas')
  return hojas
}

// Devuelve { tipo: 'csv'|'xlsx', hojas: [{ nombre, filas: string[][] }] }. Lanza Error con un mensaje para mostrar.
export async function leerArchivo(archivo) {
  const ext = archivo.name.split('.').pop().toLowerCase()
  if (!['csv', 'xlsx'].includes(ext)) throw new Error('Ese archivo no es una planilla CSV ni XLSX. Si es un .xls antiguo, guárdalo como .xlsx.')
  if (archivo.size > MAX_MB * 1024 * 1024) throw new Error(`La planilla pesa más de ${MAX_MB} MB.`)
  if (ext === 'csv') return { tipo: 'csv', hojas: [{ nombre: 'CSV', filas: leerCsv(await textoDe(archivo)) }] }
  try {
    return { tipo: 'xlsx', hojas: await leerXlsx(archivo) }
  } catch {
    throw new Error('No pudimos abrir este Excel. Guárdalo de nuevo como .xlsx (no .xls) y vuelve a subirlo.')
  }
}

// ---------------------------------------------------------------------------------------------
// Plantilla de KontadorIA (camino recomendado)
// ---------------------------------------------------------------------------------------------

// Columna que agrega el archivo de filas con error (descargarErrores): quien corrige ese archivo
// y lo vuelve a subir no tiene que borrarla. Se ignora en todos los caminos.
const COLUMNA_ERROR = 'error'

// ¿El encabezado es exactamente el de la plantilla (en cualquier orden)?
export function revisarEstructura(filas) {
  const idx = filas.findIndex((f) => !vacia(f))
  const encabezado = idx < 0 ? [] : filas[idx].map(normalizar)
  const faltan = COLUMNAS.filter((c) => !encabezado.includes(c.clave)).map((c) => c.nombre)
  const sobran = (idx < 0 ? [] : filas[idx]).filter(
    (h, i) => h && encabezado[i] !== COLUMNA_ERROR && !COLUMNAS.some((c) => c.clave === encabezado[i]),
  )
  return { ok: idx >= 0 && faltan.length === 0 && sobran.length === 0, faltan, sobran, encabezado: idx < 0 ? [] : filas[idx], fila: idx }
}

function mapeoPlantilla(estructura) {
  const enc = estructura.encabezado.map(normalizar)
  const col = (k) => enc.indexOf(k)
  return {
    plantilla: true,
    encabezado: estructura.fila,
    cols: { fecha: col('fecha'), monto: col('monto'), tipo: col('tipo'), cargo: -1, abono: -1, categoria: col('categoria'), proveedor: col('proveedor'), descripcion: col('descripcion') },
    modo: 'tipo',
    tipoFijo: 'gasto',
    catDefecto: { gasto: null, ingreso: null },
    catValores: {},
    fecha: 'dmy',
    monto: 'cl',
  }
}

// ---------------------------------------------------------------------------------------------
// Planillas propias: detectar encabezado y columnas
// ---------------------------------------------------------------------------------------------

// Campos que se pueden mapear, en el orden en que se muestran
export const CAMPOS = [
  { clave: 'fecha', nombre: 'Fecha', ayuda: 'Cuándo fue el movimiento' },
  { clave: 'descripcion', nombre: 'Descripción', ayuda: 'Glosa, detalle o concepto' },
  { clave: 'proveedor', nombre: 'Proveedor o cliente', ayuda: 'Opcional' },
  { clave: 'categoria', nombre: 'Categoría', ayuda: 'Ítem, cuenta o clasificación' },
  { clave: 'monto', nombre: 'Monto', ayuda: 'Valor o total' },
  { clave: 'tipo', nombre: 'Tipo', ayuda: 'Dice si es ingreso o gasto' },
  { clave: 'cargo', nombre: 'Gastos (cargos)', ayuda: 'Columna con lo que sale' },
  { clave: 'abono', nombre: 'Ingresos (abonos)', ayuda: 'Columna con lo que entra' },
]

// Nombres con que suelen venir las columnas (ya limpios: sin tildes ni signos)
const SINONIMOS = {
  fecha: ['fecha', 'fecha movimiento', 'fecha operacion', 'fecha emision', 'f emision', 'fecha documento', 'fecha pago', 'fecha contable', 'fecha transaccion', 'fecha compra', 'fecha venta', 'dia', 'date'],
  cargo: ['cargo', 'cargos', 'egreso', 'egresos', 'salida', 'salidas', 'gasto', 'gastos', 'debito', 'debitos', 'retiro', 'retiros', 'giros', 'monto cargo', 'cargos clp'],
  abono: ['abono', 'abonos', 'ingreso', 'ingresos', 'entrada', 'entradas', 'credito', 'creditos', 'deposito', 'depositos', 'monto abono', 'abonos clp'],
  tipo: ['tipo', 'tipo movimiento', 'tipo de movimiento', 'movimiento', 'ingreso gasto', 'ingreso o gasto', 'naturaleza', 'i e', 'e i', 'entrada salida'],
  categoria: ['categoria', 'item', 'cuenta', 'clasificacion', 'rubro', 'centro de costo', 'familia', 'tipo de gasto', 'tipo gasto', 'categoria gasto'],
  proveedor: ['proveedor', 'cliente', 'razon social', 'empresa', 'comercio', 'emisor', 'nombre', 'beneficiario', 'destinatario', 'proveedor cliente', 'cliente proveedor', 'local'],
  descripcion: ['descripcion', 'detalle', 'glosa', 'concepto', 'comentario', 'comentarios', 'observacion', 'observaciones', 'nota', 'notas', 'producto', 'motivo', 'descripcion movimiento'],
  monto: ['monto', 'valor', 'total', 'importe', 'monto total', 'total a pagar', 'precio', 'amount', 'valor total', 'monto clp', 'monto pesos', 'total pagado', 'pago'],
}
// Al buscar "contiene", primero lo más específico: "Total cargos" es un cargo, no un monto
const ORDEN_CONTIENE = ['cargo', 'abono', 'fecha', 'categoria', 'tipo', 'proveedor', 'descripcion', 'monto']

const contiene = (texto, sin) => (sin.includes(' ') ? ` ${texto} `.includes(` ${sin} `) : texto.split(' ').includes(sin))

export function campoDeEncabezado(h) {
  const c = limpiar(h)
  if (!c || c === COLUMNA_ERROR) return null
  for (const [campo, lista] of Object.entries(SINONIMOS)) if (lista.includes(c)) return campo
  if (/\bsaldo\b|\bdocumento\b|\bfolio\b|\bnumero\b|^n\b|\brut\b|\bsucursal\b|\bhora\b/.test(c)) return null
  for (const campo of ORDEN_CONTIENE) if (SINONIMOS[campo].some((s) => contiene(c, s))) return campo
  return null
}

// Asigna cada campo a una columna (la primera que calce exacto; si no, la primera que lo contenga)
function columnasDe(encabezado) {
  const cols = Object.fromEntries(CAMPOS.map((c) => [c.clave, -1]))
  const usadas = new Set()
  const limpios = encabezado.map(limpiar)
  for (const [campo, lista] of Object.entries(SINONIMOS))
    limpios.forEach((c, i) => {
      if (cols[campo] < 0 && !usadas.has(i) && lista.includes(c)) {
        cols[campo] = i
        usadas.add(i)
      }
    })
  encabezado.forEach((h, i) => {
    if (usadas.has(i)) return
    const campo = campoDeEncabezado(h)
    if (campo && cols[campo] < 0) {
      cols[campo] = i
      usadas.add(i)
    }
  })
  return cols
}

// Fila del encabezado: la de las primeras 30 que reconoce más campos (con fecha y algún monto)
export function detectarEncabezado(filas) {
  let mejor = { fila: -1, puntaje: 0 }
  for (let i = 0; i < Math.min(filas.length, FILAS_BUSCAR_ENCABEZADO); i++) {
    if (vacia(filas[i])) continue
    const cols = columnasDe(filas[i])
    if (cols.fecha < 0 || (cols.monto < 0 && cols.cargo < 0 && cols.abono < 0)) continue
    const puntaje = Object.values(cols).filter((x) => x >= 0).length
    if (puntaje > mejor.puntaje) mejor = { fila: i, puntaje }
  }
  return mejor
}

// Huella del formato: sus columnas con nombre, normalizadas. Sirve para reconocerlo la próxima vez.
export const huella = (encabezado) =>
  (encabezado ?? [])
    .map(limpiar)
    .filter((c) => c && c !== COLUMNA_ERROR)
    .join('|')

const filasDeDatos = (filas, mapeo) => filas.slice(mapeo.encabezado + 1).filter((f) => !vacia(f))
const celdaDe = (fila, i) => (i >= 0 ? String(fila[i] ?? '').trim() : '')

// 03/10/26 o 10/03/26: si algún día pasa de 12 se sabe el orden. Montos: 1.234,5 (Chile) o 1,234.5
export function detectarFormatos(filas, mapeo) {
  let dmy = 0
  let mdy = 0
  let cl = 0
  let us = 0
  for (const fila of filasDeDatos(filas, mapeo).slice(0, 300)) {
    const r = celdaDe(fila, mapeo.cols.fecha).match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/)
    if (r) {
      if (+r[1] > 12) dmy++
      if (+r[2] > 12) mdy++
    }
    for (const k of ['monto', 'cargo', 'abono']) {
      const t = celdaDe(fila, mapeo.cols[k]).replace(/[$\s\u00a0]|clp/gi, '').replace(/^-|^\(|\)$/g, '')
      if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^\d+,\d{1,2}$/.test(t)) cl++
      else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) us++
    }
  }
  return { fecha: mdy > 0 && dmy === 0 ? 'mdy' : 'dmy', monto: us > cl ? 'us' : 'cl' }
}

// Propuesta de mapeo para una hoja ya sabiendo la fila del encabezado
export function mapeoDesde(filas, encabezado, { categorias = [], alias = {}, existentes = [] } = {}) {
  const cols = encabezado >= 0 ? columnasDe(filas[encabezado]) : Object.fromEntries(CAMPOS.map((c) => [c.clave, -1]))
  const mapeo = { plantilla: false, encabezado: Math.max(0, encabezado), cols, modo: 'fijo', tipoFijo: 'gasto', catDefecto: {}, catValores: {}, fecha: 'dmy', monto: 'cl' }
  if ((cols.cargo >= 0 || cols.abono >= 0) && cols.monto < 0) mapeo.modo = 'cargo_abono'
  else if (cols.monto >= 0 && cols.tipo >= 0) mapeo.modo = 'tipo'
  else if (cols.monto >= 0 && filasDeDatos(filas, mapeo).some((f) => /^\s*(-|\()/.test(celdaDe(f, cols.monto)))) mapeo.modo = 'signo'
  Object.assign(mapeo, detectarFormatos(filas, mapeo))
  mapeo.catDefecto = categoriaPorDefecto(categorias)
  mapeo.catValores = sugerirCategorias(valoresCategoria(filas, mapeo), { categorias, alias, existentes })
  return mapeo
}

const visiblesDe = (categorias, tipo) => categorias.filter((c) => !c.oculta && (!tipo || c.tipo === tipo))

function categoriaPorDefecto(categorias) {
  const elegir = (tipo, nombre) => (visiblesDe(categorias, tipo).find((c) => normalizar(c.nombre) === nombre) ?? visiblesDe(categorias, tipo).at(-1))?.id ?? null
  return { gasto: elegir('gasto', 'otros gastos'), ingreso: elegir('ingreso', 'otros ingresos') }
}

/**
 * Analiza el archivo completo: elige la hoja, reconoce la plantilla o un formato guardado, y si no,
 * propone un mapeo. Devuelve { hoja, mapeo, plantilla, perfil }.
 */
export function analizar(hojas, { categorias = [], alias = {}, perfiles = [], existentes = [] } = {}) {
  // 1. La plantilla (camino recomendado)
  for (let h = 0; h < hojas.length; h++) {
    const e = revisarEstructura(hojas[h].filas)
    if (e.ok) return { hoja: h, plantilla: true, perfil: null, mapeo: mapeoPlantilla(e) }
  }
  // 2. Un formato que la empresa ya guardó
  for (const perfil of perfiles)
    for (let h = 0; h < hojas.length; h++) {
      const filas = hojas[h].filas
      const i = filas.slice(0, FILAS_BUSCAR_ENCABEZADO).findIndex((f) => !vacia(f) && huella(f) === perfil.huella)
      if (i < 0) continue
      const mapeo = { ...perfil.mapeo, encabezado: i, catValores: {} }
      mapeo.catValores = sugerirCategorias(valoresCategoria(filas, mapeo), { categorias, alias, existentes })
      return { hoja: h, plantilla: false, perfil: { id: perfil.id, nombre: perfil.nombre }, mapeo }
    }
  // 3. Planilla propia nueva: la hoja donde mejor se reconoce un encabezado
  let mejor = { hoja: 0, fila: -1, puntaje: 0 }
  hojas.forEach((hoja, h) => {
    const d = detectarEncabezado(hoja.filas)
    if (d.puntaje > mejor.puntaje) mejor = { hoja: h, ...d }
  })
  const filas = hojas[mejor.hoja].filas
  const fila = mejor.fila >= 0 ? mejor.fila : filas.findIndex((f) => !vacia(f))
  return { hoja: mejor.hoja, plantilla: false, perfil: null, reconocido: mejor.fila >= 0, mapeo: mapeoDesde(filas, fila, { categorias, alias, existentes }) }
}

// ¿Falta algo para poder interpretar las filas? Devuelve los motivos (vacío = listo)
export function faltantesMapeo(mapeo) {
  const { cols, modo } = mapeo
  const f = []
  if (cols.fecha < 0) f.push('Elige la columna de la fecha.')
  if (modo === 'cargo_abono' && cols.cargo < 0 && cols.abono < 0) f.push('Elige la columna de gastos (cargos) o la de ingresos (abonos).')
  if (modo !== 'cargo_abono' && cols.monto < 0) f.push('Elige la columna del monto.')
  if (modo === 'tipo' && cols.tipo < 0) f.push('Elige la columna que dice si es ingreso o gasto.')
  return f
}

// ---------------------------------------------------------------------------------------------
// Categorías de la planilla → categorías de KontadorIA
// ---------------------------------------------------------------------------------------------

// Valores distintos de la columna de categoría, con cuántas filas trae cada uno
export function valoresCategoria(filas, mapeo) {
  if (mapeo.cols.categoria < 0) return []
  const m = new Map()
  for (const f of filasDeDatos(filas, mapeo)) {
    const t = celdaDe(f, mapeo.cols.categoria)
    if (!t) continue
    const k = normalizar(t)
    const x = m.get(k) ?? { clave: k, texto: t, filas: 0 }
    x.filas++
    m.set(k, x)
  }
  return [...m.values()].sort((a, b) => b.filas - a.filas)
}

// Pistas para sugerir una categoría predefinida a partir de cómo la llama el usuario
const PISTAS = {
  insumos: ['mercaderia', 'mercaderias', 'insumo', 'insumos', 'materia prima', 'abarrotes', 'compras', 'verduras', 'carnes', 'pollo', 'bebidas', 'envases', 'supermercado'],
  servicios: ['luz', 'agua', 'gas', 'electricidad', 'internet', 'telefono', 'celular', 'servicios', 'cuentas', 'servicio basico', 'servicios basicos'],
  arriendo: ['arriendo', 'arriendos', 'alquiler', 'renta'],
  remuneraciones: ['sueldo', 'sueldos', 'remuneracion', 'remuneraciones', 'honorario', 'honorarios', 'personal', 'imposiciones', 'previred', 'finiquito', 'bono'],
  transporte: ['transporte', 'bencina', 'combustible', 'petroleo', 'flete', 'fletes', 'despacho', 'estacionamiento', 'peaje', 'pasajes', 'uber'],
  mantencion: ['mantencion', 'reparacion', 'reparaciones', 'arreglo', 'arreglos', 'mantenimiento'],
  marketing: ['publicidad', 'marketing', 'redes sociales', 'volantes', 'avisos', 'instagram', 'facebook', 'propaganda'],
  impuestos: ['impuesto', 'impuestos', 'iva', 'patente', 'patentes', 'f29', 'sii', 'contribuciones', 'permiso'],
  'otros-gastos': ['otros gastos', 'varios', 'otros egresos', 'gastos varios'],
  ventas: ['venta', 'ventas', 'meson', 'delivery', 'pedidos', 'pedido', 'boletas'],
  'otros-ingresos': ['otros ingresos', 'aporte', 'aportes', 'devolucion', 'reembolso', 'intereses'],
}

/**
 * Para cada valor de la planilla propone una categoría visible: por nombre igual, por lo que ya se
 * eligió antes en la empresa (alias) o por pistas. null = el usuario tiene que elegir.
 */
export function sugerirCategorias(valores, { categorias = [], alias = {} } = {}) {
  const visibles = visiblesDe(categorias)
  const salida = {}
  for (const { clave } of valores) {
    const igual = visibles.find((c) => normalizar(c.nombre) === clave)
    const recordada = alias[clave] && visibles.find((c) => c.id === alias[clave])
    let pista = null
    if (!igual && !recordada)
      for (const [id, palabras] of Object.entries(PISTAS)) {
        const c = visibles.find((x) => x.id === `c-${id}`)
        if (c && palabras.some((p) => contiene(clave.replace(/[^a-z0-9]+/g, ' '), p))) {
          pista = c
          break
        }
      }
    salida[clave] = (igual ?? recordada ?? pista)?.id ?? null
  }
  return salida
}

// Lo que conviene recordar para la próxima vez: las asociaciones que no son nombre igual
export function aliasNuevos(mapeo, categorias) {
  return Object.fromEntries(
    Object.entries(mapeo.catValores ?? {}).filter(([clave, id]) => id && !categorias.some((c) => c.id === id && normalizar(c.nombre) === clave)),
  )
}

// ---------------------------------------------------------------------------------------------
// Interpretación y validación de filas (HU11)
// ---------------------------------------------------------------------------------------------

const MESES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 }

// "05-10-2026", "5/10/26", "2026-10-05", "5 oct 2026", "05-oct-26" o un número de fecha de Excel
// (45935) → 'AAAA-MM-DD'. `orden`: 'dmy' (Chile) o 'mdy'.
export function leerFecha(texto, orden = 'dmy') {
  const t = normalizar(texto)
  let d, m, y
  let r
  if ((r = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[t ].*)?$/))) [, y, m, d] = r
  else if ((r = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/))) {
    ;[, d, m, y] = r
    if (orden === 'mdy') [d, m] = [m, d]
  } else if ((r = t.match(/^(\d{1,2})[-/. ]+(?:de )?([a-z]{3,10})\.?[-/. ]+(?:de |del )?(\d{2}|\d{4})$/))) {
    ;[, d, m, y] = r
    m = MESES[m.slice(0, 3)]
    if (!m) return null
  } else if (/^\d{5}(\.\d+)?$/.test(t)) {
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(+t) * 86400000) // serial de Excel
    return f.toISOString().slice(0, 10)
  } else return null
  if (String(y).length === 2) y = 2000 + +y
  const f = new Date(Date.UTC(+y, +m - 1, +d))
  if (f.getUTCFullYear() !== +y || f.getUTCMonth() !== +m - 1 || f.getUTCDate() !== +d) return null
  return f.toISOString().slice(0, 10)
}

// "$ 12.990" → 12990 · "-89.000" → -89000 · "(5.000)" → -5000 · "12.990,50" → 12991 (redondeado)
// `formato`: 'cl' (1.234,5) o 'us' (1,234.5). Un número crudo de Excel (12990.5) sirve en ambos.
export function leerMonto(texto, formato = 'cl') {
  let t = String(texto ?? '').replace(/[$\s\u00a0]/g, '').replace(/clp/i, '')
  if (!t) return { vacio: true }
  let negativo = false
  if (/^\(.*\)$/.test(t)) [negativo, t] = [true, t.slice(1, -1)]
  if (/^-/.test(t)) [negativo, t] = [true, t.slice(1)]
  if (/-$/.test(t)) [negativo, t] = [true, t.slice(0, -1)]
  let n = null
  if (formato === 'us') {
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) || /^\d+(\.\d+)?$/.test(t)) n = Number(t.replace(/,/g, ''))
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'))
  else if (/^\d+(,\d+)?$/.test(t)) n = Number(t.replace(',', '.'))
  else if (/^\d+\.\d+$/.test(t)) n = Number(t) // número de Excel con punto decimal
  if (n === null || !Number.isFinite(n)) return { error: `«${texto}» no es un monto.` }
  const valor = Math.round(n)
  return { valor: negativo ? -valor : valor, redondeado: Math.abs(n - valor) > 0.0001 ? n : null }
}

// Valores de la columna tipo: ingreso/gasto y sus formas habituales
const TIPOS = {
  ingreso: 'ingreso', ingresos: 'ingreso', i: 'ingreso', abono: 'ingreso', abonos: 'ingreso', entrada: 'ingreso', entradas: 'ingreso', credito: 'ingreso', venta: 'ingreso', ventas: 'ingreso', '+': 'ingreso',
  gasto: 'gasto', gastos: 'gasto', g: 'gasto', e: 'gasto', egreso: 'gasto', egresos: 'gasto', cargo: 'gasto', cargos: 'gasto', salida: 'gasto', salidas: 'gasto', debito: 'gasto', compra: 'gasto', compras: 'gasto', '-': 'gasto',
}

const TOTALES = /^(sub ?)?total(es)?\b|^saldo\b|^resumen\b|^suma\b|^total general\b/

/**
 * Interpreta y valida cada fila con el mapeo. Devuelve { filas, ignoradas }.
 *   filas[]: { n, valores, celdas, errores, aviso, nota, datos }
 *     n        → número de fila en Excel
 *     valores  → lo que venía en el archivo, por campo (para mostrar)
 *     celdas   → la fila original (para el archivo de errores)
 *     errores  → motivos; si hay alguno, la fila NO se importa
 *     aviso    → posible repetido: se importa igual, pero conviene mirarlo
 *     nota     → algo que se ajustó (redondeo, categoría sugerida); se importa
 *     datos    → el movimiento listo para guardar (solo si no hay errores)
 *   ignoradas[]: { n, motivo, texto } filas de totales, saldos, títulos o encabezados repetidos
 */
export function interpretar(filas, mapeo, { categorias, existentes = [] }) {
  const { cols, modo, plantilla } = mapeo
  const hoy = hoyISO()
  const vistos = new Map()
  const llaveDup = (d) => `${d.tipo}|${d.fecha}|${d.monto}|${normalizar(d.proveedor)}`
  const previos = new Map(existentes.filter((m) => !m.eliminado).map((m) => [llaveDup(m), m]))
  // Categoría más usada con cada proveedor: se usa cuando la fila no trae categoría
  const porProveedor = new Map()
  for (const m of existentes) {
    if (m.eliminado || !m.proveedor) continue
    const k = `${m.tipo}|${normalizar(m.proveedor)}`
    const cuenta = porProveedor.get(k) ?? {}
    cuenta[m.categoria_id] = (cuenta[m.categoria_id] ?? 0) + 1
    porProveedor.set(k, cuenta)
  }
  const deProveedor = (tipo, proveedor) => {
    const cuenta = proveedor && porProveedor.get(`${tipo}|${normalizar(proveedor)}`)
    if (!cuenta) return null
    const id = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0][0]
    return visiblesDe(categorias, tipo).find((c) => c.id === id) ?? null
  }
  const salida = []
  const ignoradas = []

  filas.forEach((fila, i) => {
    if (i <= mapeo.encabezado || vacia(fila)) return
    const c = (k) => celdaDe(fila, cols[k])
    const textoMonto = modo === 'cargo_abono' ? c('cargo') || c('abono') : c('monto')
    const v = { fecha: c('fecha'), monto: textoMonto, tipo: c('tipo'), categoria: c('categoria'), proveedor: c('proveedor'), descripcion: c('descripcion') }
    const fecha = v.fecha ? leerFecha(v.fecha, mapeo.fecha) : null

    // Filas que no son movimientos: totales, saldos, títulos de sección, el encabezado repetido
    if (!fecha) {
      const primeras = fila.map(normalizar).filter(Boolean)
      if (primeras.some((x) => TOTALES.test(x))) return ignoradas.push({ n: i + 1, motivo: 'Fila de totales o saldo', texto: primeras.slice(0, 3).join(' · ') })
      if (campoDeEncabezado(v.fecha) === 'fecha') return ignoradas.push({ n: i + 1, motivo: 'Encabezado repetido', texto: primeras.slice(0, 3).join(' · ') })
      if (!v.fecha && !c('monto') && !c('cargo') && !c('abono')) return ignoradas.push({ n: i + 1, motivo: 'Sin fecha ni monto (título o nota)', texto: primeras.slice(0, 3).join(' · ') })
    }

    const errores = []
    const notas = []
    if (!v.fecha) errores.push('Falta la fecha.')
    else if (!fecha) errores.push(`«${v.fecha}» no es una fecha válida (usa DD-MM-AAAA).`)
    else if (fecha > hoy) errores.push(`La fecha ${fechaCorta(fecha)} es futura.`)
    if (fecha) v.fecha = fechaCorta(fecha) // un número de fecha de Excel (45935) se muestra como DD-MM-AAAA

    // Monto y tipo, según cómo los trae la planilla
    let monto = null
    let tipo = null
    const revisarMonto = (m, texto) => {
      if (m.error) return errores.push(m.error)
      if (m.redondeado !== null) notas.push(`El monto ${texto} tenía decimales: se redondeó a ${clp(m.valor)}.`)
      return null
    }
    if (modo === 'cargo_abono') {
      const cargo = leerMonto(c('cargo'), mapeo.monto)
      const abono = leerMonto(c('abono'), mapeo.monto)
      const hayCargo = !cargo.vacio && !cargo.error && cargo.valor !== 0
      const hayAbono = !abono.vacio && !abono.error && abono.valor !== 0
      if (cargo.error) errores.push(cargo.error)
      else if (abono.error) errores.push(abono.error)
      else if (hayCargo && hayAbono) errores.push('Trae un gasto y un ingreso en la misma fila: sepáralos en dos filas.')
      else if (!hayCargo && !hayAbono) errores.push('Falta el monto (no hay nada en gastos ni en ingresos).')
      else {
        const m = hayCargo ? cargo : abono
        revisarMonto(m, hayCargo ? c('cargo') : c('abono'))
        monto = Math.abs(m.valor) // hay bancos que muestran los cargos en negativo
        tipo = hayCargo ? 'gasto' : 'ingreso'
      }
    } else {
      const m = leerMonto(v.monto, mapeo.monto)
      if (m.vacio) errores.push('Falta el monto.')
      else if (!m.error && m.valor === 0) errores.push('El monto debe ser mayor que cero.')
      else if (!m.error && m.valor < 0 && modo !== 'signo') errores.push('El monto debe ser mayor que cero (el tipo dice si es gasto).')
      else if (!revisarMonto(m, v.monto) && !m.error) {
        monto = Math.abs(m.valor)
        if (modo === 'signo') tipo = m.valor < 0 ? 'gasto' : 'ingreso'
      }
      if (modo === 'fijo') tipo = mapeo.tipoFijo
      if (modo === 'tipo') {
        tipo = TIPOS[normalizar(v.tipo)] ?? null
        if (!v.tipo) errores.push('Falta el tipo (ingreso o gasto).')
        else if (!tipo) errores.push(`El tipo «${v.tipo}» no existe: usa «ingreso» o «gasto».`)
      }
    }
    if (monto !== null && monto > MAX_MONTO) errores.push('Ese monto es demasiado grande.')
    if (tipo) v.tipo = tipo

    // Categoría: la de la columna (por nombre o por lo que eligió el usuario) o una por defecto
    let categoria = null
    if (v.categoria) {
      const k = normalizar(v.categoria)
      const mismas = categorias.filter((x) => normalizar(x.nombre) === k)
      const elegida = mapeo.catValores?.[k] ? categorias.find((x) => x.id === mapeo.catValores[k]) : null
      const candidatas = elegida ? [elegida] : mismas.filter((x) => !x.oculta)
      categoria = candidatas.find((x) => !tipo || x.tipo === tipo) ?? null
      if (!categoria && tipo) {
        if (candidatas.length) {
          const o = candidatas[0]
          errores.push(`«${o.nombre}» es una categoría de ${o.tipo === 'gasto' ? 'gastos' : 'ingresos'}, no de ${tipo === 'gasto' ? 'gastos' : 'ingresos'}.`)
        } else if (mismas.length) errores.push(`«${mismas[0].nombre}» está oculta en tu empresa: muéstrala en Categorías o usa otra.`)
        else if (plantilla) errores.push(`No existe la categoría «${v.categoria}». Usa una de tus categorías o pide que la creen.`)
        else errores.push(`Falta elegir a qué categoría corresponde «${v.categoria}».`)
      }
    } else if (plantilla) errores.push('Falta la categoría.')
    else if (tipo) {
      const sugerida = deProveedor(tipo, v.proveedor)
      categoria = sugerida ?? categorias.find((x) => x.id === mapeo.catDefecto?.[tipo]) ?? null
      if (sugerida) notas.push(`Categoría «${sugerida.nombre}»: la que usas con ${v.proveedor}.`)
      if (!categoria) errores.push(`Elige una categoría por defecto para los ${tipo === 'gasto' ? 'gastos' : 'ingresos'}.`)
    }

    // Descripción: obligatoria en la plantilla; en una planilla propia sin descripción se usa el proveedor
    let descripcion = v.descripcion
    if (!descripcion && !plantilla) descripcion = v.proveedor || (cols.descripcion < 0 ? categoria?.nombre : '') || ''
    if (v.proveedor.length > 150) errores.push('El proveedor tiene más de 150 caracteres.')
    if (!descripcion) errores.push('Falta la descripción.')
    else if (descripcion.length > 500) errores.push('La descripción tiene más de 500 caracteres.')

    const fila_ = { n: i + 1, valores: v, celdas: fila, errores, aviso: null, nota: notas.join(' ') || null, datos: null }
    if (!errores.length) {
      fila_.datos = {
        fecha,
        monto,
        tipo,
        categoria_id: categoria.id,
        proveedor: v.proveedor,
        descripcion,
        tipo_documento: 'otro', // la planilla no lo trae; en la base es obligatorio
      }
      const llave = llaveDup(fila_.datos)
      if (vistos.has(llave)) fila_.aviso = `Igual a la fila ${vistos.get(llave)} de este archivo.`
      else if (previos.has(llave)) {
        const m = previos.get(llave)
        fila_.aviso = `Ya hay un ${m.tipo} igual el ${fechaCorta(m.fecha)}${m.descripcion ? ` («${m.descripcion}»)` : ''}.`
      }
      vistos.set(llave, fila_.n)
    }
    salida.push(fila_)
  })
  return { filas: salida, ignoradas }
}

// ---------------------------------------------------------------------------------------------
// Archivos que se descargan
// ---------------------------------------------------------------------------------------------

// Comillas si hace falta, y un apóstrofo delante de lo que Excel tomaría como fórmula
// (=, +, @, o - seguido de algo que no es un número): el archivo se abre sin ejecutar nada.
const celdaCsv = (valor) => {
  let s = String(valor ?? '')
  if (/^[=+@\t\r]/.test(s) || /^-(?![\d.,\s]*$)/.test(s)) s = `'${s}`
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function descargar(nombre, texto, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + texto], { type: tipo })) // BOM: Excel lee bien las tildes
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Plantilla CSV: solo el encabezado, separado por ";" como lo abre Excel en Chile
export function descargarPlantillaCsv() {
  descargar('plantilla-kontadoria.csv', COLUMNAS.map((c) => c.nombre).join(';') + '\r\n')
}

// HU11: las filas con error, con su motivo, en las MISMAS columnas del archivo original, para
// corregirlas y volver a subirlas (el formato guardado las reconoce).
export function descargarErrores(nombreArchivo, filas, encabezado) {
  const sinError = (celdas) => celdas.filter((_, i) => normalizar(encabezado[i]) !== COLUMNA_ERROR)
  const ancho = Math.max(encabezado.length, ...filas.map((f) => f.celdas.length))
  const completar = (celdas) => Array.from({ length: ancho }, (_, i) => celdas[i] ?? '')
  const cabeza = [...sinError(completar(encabezado)), COLUMNA_ERROR].map(celdaCsv).join(';')
  const cuerpo = filas
    .filter((f) => f.errores.length)
    .map((f) => [...sinError(completar(f.celdas)), `Fila ${f.n}: ${f.errores.join(' ')}`].map(celdaCsv).join(';'))
  const base = nombreArchivo.replace(/\.(csv|xlsx)$/i, '')
  descargar(`${base}-filas-con-error.csv`, [cabeza, ...cuerpo].join('\r\n') + '\r\n')
}

// ---------------------------------------------------------------------------------------------
// Archivos de ejemplo (lo que traería un contador). Se arman con fechas del mes pasado.
// ---------------------------------------------------------------------------------------------

export function ejemplos(existentes) {
  const hoy = hoyISO()
  const ym = moverMes(hoy.slice(0, 7), -1)
  const [y, m] = ym.split('-')
  const dia = (d) => `${String(d).padStart(2, '0')}-${m}-${y}`
  const diaCorto = (d) => `${String(d).padStart(2, '0')}/${m}/${y.slice(2)}`
  // Un gasto que ya está en la app (el gas del mes pasado): la fila sale con aviso de repetido
  const gas = existentes.find((x) => !x.eliminado && x.proveedor === 'Gas Sur' && x.fecha.startsWith(ym))
  const futuro = moverMes(hoy.slice(0, 7), 1).split('-')
  const encabezado = ['Fecha', 'Monto', 'Tipo', 'Categoría', 'Proveedor', 'Descripción']

  const cajaChica = [
    encabezado,
    [dia(1), '18.990', 'gasto', 'Insumos', 'Supermercado El Trébol', 'Servilletas y bolsas'],
    [dia(2), '6.500', 'gasto', 'Transporte', 'Estacionamientos Centro', 'Estacionamiento compras'],
    [dia(3), '89.000', 'gasto', 'Mantención', 'Gasfitería Rápida', 'Reparación del lavaplatos'],
    [dia(4), '35.000', 'ingreso', 'Ventas', 'Familia Muñoz', 'Pedido de cumpleaños'],
    [dia(4), '12.400', 'gasto', 'Insumos', 'Verdulería Don Lucho', 'Lechuga, tomate y limones'],
    ['31-02-' + y, '15.000', 'gasto', 'Insumos', 'Feria libre', 'Verduras de la semana'],
    [dia(6), 'doce mil', 'gasto', 'Insumos', 'Panadería La Espiga', 'Pan amasado'],
    [dia(7), '24.990', 'gasto', 'Marketing', 'Imprenta Rápida', 'Volantes para el barrio'],
    [dia(8), '48.000', 'gasto', 'Combustible', 'Copec Ruta 5', 'Bencina furgón'],
    gas ? [fechaCorta(gas.fecha), gas.monto.toLocaleString('es-CL'), 'gasto', 'Servicios básicos', 'Gas Sur', 'Gas licuado 45 kg'] : [dia(8), '52.900', 'gasto', 'Servicios básicos', 'Gas Sur', 'Gas licuado 45 kg'],
    [dia(9), '15.800', 'gasto', 'Insumos', 'Distribuidora Avícola del Sur', 'Alitas 5 kg'],
    [dia(10), '120.000', 'ingreso', 'Ventas', 'Club Deportivo Unión', 'Colaciones para el campeonato'],
    [dia(11), '9.990', 'gasto', 'Servicios básicos', 'Telefonía Sur', 'Plan de internet'],
    [dia(12), '-15.000', 'gasto', 'Otros gastos', 'Cerrajería Central', 'Copia de llaves'],
    [dia(13), '3.500', 'gasto', 'Transporte', 'Micro', 'Pasajes'],
    [dia(14), '27.300', 'gasto', 'Insumos', 'Supermercado El Trébol', 'Aceite y aliños'],
    [dia(15), '45.000', 'pendiente', 'Remuneraciones', 'Pedro Sánchez', 'Ayudante fin de semana'],
    [dia(16), '19.900', 'gasto', 'Ventas', 'Bazar Mi Casa', 'Paños y escobillones'],
    [dia(17), '14.990', 'gasto', 'Insumos', 'Distribuidora Avícola del Sur', 'Pechuga 3 kg'],
    [dia(18), '60.000', 'ingreso', 'Otros ingresos', 'Municipalidad', 'Aporte feria costumbrista'],
    [dia(19), '8.400', 'gasto', 'Insumos', 'Panadería La Espiga', 'Pan para completos'],
    [dia(20), '32.000', 'gasto', 'Mantención', 'Servicio Técnico Frío Sur', 'Revisión del refrigerador'],
    [`05-${futuro[1]}-${futuro[0]}`, '22.000', 'gasto', 'Arriendo', 'Bodega Los Sauces', 'Arriendo bodeguita'],
    [dia(22), '11.500', 'gasto', 'Insumos', 'Verdulería Don Lucho', 'Papas 25 kg'],
    ['', '', '', '', '', ''],
    [dia(24), '7.990', 'gasto', 'Otros gastos', 'Librería El Estudiante', ''],
    [dia(25), '42.600', 'ingreso', 'Ventas', '', 'Ventas por delivery'],
  ]

  const ventas = [
    encabezado,
    [dia(5), '198.500', 'ingreso', 'Ventas', 'Mercado Pago', 'Ventas con tarjeta semana 1'],
    [dia(12), '214.300', 'ingreso', 'Ventas', 'Mercado Pago', 'Ventas con tarjeta semana 2'],
    [dia(19), '226.800', 'ingreso', 'Ventas', 'Mercado Pago', 'Ventas con tarjeta semana 3'],
    [dia(26), '231.100', 'ingreso', 'Ventas', 'Mercado Pago', 'Ventas con tarjeta semana 4'],
    [dia(28), '18.700', 'gasto', 'Servicios básicos', 'Mercado Pago', 'Comisiones del mes'],
  ]

  // Planilla propia del local: título arriba, sus propios nombres de columna y de categoría,
  // ingresos y egresos en columnas separadas, una fila de totales y una hoja de resumen
  const propia = [
    ['Restaurante El Fogón — Control de caja'],
    [`Mes: ${m}/${y}`],
    [],
    ['Fecha', 'Glosa', 'Ítem', 'Proveedor / Cliente', 'Ingresos', 'Egresos', 'Saldo'],
    [diaCorto(1), 'Compra de verduras', 'Mercadería', 'Verdulería Don Lucho', '', '23.400', ''],
    [diaCorto(2), 'Venta del día', 'Venta mesón', '', '184.500', '', ''],
    [diaCorto(3), 'Cuenta de la luz', 'Luz', 'Compañía Eléctrica Regional', '', '61.200', ''],
    [diaCorto(5), 'Pedidos por app', 'Delivery', 'Rappi', '96.300', '', ''],
    [diaCorto(6), 'Pago ayudante', 'Sueldos', 'Pedro Sánchez', '', '120.000', ''],
    [diaCorto(8), 'Pollo y aliños', 'Mercadería', 'Distribuidora Avícola del Sur', '', '86.990', ''],
    [diaCorto(9), 'Avisos en Instagram', 'Publicidad', 'Meta', '', '15.000', ''],
    [diaCorto(10), 'Recarga gas', 'Gas', 'Gas Sur', '', '52.900', ''],
    [diaCorto(12), 'Venta del día', 'Venta mesón', '', '201.700', '', ''],
    [diaCorto(14), 'Cuota patente', 'Patente', 'Municipalidad', '', '48.000', ''],
    [diaCorto(15), 'Préstamo de mi hermano', 'Préstamo', 'Familia', '300.000', '', ''],
    [diaCorto(16), 'Arreglo campana', 'Reparación', 'Servicio Técnico Frío Sur', '', '35.000', ''],
    [diaCorto(18), 'Bolsas y envases', 'Mercadería', 'Bazar Mi Casa', '', '12.345,60', ''],
    [],
    ['TOTAL', '', '', '', '782.500', '454.835', '327.665'],
  ]

  // Cartola del banco: formato del banco, con cargos y abonos y saldo
  const cartola = [
    ['Cartola de movimientos — Cuenta Corriente 00-123-45678-9'],
    [],
    ['Fecha', 'Descripción', 'N° Documento', 'Cargos', 'Abonos', 'Saldo'],
    ['', 'SALDO ANTERIOR', '', '', '', '1.165.300'],
    [dia(2), 'TRASPASO A TERCEROS GASFITERIA RAPIDA', '000123', '89.000', '', '1.076.300'],
    [dia(4), 'DEPOSITO EN EFECTIVO', '000124', '', '35.000', '1.111.300'],
    [dia(7), 'PAGO AUTOMATICO COMPANIA ELECTRICA', '000125', '58.300', '', '1.053.000'],
    [dia(9), 'TRANSFERENCIA DE MERCADO PAGO', '000126', '', '198.500', '1.251.500'],
    [dia(15), 'COMISION MANTENCION CUENTA', '000127', '6.990', '', '1.244.510'],
    ['', 'SALDO FINAL', '', '', '', '1.244.510'],
  ]

  return [
    {
      id: 'caja-chica',
      nombre: `caja-chica-${m}-${y}.xlsx`,
      tipo: 'xlsx',
      titulo: 'Caja chica con la plantilla',
      detalle: `${cajaChica.length - 2} filas, algunas con errores`,
      hojas: [{ nombre: 'Movimientos', filas: cajaChica }],
    },
    { id: 'ventas', nombre: `ventas-tarjeta-${m}-${y}.csv`, tipo: 'csv', titulo: 'Ventas con la plantilla', detalle: '5 filas, todas bien', hojas: [{ nombre: 'CSV', filas: ventas }] },
    {
      id: 'propia',
      nombre: `control-caja-el-fogon-${m}-${y}.xlsx`,
      tipo: 'xlsx',
      titulo: 'Planilla propia del local',
      detalle: 'Sus columnas y sus ítems',
      propia: true,
      hojas: [
        { nombre: 'Caja', filas: propia },
        { nombre: 'Resumen', filas: [['Resumen del mes'], ['Ingresos', '782.500'], ['Egresos', '454.835']] },
      ],
    },
    { id: 'cartola', nombre: `cartola-banco-${m}-${y}.xlsx`, tipo: 'xlsx', titulo: 'Cartola del banco', detalle: 'Cargos y abonos', propia: true, hojas: [{ nombre: 'Cartola', filas: cartola }] },
  ]
}
