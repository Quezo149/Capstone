// Grupo de botones excluyentes con una píldora que se desliza hasta la opción elegida.
//   opciones → [{ id, label }]
export default function Seg({ opciones, valor, onChange, label, className = '' }) {
  const i = Math.max(0, opciones.findIndex((o) => o.id === valor))
  return (
    <div className={`seg ${className}`} role="group" aria-label={label} style={{ '--n': opciones.length, '--i': i }}>
      <span className="pill" aria-hidden="true" />
      {opciones.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === valor} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
