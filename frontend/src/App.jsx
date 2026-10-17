import { useCallback, useEffect, useMemo, useState } from 'react'
import Drawer from './components/Drawer'
import MovimientoForm from './components/MovimientoForm'
import Shell from './components/Shell'
import useHashRoute from './hooks/useHashRoute'
import { clp } from './lib/format'
import { useMovimientos } from './state/Movimientos'
import { useToast } from './state/Toasts'
import DatosLocales from './views/DatosLocales'
import Inicio from './views/Inicio'
import MiEmpresa from './views/MiEmpresa'
import Movimientos from './views/Movimientos'
import Pronto from './views/Pronto'

// Herramientas de datos locales (cargar ejemplo / borrar todo): ocultas para que la app se vea
// como producto. Se muestran solo abriendo la URL con ?debug  →  http://localhost:5173/?debug
const DEBUG = new URLSearchParams(window.location.search).has('debug')

export default function App() {
  const ruta = useHashRoute()
  const { movs, cargando, crear, actualizar, eliminar, restaurar } = useMovimientos()
  const { aviso } = useToast()
  // null = cerrado · { mov: null } = nuevo · { mov } = editar
  const [panel, setPanel] = useState(null)
  // Cambia en cada apertura: monta un formulario limpio (nuevo client_request_id)
  const [vez, setVez] = useState(0)

  const abrir = useCallback((mov = null) => {
    setVez((n) => n + 1)
    setPanel({ mov })
  }, [])
  const nuevo = useCallback(() => abrir(null), [abrir])
  const cerrar = useCallback(() => setPanel(null), [])

  // Atajo de teclado: N abre "Nuevo movimiento" (si no se está escribiendo en un campo)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target.closest('input, textarea, select, [contenteditable]') || panel) return
      e.preventDefault()
      nuevo()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [nuevo, panel])

  // Proveedores ya usados, para autocompletar
  const proveedores = useMemo(() => [...new Set(movs.map((m) => m.proveedor).filter(Boolean))].sort(), [movs])

  async function guardar(datos, { otro }) {
    if (panel.mov) {
      await actualizar(panel.mov.id, datos)
      aviso('Cambios guardados')
      cerrar()
      return
    }
    const m = await crear(datos)
    aviso(`${m.tipo === 'gasto' ? 'Gasto' : 'Ingreso'} guardado: ${clp(m.monto)}`, { festejo: true })
    if (!otro) cerrar()
  }

  async function borrar() {
    const m = await eliminar(panel.mov.id)
    cerrar()
    if (m) aviso('Movimiento eliminado', { accion: { label: 'Deshacer', onClick: () => restaurar(m) } })
  }

  let vista
  if (cargando) vista = null
  else if (ruta === 'inicio') vista = <Inicio onNuevo={nuevo} onEditar={abrir} />
  else if (ruta === 'movimientos') vista = <Movimientos onNuevo={nuevo} onEditar={abrir} />
  else if (ruta === 'empresa') vista = <MiEmpresa />
  else vista = <Pronto ruta={ruta} />

  const editando = Boolean(panel?.mov)

  return (
    <>
      <Shell ruta={ruta} onNuevo={nuevo} pie={DEBUG ? <DatosLocales /> : null}>
        {vista}
      </Shell>
      {/* Fuera de Shell: su <main> se vuelve a montar al cambiar de ruta y cerraría el panel */}
      <Drawer
        abierto={Boolean(panel)}
        onCerrar={cerrar}
        eyebrow={editando ? 'Editar' : 'Registro manual'}
        titulo={editando ? 'Editar movimiento' : 'Nuevo movimiento'}
      >
        {panel && (
          <MovimientoForm
            key={vez}
            inicial={panel.mov}
            proveedores={proveedores}
            onGuardar={guardar}
            onEliminar={borrar}
          />
        )}
      </Drawer>
    </>
  )
}
