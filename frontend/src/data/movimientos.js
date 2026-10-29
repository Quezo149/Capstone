// Repositorio de movimientos: habla con la API (func-kontadoria). Las vistas no lo usan
// directo, sino a través de state/Movimientos.jsx.
//
// Forma de un movimiento (tabla `movimientos`, 0006_movimientos.sql):
//   { id, client_request_id, fecha 'AAAA-MM-DD', monto (entero CLP, IVA incluido),
//     tipo 'ingreso'|'gasto', categoria_id, proveedor, descripcion,
//     tipo_documento 'boleta'|'factura'|'otro', origen, creado_en, usuario_id, usuario_nombre,
//     proveedor_rut (0010, leído de la boleta), tiene_comprobante (foto o PDF guardado) }
// empresa_id y usuario_id los pone el backend a partir del token: el frontend no los envía.
// Qué movimientos llegan lo decide RLS: el empleado recibe solo los suyos (HU05).

import { api } from '../lib/api'
import { hoyISO, moverMes } from '../lib/format'

// crypto.randomUUID existe en localhost y HTTPS; el respaldo cubre una IP de la red local por HTTP
export const nuevoId = () =>
  crypto.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })

// La API trae proveedor/descripcion en null cuando van vacíos
const normalizar = (m) => ({ ...m, proveedor: m.proveedor ?? '', descripcion: m.descripcion ?? '' })

export async function listar() {
  return (await api('/movimientos')).map(normalizar)
}

// `datos` trae client_request_id generado al abrir el formulario: si llega dos veces
// (doble clic, reintento) el backend devuelve el mismo movimiento en vez de duplicarlo.
export async function crear(datos) {
  return normalizar(await api('/movimientos', { method: 'POST', body: datos }))
}

const EDITABLES = ['fecha', 'monto', 'tipo', 'categoria_id', 'proveedor', 'proveedor_rut', 'descripcion', 'tipo_documento']
const soloEditables = (m) => Object.fromEntries(EDITABLES.map((k) => [k, m[k]]))

export async function actualizar(id, cambios) {
  return normalizar(await api(`/movimientos/${id}`, { method: 'PUT', body: soloEditables(cambios) }))
}

// Dashboard (HU18): totales, gastos por categoría y últimos movimientos de un mes (AAAA-MM),
// con el mes anterior para comparar. El backend suma en la base: no hace falta traer todo.
export async function resumen(mes) {
  const r = await api(`/movimientos/resumen?mes=${mes}`)
  return { ...r, ultimos: r.ultimos.map(normalizar) }
}

// Foto o PDF guardado con el movimiento: { url, tipo, origen, vence_en_minutos }. El link es
// temporal (10 min) y de solo lectura: se pide uno nuevo cada vez que se abre.
export async function comprobante(id) {
  return api(`/movimientos/${id}/comprobante`)
}

// Anula el movimiento (ver restaurar)
export async function eliminar(id) {
  await api(`/movimientos/${id}`, { method: 'DELETE' })
}

// Eliminar no borra: el backend lo anula y guarda quién y cuándo (0008_movimientos_anulacion.sql).
// "Deshacer" lo vuelve a dejar vigente: el mismo movimiento, con su id y fecha de creación.
export async function restaurar(id) {
  return normalizar(await api(`/movimientos/${id}/restaurar`, { method: 'POST' }))
}

// ---------- Datos de ejemplo (solo con ?debug) ----------
// Se generan relativos al mes actual para que siempre se vean "al día".
// [día, tipo, categoría (nombre de una predefinida), proveedor, descripcion, tipo_documento, monto]
const PLANTILLA = [
  [1, 'gasto', 'Arriendo', 'Inmobiliaria Los Sauces Ltda.', 'Arriendo del local', 'factura', 420000],
  [2, 'gasto', 'Insumos', 'Distribuidora Avícola del Sur', 'Pollo entero 40 kg', 'factura', 168000],
  [3, 'gasto', 'Insumos', 'Mayorista Central', 'Papas, aceite y aliños', 'boleta', 74500],
  [5, 'ingreso', 'Ventas', '', 'Ventas de la semana 1', 'boleta', 612400],
  [6, 'gasto', 'Servicios básicos', 'Enel Distribución Chile', 'Electricidad', 'boleta', 58300],
  [7, 'gasto', 'Servicios básicos', 'Aguas Andinas S.A.', 'Agua potable', 'boleta', 21900],
  [8, 'gasto', 'Servicios básicos', 'Abastible S.A.', 'Gas licuado 45 kg', 'boleta', 52900],
  [9, 'gasto', 'Marketing', 'Imprenta Rápida', 'Cajas y bolsas con logo', 'factura', 38600],
  [10, 'ingreso', 'Ventas', 'Colegio San Andrés', 'Pedido de colaciones', 'factura', 185000],
  [11, 'gasto', 'Mantención', 'Servicio Técnico Frío Sur', 'Mantención de la freidora', 'factura', 45000],
  [12, 'ingreso', 'Ventas', '', 'Ventas de la semana 2', 'boleta', 658900],
  [16, 'gasto', 'Insumos', 'Distribuidora Avícola del Sur', 'Pollo entero 35 kg', 'factura', 147000],
  [19, 'ingreso', 'Ventas', '', 'Ventas de la semana 3', 'boleta', 701300],
  [21, 'gasto', 'Transporte', 'Copec', 'Bencina para compras', 'boleta', 25000],
  [24, 'gasto', 'Impuestos y patentes', 'Municipalidad', 'Patente comercial (cuota)', 'otro', 64800],
  [26, 'ingreso', 'Ventas', '', 'Ventas de la semana 4', 'boleta', 689700],
]

/** Registra 3 meses de ejemplo en la empresa. `categorias` = lista de GET /categorias. */
export async function cargarEjemplo(categorias) {
  const idDe = Object.fromEntries(categorias.filter((c) => c.predefinida).map((c) => [`${c.tipo}|${c.nombre}`, c.id]))
  const hoy = hoyISO()
  const mesActual = hoy.slice(0, 7)
  const envios = []
  for (const delta of [-2, -1, 0]) {
    const ym = moverMes(mesActual, delta)
    // Variación pequeña por mes para que los totales no sean idénticos
    const factor = 1 + delta * 0.04
    for (const [dia, tipo, cat, proveedor, descripcion, tipo_documento, monto] of PLANTILLA) {
      const fecha = `${ym}-${String(dia).padStart(2, '0')}`
      if (fecha > hoy) continue
      envios.push({
        fecha,
        monto: Math.round((monto * (tipo === 'ingreso' ? factor : 1)) / 10) * 10,
        tipo,
        categoria_id: idDe[`${tipo}|${cat}`],
        proveedor,
        descripcion,
        tipo_documento,
        client_request_id: nuevoId(),
      })
    }
  }
  // De a uno: la base serverless y el plan de consumo no agradecen 40 requests en paralelo
  for (const datos of envios) await crear(datos)
  return listar()
}

export async function borrarTodo(movs) {
  for (const m of movs) await eliminar(m.id)
}
