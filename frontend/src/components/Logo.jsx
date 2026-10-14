import './Logo.css'

// Mismo logotipo que la landing: boleta con borde dentado y la línea del total destacada.
export default function Logo({ href = '#/inicio', label = 'KontadorIA, inicio' }) {
  return (
    <a className="logo" href={href} aria-label={label}>
      <svg viewBox="0 0 28 32" aria-hidden="true">
        <path d="M2 2h24v24l-3 3-3-3-3 3-3-3-3 3-3-3-3 3-3-3z" fill="var(--brand)" />
        <rect x="6" y="15" width="16" height="5" rx="1.5" fill="var(--highlight)" />
        <rect x="6" y="8" width="11" height="2.4" rx="1.2" fill="var(--brand-ink)" />
      </svg>
      <span>
        Kontador<b>IA</b>
      </span>
    </a>
  )
}
