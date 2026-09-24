import Icon from './Icon'
import Mark from './Mark'
import Reveal from './Reveal'
import './Roles.css'

// tone: color propio de cada rol (brand = verde, sun = amarillo, ink = oscuro)
const ROLES = [
  {
    initial: 'D',
    tone: 'brand',
    name: 'Dueño',
    who: 'Quien lleva el negocio',
    can: [
      { ok: true, text: 'Ve todos los movimientos y reportes' },
      { ok: true, text: 'Invita y gestiona al equipo' },
      { ok: true, text: 'Define categorías y presupuestos' },
    ],
  },
  {
    initial: 'C',
    tone: 'sun',
    name: 'Contador',
    who: 'Tu asesor financiero',
    can: [
      { ok: true, text: 'Lee todos los movimientos' },
      { ok: true, text: 'Exporta reportes a Excel o CSV' },
      { ok: false, text: 'No cambia usuarios ni configuración' },
    ],
  },
  {
    initial: 'E',
    tone: 'ink',
    name: 'Empleado',
    who: 'Registra los movimientos del día a día',
    can: [
      { ok: true, text: 'Sube boletas por foto, PDF o a mano' },
      { ok: true, text: 'Ve solo lo que él mismo cargó' },
      { ok: false, text: 'No ve reportes de la empresa' },
    ],
  },
]

export default function Roles() {
  return (
    <section className="sec" id="roles" aria-labelledby="r-title">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Hecho para cómo trabaja una PYME</span>
          <h2 id="r-title">
            Tu equipo, <Mark variant="brand">tu control</Mark>.
          </h2>
          <p className="lead">
            Dueños, contadores y empleados trabajan en la misma plataforma, pero cada uno accede solo a lo que necesita.
          </p>
        </Reveal>
        <div className="roles">
          {ROLES.map((r, i) => (
            <Reveal as="article" className={`role tone-${r.tone}`} key={r.name} delay={i * 130}>
              <div className="role-top">
                <span className="avatar">{r.initial}</span>
                <div>
                  <h3>{r.name}</h3>
                  <div className="who">{r.who}</div>
                </div>
              </div>
              <ul className="can">
                {r.can.map((c, k) => (
                  <li key={c.text} className={c.ok ? undefined : 'no'} style={{ '--k': k }}>
                    <Icon name={c.ok ? 'check' : 'x'} className={c.ok ? 'y' : 'n'} />
                    {c.text}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
