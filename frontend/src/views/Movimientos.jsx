import { useMemo, useState } from 'react'
import Icon from '../components/Icon'
import Numero from '../components/Numero'
import Seg from '../components/Seg'
import { nombreDocumento } from '../data/categorias'
import { clpNeto, clpSigno, fechaCorta, hoyISO, mesLargo } from '../lib/format'
import { useCategorias } from '../state/Categorias'
import { totales, useMovimientos } from '../state/Movimientos'
import { useSesion } from '../state/Sesion'
import Bienvenida from './Bienvenida'
import './Movimientos.css'

const TIPOS = [
  { id: 'todos', label: 'Todos' },
  { id: 'ingreso', label: 'Ingresos' },
  { id: 'gasto', label: 'Gastos' },
]

const filtrosIniciales = () => ({ q: '', tipo: 'todos', cat: 'todas', usuario: 'todos', mes: hoyISO().slice(0, 7) })

// Texto sin tildes ni mayúsculas, para que "mantencion" encuentre "Mantención"
const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// HU07. onNuevo / onEditar llegan en null si el rol no registra movimientos (contador): la lista
// es de solo lectura, salvo las filas con foto o PDF, que abren el comprobante con onVer (HU09).
export default function Movimientos({ onNuevo, onEditar, onVer }) {
  const { movs, tocado } = useMovimientos()
  const { categorias, categoria } = useCategorias()
  const { puede } = useSesion()
  // El empleado solo recibe sus movimientos (RLS), así que no tiene filtro por usuario
  const porUsuario = puede('movimientos.filtrar_usuario')
  const [f, setF] = useState(filtrosIniciales)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))

  // Meses con datos + el actual, del más nuevo al más viejo
  const meses = useMemo(() => {
    const s = new Set(movs.map((m) => m.fecha.slice(0, 7)))
    s.add(hoyISO().slice(0, 7))
    return [...s].sort().reverse()
  }, [movs])

  // Quienes registraron algo, para el filtro por usuario
  const usuarios = useMemo(() => {
    const m = new Map(movs.map((x) => [x.usuario_id, x.usuario_nombre]))
    return [...m].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [movs])

  const filas = useMemo(() => {
    const q = normalizar(f.q.trim())
    return movs.filter(
      (m) =>
        (f.tipo === 'todos' || m.tipo === f.tipo) &&
        (f.cat === 'todas' || m.categoria_id === f.cat) &&
        (f.usuario === 'todos' || m.usuario_id === f.usuario) &&
        (f.mes === 'todos' || m.fecha.startsWith(f.mes)) &&
        (!q || normalizar(`${m.descripcion} ${m.proveedor} ${categoria(m.categoria_id).nombre}`).includes(q)),
    )
  }, [movs, f, categoria])

  const t = useMemo(() => totales(filas), [filas])
  const hayFiltros = f.q || f.tipo !== 'todos' || f.cat !== 'todas' || f.usuario !== 'todos'
  // Cambia cuando cambian los filtros: reinicia la animación escalonada de las filas
  const claveLista = `${f.tipo}|${f.cat}|${f.usuario}|${f.mes}`

  if (!movs.length) return <Bienvenida onNuevo={onNuevo} />

  const cats = f.tipo === 'todos' ? categorias : categorias.filter((c) => c.tipo === f.tipo)
  // Qué hace tocar una fila: editar (admin y empleado) o ver su comprobante (contador)
  const abrir = (m) => (onEditar ? onEditar : m.tiene_comprobante ? onVer : null)
  // Props de una fila clickeable; sin acción la fila es solo lectura
  const editable = (m, etiqueta) => {
    const accion = abrir(m)
    return accion
      ? {
          tabIndex: 0,
          onClick: () => accion(m),
          onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), accion(m)),
          'aria-label': onEditar ? etiqueta : `Ver el comprobante de ${m.descripcion}`,
        }
      : {}
  }

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Movimientos</span>
          <h1>Todo lo que entra y sale</h1>
        </div>
        {onNuevo && (
          <button type="button" className="btn btn-primary" onClick={onNuevo}>
            <Icon name="plus" />
            Nuevo movimiento
          </button>
        )}
      </div>

      <section className="sum" aria-label="Totales de lo filtrado">
        <div>
          <span>Ingresos</span>
          <strong className="mono amt-in">
            <Numero valor={t.ingresos} />
          </strong>
        </div>
        <div>
          <span>Gastos</span>
          <strong className="mono amt-out">
            <Numero valor={t.gastos} />
          </strong>
        </div>
        <div className="sum-res">
          <span>Resultado</span>
          <strong className="mono">
            <Numero valor={t.resultado} formato={clpNeto} />
          </strong>
        </div>
      </section>

      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <input
            className="input"
            type="search"
            placeholder="Buscar movimientos"
            value={f.q}
            onChange={(e) => set('q', e.target.value)}
            aria-label="Buscar movimientos"
          />
        </label>
        <Seg
          label="Tipo"
          opciones={TIPOS}
          valor={f.tipo}
          onChange={(v) => setF((x) => ({ ...x, tipo: v, cat: v !== 'todos' && categoria(x.cat).tipo !== v ? 'todas' : x.cat }))}
        />
        <select className="input" value={f.cat} onChange={(e) => set('cat', e.target.value)} aria-label="Categoría">
          <option value="todas">Todas las categorías</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        {porUsuario && usuarios.length > 1 && (
          <select className="input" value={f.usuario} onChange={(e) => set('usuario', e.target.value)} aria-label="Registrado por">
            <option value="todos">Todas las personas</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        )}
        <select className="input cap-sel" value={f.mes} onChange={(e) => set('mes', e.target.value)} aria-label="Mes">
          {meses.map((m) => (
            <option key={m} value={m}>
              {mesLargo(m)}
            </option>
          ))}
          <option value="todos">Todos los meses</option>
        </select>
      </div>

      {filas.length === 0 ? (
        <div className="card nores">
          <span className="nores-ic">
            <Icon name="search" />
          </span>
          <h2>No hay movimientos con esos filtros</h2>
          <p className="muted">
            {f.mes !== 'todos' && !hayFiltros ? `Aún no registras nada en ${mesLargo(f.mes)}.` : 'Prueba con otra búsqueda o limpia los filtros.'}
          </p>
          <div className="nores-acts">
            {hayFiltros && (
              <button type="button" className="btn btn-ghost" onClick={() => setF((x) => ({ ...filtrosIniciales(), mes: x.mes }))}>
                Limpiar filtros
              </button>
            )}
            {onNuevo && (
              <button type="button" className="btn btn-primary" onClick={onNuevo}>
                <Icon name="plus" />
                Nuevo movimiento
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Desktop: tabla */}
          <div className="table-wrap movs-table">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Detalle</th>
                  <th>Categoría</th>
                  <th>Documento</th>
                  <th className="num">Monto</th>
                </tr>
              </thead>
              <tbody key={claveLista}>
                {filas.map((m, i) => {
                  const c = categoria(m.categoria_id)
                  return (
                    <tr
                      key={m.id}
                      className={`${abrir(m) ? 'row' : ''}${m.id === tocado ? ' flash' : ''}`}
                      style={{ '--d': `${Math.min(i, 12) * 28}ms` }}
                      {...editable(m, `Editar ${m.descripcion}`)}
                    >
                      <td className="mono muted">{fechaCorta(m.fecha)}</td>
                      <td>
                        <strong>
                          {m.descripcion}
                          {m.tiene_comprobante && (
                            <span className="row-doc" title={m.origen === 'pdf' ? 'Con PDF' : 'Con foto'}>
                              <Icon name={m.origen === 'pdf' ? 'receipt' : 'camera'} />
                              <span className="sr-only">{m.origen === 'pdf' ? 'Con PDF' : 'Con foto'}</span>
                            </span>
                          )}
                        </strong>
                        {(m.proveedor || porUsuario) && (
                          <small className="sub">
                            {[m.proveedor, porUsuario && `Registró: ${m.usuario_nombre}`].filter(Boolean).join(' · ')}
                          </small>
                        )}
                      </td>
                      <td>
                        <span className="cat-chip" style={{ '--c': c.color }}>
                          <span className="dot" />
                          {c.nombre}
                        </span>
                      </td>
                      <td className="muted">{nombreDocumento(m.tipo_documento)}</td>
                      <td className={`num mono ${m.tipo === 'ingreso' ? 'amt-in' : 'amt-out'}`}>
                        {clpSigno(m.monto, m.tipo)}
                        {onEditar && <Icon name="pen" className="row-edit" />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    {filas.length} {filas.length === 1 ? 'movimiento' : 'movimientos'}
                  </td>
                  <td className="num mono">{clpNeto(t.resultado)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Celular: lista de tarjetas */}
          <ul className="movs-list" key={`l-${claveLista}`}>
            {filas.map((m, i) => {
              const c = categoria(m.categoria_id)
              return (
                <li key={m.id} className={m.id === tocado ? 'flash' : ''} style={{ '--d': `${Math.min(i, 12) * 28}ms` }}>
                  <button type="button" onClick={abrir(m) ? () => abrir(m)(m) : undefined} disabled={!abrir(m)}>
                    <span className="dot" style={{ color: c.color }} />
                    <span className="ml-t">
                      <strong>{m.descripcion}</strong>
                      <small>
                        {fechaCorta(m.fecha)} · {c.nombre}
                        {porUsuario && ` · ${m.usuario_nombre}`}
                        {m.tiene_comprobante && ` · ${m.origen === 'pdf' ? 'PDF' : 'Foto'}`}
                      </small>
                    </span>
                    <span className={`mono ${m.tipo === 'ingreso' ? 'amt-in' : 'amt-out'}`}>{clpSigno(m.monto, m.tipo)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="muted movs-count">
            {filas.length} {filas.length === 1 ? 'movimiento' : 'movimientos'}
          </p>
        </>
      )}
    </>
  )
}
