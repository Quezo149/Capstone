import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon'
import Seg from '../components/Seg'
import { api } from '../lib/api'
import { clpSigno, fechaCorta } from '../lib/format'
import { COLUMNAS, MAX_FILAS, MAX_MB, descargarErrores, descargarPlantillaCsv, ejemplos, leerArchivo } from '../lib/importacion'
import { leerDb } from '../lib/proto'
import { useCategorias } from '../state/Categorias'
import { useMovimientos } from '../state/Movimientos'
import { useSesion } from '../state/Sesion'
import { useToast } from '../state/Toasts'
import './Importar.css'

// PROTOTIPO HU10 (importar CSV/XLSX) + HU11 (validar filas) + HU12 (revisar antes de confirmar)
// + HU13 (historial). Pasos: elegir → validando → revisar | estructura → hecho.
const PASOS = [
  ['leyendo', 'Abriendo la planilla'],
  ['estructura', 'Revisando las columnas'],
  ['filas', 'Validando cada fila'],
]
const plantillaXlsx = `${import.meta.env.BASE_URL}plantilla-kontadoria.xlsx`
const nuevoRequestId = () => crypto.randomUUID?.() ?? `r-${Date.now()}-${Math.random().toString(36).slice(2)}`

export default function Importar() {
  const { recargar } = useMovimientos()
  const { puede } = useSesion()
  const { aviso } = useToast()
  const [etapa, setEtapa] = useState('elegir')
  const [paso, setPaso] = useState(null)
  const [archivo, setArchivo] = useState(null) // { nombre, tipo, filas }
  const [res, setRes] = useState(null) // { estructura, filas }
  const [hecha, setHecha] = useState(null)
  const [error, setError] = useState(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [historial, setHistorial] = useState(null)
  const requestId = useRef(null)
  const input = useRef(null)
  const listaEjemplos = useMemo(() => ejemplos(leerDb().movimientos), [])

  const cargarHistorial = useCallback(() => {
    if (puede('importaciones.ver')) api('/importaciones').then(setHistorial)
  }, [puede])
  useEffect(cargarHistorial, [cargarHistorial])

  async function procesar(a) {
    setError(null)
    setArchivo(a)
    setEtapa('validando')
    setPaso('leyendo')
    await new Promise((r) => setTimeout(r, 350))
    setPaso('estructura')
    await new Promise((r) => setTimeout(r, 350))
    setPaso('filas')
    const r = await api('/importaciones/validar', { method: 'POST', body: { nombre: a.nombre, tipo: a.tipo, filas: a.filas } })
    if (r.filas.length > MAX_FILAS) {
      setError(`La planilla tiene ${r.filas.length.toLocaleString('es-CL')} filas. El máximo es ${MAX_FILAS.toLocaleString('es-CL')}: divídela en dos archivos.`)
      return setEtapa('elegir')
    }
    if (r.estructura.ok && !r.filas.length) {
      setError('La planilla tiene las columnas correctas, pero no trae ninguna fila con datos.')
      return setEtapa('elegir')
    }
    requestId.current = nuevoRequestId() // uno por vista previa: confirmar dos veces no duplica
    setRes(r)
    setEtapa(r.estructura.ok ? 'revisar' : 'estructura')
  }

  async function elegirArchivo(f) {
    if (!f) return
    try {
      const { tipo, filas } = await leerArchivo(f)
      procesar({ nombre: f.name, tipo, filas })
    } catch (e) {
      setError(e.message)
    }
  }

  function volver() {
    setEtapa('elegir')
    setRes(null)
    setArchivo(null)
    setPaso(null)
    if (input.current) input.current.value = ''
  }

  function cancelar() {
    volver()
    aviso('Importación cancelada: no se guardó nada')
  }

  async function confirmar() {
    setGuardando(true)
    try {
      const imp = await api('/importaciones', {
        method: 'POST',
        body: { nombre: archivo.nombre, tipo: archivo.tipo, filas: archivo.filas, client_request_id: requestId.current },
      })
      await recargar()
      cargarHistorial()
      setHecha(imp)
      setEtapa('hecho')
      aviso(`${imp.filas_importadas} movimientos importados`, { festejo: true })
    } catch (e) {
      aviso(e.message)
    } finally {
      setGuardando(false)
    }
  }

  async function anular(imp, deshacer = false) {
    try {
      await api(`/importaciones/${imp.id}/${deshacer ? 'restaurar' : 'anular'}`, { method: 'POST' })
      await recargar()
      cargarHistorial()
      if (!deshacer)
        aviso(`Importación anulada: ${imp.filas_importadas} movimientos quitados`, {
          accion: { label: 'Deshacer', onClick: () => anular(imp, true) },
        })
    } catch (e) {
      aviso(e.message)
    }
  }

  if (etapa === 'validando') {
    const actual = PASOS.findIndex(([x]) => x === paso)
    return (
      <>
        <Cabecera eyebrow="Importar planilla" titulo="Revisando tu planilla…" />
        <div className="card im-pasos" role="status" aria-live="polite">
          <ArchivoChip archivo={archivo} />
          <ol>
            {PASOS.map(([id, texto], i) => {
              const estado = i < actual ? 'ok' : i === actual ? 'en-curso' : 'espera'
              return (
                <li key={id} className={estado}>
                  <span className="im-paso-ic">{estado === 'ok' ? <Icon name="check" /> : estado === 'en-curso' ? <span className="spinner" /> : i + 1}</span>
                  {texto}
                </li>
              )
            })}
          </ol>
          <p className="muted">Nada se guarda todavía: primero vas a ver el resumen.</p>
        </div>
      </>
    )
  }

  if (etapa === 'estructura') {
    const { faltan, sobran, encabezado } = res.estructura
    return (
      <>
        <Cabecera eyebrow="Importar planilla" titulo="Esta planilla no usa la plantilla" bajada="No se guardó nada. Copia tus datos en la plantilla y vuelve a subirla." />
        <div className="im-grid">
          <div className="card im-estructura">
            <ArchivoChip archivo={archivo} />
            <h2>Columnas de tu archivo</h2>
            <ul className="im-cols">
              {encabezado.filter(Boolean).map((h, i) => (
                <li key={i} className={sobran.includes(h) ? 'mal' : ''}>
                  {h}
                </li>
              ))}
            </ul>
            {faltan.length > 0 && (
              <p className="im-motivo">
                <Icon name="x" />
                <span>
                  Faltan: <strong>{faltan.join(', ')}</strong>.
                </span>
              </p>
            )}
            {sobran.length > 0 && (
              <p className="im-motivo">
                <Icon name="x" />
                <span>
                  No son de la plantilla: <strong>{sobran.join(', ')}</strong>.
                </span>
              </p>
            )}
            <div className="im-acts">
              <button type="button" className="btn btn-ghost" onClick={volver}>
                Probar con otro archivo
              </button>
              <a className="btn btn-primary" href={plantillaXlsx} download>
                <Icon name="in" />
                Descargar plantilla
              </a>
            </div>
          </div>
          <Plantilla />
        </div>
      </>
    )
  }

  if (etapa === 'revisar') return <Revision archivo={archivo} filas={res.filas} guardando={guardando} onConfirmar={confirmar} onCancelar={cancelar} />

  if (etapa === 'hecho') {
    return (
      <>
        <Cabecera eyebrow="Importar planilla" titulo="Importación lista" />
        <div className="card im-hecho rise">
          <span className="im-hecho-ic">
            <Icon name="check" />
          </span>
          <h2>
            {hecha.filas_importadas} {hecha.filas_importadas === 1 ? 'movimiento importado' : 'movimientos importados'}
          </h2>
          <p className="muted">
            Desde <strong>{hecha.nombre_archivo}</strong>
            {hecha.filas_con_error > 0 && ` · ${hecha.filas_con_error} filas con error quedaron fuera`}. Quedó registrada en el historial.
          </p>
          <div className="im-acts">
            <button type="button" className="btn btn-ghost" onClick={volver}>
              Importar otra planilla
            </button>
            <a className="btn btn-primary" href="#/movimientos">
              Ver movimientos
            </a>
          </div>
        </div>
        <Historial lista={historial} onAnular={puede('importaciones.anular') ? anular : null} resaltar={hecha.id} />
      </>
    )
  }

  return (
    <>
      <Cabecera eyebrow="Importar planilla" titulo="Trae tus movimientos desde Excel" bajada="Sube un CSV o XLSX con la plantilla. Revisas el resultado antes de guardar." />
      <div className="im-grid">
        <div
          className={`card im-drop${arrastrando ? ' sobre' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setArrastrando(true)
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault()
            setArrastrando(false)
            elegirArchivo(e.dataTransfer.files[0])
          }}
        >
          <span className="im-drop-ic">
            <Icon name="sheet" />
          </span>
          <h2>Sube tu planilla</h2>
          <p className="muted">
            Arrástrala aquí o elígela. CSV o XLSX de hasta {MAX_MB} MB y {MAX_FILAS.toLocaleString('es-CL')} filas.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => input.current.click()}>
            <Icon name="plus" />
            Elegir archivo
          </button>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => elegirArchivo(e.target.files[0])} />
        </div>
        <Plantilla />
      </div>

      <section className="im-ejemplos">
        <div className="card-head">
          <h2>¿No tienes una planilla a mano? Prueba con un ejemplo</h2>
        </div>
        <ul>
          {listaEjemplos.map((ej, i) => (
            <li key={ej.id} className="rise" style={{ '--d': `${i * 60}ms` }}>
              <button type="button" onClick={() => procesar(ej)}>
                <span className={`im-ej-ic ${ej.tipo}`}>
                  <Icon name="sheet" />
                  <span className={`chip ${ej.falla ? 'warn' : ''}`}>{ej.tipo.toUpperCase()}</span>
                </span>
                <strong>{ej.titulo}</strong>
                <small>{ej.detalle}</small>
                <small className="mono">{ej.nombre}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Historial lista={historial} onAnular={puede('importaciones.anular') ? anular : null} />
    </>
  )
}

// HU11 + HU12: resumen, filas con su estado y confirmar o cancelar
function Revision({ archivo, filas, guardando, onConfirmar, onCancelar }) {
  const { categoria } = useCategorias()
  const [filtro, setFiltro] = useState(() => (filas.some((f) => f.errores.length) ? 'error' : 'todas'))
  const validas = filas.filter((f) => f.datos)
  const conError = filas.length - validas.length
  const avisos = validas.filter((f) => f.aviso).length
  const suma = (tipo) => validas.filter((f) => f.datos.tipo === tipo).reduce((s, f) => s + f.datos.monto, 0)
  const vistas = filas.filter((f) => (filtro === 'error' ? f.errores.length : filtro === 'validas' ? f.datos : true))

  return (
    <>
      <Cabecera eyebrow="Revisión" titulo="Revisa antes de importar" bajada="Solo se guardan las filas sin errores, y solo cuando confirmes." />
      <ArchivoChip archivo={archivo} />

      <div className="im-tiles">
        <div className="card im-tile">
          <span>Filas en el archivo</span>
          <strong className="mono">{filas.length}</strong>
        </div>
        <div className="card im-tile ok">
          <span>Listas para importar</span>
          <strong className="mono">{validas.length}</strong>
          {avisos > 0 && <small>{avisos === 1 ? '1 parece repetida' : `${avisos} parecen repetidas`}</small>}
        </div>
        <div className={`card im-tile ${conError ? 'mal' : ''}`}>
          <span>Con error</span>
          <strong className="mono">{conError}</strong>
          {conError > 0 && <small>No se importan</small>}
        </div>
        <div className="card im-tile">
          <span>Se van a sumar</span>
          <strong className="mono im-montos">
            <span className="amt-in">{clpSigno(suma('ingreso'), 'ingreso')}</span>
            <span className="amt-out">{clpSigno(suma('gasto'), 'gasto')}</span>
          </strong>
        </div>
      </div>

      {conError > 0 && (
        <div className="card im-aviso-err" role="alert">
          <Icon name="x" />
          <p>
            <strong>
              {conError} {conError === 1 ? 'fila tiene' : 'filas tienen'} errores y no se van a importar.
            </strong>{' '}
            Descárgalas con su motivo, corrígelas y súbelas en otra planilla.
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => descargarErrores(archivo.nombre, filas)}>
            <Icon name="in" />
            Descargar filas con error
          </button>
        </div>
      )}

      <div className="im-filtros">
        <Seg
          label="Mostrar filas"
          valor={filtro}
          onChange={setFiltro}
          opciones={[
            { id: 'todas', label: `Todas (${filas.length})` },
            { id: 'error', label: `Con error (${conError})` },
            { id: 'validas', label: `Listas (${validas.length})` },
          ]}
        />
      </div>

      {/* Computador: tabla */}
      <div className="table-wrap im-tabla">
        <table>
          <thead>
            <tr>
              <th className="num">Fila</th>
              <th>Fecha</th>
              <th>Detalle</th>
              <th>Categoría</th>
              <th className="num">Monto</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody key={filtro}>
            {vistas.map((f) => {
              const c = f.datos && categoria(f.datos.categoria_id)
              return (
                <tr key={f.n} className={f.errores.length ? 'im-fila-mal' : ''}>
                  <td className="num mono muted">{f.n}</td>
                  <td className="mono im-fecha">{f.datos ? fechaCorta(f.datos.fecha) : f.valores.fecha || '—'}</td>
                  <td>
                    <strong>{f.valores.descripcion || <span className="muted">Sin descripción</span>}</strong>
                    {f.valores.proveedor && <small className="sub">{f.valores.proveedor}</small>}
                  </td>
                  <td>
                    {c ? (
                      <span className="cat-chip" style={{ '--c': c.color }}>
                        <span className="dot" />
                        {c.nombre}
                      </span>
                    ) : (
                      <span className="muted">{f.valores.categoria || '—'}</span>
                    )}
                  </td>
                  <td className={`num mono ${f.datos ? (f.datos.tipo === 'ingreso' ? 'amt-in' : 'amt-out') : 'muted'}`}>
                    {f.datos ? clpSigno(f.datos.monto, f.datos.tipo) : f.valores.monto || '—'}
                  </td>
                  <td className="im-estado">
                    <Estado fila={f} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!vistas.length && <p className="muted im-vacio">No hay filas en este filtro.</p>}
      </div>

      {/* Celular: tarjetas */}
      <ul className="im-lista" key={`l-${filtro}`}>
        {vistas.map((f) => (
          <li key={f.n} className={f.errores.length ? 'im-fila-mal' : ''}>
            <div className="im-lista-top">
              <span className="mono muted">Fila {f.n}</span>
              <span className={`mono ${f.datos ? (f.datos.tipo === 'ingreso' ? 'amt-in' : 'amt-out') : 'muted'}`}>
                {f.datos ? clpSigno(f.datos.monto, f.datos.tipo) : f.valores.monto || '—'}
              </span>
            </div>
            <strong>{f.valores.descripcion || 'Sin descripción'}</strong>
            <small className="muted">
              {[f.valores.fecha, f.valores.categoria, f.valores.proveedor].filter(Boolean).join(' · ')}
            </small>
            <Estado fila={f} />
          </li>
        ))}
      </ul>

      <div className="im-barra">
        <p className="muted">
          {validas.length ? (
            <>
              Se importarán <strong>{validas.length}</strong> movimientos a tu nombre, marcados como <em>importados</em>.
            </>
          ) : (
            'Ninguna fila está lista: corrige la planilla y vuelve a subirla.'
          )}
        </p>
        <div className="im-acts">
          <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirmar} disabled={!validas.length || guardando}>
            {guardando ? <span className="spinner" /> : <Icon name="check" />}
            {guardando ? 'Importando…' : `Importar ${validas.length} ${validas.length === 1 ? 'movimiento' : 'movimientos'}`}
          </button>
        </div>
      </div>
    </>
  )
}

function Estado({ fila }) {
  if (fila.errores.length)
    return (
      <span className="im-mal">
        <Icon name="x" />
        <span>{fila.errores.join(' ')}</span>
      </span>
    )
  if (fila.aviso)
    return (
      <span className="im-ojo">
        <Icon name="receipt" />
        <span>
          <strong>¿Repetido?</strong> {fila.aviso}
        </span>
      </span>
    )
  return (
    <span className="im-ok">
      <Icon name="check" />
      Lista
    </span>
  )
}

// HU10: la plantilla con sus columnas fijas
function Plantilla() {
  const { categorias } = useCategorias()
  const visibles = categorias.filter((c) => !c.oculta)
  return (
    <div className="card im-plantilla">
      <h2>Usa la plantilla</h2>
      <p className="muted">Seis columnas, en este orden. La primera fila es el encabezado.</p>
      <ul className="im-plantilla-cols">
        {COLUMNAS.map((c) => (
          <li key={c.clave}>
            <code>{c.nombre}</code>
            <span>{c.ayuda}</span>
            <small className="mono muted">{c.ejemplo}</small>
          </li>
        ))}
      </ul>
      <details className="im-cats">
        <summary>Categorías que puedes usar ({visibles.length})</summary>
        <p>
          <strong>Gastos:</strong>{' '}
          {visibles
            .filter((c) => c.tipo === 'gasto')
            .map((c) => c.nombre)
            .join(', ')}
        </p>
        <p>
          <strong>Ingresos:</strong>{' '}
          {visibles
            .filter((c) => c.tipo === 'ingreso')
            .map((c) => c.nombre)
            .join(', ')}
        </p>
      </details>
      <div className="im-acts">
        <a className="btn btn-primary btn-sm" href={plantillaXlsx} download>
          <Icon name="in" />
          Plantilla Excel
        </a>
        <button type="button" className="btn btn-ghost btn-sm" onClick={descargarPlantillaCsv}>
          <Icon name="in" />
          Plantilla CSV
        </button>
      </div>
    </div>
  )
}

// HU13: historial de importaciones (quién, cuándo, qué archivo, cuántas filas, resultado)
function Historial({ lista, onAnular, resaltar }) {
  const [confirmando, setConfirmando] = useState(null)
  if (!lista) return null
  const hora = (iso) => {
    const d = new Date(iso)
    return `${fechaCorta(iso.slice(0, 10))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return (
    <section className="im-historial">
      <div className="card-head">
        <h2>Historial de importaciones</h2>
        <span className="muted">Cada archivo queda registrado con su resultado</span>
      </div>
      {!lista.length ? (
        <div className="card im-vacio-card">
          <p className="muted">Todavía no hay importaciones. La primera que confirmes aparece aquí.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Archivo</th>
                <th>Importó</th>
                <th className="num">Filas</th>
                <th>Resultado</th>
                {onAnular && <th />}
              </tr>
            </thead>
            <tbody>
              {lista.map((imp) => (
                <tr key={imp.id} className={imp.id === resaltar ? 'flash' : ''}>
                  <td className="mono muted">{hora(imp.creado_en)}</td>
                  <td>
                    <span className="im-archivo">
                      <Icon name="sheet" />
                      <strong>{imp.nombre_archivo}</strong>
                    </span>
                  </td>
                  <td>{imp.usuario_nombre}</td>
                  <td className="num mono">
                    {imp.filas_importadas}
                    <span className="muted"> / {imp.total_filas}</span>
                    {imp.filas_con_error > 0 && <small className="sub amt-out">{imp.filas_con_error} con error</small>}
                  </td>
                  <td>
                    {imp.anulada_en ? (
                      <span className="chip line">Anulada</span>
                    ) : imp.estado === 'completada' ? (
                      <span className="chip">Completada</span>
                    ) : (
                      <span className="chip warn">Con errores</span>
                    )}
                  </td>
                  {onAnular && (
                    <td className="num">
                      {imp.anulada_en ? null : confirmando === imp.id ? (
                        <span className="im-confirmar">
                          <span>¿Quitar sus {imp.filas_importadas} movimientos?</span>
                          <button type="button" className="btn btn-text btn-sm" onClick={() => setConfirmando(null)}>
                            No
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => {
                              setConfirmando(null)
                              onAnular(imp)
                            }}
                          >
                            Sí, anular
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="btn btn-text btn-sm" onClick={() => setConfirmando(imp.id)} title="Propuesto: anula todos los movimientos de esta importación">
                          <Icon name="undo" />
                          Anular
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ArchivoChip({ archivo }) {
  return (
    <span className="im-archivo im-archivo-chip">
      <Icon name="sheet" />
      <strong>{archivo.nombre}</strong>
      <span className="chip line">{archivo.tipo.toUpperCase()}</span>
    </span>
  )
}

function Cabecera({ eyebrow, titulo, bajada }) {
  return (
    <div className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{titulo}</h1>
        {bajada && <p className="muted">{bajada}</p>}
      </div>
    </div>
  )
}

