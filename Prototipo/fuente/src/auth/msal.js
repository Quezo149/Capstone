// PROTOTIPO: reemplaza el inicio de sesión con Microsoft Entra (ver frontend/src/auth/msal.js).
// No hay cuentas reales: "Iniciar sesión" entra directo con la empresa de ejemplo.
const KEY = 'kontadoria-proto-sesion'

export const configurado = true

const leer = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return '1'
  }
}

export async function iniciarMsal() {
  // La primera visita entra sola, para que el prototipo muestre la app de inmediato
  const v = leer()
  return v === null || v === '1' ? { username: 'demo' } : null
}

export function iniciarSesion() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* sin almacenamiento: igual recarga y entra */
  }
  window.location.reload()
}

export function cerrarSesion() {
  try {
    localStorage.setItem(KEY, '0')
  } catch {
    /* nada que guardar */
  }
  window.location.reload()
}

export async function obtenerToken() {
  return 'prototipo'
}

export class SesionVencida extends Error {}
