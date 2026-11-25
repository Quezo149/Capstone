import { useCallback, useEffect, useMemo, useState } from 'react'
import Drawer from '../components/Drawer'
import Icon from '../components/Icon'
import Numero from '../components/Numero'
import { api } from '../lib/api'
import { clp, hoyISO, leerMonto, mesLargo, moverMes, nombreMes } from '../lib/format'
import { useCategorias } from '../state/Categorias'
import { useMovimientos } from '../state/Movimientos'
import { useSesion } from '../state/Sesion'
import { useToast } from '../state/Toasts'
import './Presupuestos.css'

// PROTOTIPO Sprint 5 — HU15 (KONTADORIA-78): presupuestos de gasto por categoría y mes.
// Dueño y contador los ven; solo el dueño crea, edita (el monto) y elimina. Mismo contrato que
// backend/app/routers/presupuestos.py: GET /presupuestos?mes=AAAA-MM trae lo gastado en cada uno.
// Igual a frontend/src/views/Presupuestos.jsx (orden por % usado y "Sin gastar", 22-11-2026).

const MAX_MONTO = 999_999_999_999 // igual que ck_presupuestos_monto
const MESES_ADELANTE = 12 // se puede planificar hasta un año hacia adelante
const AVISO = 0.8 // desde el 80 % se marca "Cerca del límite" (sin alertas automáticas en v1)

// Orden de la lista (22-11-2026): de mayor a menor % usado, así lo que pide atención queda
// arriba. Los excedidos (más de 100 %) salen primero, del que más se pasó al que menos.
// Con el mismo %, en orden alfabético (como llega de la API).
const ordenar = (lista) => [...lista].sort((a, b) => b.gastado / b.monto - a.gastado / a.monto)

// Estado de un presupuesto según lo gastado y si el mes ya terminó
function estado(p, cerrado) {
  const resto = p.monto - p.gastado
  if (resto < 0) return { clase: 'excedido', texto: `Te pasaste por ${clp(resto)}` }
  if (p.gastado === 0) return { clase: '', texto: cerrado ? 'Sin gastos' : 'Sin gastos aún' }
  if (resto === 0) return { clase: cerrado ? '' : 'cerca', texto: 'Llegaste al límite' }
  if (cerrado) return { clase: '', texto: `Quedaron ${clp(resto)} sin gastar` }
  if (p.gastado / p.monto >= AVISO) return { clase: 'cerca', texto: `Quedan ${clp(resto)}` }
  return { clase: '', texto: `Quedan ${clp(resto)}` }
}

