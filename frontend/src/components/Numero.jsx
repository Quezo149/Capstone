import { useEffect, useRef, useState } from 'react'
import { clp } from '../lib/format'

// Monto que "corre" desde su valor anterior hasta el nuevo (al cargar parte de 0).
// Así, al guardar un movimiento, los totales suben o bajan a la vista.
// Con prefers-reduced-motion salta directo al valor final.
export default function Numero({ valor, formato = clp, duracion = 900 }) {
  const [mostrado, setMostrado] = useState(0)
  const desde = useRef(0)

  useEffect(() => {
    const inicio = desde.current
    const total = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duracion
    let raf
    let t0
    const tick = (now) => {
      t0 ??= now
      const p = total === 0 ? 1 : Math.min((now - t0) / total, 1)
      const v = Math.round(inicio + (valor - inicio) * (1 - (1 - p) ** 3)) // ease-out cúbico
      desde.current = v
      setMostrado(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [valor, duracion])

  return <span>{formato(mostrado)}</span>
}
