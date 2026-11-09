import Icon from '../components/Icon'
import { NOMBRE_ROL } from '../data/demo'
import { SECCIONES } from '../data/secciones'
import { useSesion } from '../state/Sesion'
import './Pronto.css'

// Pantalla para las secciones que aún no se construyen (cuenta qué hará cada una) y para las que
// el rol no incluye (por ejemplo, el contador que abre #/cargar desde un link).
const QUE_HARA = {
  cargar: 'Sacas una foto o subes el PDF de la boleta, la IA lee proveedor, fecha y montos, y tú confirmas antes de guardar. También podrás importar tu planilla Excel.',
  revisar: 'Aquí quedan los documentos leídos por la IA que esperan tu confirmación. Solo lo confirmado cuenta en tus reportes.',
  reportes: 'Estado de resultados simple del mes, IVA estimado y un botón para mandarle todo a tu contador.',
  equipo: 'Invita a tu contador y a quien te ayuda con la caja. Cada uno ve solo lo que su rol permite.',
}

export default function Pronto({ ruta }) {
  const s = SECCIONES.find((x) => x.id === ruta)
  const { perfil, puede } = useSesion()
  if (!s) return <NoExiste />
  if (s.permiso && !puede(s.permiso)) return <FueraDelRol seccion={s} rol={NOMBRE_ROL[perfil.rol]} />
  return (
    <section className="soon-page">
      <span className="soon-ic">
        <Icon name={s.icon} />
      </span>
      <span className="eyebrow">En construcción</span>
      <h1>{s.label}</h1>
      <p className="muted">{QUE_HARA[s.id]}</p>
      <a className="btn btn-primary" href="#/movimientos">
        Mientras tanto, ver movimientos
      </a>
    </section>
  )
}

// Sin tono de error: no hizo nada malo, solo es una sección de otro rol
function FueraDelRol({ seccion, rol }) {
  return (
    <section className="soon-page">
      <span className="soon-ic">
        <Icon name={seccion.icon} />
      </span>
      <h1>{seccion.label}</h1>
      <p className="muted">
        Esta sección no está incluida en tu rol de {rol}. Si la necesitas, pídele al dueño de la empresa que ajuste tu rol.
      </p>
      <a className="btn btn-primary" href="#/inicio">
        Volver al inicio
      </a>
    </section>
  )
}

function NoExiste() {
  return (
    <section className="soon-page">
      <span className="soon-ic">
        <Icon name="search" />
      </span>
      <h1>Esta página no existe</h1>
      <a className="btn btn-primary" href="#/inicio">
        Volver al inicio
      </a>
    </section>
  )
}
