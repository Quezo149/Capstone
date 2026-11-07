import { NOMBRE_ROL } from '../data/demo'
import { SECCIONES } from '../data/secciones'
import useTheme from '../hooks/useTheme'
import { useSesion } from '../state/Sesion'
import Icon from './Icon'
import Logo from './Logo'
import MenuEmpresa from './MenuEmpresa'
import './Shell.css'

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
  const { perfil, salir, puede } = useSesion()
  const secciones = SECCIONES.filter((s) => !s.permiso || puede(s.permiso))
  // En el celular la barra inferior lleva 4 secciones y el botón "+" al centro
  // El contador no carga boletas: en su lugar ve Importar planilla (PROTOTIPO Sprint 4)
  const tercera = puede('movimientos.registrar') ? 'cargar' : puede('importaciones.realizar') ? 'importar' : 'categorias'
  const movil = ['inicio', 'movimientos', tercera, 'reportes'].map((id) =>
    SECCIONES.find((s) => s.id === id),
  )

  return (
    <div className="app">
      <aside className="side" aria-label="Navegación principal">
        <Logo />
        {/* onNuevo es null cuando el rol no registra movimientos (contador, HU03) */}
        {onNuevo && (
          <button type="button" className="btn btn-primary side-new" onClick={onNuevo}>
            <Icon name="plus" />
            Nuevo movimiento
            <kbd>N</kbd>
          </button>
        )}
        <nav className="nav">
          {secciones.map((s) => (
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
            <strong>{perfil.empresa_nombre}</strong>
            <span>{NOMBRE_ROL[perfil.rol]}</span>
          </div>
          <div className="top-actions">
            <button
              type="button"
              className="icon-btn theme-btn solo-pc"
              onClick={toggle}
              aria-label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              title={dark ? 'Tema claro' : 'Tema oscuro'}
            >
              <Icon name={dark ? 'sun' : 'moon'} key={dark ? 'sun' : 'moon'} />
            </button>
            <MenuEmpresa
              perfil={perfil}
              ruta={ruta}
              dark={dark}
              onTema={toggle}
              onSalir={salir}
            />
          </div>
        </header>
        <main className="main" key={ruta}>
          {children}
        </main>
      </div>

      {/* Sin el botón "+" (contador) quedan 4 secciones parejas, sin el hueco del centro */}
      <nav className={`bottom-nav${onNuevo ? '' : ' sin-fab'}`} aria-label="Navegación principal">
        {movil.slice(0, 2).map((s) => (
          <NavLink key={s.id} s={s} actual={ruta} corto />
        ))}
        {onNuevo ? (
          <button type="button" className="fab" onClick={onNuevo} aria-label="Nuevo movimiento">
            <Icon name="plus" />
          </button>
        ) : null}
        {movil.slice(2).map((s) => (
          <NavLink key={s.id} s={s} actual={ruta} corto />
        ))}
      </nav>
    </div>
  )
}
