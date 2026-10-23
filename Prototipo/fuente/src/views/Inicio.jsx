import { useState } from 'react'
import Icon from '../components/Icon'
import Mark from '../components/Mark'
import Numero from '../components/Numero'
import { clp, clpNeto, clpSigno, fechaCorta, fechaLarga, hoyISO, mesLargo, moverMes, nombreMes } from '../lib/format'
import { useCategorias } from '../state/Categorias'
import { totales, useMovimientos } from '../state/Movimientos'
import { useSesion } from '../state/Sesion'
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

// Gráfico de dona de gastos por categoría, con los colores de cada una (HU18).
// Al pasar el puntero (o el foco) por un tramo, se levanta y el centro muestra su categoría.
// `activo` lo comparte con la lista de al lado: pasar por una fila también resalta su tramo.
function Dona({ partes, total, activo, onActivo }) {
  const R = 52
  const C = 2 * Math.PI * R
  // Dónde parte cada tramo: suma de los anteriores
  const inicios = partes.map((_, i) => partes.slice(0, i).reduce((s, p) => s + (p.valor / total) * C, 0))
  const sel = partes.find((p) => p.id === activo)
  return (
    <div className="dona-wrap">
    <svg className={`dona${sel ? ' con-activo' : ''}`} viewBox="0 0 140 140" role="img" aria-label="Gastos por categoría" onMouseLeave={() => onActivo(null)}>
      <circle cx="70" cy="70" r={R} fill="none" stroke="var(--paper)" strokeWidth="18" />
      <g transform="rotate(-90 70 70)">
        {partes.map(({ id, valor, color, nombre }, i) => {
          const largo = (valor / total) * C
          return (
            <circle
              key={id}
              className={`dona-tramo${id === activo ? ' activo' : ''}`}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="18"
              strokeDasharray={`${Math.max(largo - 2, 0.5)} ${C}`}
              strokeDashoffset={-inicios[i]}
              style={{ '--d': `${200 + i * 70}ms` }}
              tabIndex={0}
              aria-label={`${nombre}: ${clp(valor)}`}
              onMouseEnter={() => onActivo(id)}
              onFocus={() => onActivo(id)}
              onBlur={() => onActivo(null)}
            />
          )
        })}
      </g>
    </svg>
      {/* El centro va en HTML encima del SVG: dentro de un foreignObject Chromium lo pintaba apagado */}
      <div className="dona-centro" aria-live="polite">
          {sel ? (
            <>
              <span className="dona-l dona-cat" style={{ '--c': sel.color }}>
                {sel.nombre}
              </span>
              <span className="dona-v">{clpCorto(sel.valor)}</span>
              <span className="dona-p">{Math.round((sel.valor / total) * 100)} %</span>
            </>
          ) : (
            <>
              <span className="dona-l">Gastos</span>
              <span className="dona-v">{clpCorto(total)}</span>
            </>
          )}
      </div>
    </div>
  )
}

// $ 1.234.567 → "$ 1,2 M"; $ 845.000 → "$ 845 mil"
function clpCorto(n) {
  if (n >= 1e6) return `$ ${(n / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M`
  if (n >= 1e3) return `$ ${Math.round(n / 1e3).toLocaleString('es-CL')} mil`
  return `$ ${n}`
}

