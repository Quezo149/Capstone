import { useState } from 'react'
import App from './App.jsx'
import { invitacionPendiente } from './lib/invitacion'
import { CategoriasProvider } from './state/Categorias'
import { MovimientosProvider } from './state/Movimientos'
import { useSesion } from './state/Sesion'
import Acceso, { Cargando } from './views/Acceso'
import Invitacion from './views/Invitacion'
import RegistroEmpresa from './views/RegistroEmpresa'

// Qué se muestra según la sesión (ver state/Sesion.jsx): la app solo con rol y empresa resueltos.
export default function Raiz() {
  const { estado, perfil } = useSesion()
  // Link de invitación abierto (HU02): tiene prioridad hasta aceptarlo o descartarlo
  const [invitacion, setInvitacion] = useState(invitacionPendiente)
  if (estado === 'cargando') return <Cargando />
  if (invitacion && ['anonimo', 'sin_empresa', 'listo', 'desactivado'].includes(estado)) {
    return <Invitacion token={invitacion} onTerminar={() => setInvitacion(null)} />
  }
  if (estado === 'sin_empresa') return <RegistroEmpresa />
  if (estado !== 'listo') return <Acceso />
  return (
    // key: si cambia la empresa, categorías y movimientos parten de cero
    <CategoriasProvider key={perfil.empresa_id}>
      <MovimientosProvider>
        <App />
      </MovimientosProvider>
    </CategoriasProvider>
  )
}
