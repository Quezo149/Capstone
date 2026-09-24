import { useEffect, useRef, useState } from 'react'
import useTheme from '../hooks/useTheme'
import Logo from './Logo'
import './Navbar.css'

const LINKS = [
  { href: '#carga', label: 'Cómo funciona' },
  { href: '#roles', label: 'Equipo' },
  { href: '#seguridad', label: 'Seguridad' },
  { href: '#planes', label: 'Planes' },
  { href: '#preguntas', label: 'Preguntas' },
]

export default function Navbar() {
  const { dark, toggle } = useTheme()
  const [scrolled, setScrolled] = useState(() => window.scrollY > 8)
  const navRef = useRef(null)

  useEffect(() => {
    // La barra de progreso se actualiza directo en el DOM (variable CSS) para no re-renderizar en cada scroll.
    const updateProgress = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      navRef.current?.style.setProperty('--progress', max > 0 ? String(Math.min(window.scrollY / max, 1)) : '0')
    }
    const onScroll = () => {
      setScrolled(window.scrollY > 8)
      updateProgress()
    }
    updateProgress()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', updateProgress)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', updateProgress)
    }
  }, [])

  return (
    <header ref={navRef} className={`nav${scrolled ? ' scrolled' : ''}`}>
      <div className="wrap">
        <Logo />
        <ul className="nav-links">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href}>{l.label}</a>
            </li>
          ))}
        </ul>
        <button
          className="theme-toggle"
          type="button"
          aria-pressed={dark}
          aria-label={dark ? 'Activar modo claro' : 'Activar modo oscuro'}
          title="Cambiar entre modo claro y oscuro"
          onClick={toggle}
        >
          <svg className="moon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          </svg>
          <svg className="sun" viewBox="0 0 24 24" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
            </g>
          </svg>
        </button>
        <a className="btn btn-primary" href="#piloto">
          Súmate al piloto
        </a>
      </div>
    </header>
  )
}
