// Validación de RUT en el navegador: misma regla que el backend (backend/app/core/rut.py),
// solo para avisar antes de enviar. La que manda es la del backend.

export function digitoVerificador(cuerpo) {
  let suma = 0
  let factor = 2
  for (let n = cuerpo; n > 0; n = Math.floor(n / 10)) {
    suma += (n % 10) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const resto = 11 - (suma % 11)
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
}

/** Mensaje de error, o null si el RUT es válido. */
export function errorRut(valor) {
  const limpio = (valor ?? '').replace(/[.\s-]/g, '').toUpperCase()
  const m = /^(\d{1,8})([0-9K])$/.exec(limpio)
  if (!m || Number(m[1]) === 0) return 'Escribe un RUT válido (ej.: 12.345.678-5).'
  if (digitoVerificador(Number(m[1])) !== m[2]) return 'El dígito verificador no corresponde a ese RUT.'
  return null
}

/** Da formato mientras se escribe: 123456785 → 12.345.678-5 */
export function formatearRut(valor) {
  const limpio = (valor ?? '').replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9)
  if (limpio.length < 2) return limpio
  const cuerpo = limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cuerpo}-${limpio.slice(-1)}`
}
