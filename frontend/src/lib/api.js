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
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const err = new ApiError(status, d.codigo, d.mensaje)
    err.detalle = d // datos extra del error (por ejemplo, el movimiento de un posible_duplicado)
    return err
  }
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
// archivo: { campo, blob, nombre } → se envía como multipart/form-data (POST /documentos/extraer)
export async function api(ruta, { method = 'GET', body, publica = false, archivo } = {}) {
  const token = publica ? null : await obtenerToken()
  let r
  try {
    let cuerpo = body ? JSON.stringify(body) : undefined
    if (archivo) {
      // Sin Content-Type: el navegador lo pone con el "boundary" del multipart
      cuerpo = new FormData()
      cuerpo.append(archivo.campo, archivo.blob, archivo.nombre)
    }
    r = await fetch(`${BASE}${ruta}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: cuerpo,
    })
  } catch {
    throw new ApiError(0, 'sin_conexion', 'No pudimos conectarnos. Revisa tu conexión a internet.')
  }
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) throw leerError(r.status, cuerpo)
  return cuerpo
}

// Apenas carga la app, antes de saber si hay sesión: despierta la API (Function en frío) y la base
// serverless (en pausa si nadie la usó) mientras la persona inicia sesión en Microsoft. Si falla
// no importa: /auth/me reintenta igual (ver state/Sesion.jsx).
export function despertarServidor() {
  api('/health/db', { publica: true }).catch(() => {})
}
