import { useEffect, useState } from 'react'

// Devuelve [ref, inView]. `ref` es un callback ref: pásalo como ref={ref} al elemento.
// inView pasa a true la primera vez que el elemento entra en pantalla (y se queda así).
// Sin IntersectionObserver (navegadores muy viejos) todo se muestra de inmediato.
const NO_IO = typeof IntersectionObserver === 'undefined'

export default function useInView({ threshold = 0.12, rootMargin = '0px 0px -6% 0px' } = {}) {
  const [node, setNode] = useState(null)
  const [inView, setInView] = useState(NO_IO)

  useEffect(() => {
    if (!node || NO_IO) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { threshold, rootMargin },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [node, threshold, rootMargin])

  return [setNode, inView]
}
