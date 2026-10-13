import { EMPRESA, NOMBRE_ROL, USUARIO } from '../data/demo'
import { SECCIONES } from '../data/secciones'
import useTheme from '../hooks/useTheme'
import Icon from './Icon'
import Logo from './Logo'
import './Shell.css'

const iniciales = (n) =>
  n
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')

function NavLink({ s, actual, corto }) {
  const contenido = (
    <>
      <Icon name={s.icon} />
      <span>{corto ? (s.corto ?? s.label) : s.label}</span>
      {!s.listo && !corto && <span className="soon-tag">Pronto</span>}
    </>
  )
  // Secciones aún no construidas: se ven desactivadas y no navegan
  if (!s.listo) {
    return (
      <span className="nav-item soon" aria-disabled="true" title={`${s.label}: disponible pronto`}>
        {contenido}
      </span>
    )
  }
  return (
    <a href={`#/${s.id}`} className="nav-item" aria-current={actual === s.id ? 'page' : undefined}>
      {contenido}
    </a>
  )
}

export default function Shell({ ruta, onNuevo, children, pie }) {
  const { dark, toggle } = useTheme()
  // En el celular la barra inferior lleva 4 secciones y el botón "+" al centro
  const movil = ['inicio', 'movimientos', 'cargar', 'reportes'].map((id) => SECCIONES.find((s) => s.id === id))

  return (
    <div className="app">
      <aside className="side" aria-label="Navegación principal">
        <Logo />
        <button type="button" className="btn btn-primary side-new" onClick={onNuevo}>
          <Icon name="plus" />
          Nuevo movimiento
          <kbd>N</kbd>
        </button>
        <nav className="nav">
          {SECCIONES.map((s) => (
            <NavLink key={s.id} s={s} actual={ruta} />
          ))}
        </nav>
        <div className="side-foot">{pie}</div>
      </aside>

      <div className="main-wrap">
        <header className="top">
          <div className="top-logo">
            <Logo />
          </div>
          <div className="company">
            <strong>{EMPRESA.nombre}</strong>
            {EMPRESA.rut ? <span className="mono">RUT {EMPRESA.rut}</span> : <span>{EMPRESA.rubro}</span>}
          </div>
          <div className="top-actions">
            <button
              type="button"
              className="icon-btn theme-btn"
              onClick={toggle}
              aria-label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              title={dark ? 'Tema claro' : 'Tema oscuro'}
            >
              <Icon name={dark ? 'sun' : 'moon'} key={dark ? 'sun' : 'moon'} />
            </button>
            {/* Sin nombre de persona (ver data/demo.js): el avatar usa las iniciales de la empresa */}
            <span className="avatar" title={`${USUARIO.nombre ?? NOMBRE_ROL[USUARIO.rol]} · ${EMPRESA.nombre}`}>
              {iniciales(USUARIO.nombre ?? EMPRESA.nombre)}
            </span>
          </div>
        </header>
        <main className="main" key={ruta}>
          {children}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Navegación principal">
        {movil.slice(0, 2).map((s) => (
          <NavLink key={s.id} s={s} actual={ruta} corto />
        ))}
        <button type="button" className="fab" onClick={onNuevo} aria-label="Nuevo movimiento">
          <Icon name="plus" />
        </button>
        {movil.slice(2).map((s) => (
          <NavLink key={s.id} s={s} actual={ruta} corto />
        ))}
      </nav>
    </div>
  )
}
