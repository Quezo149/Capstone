import Icon from '../components/Icon'
import Mark from '../components/Mark'
import './Bienvenida.css'

// Estado vacío: la empresa todavía no tiene movimientos (o el empleado aún no registra los suyos).
// Los datos de ejemplo ya no se ofrecen aquí: ahora se guardarían en la base real de la empresa
// (siguen disponibles con ?debug, ver DatosLocales). onNuevo null = rol que no registra (contador).
export default function Bienvenida({ onNuevo }) {
  if (!onNuevo) {
    return (
      <section className="welcome deep-card">
        <div className="welcome-txt">
          <span className="eyebrow">Aún no hay movimientos</span>
          <h1>Cuando el equipo registre ingresos y gastos, los verás aquí.</h1>
          <p>Como contador puedes consultar y filtrar todos los movimientos de la empresa.</p>
        </div>
      </section>
    )
  }

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
        </div>
      </div>
    </section>
  )
}
