import Icon from '../components/Icon'
import { SECCIONES } from '../data/secciones'
import './Pronto.css'

// Pantalla para las secciones que aún no se construyen. Cuenta qué hará cada una.
const QUE_HARA = {
  cargar: 'Sacas una foto o subes el PDF de la boleta, la IA lee proveedor, fecha y montos, y tú confirmas antes de guardar. También podrás importar tu planilla Excel.',
  revisar: 'Aquí quedan los documentos leídos por la IA que esperan tu confirmación. Solo lo confirmado cuenta en tus reportes.',
  reportes: 'Estado de resultados simple del mes, IVA estimado y un botón para mandarle todo a tu contador.',
  equipo: 'Invita a tu contador y a quien te ayuda con la caja. Cada uno ve solo lo que su rol permite.',
}

export default function Pronto({ ruta }) {
  const s = SECCIONES.find((x) => x.id === ruta)
  if (!s) return <NoExiste />
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
