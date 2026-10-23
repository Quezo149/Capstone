// PROTOTIPO: "base de datos" falsa en localStorage, con una empresa de ejemplo.
// Reemplaza a func-kontadoria + Azure SQL. Ningún dato sale del navegador.
import { hoyISO, moverMes } from './format'

const KEY = 'kontadoria-proto-db-v1'
const ROL_KEY = 'kontadoria-proto-rol'

// Personas de ejemplo (inventadas): una por rol, para el selector "Ver como"
export const PERSONAS = {
  admin: { id: 'u-admin', nombre: 'Carmen Rojas', email: 'carmen@ejemplo.cl' },
  contador: { id: 'u-contador', nombre: 'Jorge Soto', email: 'jorge.contador@ejemplo.cl' },
  empleado: { id: 'u-empleado', nombre: 'Paula Díaz', email: 'paula@ejemplo.cl' },
}

// Mismas predefinidas y colores que db/migrations/0005_categorias.sql
const PREDEFINIDAS = [
  ['ventas', 'Ventas', 'ingreso', '#17804f'],
  ['otros-ingresos', 'Otros ingresos', 'ingreso', '#5aa37f'],
  ['insumos', 'Insumos', 'gasto', '#0f6e55'],
  ['arriendo', 'Arriendo', 'gasto', '#2f5d8a'],
  ['remuneraciones', 'Remuneraciones', 'gasto', '#7a4fa0'],
  ['servicios', 'Servicios básicos', 'gasto', '#c48a12'],
  ['transporte', 'Transporte', 'gasto', '#b8382a'],
  ['mantencion', 'Mantención', 'gasto', '#8a6a4f'],
  ['marketing', 'Marketing', 'gasto', '#c2477d'],
  ['impuestos', 'Impuestos y patentes', 'gasto', '#4d625b'],
  ['otros-gastos', 'Otros gastos', 'gasto', '#7d8d87'],
].map(([id, nombre, tipo, color]) => ({ id: `c-${id}`, nombre, tipo, color, predefinida: true }))

// [día, tipo, categoría, proveedor, descripción, documento, monto, quién, origen, ítem del documento]
const PLANTILLA = [
  [1, 'gasto', 'arriendo', 'Inmobiliaria Los Sauces Ltda.', 'Arriendo del local', 'factura', 420000, 'admin', 'manual'],
  [2, 'gasto', 'insumos', 'Distribuidora Avícola del Sur', 'Pollo entero 40 kg', 'factura', 168000, 'admin', 'pdf', 'Pollo entero (kg)|40'],
  [3, 'gasto', 'insumos', 'Supermercado El Trébol', 'Papas, aceite y aliños', 'boleta', 74500, 'empleado', 'foto', 'Papas, aceite y aliños'],
  [5, 'ingreso', 'ventas', '', 'Ventas de la semana 1', 'boleta', 612400, 'admin', 'manual'],
  [6, 'gasto', 'servicios', 'Compañía Eléctrica Regional', 'Electricidad', 'boleta', 58300, 'admin', 'manual'],
  [7, 'gasto', 'servicios', 'Aguas del Valle S.A.', 'Agua potable', 'boleta', 21900, 'admin', 'manual'],
  [8, 'gasto', 'servicios', 'Gas Sur', 'Gas licuado 45 kg', 'boleta', 52900, 'empleado', 'foto', 'Gas licuado 45 kg'],
  [9, 'gasto', 'marketing', 'Imprenta Rápida', 'Cajas y bolsas con logo', 'factura', 38600, 'admin', 'manual'],
  [10, 'ingreso', 'ventas', 'Colegio San Andrés', 'Pedido de colaciones', 'factura', 185000, 'admin', 'manual'],
  [11, 'gasto', 'mantencion', 'Servicio Técnico Frío Sur', 'Mantención de la freidora', 'factura', 45000, 'admin', 'manual'],
  [12, 'ingreso', 'ventas', '', 'Ventas de la semana 2', 'boleta', 658900, 'empleado', 'manual'],
  [16, 'gasto', 'insumos', 'Distribuidora Avícola del Sur', 'Pollo entero 35 kg', 'factura', 147000, 'admin', 'pdf', 'Pollo entero (kg)|35'],
  [19, 'ingreso', 'ventas', '', 'Ventas de la semana 3', 'boleta', 701300, 'empleado', 'manual'],
  [21, 'gasto', 'transporte', 'Estación de Servicio Ruta 5', 'Bencina para compras', 'boleta', 25000, 'empleado', 'foto', 'Gasolina 93'],
  [24, 'gasto', 'impuestos', 'Municipalidad', 'Patente comercial (cuota)', 'otro', 64800, 'admin', 'manual'],
  [26, 'ingreso', 'ventas', '', 'Ventas de la semana 4', 'boleta', 689700, 'admin', 'manual'],
]

