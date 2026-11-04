// PROTOTIPO HU10–HU13: importación masiva desde CSV/XLSX.
// En la app real, leer y validar lo hace el backend (POST /importaciones/validar y POST
// /importaciones, KONTADORIA-67/69/72). Aquí corre en el navegador con las MISMAS reglas, para
// probarlas antes de construirlas. Nada sale del navegador.
import { fechaCorta, hoyISO, moverMes } from './format'

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

// "Categoría " → "categoria": sin tildes, sin mayúsculas, sin espacios de sobra
export const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

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

// XLSX mínimo: un .xlsx es un ZIP con XML adentro. Se lee la primera hoja con las APIs del
// navegador (DecompressionStream), sin librerías. En el backend se usará openpyxl.
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

const columnaDe = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

async function leerXlsx(archivo) {
  const leer = await leerZip(await archivo.arrayBuffer())
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml')
  const libro = xml(await leer('xl/workbook.xml'))
  const hoja1 = libro.getElementsByTagName('sheet')[0]
  const rid = hoja1.getAttribute('r:id') ?? hoja1.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const rels = xml(await leer('xl/_rels/workbook.xml.rels'))
  const destino = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid).getAttribute('Target')
  const ruta = destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`
  const compartidosXml = await leer('xl/sharedStrings.xml')
  const compartidos = compartidosXml
    ? [...xml(compartidosXml).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''))
    : []
  const hoja = xml(await leer(ruta))
  const filas = []
  for (const row of hoja.getElementsByTagName('row')) {
    const fila = []
    for (const c of row.getElementsByTagName('c')) {
      const t = c.getAttribute('t')
      const valor = c.getElementsByTagName('v')[0]?.textContent ?? ''
      let texto = valor
      if (t === 's') texto = compartidos[+valor] ?? ''
      else if (t === 'inlineStr') texto = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('')
      fila[columnaDe(c.getAttribute('r'))] = texto
    }
    filas[+row.getAttribute('r') - 1] = Array.from(fila, (x) => x ?? '')
  }
  return Array.from(filas, (x) => x ?? [])
}

// Devuelve { tipo: 'csv'|'xlsx', filas: string[][] }. Lanza Error con un mensaje para mostrar.
export async function leerArchivo(archivo) {
  const ext = archivo.name.split('.').pop().toLowerCase()
  if (!['csv', 'xlsx'].includes(ext)) throw new Error('Ese archivo no es una planilla CSV ni XLSX.')
  if (archivo.size > MAX_MB * 1024 * 1024) throw new Error(`La planilla pesa más de ${MAX_MB} MB.`)
  if (ext === 'csv') return { tipo: 'csv', filas: leerCsv(await textoDe(archivo)) }
  try {
    return { tipo: 'xlsx', filas: await leerXlsx(archivo) }
  } catch {
    throw new Error('No pudimos abrir este Excel. Guárdalo de nuevo como .xlsx (no .xls) y vuelve a subirlo.')
  }
}

// ---------------------------------------------------------------------------------------------
// Validación (HU11). Mismas reglas que el formulario manual (MovimientoForm) más las del archivo.
// ---------------------------------------------------------------------------------------------

const vacia = (fila) => fila.every((c) => !String(c ?? '').trim())

// Estructura: el encabezado debe traer las columnas de la plantilla (en cualquier orden)
// Columna que agrega el archivo de filas con error (descargarErrores): quien corrige ese archivo
// y lo vuelve a subir no tiene que borrarla. Se ignora; cualquier otra columna de más se rechaza.
const COLUMNA_ERROR = 'error'

export function revisarEstructura(filas) {
  const idx = filas.findIndex((f) => !vacia(f))
  const encabezado = idx < 0 ? [] : filas[idx].map(normalizar)
  const faltan = COLUMNAS.filter((c) => !encabezado.includes(c.clave)).map((c) => c.nombre)
  const sobran = (idx < 0 ? [] : filas[idx]).filter(
    (h, i) => h && encabezado[i] !== COLUMNA_ERROR && !COLUMNAS.some((c) => c.clave === encabezado[i]),
  )
  return { ok: idx >= 0 && faltan.length === 0 && sobran.length === 0, faltan, sobran, encabezado: idx < 0 ? [] : filas[idx], fila: idx }
}

// "05-10-2026", "5/10/2026", "2026-10-05" o un número de fecha de Excel (45935) → 'AAAA-MM-DD'
function leerFecha(texto) {
  const t = String(texto).trim()
  let d, m, y
  let r
  if ((r = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [, d, m, y] = r
  else if ((r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) [, y, m, d] = r
  else if (/^\d{5}(\.\d+)?$/.test(t)) {
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(+t) * 86400000) // serial de Excel
    return f.toISOString().slice(0, 10)
  } else return null
  const f = new Date(Date.UTC(+y, +m - 1, +d))
  if (f.getUTCFullYear() !== +y || f.getUTCMonth() !== +m - 1 || f.getUTCDate() !== +d) return null
  return f.toISOString().slice(0, 10)
}

// "$ 12.990" → 12990 · "12990,00" → 12990 · "12,5" → decimales · "doce mil" → no numérico
function leerMontoCelda(texto) {
  let t = String(texto).replace(/[$\s]/g, '').replace(/CLP/i, '')
  if (!t) return { error: 'Falta el monto.' }
  if (/^-/.test(t) || /^\(.*\)$/.test(t)) return { error: 'El monto debe ser mayor que cero (el tipo dice si es gasto).' }
  if (/^\d+\.\d+$/.test(t) && !/^\d{1,3}(\.\d{3})+$/.test(t)) {
    // Número de Excel con punto decimal (12990.5): solo vale si es entero
    if (!/\.0+$/.test(t)) return { error: 'El monto tiene decimales: los pesos van sin decimales.' }
    t = t.replace(/\.0+$/, '')
  }
  if (/,\d+$/.test(t)) {
    if (!/,0+$/.test(t)) return { error: 'El monto tiene decimales: los pesos van sin decimales.' }
    t = t.replace(/,0+$/, '')
  }
  if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(t)) return { error: `«${texto}» no es un monto.` }
  const n = Number(t.replace(/\./g, ''))
  if (n === 0) return { error: 'El monto debe ser mayor que cero.' }
  if (n > MAX_MONTO) return { error: 'Ese monto es demasiado grande.' }
  return { valor: n }
}

const TIPOS = { ingreso: 'ingreso', ingresos: 'ingreso', gasto: 'gasto', gastos: 'gasto' }

/**
 * Valida cada fila. Devuelve { filas: [{ n, valores, errores, aviso, datos }] }.
 *   n        → número de fila en Excel (el encabezado es la 1)
 *   valores  → lo que venía en el archivo, por columna (para el archivo de errores)
 *   errores  → motivos; si hay alguno, la fila NO se importa
 *   aviso    → posible repetido: se importa igual, pero conviene mirarlo
 *   datos    → el movimiento listo para guardar (solo si no hay errores)
 */
export function validar(filas, estructura, { categorias, existentes = [] }) {
  const pos = Object.fromEntries(COLUMNAS.map((c) => [c.clave, estructura.encabezado.map(normalizar).indexOf(c.clave)]))
  const hoy = hoyISO()
  const vistos = new Map()
  const llaveDup = (d) => `${d.tipo}|${d.fecha}|${d.monto}|${normalizar(d.proveedor)}`
  const previos = new Map(existentes.filter((m) => !m.eliminado).map((m) => [llaveDup(m), m]))
  const salida = []

  filas.forEach((fila, i) => {
    if (i <= estructura.fila || vacia(fila)) return
    const v = Object.fromEntries(COLUMNAS.map((c) => [c.clave, String(fila[pos[c.clave]] ?? '').trim()]))
    const errores = []

    const fecha = v.fecha ? leerFecha(v.fecha) : null
    if (!v.fecha) errores.push('Falta la fecha.')
    else if (!fecha) errores.push(`«${v.fecha}» no es una fecha válida (usa DD-MM-AAAA).`)
    else if (fecha > hoy) errores.push(`La fecha ${fechaCorta(fecha)} es futura.`)
    if (fecha) v.fecha = fechaCorta(fecha) // un número de fecha de Excel (45935) se muestra como DD-MM-AAAA

    const monto = leerMontoCelda(v.monto)
    if (monto.error) errores.push(monto.error)

    const tipo = TIPOS[normalizar(v.tipo)]
    if (!v.tipo) errores.push('Falta el tipo (ingreso o gasto).')
    else if (!tipo) errores.push(`El tipo «${v.tipo}» no existe: usa «ingreso» o «gasto».`)

    let categoria = null
    if (!v.categoria) errores.push('Falta la categoría.')
    else {
      const mismas = categorias.filter((c) => normalizar(c.nombre) === normalizar(v.categoria))
      categoria = mismas.find((c) => !tipo || c.tipo === tipo) ?? null
      if (!mismas.length) errores.push(`No existe la categoría «${v.categoria}». Usa una de tus categorías o pide que la creen.`)
      else if (!categoria) errores.push(`«${mismas[0].nombre}» es una categoría de ${mismas[0].tipo === 'gasto' ? 'gastos' : 'ingresos'}, no de ${tipo === 'gasto' ? 'gastos' : 'ingresos'}.`)
    }

    if (v.proveedor.length > 150) errores.push('El proveedor tiene más de 150 caracteres.')
    if (!v.descripcion) errores.push('Falta la descripción.')
    else if (v.descripcion.length > 500) errores.push('La descripción tiene más de 500 caracteres.')

    const fila_ = { n: i + 1, valores: v, errores, aviso: null, datos: null }
    if (!errores.length) {
      fila_.datos = {
        fecha,
        monto: monto.valor,
        tipo,
        categoria_id: categoria.id,
        proveedor: v.proveedor,
        descripcion: v.descripcion,
        tipo_documento: 'otro', // la plantilla no lo trae; en la base es obligatorio
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
  return { filas: salida }
}

// ---------------------------------------------------------------------------------------------
// Archivos que se descargan
// ---------------------------------------------------------------------------------------------

const celdaCsv = (s) => (/[;"\n\r]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s))

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

// HU11: las filas con error, con su motivo, para corregirlas y volver a subirlas
export function descargarErrores(nombreArchivo, filas) {
  const cabeza = [...COLUMNAS.map((c) => c.nombre), COLUMNA_ERROR].join(';')
  const cuerpo = filas
    .filter((f) => f.errores.length)
    .map((f) => [...COLUMNAS.map((c) => f.valores[c.clave]), `Fila ${f.n}: ${f.errores.join(' ')}`].map(celdaCsv).join(';'))
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
    [dia(15), '45.000', 'egreso', 'Remuneraciones', 'Pedro Sánchez', 'Ayudante fin de semana'],
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

  // Cartola del banco: no usa la plantilla → error de estructura (HU10)
  const cartola = [
    ['Fecha', 'Descripción', 'N° Documento', 'Cargos', 'Abonos', 'Saldo'],
    [dia(2), 'TRASPASO A TERCEROS', '000123', '89.000', '', '1.254.300'],
    [dia(4), 'DEPOSITO EN EFECTIVO', '000124', '', '35.000', '1.289.300'],
  ]

  return [
    {
      id: 'caja-chica',
      nombre: `caja-chica-${m}-${y}.xlsx`,
      tipo: 'xlsx',
      titulo: 'Caja chica del contador',
      detalle: `${cajaChica.length - 2} filas, algunas con errores`,
      filas: cajaChica,
    },
    { id: 'ventas', nombre: `ventas-tarjeta-${m}-${y}.csv`, tipo: 'csv', titulo: 'Ventas con tarjeta', detalle: '5 filas, todas bien', filas: ventas },
    { id: 'cartola', nombre: `cartola-banco-${m}-${y}.xlsx`, tipo: 'xlsx', titulo: 'Cartola del banco', detalle: 'No usa la plantilla', filas: cartola, falla: true },
  ]
}
