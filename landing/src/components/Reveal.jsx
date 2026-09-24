import useInView from '../hooks/useInView'
import './Reveal.css'

// Envuelve un elemento y lo hace aparecer (fade + desplazamiento) al entrar en pantalla.
//   as    → etiqueta a renderizar (div, article, li, h1...). Conserva tu className.
//   from  → 'left' | 'right' | 'scale' (por defecto sube desde abajo)
//   delay → ms de espera, para escalonar tarjetas o listas
export default function Reveal({ as: Tag = 'div', from, delay = 0, className = '', style, children, ...rest }) {
  const [ref, inView] = useInView()
  return (
    <Tag
      ref={ref}
      data-from={from}
      className={`reveal${inView ? ' in' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--d': `${delay}ms`, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
