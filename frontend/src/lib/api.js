import { obtenerToken } from '../auth/msal'

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

// Error de la API con el código estable del backend (detail.codigo), para decidir qué mostrar
// sin depender del texto: sin_empresa, usuario_desactivado, rut_registrado, …
export class ApiError extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje)
    this.status = status
    this.codigo = codigo
  }
}

function leerError(status, cuerpo) {
  const d = cuerpo?.detail
  if (d && typeof d === 'object' && !Array.isArray(d)) return new ApiError(status, d.codigo, d.mensaje)
  // 422 de FastAPI: lista de errores por campo → { campo: mensaje }
  if (Array.isArray(d)) {
    const campos = Object.fromEntries(d.map((e) => [e.loc?.at(-1), e.msg?.replace(/^Value error, /, '')]))
    const err = new ApiError(status, 'datos_invalidos', 'Revisa los datos ingresados.')
    err.campos = campos
    return err
  }
  return new ApiError(status, 'error', 'Algo salió mal. Intenta de nuevo en unos segundos.')
}

// publica: sin sesión (por ejemplo, la vista del link de invitación antes de iniciar sesión)
export async function api(ruta, { method = 'GET', body, publica = false } = {}) {
  const token = publica ? null : await obtenerToken()
  let r
  try {
    r = await fetch(`${BASE}${ruta}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'sin_conexion', 'No pudimos conectarnos. Revisa tu conexión a internet.')
  }
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) throw leerError(r.status, cuerpo)
  return cuerpo
}