export const nuevoId = () =>
  crypto.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// Documento dibujado (lib/documentos.js) para los movimientos de ejemplo que vienen de foto o PDF
function documentoDe(origen, item, { proveedor, fecha, monto }) {
  if (origen === 'foto') return { plantilla: 'boleta', datos: { comercio: proveedor, fecha, total: monto, items: [[item, monto]] } }
  if (origen === 'pdf') {
    const [desc, cant] = item.split('|')
    return { plantilla: 'factura', datos: { emisor: proveedor, fecha, total: monto, items: [[desc, +cant, Math.round(monto / 1.19)]] } }
  }
  return null
}

function semilla() {
  const hoy = hoyISO()
  const mesActual = hoy.slice(0, 7)
  const movimientos = []
  for (const delta of [-3, -2, -1, 0]) {
    const ym = moverMes(mesActual, delta)
    const factor = 1 + delta * 0.04
    for (const [dia, tipo, cat, proveedor, descripcion, tipo_documento, base, quien, origen, item] of PLANTILLA) {
      const fecha = `${ym}-${String(dia).padStart(2, '0')}`
      if (fecha > hoy) continue
      const monto = Math.round((base * (tipo === 'ingreso' ? factor : 1 - delta * 0.03)) / 10) * 10
      movimientos.push({
        id: nuevoId(),
        client_request_id: null,
        fecha,
        monto,
        tipo,
        categoria_id: `c-${cat}`,
        proveedor,
        descripcion,
        tipo_documento,
        origen,
        documento: documentoDe(origen, item, { proveedor, fecha, monto }),
        usuario_id: PERSONAS[quien].id,
        usuario_nombre: PERSONAS[quien].nombre,
        creado_en: `${fecha}T12:00:00`,
        eliminado: false,
      })
    }
  }
  return {
    empresa: { id: 'e-demo', nombre: 'Rotisería El Buen Sabor', rut: '76.543.210-3', giro: 'Venta de comida preparada' },
    usuarios: Object.entries(PERSONAS).map(([rol, p]) => ({ ...p, rol, activo: true })),
    categorias: PREDEFINIDAS,
    movimientos,
    invitaciones: [],
  }
}

let db = null

export function leerDb() {
  if (db) return db
  try {
    db = JSON.parse(localStorage.getItem(KEY))
  } catch {
    db = null
  }
  db ??= semilla()
  return db
}

export function guardarDb() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* sin almacenamiento: los cambios viven hasta recargar */
  }
}

export function rolActual() {
  try {
    const r = localStorage.getItem(ROL_KEY)
    if (r in PERSONAS) return r
  } catch {
    /* sin almacenamiento */
  }
  return 'admin'
}

export function verComo(rol) {
  try {
    localStorage.setItem(ROL_KEY, rol)
  } catch {
    /* sin almacenamiento */
  }
  window.location.reload()
}

export function reiniciar() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(ROL_KEY)
  } catch {
    /* sin almacenamiento */
  }
  window.location.hash = '#/inicio'
  window.location.reload()
}
