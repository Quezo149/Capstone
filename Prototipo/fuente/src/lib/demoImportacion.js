// PROTOTIPO: "lavado" de datos + carga de ejemplo, para revisar la importación desde un estado
// conocido. Se activa abriendo el prototipo con ?lavar en la URL (antes del #):
//   http://127.0.0.1:5173/?lavar#/importar
// Borra todo lo del prototipo (salvo el tema), vuelve a la empresa de ejemplo y hace, como la Dueña
// y por la misma API simulada que usa la pantalla, tres importaciones de ejemplo: así quedan
// historial, formatos guardados, categorías asociadas y movimientos importados para revisar.
import { api } from './api'
import { ejemplos } from './importacion'
import { borrarDatos, esProduccion, leerDb } from './proto'

const CARGAS = [
  // Planilla propia: se guarda el formato y "Préstamo" queda asociado a Otros ingresos
  { id: 'propia', formato: 'Caja El Fogón', categorias: { prestamo: 'c-otros-ingresos' } },
  // Cartola: se guarda el formato del banco
  { id: 'cartola', formato: 'Cartola cuenta corriente' },
  // Plantilla con una hoja por mes: se importan las 3 hojas juntas
  { id: 'meses' },
]

export async function lavarYCargar() {
  borrarDatos()
  const lista = ejemplos(leerDb().movimientos)
  const hechas = []
  for (const carga of CARGAS) {
    const ej = lista.find((e) => e.id === carga.id)
    const an = await api('/importaciones/analizar', { method: 'POST', body: { nombre: ej.nombre, tipo: ej.tipo, hojas: ej.hojas } })
    const mapeo = { ...an.mapeo, catValores: { ...an.mapeo.catValores, ...carga.categorias } }
    const imp = await api('/importaciones', {
      method: 'POST',
      body: {
        nombre: ej.nombre,
        tipo: ej.tipo,
        hojas: ej.hojas,
        seleccion: [an.hoja, ...an.mismas],
        mapeo,
        incluirOcultas: false,
        excluidas: [],
        perfil: an.plantilla ? null : { id: null, guardar: true, nombre: carga.formato },
        client_request_id: crypto.randomUUID?.() ?? `demo-${carga.id}-${Date.now()}`,
      },
    })
    hechas.push(`${ej.nombre}: ${imp.filas_importadas}`)
  }
  return hechas
}

// Si la URL trae ?lavar, lava y carga antes de mostrar la app, y quita el parámetro (recargar la
// página no vuelve a lavar).
export async function lavarSiSePide() {
  const url = new URL(window.location.href)
  // El lavado carga datos de ejemplo: solo tiene sentido en el modo demo
  if (esProduccion || !url.searchParams.has('lavar')) return null
  const raiz = document.getElementById('root')
  if (raiz) raiz.innerHTML = '<p style="padding:32px;font:600 16px system-ui">Prototipo: borrando datos y cargando importaciones de ejemplo…</p>'
  const hechas = await lavarYCargar()
  url.searchParams.delete('lavar')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  return hechas
}
