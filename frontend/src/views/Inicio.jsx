import Icon from '../components/Icon'
import Mark from '../components/Mark'
import Numero from '../components/Numero'
import { categoria } from '../data/categorias'
import { EMPRESA } from '../data/demo'
import { clpNeto, clpSigno, fechaCorta, fechaLarga, hoyISO, moverMes, nombreMes } from '../lib/format'
import { totales, useMovimientos } from '../state/Movimientos'
import Bienvenida from './Bienvenida'
import './Inicio.css'

// Variación contra el mes anterior: "↑ 12 %" (null si no hay con qué comparar)
function variacion(actual, anterior) {
  if (!anterior) return null
  return Math.round(((actual - anterior) / anterior) * 100)
}

function Kpi({ label, valor, anterior, tono, comparado, d }) {
  const v = variacion(valor, anterior)
  return (
    <div className="kpi rise" style={{ '--d': `${d}ms` }}>
      <span className="kpi-l">{label}</span>
      <span className={`kpi-v mono ${tono}`}>
        <Numero valor={valor} />
      </span>
      <span className="kpi-d">
        {v === null ? (
          `Sin datos ${comparado}`
        ) : (
          <>
            <span className={`delta ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}`}>{`${v > 0 ? '↑' : v < 0 ? '↓' : '='} ${Math.abs(v)} %`}</span>
            {` ${comparado}`}
          </>
        )}
      </span>
    </div>
  )
}

export default function Inicio({ onNuevo, onEditar }) {
  const { movs } = useMovimientos()
  const hoy = hoyISO()
  const mes = hoy.slice(0, 7)
  const mesAnt = moverMes(mes, -1)

  const t = totales(movs, mes)
  // Se compara contra el mismo tramo del mes anterior (del 1 al día de hoy), no contra el mes
  // completo: a mitad de mes la comparación con un mes cerrado siempre parecería una caída
  const dia = hoy.slice(8)
  const tAnt = totales(movs.filter((m) => m.fecha.slice(8) <= dia), mesAnt)
  const comparado = `vs. 1–${+dia} de ${nombreMes(mesAnt)}`

  const acc = {}
  for (const m of movs) {
    if (m.tipo === 'gasto' && m.fecha.startsWith(mes)) acc[m.categoria_id] = (acc[m.categoria_id] ?? 0) + m.monto
  }
  const porCategoria = Object.entries(acc).sort((a, b) => b[1] - a[1])

  if (!movs.length) return <Bienvenida onNuevo={onNuevo} />

  const max = porCategoria[0]?.[1] ?? 1
  const ultimos = movs.slice(0, 6)

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">{fechaLarga(hoy)}</span>
          <h1>
            Así va <Mark variant="hl">{nombreMes(mes)}</Mark> en {EMPRESA.nombre}.
          </h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={onNuevo}>
          <Icon name="plus" />
          Nuevo movimiento
        </button>
      </div>

      <section className="kpis" aria-label="Resumen del mes">
        <Kpi label="Ingresos" valor={t.ingresos} anterior={tAnt.ingresos} tono="amt-in" comparado={comparado} d={0} />
        <Kpi label="Gastos" valor={t.gastos} anterior={tAnt.gastos} tono="amt-out" comparado={comparado} d={70} />
        <div className="kpi kpi-deep deep-card rise" style={{ '--d': '140ms' }}>
          <span className="kpi-l">Resultado del mes</span>
          <span className="kpi-v mono">
            <Numero valor={t.resultado} formato={clpNeto} />
          </span>
          <span className="kpi-d">{t.resultado >= 0 ? 'Vas ganando: entró más de lo que salió.' : 'Ojo: este mes salió más de lo que entró.'}</span>
        </div>
      </section>

      <section className="grid-2">
        <div className="card rise" style={{ '--d': '200ms' }}>
          <div className="card-head">
            <h2>¿En qué gastaste?</h2>
            <span className="muted cap">{nombreMes(mes)}</span>
          </div>
          {porCategoria.length ? (
            <ul className="cats">
              {porCategoria.map(([id, v], i) => {
                const c = categoria(id)
                return (
                  <li key={id} style={{ '--c': c.color, '--d': `${300 + i * 70}ms` }}>
                    <span className="cat-n">
                      <span className="dot" />
                      {c.nombre}
                    </span>
                    <span className="mono">
                      <Numero valor={v} />
                    </span>
                    <span className="bar">
                      <i style={{ '--w': `${((v / max) * 100).toFixed(1)}%` }} />
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="muted">Aún no hay gastos este mes.</p>
          )}
        </div>

        <div className="card rise" style={{ '--d': '260ms' }}>
          <div className="card-head">
            <h2>Últimos movimientos</h2>
            <a className="btn btn-text" href="#/movimientos">
              Ver todos
            </a>
          </div>
          <ul className="recent">
            {ultimos.map((m) => {
              const c = categoria(m.categoria_id)
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => onEditar(m)}>
                    <span className={`recent-ic ${m.tipo}`}>
                      <Icon name={m.tipo === 'ingreso' ? 'in' : 'out'} />
                    </span>
                    <span className="recent-t">
                      <strong>{m.descripcion}</strong>
                      <small>
                        {fechaCorta(m.fecha)} · {c.nombre}
                      </small>
                    </span>
                    <span className={`mono ${m.tipo === 'ingreso' ? 'amt-in' : 'amt-out'}`}>{clpSigno(m.monto, m.tipo)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <section className="deep-card quick rise" style={{ '--d': '320ms' }}>
        <div>
          <span className="eyebrow">Muy pronto</span>
          <h2>Saca una foto a la boleta y nosotros la leemos.</h2>
          <p>También podrás subir el PDF o importar tu planilla Excel. Mientras tanto, registra tus movimientos a mano en segundos.</p>
        </div>
        <button type="button" className="btn quick-btn" onClick={onNuevo}>
          <Icon name="pen" />
          Registrar a mano
        </button>
      </section>
    </>
  )
}
