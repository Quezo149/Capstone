import { useEffect, useState } from 'react'

// Barra superior del celular: se esconde al bajar y vuelve apenas se sube, como en las apps
// móviles, para dejarle la pantalla al contenido. El CSS solo la mueve en pantallas chicas.
const UMBRAL = 8 // px de recorrido antes de cambiar: el rebote del scroll en iOS no la hace parpadear
const ZONA_INICIO = 64 // cerca del inicio de la página siempre se ve

export default function useOcultarAlBajar() {
  const [oculta, setOculta] = useState(false)

  useEffect(() => {
    let ultimo = window.scrollY
    let pendiente = false

    function revisar() {
      pendiente = false
      const y = Math.max(window.scrollY, 0)
      const recorrido = y - ultimo
      if (y < ZONA_INICIO) setOculta(false)
      else if (Math.abs(recorrido) < UMBRAL) return
      else setOculta(recorrido > 0)
      ultimo = y
    }

    // Un cálculo por cuadro, no por cada evento de scroll
    function alHacerScroll() {
      if (pendiente) return
      pendiente = true
      requestAnimationFrame(revisar)
    }

    window.addEventListener('scroll', alHacerScroll, { passive: true })
    return () => window.removeEventListener('scroll', alHacerScroll)
  }, [])

  return oculta
}
