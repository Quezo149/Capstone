import { useEffect, useRef, useState } from 'react'
import { NOMBRE_ROL } from '../data/demo'
import Icon from './Icon'
import './MenuEmpresa.css'

const iniciales = (n) =>
  n
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')

// Menú del círculo de la empresa (cabecera): solo cuenta y sesión. Escritorio: Mi empresa y Cerrar
// sesión (el tema tiene su botón al lado). Celular: además el tema. Categorías y Equipo NO van
// aquí: se llega a ellas desde Mi empresa, que es el lugar de los ajustes del negocio.
// Es un botón que muestra/oculta una lista de enlaces (patrón "disclosure"): Escape lo cierra y
// devuelve el foco al botón; también se cierra al tocar fuera o al cambiar de sección.
export default function MenuEmpresa({ perfil, ruta, dark, onTema, onSalir }) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef(null)
  const boton = useRef(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e) => !caja.current?.contains(e.target) && setAbierto(false)
    const tecla = (e) => {
      if (e.key !== 'Escape') return
      setAbierto(false)
      boton.current?.focus()
    }
    const cerrar = () => setAbierto(false)
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', tecla)
    window.addEventListener('hashchange', cerrar)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', tecla)
      window.removeEventListener('hashchange', cerrar)
    }
  }, [abierto])


  return (
    <div className="me" ref={caja}>
      <button
        ref={boton}
        type="button"
        className="avatar"
        aria-expanded={abierto}
        aria-controls="menu-empresa"
        aria-label={`Menú de ${perfil.empresa_nombre}`}
        title={perfil.empresa_nombre}
        onClick={() => setAbierto((x) => !x)}
      >
        {/* Las iniciales son de la empresa: la app no muestra nombres de personas */}
        {iniciales(perfil.empresa_nombre)}
      </button>
      {abierto && (
        <div id="menu-empresa" className="me-panel">
          <div className="me-quien">
            <strong>{perfil.empresa_nombre}</strong>
            <span>{NOMBRE_ROL[perfil.rol]}</span>
          </div>
          <a href="#/empresa" className="me-item" aria-current={ruta === 'empresa' ? 'page' : undefined} onClick={() => setAbierto(false)}>
            <Icon name="building" />
            Mi empresa
          </a>
          <button type="button" className="me-item solo-movil" onClick={onTema}>
            <Icon name={dark ? 'sun' : 'moon'} />
            {dark ? 'Tema claro' : 'Tema oscuro'}
          </button>
          <hr />
          <button type="button" className="me-item me-salir" onClick={onSalir}>
            <Icon name="logout" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}
