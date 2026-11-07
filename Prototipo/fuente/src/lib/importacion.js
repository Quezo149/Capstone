// PROTOTIPO HU10–HU13 + planillas propias: importación masiva desde CSV/XLSX.
// En la app real, leer y validar lo hace el backend en un solo motor (POST /importaciones/analizar,
// /validar y POST /importaciones, ver "Investigación importación"). Aquí corre en el navegador con
// las MISMAS reglas, como especificación y banco de pruebas: no es un segundo motor para producción.
// Nada sale del navegador.
//
// Tres caminos, en este orden:
//   1. La plantilla de KontadorIA (recomendada): se reconoce sola, aunque tenga un título arriba.
//   2. Un formato que la empresa ya guardó (por la huella de sus columnas).
//   3. Una planilla propia nueva: se detecta la hoja, el encabezado y las columnas por sinónimos o
//      por sus datos. Solo si falta la fecha o el monto (o se adivinó por los datos) se pide mapear.
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

// Límites. El de negocio son las filas; el peso solo protege al servidor (una imagen pesa mucho y
// no aporta filas), con un tope a lo que el Excel ocupa descomprimido.
export const MAX_FILAS = 2000
export const MAX_MB = 10
const MAX_DESCOMPRIMIDO = 50 * 1024 * 1024
const MAX_ENTRADAS_ZIP = 1000
const MAX_MONTO = 999_999_999_999 // igual que el formulario manual
const FILAS_BUSCAR_ENCABEZADO = 30

// "Categoría " → "categoria": sin tildes, sin mayúsculas, sin espacios de sobra
export const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
// Rechazos con instrucción (el archivo no se puede leer como planilla)
// ---------------------------------------------------------------------------------------------

export class ErrorArchivo extends Error {
  constructor(codigo, titulo, mensaje) {
    super(mensaje)
    this.codigo = codigo
    this.titulo = titulo
  }
}

export const RECHAZOS = {
  vacio: ['El archivo está vacío', 'No encontramos nada adentro. Revisa que sea el archivo correcto y vuelve a subirlo.'],
  pesado: [`La planilla pesa más de ${MAX_MB} MB`, 'Quítale imágenes o gráficos pesados, o divídela en dos archivos.'],
  bomba: ['El Excel es demasiado grande por dentro', 'Trae demasiados datos comprimidos. Ábrelo en Excel, guárdalo de nuevo o divídelo en dos.'],
  xls: ['Es un Excel antiguo (.xls)', 'Ábrelo en Excel y elige Guardar como → Libro de Excel (.xlsx). Pronto lo aceptaremos tal cual.'],
  ods: ['Es una planilla de LibreOffice (.ods)', 'Ábrela en LibreOffice y elige Guardar como → Excel 2007-365 (.xlsx).'],
  protegido: ['El Excel tiene contraseña', 'Quítala en Excel (Archivo → Información → Proteger libro) y vuelve a subirlo.'],
  pdf: ['Es un PDF, no una planilla', 'Si es una boleta o factura, súbela en «Cargar boleta». Si tienes la planilla, súbela en .xlsx o .csv.'],
  imagen: ['Es una imagen, no una planilla', 'Si es la foto de una boleta, súbela en «Cargar boleta».'],
  html: ['Es una página web con extensión de Excel', 'Algunos bancos descargan así la cartola. Ábrela en Excel y guárdala como .xlsx.'],
  txt: ['Es un archivo de texto (.txt)', 'Si viene separado por punto y coma o comas, guárdalo como .csv desde Excel o cámbiale la extensión.'],
  otro: ['Ese archivo no es una planilla', 'Sube un Excel (.xlsx) o un CSV.'],
  danado: ['No pudimos abrir este Excel', 'Ábrelo en Excel o Google Sheets y guárdalo de nuevo como .xlsx.'],
  formulas: [
    'La planilla trae fórmulas sin resultado',
    'Fue creada por un programa que no guardó los resultados de sus fórmulas. Ábrela en Excel o Google Sheets y guárdala de nuevo como .xlsx.',
  ],
  libro_diario: [
    'Parece un libro diario contable (Debe/Haber)',
    'Por ahora KontadorIA importa movimientos de caja o banco. Exporta el libro mayor de tu cuenta Caja o Banco, o una cartola, y súbelo.',
  ],
}
export const rechazo = (codigo) => new ErrorArchivo(codigo, ...RECHAZOS[codigo])

// ---------------------------------------------------------------------------------------------
// Lectura de archivos
// ---------------------------------------------------------------------------------------------

// CSV como lo exporta Excel en Chile: separado por ";" (o ",", o tabulaciones), con comillas
export function leerCsv(texto) {
  texto = texto.replace(/^\uFEFF/, '')
  const primera = texto.split(/\r?\n/, 1)[0]
  const cuenta = (c) => primera.split(c).length - 1
  const sep = [';', ',', '\t'].reduce((a, b) => (cuenta(b) > cuenta(a) ? b : a))
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

function textoDe(buffer) {
  const bytes = new Uint8Array(buffer)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes) // Excel en Windows guarda así los CSV
  }
}

// XLSX mínimo: un .xlsx es un ZIP con XML adentro, leído con las APIs del navegador
// (DecompressionStream). En el backend: openpyxl + defusedxml, con el mismo tope de descompresión.
async function leerZip(buffer) {
  const v = new DataView(buffer)
  let fin = buffer.byteLength - 22
  while (fin >= 0 && v.getUint32(fin, true) !== 0x06054b50) fin--
  if (fin < 0) throw new Error('zip')
  const total = v.getUint16(fin + 10, true)
  if (total > MAX_ENTRADAS_ZIP) throw rechazo('bomba')
  let p = v.getUint32(fin + 16, true)
  const archivos = {}
  const dec = new TextDecoder()
  let descomprimido = 0
  for (let i = 0; i < total; i++) {
    const metodo = v.getUint16(p + 10, true)
    const tam = v.getUint32(p + 20, true)
    const real = v.getUint32(p + 24, true)
    const largoNombre = v.getUint16(p + 28, true)
    const largoExtra = v.getUint16(p + 30, true)
    const largoComentario = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const nombre = dec.decode(new Uint8Array(buffer, p + 46, largoNombre))
    archivos[nombre] = { metodo, tam, local }
    // Las imágenes no cuentan: pesan, pero no se descomprimen para leer la planilla
    if (!nombre.startsWith('xl/media/')) {
      descomprimido += real
      if (descomprimido > MAX_DESCOMPRIMIDO || (tam > 0 && real > 1024 * 1024 && real / tam > 100)) throw rechazo('bomba')
    }
    p += 46 + largoNombre + largoExtra + largoComentario
  }
  const leer = async (nombre) => {
    const a = archivos[nombre]
    if (!a) return null
    const inicio = a.local + 30 + v.getUint16(a.local + 26, true) + v.getUint16(a.local + 28, true)
    const datos = new Uint8Array(buffer, inicio, a.tam)
    if (a.metodo === 0) return dec.decode(datos)
    const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Response(flujo).text()
  }
  leer.existe = (nombre) => nombre in archivos
  return leer
}

