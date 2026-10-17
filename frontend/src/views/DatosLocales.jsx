import { useEffect, useState } from 'react'
import { useMovimientos } from '../state/Movimientos'
import { useToast } from '../state/Toasts'

// Pie de la barra lateral: avisa que todo vive en este navegador y permite
// cargar o borrar los datos de prueba. Desaparece cuando haya API.
export default function DatosLocales() {
  const { movs, cargarEjemplo, borrarTodo } = useMovimientos()
  const { aviso } = useToast()
  // Borrar pide un segundo clic dentro de 3 s
  const [confirmar, setConfirmar] = useState(false)

  useEffect(() => {
    if (!confirmar) return
    const t = setTimeout(() => setConfirmar(false), 3000)
    return () => clearTimeout(t)
  }, [confirmar])

  return (
    <div className="local-note">
      <strong>Modo local</strong>
      <span>
        {movs.length} {movs.length === 1 ? 'movimiento guardado' : 'movimientos guardados'} solo en este navegador, para esta empresa.
      </span>
      <div className="local-acts">
        {movs.length === 0 ? (
          <button
            type="button"
            className="btn btn-text btn-sm"
            onClick={async () => {
              await cargarEjemplo()
              aviso('Datos de ejemplo cargados', { festejo: true })
            }}
          >
            Cargar ejemplo
          </button>
        ) : (
          <button
            type="button"
            className={`btn btn-sm ${confirmar ? 'btn-danger' : 'btn-text'}`}
            onClick={async () => {
              if (!confirmar) return setConfirmar(true)
              await borrarTodo()
              setConfirmar(false)
              aviso('Borramos todos los movimientos')
            }}
          >
            {confirmar ? '¿Seguro? Toca otra vez' : 'Borrar todo'}
          </button>
        )}
      </div>
    </div>
  )
}
