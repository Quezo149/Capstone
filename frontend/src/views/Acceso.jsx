import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import Logo from '../components/Logo'
import { useSesion } from '../state/Sesion'
import './Acceso.css'

// Pantalla de inicio de sesión (HU01) y de avisos de sesión. El correo y la contraseña
// se escriben en la página de Microsoft Entra, no aquí: KontadorIA no guarda contraseñas.
export default function Acceso() {
  const { estado, error, entrar, salir, reintentar } = useSesion()

  if (estado === 'desactivado') {
    return (
      <Marco titulo="Tu acceso está desactivado" eyebrow="Sesión">
        <p className="acceso-aviso">
          El administrador de tu empresa desactivó tu acceso a KontadorIA. Si crees que es un error, habla con él.
        </p>
        <div className="acceso-acts">
          <button type="button" className="btn btn-ghost" onClick={salir}>
            <Icon name="logout" />
            Cerrar sesión
          </button>
        </div>
      </Marco>
    )
  }

  if (estado === 'error') {
    return (
      <Marco titulo="No pudimos cargar tu cuenta" eyebrow="Sesión">
        <p className="acceso-aviso">{error}</p>
        <div className="acceso-acts">
          <button type="button" className="btn btn-primary" onClick={reintentar}>
            <Icon name="undo" />
            Reintentar
          </button>
          <button type="button" className="btn btn-text" onClick={salir}>
            Cerrar sesión
          </button>
        </div>
      </Marco>
    )
  }

  if (estado === 'sin_config') {
    return (
      <Marco titulo="Falta configurar el inicio de sesión" eyebrow="Desarrollo">
        <p className="muted">
          Copia <code>frontend/.env.example</code> a <code>frontend/.env.local</code> y vuelve a levantar{' '}
          <code>npm run dev</code>.
        </p>
      </Marco>
    )
  }

  return (
    <Marco titulo="Las cuentas de tu negocio, en orden" eyebrow="Bienvenido">
      <p className="muted">Ingresa con tu correo para ver y registrar los movimientos de tu empresa.</p>
      <div className="acceso-acts">
        <button type="button" className="btn btn-primary" onClick={() => entrar()}>
          Iniciar sesión
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => entrar({ crear: true })}>
          Crear una cuenta
        </button>
      </div>
      <p className="acceso-nota">
        <Icon name="lock" />
        <span>
          Te llevaremos a la página segura de Microsoft. ¿Olvidaste tu contraseña? Ahí mismo puedes recuperarla.
        </span>
      </p>
    </Marco>
  )
}

// Mientras se procesa la vuelta desde Microsoft y se pregunta a la API quién es. Normalmente dura
// un instante; si la API y la base estaban en pausa puede tardar hasta un par de minutos, y antes
// esto era una pantalla en blanco que parecía colgada.
export function Cargando() {
  const [paso, setPaso] = useState(0) // 0: nada (evita un parpadeo), 1: cargando, 2: aviso de demora
  useEffect(() => {
    const t1 = setTimeout(() => setPaso(1), 400)
    const t2 = setTimeout(() => setPaso(2), 6000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])
  if (paso === 0) return <main className="acceso" />
  return (
    <Marco titulo="Entrando a tu cuenta" eyebrow="Un momento">
      <div className="acceso-cargando" role="status">
        <span className="acceso-spinner" aria-hidden="true" />
        <p className="muted">
          {paso === 1
            ? 'Cargando los datos de tu empresa…'
            : 'Estamos preparando el servidor; la primera vez en el día puede tardar hasta un minuto. No cierres esta página.'}
        </p>
      </div>
    </Marco>
  )
}

export function Marco({ titulo, eyebrow, ancha, children }) {
  return (
    <main className="acceso">
      <section className={`acceso-card${ancha ? ' ancha' : ''}`}>
        <header>
          <Logo />
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1>{titulo}</h1>
        </header>
        {children}
      </section>
    </main>
  )
}
