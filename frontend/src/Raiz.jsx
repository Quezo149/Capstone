import App from './App.jsx'
import { MovimientosProvider } from './state/Movimientos'
import { useSesion } from './state/Sesion'
import Acceso from './views/Acceso'
import RegistroEmpresa from './views/RegistroEmpresa'

// Qué se muestra según la sesión (ver state/Sesion.jsx): la app solo con rol y empresa resueltos.
export default function Raiz() {
  const { estado, perfil } = useSesion()
  if (estado === 'cargando') return null
  if (estado === 'sin_empresa') return <RegistroEmpresa />
  if (estado !== 'listo') return <Acceso />
  return (
    // key: si cambia la empresa, el estado de movimientos parte de cero
    <MovimientosProvider key={perfil.empresa_id} empresaId={perfil.empresa_id}>
      <App />
    </MovimientosProvider>
  )
}
