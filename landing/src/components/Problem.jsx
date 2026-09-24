import Mark from './Mark'
import Reveal from './Reveal'
import './Problem.css'

export default function Problem() {
  return (
    <section className="sec problem" aria-labelledby="p-title">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">El problema</span>
          <h2 id="p-title">
            Hoy tus gastos viven en <Mark variant="hl">tres lugares distintos</Mark>.
          </h2>
        </Reveal>

        <div className="chaos">
          <Reveal as="article">
            <div className="artifact mono">
              <div className="row">
                <span>gastos_sept_FINAL(2).xlsx</span>
              </div>
              <div className="row">
                <span className="strike">Bencina</span>
                <span className="strike">45.000</span>
              </div>
              <div className="row">
                <span>Bencina??</span>
                <span className="x">#¡VALOR!</span>
              </div>
            </div>
            <h3>La planilla</h3>
            <p>Tres versiones, fórmulas rotas y filas que alguien tipeó dos semanas tarde.</p>
          </Reveal>

          <Reveal as="article" delay={120}>
            <div className="artifact">
              <div className="bubble">
                te mando la boleta del almuerzo con el cliente<small>23:41</small>
              </div>
              <div className="bubble">
                y la de ayer?? no la encuentro<small>23:52</small>
              </div>
            </div>
            <h3>El WhatsApp</h3>
            <p>Fotos de boletas perdidas entre stickers y audios, imposibles de encontrar a fin de mes.</p>
          </Reveal>

          <Reveal as="article" delay={240}>
            <div className="artifact mono">
              <div className="row">
                <span>Boletas en la guantera</span>
                <span>~ 14</span>
              </div>
              <div className="row">
                <span>Legibles</span>
                <span className="x">~ 9</span>
              </div>
            </div>
            <h3>El papel</h3>
            <p>La boleta térmica se borra con el calor. Si no la registras pronto, el gasto desaparece.</p>
          </Reveal>
        </div>

        <Reveal as="p" className="turn" delay={100}>
          Tu contador recibe el desorden. Tú no sabes en qué se fue la plata{' '}
          <Mark variant="hl" delay={600}>
            hasta que el mes ya terminó.
          </Mark>
        </Reveal>
      </div>
    </section>
  )
}
