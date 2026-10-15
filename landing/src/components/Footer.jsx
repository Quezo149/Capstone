import Logo from './Logo'
import { HASH } from '../data/privacidad'
import './Footer.css'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <Logo label="KontadorIA, volver arriba" />
        <span>
          Gestión de gastos e ingresos para PYMEs chilenas · Santiago, Chile · 2026 ·{' '}
          <a href={HASH}>Política de privacidad</a>
        </span>
      </div>
    </footer>
  )
}
