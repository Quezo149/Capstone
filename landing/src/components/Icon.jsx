// Los símbolos viven en el sprite de index.html. El tamaño lo define el CSS del contenedor
// (por ejemplo `.btn svg`), igual que en la landing original.
// Nombres: check, x, arrow, camera, sheet, pen, upload, lock, eye, link, file, plus, replay
export default function Icon({ name, ...props }) {
  return (
    <svg aria-hidden="true" {...props}>
      <use href={`#i-${name}`} />
    </svg>
  )
}
