import Icon from './Icon'
import HeroDemo from './HeroDemo'
import Mark from './Mark'
import Reveal from './Reveal'
import './Hero.css'

const REASSURE = ['Sin tarjeta de crédito', 'Trae tu planilla actual', 'Funciona en el celular']

export default function Hero() {
  return (
    <section className="hero">
      <div className="wrap">
        <div>
          <Reveal as="span" className="eyebrow">
            Para PYMEs chilenas, sin importar el tamaño
          </Reveal>
          <Reveal as="h1" delay={90}>
            Tus boletas en orden <Mark delay={800}>antes de fin de mes</Mark>.
          </Reveal>
          <Reveal as="p" className="lead" delay={180}>
            Saca una foto, sube el PDF o importa el Excel que ya usas. KontadorIA lee los datos, tú los confirmas, y tu
            contador recibe todo ordenado. Sin aprender un software contable.
          </Reveal>
          <Reveal className="cta-row" delay={270}>
            <a className="btn btn-primary" href="#piloto">
              Súmate al piloto gratis <Icon name="arrow" />
            </a>
            <a className="btn btn-ghost" href="#carga">
              Ver cómo funciona
            </a>
          </Reveal>
          <Reveal as="ul" className="reassure" delay={360}>
            {REASSURE.map((text) => (
              <li key={text}>
                <Icon name="check" />
                {text}
              </li>
            ))}
          </Reveal>
        </div>

        <Reveal from="right" delay={200}>
          <HeroDemo />
        </Reveal>
      </div>
    </section>
  )
}
