// Política de privacidad que se acepta al registrar la empresa (HU17), unirse por invitación (HU02)
// o volver a entrar si la cuenta aceptó una versión anterior. La versión viene de politica.json en
// la raíz del repo, el mismo archivo que leen la landing y el backend (que rechaza otra versión).
import politica from '../../../politica.json'

export const VERSION = politica.version

// El texto vive en la landing, en el modal que abre #privacidad. En local, el Vite de /landing (5174).
const LANDING_URL = (
  import.meta.env.VITE_LANDING_URL || (import.meta.env.DEV ? 'http://localhost:5174' : 'https://kontadoria.cl')
).replace(/\/$/, '')
export const LINK_POLITICA = `${LANDING_URL}/#privacidad`
