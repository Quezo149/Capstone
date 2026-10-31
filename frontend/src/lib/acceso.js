// Intención con la que se llegó desde la landing: /?acceso=crear o /?acceso=entrar.
// Se guarda al cargar porque MSAL limpia la query (?code=…) al procesar la vuelta de Entra.
// Si no hay sesión, Acceso.jsx la usa para ir directo a la página de Microsoft.

const VALORES = ['crear', 'entrar']
let pendiente = null
let usado = false

/** Lee y quita ?acceso=… de la URL. Se llama al cargar, antes de iniciar MSAL. */
export function capturarAcceso() {
  const params = new URLSearchParams(window.location.search)
  const valor = params.get('acceso')
  if (!valor) return
  // Si viene junto a ?code=… (vuelta de Entra) no se toca la URL: MSAL la necesita entera
  if (params.has('code') || params.has('error')) return
  if (VALORES.includes(valor)) pendiente = valor
  params.delete('acceso')
  const query = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
}

/** Intención pendiente, sin consumirla ('crear' | 'entrar' | null). */
export const accesoPendiente = () => pendiente

/**
 * La consume: devuelve la intención solo la primera vez. En desarrollo StrictMode corre los
 * efectos dos veces, y dos loginRedirect seguidos hacen fallar a MSAL (interaction_in_progress).
 */
export function tomarAcceso() {
  if (usado) return null
  usado = true
  return pendiente
}
