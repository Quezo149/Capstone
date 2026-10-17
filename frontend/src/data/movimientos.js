// Repositorio de movimientos. Hoy guarda en localStorage del navegador; más adelante este
// mismo archivo llamará a la API (func-kontadoria) sin que cambien las vistas.
// Por eso todas las funciones son async: con fetch lo serán de verdad.
//
// Forma de un movimiento (calza con la tabla `movimientos` de 06 Modelo de Datos):
//   { id, client_request_id, fecha 'AAAA-MM-DD', monto (entero CLP, IVA incluido),
//     tipo 'ingreso'|'gasto', categoria_id, proveedor, descripcion,
//     tipo_documento 'boleta'|'factura'|'otro', origen 'manual', creado_en ISO }
// empresa_id y usuario_id los pondrá el backend a partir del token: el frontend no los envía.

import { hoyISO, moverMes } from '../lib/format'

// Una clave por empresa: si dos empresas usan el mismo navegador, cada una ve solo lo suyo.
// Provisorio hasta HU03 (Sprint 2), cuando los movimientos pasan a la API y los aísla el RLS.
const PREFIJO = 'kontadoria-movimientos-v1'
let KEY = null

/** Elige la empresa cuyos movimientos se leen y escriben. Lo llama MovimientosProvider. */
export function usarEmpresa(empresaId) {
  KEY = `${PREFIJO}:${empresaId}`
  try {
    // Clave global de antes del login: solo tenía datos de ejemplo y no era de ninguna empresa
    localStorage.removeItem(PREFIJO)
  } catch {
    // Sin almacenamiento: nada que limpiar
  }
}

// crypto.randomUUID existe en localhost y HTTPS; el respaldo cubre una IP de la red local por HTTP
export const nuevoId = () =>
  crypto.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })

function leer() {
  if (!KEY) throw new Error('Falta usarEmpresa() antes de leer movimientos')
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function escribir(lista) {
  if (!KEY) throw new Error('Falta usarEmpresa() antes de guardar movimientos')
  try {
    localStorage.setItem(KEY, JSON.stringify(lista))
  } catch {
    // Sin almacenamiento (modo privado): la app sigue funcionando hasta recargar
  }
}

export async function listar() {
  return leer()
}

// `datos` trae client_request_id generado al abrir el formulario: si llega dos veces
// (doble clic, reintento) no se duplica. Es la misma idempotencia que hará la API.
export async function crear(datos) {
  const lista = leer()
  const repetido = lista.find((m) => m.client_request_id === datos.client_request_id)
  if (repetido) return repetido
  const mov = { ...datos, id: nuevoId(), origen: 'manual', creado_en: new Date().toISOString() }
  escribir([...lista, mov])
  return mov
}

export async function actualizar(id, cambios) {
  const lista = leer()
  const i = lista.findIndex((m) => m.id === id)
  if (i < 0) throw new Error('El movimiento ya no existe')
  // Solo estos campos se editan: id, origen, client_request_id y creado_en quedan como estaban
  const editables = ['fecha', 'monto', 'tipo', 'categoria_id', 'proveedor', 'descripcion', 'tipo_documento']
  for (const k of editables) if (k in cambios) lista[i][k] = cambios[k]
  escribir(lista)
  return lista[i]
}

export async function eliminar(id) {
  escribir(leer().filter((m) => m.id !== id))
}

// Para "Deshacer" después de eliminar: vuelve a insertar el mismo objeto
export async function restaurar(mov) {
  const lista = leer().filter((m) => m.id !== mov.id)
  escribir([...lista, mov])
  return mov
}

export async function borrarTodo() {
  escribir([])
}

// ---------- Datos de ejemplo ----------
// Se generan relativos al mes actual para que el mockup siempre se vea "al día".
// [día, tipo, categoria_id, proveedor, descripcion, tipo_documento, monto]
const PLANTILLA = [
  [1, 'gasto', 'arriendo', 'Inmobiliaria Los Sauces Ltda.', 'Arriendo del local', 'factura', 420000],
  [2, 'gasto', 'insumos', 'Distribuidora Avícola del Sur', 'Pollo entero 40 kg', 'factura', 168000],
  [3, 'gasto', 'insumos', 'Mayorista Central', 'Papas, aceite y aliños', 'boleta', 74500],
  [5, 'ingreso', 'ventas', '', 'Ventas de la semana 1', 'boleta', 612400],
  [6, 'gasto', 'servicios-basicos', 'Enel Distribución Chile', 'Electricidad', 'boleta', 58300],
  [7, 'gasto', 'servicios-basicos', 'Aguas Andinas S.A.', 'Agua potable', 'boleta', 21900],
  [8, 'gasto', 'servicios-basicos', 'Abastible S.A.', 'Gas licuado 45 kg', 'boleta', 52900],
  [9, 'gasto', 'marketing', 'Imprenta Rápida', 'Cajas y bolsas con logo', 'factura', 38600],
  [10, 'ingreso', 'ventas', 'Colegio San Andrés', 'Pedido de colaciones', 'factura', 185000],
  [11, 'gasto', 'mantencion', 'Servicio Técnico Frío Sur', 'Mantención de la freidora', 'factura', 45000],
  [12, 'ingreso', 'ventas', '', 'Ventas de la semana 2', 'boleta', 658900],
  [16, 'gasto', 'insumos', 'Distribuidora Avícola del Sur', 'Pollo entero 35 kg', 'factura', 147000],
  [19, 'ingreso', 'ventas', '', 'Ventas de la semana 3', 'boleta', 701300],
  [21, 'gasto', 'transporte', 'Copec', 'Bencina para compras', 'boleta', 25000],
  [24, 'gasto', 'impuestos', 'Municipalidad', 'Patente comercial (cuota)', 'otro', 64800],
  [26, 'ingreso', 'ventas', '', 'Ventas de la semana 4', 'boleta', 689700],
]

export async function cargarEjemplo() {
  const hoy = hoyISO()
  const mesActual = hoy.slice(0, 7)
  const lista = []
  for (const delta of [-2, -1, 0]) {
    const ym = moverMes(mesActual, delta)
    // Variación pequeña por mes para que los totales no sean idénticos
    const factor = 1 + delta * 0.04
    for (const [dia, tipo, categoria_id, proveedor, descripcion, tipo_documento, monto] of PLANTILLA) {
      const fecha = `${ym}-${String(dia).padStart(2, '0')}`
      if (fecha > hoy) continue
      lista.push({
        id: nuevoId(),
        client_request_id: nuevoId(),
        fecha,
        monto: Math.round((monto * (tipo === 'ingreso' ? factor : 1)) / 10) * 10,
        tipo,
        categoria_id,
        proveedor,
        descripcion,
        tipo_documento,
        origen: 'manual',
        creado_en: new Date().toISOString(),
      })
    }
  }
  escribir(lista)
  return lista
}
