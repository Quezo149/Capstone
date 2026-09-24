import { useEffect, useState } from 'react'
import useInView from '../hooks/useInView'

const format = (n) => n.toLocaleString('es-CL')

// Número que sube de 0 a `to` cuando entra en pantalla. Con prefers-reduced-motion salta al valor final.
export default function CountUp({ to, duration = 1300 }) {
  const [ref, inView] = useInView({ threshold: 0.5, rootMargin: '0px' })
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!inView) return
    const total = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration
    let raf
    let start
    const tick = (now) => {
      start ??= now
      const p = total === 0 ? 1 : Math.min((now - start) / total, 1)
      setValue(Math.round(to * (1 - (1 - p) ** 3))) // ease-out cúbico
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, to, duration])

  return <span ref={ref}>{format(value)}</span>
}
