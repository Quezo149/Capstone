import { useState } from 'react'
import Icon from './Icon'
import Mark from './Mark'
import Reveal from './Reveal'
import './SignupForm.css'

const TEAM_SIZES = ['Solo yo', '2 a 5', '6 a 10', '11 a 20', 'Más de 20']
const TODAY = ['Excel o Google Sheets', 'WhatsApp y fotos', 'Papel y boletas sueltas', 'Otro sistema']
const EMAIL_RE = /^\S+@\S+\.\S+$/

// Backend (Azure Functions + FastAPI). En producción se define VITE_API_URL en Netlify;
// en desarrollo, si no está definida, apunta a `func start` local.
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:7071' : '')

// Confeti del mensaje de éxito: 14 piezas repartidas en círculo (valores fijos, sin aleatoriedad en el render).
const CONFETTI = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2
  const dist = i % 2 ? 96 : 68
  return {
    x: Math.round(Math.cos(angle) * dist),
    y: Math.round(Math.sin(angle) * dist),
    r: (i * 47) % 360,
    tone: i % 3,
  }
})

export default function SignupForm() {
  const [values, setValues] = useState({ nombre: '', email: '', empresa: '', equipo: '2 a 5', hoy: TODAY[0] })
  const [error, setError] = useState(null) // { field, message }
  const [sent, setSent] = useState(null) // { nombre, empresa }
  const [sending, setSending] = useState(false)

  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  function fail(form, field, message) {
    setError({ field, message })
    form.elements[field].focus()
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (sending) return
    const form = e.currentTarget
    const nombre = values.nombre.trim()
    const email = values.email.trim()
    const empresa = values.empresa.trim()

    if (!nombre) return fail(form, 'nombre', 'Escribe tu nombre para saber a quién contactar.')
    if (!EMAIL_RE.test(email)) return fail(form, 'email', 'Revisa el correo: debe verse como nombre@empresa.cl.')
    if (!empresa) return fail(form, 'empresa', 'Falta el nombre de tu empresa.')

    setError(null)
    setSending(true)
    try {
      const res = await fetch(`${API_URL}/piloto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, empresa, equipo: values.equipo, hoy: values.hoy }),
      })
      // 422 = el backend rechazó algún campo; cualquier otro error es del servidor.
      if (res.status === 422) throw new Error('Revisa los datos del formulario e inténtalo de nuevo.')
      if (!res.ok) throw new Error('No pudimos registrar tus datos. Inténtalo de nuevo en unos minutos.')
      setSent({ nombre: nombre.split(' ')[0], empresa })
    } catch (err) {
      // fetch lanza TypeError cuando no hay conexión o el backend no responde.
      const message = err instanceof TypeError ? 'No pudimos conectar con el servidor. Revisa tu conexión.' : err.message
      setError({ field: null, message })
    } finally {
      setSending(false)
    }
  }

  const invalid = (field) => error?.field === field

  return (
    <section className="sec deep final" id="piloto" aria-labelledby="fin-title">
      <div className="wrap box">
        <Reveal>
          <span className="eyebrow">Programa piloto</span>
          <h2 id="fin-title">
            Buscamos las primeras PYMEs que quieran <Mark variant="hl">ordenar su mes</Mark>.
          </h2>
          <p className="lead">
            Durante el piloto usas el plan PYME completo sin costo. A cambio, nos cuentas qué funciona y qué no. Cupos
            limitados.
          </p>
        </Reveal>

        <Reveal as="form" className="signup" from="right" delay={150} onSubmit={onSubmit} noValidate>
          {sent ? (
            <div className="ok" aria-live="polite">
              <div className="ok-badge" aria-hidden="true">
                <Icon name="check" />
                {CONFETTI.map((p, i) => (
                  <i
                    key={i}
                    className={`confetti c${p.tone}`}
                    style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--r': `${p.r}deg` }}
                  />
                ))}
              </div>
              <h3>Listo, {sent.nombre}.</h3>
              <p>
                Registramos el interés de <b>{sent.empresa}</b>. Te escribiremos para coordinar el inicio del piloto.
              </p>
            </div>
          ) : (
            <div className="signup-fields">
              <div className="row2">
                <label htmlFor="f-nombre">
                  Tu nombre
                  <input
                    id="f-nombre"
                    name="nombre"
                    autoComplete="name"
                    placeholder="María González"
                    value={values.nombre}
                    onChange={set('nombre')}
                    aria-invalid={invalid('nombre')}
                    aria-describedby="err"
                    required
                  />
                </label>
                <label htmlFor="f-email">
                  Correo
                  <input
                    id="f-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="maria@tupyme.cl"
                    value={values.email}
                    onChange={set('email')}
                    aria-invalid={invalid('email')}
                    aria-describedby="err"
                    required
                  />
                </label>
              </div>
              <div className="row2">
                <label htmlFor="f-empresa">
                  Empresa
                  <input
                    id="f-empresa"
                    name="empresa"
                    autoComplete="organization"
                    placeholder="Nombre de tu PYME"
                    value={values.empresa}
                    onChange={set('empresa')}
                    aria-invalid={invalid('empresa')}
                    aria-describedby="err"
                    required
                  />
                </label>
                <label htmlFor="f-equipo">
                  Personas en el equipo
                  <select id="f-equipo" name="equipo" value={values.equipo} onChange={set('equipo')}>
                    {TEAM_SIZES.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label htmlFor="f-hoy">
                ¿Dónde llevas tus gastos hoy?
                <select id="f-hoy" name="hoy" value={values.hoy} onChange={set('hoy')}>
                  {TODAY.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
              <p className="err-msg" id="err" aria-live="polite">
                {error?.message}
              </p>
              <button className="btn btn-primary" type="submit" disabled={sending} aria-busy={sending}>
                {sending ? 'Enviando…' : 'Quiero sumarme al piloto'} {!sending && <Icon name="arrow" />}
              </button>
              <p className="fine">Usaremos tu correo solo para contactarte sobre el piloto.</p>
            </div>
          )}
        </Reveal>
      </div>
    </section>
  )
}
