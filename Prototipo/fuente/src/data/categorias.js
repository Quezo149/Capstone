// Las categorías vienen de la API (GET /categorias): las predefinidas, iguales para todas las
// empresas, más las propias de la empresa (HU14). Ver state/Categorias.jsx.

// Colores sugeridos al crear una categoría propia: los mismos tonos de las predefinidas
export const PALETA = ['#17804f', '#0f6e55', '#2f5d8a', '#7a4fa0', '#c48a12', '#b8382a', '#8a6a4f', '#c2477d', '#4d625b', '#7d8d87']

// Mismos valores que el enum `tipo_documento` del modelo de datos
export const TIPOS_DOCUMENTO = [
  { id: 'boleta', nombre: 'Boleta' },
  { id: 'factura', nombre: 'Factura' },
  { id: 'otro', nombre: 'Otro / sin documento' },
]

export const nombreDocumento = (id) => TIPOS_DOCUMENTO.find((t) => t.id === id)?.nombre ?? id

// Mismos valores que el enum `origen`
export const ORIGENES = { manual: 'Manual', foto: 'Foto', pdf: 'PDF', importacion_masiva: 'Excel' }