// "AB12" → { col: 27, fila: 11 } (desde 0). Sin referencia se usa la posición.
const celdaRef = (ref) => {
  const r = /^([A-Z]+)(\d+)$/.exec(ref ?? '')
  return r ? { col: [...r[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1, fila: +r[2] - 1 } : null
}

/**
 * Celdas combinadas: el valor de la celda superior izquierda se copia a todo el rango, solo si el
 * rango baja más de una fila (una categoría combinada en D2:D5). Los títulos combinados en una
 * sola fila (A1:F1) se dejan como están. Devuelve cuántos rangos se completaron.
 */
export function aplicarCombinadas(filas, rangos = []) {
  let n = 0
  for (const rango of rangos) {
    const [a, b] = rango.split(':').map(celdaRef)
    if (!a || !b || b.fila <= a.fila) continue
    const valor = filas[a.fila]?.[a.col] ?? ''
    for (let r = a.fila; r <= b.fila; r++) {
      filas[r] ??= []
      for (let c = a.col; c <= b.col; c++) filas[r][c] = valor
    }
    n++
  }
  return n
}

async function leerXlsx(leer) {
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
  let hojasOcultas = 0
  for (const hoja of libro.getElementsByTagName('sheet')) {
    // Las hojas ocultas son de configuración casi siempre: no se ofrecen
    if (['hidden', 'veryHidden'].includes(hoja.getAttribute('state'))) {
      hojasOcultas++
      continue
    }
    const rid = hoja.getAttribute('r:id') ?? hoja.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const destino = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target')
    if (!destino) continue
    const ruta = destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`
    const contenido = await leer(ruta)
    if (!contenido) continue
    const doc = xml(contenido)
    const filas = []
    const ocultas = [] // filas ocultas (por un filtro o a mano), desde 0
    const sinValor = [] // "fila:col" con una fórmula sin resultado guardado
    const sumas = [] // "fila:col" con =SUMA(...), =SUM(...) o =SUBTOTAL(...)
    let numFila = 0
    for (const row of doc.getElementsByTagName('row')) {
      numFila = row.getAttribute('r') ? +row.getAttribute('r') : numFila + 1
      const r0 = numFila - 1
      if (['1', 'true'].includes(row.getAttribute('hidden'))) ocultas.push(r0)
      const fila = []
      let col = -1
      for (const c of row.getElementsByTagName('c')) {
        col = celdaRef(c.getAttribute('r'))?.col ?? col + 1
        const t = c.getAttribute('t')
        const f = c.getElementsByTagName('f')[0]
        const vNodo = c.getElementsByTagName('v')[0]
        const valor = vNodo?.textContent ?? ''
        let texto = valor
        if (t === 's') texto = compartidos[+valor] ?? ''
        else if (t === 'inlineStr') texto = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('')
        if (f) {
          if (!vNodo || valor === '') sinValor.push(`${r0}:${col}`)
          if (/^\s*(SUMA|SUM|SUBTOTAL|SUMAR\.SI|SUMIF)\s*\(/i.test(f.textContent)) sumas.push(`${r0}:${col}`)
        }
        fila[col] = texto
      }
      filas[r0] = Array.from(fila, (x) => x ?? '')
    }
    const lista = Array.from(filas, (x) => x ?? [])
    const rangos = [...doc.getElementsByTagName('mergeCell')].map((m) => m.getAttribute('ref'))
    const combinadas = aplicarCombinadas(lista, rangos)
    hojas.push({ nombre: hoja.getAttribute('name') ?? `Hoja ${hojas.length + 1}`, filas: lista, ocultas, sinValor, sumas, combinadas })
  }
  if (!hojas.length) throw new Error('sin hojas')
  return { hojas, avisos: { hojasOcultas } }
}

/**
 * Devuelve { tipo: 'csv'|'xlsx', hojas: [{ nombre, filas, ocultas?, sinValor?, sumas?, combinadas? }],
 * avisos: { hojasOcultas } }. El tipo se decide por los primeros bytes (la firma), no por la
 * extensión: una foto o un PDF renombrados se rechazan con una instrucción. Lanza ErrorArchivo.
 */
export async function leerArchivo(archivo) {
  const ext = archivo.name.includes('.') ? archivo.name.split('.').pop().toLowerCase() : ''
  if (!archivo.size) throw rechazo('vacio')
  if (archivo.size > MAX_MB * 1024 * 1024) throw rechazo('pesado')
  const buffer = await archivo.arrayBuffer()
  const b = new Uint8Array(buffer.slice(0, 8))
  const empieza = (...xs) => xs.every((x, i) => b[i] === x)
  if (empieza(0xd0, 0xcf, 0x11, 0xe0)) throw rechazo(ext === 'xlsx' ? 'protegido' : 'xls') // OLE2: .xls o .xlsx cifrado
  if (empieza(0x25, 0x50, 0x44, 0x46)) throw rechazo('pdf')
  if (empieza(0xff, 0xd8, 0xff) || empieza(0x89, 0x50, 0x4e, 0x47) || empieza(0x47, 0x49, 0x46, 0x38)) throw rechazo('imagen')
  if (empieza(0x50, 0x4b)) {
    let leer
    try {
      leer = await leerZip(buffer)
    } catch (e) {
      throw e instanceof ErrorArchivo ? e : rechazo('danado')
    }
    if (leer.existe('mimetype') && (await leer('mimetype')).includes('opendocument.spreadsheet')) throw rechazo('ods')
    if (!leer.existe('xl/workbook.xml')) throw rechazo('otro')
    try {
      return { tipo: 'xlsx', ...(await leerXlsx(leer)) }
    } catch {
      throw rechazo('danado')
    }
  }
  const texto = textoDe(buffer)
  if (/^\s*<(!doctype|html|table)/i.test(texto.slice(0, 500))) throw rechazo('html')
  if (ext === 'xls') throw rechazo('xls')
  if (ext === 'ods') throw rechazo('ods')
  if (ext === 'xlsx') throw rechazo('danado')
  if (ext === 'txt') throw rechazo('txt')
  if (ext !== 'csv' || texto.includes('\u0000')) throw rechazo('otro')
  return { tipo: 'csv', hojas: [{ nombre: 'CSV', filas: leerCsv(texto) }], avisos: {} }
}

// ---------------------------------------------------------------------------------------------
// Plantilla de KontadorIA (camino recomendado)
// ---------------------------------------------------------------------------------------------

// Columna que agrega el archivo de filas con error (descargarErrores): quien corrige ese archivo
// y lo vuelve a subir no tiene que borrarla. Se ignora en todos los caminos.
const COLUMNA_ERROR = 'error'

// ¿Alguna de las primeras 30 filas es exactamente el encabezado de la plantilla (en cualquier
// orden)? Así una plantilla con un título arriba también se reconoce.
export function revisarEstructura(filas) {
  const esPlantilla = (f) => {
    const enc = f.map(normalizar)
    return COLUMNAS.every((c) => enc.includes(c.clave)) && f.every((h, i) => !h || enc[i] === COLUMNA_ERROR || COLUMNAS.some((c) => c.clave === enc[i]))
  }
  let idx = filas.slice(0, FILAS_BUSCAR_ENCABEZADO).findIndex((f) => f && !vacia(f) && esPlantilla(f))
  const ok = idx >= 0
  if (!ok) idx = filas.findIndex((f) => !vacia(f))
  const encabezado = idx < 0 ? [] : filas[idx].map(normalizar)
  const faltan = COLUMNAS.filter((c) => !encabezado.includes(c.clave)).map((c) => c.nombre)
  const sobran = (idx < 0 ? [] : filas[idx]).filter((h, i) => h && encabezado[i] !== COLUMNA_ERROR && !COLUMNAS.some((c) => c.clave === encabezado[i]))
  return { ok, faltan, sobran, encabezado: idx < 0 ? [] : filas[idx], fila: idx }
}

function mapeoPlantilla(estructura) {
  const enc = estructura.encabezado.map(normalizar)
  const col = (k) => enc.indexOf(k)
  const cols = { fecha: col('fecha'), monto: col('monto'), tipo: col('tipo'), cargo: -1, abono: -1, categoria: col('categoria'), proveedor: col('proveedor'), descripcion: col('descripcion'), saldo: -1 }
  return {
    plantilla: true,
    encabezado: estructura.fila,
    cols,
    origen: Object.fromEntries(Object.keys(cols).map((k) => [k, 'plantilla'])),
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

// Campos que se pueden mapear. Obligatorios a la vista: fecha, monto (según el modo) y descripción.
export const CAMPOS = [
  { clave: 'fecha', nombre: 'Fecha', ayuda: 'Cuándo fue el movimiento' },
  { clave: 'descripcion', nombre: 'Descripción', ayuda: 'Glosa, detalle o concepto' },
  { clave: 'proveedor', nombre: 'Proveedor o cliente', ayuda: 'Opcional' },
  { clave: 'categoria', nombre: 'Categoría', ayuda: 'Opcional: ítem, cuenta o clasificación' },
  { clave: 'monto', nombre: 'Monto', ayuda: 'Valor o total' },
  { clave: 'tipo', nombre: 'Tipo', ayuda: 'Dice si es ingreso o gasto' },
  { clave: 'cargo', nombre: 'Gastos (cargos)', ayuda: 'Columna con lo que sale' },
  { clave: 'abono', nombre: 'Ingresos (abonos)', ayuda: 'Columna con lo que entra' },
  { clave: 'saldo', nombre: 'Saldo', ayuda: 'Opcional: para comprobar que los montos cuadran' },
]
const SIN_COLUMNAS = () => Object.fromEntries(CAMPOS.map((c) => [c.clave, -1]))

// Nombres con que suelen venir las columnas (ya limpios: sin tildes ni signos). Incluye los de las
// cartolas de BancoEstado y BCI y los del reporte de Mercado Pago (en inglés).
const SINONIMOS = {
  fecha: ['fecha', 'fecha movimiento', 'fecha operacion', 'fecha emision', 'f emision', 'fecha documento', 'fecha pago', 'fecha contable', 'fecha transaccion', 'fecha compra', 'fecha venta', 'dia', 'date', 'transaction date', 'cuando'],
  saldo: ['saldo', 'saldos', 'saldo diario', 'saldo contable', 'saldo disponible', 'saldo final', 'balance'],
  cargo: ['cargo', 'cargos', 'egreso', 'egresos', 'salida', 'salidas', 'gasto', 'gastos', 'debito', 'debitos', 'retiro', 'retiros', 'giros', 'monto cargo', 'cheques y otros cargos', 'cheques y cargos', 'gaste'],
  abono: ['abono', 'abonos', 'ingreso', 'ingresos', 'entrada', 'entradas', 'credito', 'creditos', 'deposito', 'depositos', 'monto abono', 'depositos y abonos', 'vendi'],
  tipo: ['tipo', 'tipo movimiento', 'tipo de movimiento', 'movimiento', 'ingreso gasto', 'ingreso o gasto', 'naturaleza', 'i e', 'e i', 'entrada salida'],
  categoria: ['categoria', 'item', 'cuenta', 'clasificacion', 'rubro', 'centro de costo', 'familia', 'tipo de gasto', 'tipo gasto', 'categoria gasto'],
  proveedor: ['proveedor', 'cliente', 'razon social', 'empresa', 'comercio', 'emisor', 'nombre', 'beneficiario', 'destinatario', 'proveedor cliente', 'cliente proveedor', 'local', 'donde'],
  descripcion: ['descripcion', 'detalle', 'glosa', 'concepto', 'comentario', 'comentarios', 'observacion', 'observaciones', 'nota', 'notas', 'producto', 'motivo', 'descripcion movimiento', 'description', 'que'],
  monto: ['monto', 'valor', 'total', 'importe', 'monto total', 'total a pagar', 'precio', 'amount', 'valor total', 'monto clp', 'monto pesos', 'total pagado', 'pago', 'net amount', 'settlement net amount', 'cuanto'],
}
// Al buscar "contiene", primero lo más específico: "Total cargos" es un cargo, no un monto
const ORDEN_CONTIENE = ['saldo', 'cargo', 'abono', 'fecha', 'categoria', 'tipo', 'proveedor', 'descripcion', 'monto']

const contiene = (texto, sin) => (sin.includes(' ') ? ` ${texto} `.includes(` ${sin} `) : texto.split(' ').includes(sin))

// Campo de un encabezado y cómo se reconoció: 'exacto' (sinónimo igual) o 'parecido' (lo contiene)
function reconocer(h) {
  const c = limpiar(h)
  if (!c || c === COLUMNA_ERROR) return null
  for (const [campo, lista] of Object.entries(SINONIMOS)) if (lista.includes(c)) return { campo, origen: 'exacto' }
  if (/\bdocumento\b|\bfolio\b|\bnumero\b|^n\b|\brut\b|\bsucursal\b|\bhora\b|\boperacion\b/.test(c)) return null
  for (const campo of ORDEN_CONTIENE) if (SINONIMOS[campo].some((s) => contiene(c, s))) return { campo, origen: 'parecido' }
  return null
}
export const campoDeEncabezado = (h) => reconocer(h)?.campo ?? null

// Asigna cada campo a una columna (primero las exactas, después las parecidas). Una columna, un campo.
function columnasDe(encabezado) {
  const cols = SIN_COLUMNAS()
  const origen = {}
  const usadas = new Set()
  const r = encabezado.map(reconocer)
  for (const pasada of ['exacto', 'parecido'])
    r.forEach((x, i) => {
      if (x?.origen === pasada && cols[x.campo] < 0 && !usadas.has(i)) {
        cols[x.campo] = i
        origen[x.campo] = pasada
        usadas.add(i)
      }
    })
  return { cols, origen }
}

// Fila del encabezado: la de las primeras 30 que reconoce más campos (con fecha y algún monto)
export function detectarEncabezado(filas) {
  let mejor = { fila: -1, puntaje: 0 }
  for (let i = 0; i < Math.min(filas.length, FILAS_BUSCAR_ENCABEZADO); i++) {
    if (vacia(filas[i])) continue
    const { cols } = columnasDe(filas[i])
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

// Tres valores reales de una columna, para mostrar junto al campo
export function muestras(filas, encabezado, col, n = 3, { fecha = false } = {}) {
  if (col < 0) return []
  return filas
    .slice(encabezado + 1)
    .map((f) => celdaDe(f ?? [], col))
    .filter(Boolean)
    .slice(0, n)
    .map((v) => (fecha && /^\d{5}(\.\d+)?$/.test(v) ? fechaCorta(leerFecha(v)) : v)) // fecha de Excel (46296) → 02-10-2026
}

/**
 * 03/10/26 o 10/03/26: si algún día pasa de 12 se sabe el orden. Montos: 1.234,5 (Chile) o 1,234.5.
 * `ambiguo` dice si hay que preguntarle al usuario (no hubo ningún voto que decidiera).
 */
export function detectarFormatos(filas, mapeo) {
  let dmy = 0
  let mdy = 0
  let fechasTexto = 0
  let cl = 0
  let us = 0
  let dudosos = 0
  for (const fila of filasDeDatos(filas, mapeo).slice(0, 300)) {
    const r = celdaDe(fila, mapeo.cols.fecha).match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/)
    if (r) {
      fechasTexto++
      if (+r[1] > 12) dmy++
      if (+r[2] > 12) mdy++
    }
    for (const k of ['monto', 'cargo', 'abono']) {
      const t = celdaDe(fila, mapeo.cols[k]).replace(/[$\s\u00a0]|clp/gi, '').replace(/^-|^\(|\)$/g, '')
      if (/^\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(t) || /^\d{1,3}\.\d{3},\d+$/.test(t) || /^\d+,\d{1,2}$/.test(t)) cl++
      else if (/^\d{1,3}(,\d{3}){2,}(\.\d+)?$/.test(t) || /^\d{1,3},\d{3}\.\d+$/.test(t)) us++
      else if (/^\d{1,3}[.,]\d{3}$/.test(t)) dudosos++ // "1.234" o "1,234": vale en ambos
    }
  }
  return {
    fecha: mdy > 0 && dmy === 0 ? 'mdy' : 'dmy',
    monto: us > cl ? 'us' : 'cl',
    ambiguo: { fecha: fechasTexto > 0 && dmy === 0 && mdy === 0, monto: cl === 0 && us === 0 && dudosos > 0 },
  }
}

// Capa 5: si el nombre no dijo nada, se mira el contenido. Una columna con más del 80 % de fechas es
// candidata a Fecha; una con más del 80 % de montos, a Monto. Queda marcada para revisar.
function inferirPorDatos(filas, mapeo) {
  const datos = filasDeDatos(filas, mapeo).slice(0, 50)
  if (datos.length < 2) return
  const ancho = Math.max(...datos.map((f) => f.length))
  const usadas = new Set(Object.values(mapeo.cols).filter((x) => x >= 0))
  const proporcion = (i, ok) => {
    const vals = datos.map((f) => celdaDe(f, i)).filter(Boolean)
    return vals.length >= 2 ? vals.filter(ok).length / vals.length : 0
  }
  if (mapeo.cols.fecha < 0)
    for (let i = 0; i < ancho; i++)
      if (!usadas.has(i) && proporcion(i, (t) => leerFecha(t) && !/^\d{1,4}$/.test(t)) >= 0.8) {
        mapeo.cols.fecha = i
        mapeo.origen.fecha = 'datos'
        usadas.add(i)
        break
      }
  // Para el monto, entre las columnas numéricas gana la de valores más grandes: un correlativo
  // (1, 2, 3…) o una columna "N°" también son números, pero no montos
  if (mapeo.cols.monto < 0 && mapeo.cols.cargo < 0 && mapeo.cols.abono < 0) {
    const enc = filas[mapeo.encabezado] ?? []
    let mejor = { i: -1, promedio: 0 }
    for (let i = 0; i < ancho; i++) {
      if (usadas.has(i) || /^n\b|numero|folio|documento|rut/.test(limpiar(enc[i]))) continue
      if (proporcion(i, (t) => !leerMonto(t).error) < 0.8) continue
      const vals = datos.map((f) => leerMonto(celdaDe(f, i))).filter((x) => !x.error && !x.vacio)
      const promedio = vals.reduce((n, x) => n + Math.abs(x.valor), 0) / vals.length
      if (promedio > mejor.promedio) mejor = { i, promedio }
    }
    if (mejor.i >= 0 && mejor.promedio >= 100) {
      mapeo.cols.monto = mejor.i
      mapeo.origen.monto = 'datos'
    }
  }
}

// Propuesta de mapeo para una hoja ya sabiendo la fila del encabezado
export function mapeoDesde(filas, encabezado, { categorias = [], alias = {}, existentes = [] } = {}) {
  const { cols, origen } = encabezado >= 0 ? columnasDe(filas[encabezado]) : { cols: SIN_COLUMNAS(), origen: {} }
  const mapeo = { plantilla: false, encabezado: Math.max(0, encabezado), cols, origen, modo: 'fijo', tipoFijo: 'gasto', catDefecto: {}, catValores: {}, fecha: 'dmy', monto: 'cl' }
  inferirPorDatos(filas, mapeo)
  if ((cols.cargo >= 0 || cols.abono >= 0) && cols.monto < 0) mapeo.modo = 'cargo_abono'
  else if (cols.monto >= 0 && cols.tipo >= 0) mapeo.modo = 'tipo'
  else if (cols.monto >= 0 && filasDeDatos(filas, mapeo).some((f) => /^\s*(-|\()/.test(celdaDe(f, cols.monto)))) mapeo.modo = 'signo'
  const { ambiguo, ...formatos } = detectarFormatos(filas, mapeo)
  Object.assign(mapeo, formatos, { ambiguo })
  mapeo.catDefecto = categoriaPorDefecto(categorias)
  mapeo.catValores = sugerirCategorias(valoresCategoria(filas, mapeo), { categorias, alias, existentes })
  return mapeo
}

const visiblesDe = (categorias, tipo) => categorias.filter((c) => !c.oculta && (!tipo || c.tipo === tipo))

function categoriaPorDefecto(categorias) {
  const elegir = (tipo, nombre) => (visiblesDe(categorias, tipo).find((c) => normalizar(c.nombre) === nombre) ?? visiblesDe(categorias, tipo).at(-1))?.id ?? null
  return { gasto: elegir('gasto', 'otros gastos'), ingreso: elegir('ingreso', 'otros ingresos') }
}

// Libro diario contable: Debe y Haber con asiento o cuenta. Es otro dominio (partida doble): se
// detecta y se explica, no se importa.
function esLibroDiario(filas) {
  return filas.slice(0, FILAS_BUSCAR_ENCABEZADO).some((f) => {
    const c = (f ?? []).map(limpiar)
    return c.includes('debe') && c.includes('haber') && c.some((x) => /\basiento\b|\bcuenta\b|\bglosa\b/.test(x))
  })
}

// Fila del encabezado de una hoja con el mismo formato (otra hoja del libro), o -1
function encabezadoEn(filas, mapeo, huellaBase) {
  if (mapeo.plantilla) {
    const e = revisarEstructura(filas)
    return e.ok ? e.fila : -1
  }
  return filas.slice(0, FILAS_BUSCAR_ENCABEZADO).findIndex((f) => f && !vacia(f) && huella(f) === huellaBase)
}

// ¿Hay que mostrar la pantalla de mapeo? Si falta la fecha o el monto, o si se adivinaron por los datos.
export function requiereMapeo(mapeo) {
  if (faltantesMapeo(mapeo).length) return true
  const o = mapeo.origen ?? {}
  return o.fecha === 'datos' || o.monto === 'datos'
}

/**
 * Analiza el archivo: elige la hoja, reconoce la plantilla o un formato guardado, y si no, propone
 * un mapeo. Devuelve { hoja, mismas, mapeo, plantilla, perfil, reconocido, requiereMapeo, libroDiario }.
 *   mismas → otras hojas visibles con el mismo formato (una hoja por mes): se ofrecen junto a la elegida
 *   forzarHoja → el usuario eligió otra hoja en el selector
 */
export function analizar(hojas, { categorias = [], alias = {}, perfiles = [], existentes = [], forzarHoja = null } = {}) {
  const indices = forzarHoja !== null && forzarHoja !== undefined ? [forzarHoja] : hojas.map((_, i) => i)
  const ctx = { categorias, alias, existentes }
  const terminar = (r) => {
    const base = huella(hojas[r.hoja].filas[r.mapeo.encabezado])
    const mismas = hojas.map((h, i) => i).filter((i) => i !== r.hoja && encabezadoEn(hojas[i].filas, r.mapeo, base) >= 0)
    return { ...r, mismas, requiereMapeo: requiereMapeo(r.mapeo), libroDiario: false }
  }
  // 1. La plantilla (camino recomendado)
  for (const h of indices) {
    const e = revisarEstructura(hojas[h].filas)
    if (e.ok) return terminar({ hoja: h, plantilla: true, perfil: null, reconocido: true, mapeo: mapeoPlantilla(e) })
  }
  // 2. Un formato que la empresa ya guardó
  for (const perfil of perfiles)
    for (const h of indices) {
      const filas = hojas[h].filas
      const i = filas.slice(0, FILAS_BUSCAR_ENCABEZADO).findIndex((f) => f && !vacia(f) && huella(f) === perfil.huella)
      if (i < 0) continue
      const mapeo = { ...perfil.mapeo, cols: { ...perfil.mapeo.cols }, encabezado: i, catValores: {}, origen: {} }
      for (const k of Object.keys(mapeo.cols)) if (mapeo.cols[k] >= 0) mapeo.origen[k] = 'perfil'
      mapeo.catValores = sugerirCategorias(valoresCategoria(filas, mapeo), ctx)
      return terminar({ hoja: h, plantilla: false, perfil: { id: perfil.id, nombre: perfil.nombre }, reconocido: true, mapeo })
    }
  // Libro diario: se explica en vez de importar
  if (indices.some((h) => esLibroDiario(hojas[h].filas))) return { libroDiario: true }
  // 3. Planilla propia nueva: la hoja donde mejor se reconoce un encabezado, ponderada por sus filas
  let mejor = { hoja: indices[0], fila: -1, puntaje: 0 }
  for (const h of indices) {
    const d = detectarEncabezado(hojas[h].filas)
    const puntaje = d.puntaje * Math.log(2 + hojas[h].filas.length - d.fila)
    if (d.fila >= 0 && puntaje > mejor.puntaje) mejor = { hoja: h, fila: d.fila, puntaje }
  }
  const filas = hojas[mejor.hoja].filas
  const fila = mejor.fila >= 0 ? mejor.fila : Math.max(0, filas.findIndex((f) => !vacia(f)))
  return terminar({ hoja: mejor.hoja, plantilla: false, perfil: null, reconocido: mejor.fila >= 0, mapeo: mapeoDesde(filas, fila, ctx) })
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

const TOTALES = /^(sub ?)?total(es)?\b|^saldo\b|^resumen\b|^suma\b|^total general\b|^semana \d+\b/
export const SIN_RESULTADO = 'El monto es una fórmula sin resultado guardado: abre la planilla en Excel o Google Sheets y guárdala de nuevo como .xlsx.'

/**
 * Interpreta y valida cada fila de UNA hoja con el mapeo. Devuelve { filas, ignoradas, saldos }.
 *   filas[]: { key, hoja, n, valores, celdas, errores, aviso, nota, duplicado, catPendiente, huella, datos }
 *     key        → identifica la fila en el archivo (hoja:fila), para excluirla al confirmar
 *     n          → número de fila en Excel
 *     duplicado  → 'exacto' (ya importada antes: queda fuera por defecto), 'archivo' (igual a otra
 *                  fila del archivo) o 'posible' (parecida a un movimiento existente); se importan
 *     catPendiente → texto de categoría de la planilla que falta asociar (se arregla en la revisión)
 *     huella     → tipo|fecha|monto|descripción|n.º de ocurrencia: dos cafés iguales el mismo día
 *                  son dos movimientos, pero re-subir el mismo archivo no duplica nada
 *   ignoradas[]: { key, hoja, n, motivo, texto, oculta } filas que no son movimientos
 *   saldos: { cuadran: true|false|null, orden: 'asc'|'desc'|null, filas } verificación con la columna de saldo
 *
 * ctx.hoja (metadatos de la hoja: ocultas, sinValor, sumas), ctx.incluirOcultas y ctx.estado
 * (compartido entre hojas del mismo archivo, para repetidos y huellas) son opcionales.
 */
export function interpretar(filas, mapeo, { categorias, existentes = [], hoja = {}, indiceHoja = 0, nombreHoja = null, incluirOcultas = false, estado = null }) {
  const { cols, modo, plantilla } = mapeo
  const hoy = hoyISO()
  const est = estado ?? { vistos: new Map(), conteo: new Map() }
  const llaveDup = (d) => `${d.tipo}|${d.fecha}|${d.monto}|${normalizar(d.proveedor)}`
  const vivos = existentes.filter((m) => !m.eliminado)
  const previos = new Map(vivos.map((m) => [llaveDup(m), m]))
  const huellasPrevias = new Set(vivos.map((m) => m.huella_importacion).filter(Boolean))
  const ocultas = new Set(hoja.ocultas ?? [])
  const sinValor = new Set(hoja.sinValor ?? [])
  const sumas = new Set(hoja.sumas ?? [])
  const colsMonto = ['monto', 'cargo', 'abono'].map((k) => cols[k]).filter((x) => x >= 0)
  // Categoría más usada con cada proveedor: se usa cuando la fila no trae categoría
  const porProveedor = new Map()
  for (const m of vivos) {
    if (!m.proveedor) continue
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
  const conSaldo = []

  filas.forEach((fila, i) => {
    if (i <= mapeo.encabezado || vacia(fila)) return
    const key = `${indiceHoja}:${i + 1}`
    const base = { key, hoja: nombreHoja, n: i + 1 }
    const c = (k) => celdaDe(fila, cols[k])
    const textoMonto = modo === 'cargo_abono' ? c('cargo') || c('abono') : c('monto')
    const v = { fecha: c('fecha'), monto: textoMonto, tipo: c('tipo'), categoria: c('categoria'), proveedor: c('proveedor'), descripcion: c('descripcion') }
    const primeras = () => fila.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 3).join(' · ')

    // Filas que no son movimientos: ocultas por un filtro, totales, saldos, títulos, encabezado repetido
    if (ocultas.has(i) && !incluirOcultas) return ignoradas.push({ ...base, motivo: 'Oculta por un filtro', texto: primeras(), oculta: true })
    if (colsMonto.some((x) => sumas.has(`${i}:${x}`))) return ignoradas.push({ ...base, motivo: 'Fila de totales (fórmula de suma)', texto: primeras() })
    const fecha = v.fecha ? leerFecha(v.fecha, mapeo.fecha) : null
    if (!fecha) {
      const norm = fila.map(normalizar).filter(Boolean)
      if (norm.some((x) => TOTALES.test(x))) return ignoradas.push({ ...base, motivo: 'Fila de totales o saldo', texto: primeras() })
      if (campoDeEncabezado(v.fecha) === 'fecha') return ignoradas.push({ ...base, motivo: 'Encabezado repetido', texto: primeras() })
      if (!v.fecha && !c('monto') && !c('cargo') && !c('abono')) return ignoradas.push({ ...base, motivo: 'Sin fecha ni monto (título o nota)', texto: primeras() })
    }

    const errores = []
    const notas = []
    if (!v.fecha) errores.push('Falta la fecha.')
    else if (!fecha) errores.push(`«${v.fecha}» no es una fecha válida (usa DD-MM-AAAA).`)
    else if (fecha > hoy) errores.push(`La fecha ${fechaCorta(fecha)} es posterior a hoy.`)
    if (fecha) v.fecha = fechaCorta(fecha) // un número de fecha de Excel (45935) se muestra como DD-MM-AAAA

    // Monto y tipo, según cómo los trae la planilla
    let monto = null
    let tipo = null
    const revisarMonto = (m, texto) => {
      if (m.error) return errores.push(m.error)
      if (m.redondeado !== null) notas.push(`Redondeamos ${texto} a ${clp(m.valor)}.`)
      return null
    }
    if (colsMonto.some((x) => sinValor.has(`${i}:${x}`))) errores.push(SIN_RESULTADO)
    else if (modo === 'cargo_abono') {
      const cargo = leerMonto(c('cargo'), mapeo.monto)
      const abono = leerMonto(c('abono'), mapeo.monto)
      const hayCargo = !cargo.vacio && !cargo.error && cargo.valor !== 0
      const hayAbono = !abono.vacio && !abono.error && abono.valor !== 0
      if (cargo.error) errores.push(cargo.error)
      else if (abono.error) errores.push(abono.error)
      else if (hayCargo && hayAbono) errores.push('Tiene un gasto y un ingreso a la vez: sepáralos en dos filas.')
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
    }
    if (modo === 'fijo') tipo = mapeo.tipoFijo
    if (modo === 'tipo') {
      tipo = TIPOS[normalizar(v.tipo)] ?? null
      if (!v.tipo) errores.push('Falta el tipo (ingreso o gasto).')
      else if (!tipo) errores.push(`El tipo «${v.tipo}» no existe: usa «ingreso» o «gasto».`)
    }
    if (monto !== null && monto > MAX_MONTO) errores.push('Ese monto es demasiado grande.')
    if (tipo) v.tipo = tipo

    // Categoría: la de la columna (por nombre o por lo que eligió el usuario) o una por defecto
    let categoria = null
    let catPendiente = null
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
        } else if (mismas.length) errores.push(`«${mismas[0].nombre}» está oculta en tu empresa: muéstrala en Categorías o elige otra.`)
        else {
          catPendiente = v.categoria
          errores.push(`Falta elegir a qué categoría corresponde «${v.categoria}».`)
        }
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

    const fila_ = { ...base, valores: v, celdas: fila, errores, aviso: null, nota: notas.join(' ') || null, duplicado: null, catPendiente, huella: null, datos: null }
    if (!errores.length) {
      fila_.datos = { fecha, monto, tipo, categoria_id: categoria.id, proveedor: v.proveedor, descripcion, tipo_documento: 'otro' }
      const baseHuella = `${tipo}|${fecha}|${monto}|${normalizar(descripcion)}`
      const ocurrencia = est.conteo.get(baseHuella) ?? 0
      est.conteo.set(baseHuella, ocurrencia + 1)
      fila_.huella = `${baseHuella}|${ocurrencia}`
      const llave = llaveDup(fila_.datos)
      if (huellasPrevias.has(fila_.huella)) {
        fila_.duplicado = 'exacto'
        fila_.aviso = 'Ya la importaste antes (mismo archivo o un período que se solapa). Queda fuera, salvo que la marques.'
      } else if (est.vistos.has(llave)) {
        fila_.duplicado = 'archivo'
        fila_.aviso = `Igual a la ${est.vistos.get(llave)} de este archivo. Se importan las dos.`
      } else if (previos.has(llave)) {
        const m = previos.get(llave)
        fila_.duplicado = 'posible'
        fila_.aviso = `Ya hay un ${m.tipo} parecido el ${fechaCorta(m.fecha)}${m.descripcion ? ` («${m.descripcion}»)` : ''}.`
      }
      est.vistos.set(llave, nombreHoja ? `fila ${fila_.n} de ${nombreHoja}` : `fila ${fila_.n}`)
      const s = cols.saldo >= 0 ? leerMonto(c('saldo'), mapeo.monto) : null
      if (s && !s.vacio && !s.error) conSaldo.push({ delta: tipo === 'ingreso' ? monto : -monto, saldo: s.valor })
    }
    salida.push(fila_)
  })
  return { filas: salida, ignoradas, saldos: verificarSaldos(conSaldo) }
}

// Los saldos cuadran si saldo anterior + abono − cargo = saldo en al menos el 95 % de las filas,
// leídas de la más antigua a la más nueva ('asc') o al revés ('desc').
function verificarSaldos(lista) {
  if (lista.length < 3) return { cuadran: null, orden: null, filas: lista.length }
  let asc = 0
  let desc = 0
  for (let i = 1; i < lista.length; i++) {
    if (lista[i - 1].saldo + lista[i].delta === lista[i].saldo) asc++
    if (lista[i].saldo + lista[i - 1].delta === lista[i - 1].saldo) desc++
  }
  const total = lista.length - 1
  const orden = asc >= desc ? 'asc' : 'desc'
  return { cuadran: Math.max(asc, desc) / total >= 0.95, orden, filas: lista.length }
}

/**
 * Varias hojas con el mismo formato (una por mes): se interpretan juntas, con los repetidos y las
 * huellas compartidos. `seleccion` = índices de hojas; la primera es la del mapeo.
 */
export function interpretarHojas(hojas, seleccion, mapeo, ctx) {
  const estado = { vistos: new Map(), conteo: new Map() }
  const principal = hojas[seleccion[0]]
  const base = huella(principal.filas[mapeo.encabezado])
  const varias = seleccion.length > 1
  const total = { filas: [], ignoradas: [], saldos: [], combinadas: 0 }
  for (const h of seleccion) {
    const hoja = hojas[h]
    const enc = h === seleccion[0] ? mapeo.encabezado : encabezadoEn(hoja.filas, mapeo, base)
    if (enc < 0) continue
    const r = interpretar(hoja.filas, { ...mapeo, encabezado: enc }, { ...ctx, hoja, indiceHoja: h, nombreHoja: varias ? hoja.nombre : null, estado })
    total.filas.push(...r.filas)
    total.ignoradas.push(...r.ignoradas)
    total.saldos.push(r.saldos)
    total.combinadas += hoja.combinadas ?? 0
  }
  const verificadas = total.saldos.filter((s) => s.cuadran !== null)
  const saldos = verificadas.length ? { cuadran: verificadas.every((s) => s.cuadran), orden: verificadas[0].orden, filas: verificadas.reduce((n, s) => n + s.filas, 0) } : { cuadran: null }
  return { filas: total.filas, ignoradas: total.ignoradas, saldos, combinadas: total.combinadas }
}

// ---------------------------------------------------------------------------------------------
// Archivos que se descargan
// ---------------------------------------------------------------------------------------------

// Comillas si hace falta, y un apóstrofo delante de lo que Excel o LibreOffice tomarían como fórmula:
// = + @ (y sus variantes de ancho completo), tabulación, retorno o salto de línea al inicio, o un
// "-" que no sea parte de un número negativo. El archivo se abre sin ejecutar nada.
const celdaCsv = (valor) => {
  let s = String(valor ?? '')
  if (/^[=+@\t\r\n＝＋－＠]/.test(s) || /^-(?![\d.,\s]*$)/.test(s)) s = `'${s}`
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
// Nombre que se propone para recordar el formato, a partir del nombre del archivo: sin la
// extensión ni la fecha del final ("caja-10-2026.xlsx" → "Caja"). Si queda muy largo se corta en
// la última palabra que cabe y se le agrega "…" y la extensión: "Control de caja del lo….xlsx".
const MAX_NOMBRE_FORMATO = 32
export const nombreSugerido = (archivo) => {
  const ext = archivo.match(/\.(csv|xlsx)$/i)?.[1].toLowerCase() ?? ''
  const base = archivo
    .replace(/\.(csv|xlsx)$/i, '')
    .replace(/[-_ ]?\d{1,2}[-_]\d{4}$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!base) return 'Mi planilla'
  const nombre = base[0].toUpperCase() + base.slice(1)
  if (nombre.length <= MAX_NOMBRE_FORMATO) return nombre
  const fin = ext ? `….${ext}` : '…'
  const cabe = nombre.slice(0, MAX_NOMBRE_FORMATO - fin.length)
  // Cortar en un espacio si no se pierde demasiado; si no, a mitad de palabra
  const espacio = cabe.lastIndexOf(' ')
  return (espacio >= cabe.length * 0.6 ? cabe.slice(0, espacio) : cabe).trimEnd() + fin
}

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
    .map((f) => [...sinError(completar(f.celdas)), `${f.hoja ? `Hoja ${f.hoja}, fila` : 'Fila'} ${f.n}: ${f.errores.join(' ')}`].map(celdaCsv).join(';'))
  const base = nombreArchivo.replace(/\.(csv|xlsx)$/i, '')
  descargar(`${base}-filas-con-error.csv`, [cabeza, ...cuerpo].join('\r\n') + '\r\n')
}

// ---------------------------------------------------------------------------------------------
// Archivos de ejemplo (lo que traería un contador). Se arman con fechas de los meses pasados.
// Los casos que el navegador no puede fabricar como archivo real (un .xls, una contraseña) se
// simulan: el ejemplo trae `rechazo` y muestra el mismo mensaje que daría el archivo de verdad.
// ---------------------------------------------------------------------------------------------

export const GRUPOS_EJEMPLOS = [
  ['plantilla', 'Con la plantilla'],
  ['propia', 'Planillas propias'],
  ['especial', 'Casos especiales'],
]

export function ejemplos(existentes) {
  const hoy = hoyISO()
  const mes = (n) => moverMes(hoy.slice(0, 7), n).split('-') // [aaaa, mm]
  const [y, m] = mes(-1)
  const dia = (d, [yy, mm] = [y, m]) => `${String(d).padStart(2, '0')}-${mm}-${yy}`
  const diaCorto = (d) => `${String(d).padStart(2, '0')}/${m}/${y.slice(2)}`
  // Un gasto que ya está en la app (el gas del mes pasado): la fila sale con aviso de repetido
  const gas = existentes.find((x) => !x.eliminado && x.proveedor === 'Gas Sur' && x.fecha.startsWith(`${y}-${m}`))
  const futuro = mes(1)
  const encabezado = ['Fecha', 'Monto', 'Tipo', 'Categoría', 'Proveedor', 'Descripción']
  const nombreMes = (yyMm) => ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].at(+yyMm[1] - 1)

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

  // Una hoja por mes, con la plantilla, y una hoja oculta de configuración que se ignora
  const hojaMes = (yyMm, base) => [
    encabezado,
    [dia(3, yyMm), String(base + 41000), 'ingreso', 'Ventas', '', `Ventas semana 1 de ${nombreMes(yyMm).toLowerCase()}`],
    [dia(5, yyMm), '420.000', 'gasto', 'Arriendo', 'Inmobiliaria Los Sauces', 'Arriendo del local'],
    [dia(9, yyMm), String(base), 'gasto', 'Insumos', 'Distribuidora Avícola del Sur', 'Pollo y aliños'],
    [dia(17, yyMm), String(base + 87000), 'ingreso', 'Ventas', '', `Ventas semana 3 de ${nombreMes(yyMm).toLowerCase()}`],
  ]
  const meses = [mes(-3), mes(-2), mes(-1)]

  // Plantilla con 3 filas ocultas por un filtro (las anuladas): no se importan, salvo que se pida
  const conFiltro = [
    encabezado,
    [dia(2), '15.990', 'gasto', 'Insumos', 'Supermercado El Trébol', 'Aceite'],
    [dia(3), '45.000', 'gasto', 'Insumos', 'Supermercado El Trébol', 'ANULADA: compra devuelta'],
    [dia(6), '182.000', 'ingreso', 'Ventas', '', 'Ventas del fin de semana'],
    [dia(8), '9.990', 'gasto', 'Servicios básicos', 'Telefonía Sur', 'Internet'],
    [dia(9), '30.000', 'gasto', 'Transporte', 'Copec', 'ANULADA: duplicada'],
    [dia(12), '25.000', 'gasto', 'Marketing', 'Imprenta Rápida', 'Tarjetas de presentación'],
    [dia(15), '120.000', 'gasto', 'Remuneraciones', 'Pedro Sánchez', 'PENDIENTE: falta boleta'],
    [dia(20), '210.400', 'ingreso', 'Ventas', '', 'Ventas de la semana'],
  ]

  // Plantilla con un título arriba (antes no se reconocía como plantilla)
  const conTitulo = [
    ['Rotisería El Buen Sabor — Movimientos del mes'],
    [`Preparado por la contadora · ${m}/${y}`],
    [],
    encabezado,
    [dia(4), '64.300', 'gasto', 'Insumos', 'Supermercado El Trébol', 'Compra semanal'],
    [dia(11), '58.300', 'gasto', 'Servicios básicos', 'Compañía Eléctrica Regional', 'Electricidad'],
    [dia(18), '312.000', 'ingreso', 'Ventas', '', 'Ventas de la semana'],
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

  // Cartola del banco: cargos, abonos y saldo. Los saldos cuadran: se informa.
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

  // Categoría combinada por grupo (D2:D5 = "Insumos"): se completa hacia abajo
  const combinada = [
    encabezado,
    [dia(2), '18.990', 'gasto', 'Insumos', 'Supermercado El Trébol', 'Servilletas'],
    [dia(3), '23.400', 'gasto', '', 'Verdulería Don Lucho', 'Verduras'],
    [dia(4), '86.990', 'gasto', '', 'Distribuidora Avícola del Sur', 'Pollo'],
    [dia(5), '12.300', 'gasto', '', 'Panadería La Espiga', 'Pan'],
    [dia(6), '58.300', 'gasto', 'Servicios básicos', 'Compañía Eléctrica Regional', 'Luz'],
    [dia(7), '21.900', 'gasto', '', 'Aguas del Valle', 'Agua'],
    [dia(10), '412.000', 'ingreso', 'Ventas', '', 'Ventas semana 1'],
    [dia(17), '398.500', 'ingreso', '', '', 'Ventas semana 2'],
  ]
  const hojaCombinada = { nombre: 'Movimientos', filas: combinada }
  hojaCombinada.combinadas = aplicarCombinadas(combinada, ['D2:D5', 'D6:D7', 'D8:D9'])

  // Columnas con nombres que no conocemos: se reconocen por sus datos y se piden revisar
  const raros = [
    ['N°', 'Anotado el', 'Lo que pasó', 'Plata', 'A quién'],
    ['1', dia(2), 'Compra de harina', '32.000', 'Molino Sur'],
    ['2', dia(4), 'Gas para el horno', '52.900', 'Gas Sur'],
    ['3', dia(9), 'Bolsas de papel', '8.700', 'Bazar Mi Casa'],
    ['4', dia(15), 'Levadura y sal', '11.200', 'Molino Sur'],
  ]

  // Reporte de Mercado Pago: columnas en inglés, montos con signo y punto decimal
  const mp = [
    ['TRANSACTION_DATE', 'SOURCE_ID', 'DESCRIPTION', 'SETTLEMENT_NET_AMOUNT'],
    [`${y}-${m}-05T13:22:10.000-03:00`, '58210377', 'Venta con QR', '24990.00'],
    [`${y}-${m}-05T19:02:44.000-03:00`, '58211002', 'Venta con tarjeta', '41500.00'],
    [`${y}-${m}-06T00:00:00.000-03:00`, '58211871', 'Comisión por venta', '-1997.42'],
    [`${y}-${m}-12T11:40:01.000-03:00`, '58290115', 'Venta con tarjeta', '63200.00'],
    [`${y}-${m}-13T00:00:00.000-03:00`, '58290990', 'Comisión por venta', '-3041.18'],
  ]

  // Montos que son fórmulas de otro programa que no guardó el resultado (sinValor)
  const formulas = [encabezado, ...[1, 2, 3, 4, 5].map((d) => [dia(d + 2), '', 'gasto', 'Insumos', 'Supermercado El Trébol', `Compra ${d}`])]
  const hojaFormulas = { nombre: 'Movimientos', filas: formulas, sinValor: [1, 2, 3, 4, 5].map((r) => `${r}:1`) }

  const libroDiario = [
    ['Libro diario — Octubre'],
    ['Fecha', 'N° Asiento', 'Cuenta', 'Glosa', 'Debe', 'Haber'],
    [dia(2), '1', 'Caja', 'Venta al contado', '150.000', ''],
    [dia(2), '1', 'Ventas', 'Venta al contado', '', '150.000'],
    [dia(5), '2', 'Arriendos', 'Pago arriendo', '420.000', ''],
    [dia(5), '2', 'Banco', 'Pago arriendo', '', '420.000'],
  ]

  const ej = (grupo, id, nombre, tipo, titulo, detalle, hojas, extra = {}) => ({ grupo, id, nombre, tipo, titulo, detalle, hojas, avisos: {}, ...extra })
  return [
    ej('plantilla', 'caja-chica', `caja-chica-${m}-${y}.xlsx`, 'xlsx', 'Caja chica', `${cajaChica.length - 2} filas, algunas con errores`, [{ nombre: 'Movimientos', filas: cajaChica }]),
    ej('plantilla', 'ventas', `ventas-tarjeta-${m}-${y}.csv`, 'csv', 'Ventas con tarjeta', '5 filas bien · impórtalo dos veces', [{ nombre: 'CSV', filas: ventas }]),
    ej('plantilla', 'meses', `caja-trimestre-${y}.xlsx`, 'xlsx', 'Una hoja por mes', '3 hojas + 1 oculta', meses.map((mm, i) => ({ nombre: nombreMes(mm), filas: hojaMes(mm, 150000 + i * 9000) })), { avisos: { hojasOcultas: 1 } }),
    ej('plantilla', 'filtro', `caja-filtrada-${m}-${y}.xlsx`, 'xlsx', 'Filas ocultas por un filtro', '3 filas ocultas', [{ nombre: 'Movimientos', filas: conFiltro, ocultas: [2, 5, 7] }]),
    ej('plantilla', 'titulo', `movimientos-con-titulo-${m}-${y}.xlsx`, 'xlsx', 'Plantilla con título arriba', 'Se reconoce igual', [{ nombre: 'Movimientos', filas: conTitulo }]),
    ej('plantilla', 'combinada', `caja-por-grupos-${m}-${y}.xlsx`, 'xlsx', 'Categoría en celdas combinadas', 'Una categoría por grupo', [hojaCombinada]),
    ej('propia', 'propia', `control-caja-el-fogon-${m}-${y}.xlsx`, 'xlsx', 'Planilla propia del local', 'Sus columnas y sus ítems', [
      { nombre: 'Caja', filas: propia },
      { nombre: 'Resumen', filas: [['Resumen del mes'], ['Ingresos', '782.500'], ['Egresos', '454.835']] },
    ]),
    ej('propia', 'cartola', `cartola-banco-${m}-${y}.xlsx`, 'xlsx', 'Cartola del banco', 'Cargos, abonos y saldos', [{ nombre: 'Cartola', filas: cartola }]),
    ej('propia', 'mp', `reporte-mercado-pago-${m}-${y}.csv`, 'csv', 'Reporte de Mercado Pago', 'Columnas en inglés', [{ nombre: 'CSV', filas: mp }]),
    ej('propia', 'raros', `cuaderno-panaderia-${m}-${y}.xlsx`, 'xlsx', 'Columnas con otros nombres', 'Se reconocen por los datos', [{ nombre: 'Hoja1', filas: raros }]),
    ej('especial', 'formulas', `exportado-otro-programa-${m}-${y}.xlsx`, 'xlsx', 'Fórmulas sin resultado', 'De un programa que no las calculó', [hojaFormulas]),
    ej('especial', 'diario', `libro-diario-${m}-${y}.xlsx`, 'xlsx', 'Libro diario Debe/Haber', 'Se explica, no se importa', [{ nombre: 'Libro diario', filas: libroDiario }]),
    ej('especial', 'xls', `cartola-banco-de-chile-${m}-${y}.xls`, 'xls', 'Excel antiguo (.xls)', 'Simulado', [], { rechazo: 'xls' }),
    ej('especial', 'clave', `caja-con-clave-${m}-${y}.xlsx`, 'xlsx', 'Excel con contraseña', 'Simulado', [], { rechazo: 'protegido' }),
    ej('especial', 'pdf', `cartola-${m}-${y}.xlsx`, 'xlsx', 'PDF renombrado como .xlsx', 'Simulado', [], { rechazo: 'pdf' }),
  ]
}
