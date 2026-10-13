// Formatos chilenos: pesos sin decimales y fechas DD-MM-AAAA.
// Las fechas viajan como texto ISO 'AAAA-MM-DD' (igual que el tipo `date` de SQL),
// así no hay corrimientos por zona horaria al pasarlas por `new Date()`.

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export const clp = (n) => '$ ' + Math.round(Math.abs(n)).toLocaleString('es-CL')

// Con signo: "+ $ 1.000" para ingresos, "− $ 1.000" para gastos
export const clpSigno = (n, tipo) => (tipo === 'gasto' ? '− ' : '+ ') + clp(n)

// Resultado que puede ser negativo
export const clpNeto = (n) => (n < 0 ? '− ' : '') + clp(n)

export const fechaCorta = (iso) => {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

export function hoyISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// '2026-10' → 'octubre 2026'
export const mesLargo = (ym) => {
  const [y, m] = ym.split('-')
  return `${MESES[+m - 1]} ${y}`
}

export const nombreMes = (ym) => MESES[+ym.split('-')[1] - 1]

// '2026-10-13' → 'Martes 13 de octubre'
export function fechaLarga(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dia = DIAS[new Date(y, m - 1, d).getDay()]
  return `${dia[0].toUpperCase()}${dia.slice(1)} ${d} de ${MESES[m - 1]}`
}

// Suma o resta meses a 'AAAA-MM'
export function moverMes(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Lee un monto escrito a mano: "12.500", "$ 12500", "12 500" → 12500
export const leerMonto = (texto) => parseInt(String(texto).replace(/\D/g, ''), 10) || 0

// IVA incluido en un total con 19 %: neto = total / 1,19
export function desglosarIva(total) {
  const neto = Math.round(total / 1.19)
  return { neto, iva: total - neto }
}
