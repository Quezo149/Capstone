import Icon from '../components/Icon'
import Mark from '../components/Mark'
import { useMovimientos } from '../state/Movimientos'
import { useToast } from '../state/Toasts'
import './Bienvenida.css'

// Estado vacío: todavía no hay ningún movimiento guardado en este navegador.
export default function Bienvenida({ onNuevo }) {
  const { cargarEjemplo } = useMovimientos()
  const { aviso } = useToast()

  return (
    <section className="welcome deep-card">
      <div className="welcome-art" aria-hidden="true">
        <svg viewBox="0 0 28 32">
          <path d="M2 2h24v24l-3 3-3-3-3 3-3-3-3 3-3-3-3 3-3-3z" fill="var(--surface)" />
          <rect x="6" y="15" width="16" height="5" rx="1.5" fill="var(--highlight)" />
          <rect x="6" y="8" width="11" height="2.4" rx="1.2" fill="var(--brand)" />
        </svg>
      </div>
      <div className="welcome-txt">
        <span className="eyebrow">Empecemos</span>
        <h1>
          Tu primer movimiento toma <Mark variant="hl">10 segundos</Mark>.
        </h1>
        <p>Anota un gasto o un ingreso y empieza a ver cuánto entra y cuánto sale de tu negocio cada mes.</p>
        <div className="welcome-acts">
          <button type="button" className="btn quick-btn" onClick={onNuevo}>
            <Icon name="plus" />
            Agregar el primero
          </button>
          <button
            type="button"
            className="btn btn-ghost welcome-ghost"
            onClick={async () => {
              await cargarEjemplo()
              aviso('Cargamos 3 meses de ejemplo para que explores', { festejo: true })
            }}
          >
            <Icon name="spark" />
            Ver con datos de ejemplo
          </button>
        </div>
      </div>
    </section>
  )
}
