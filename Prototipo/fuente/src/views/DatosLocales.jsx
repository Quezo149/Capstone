import { useEffect, useState } from 'react'
import { useMovimientos } from '../state/Movimientos'
import { useToast } from '../state/Toasts'

// Pie de la barra lateral, solo con ?debug: carga o borra datos de prueba de la empresa.
// OJO: escribe en la base de verdad (la API), no en el navegador.
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
      <strong>Herramientas de prueba</strong>
      <span>
        {movs.length} {movs.length === 1 ? 'movimiento visible' : 'movimientos visibles'} para tu usuario en esta empresa.
      </span>
      <div className="local-acts">
        {movs.length === 0 ? (
          <button
            type="button"
            className="btn btn-text btn-sm"
            onClick={async () => {
              try {
                await cargarEjemplo()
                aviso('Datos de ejemplo cargados', { festejo: true })
              } catch (e) {
                aviso(e.message)
              }
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
              setConfirmar(false)
              try {
                await borrarTodo()
                aviso('Borramos todos los movimientos')
              } catch (e) {
                aviso(e.message)
              }
            }}
          >
            {confirmar ? '¿Seguro? Toca otra vez' : 'Borrar todo'}
          </button>
        )}
      </div>
    </div>
  )
}
