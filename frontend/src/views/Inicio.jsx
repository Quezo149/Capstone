import { useEffect, useId, useState } from 'react'
import Icon from '../components/Icon'
import Mark from '../components/Mark'
import Numero from '../components/Numero'
import { resumen as pedirResumen } from '../data/movimientos'
import { clp, clpNeto, clpSigno, fechaCorta, fechaLarga, hoyISO, mesLargo, moverMes, nombreMes } from '../lib/format'
import { useCategorias } from '../state/Categorias'
import { useMovimientos } from '../state/Movimientos'
import { useSesion } from '../state/Sesion'
import Bienvenida from './Bienvenida'
import './Inicio.css'

// Dashboard (HU18 — KONTADORIA-63). Los números vienen de GET /movimientos/resumen
// (KONTADORIA-62): el backend suma en la base y aplica RLS, así el empleado ve solo lo suyo.

// Variación contra el mes anterior: "↑ 12 %" (null si no hay con qué comparar)
function variacion(actual, anterior) {
  if (!anterior) return null
  return Math.round(((actual - anterior) / anterior) * 100)
}

// Texto bajo Ingresos y Gastos, en palabras simples (opción A del 28-10: "a la misma fecha").
// Mes en curso: se compara hasta el mismo día del mes anterior; mes cerrado, con el anterior
// completo. "Sin datos" sonaba a error: se dice que ese mes no hubo.
function comparacion({ valor, anterior, sustantivo, mesAnterior, enCurso }) {
  const cuando = enCurso ? `${mesAnterior} a la misma fecha` : `en ${mesAnterior}`
  if (!anterior) {
    return enCurso
      ? `En ${mesAnterior}, a esta fecha, no hubo ${sustantivo}`
      : `${mesAnterior[0].toUpperCase()}${mesAnterior.slice(1)} no tuvo ${sustantivo} para comparar`
  }
  if (valor === anterior) return `Igual que ${cuando}`
  const v = variacion(valor, anterior)
  if (v === 0) return `Casi igual que ${cuando}`
  return (
    <>
      <span className={`delta ${v > 0 ? 'up' : 'down'}`}>{`${v > 0 ? '↑' : '↓'} ${Math.abs(v).toLocaleString('es-CL')} %`}</span>
      {` ${v > 0 ? 'más' : 'menos'} que ${cuando}`}
    </>
  )
}

function Kpi({ label, valor, tono, d, ...comparar }) {
  return (
    <div className="kpi rise" style={{ '--d': `${d}ms` }}>
      <span className="kpi-l">{label}</span>
      <span className={`kpi-v mono ${tono}`}>
        <Numero valor={valor} />
      </span>
      <span className="kpi-d">{comparacion({ valor, ...comparar })}</span>
    </div>
  )
}

// $ 1.234.567 → "$ 1,2 M"; $ 845.000 → "$ 845 mil"
function clpCorto(n) {
  if (n >= 1e6) return `$ ${(n / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M`
  if (n >= 1e3) return `$ ${Math.round(n / 1e3).toLocaleString('es-CL')} mil`
  return `$ ${n}`
}

// Con muchas categorías la dona se llena de tajadas imposibles de tocar: sobre 6, las que pesan
// menos del 3 % se juntan en "Resto" (solo en el gráfico; la lista sigue completa). No se llama
// "Otras" ni va en gris para no confundirlo con la categoría predefinida "Otros gastos": es un
// tramo rayado y su centro muestra los colores de las categorías que junta.
const MAX_TRAMOS = 6
const MIN_PCT = 0.03

function agrupar(cats, total) {
  if (cats.length <= MAX_TRAMOS) return { tramos: cats, enResto: new Set() }
  const grandes = cats.filter((c, i) => i < MAX_TRAMOS - 1 && c.monto / total >= MIN_PCT)
  const chicas = cats.slice(grandes.length)
  if (chicas.length < 2) return { tramos: cats, enResto: new Set() }
  const resto = {
    categoria_id: 'resto',
    nombre: `Resto (${chicas.length})`,
    monto: chicas.reduce((s, c) => s + c.monto, 0),
    miembros: chicas,
  }
  return { tramos: [...grandes, resto], enResto: new Set(chicas.map((c) => c.categoria_id)) }
}

