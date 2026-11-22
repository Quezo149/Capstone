import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { clp, nombreMes } from '../lib/format'
import './ResumenPresupuestos.css'

// HU15: tarjeta de Inicio que lleva a Presupuestos. En el celular no hay menú
// lateral y la barra inferior ya está completa: así se llega desde donde ya se mira el mes.
// Solo dueño y contador (presupuestos.ver). Muestra el avance total y lo que pide atención.

const AVISO = 0.8 // mismo umbral que la pantalla de Presupuestos
const MAX_ALERTAS = 3

function alertas(lista, cerrado) {
  const out = []
  for (const p of lista) {
    if (p.gastado > p.monto) out.push({ p, orden: 0, texto: `te pasaste por ${clp(p.gastado - p.monto)}`, clase: 'mal' })
    else if (p.gastado === p.monto && p.monto > 0) out.push({ p, orden: 1, texto: 'llegó al límite', clase: 'cerca' })
    else if (!cerrado && p.gastado / p.monto >= AVISO) out.push({ p, orden: 2, texto: `quedan ${clp(p.monto - p.gastado)}`, clase: 'cerca' })
  }
  return out.sort((a, b) => a.orden - b.orden || b.p.gastado / b.p.monto - a.p.gastado / a.p.monto)
}

export default function ResumenPresupuestos({ mes, cerrado, gestiona, version }) {
  const [lista, setLista] = useState(null)

  useEffect(() => {
    let vigente = true
    api(`/presupuestos?mes=${mes}`)
      .then((l) => vigente && setLista(l))
      .catch(() => vigente && setLista([])) // si falla, la tarjeta no estorba en Inicio
    return () => {
      vigente = false
    }
  }, [mes, version])

  if (!lista) return null
  // Sin presupuestos: el dueño ve la invitación a definirlos; el contador, nada
  if (!lista.length) {
    if (!gestiona || cerrado) return null
    return (
      <a className="card rp rp-vacio rise" href="#/presupuestos" style={{ '--d': '170ms' }}>
        <span>
          <strong>Presupuestos</strong>
          <small className="muted">Define cuánto gastar como máximo en {nombreMes(mes)}</small>
        </span>
      </a>
    )
  }

  const total = lista.reduce((s, p) => s + p.monto, 0)
  const gastado = lista.reduce((s, p) => s + p.gastado, 0)
  const pct = total ? Math.round((gastado / total) * 100) : 0
  const avisos = alertas(lista, cerrado)
  const excedido = gastado > total

  return (
    <a className="card rp rise" href="#/presupuestos" style={{ '--d': '170ms' }} aria-label={`Presupuestos de ${nombreMes(mes)}: ${pct} % usado`}>
      <span className="rp-head">
        <strong>Presupuestos</strong>
        <span className="muted cap">{nombreMes(mes)}</span>
      </span>
      <span className="rp-total">
        <span className="mono">
          <strong>{clp(gastado)}</strong> <span className="muted">de {clp(total)}</span>
        </span>
        <span className={`mono rp-pct${excedido ? ' mal' : ''}`}>{pct} %</span>
      </span>
      <span className={`rp-barra${excedido ? ' mal' : ''}`} aria-hidden="true">
        <i style={{ '--w': `${Math.min(pct, 100)}%` }} />
      </span>
      {avisos.length ? (
        <ul className="rp-avisos">
          {avisos.slice(0, MAX_ALERTAS).map(({ p, texto, clase }) => (
            <li key={p.id} className={clase}>
              <span className="dot" style={{ color: p.color }} />
              <span className="rp-cat">{p.categoria}</span>
              <span className="rp-txt">{texto}</span>
            </li>
          ))}
          {avisos.length > MAX_ALERTAS && <li className="muted">y {avisos.length - MAX_ALERTAS} más</li>}
        </ul>
      ) : (
        <span className="rp-ok">{cerrado ? 'Todas las categorías quedaron dentro del límite.' : 'Todo dentro del presupuesto.'}</span>
      )}
    </a>
  )
}
