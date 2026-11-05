import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon'
import Seg from '../components/Seg'
import { api } from '../lib/api'
import { clpSigno, fechaCorta } from '../lib/format'
import {
  CAMPOS,
  COLUMNAS,
  campoDeEncabezado,
  MAX_FILAS,
  MAX_MB,
  descargarErrores,
  descargarPlantillaCsv,
  detectarEncabezado,
  detectarFormatos,
  ejemplos,
  faltantesMapeo,
  interpretar,
  leerArchivo,
  leerFecha,
  letraColumna,
  mapeoDesde,
  sugerirCategorias,
  valoresCategoria,
} from '../lib/importacion'
import { leerDb } from '../lib/proto'
import { useCategorias } from '../state/Categorias'
import { useMovimientos } from '../state/Movimientos'
import { useSesion } from '../state/Sesion'
import { useToast } from '../state/Toasts'
import './Importar.css'

// PROTOTIPO HU10 (importar CSV/XLSX) + HU11 (validar filas) + HU12 (revisar antes de confirmar)
// + HU13 (historial) + planillas propias (mapeo de columnas y formatos guardados).
// Pasos: elegir → validando → (mapear) → revisar → hecho.
//   · La plantilla de KontadorIA y los formatos ya guardados pasan directo a revisar.
//   · Una planilla propia nueva pasa por mapear: se confirman sus columnas una sola vez.
const PASOS = [
  ['leyendo', 'Abriendo la planilla'],
  ['estructura', 'Reconociendo las columnas'],
  ['filas', 'Validando cada fila'],
]
const plantillaXlsx = `${import.meta.env.BASE_URL}plantilla-kontadoria.xlsx`
const nuevoRequestId = () => crypto.randomUUID?.() ?? `r-${Date.now()}-${Math.random().toString(36).slice(2)}`
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

