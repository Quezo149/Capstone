import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import './Drawer.css'

// Panel lateral (abajo, tipo hoja, en el celular). Se cierra con Escape, con la X o
// tocando el fondo. Se dibuja en <body> (portal): dentro de un contenedor animado con
// transform, `position: fixed` se mediría desde ese contenedor y no desde la ventana. Espera a que termine la animación de salida antes de desmontarse.
export default function Drawer({ abierto, onCerrar, titulo, eyebrow, children, ancho = 480 }) {
  const [montado, setMontado] = useState(abierto)
  const [saliendo, setSaliendo] = useState(false)
  const panel = useRef(null)
  const previo = useRef(null)
  // En una ref para que el efecto de foco no se reinicie si el padre pasa una función nueva
  const cerrar = useRef(onCerrar)
  useEffect(() => {
    cerrar.current = onCerrar
  })

  // Montaje y salida: se ajusta durante el render (patrón recomendado por React en vez de un efecto)
  if (abierto && (!montado || saliendo)) {
    setMontado(true)
    setSaliendo(false)
  }
  if (!abierto && montado && !saliendo) setSaliendo(true)

  useEffect(() => {
    if (!saliendo) return
    const t = setTimeout(() => {
      setMontado(false)
      setSaliendo(false)
    }, 240)
    return () => clearTimeout(t)
  }, [saliendo])

  // Foco: entra al primer campo y vuelve al botón que abrió el panel al cerrar
  useEffect(() => {
    if (!abierto) return
    previo.current = document.activeElement
    const t = setTimeout(() => {
      // Dos búsquedas: querySelector con una lista devuelve el primero *del documento* que
      // cumpla cualquiera, no respeta el orden de la lista
      const p = panel.current
      ;(p?.querySelector('[data-autofocus]') ?? p?.querySelector('input, select, textarea, button:not(.drawer-x)'))?.focus()
    }, 60)
    const onKey = (e) => e.key === 'Escape' && cerrar.current()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previo.current?.focus?.()
    }
  }, [abierto])

  if (!montado) return null

  return createPortal(
    <div className={`scrim${saliendo ? ' out' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <aside
        ref={panel}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        style={{ '--w': `${ancho}px` }}
      >
        <header className="drawer-head">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id="drawer-title">{titulo}</h2>
          </div>
          <button type="button" className="icon-btn drawer-x" onClick={onCerrar} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </header>
        {children}
      </aside>
    </div>,
    document.body,
  )
}
