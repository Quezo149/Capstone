import Icon from './Icon'
import Mark from './Mark'
import Reveal from './Reveal'
import './Pricing.css'

const PLANS = [
  {
    name: 'Free',
    forWho: 'Para empezar a organizar las finanzas de tu negocio.',
    price: '$ 0',
    priceNote: 'para siempre',
    features: [
      { ok: true, text: '1 usuario' },
      { ok: true, text: 'Movimientos y lecturas con IA limitados al mes' },
      { ok: true, text: 'Importación de Excel' },
    ],
    cta: 'Probar gratis',
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
      { ok: true, text: 'Dueño, contador y empleados' },
      { ok: true, text: 'Lectura de boletas y facturas sin límite duro' },
      { ok: true, text: 'Reportes por categoría, usuario y fecha' },
      { ok: true, text: 'Presupuestos por categoría' },
    ],
    cta: 'Súmate al piloto',
    ctaClass: 'btn-primary',
  },
  {
    name: 'Contador',
    forWho: 'Administra varios negocios desde una cuenta.',
    price: 'Por definir',
    features: [
      { ok: true, text: 'Varias empresas desde una cuenta' },
      { ok: true, text: 'Lectura y exportación' },
      { ok: false, text: 'Sin carga de movimientos' },
    ],
    cta: 'Próximamente',
    ctaClass: 'btn-ghost',
    disabled: true,
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
              className={`plan${p.featured ? ' featured' : ''}${p.disabled ? ' soon' : ''}`}
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
              {p.disabled ? (
                <button className={`btn ${p.ctaClass}`} type="button" disabled>
                  {p.cta}
                </button>
              ) : (
                <a className={`btn ${p.ctaClass}`} href="#piloto">
                  {p.cta}
                </a>
              )}
            </Reveal>
          ))}
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