// Props para que una categoría (tramo de la dona o fila de la lista) se pueda seleccionar.
// Tocar o hacer clic la fija y volver a tocarla la suelta; con mouse, pasar por encima la muestra
// sin fijarla. En pantallas táctiles no hay "hover": por eso el toque, no solo el puntero.
function seleccionable(id, { fijada, onFijar, onVista }) {
  return {
    tabIndex: 0,
    role: 'button',
    'aria-pressed': fijada === id,
    onClick: () => onFijar(fijada === id ? null : id),
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      onFijar(fijada === id ? null : id)
    },
    onPointerEnter: (e) => e.pointerType === 'mouse' && onVista(id),
    onPointerLeave: (e) => e.pointerType === 'mouse' && onVista(null),
    // Solo con teclado: un toque también enfoca, y dejaría la categoría marcada al soltarla
    onFocus: (e) => e.target.matches(':focus-visible') && onVista(id),
    onBlur: () => onVista(null),
  }
}

// Gráfico de dona de gastos por categoría, con los colores de cada una. La categoría activa se
// levanta, las demás se atenúan y el centro muestra su monto exacto. `sel` lo comparte con la lista.
function Dona({ tramos, total, activo, sel }) {
  const R = 52
  const C = 2 * Math.PI * R
  // Dónde parte cada tramo: suma de los anteriores
  const inicios = tramos.map((_, i) => tramos.slice(0, i).reduce((s, p) => s + (p.monto / total) * C, 0))
  const actual = tramos.find((p) => p.categoria_id === activo)
  const monto = actual ? clp(actual.monto) : clpCorto(total)
  const rayas = `rayas-${useId().replace(/:/g, '')}`
  return (
    <div className="dona-wrap">
      <svg className={`dona${actual ? ' con-activo' : ''}`} viewBox="0 0 140 140" role="img" aria-label="Gastos por categoría">
        <defs>
          {/* Tramo "Resto": rayado, para que no se lea como una categoría más */}
          <pattern id={rayas} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" className="rayas-fondo" />
            <rect width="2.2" height="5" className="rayas-linea" />
          </pattern>
        </defs>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--paper)" strokeWidth="18" />
        <g transform="rotate(-90 70 70)">
          {tramos.map(({ categoria_id, monto: m, color, nombre, miembros }, i) => (
            <circle
              key={categoria_id}
              className={`dona-tramo${categoria_id === activo ? ' activo' : ''}`}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={miembros ? `url(#${rayas})` : color}
              strokeWidth="18"
              strokeDasharray={`${Math.max((m / total) * C - 2, 0.5)} ${C}`}
              strokeDashoffset={-inicios[i]}
              style={{ '--d': `${200 + i * 70}ms` }}
              aria-label={miembros ? `Resto: ${miembros.map((c) => c.nombre).join(', ')}: ${clp(m)}` : `${nombre}: ${clp(m)}`}
              {...seleccionable(categoria_id, sel)}
            />
          ))}
        </g>
      </svg>
      {/* El centro va en HTML encima del SVG: dentro de un foreignObject Chromium lo pintaba apagado */}
      <div className="dona-centro" aria-live="polite">
        {actual?.miembros ? (
          <span className="dona-l dona-resto">
            <span className="dona-puntos" aria-hidden="true">
              {actual.miembros.slice(0, 4).map((c) => (
                <i key={c.categoria_id} style={{ background: c.color }} />
              ))}
            </span>
            {actual.nombre}
          </span>
        ) : (
          <span className={`dona-l${actual ? ' dona-cat' : ''}`} style={actual ? { '--c': actual.color } : undefined}>
            {actual ? actual.nombre : 'Gastos'}
          </span>
        )}
        <span className={`dona-v${monto.length > 9 ? ' largo' : ''}`}>{monto}</span>
        {actual && <span className="dona-p">{Math.round((actual.monto / total) * 100)} % del gasto</span>}
      </div>
    </div>
  )
}

