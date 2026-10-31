import Icon from './Icon'
import Mark from './Mark'
import Reveal from './Reveal'
import { LINK_CREAR_CUENTA, LINK_INICIAR_SESION } from '../data/app'
import './FinalCta.css'

const PASOS = [
  'Crea tu cuenta con tu correo (Microsoft verifica que sea tuyo).',
  'Registra tu empresa con su RUT: quedas como dueño.',
  'Invita a tu contador y a tus colaboradores cuando quieras.',
]

// Cierre de la página. Antes era un formulario de interés; ahora lleva directo a la app.
// id="piloto": los enlaces antiguos a kontadoria.cl/#piloto siguen llegando aquí.
export default function FinalCta() {
  return (
    <section className="sec deep final" id="piloto" aria-labelledby="fin-title">
      <div className="wrap box">
        <Reveal>
          <span className="eyebrow">Programa piloto</span>
          <h2 id="fin-title">
            Buscamos las primeras <Mark variant="hl">PYMEs</Mark>.
          </h2>
          <p className="lead">
            Durante el piloto usas el plan PYME completo sin costo. A cambio, nos cuentas qué funciona y qué no.
          </p>
        </Reveal>

        <Reveal className="final-card" from="right" delay={150}>
          <h3>Empieza en tres pasos</h3>
          <ol className="final-steps">
            {PASOS.map((p, i) => (
              <li key={p}>
                <span className="n">{i + 1}</span>
                {p}
              </li>
            ))}
          </ol>
          <a className="btn btn-primary" href={LINK_CREAR_CUENTA}>
            Crear cuenta gratis <Icon name="arrow" />
          </a>
          <p className="final-login">
            ¿Ya tienes cuenta? <a href={LINK_INICIAR_SESION}>Inicia sesión</a>
          </p>
        </Reveal>
      </div>
    </section>
  )
}