function PresupuestoForm({ inicial, mes, opciones, categoriaInicial, onGuardar }) {
  const editando = Boolean(inicial)
  const [categoria, setCategoria] = useState(inicial?.categoria_id ?? categoriaInicial ?? '')
  const [monto, setMonto] = useState(inicial?.monto ?? 0)
  const [errores, setErrores] = useState({})
  const [errorGeneral, setErrorGeneral] = useState(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    const errs = {}
    if (!editando && !categoria) errs.categoria = 'Elige una categoría.'
    if (!monto) errs.monto = 'Escribe el monto límite.'
    else if (monto > MAX_MONTO) errs.monto = 'Ese monto es demasiado grande.'
    setErrores(errs)
    if (Object.keys(errs).length) return
    setEnviando(true)
    setErrorGeneral(null)
    try {
      await onGuardar(editando ? { monto } : { categoria_id: categoria, mes, monto })
    } catch (err) {
      if (err.codigo === 'presupuesto_repetido' || err.codigo?.startsWith('categoria_')) setErrores({ categoria: err.message })
      else if (err.codigo === 'monto_invalido') setErrores({ monto: err.message })
      else setErrorGeneral(err.message)
      setEnviando(false)
    }
  }

  return (
    <form className="mf" onSubmit={enviar} noValidate>
      <div className="mf-body">
        {editando ? (
          <p className="pr-form-cat">
            <span className="dot" style={{ color: inicial.color }} />
            <strong>{inicial.categoria}</strong>
            <span className="muted cap">· {mesLargo(mes)}</span>
          </p>
        ) : (
          <div className="field">
            <span className="label" id="l-pr-cat">
              Categoría de gasto
            </span>
            {opciones.length ? (
              <div className="mf-cats" role="radiogroup" aria-labelledby="l-pr-cat">
                {opciones.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={categoria === c.id}
                    className={`mf-cat${errores.categoria ? ' bad' : ''}`}
                    style={{ '--c': c.color, '--d': `${i * 30}ms` }}
                    onClick={() => (setCategoria(c.id), setErrores((x) => ({ ...x, categoria: undefined })))}
                  >
                    <span className="dot" />
                    {c.nombre}
                    <Icon name="check" className="mf-cat-ok" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">Todas tus categorías de gasto ya tienen presupuesto en {nombreMes(mes)}.</p>
            )}
            {errores.categoria ? (
              <span className="err">{errores.categoria}</span>
            ) : (
              <span className="hint">Una por mes: las que ya tienen presupuesto en {nombreMes(mes)} no aparecen.</span>
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor="pr-monto">Monto límite</label>
          <div className={`mf-monto pr-monto${errores.monto ? ' bad' : ''}`}>
            <span aria-hidden="true">$</span>
            <input
              id="pr-monto"
              data-autofocus={editando || undefined}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={monto ? monto.toLocaleString('es-CL') : ''}
              onChange={(e) => {
                const m = leerMonto(e.target.value)
                // Un dígito de más no se escribe: se avisa en el momento (H5, 24-11-2026)
                if (m > MAX_MONTO) return setErrores((x) => ({ ...x, monto: 'El monto máximo es $ 999.999.999.999.' }))
                setMonto(m)
                setErrores((x) => ({ ...x, monto: undefined }))
              }}
              aria-invalid={Boolean(errores.monto)}
            />
          </div>
          {errores.monto ? (
            <span className="err">{errores.monto}</span>
          ) : (
            <span className="hint">
              {editando ? `Gastado hasta ahora: ${clp(inicial.gastado)}.` : `Lo máximo que quieres gastar en ${nombreMes(mes)}.`}
            </span>
          )}
        </div>
      </div>

      {errorGeneral && (
        <p className="err mf-err" role="alert">
          {errorGeneral}
        </p>
      )}
      <footer className="mf-foot">
        <span className="mf-foot-space" />
        <button type="submit" className="btn btn-primary" disabled={enviando || (!editando && !opciones.length)}>
          <Icon name="check" />
          {editando ? 'Guardar cambios' : 'Crear presupuesto'}
        </button>
      </footer>
    </form>
  )
}

function Fila({ p, cerrado, admin, onEditar, onEliminar, i }) {
  const e = estado(p, cerrado)
  const pct = Math.round((p.gastado / p.monto) * 100)
  // Eliminar pide un segundo clic dentro de 3 s (igual que en Categorías)
  const [confirmar, setConfirmar] = useState(false)
  useEffect(() => {
    if (!confirmar) return
    const t = setTimeout(() => setConfirmar(false), 3000)
    return () => clearTimeout(t)
  }, [confirmar])

  return (
    <li className={`pr-fila ${e.clase}`} style={{ '--c': p.color, '--d': `${120 + i * 60}ms` }}>
      <span className="pr-nombre">
        <span className="dot" />
        <span>{p.categoria}</span>
      </span>
      <span className="pr-montos mono">
        <Numero valor={p.gastado} /> <span className="muted">de {clp(p.monto)}</span>
      </span>
      {admin && (
        <span className="pr-acts">
          <button type="button" className="icon-btn" onClick={onEditar} aria-label={`Editar presupuesto de ${p.categoria}`} title="Editar monto">
            <Icon name="pen" />
          </button>
          <button
            type="button"
            className={`btn btn-sm ${confirmar ? 'btn-danger' : 'btn-text'}`}
            onClick={() => (confirmar ? onEliminar() : setConfirmar(true))}
            aria-label={`Eliminar presupuesto de ${p.categoria}`}
          >
            {confirmar ? '¿Eliminar?' : <Icon name="trash" />}
          </button>
        </span>
      )}
      <span
        className="pr-barra"
        role="progressbar"
        aria-label={`${p.categoria}: ${pct} % del presupuesto`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(pct, 100)}
      >
        <i style={{ '--w': `${Math.min(pct, 100)}%` }} />
      </span>
      <span className="pr-estado">
        {e.clase === 'cerca' && p.gastado < p.monto && <span className="chip warn">Cerca del límite</span>}
        <span>{e.texto}</span>
        <span className="muted mono">{pct} %</span>
      </span>
    </li>
  )
}

export default function Presupuestos() {
  const { puede } = useSesion()
  const admin = puede('presupuestos.gestionar')
  const { aviso } = useToast()
  const { categoriasDe } = useCategorias()
  const { movs } = useMovimientos()
  const mesHoy = hoyISO().slice(0, 7)
  const [mes, setMes] = useState(mesHoy)
  const [lista, setLista] = useState(null)
  const [anterior, setAnterior] = useState([])
  const [error, setError] = useState(null)
  // null = cerrado · { nuevo: true, categoria? } · { id } = editar
  const [form, setForm] = useState(null)
  const [copiando, setCopiando] = useState(false)

  const cargar = useCallback(async () => {
    setError(null)
    try {
      const [actual, previo] = await Promise.all([api(`/presupuestos?mes=${mes}`), api(`/presupuestos?mes=${moverMes(mes, -1)}`)])
      setLista(actual)
      setAnterior(previo)
    } catch (e) {
      setError(e.message)
    }
  }, [mes])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se recarga al cambiar de mes
    cargar()
  }, [cargar])

  const primerMes = useMemo(() => movs.reduce((min, m) => (m.fecha.slice(0, 7) < min ? m.fecha.slice(0, 7) : min), mesHoy), [movs, mesHoy])
  const ultimoMes = moverMes(mesHoy, MESES_ADELANTE)
  const cerrado = mes < mesHoy
  const futuro = mes > mesHoy

  const totales = useMemo(() => {
    const t = { monto: 0, gastado: 0 }
    for (const p of lista ?? []) {
      t.monto += p.monto
      t.gastado += p.gastado
    }
    return t
  }, [lista])

  // Gastos del mes en categorías sin presupuesto (el dueño puede crearlo desde ahí)
  const sinPresupuesto = useMemo(() => {
    const con = new Set((lista ?? []).map((p) => p.categoria_id))
    const acc = {}
    for (const m of movs) if (m.tipo === 'gasto' && m.fecha.startsWith(mes) && !con.has(m.categoria_id)) acc[m.categoria_id] = (acc[m.categoria_id] ?? 0) + m.monto
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [lista, movs, mes])

  const gastoCats = categoriasDe('gasto')
  const catPorId = Object.fromEntries(gastoCats.map((c) => [c.id, c]))
  const opciones = gastoCats.filter((c) => !c.oculta && !(lista ?? []).some((p) => p.categoria_id === c.id))
  const enEdicion = form?.id ? lista?.find((p) => p.id === form.id) : null
  // Del mes anterior, los que todavía se pueden copiar (categoría de gasto que sigue existiendo)
  const copiables = anterior.filter((p) => catPorId[p.categoria_id])

  async function guardar(datos) {
    if (enEdicion) {
      await api(`/presupuestos/${enEdicion.id}`, { method: 'PUT', body: datos })
      aviso('Presupuesto actualizado')
    } else {
      const p = await api('/presupuestos', { method: 'POST', body: datos })
      aviso(`Presupuesto de ${p.categoria} creado`)
    }
    setForm(null)
    cargar()
  }

  async function quitar(p) {
    try {
      await api(`/presupuestos/${p.id}`, { method: 'DELETE' })
      aviso(`Eliminamos el presupuesto de ${p.categoria}`)
      cargar()
    } catch (e) {
      aviso(e.message, { error: true })
    }
  }

  // Repetir los montos del mes anterior en un clic. Son varios POST: si uno falla, los anteriores
  // quedan y la lista recargada muestra cuáles faltan (para hacerlo atómico haría falta un endpoint).
  async function copiarAnterior() {
    setCopiando(true)
    try {
      for (const p of copiables) await api('/presupuestos', { method: 'POST', body: { categoria_id: p.categoria_id, mes, monto: p.monto } })
      aviso(`Copiamos ${copiables.length} ${copiables.length === 1 ? 'presupuesto' : 'presupuestos'} de ${nombreMes(moverMes(mes, -1))}`)
      await cargar()
    } catch (e) {
      aviso(e.message, { error: true })
      await cargar()
    } finally {
      setCopiando(false)
    }
  }

  const resto = totales.monto - totales.gastado
  const vacio = lista && !lista.length

  return (
    <section className="pr-page rise">
      <div className="page-head">
        <div>
          <h1>Presupuestos</h1>
          <p className="muted">Cuánto quieres gastar como máximo en cada categoría.</p>
        </div>
        <div className="mes-nav" role="group" aria-label="Mes que se muestra">
          <button type="button" className="icon-btn" onClick={() => setMes(moverMes(mes, -1))} disabled={mes <= primerMes} aria-label="Mes anterior">
            <span className="mes-flecha izq" aria-hidden="true" />
          </button>
          <span className="mes-nav-l cap">{mesLargo(mes)}</span>
          <button type="button" className="icon-btn" onClick={() => setMes(moverMes(mes, 1))} disabled={mes >= ultimoMes} aria-label="Mes siguiente">
            <span className="mes-flecha der" aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && (
        <div className="card nores">
          <h2>No pudimos cargar los presupuestos</h2>
          <p className="muted">{error}</p>
          <button type="button" className="btn btn-primary" onClick={cargar}>
            Reintentar
          </button>
        </div>
      )}
      {!lista && !error && <p className="muted">Cargando…</p>}

      {lista && !vacio && (
        <section className="pr-resumen" aria-label={`Resumen de ${nombreMes(mes)}`} key={`r-${mes}`}>
          <div className="kpi">
            <span className="kpi-l">Presupuesto</span>
            <span className="kpi-v mono">
              <Numero valor={totales.monto} />
            </span>
            <span className="kpi-d">
              {lista.length} {lista.length === 1 ? 'categoría' : 'categorías'}
            </span>
          </div>
          <div className="kpi">
            <span className="kpi-l">Gastado</span>
            <span className="kpi-v mono">
              <Numero valor={totales.gastado} />
            </span>
            <span className="kpi-d">{totales.monto ? Math.round((totales.gastado / totales.monto) * 100) : 0} % del total</span>
          </div>
          <div className={`kpi${resto < 0 ? ' pr-kpi-mal' : ''}`}>
            <span className="kpi-l">{resto < 0 ? 'Excedido' : cerrado ? 'Sin gastar' : 'Disponible'}</span>
            <span className="kpi-v mono">
              <Numero valor={Math.abs(resto)} />
            </span>
            <span className="kpi-d">{cerrado ? 'Mes cerrado' : futuro ? 'Mes por venir' : 'Para lo que queda del mes'}</span>
          </div>
        </section>
      )}

      {lista && (
        <div className="card" key={`l-${mes}`}>
          <div className="card-head">
            <h2>Por categoría</h2>
            {admin && !vacio && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ nuevo: true })} disabled={!opciones.length}>
                <Icon name="plus" />
                Agregar
              </button>
            )}
          </div>

          {vacio ? (
            <div className="pr-vacio">
              <p>
                <strong>Sin presupuestos para {nombreMes(mes)}.</strong>
                <br />
                <span className="muted">
                  {admin ? 'Define cuánto quieres gastar como máximo en cada categoría.' : 'Todavía no se definen límites de gasto para este mes.'}
                </span>
              </p>
              {admin && (
                <div className="form-acts">
                  <button type="button" className="btn btn-primary" onClick={() => setForm({ nuevo: true })}>
                    <Icon name="plus" />
                    Nuevo presupuesto
                  </button>
                  {copiables.length > 0 && (
                    <button type="button" className="btn btn-ghost" onClick={copiarAnterior} disabled={copiando}>
                      {copiando ? 'Copiando…' : `Copiar los de ${nombreMes(moverMes(mes, -1))} (${copiables.length})`}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <ul className="pr-lista">
              {ordenar(lista).map((p, i) => (
                <Fila key={p.id} i={i} p={p} cerrado={cerrado} admin={admin} onEditar={() => setForm({ id: p.id })} onEliminar={() => quitar(p)} />
              ))}
            </ul>
          )}

          {sinPresupuesto.length > 0 && (
            <div className="pr-sin">
              <span className="pr-sin-l">Gastos sin presupuesto en {nombreMes(mes)}</span>
              <ul>
                {sinPresupuesto.map(([id, monto]) => {
                  const c = catPorId[id] ?? { nombre: 'Sin categoría', color: '#7d8d87' }
                  const contenido = (
                    <>
                      <span className="dot" style={{ color: c.color }} />
                      {c.nombre}
                      <span className="mono muted">{clp(monto)}</span>
                    </>
                  )
                  return (
                    <li key={id}>
                      {admin && catPorId[id] && !catPorId[id].oculta ? (
                        <button type="button" className="pr-sin-btn" onClick={() => setForm({ nuevo: true, categoria: id })} title={`Crear presupuesto para ${c.nombre}`}>
                          {contenido}
                          <Icon name="plus" />
                        </button>
                      ) : (
                        <span className="pr-sin-btn">{contenido}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {!admin && <p className="muted">Solo el administrador puede crear o modificar presupuestos.</p>}

      <Drawer
        abierto={form !== null}
        onCerrar={() => setForm(null)}
        eyebrow={mesLargo(mes)}
        titulo={enEdicion ? `Presupuesto de ${enEdicion.categoria}` : 'Nuevo presupuesto'}
        ancho={440}
      >
        {form !== null && (
          <PresupuestoForm
            key={form.id ?? `n-${form.categoria ?? ''}`}
            inicial={enEdicion}
            mes={mes}
            opciones={opciones}
            categoriaInicial={form.categoria}
            onGuardar={guardar}
          />
        )}
      </Drawer>
    </section>
  )
}
