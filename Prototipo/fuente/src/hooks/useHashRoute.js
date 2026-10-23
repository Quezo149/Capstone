import { useEffect, useState } from 'react'

// Ruta mínima por hash (#/movimientos). Sin dependencias y funciona en cualquier hosting
// estático; si la app crece se cambia por react-router sin tocar las vistas.
const leer = () => window.location.hash.replace(/^#\/?/, '') || 'inicio'

export default function useHashRoute() {
  const [ruta, setRuta] = useState(leer)

  useEffect(() => {
    const onChange = () => {
      setRuta(leer())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return ruta
}
