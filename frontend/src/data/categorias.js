// Categorías globales predefinidas (en la BD serán filas de `categorias` con empresa_id = null).
// Los ids son códigos estables, igual que en piloto_interesados: el nombre visible puede cambiar.
// Las categorías propias de cada empresa (HU14, solo admin) llegan en una parte posterior.

export const CATEGORIAS = [
  { id: 'ventas', nombre: 'Ventas', tipo: 'ingreso', color: '#17804f' },
  { id: 'otros-ingresos', nombre: 'Otros ingresos', tipo: 'ingreso', color: '#5aa37f' },

  { id: 'insumos', nombre: 'Insumos', tipo: 'gasto', color: '#0f6e55' },
  { id: 'arriendo', nombre: 'Arriendo', tipo: 'gasto', color: '#2f5d8a' },
  { id: 'remuneraciones', nombre: 'Remuneraciones', tipo: 'gasto', color: '#7a4fa0' },
  { id: 'servicios-basicos', nombre: 'Servicios básicos', tipo: 'gasto', color: '#c48a12' },
  { id: 'transporte', nombre: 'Transporte', tipo: 'gasto', color: '#b8382a' },
  { id: 'mantencion', nombre: 'Mantención', tipo: 'gasto', color: '#8a6a4f' },
  { id: 'marketing', nombre: 'Marketing', tipo: 'gasto', color: '#c2477d' },
  { id: 'impuestos', nombre: 'Impuestos y patentes', tipo: 'gasto', color: '#4d625b' },
  { id: 'otros-gastos', nombre: 'Otros gastos', tipo: 'gasto', color: '#7d8d87' },
]

const POR_ID = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]))

export const categoria = (id) => POR_ID[id] ?? { id, nombre: 'Sin categoría', tipo: 'gasto', color: '#7d8d87' }

export const categoriasDe = (tipo) => CATEGORIAS.filter((c) => c.tipo === tipo)

// Mismos valores que el enum `tipo_documento` del modelo de datos
export const TIPOS_DOCUMENTO = [
  { id: 'boleta', nombre: 'Boleta' },
  { id: 'factura', nombre: 'Factura' },
  { id: 'otro', nombre: 'Otro / sin documento' },
]

export const nombreDocumento = (id) => TIPOS_DOCUMENTO.find((t) => t.id === id)?.nombre ?? id

// Mismos valores que el enum `origen`
export const ORIGENES = { manual: 'Manual', foto: 'Foto', pdf: 'PDF', importacion_masiva: 'Excel' }
