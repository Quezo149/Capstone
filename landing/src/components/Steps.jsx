import Mark from './Mark'
import Reveal from './Reveal'
import './Steps.css'

const STEPS = [
  {
    title: 'Cargas el gasto el mismo día',
    text: 'Tú o tus empleados suben la boleta desde el celular apenas pagan. Se acabó la guantera.',
  },
  {
    title: 'Revisas y confirmas',
    text: 'La IA propone, tú decides. Corriges lo que haga falta y el movimiento queda registrado con su documento original.',
  },
  {
    title: 'Tu contador lo tiene listo',
    text: 'Entra con su propio acceso, filtra por fecha o categoría y exporta a Excel. Sin correos con adjuntos a fin de mes.',
  },
]

export default function Steps() {
  return (
    <section className="sec steps-sec" aria-labelledby="s-title">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Del documento al contador</span>
          <h2 id="s-title">
            Tu mes, en <Mark variant="hl">tres pasos</Mark>.
          </h2>
        </Reveal>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 160}>
              <span className="big-n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="n">PASO {i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
