import { createStandardPublicClientApplication, InteractionRequiredAuthError, ResponseMode } from '@azure/msal-browser'

// Inicio de sesión con Microsoft Entra External ID (HU01). KontadorIA no ve ni guarda
// contraseñas: el formulario de correo y contraseña es la página de Entra, y la app recibe
// un access token para llamar a la API. Los valores vienen de .env (ver .env.example).
const CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID
const AUTHORITY = import.meta.env.VITE_ENTRA_AUTHORITY
// Scope que expone la App Registration ("Expose an API"); el backend exige que venga en el token.
const API_SCOPE = import.meta.env.VITE_ENTRA_API_SCOPE

export const configurado = Boolean(CLIENT_ID && AUTHORITY && API_SCOPE)

const ORIGEN = window.location.origin
// Al volver de Entra se aterriza en la raíz, que procesa la respuesta (handleRedirectPromise).
// Las renovaciones silenciosas usan redirect.html, el "redirect bridge" que exige MSAL v5.
const REDIRECT_URI = `${ORIGEN}/`
const BRIDGE_URI = `${ORIGEN}/redirect.html`

let pca = null
// Inicialización única: en desarrollo StrictMode monta los efectos dos veces, y dos instancias
// de MSAL compitiendo por la misma respuesta de Entra dejaban la sesión sin reconocer al volver.
let inicio = null
// "Crear una cuenta" con una cuenta abierta en la app pasa primero por cerrar esa sesión de
// Microsoft (si no, Entra entra con ella). Esta marca sobrevive al ida y vuelta del logout.
const CREAR_KEY = 'kontadoria-crear-cuenta'

// La respuesta llega como ?code=… (query) y no como #code=…: el hash lo usa el ruteo de la app.
const config = () => ({
  auth: {
    clientId: CLIENT_ID,
    authority: AUTHORITY,
    knownAuthorities: [new URL(AUTHORITY).host],
    redirectUri: REDIRECT_URI,
    postLogoutRedirectUri: REDIRECT_URI,
    OIDCOptions: { responseMode: ResponseMode.QUERY },
  },
  // sessionStorage: el caché de la app se borra al cerrar la pestaña. Si la persona debe seguir
  // dentro lo decide Microsoft con su "¿Mantener la sesión iniciada?" (ver crearMsal).
  cache: { cacheLocation: 'sessionStorage' },
})

/** Crea MSAL y procesa la vuelta desde Entra (una sola vez). Devuelve la cuenta activa o null. */
export function iniciarMsal() {
  inicio ??= crearMsal()
  return inicio
}

async function crearMsal() {
  if (!configurado) return null
  pca = await createStandardPublicClientApplication(config())
  const resultado = await pca.handleRedirectPromise({ navigateToLoginRequestUrl: false })
  if (resultado?.account) pca.setActiveAccount(resultado.account)
  const crear = sessionStorage.getItem(CREAR_KEY)
  if (crear) {
    // Volvimos del logout de "Crear una cuenta": directo al registro de Entra.
    // La marca guarda el correo a pre-llenar (invitaciones) o '1' si no hay.
    sessionStorage.removeItem(CREAR_KEY)
    await pca.loginRedirect({ scopes: [API_SCOPE], prompt: 'create', ...(crear !== '1' ? { loginHint: crear } : {}) })
    return new Promise(() => {}) // la página se va a Entra: se queda en "cargando"
  }
  // Limpia ?code=…&state=… de la barra de direcciones, conservando la ruta (#/…)
  if (window.location.search) window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
  let cuenta = pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null
  if (!cuenta && !resultado) cuenta = await sesionMicrosoft()
  if (cuenta) pca.setActiveAccount(cuenta)
  return cuenta
}

/**
 * Pestaña nueva o navegador reabierto: pregunta a Microsoft, sin mostrar nada, si su sesión
 * sigue viva. La app no puede leer qué respondió la persona en "¿Mantener la sesión iniciada?"
 * (Entra no lo informa), pero esa respuesta decide cuánto dura la cookie de Microsoft:
 *   Sí → cookie persistente: entra sola incluso después de cerrar el navegador.
 *   No → cookie de sesión: al cerrar el navegador hay que volver a iniciar sesión.
 * Si el navegador bloquea las cookies de terceros (Safari, incógnito) esto falla y se muestra
 * la pantalla de acceso; "Iniciar sesión" entra igual sin pedir la contraseña.
 */
async function sesionMicrosoft() {
  try {
    const r = await pca.ssoSilent({ scopes: [API_SCOPE], redirectUri: BRIDGE_URI })
    return r.account
  } catch {
    return null
  }
}

/**
 * Lleva a la página de Entra. La recuperación de contraseña y "¿Mantener la sesión iniciada?"
 * están en esa misma página.
 *
 * `crear` abre el registro de cuenta nueva (HU17); Entra verifica el correo con un código
 * antes de activarla. Solo si la app conoce una cuenta abierta la cierra antes: sin cuenta, un
 * logout de Microsoft muestra "¿De qué cuenta quiere cerrar sesión?" vacío y la persona queda
 * atascada. Si la app no ve una sesión de Microsoft (ssoSilent ya lo intentó al cargar), no la hay
 * o el navegador bloquea las cookies de terceros; en ambos casos se va directo al registro.
 */
export function iniciarSesion({ crear = false, correo = null } = {}) {
  const cuenta = pca.getActiveAccount() ?? pca.getAllAccounts()[0]
  if (crear && cuenta) {
    sessionStorage.setItem(CREAR_KEY, correo ?? '1')
    return pca.logoutRedirect({ account: cuenta })
  }
  // correo: el de una invitación (HU02). Entra lo deja escrito en su página; no lo puede
  // bloquear, pero el backend rechaza aceptar la invitación con otro correo.
  return pca.loginRedirect({
    scopes: [API_SCOPE],
    ...(crear ? { prompt: 'create' } : {}),
    ...(correo ? { loginHint: correo } : {}),
  })
}

export function cerrarSesion() {
  return pca.logoutRedirect({ account: pca.getActiveAccount() })
}

/** Access token para la API. Renueva en silencio; si Entra exige interacción, vuelve al login. */
export async function obtenerToken() {
  const account = pca?.getActiveAccount()
  if (!account) throw new SesionVencida()
  try {
    const r = await pca.acquireTokenSilent({ scopes: [API_SCOPE], account, redirectUri: BRIDGE_URI })
    return r.accessToken
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ scopes: [API_SCOPE], account })
    }
    throw e
  }
}

export class SesionVencida extends Error {}
