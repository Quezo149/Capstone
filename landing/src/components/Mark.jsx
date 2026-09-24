import useInView from '../hooks/useInView'
import './Mark.css'

// Palabra clave destacada que se "dibuja" al entrar en pantalla (como el subrayado del hero).
//   variant → 'underline' (subrayado amarillo) | 'hl' (marcador completo) | 'brand' (color de marca)
//   delay   → ms antes de dibujarse
export default function Mark({ children, variant = 'underline', delay = 350 }) {
  const [ref, inView] = useInView({ threshold: 0.5, rootMargin: '0px' })
  return (
    <span ref={ref} className={`mark mark-${variant}${inView ? ' in' : ''}`} style={{ '--md': `${delay}ms` }}>
      {children}
    </span>
  )
}