// "control-caja-el-fogon-10-2026.xlsx" → "Control caja el fogon"
const nombreSugerido = (archivo) => {
  const base = archivo
    .replace(/\.(csv|xlsx)$/i, '')
    .replace(/[-_ ]?\d{1,2}[-_]\d{4}$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return base ? base[0].toUpperCase() + base.slice(1) : 'Mi planilla'
}

export default function Importar() {
  const { recargar } = useMovimientos()
  const { puede } = useSesion()
  const { aviso } = useToast()
  const [etapa, setEtapa] = useState('elegir')
  const [paso, setPaso] = useState(null)
  const [archivo, setArchivo] = useState(null) // { nombre, tipo, hojas }
  const [analisis, setAnalisis] = useState(null) // { hoja, mapeo, plantilla, perfil, alias }
  const [res, setRes] = useState(null) // { filas, ignoradas, mapeo, hoja, perfil }
  const [hecha, setHecha] = useState(null)
  const [error, setError] = useState(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [historial, setHistorial] = useState(null)
  const [formatos, setFormatos] = useState(null)
  const requestId = useRef(null)
  const input = useRef(null)
  const listaEjemplos = useMemo(() => ejemplos(leerDb().movimientos), [])

  const cargarHistorial = useCallback(() => {
    if (puede('importaciones.ver')) api('/importaciones').then(setHistorial)
    api('/importaciones/perfiles').then(setFormatos)
  }, [puede])
  useEffect(cargarHistorial, [cargarHistorial])

  async function procesar(a) {
    setError(null)
    setArchivo(a)
    setEtapa('validando')
    setPaso('leyendo')
    await pausa(300)
    setPaso('estructura')
    const an = await api('/importaciones/analizar', { method: 'POST', body: { nombre: a.nombre, tipo: a.tipo, hojas: a.hojas } })
    setAnalisis(an)
    // Plantilla o formato ya guardado: directo a revisar. Planilla nueva: a confirmar columnas.
    if (an.plantilla || an.perfil) return validarCon(a, an.mapeo, an.hoja, an.perfil ? { id: an.perfil.id, nombre: an.perfil.nombre } : null)
    setEtapa('mapear')
  }

  async function validarCon(a, mapeo, hoja, perfil) {
    setEtapa('validando')
    setPaso('filas')
    const filas = a.hojas[hoja].filas
    const r = await api('/importaciones/validar', { method: 'POST', body: { nombre: a.nombre, tipo: a.tipo, filas, mapeo } })
    if (r.filas.length > MAX_FILAS) {
      setError(`La planilla tiene ${r.filas.length.toLocaleString('es-CL')} filas. El máximo es ${MAX_FILAS.toLocaleString('es-CL')}: divídela en dos archivos.`)
      return setEtapa('elegir')
    }
    if (!r.filas.length) {
      setError('Reconocimos las columnas, pero la planilla no trae ninguna fila con datos.')
      return setEtapa(mapeo.plantilla ? 'elegir' : 'mapear')
    }
    requestId.current = nuevoRequestId() // uno por vista previa: confirmar dos veces no duplica
    setRes({ ...r, mapeo, hoja, perfil })
    setEtapa('revisar')
  }

  async function elegirArchivo(f) {
    if (!f) return
    try {
      const { tipo, hojas } = await leerArchivo(f)
      procesar({ nombre: f.name, tipo, hojas })
    } catch (e) {
      setError(e.message)
    }
  }

  function volver() {
    setEtapa('elegir')
    setRes(null)
    setArchivo(null)
    setAnalisis(null)
    setPaso(null)
    if (input.current) input.current.value = ''
  }

  function cancelar() {
    volver()
    aviso('Importación cancelada: no se guardó nada')
  }

  // Desde la revisión: volver a las columnas con lo que se usó (también para un formato guardado)
  function cambiarColumnas() {
    setAnalisis((an) => ({ ...an, mapeo: res.mapeo, hoja: res.hoja, perfil: res.perfil }))
    setEtapa('mapear')
  }

  async function confirmar() {
    setGuardando(true)
    try {
      const imp = await api('/importaciones', {
        method: 'POST',
        body: {
          nombre: archivo.nombre,
          tipo: archivo.tipo,
          filas: archivo.hojas[res.hoja].filas,
          mapeo: res.mapeo,
          perfil: res.perfil,
          client_request_id: requestId.current,
        },
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

  async function olvidarFormato(f) {
    await api(`/importaciones/perfiles/${f.id}`, { method: 'DELETE' })
    cargarHistorial()
    aviso(`Formato «${f.nombre}» olvidado: la próxima vez se vuelven a elegir sus columnas`)
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

  if (etapa === 'mapear')
    return (
      <Mapeo
        archivo={archivo}
        analisis={analisis}
        error={error}
        onVolver={volver}
        onListo={(mapeo, hoja, perfil) => {
          setError(null)
          validarCon(archivo, mapeo, hoja, perfil)
        }}
      />
    )

  if (etapa === 'revisar')
    return (
      <Revision
        archivo={archivo}
        res={res}
        guardando={guardando}
        onConfirmar={confirmar}
        onCancelar={cancelar}
        onCambiarColumnas={res.mapeo.plantilla ? null : cambiarColumnas}
      />
    )

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
          {res?.perfil?.guardar && (
            <p className="im-recordado">
              <Icon name="check" />
              <span>
                Guardamos el formato <strong>«{res.perfil.nombre}»</strong>: la próxima planilla igual se importa sin elegir columnas.
              </span>
            </p>
          )}
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
      <Cabecera
        eyebrow="Importar planilla"
        titulo="Trae tus movimientos desde Excel"
        bajada="Con nuestra plantilla es inmediato. Si ya tienes tu propia planilla, súbela tal cual: reconocemos sus columnas y recordamos el formato."
      />
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
            Arrástrala aquí o elígela. La plantilla o la tuya, en CSV o XLSX de hasta {MAX_MB} MB y {MAX_FILAS.toLocaleString('es-CL')} filas.
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

      {formatos?.length > 0 && <Formatos lista={formatos} onOlvidar={olvidarFormato} />}

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
                  <span className={`chip ${ej.propia ? 'line' : ''}`}>{ej.propia ? 'Formato propio' : ej.tipo.toUpperCase()}</span>
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

// ---------------------------------------------------------------------------------------------
// Planilla propia: confirmar hoja, encabezado, columnas, cómo viene el monto y las categorías
// ---------------------------------------------------------------------------------------------

const MODOS = [
  { id: 'tipo', label: 'Una columna de monto y otra que dice ingreso o gasto' },
  { id: 'cargo_abono', label: 'Gastos e ingresos en columnas separadas (cargos y abonos)' },
  { id: 'signo', label: 'Una columna de monto: negativo es gasto, positivo es ingreso' },
  { id: 'fijo', label: 'Una columna de monto, y todas las filas son del mismo tipo' },
]
const CAMPOS_POR_MODO = { tipo: ['monto', 'tipo'], cargo_abono: ['cargo', 'abono'], signo: ['monto'], fijo: ['monto'] }

function Mapeo({ archivo, analisis, error, onVolver, onListo }) {
  const { categorias } = useCategorias()
  const { movs } = useMovimientos()
  const [hoja, setHoja] = useState(analisis.hoja)
  const [mapeo, setMapeo] = useState(analisis.mapeo)
  const [guardar, setGuardar] = useState(true)
  const [nombre, setNombre] = useState(() => analisis.perfil?.nombre ?? nombreSugerido(archivo.nombre))
  const filas = archivo.hojas[hoja].filas
  const ctx = useMemo(() => ({ categorias, alias: analisis.alias ?? {}, existentes: movs }), [categorias, analisis.alias, movs])

  // Columnas disponibles: las del encabezado y las que traen datos aunque no tengan nombre
  const encabezado = useMemo(() => filas[mapeo.encabezado] ?? [], [filas, mapeo.encabezado])
  const datos = useMemo(() => filas.slice(mapeo.encabezado + 1).filter((f) => f.some((c) => String(c ?? '').trim())), [filas, mapeo.encabezado])
  const ancho = useMemo(() => Math.max(encabezado.length, ...datos.slice(0, 50).map((f) => f.length)), [encabezado, datos])
  const columnas = useMemo(
    () =>
      Array.from({ length: ancho }, (_, i) => {
        const nombre = String(encabezado[i] ?? '').trim()
        let muestra = datos.map((f) => String(f[i] ?? '').trim()).find(Boolean)
        // Una fecha de Excel llega como número (46328): se muestra como fecha
        if (muestra && /^\d{5}(\.\d+)?$/.test(muestra) && campoDeEncabezado(nombre) === 'fecha') muestra = fechaCorta(leerFecha(muestra))
        return { i, nombre, muestra }
      }).filter((c) => c.nombre || c.muestra),
    [ancho, datos, encabezado],
  )

  const opcionesEncabezado = useMemo(
    () =>
      filas
        .slice(0, 30)
        .map((f, i) => ({ i, texto: f.map((c) => String(c ?? '').trim()).filter(Boolean).slice(0, 4).join(' · ') }))
        .filter((o) => o.texto),
    [filas],
  )

  const valores = useMemo(() => valoresCategoria(filas, mapeo), [filas, mapeo])
  const faltan = faltantesMapeo(mapeo)
  const vista = useMemo(() => (faltan.length ? null : interpretar(filas, mapeo, ctx)), [faltan.length, filas, mapeo, ctx])
  const sinAsignar = valores.filter((v) => !mapeo.catValores[v.clave])

  function cambiarHoja(h) {
    const f = archivo.hojas[h].filas
    const d = detectarEncabezado(f)
    setHoja(h)
    setMapeo(mapeoDesde(f, d.fila >= 0 ? d.fila : Math.max(0, f.findIndex((x) => x.some((c) => String(c ?? '').trim()))), ctx))
  }

  // Al cambiar una columna se recalculan los formatos y, si es la de categoría, sus valores
  function setCol(campo, i) {
    setMapeo((m) => {
      const cols = { ...m.cols }
      for (const k of Object.keys(cols)) if (cols[k] === i && i >= 0) cols[k] = -1 // una columna, un campo
      cols[campo] = i
      const nuevo = { ...m, cols, ...detectarFormatos(filas, { ...m, cols }) }
      if (campo === 'categoria') nuevo.catValores = { ...sugerirCategorias(valoresCategoria(filas, nuevo), ctx), ...m.catValores }
      return nuevo
    })
  }

  const set = (cambios) => setMapeo((m) => ({ ...m, ...cambios }))

  const selectColumna = (campo) => {
    const def = CAMPOS.find((c) => c.clave === campo)
    return (
      <div className="field" key={campo}>
        <label htmlFor={`col-${campo}`}>{def.nombre}</label>
        <select id={`col-${campo}`} className="input" value={mapeo.cols[campo]} onChange={(e) => setCol(campo, +e.target.value)} aria-invalid={campo === 'fecha' && mapeo.cols.fecha < 0}>
          <option value={-1}>— No está en mi planilla —</option>
          {columnas.map((c) => (
            <option key={c.i} value={c.i}>
              {letraColumna(c.i)} · {c.nombre || '(sin nombre)'}
              {c.muestra ? `  —  ej.: ${c.muestra.slice(0, 28)}` : ''}
            </option>
          ))}
        </select>
        <span className="hint">{def.ayuda}</span>
      </div>
    )
  }

  return (
    <>
      <Cabecera
        eyebrow="Tu planilla"
        titulo={analisis.reconocido === false ? 'Indícanos qué es cada columna' : 'Revisa cómo leímos tus columnas'}
        bajada="Lo haces una sola vez: guardamos el formato y la próxima planilla igual se importa directo. No se guarda ningún movimiento todavía."
      />
      <ArchivoChip archivo={archivo} />

      <div className="im-mapeo">
        <div className="im-mapeo-izq">
          <section className="card im-bloque">
            <h2>1. Dónde están los datos</h2>
            <div className="im-campos">
              {archivo.hojas.length > 1 && (
                <div className="field">
                  <label htmlFor="m-hoja">Hoja</label>
                  <select id="m-hoja" className="input" value={hoja} onChange={(e) => cambiarHoja(+e.target.value)}>
                    {archivo.hojas.map((h, i) => (
                      <option key={i} value={i}>
                        {h.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="m-enc">Fila con los nombres de las columnas</label>
                <select id="m-enc" className="input" value={mapeo.encabezado} onChange={(e) => setMapeo(mapeoDesde(filas, +e.target.value, ctx))}>
                  {opcionesEncabezado.map((o) => (
                    <option key={o.i} value={o.i}>
                      Fila {o.i + 1}: {o.texto.slice(0, 60)}
                    </option>
                  ))}
                </select>
                <span className="hint">Lo de arriba (títulos, logo, nombre del local) se ignora.</span>
              </div>
            </div>
          </section>

          <section className="card im-bloque">
            <h2>2. Qué es cada columna</h2>
            <div className="im-campos">
              {selectColumna('fecha')}
              {selectColumna('descripcion')}
              {selectColumna('proveedor')}
              {selectColumna('categoria')}
            </div>
          </section>

          <section className="card im-bloque">
            <h2>3. Cómo vienen los montos</h2>
            <div className="im-modos" role="radiogroup" aria-label="Cómo vienen los montos">
              {MODOS.map((m) => (
                <label key={m.id} className={`im-modo${mapeo.modo === m.id ? ' on' : ''}`}>
                  <input type="radio" name="modo" checked={mapeo.modo === m.id} onChange={() => set({ modo: m.id })} />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
            <div className="im-campos">
              {CAMPOS_POR_MODO[mapeo.modo].map(selectColumna)}
              {mapeo.modo === 'fijo' && (
                <div className="field">
                  <span className="label">Todas las filas son</span>
                  <Seg
                    label="Tipo de todas las filas"
                    valor={mapeo.tipoFijo}
                    onChange={(t) => set({ tipoFijo: t })}
                    opciones={[
                      { id: 'gasto', label: 'Gastos' },
                      { id: 'ingreso', label: 'Ingresos' },
                    ]}
                  />
                </div>
              )}
            </div>
            <details className="im-formatos">
              <summary>Formato de fechas y números</summary>
              <div className="im-campos">
                <div className="field">
                  <label htmlFor="m-fecha">Las fechas vienen como</label>
                  <select id="m-fecha" className="input" value={mapeo.fecha} onChange={(e) => set({ fecha: e.target.value })}>
                    <option value="dmy">Día / mes / año (05-10-2026)</option>
                    <option value="mdy">Mes / día / año (10-05-2026)</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="m-monto">Los montos vienen como</label>
                  <select id="m-monto" className="input" value={mapeo.monto} onChange={(e) => set({ monto: e.target.value })}>
                    <option value="cl">1.234.567 (punto para miles)</option>
                    <option value="us">1,234,567 (coma para miles)</option>
                  </select>
                </div>
              </div>
            </details>
          </section>

          <section className="card im-bloque">
            <h2>4. Tus categorías</h2>
            {mapeo.cols.categoria >= 0 ? (
              <>
                <p className="muted">
                  Asocia cada categoría de tu planilla con una de KontadorIA. Lo recordamos para las próximas.
                  {sinAsignar.length > 0 && (
                    <strong className="amt-out">
                      {' '}
                      {sinAsignar.length === 1 ? 'Falta 1 por asociar' : `Faltan ${sinAsignar.length} por asociar`}: esas filas quedarían con error.
                    </strong>
                  )}
                </p>
                <ul className="im-catmap">
                  {valores.map((v) => (
                    <li key={v.clave} className={mapeo.catValores[v.clave] ? '' : 'falta'}>
                      <span>
                        <strong>{v.texto}</strong>
                        <small className="muted">
                          {v.filas} {v.filas === 1 ? 'fila' : 'filas'}
                        </small>
                      </span>
                      <Icon name="out" />
                      <SelectCategoria
                        id={`cat-${v.clave}`}
                        valor={mapeo.catValores[v.clave] ?? ''}
                        vacio="Elegir…"
                        onChange={(id) => set({ catValores: { ...mapeo.catValores, [v.clave]: id || null } })}
                      />
                    </li>
                  ))}
                </ul>
                <p className="hint muted">Si una fila viene sin categoría, se usa la de abajo.</p>
              </>
            ) : (
              <p className="muted">Tu planilla no trae categoría. Si el proveedor ya tiene movimientos, usamos la categoría que usas con él; si no, estas:</p>
            )}
            <div className="im-campos">
              {['gasto', 'ingreso'].map((tipo) => (
                <div className="field" key={tipo}>
                  <label htmlFor={`def-${tipo}`}>{tipo === 'gasto' ? 'Gastos sin categoría' : 'Ingresos sin categoría'}</label>
                  <SelectCategoria
                    id={`def-${tipo}`}
                    tipo={tipo}
                    valor={mapeo.catDefecto?.[tipo] ?? ''}
                    vacio="Elegir…"
                    onChange={(id) => set({ catDefecto: { ...mapeo.catDefecto, [tipo]: id || null } })}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="im-mapeo-der">
          <section className="card im-bloque im-previa">
            <h2>Así quedarían</h2>
            {faltan.length ? (
              <ul className="im-faltan">
                {faltan.map((f) => (
                  <li key={f}>
                    <Icon name="x" />
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="muted">
                  <strong className="amt-in">{vista.filas.filter((f) => f.datos).length} listas</strong>
                  {' · '}
                  <strong className={vista.filas.some((f) => f.errores.length) ? 'amt-out' : ''}>{vista.filas.filter((f) => f.errores.length).length} con error</strong>
                  {vista.ignoradas.length > 0 && ` · ${vista.ignoradas.length} ignoradas (totales, saldos o títulos)`}
                </p>
                <ul className="im-previa-lista">
                  {vista.filas.slice(0, 6).map((f) => (
                    <PreviaFila key={f.n} fila={f} />
                  ))}
                </ul>
                {vista.filas.length > 6 && <p className="hint muted">y {vista.filas.length - 6} filas más en la revisión.</p>}
              </>
            )}
            <p className="im-tip">
              <Icon name="spark" />
              <span>
                ¿Empiezas una planilla nueva? La{' '}
                <a href={plantillaXlsx} download>
                  plantilla de KontadorIA
                </a>{' '}
                se importa sin este paso.
              </span>
            </p>
          </section>
        </aside>
      </div>

      <div className="im-barra">
        <label className="im-recordar">
          <input type="checkbox" checked={guardar} onChange={(e) => setGuardar(e.target.checked)} />
          <span>{analisis.perfil ? 'Actualizar el formato' : 'Recordar este formato como'}</span>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!guardar} aria-label="Nombre del formato" maxLength={60} />
        </label>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <div className="im-acts">
          <button type="button" className="btn btn-ghost" onClick={onVolver}>
            Volver
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={faltan.length > 0}
            onClick={() => onListo(mapeo, hoja, { id: guardar ? (analisis.perfil?.id ?? null) : null, guardar, nombre: nombre.trim() || 'Mi planilla' })}
          >
            <Icon name="check" />
            Revisar las filas
          </button>
        </div>
      </div>
    </>
  )
}

function SelectCategoria({ id, valor, onChange, tipo, vacio }) {
  const { categorias } = useCategorias()
  const grupo = (t) => categorias.filter((c) => c.tipo === t && !c.oculta)
  return (
    <select id={id} className="input" value={valor} onChange={(e) => onChange(e.target.value)} aria-invalid={!valor}>
      <option value="">{vacio}</option>
      {(tipo ? [tipo] : ['gasto', 'ingreso']).map((t) => (
        <optgroup key={t} label={t === 'gasto' ? 'Gastos' : 'Ingresos'}>
          {grupo(t).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function PreviaFila({ fila: f }) {
  const { categoria } = useCategorias()
  const c = f.datos && categoria(f.datos.categoria_id)
  return (
    <li className={f.errores.length ? 'mal' : ''}>
      <div className="im-lista-top">
        <span className="mono muted">
          Fila {f.n} · {f.datos ? fechaCorta(f.datos.fecha) : f.valores.fecha || '—'}
        </span>
        <span className={`mono ${f.datos ? (f.datos.tipo === 'ingreso' ? 'amt-in' : 'amt-out') : 'muted'}`}>{f.datos ? clpSigno(f.datos.monto, f.datos.tipo) : f.valores.monto || '—'}</span>
      </div>
      <strong>{f.datos?.descripcion || f.valores.descripcion || 'Sin descripción'}</strong>
      {c ? (
        <span className="cat-chip" style={{ '--c': c.color }}>
          <span className="dot" />
          {c.nombre}
        </span>
      ) : null}
      {f.errores.length > 0 && <Estado fila={f} />}
    </li>
  )
}

// ---------------------------------------------------------------------------------------------
// HU11 + HU12: resumen, filas con su estado y confirmar o cancelar
// ---------------------------------------------------------------------------------------------
function Revision({ archivo, res, guardando, onConfirmar, onCancelar, onCambiarColumnas }) {
  const { categoria } = useCategorias()
  const { filas, ignoradas = [], mapeo, hoja, perfil } = res
  const [filtro, setFiltro] = useState(() => (filas.some((f) => f.errores.length) ? 'error' : 'todas'))
  const validas = filas.filter((f) => f.datos)
  const conError = filas.length - validas.length
  const avisos = validas.filter((f) => f.aviso).length
  const suma = (tipo) => validas.filter((f) => f.datos.tipo === tipo).reduce((s, f) => s + f.datos.monto, 0)
  const vistas = filas.filter((f) => (filtro === 'error' ? f.errores.length : filtro === 'validas' ? f.datos : true))
  const encabezado = archivo.hojas[hoja].filas[mapeo.encabezado] ?? []

  return (
    <>
      <Cabecera eyebrow="Revisión" titulo="Revisa antes de importar" bajada="Solo se guardan las filas sin errores, y solo cuando confirmes." />
      <div className="im-rev-top">
        <ArchivoChip archivo={archivo} />
        {mapeo.plantilla ? (
          <span className="chip">Plantilla KontadorIA</span>
        ) : (
          <span className="im-formato">
            <Icon name="sheet" />
            {perfil?.id && !perfil.guardar ? (
              <span>
                Reconocimos tu formato <strong>«{perfil.nombre}»</strong>
              </span>
            ) : (
              <span>Formato propio{perfil?.guardar ? ` · se guardará como «${perfil.nombre}»` : ''}</span>
            )}
            {onCambiarColumnas && (
              <button type="button" className="btn btn-text btn-sm" onClick={onCambiarColumnas}>
                <Icon name="pen" />
                Cambiar columnas
              </button>
            )}
          </span>
        )}
      </div>

      <div className="im-tiles">
        <div className="card im-tile">
          <span>Filas en el archivo</span>
          <strong className="mono">{filas.length}</strong>
          {ignoradas.length > 0 && <small>+ {ignoradas.length} ignoradas</small>}
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
            Descárgalas con su motivo (en tus mismas columnas), corrígelas y vuelve a subirlas.
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => descargarErrores(archivo.nombre, filas, encabezado)}>
            <Icon name="in" />
            Descargar filas con error
          </button>
        </div>
      )}

      {ignoradas.length > 0 && (
        <details className="card im-ignoradas">
          <summary>
            {ignoradas.length === 1 ? '1 fila ignorada' : `${ignoradas.length} filas ignoradas`}: totales, saldos o títulos que no son movimientos
          </summary>
          <ul>
            {ignoradas.map((x) => (
              <li key={x.n}>
                <span className="mono muted">Fila {x.n}</span> {x.motivo}
                {x.texto && <span className="muted"> · {x.texto}</span>}
              </li>
            ))}
          </ul>
        </details>
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
                    <strong>{f.datos?.descripcion || f.valores.descripcion || <span className="muted">Sin descripción</span>}</strong>
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
                    {c && f.valores.categoria && normalizarSimple(f.valores.categoria) !== normalizarSimple(c.nombre) && <small className="sub">en tu planilla: {f.valores.categoria}</small>}
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
            <strong>{f.datos?.descripcion || f.valores.descripcion || 'Sin descripción'}</strong>
            <small className="muted">
              {[f.valores.fecha, f.datos ? categoria(f.datos.categoria_id).nombre : f.valores.categoria, f.valores.proveedor].filter(Boolean).join(' · ')}
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

const normalizarSimple = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

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
      <span>
        Lista
        {fila.nota && <small className="im-nota">{fila.nota}</small>}
      </span>
    </span>
  )
}

// HU10: la plantilla con sus columnas fijas (camino recomendado)
function Plantilla() {
  const { categorias } = useCategorias()
  const visibles = categorias.filter((c) => !c.oculta)
  return (
    <div className="card im-plantilla">
      <div className="im-plantilla-head">
        <h2>Usa la plantilla</h2>
        <span className="chip">Recomendada</span>
      </div>
      <p className="muted">Se importa directo, sin configurar nada. Seis columnas; la primera fila es el encabezado.</p>
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
      <p className="hint muted">¿Ya llevas tu propia planilla? Súbela igual: la reconocemos.</p>
    </div>
  )
}

// Formatos propios guardados por la empresa
function Formatos({ lista, onOlvidar }) {
  const [confirmando, setConfirmando] = useState(null)
  return (
    <section className="im-formatos-guardados">
      <div className="card-head">
        <h2>Tus formatos guardados</h2>
        <span className="muted">Una planilla con estas columnas se importa sin elegirlas de nuevo</span>
      </div>
      <ul>
        {lista.map((f) => (
          <li key={f.id} className="card">
            <span className="im-formato-ic">
              <Icon name="sheet" />
            </span>
            <span className="im-formato-txt">
              <strong>{f.nombre}</strong>
              <small className="muted">
                {f.huella.split('|').slice(0, 5).join(' · ')}
                {f.huella.split('|').length > 5 ? ' …' : ''}
              </small>
              <small className="muted">
                Usado {f.usos} {f.usos === 1 ? 'vez' : 'veces'} · creado por {f.creado_por}
              </small>
            </span>
            {confirmando === f.id ? (
              <span className="im-confirmar">
                <button type="button" className="btn btn-text btn-sm" onClick={() => setConfirmando(null)}>
                  No
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    setConfirmando(null)
                    onOlvidar(f)
                  }}
                >
                  Sí, olvidar
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-text btn-sm" onClick={() => setConfirmando(f.id)}>
                <Icon name="trash" />
                Olvidar
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
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
                    {imp.formato && <small className="sub muted">{imp.formato}</small>}
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
