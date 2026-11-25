import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon'
import Numero from '../components/Numero'
import Seg from '../components/Seg'
import { nombreDocumento } from '../data/categorias'
import { exportarCsv, exportarXlsx, filasExportables } from '../lib/exportar'
import { clpNeto, clpSigno, fechaCorta, hoyISO, mesLargo } from '../lib/format'
import { useCategorias } from '../state/Categorias'
import { totales, useMovimientos } from '../state/Movimientos'
import { useSesion } from '../state/Sesion'
import { useToast } from '../state/Toasts'
import { useMedia } from '../hooks/useMedia'
import Bienvenida from './Bienvenida'
import './Movimientos.css'

// Solo la primera letra: «Noviembre 2026». Con text-transform: capitalize el selector mostraba
// «Todos Los Meses» (hallazgo H6 de las pruebas del 27-10)
const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1)

const TIPOS = [
  { id: 'todos', label: 'Todos' },
  { id: 'ingreso', label: 'Ingresos' },
  { id: 'gasto', label: 'Gastos' },
]

// mes: 'AAAA-MM', 'todos' o 'rango' (PROTOTIPO Sprint 5, HU16: desde/hasta, ambos incluidos)
const filtrosIniciales = () => {
  const hoy = hoyISO()
  return { q: '', tipo: 'todos', cat: 'todas', usuario: 'todos', mes: hoy.slice(0, 7), desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
}

// Fila de la exportación: qué se filtró, para el nombre del archivo y el resumen del menú
function describirFiltros(f, categoria, usuarios) {
  const partes = []
  if (f.mes === 'rango') partes.push(`${fechaCorta(f.desde)} al ${fechaCorta(f.hasta)}`)
  else partes.push(f.mes === 'todos' ? 'Todos los meses' : mesLargo(f.mes))
  if (f.tipo !== 'todos') partes.push(f.tipo === 'gasto' ? 'Gastos' : 'Ingresos')
  if (f.cat !== 'todas') partes.push(categoria(f.cat).nombre)
  if (f.usuario !== 'todos') partes.push(usuarios.find((u) => u.id === f.usuario)?.nombre ?? '')
  if (f.q.trim()) partes.push(`«${f.q.trim()}»`)
  return partes
}

const nombreArchivo = (f) =>
  `kontadoria-movimientos-${f.mes === 'rango' ? `${f.desde}_al_${f.hasta}` : f.mes === 'todos' ? 'todos' : f.mes}`

// PROTOTIPO Sprint 5 — HU16 (KONTADORIA-80): exportar lo que está filtrado, en Excel o CSV.
// Solo dueño y contador (movimientos.exportar); el archivo usa las columnas de la plantilla.
function Exportar({ filas, filtros, onExportar }) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef(null)
  const boton = useRef(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e) => !caja.current?.contains(e.target) && setAbierto(false)
    const esc = (e) => e.key === 'Escape' && (setAbierto(false), boton.current?.focus())
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [abierto])
  const elegir = (formato) => {
    setAbierto(false)
    onExportar(formato)
  }
  return (
    <div className="exp" ref={caja}>
      <button
        ref={boton}
        type="button"
        className="btn btn-ghost"
        onClick={() => setAbierto((x) => !x)}
        aria-expanded={abierto}
        aria-controls="exp-menu"
        disabled={!filas}
      >
        <Icon name="download" />
        Exportar
      </button>
      {abierto && (
        <div className="exp-menu" id="exp-menu">
          <p className="exp-resumen">
            <strong>
              {filas} {filas === 1 ? 'movimiento' : 'movimientos'}
            </strong>
            <span className="muted">{filtros.join(' · ')}</span>
          </p>
          <button type="button" onClick={() => elegir('xlsx')}>
            <Icon name="sheet" />
            <span>
              Excel <small className="muted">.xlsx</small>
            </span>
          </button>
          <button type="button" onClick={() => elegir('csv')}>
            <Icon name="list" />
            <span>
              CSV <small className="muted">separado por ;</small>
            </span>
          </button>
          <p className="exp-nota muted">Mismas columnas de la plantilla: puedes volver a importarlo.</p>
        </div>
      )}
    </div>
  )
}

