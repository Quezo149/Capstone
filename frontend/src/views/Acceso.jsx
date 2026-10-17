import Icon from '../components/Icon'
import Logo from '../components/Logo'
import { useSesion } from '../state/Sesion'
import './Acceso.css'

// Pantalla de inicio de sesión (HU01) y de avisos de sesión. El correo y la contraseña
// se escriben en la página de Microsoft Entra, no aquí: KontadorIA no guarda contraseñas.
export default function Acceso() {
  const { estado, error, entrar, salir, refrescar } = useSesion()

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
          <button type="button" className="btn btn-primary" onClick={refrescar}>
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
