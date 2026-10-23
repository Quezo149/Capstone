// Token del link de invitación (HU02) mientras la persona inicia sesión o crea su cuenta.
// El link es /#/invitacion/<token>, pero al volver de Microsoft se aterriza en "/" y el hash se
// pierde: por eso se guarda antes (localStorage, por si el registro de Entra abre otra pestaña).

const KEY = 'kontadoria-invitacion'
const RUTA = /^#\/invitacion\/([A-Za-z0-9_-]{20,100})$/
// Respaldo en memoria si el navegador no deja usar localStorage (modo privado estricto)
let respaldo = null

/** Si la URL es un link de invitación, guarda el token y deja la URL limpia. Se llama al cargar. */
export function capturarInvitacion() {
  const m = window.location.hash.match(RUTA)
  if (!m) return
  try {
    localStorage.setItem(KEY, m[1])
  } catch {
    // Sin almacenamiento: igual se ve la invitación mientras no se recargue
    respaldo = m[1]
  }
  // El token no queda en la barra de direcciones ni en el historial
  window.history.replaceState(null, '', `${window.location.pathname}#/`)
}

export function invitacionPendiente() {
  try {
    return localStorage.getItem(KEY) ?? respaldo
  } catch {
    return respaldo
  }
}

export function olvidarInvitacion() {
  respaldo = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nada que borrar
  }
}

/** Link que el admin comparte. Se arma en el navegador: funciona igual en local y en producción. */
export const linkInvitacion = (token) => `${window.location.origin}/#/invitacion/${token}`
