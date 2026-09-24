import { useRef, useState } from 'react'
import Icon from './Icon'
import Mark from './Mark'
import Reveal from './Reveal'
import { DropMock, FormMock, ImportMock } from './LoadMocks'
import './LoadTabs.css'

const TABS = [
  {
    id: 'foto',
    icon: 'camera',
    title: 'Foto o PDF',
    sub: 'La IA lee la boleta o factura',
    heading: (
      <>
        Saca la foto y <Mark>listo</Mark>.
      </>
    ),
    text: 'Desde el celular abres la cámara; desde el computador arrastras el archivo. Leemos fecha, proveedor, monto y tipo de documento, y te proponemos una categoría.',
    bullets: [
      'Fotos de boletas y PDF de facturas, incluso de varias páginas',
      'Nada se guarda hasta que tú confirmas',
      'Si no se puede leer, pasas directo al formulario',
    ],
    Mock: DropMock,
  },
  {
    id: 'excel',
    icon: 'sheet',
    title: 'Excel o CSV',
    sub: 'Importa tu historial de una vez',
    heading: (
      <>
        Tu Excel de siempre, importado en <Mark>un paso</Mark>.
      </>
    ),
    text: 'Descarga la plantilla, pega tu historial o el archivo que exportaste del banco, y súbelo. Antes de importar ves exactamente qué filas entran y cuáles tienen problemas.',
    bullets: [
      'Vista previa del lote antes de guardar',
      'Descargas las filas con error para corregirlas',
      'Exportas en el mismo formato que importas',
    ],
    Mock: ImportMock,
  },
  {
    id: 'manual',
    icon: 'pen',
    title: 'A mano',
    sub: 'Para el gasto sin boleta',
    heading: (
      <>
        Para lo que <Mark>no trae boleta</Mark>.
      </>
    ),
    text: 'El pago al maestro, la propina, el ingreso por transferencia. Un formulario corto, pensado para llenarlo en diez segundos desde el celular.',
    bullets: [
      'Gastos e ingresos en el mismo lugar',
      'Categorías que se adaptan a tu rubro',
      'Montos en pesos, sin decimales',
    ],
    Mock: FormMock,
  },
]

export default function LoadTabs() {
  const [active, setActive] = useState(0)
  const tabRefs = useRef([])

  function select(i, focus) {
    setActive(i)
    if (focus) tabRefs.current[i]?.focus()
  }

  function onKeyDown(e, i) {
    const last = TABS.length - 1
    let next = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = i === last ? 0 : i + 1
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = i === 0 ? last : i - 1
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = last
    if (next !== null) {
      e.preventDefault()
      select(next, true)
    }
  }

  return (
    <section className="sec" id="carga" aria-labelledby="c-title">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Cómo cargas tus movimientos</span>
          <h2 id="c-title">
            <Mark variant="hl">Tres formas de cargar.</Mark> Ninguna te obliga a abandonar lo que ya tienes.
          </h2>
        </Reveal>

        <Reveal className="tabs" delay={100}>
          <div className="tablist" role="tablist" aria-label="Formas de cargar movimientos">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => (tabRefs.current[i] = el)}
                className="tab"
                role="tab"
                type="button"
                id={`t-${t.id}`}
                aria-controls={`p-${t.id}`}
                aria-selected={i === active}
                tabIndex={i === active ? 0 : -1}
                onClick={() => select(i)}
                onKeyDown={(e) => onKeyDown(e, i)}
              >
                <span className="ico">
                  <Icon name={t.icon} />
                </span>
                <strong>{t.title}</strong>
                <small>{t.sub}</small>
              </button>
            ))}
          </div>

          <div>
            {TABS.map((t, i) => (
              <div className="panel" role="tabpanel" key={t.id} id={`p-${t.id}`} aria-labelledby={`t-${t.id}`} hidden={i !== active}>
                <div>
                  <h3>{t.heading}</h3>
                  <p>{t.text}</p>
                  <ul>
                    {t.bullets.map((b) => (
                      <li key={b}>
                        <Icon name="check" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <t.Mock />
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