// Texto sin tildes ni mayúsculas, para que "mantencion" encuentre "Mantención"
const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// HU07. onNuevo / onEditar llegan en null si el rol no registra movimientos (contador):
// entonces la lista es de solo lectura.
export default function Movimientos({ onNuevo, onEditar }) {
  const { movs, tocado } = useMovimientos()
  const { categorias, categoria } = useCategorias()
  const { puede } = useSesion()
  // El empleado solo recibe sus movimientos (RLS), así que no tiene filtro por usuario
  const porUsuario = puede('movimientos.filtrar_usuario')
  // En el celular los selectores van de a dos por fila: los textos largos se cortaban
  const angosto = useMedia('(max-width: 720px)')
  const exporta = puede('movimientos.exportar')
  const { aviso } = useToast()
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
        (f.mes === 'todos' || (f.mes === 'rango' ? m.fecha >= f.desde && m.fecha <= f.hasta : m.fecha.startsWith(f.mes))) &&
        (!q || normalizar(`${m.descripcion} ${m.proveedor} ${categoria(m.categoria_id).nombre}`).includes(q)),
    )
  }, [movs, f, categoria])

  const t = useMemo(() => totales(filas), [filas])
  const hayFiltros = f.q || f.tipo !== 'todos' || f.cat !== 'todas' || f.usuario !== 'todos'
  // Cambia cuando cambian los filtros: reinicia la animación escalonada de las filas
  const claveLista = `${f.tipo}|${f.cat}|${f.usuario}|${f.mes}|${f.desde}|${f.hasta}`

  function exportar(formato) {
    const datos = filasExportables([...filas].sort((a, b) => a.fecha.localeCompare(b.fecha)), categoria)
    const nombre = nombreArchivo(f)
    if (formato === 'xlsx') exportarXlsx(nombre, datos)
    else exportarCsv(nombre, datos)
    aviso(`Descargamos ${datos.length} ${datos.length === 1 ? 'movimiento' : 'movimientos'} en ${formato === 'xlsx' ? 'Excel' : 'CSV'}`)
  }

  if (!movs.length) return <Bienvenida onNuevo={onNuevo} />

  const cats = f.tipo === 'todos' ? categorias : categorias.filter((c) => c.tipo === f.tipo)
  // Props de una fila clickeable; sin onEditar la fila es solo lectura
  const editable = (m, etiqueta) =>
    onEditar
      ? {
          tabIndex: 0,
          onClick: () => onEditar(m),
          onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onEditar(m)),
          'aria-label': etiqueta,
        }
      : {}

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Movimientos</h1>
        </div>
        <div className="movs-acts">
          {exporta && <Exportar filas={filas.length} filtros={describirFiltros(f, categoria, usuarios)} onExportar={exportar} />}
          {onNuevo && (
            // En el celular ya está el botón + del menú inferior
            <button type="button" className="btn btn-primary solo-pc" onClick={onNuevo}>
              <Icon name="plus" />
              Nuevo movimiento
            </button>
          )}
        </div>
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
            placeholder="Buscar"
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
        {/* En el celular, los tres selectores van en una fila que se desliza */}
        {/* En el celular: grilla del ancho de la pantalla, con el mes arriba (PROTOTIPO 24-11-2026) */}
        <div className={`toolbar-sel${porUsuario && usuarios.length > 1 ? ' con-personas' : ''}`}>
        <select className="input" value={f.cat} onChange={(e) => set('cat', e.target.value)} aria-label="Categoría">
          <option value="todas">{angosto ? 'Categorías' : 'Todas las categorías'}</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        {porUsuario && usuarios.length > 1 && (
          <select className="input" value={f.usuario} onChange={(e) => set('usuario', e.target.value)} aria-label="Registrado por">
            <option value="todos">{angosto ? 'Personas' : 'Todas las personas'}</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        )}
        <select className="input sel-mes" value={f.mes} onChange={(e) => set('mes', e.target.value)} aria-label="Mes">
          {meses.map((m) => (
            <option key={m} value={m}>
              {mayuscula(mesLargo(m))}
            </option>
          ))}
          <option value="todos">Todos los meses</option>
          <option value="rango">Rango de fechas…</option>
        </select>
        {/* PROTOTIPO Sprint 5 (HU16): rango de fechas libre, para exportar un período. Va junto al mes
            para que en el celular aparezca justo debajo de él (24-11-2026) */}
        {f.mes === 'rango' && (
          <div className="rango">
            <label>
              <span>Desde</span>
              <input
                className="input"
                type="date"
                value={f.desde}
                max={f.hasta}
                onChange={(e) => e.target.value && set('desde', e.target.value)}
              />
            </label>
            <label>
              <span>Hasta</span>
              <input
                className="input"
                type="date"
                value={f.hasta}
                min={f.desde}
                onChange={(e) => e.target.value && set('hasta', e.target.value)}
              />
            </label>
          </div>
        )}
        </div>
      </div>

      {filas.length === 0 ? (
        <div className="card nores">
          <span className="nores-ic">
            <Icon name="search" />
          </span>
          <h2>No hay movimientos con esos filtros</h2>
          <p className="muted">
            {f.mes !== 'todos' && f.mes !== 'rango' && !hayFiltros ? `Aún no registras nada en ${mesLargo(f.mes)}.` : 'Prueba con otra búsqueda o limpia los filtros.'}
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
                      className={`${onEditar ? 'row' : ''}${m.id === tocado ? ' flash' : ''}`}
                      style={{ '--d': `${Math.min(i, 12) * 28}ms` }}
                      {...editable(m, `Editar ${m.descripcion}`)}
                    >
                      <td className="mono muted">{fechaCorta(m.fecha)}</td>
                      <td>
                        <strong>{m.descripcion}</strong>
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
                      <td className="muted">
                        <span className="doc-cel">
                          {nombreDocumento(m.tipo_documento)}
                          {m.documento && (
                            <span className="doc-ic" title={m.origen === 'pdf' ? 'Leído desde un PDF' : 'Leído desde una foto'}>
                              <Icon name={m.origen === 'pdf' ? 'receipt' : 'camera'} />
                            </span>
                          )}
                          {/* PROTOTIPO Sprint 4: importado desde planilla */}
                          {m.origen === 'importacion_masiva' && (
                            <span className="doc-ic" title="Importado desde una planilla">
                              <Icon name="sheet" />
                            </span>
                          )}
                        </span>
                      </td>
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
                  <button type="button" onClick={onEditar ? () => onEditar(m) : undefined} disabled={!onEditar}>
                    <span className="dot" style={{ color: c.color }} />
                    <span className="ml-t">
                      <strong>{m.descripcion}</strong>
                      <small>
                        {fechaCorta(m.fecha)} · {c.nombre}
                        {porUsuario && ` · ${m.usuario_nombre}`}
                        {m.documento && ` · ${m.origen === 'pdf' ? 'PDF' : 'Foto'}`}
                        {m.origen === 'importacion_masiva' && ' · Planilla'}
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
