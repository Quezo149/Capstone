// Los símbolos viven en el sprite de index.html. El tamaño lo define el CSS del contenedor
// (por ejemplo `.btn svg`), igual que en la landing.
// Nombres: home, list, camera, checkc, chart, users, receipt, search, in, out, plus, x,
//          check, trash, moon, sun, spark, undo, pen
export default function Icon({ name, ...props }) {
  return (
    <svg aria-hidden="true" {...props}>
      <use href={`#i-${name}`} />
    </svg>
  )
}
