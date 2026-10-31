// Dirección de la app (/frontend). La landing ya no tiene formulario propio: los botones llevan
// directo a crear cuenta o iniciar sesión en la app, que usa Microsoft Entra.
// En producción se puede sobrescribir con VITE_APP_URL en Netlify; en local apunta al Vite de
// /frontend (5173).
const APP_URL = (
  import.meta.env.VITE_APP_URL || (import.meta.env.DEV ? 'http://localhost:5173' : 'https://app.kontadoria.cl')
).replace(/\/$/, '')

// ?acceso=… lo lee frontend/src/lib/acceso.js: abre la página de Entra sin pasar por la pantalla
// de bienvenida. Si la persona ya tiene sesión, entra directo a la app.
export const LINK_CREAR_CUENTA = `${APP_URL}/?acceso=crear`
export const LINK_INICIAR_SESION = `${APP_URL}/?acceso=entrar`