// onNuevo / onEditar en null: el rol no registra movimientos (contador, HU03); a él le llega
// onVer para abrir el comprobante de los movimientos con foto o PDF
export default function Inicio({ onNuevo, onEditar, onVer }) {
  const { perfil } = useSesion()
  // Los movimientos del contexto solo se usan para saber si la empresa está vacía (Bienvenida)
  // y para volver a pedir el resumen cuando se crea, edita o anula uno
  const { movs } = useMovimientos()
  const { categoria } = useCategorias()
  const hoy = hoyISO()
  const mesHoy = hoy.slice(0, 7)
  const [mes, setMes] = useState(mesHoy)
  const [r, setR] = useState(null) // última respuesta de /movimientos/resumen
  const [error, setError] = useState(null)
  const [intento, setIntento] = useState(0)
  // Categoría seleccionada (tocada o con clic) y la que se muestra al pasar el mouse por encima
  const [fijada, setFijada] = useState(null)
  const [vista, setVista] = useState(null)

  useEffect(() => {
    let vigente = true
    pedirResumen(mes)
      .then((datos) => {
        if (!vigente) return
        setR(datos)
        setError(null)
      })
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [mes, movs, intento])

  if (!movs.length) return <Bienvenida onNuevo={onNuevo} />

  // Mientras llega el mes nuevo se sigue mostrando el anterior (sin saltos); el primero, "Cargando"
  const cargando = r?.mes !== mes
  const empleado = perfil.rol === 'empleado'
  const esActual = mes === mesHoy
  const mesAnt = moverMes(mes, -1)
  const primerMes = r?.primer_mes && r.primer_mes < mesHoy ? r.primer_mes : mesHoy
  // Otro mes, otras categorías: se suelta la selección
  const irA = (m) => {
    setMes(m)
    setFijada(null)
    setVista(null)
  }

  const cabecera = (
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
        <button type="button" className="icon-btn" onClick={() => irA(mesAnt)} disabled={mes <= primerMes} aria-label="Mes anterior">
          <span aria-hidden="true">‹</span>
        </button>
        <span className="mes-nav-l cap" aria-live="polite">
          {mesLargo(mes)}
        </span>
        <button type="button" className="icon-btn" onClick={() => irA(moverMes(mes, 1))} disabled={esActual} aria-label="Mes siguiente">
          <span aria-hidden="true">›</span>
        </button>
        {!esActual && (
          <button type="button" className="btn btn-text btn-sm" onClick={() => irA(mesHoy)}>
            Hoy
          </button>
        )}
      </div>
    </div>
  )

  if (error && !r) {
    return (
      <>
        {cabecera}
        <div className="card nores">
          <h2>No pudimos cargar el resumen</h2>
          <p className="muted">{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => setIntento((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      </>
    )
  }
  if (!r) {
    return (
      <>
        {cabecera}
        <p className="muted">Cargando el resumen…</p>
      </>
    )
  }

  const comparar = { mesAnterior: nombreMes(r.anterior.mes), enCurso: r.en_curso }
  const max = r.por_categoria[0]?.monto ?? 1
  const grupos = agrupar(r.por_categoria, r.gastos)
  const activo = vista ?? fijada
  const sel = { fijada, onFijar: setFijada, onVista: setVista }

  return (
    <>
      {cabecera}

      <div className={`inicio-datos${cargando ? ' cargando' : ''}`} aria-busy={cargando}>
        <section className="kpis" aria-label="Resumen del mes" key={`k-${r.mes}`}>
          <Kpi label="Ingresos" valor={r.ingresos} anterior={r.anterior.ingresos} sustantivo="ingresos" tono="amt-in" d={0} {...comparar} />
          <Kpi label="Gastos" valor={r.gastos} anterior={r.anterior.gastos} sustantivo="gastos" tono="amt-out" d={70} {...comparar} />
          <div className="kpi kpi-deep deep-card rise" style={{ '--d': '140ms' }}>
            <span className="kpi-l">Saldo del mes</span>
            <span className="kpi-v mono">
              <Numero valor={r.saldo} formato={clpNeto} />
            </span>
            <span className="kpi-d">
              {r.saldo >= 0 ? 'Entró más de lo que salió.' : `Ojo: ${r.en_curso ? 'este mes' : 'ese mes'} salió más de lo que entró.`}
            </span>
          </div>
        </section>

        <section className="grid-2" key={`g-${r.mes}`}>
          <div className="card rise" style={{ '--d': '200ms' }}>
            <div className="card-head">
              <h2>¿En qué {r.en_curso ? 'gastaste' : 'se gastó'}?</h2>
              <span className="muted cap">{nombreMes(r.mes)}</span>
            </div>
            {r.por_categoria.length ? (
              <div className="por-cat">
                <Dona tramos={grupos.tramos} total={r.gastos} activo={activo} sel={sel} />
                <ul className="cats">
                  {r.por_categoria.map((c, i) => {
                    // "Resto" en la dona resalta todas las categorías que junta
                    const id = grupos.enResto.has(c.categoria_id) ? 'resto' : c.categoria_id
                    const esta = activo === id
                    return (
                      <li
                        key={c.categoria_id}
                        className={esta ? 'activa' : activo ? 'atenuada' : undefined}
                        style={{ '--c': c.color, '--d': `${300 + i * 70}ms` }}
                        aria-label={`${c.nombre}: ${clp(c.monto)}, ${Math.round((c.monto / r.gastos) * 100)} %`}
                        {...seleccionable(id, sel)}
                      >
                        <span className="cat-n">
                          <span className="dot" />
                          {c.nombre}
                          <span className="muted cat-pct">{Math.round((c.monto / r.gastos) * 100)} %</span>
                        </span>
                        <span className="mono">
                          <Numero valor={c.monto} />
                        </span>
                        <span className="bar">
                          <i style={{ '--w': `${((c.monto / max) * 100).toFixed(1)}%` }} />
                        </span>
                      </li>
                    )
                  })}
                </ul>
                {!fijada && <p className="por-cat-hint muted">Toca una categoría para ver su detalle.</p>}
              </div>
            ) : (
              <p className="muted">No hay gastos en {nombreMes(r.mes)}.</p>
            )}
          </div>

          <div className="card rise" style={{ '--d': '260ms' }}>
            <div className="card-head">
              <h2>Últimos movimientos</h2>
              <a className="btn btn-text" href="#/movimientos">
                Ver todos
              </a>
            </div>
            {r.ultimos.length ? (
              <ul className="recent">
                {r.ultimos.map((m) => {
                  const c = categoria(m.categoria_id)
                  const accion = onEditar ?? (m.tiene_comprobante ? onVer : null)
                  return (
                    <li key={m.id}>
                      <button type="button" onClick={accion ? () => accion(m) : undefined} disabled={!accion}>
                        <span className={`recent-ic ${m.tipo}`}>
                          <Icon name={m.tipo === 'ingreso' ? 'in' : 'out'} />
                        </span>
                        <span className="recent-t">
                          <strong>{m.descripcion}</strong>
                          <small>
                            {fechaCorta(m.fecha)} · {c.nombre}
                            {m.tiene_comprobante && ` · ${m.origen === 'pdf' ? 'PDF' : 'Foto'}`}
                          </small>
                        </span>
                        <span className={`mono ${m.tipo === 'ingreso' ? 'amt-in' : 'amt-out'}`}>{clpSigno(m.monto, m.tipo)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="muted">Sin movimientos en {nombreMes(r.mes)}.</p>
            )}
          </div>
        </section>
      </div>

      {onNuevo && (
        <section className="deep-card quick rise" style={{ '--d': '320ms' }}>
          <div>
            <span className="eyebrow">Nuevo</span>
            <h2>Saca una foto a la boleta y nosotros la leemos.</h2>
            <p>También funciona con el PDF de una factura. Tú revisas lo que leyó la IA y confirmas.</p>
          </div>
          <div className="quick-acts">
            <a className="btn quick-btn" href="#/cargar">
              <Icon name="camera" />
              Cargar boleta
            </a>
            <button type="button" className="btn btn-text quick-alt" onClick={onNuevo}>
              o regístralo a mano
            </button>
          </div>
        </section>
      )}
    </>
  )
}
