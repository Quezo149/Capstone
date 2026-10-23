// Los símbolos viven en el sprite de index.html. El tamaño lo define el CSS del contenedor
// (por ejemplo `.btn svg`), igual que en la landing.
// Nombres: home, list, camera, checkc, chart, users, receipt, search, in, out, plus, x,
//          check, trash, moon, sun, spark, undo, pen, building, logout, lock, tag
// Cada ícono lleva la clase i-<nombre> (ej. .i-plus) para animarlo según cuál es.
export default function Icon({ name, className, ...props }) {
  return (
    <svg aria-hidden="true" className={className ? `i-${name} ${className}` : `i-${name}`} {...props}>
      <use href={`#i-${name}`} />
    </svg>
  )
}
