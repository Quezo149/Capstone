// Carga de boletas y facturas con IA (HU08/HU09). Habla con POST /documentos/extraer, que guarda
// el archivo en Blob Storage (pendientes/), lo lee con Azure AI Document Intelligence y devuelve
// los datos para revisar; nada queda en la base hasta confirmar (POST /movimientos con archivo_id).
import { api } from './api'

// Límite del plan F0 de Document Intelligence (el backend responde 413 sobre esto)
export const MAX_MB = 4
const TIPOS = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/

// Lado largo de la foto que se envía. Prueba del 28-10 con fotos reales, comprimidas por este
// mismo código en Chromium: a 1600 px una boleta larga queda en 900 px de ancho y la lectura
// quedaba al límite (una vez sin fecha y con el proveedor "SUC:"); a 2400 px la de farmacia
// perdía el RUT; a 3200 px las tres salieron completas. Pesa ~0,7–0,9 MB, lejos de los 4 MB.
// Igual se re-codifica siempre: así la imagen queda derecha (EXIF) y las cajas de la IA calzan.
const INTENTOS = [
  [3200, 0.9],
  [3200, 0.8],
  [2400, 0.8],
]

/** Mensaje si el archivo no sirve, o null. */
export function errorArchivo(f) {
  if (!TIPOS.test(f.type)) return 'Ese archivo no es una foto ni un PDF.'
  if (f.type === 'application/pdf' && f.size > MAX_MB * 1024 * 1024) return `El PDF pesa más de ${MAX_MB} MB.`
  return null
}

/**
 * Foto → JPEG de 3200 px como máximo y bajo 4 MB (también convierte PNG, WebP y, donde el
 * navegador sabe abrirlo, HEIC del iPhone). El backend acepta JPG, PNG y PDF.
 */
async function comprimir(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = mal
      i.src = url
    })
    let blob = null
    for (const [lado, calidad] of INTENTOS) {
      const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * k)
      c.height = Math.round(img.naturalHeight * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', calidad))
      if (blob && blob.size <= MAX_MB * 1024 * 1024) break
    }
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Sube y lee el documento. Devuelve { vista, respuesta } donde `vista` es lo que se muestra en
 * pantalla ({ imagen: url } o { pdf: nombre, url }) y `respuesta` lo que contestó el backend:
 * { archivo_id, origen, ok, motivo?, datos, confianza, motivos, cajas, sugerencia, duplicado }.
 * La imagen mostrada es la MISMA que se envió: las cajas de la IA vienen en fracciones de esa imagen.
 */
export async function extraer(file) {
  const esPdf = file.type === 'application/pdf'
  const blob = esPdf ? file : await comprimir(file)
  if (!blob) throw new Error('No pudimos abrir la foto. Prueba con otra.')
  const nombre = esPdf ? file.name : file.name.replace(/\.\w+$/, '') + '.jpg'
  const respuesta = await api('/documentos/extraer', { method: 'POST', archivo: { campo: 'archivo', blob, nombre } })
  const url = URL.createObjectURL(blob)
  return { vista: esPdf ? { pdf: file.name, url } : { imagen: url, cajas: respuesta.cajas }, respuesta }
}

/** El usuario canceló la revisión: se borra el archivo subido (si falla, lo borra Azure al día siguiente). */
export function cancelar(archivoId) {
  if (archivoId) api(`/documentos/pendientes/${archivoId}`, { method: 'DELETE' }).catch(() => {})
}
