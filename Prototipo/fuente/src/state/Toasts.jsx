import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon'
import './Toasts.css'

// Avisos cortos abajo al centro. aviso('texto', { accion: { label, onClick }, festejo: true })
// Los que traen acción (Deshacer) duran 10 s y no se cierran mientras el puntero o el foco
// estén encima: si alguien va a tocar "Deshacer", no se le escapa.
const Ctx = createContext(null)

// Confeti del aviso de éxito: mismas piezas fijas que el formulario de la landing
const PIEZAS = Array.from({ length: 10 }, (_, i) => {
  const ang = (i / 10) * Math.PI * 2
  return { x: Math.cos(ang) * 34, y: Math.sin(ang) * 26 - 8, r: i * 47, tone: i % 3 }
})

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const seq = useRef(0)
  // Temporizador de cierre de cada aviso, para pausarlo y reanudarlo
  const timers = useRef({})

  const cerrar = useCallback((id) => {
    setItems((l) => l.map((t) => (t.id === id ? { ...t, saliendo: true } : t)))
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 220)
  }, [])

  const aviso = useCallback(
    (texto, { accion, festejo = false, duracion = accion ? 10000 : 2800 } = {}) => {
      const id = ++seq.current
      // Máximo dos a la vez: el más viejo se va
      setItems((l) => [...l.slice(-1), { id, texto, accion, festejo }])
      timers.current[id] = setTimeout(() => cerrar(id), duracion)
    },
    [cerrar],
  )

  const pausar = useCallback((id) => clearTimeout(timers.current[id]), [])
  // Al soltar se dan unos segundos más, no el tiempo completo
  const reanudar = useCallback((id) => {
    clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(() => cerrar(id), 4000)
  }, [cerrar])

  const value = useMemo(() => ({ aviso }), [aviso])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast${t.saliendo ? ' out' : ''}`}
            {...(t.accion
              ? {
                  onMouseEnter: () => pausar(t.id),
                  onMouseLeave: () => reanudar(t.id),
                  onFocus: () => pausar(t.id),
                  onBlur: () => reanudar(t.id),
                }
              : {})}
          >
            <span className="toast-ic">
              <Icon name="checkc" />
              {t.festejo &&
                PIEZAS.map((p, i) => (
                  <i
                    key={i}
                    className={`confetti c${p.tone}`}
                    style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--r': `${p.r}deg` }}
                  />
                ))}
            </span>
            <span>{t.texto}</span>
            {t.accion && (
              <button
                type="button"
                className="toast-act"
                onClick={() => {
                  t.accion.onClick()
                  cerrar(t.id)
                }}
              >
                <Icon name="undo" />
                {t.accion.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(Ctx)