// onNuevo / onEditar en null: el rol no registra movimientos (contador, HU03)
export default function Inicio({ onNuevo, onEditar }) {
  const { perfil } = useSesion()
  const { movs } = useMovimientos()
  const { categoria } = useCategorias()
  const hoy = hoyISO()
  const mesHoy = hoy.slice(0, 7)
  // HU18: el usuario puede cambiar el mes que está viendo
  const [mes, setMes] = useState(mesHoy)
  // Categoría bajo el puntero, en la dona o en la lista
  const [catActiva, setCatActiva] = useState(null)
  const primerMes = movs.reduce((min, m) => (m.fecha.slice(0, 7) < min ? m.fecha.slice(0, 7) : min), mesHoy)
  const esActual = mes === mesHoy
  const mesAnt = moverMes(mes, -1)

  const t = totales(movs, mes)
  // Mes en curso: se compara contra el mismo tramo del mes anterior (del 1 al día de hoy), no
  // contra el mes completo. Un mes cerrado se compara con el mes anterior completo.
  const dia = hoy.slice(8)
  const tAnt = esActual ? totales(movs.filter((m) => m.fecha.slice(8) <= dia), mesAnt) : totales(movs, mesAnt)
  const comparado = esActual ? `vs. 1–${+dia} de ${nombreMes(mesAnt)}` : `vs. ${nombreMes(mesAnt)}`

  const acc = {}
  for (const m of movs) {
    if (m.tipo === 'gasto' && m.fecha.startsWith(mes)) acc[m.categoria_id] = (acc[m.categoria_id] ?? 0) + m.monto
  }
  const porCategoria = Object.entries(acc).sort((a, b) => b[1] - a[1])

  if (!movs.length) return <Bienvenida onNuevo={onNuevo} />

  const max = porCategoria[0]?.[1] ?? 1
  const delMes = movs.filter((m) => m.fecha.startsWith(mes))
  const ultimos = delMes.slice(0, 6)
  const empleado = perfil.rol === 'empleado'

  return (
    <>
      <div className="page-head inicio-head">
        <div>
          <span className="eyebrow">{esActual ? fechaLarga(hoy) : 'Mes cerrado'}</span>
          <h1>
            {empleado ? (
              <>
                Lo que registraste en <Mark variant="hl">{nombreMes(mes)}</Mark>.
              </>
            ) : esActual ? (
              <>
                Así va <Mark variant="hl">{nombreMes(mes)}</Mark> en {perfil.empresa_nombre}.
              </>
            ) : (
              <>
                Así le fue a {perfil.empresa_nombre} en <Mark variant="hl">{nombreMes(mes)}</Mark>.
              </>
            )}
          </h1>
          {empleado && <p className="muted">Solo ves los movimientos que registraste tú.</p>}
        </div>
        <div className="mes-nav" role="group" aria-label="Mes que se muestra">
          <button type="button" className="icon-btn" onClick={() => setMes(mesAnt)} disabled={mes <= primerMes} aria-label="Mes anterior">
            <span aria-hidden="true">‹</span>
          </button>
          <span className="mes-nav-l cap">{mesLargo(mes)}</span>
          <button type="button" className="icon-btn" onClick={() => setMes(moverMes(mes, 1))} disabled={esActual} aria-label="Mes siguiente">
            <span aria-hidden="true">›</span>
          </button>
          {!esActual && (
            <button type="button" className="btn btn-text btn-sm" onClick={() => setMes(mesHoy)}>
              Hoy
            </button>
          )}
        </div>
      </div>

      <section className="kpis" aria-label="Resumen del mes" key={`k-${mes}`}>
        <Kpi label="Ingresos" valor={t.ingresos} anterior={tAnt.ingresos} tono="amt-in" comparado={comparado} d={0} />
        <Kpi label="Gastos" valor={t.gastos} anterior={tAnt.gastos} tono="amt-out" comparado={comparado} d={70} />
        <div className="kpi kpi-deep deep-card rise" style={{ '--d': '140ms' }}>
          <span className="kpi-l">Saldo del mes</span>
          <span className="kpi-v mono">
            <Numero valor={t.resultado} formato={clpNeto} />
          </span>
          <span className="kpi-d">
            {t.resultado >= 0 ? 'Entró más de lo que salió.' : `Ojo: ${esActual ? 'este mes' : 'ese mes'} salió más de lo que entró.`}
          </span>
        </div>
      </section>

      <section className="grid-2" key={`g-${mes}`}>
        <div className="card rise" style={{ '--d': '200ms' }}>
          <div className="card-head">
            <h2>¿En qué {esActual ? 'gastaste' : 'se gastó'}?</h2>
            <span className="muted cap">{nombreMes(mes)}</span>
          </div>
          {porCategoria.length ? (
            <div className="por-cat">
              <Dona
                partes={porCategoria.map(([id, valor]) => ({ id, valor, color: categoria(id).color, nombre: categoria(id).nombre }))}
                total={t.gastos}
                activo={catActiva}
                onActivo={setCatActiva}
              />
              <ul className="cats">
                {porCategoria.map(([id, v], i) => {
                  const c = categoria(id)
                  return (
                    <li
                      key={id}
                      className={catActiva === id ? 'activa' : catActiva ? 'atenuada' : undefined}
                      style={{ '--c': c.color, '--d': `${300 + i * 70}ms` }}
                      onMouseEnter={() => setCatActiva(id)}
                      onMouseLeave={() => setCatActiva(null)}
                    >
                      <span className="cat-n">
                        <span className="dot" />
                        {c.nombre}
                        <span className="muted cat-pct">{Math.round((v / t.gastos) * 100)} %</span>
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
            </div>
          ) : (
            <p className="muted">No hay gastos en {nombreMes(mes)}.</p>
          )}
        </div>

        <div className="card rise" style={{ '--d': '260ms' }}>
          <div className="card-head">
            <h2>Últimos movimientos</h2>
            <a className="btn btn-text" href="#/movimientos">
              Ver todos
            </a>
          </div>
          {ultimos.length ? (
            <ul className="recent">
              {ultimos.map((m) => {
                const c = categoria(m.categoria_id)
                return (
                  <li key={m.id}>
                    <button type="button" onClick={onEditar ? () => onEditar(m) : undefined} disabled={!onEditar}>
                      <span className={`recent-ic ${m.tipo}`}>
                        <Icon name={m.tipo === 'ingreso' ? 'in' : 'out'} />
                      </span>
                      <span className="recent-t">
                        <strong>{m.descripcion}</strong>
                        <small>
                          {fechaCorta(m.fecha)} · {c.nombre}
                          {m.documento && ` · ${m.origen === 'pdf' ? 'PDF' : 'Foto'}`}
                        </small>
                      </span>
                      <span className={`mono ${m.tipo === 'ingreso' ? 'amt-in' : 'amt-out'}`}>{clpSigno(m.monto, m.tipo)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="muted">Sin movimientos en {nombreMes(mes)}.</p>
          )}
        </div>
      </section>

      {onNuevo && (
        <section className="deep-card quick rise" style={{ '--d': '320ms' }}>
          <div>
            <span className="eyebrow">Nuevo · Lectura con IA</span>
            <h2>Saca una foto a la boleta y nosotros la leemos.</h2>
            <p>La IA completa proveedor, fecha y total, y te sugiere la categoría. Tú solo revisas y confirmas.</p>
          </div>
          <a className="btn quick-btn" href="#/cargar">
            <Icon name="camera" />
            Cargar boleta
          </a>
        </section>
      )}
    </>
  )
}
