import EmpresaForm from '../components/EmpresaForm'
import { VERSION as POLITICA_VERSION } from '../data/politica'
import { api } from '../lib/api'
import { useSesion } from '../state/Sesion'
import { Marco } from './Acceso'

// Primer inicio de sesión de un dueño (HU17): registra su empresa y queda como administrador.
// Quien llega con una invitación (HU02) ya pertenece a una empresa y nunca ve esta pantalla.
export default function RegistroEmpresa() {
  const { refrescar, salir } = useSesion()

  async function guardar(datos) {
    await api('/empresas', {
      method: 'POST',
      body: { ...datos, acepta_politica: true, politica_version: POLITICA_VERSION },
    })
    await refrescar()
  }

  return (
    <Marco titulo="Registra tu empresa" eyebrow="Último paso" ancha>
      <p className="muted">
        Con estos datos identificamos a tu negocio. Quedarás como administrador y después podrás invitar a tu contador y a
        tu equipo.
      </p>
      <EmpresaForm textoBoton="Crear mi empresa" onGuardar={guardar} conPolitica />
      <button type="button" className="btn btn-text" onClick={salir}>
        Usar otra cuenta
      </button>
    </Marco>
  )
}
