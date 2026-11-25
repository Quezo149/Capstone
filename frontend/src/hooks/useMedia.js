import { useSyncExternalStore } from 'react'

// true mientras la pantalla cumpla la media query (p. ej. '(max-width: 720px)'); se actualiza al
// girar el celular o cambiar el tamaño de la ventana.
export function useMedia(query) {
  return useSyncExternalStore(
    (avisar) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', avisar)
      return () => mq.removeEventListener('change', avisar)
    },
    () => window.matchMedia(query).matches,
  )
}
