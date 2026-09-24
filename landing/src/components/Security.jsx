import CountUp from './CountUp'
import Icon from './Icon'
import Mark from './Mark'
import Reveal from './Reveal'
import './Security.css'

const GUARANTEES = [
  {
    icon: 'lock',
    title: 'Solo ves los movimientos de tu negocio',
    text: 'Antes de mostrar información, el sistema comprueba a qué negocio perteneces.',
  },
  {
    icon: 'eye',
    title: 'Cada negocio ve lo suyo',
    text: 'Los movimientos de cada empresa se guardan en su propio espacio y no se mezclan con otras.',
  },
  {
    icon: 'link',
    title: 'Invitaciones a nombre de una persona',
    text: 'El link solo funciona con el correo invitado, sirve una sola vez y vence a las 72 horas.',
  },
  {
    icon: 'file',
    title: 'Boletas guardadas por separado',
    text: 'Los archivos de cada empresa quedan en su propio espacio y se abren con enlaces que expiran.',
  },
]

// value en pesos; kind: 'in' = ingreso (+), 'out' = gasto (−)
const COMPANIES = [
  {
    name: 'Panadería Don Luis',
    tag: 'empresa A',
    lines: [
      { label: 'Harina', value: 86400, kind: 'out' },
      { label: 'Gas', value: 42300, kind: 'out' },
      { label: 'Ventas', value: 1204000, kind: 'in' },
    ],
  },
  {
    name: 'Taller Rivas',
    tag: 'empresa B',
    lines: [
      { label: 'Repuestos', value: 312900, kind: 'out' },
      { label: 'Arriendo', value: 450000, kind: 'out' },
      { label: 'Reparaciones', value: 890500, kind: 'in' },
    ],
  },
]

function Company({ name, tag, lines, from, delay }) {
  return (
    <Reveal className="co" from={from} delay={delay}>
      <h4>
        {name} <small>{tag}</small>
      </h4>
      {lines.map((l) => (
        <div className="ln" key={l.label}>
          <span>{l.label}</span>
          <b className={l.kind}>
            {l.kind === 'in' ? '+' : '−'} $ <CountUp to={l.value} />
          </b>
        </div>
      ))}
      <div className="legend">
        <span>
          <i className="in">+</i> ingreso
        </span>
        <span>
          <i className="out">−</i> gasto
        </span>
      </div>
    </Reveal>
  )
}

export default function Security() {
  return (
    <section className="sec deep" id="seguridad" aria-labelledby="sg-title">
      <div className="wrap sec-grid">
        <div>
          <Reveal>
            <span className="eyebrow">Seguridad</span>
            <h2 id="sg-title">
              Tus números <Mark>no se mezclan</Mark> con los de nadie.
            </h2>
            <p className="lead">
              Cada empresa trabaja en su propio espacio. La separación no depende de lo que muestra la pantalla: la
              aplica la base de datos en cada consulta, incluso si alguien intenta entrar por fuera de la app.
            </p>
          </Reveal>
          <ul className="guarantees">
            {GUARANTEES.map((g, i) => (
              <Reveal as="li" key={g.title} delay={i * 110}>
                <Icon name={g.icon} />
                <div>
                  <strong>{g.title}</strong>
                  <span>{g.text}</span>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>

        <div>
          <div className="vault" aria-label="Ilustración: dos empresas separadas por un muro">
            <Company {...COMPANIES[0]} from="left" />
            <Reveal className="wall" from="scale" delay={250}>
              <span>
                <Icon name="lock" />
              </span>
            </Reveal>
            <Company {...COMPANIES[1]} from="right" delay={120} />
          </div>
          <Reveal as="p" className="law" delay={200}>
            Empresas y montos de ejemplo. KontadorIA se diseña teniendo presente la Ley N° 21.719 de protección de datos
            personales.
          </Reveal>
        </div>
      </div>
    </section>
  )
}
