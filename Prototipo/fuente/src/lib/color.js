// Los colores de categoría se ven sobre fondo blanco (tema claro) y verde casi negro (tema
// oscuro). Un color muy oscuro desaparece en el oscuro y uno muy claro en el claro, así que se
// exige una luminancia intermedia: contraste de al menos ~2,2:1 contra los dos fondos.
// Misma regla que el backend (app/routers/categorias.py, LUMINANCIA_MIN/MAX).
export const LUMINANCIA_MIN = 0.08
export const LUMINANCIA_MAX = 0.43

// Luminancia relativa de WCAG 2.x: 0 = negro, 1 = blanco
export function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** null si el color sirve; si no, el motivo para mostrarle al usuario. */
export function problemaColor(hex) {
  const l = luminancia(hex)
  if (l < LUMINANCIA_MIN) return 'Ese color es muy oscuro: no se vería en el modo oscuro.'
  if (l > LUMINANCIA_MAX) return 'Ese color es muy claro: no se vería en el modo claro.'
  return null
}
