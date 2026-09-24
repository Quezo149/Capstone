import Logo from './Logo'
import './Footer.css'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <Logo label="KontadorIA, volver arriba" />
        <span>Gestión de gastos e ingresos para PYMEs chilenas · Santiago, Chile · 2026</span>
      </div>
    </footer>
  )
}
