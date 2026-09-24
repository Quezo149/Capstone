import Icon from './Icon'
import Mark from './Mark'
import Reveal from './Reveal'
import './Faq.css'

const QUESTIONS = [
  {
    q: '¿Reemplaza a mi facturador electrónico del SII?',
    a: 'No. KontadorIA no emite boletas ni facturas y no hace contabilidad completa (libro mayor, balances tributarios). Registra y ordena los documentos que ya emites y recibes, para que tú entiendas tu mes y tu contador trabaje con datos limpios.',
  },
  {
    q: '¿Tengo que dejar mi Excel?',
    a: 'No. Puedes importar tu historial utilizando nuestra plantilla y, si quieres, sigues exportando a Excel cuando lo necesites. El formato de exportación es el mismo de importación.',
  },
  {
    q: '¿Qué pasa si la IA lee mal una boleta?',
    a: 'La IA no guarda automáticamente lo que interpreta. Primero te mostramos los datos que encontró para que puedas revisarlos y corregirlos antes de confirmar. Si no puede leer una boleta, puedes ingresar los datos manualmente.',
  },
  {
    q: '¿Necesito instalar algo?',
    a: 'No. La aplicación funciona directamente en el navegador del celular y del computador, y puedes agregarla a la pantalla de inicio como si fuera una app.',
  },
  {
    q: '¿Se conecta automáticamente con mi banco?',
    a: 'Todavía no, y nunca te pediremos tus claves bancarias. Puedes exportar la cartola o los movimientos desde tu banco e importarlos como archivo.',
  },
  {
    q: '¿Funciona con dólares u otras monedas?',
    a: 'Por ahora, KontadorIA trabaja solo con pesos chilenos y montos enteros.',
  },
  {
    q: '¿Cuánto cuesta?',
    a: 'Durante el piloto, puedes usar la plataforma sin costo y ayudarnos a mejorarla con tu feedback. Antes de que termine, te contaremos el precio para continuar y tú decides si seguir.',
  },
]

// Acordeón nativo <details>/<summary>: no necesita JS ni estado.
export default function Faq() {
  return (
    <section className="sec sec-flush" id="preguntas" aria-labelledby="f-title">
      <div className="wrap faq-grid">
        <Reveal className="sec-head">
          <span className="eyebrow">Preguntas frecuentes</span>
          <h2 id="f-title">
            Lo que nos preguntan <Mark variant="hl">antes de partir</Mark>.
          </h2>
        </Reveal>
        <div className="faq">
          {QUESTIONS.map((item, i) => (
            <Reveal as="details" key={item.q} open={i === 0} delay={i * 70}>
              <summary>
                {item.q}
                <span className="pm">
                  <Icon name="plus" />
                </span>
              </summary>
              <p className="ans">{item.a}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
