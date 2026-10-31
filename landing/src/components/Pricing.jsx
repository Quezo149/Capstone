import Icon from './Icon'
import Mark from './Mark'
import Reveal from './Reveal'
import { LINK_CREAR_CUENTA } from '../data/app'
import './Pricing.css'

const PLANS = [
  {
    name: 'Free',
    forWho: 'Empieza a organizar las finanzas de tu negocio.',
    price: '$ 0',
    priceNote: 'para siempre',
    features: [
      { ok: true, text: '1 usuario' },
      { ok: true, text: 'Movimientos y lecturas con IA limitados al mes' },
      { ok: true, text: 'Importación de Excel' },
    ],
    cta: 'Crear cuenta gratis',
    ctaClass: 'btn-ghost',
  },
  {
    name: 'PYME',
    featured: true,
    tag: 'Gratis durante el piloto',
    forWho: 'Lleva la gestión financiera a todo tu equipo.',
    price: '$ 0',
    priceNote: 'durante el piloto',
    features: [
      { ok: true, text: 'Dueño, contador y colaboradores' },
      { ok: true, text: 'Lectura de boletas y facturas sin límite duro' },
      { ok: true, text: 'Reportes por categoría, usuario y fecha' },
      { ok: true, text: 'Presupuestos por categoría' },
    ],
    cta: 'Crear cuenta gratis',
    ctaClass: 'btn-primary',
  },
]

export default function Pricing() {
  return (
    <section className="sec" id="planes" aria-labelledby="pl-title">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Planes</span>
          <h2 id="pl-title">
            <Mark>Empieza gratis.</Mark> Construyamos juntos el futuro de tus finanzas.
          </h2>
          <p className="lead">
            Sé parte de las primeras PYMEs en probar la plataforma. Durante el piloto es gratis y tu feedback nos
            ayudará a mejorarla.
          </p>
        </Reveal>
        <div className="plans">
          {PLANS.map((p, i) => (
            <Reveal
              as="article"
              className={`plan${p.featured ? ' featured' : ''}`}
              key={p.name}
              delay={i * 130}
            >
              {p.tag && <span className="tagtop">{p.tag}</span>}
              <h3>{p.name}</h3>
              <p className="for">{p.forWho}</p>
              <div className="price">
                <b>{p.price}</b>
                {p.priceNote && <small>{p.priceNote}</small>}
              </div>
              <ul className="can">
                {p.features.map((f) => (
                  <li key={f.text} className={f.ok ? undefined : 'no'}>
                    <Icon name={f.ok ? 'check' : 'x'} className={f.ok ? 'y' : 'n'} />
                    {f.text}
                  </li>
                ))}
              </ul>
              <a className={`btn ${p.ctaClass}`} href={LINK_CREAR_CUENTA}>
                {p.cta}
              </a>
            </Reveal>
          ))}
          {/* Contador todavía no es un plan: tarjeta punteada, sin precio. Hoy el contador entra invitado por la PYME. */}
          <Reveal as="article" className="plan contador-card" delay={PLANS.length * 130}>
            <h3>¿Eres contador y llevas varias PYMEs?</h3>
            <p className="for">
              Hoy entras a cada empresa cuando tu cliente te invita como contador. Estamos diseñando una cuenta para
              gestionar a todos tus clientes en un solo lugar: crea tu cuenta y cuéntanos qué necesitas.
            </p>
            <a className="btn btn-ghost" href={LINK_CREAR_CUENTA}>
              Crea tu cuenta <Icon name="arrow" />
            </a>
          </Reveal>
        </div>
        <Reveal as="p" className="plans-note">
          Estamos construyendo la plataforma junto a las primeras PYMEs que la prueban.
        </Reveal>
        <Reveal as="p" className="plans-note">
          Durante el piloto, puedes usarla sin costo y ayudarnos a mejorarla con tu feedback.
        </Reveal>
      </div>
    </section>
  )
}
