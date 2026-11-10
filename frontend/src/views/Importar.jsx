import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon'
import Seg from '../components/Seg'
import { api } from '../lib/api'
import { clpSigno, fechaCorta } from '../lib/format'
import {
  CAMPOS,
  COLUMNAS,
  MAX_FILAS,
  MAX_MB,
  SIN_RESULTADO,
  aliasNuevos,
  analizar,
  descargarErrores,
  descargarPlantillaCsv,
  detectarEncabezado,
  detectarFormatos,
  faltantesMapeo,
  huella,
  interpretarHojas,
  leerArchivo,
  letraColumna,
  mapeoDesde,
  muestras,
  nombreSugerido,
  normalizar,
  rechazo,
  sugerirCategorias,
  valoresCategoria,
} from '../lib/importacion'
import { useCategorias } from '../state/Categorias'
import { useMovimientos } from '../state/Movimientos'
import { useSesion } from '../state/Sesion'
import { useToast } from '../state/Toasts'
import './Importar.css'

// HU10–HU13 + planillas propias. Motor híbrido (09-11-2026): leer, reconocer columnas y validar
// para la vista previa corre aquí, en el navegador, con lib/importacion.js; el archivo no sale del
// computador. Al confirmar, POST /importaciones recibe solo las filas y el backend las revalida.
// Tres pasos visibles (Subir → Revisar → Listo). El mapeo de columnas aparece solo si falta la
// fecha o el monto, o si se adivinaron por los datos; si no, la revisión muestra "Así entendimos
// tu planilla" y un botón para cambiar las columnas.
//   etapa: subir → analizando → (mapear) → validando → revisar → listo
const PASOS = ['Subir', 'Revisar', 'Listo']
const pasoDe = { subir: 0, analizando: 0, mapear: 1, validando: 1, revisar: 1, listo: 2 }
const plantillaXlsx = `${import.meta.env.BASE_URL}plantilla-kontadoria.xlsx`
const nuevoRequestId = () => crypto.randomUUID?.() ?? `r-${Date.now()}-${Math.random().toString(36).slice(2)}`
const seleccionDe = (sel) => [sel.hoja, ...(sel.incluirMismas ? sel.mismas : [])]
const plural = (n, uno, varios) => `${n.toLocaleString('es-CL')} ${n === 1 ? uno : varios}`

// SHA-256 del archivo (trazabilidad, HU13). crypto.subtle existe en HTTPS y localhost; sin él, null.
async function sha256(archivo) {
  if (!crypto.subtle) return null
  const hash = await crypto.subtle.digest('SHA-256', await archivo.arrayBuffer())
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Deja que React pinte "Leyendo…" antes del trabajo pesado del motor (corre en este hilo)
const respirar = () => new Promise((r) => setTimeout(r, 30))

export default function Importar({ onEtapa, incrustado = false }) {
  const { movs, recargar } = useMovimientos()
  const { categorias } = useCategorias()
  const { puede } = useSesion()
  const { aviso } = useToast()
  const [etapa, setEtapa] = useState('subir')
  // Para Subir (celular): el selector boleta/planilla se esconde mientras hay algo en curso
  useEffect(() => onEtapa?.(etapa), [etapa, onEtapa])
  const [archivo, setArchivo] = useState(null) // { nombre, tipo, hojas, avisos }
  const [analisis, setAnalisis] = useState(null)
  const [mapeo, setMapeo] = useState(null)
  const [sel, setSel] = useState(null) // { hoja, mismas, incluirMismas, incluirOcultas }
  const [perfil, setPerfil] = useState(null) // { id, nombre, guardar, reconocido } (null = plantilla)
  const [res, setRes] = useState(null) // { filas, ignoradas, saldos, combinadas }
  const [excluidas, setExcluidas] = useState(() => new Set())
  const [actualizando, setActualizando] = useState(false)
  const [hecha, setHecha] = useState(null)
  const [problema, setProblema] = useState(null) // { titulo, mensaje }
  const [arrastrando, setArrastrando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [historial, setHistorial] = useState(null)
  const [formatos, setFormatos] = useState(null)
  const [alias, setAlias] = useState({}) // categorías de planilla ya asociadas: { bencina: id }
  const requestId = useRef(null)
  const input = useRef(null)

  const cargarHistorial = useCallback(() => {
    if (puede('importaciones.ver')) api('/importaciones').then(setHistorial).catch(() => setHistorial([]))
    api('/importaciones/formatos').then(setFormatos).catch(() => setFormatos([]))
    api('/importaciones/alias').then(setAlias).catch(() => {})
  }, [puede])
  useEffect(cargarHistorial, [cargarHistorial])

  // Lo que el motor necesita saber de la empresa: categorías (con las ocultas marcadas), formatos
  // recordados, categorías asociadas y los movimientos que ya existen (para marcar repetidos)
  const ctxMotor = () => ({ categorias, alias, perfiles: formatos ?? [], existentes: movs })

  const fallar = (titulo, mensaje) => {
    setProblema({ titulo, mensaje })
    setEtapa('subir')
  }

  async function procesar(a) {
    setProblema(null)
    setArchivo(a)
    setEtapa('analizando')
    await respirar()
    const an = { ...analizar(a.hojas, ctxMotor()), alias }
    if (an.libroDiario) {
      const e = rechazo('libro_diario')
      return fallar(e.titulo, e.message)
    }
    aplicarAnalisis(an, a, null)
  }

  function aplicarAnalisis(an, a, perfilActual) {
    setAnalisis(an)
    const s = { hoja: an.hoja, mismas: an.mismas, incluirMismas: true, incluirOcultas: false }
    const p = an.plantilla
      ? null
      : an.perfil
        ? { id: an.perfil.id, nombre: an.perfil.nombre, guardar: false, reconocido: true }
        : (perfilActual ?? { id: null, nombre: nombreSugerido(a.nombre), guardar: true })
    setPerfil(p)
    setMapeo(an.mapeo)
    setSel(s)
    if (an.requiereMapeo) return setEtapa('mapear')
    validar(a, an.mapeo, s, { nuevo: true })
  }

  async function validar(a, m, s, { nuevo = false } = {}) {
    if (nuevo) setEtapa('validando')
    else setActualizando(true)
    try {
      if (faltantesMapeo(m).length) return fallar('Faltan columnas por elegir', 'Indica cuál es la fecha y cuál el monto.')
      await respirar()
      const r = interpretarHojas(a.hojas, seleccionDe(s), m, { ...ctxMotor(), incluirOcultas: Boolean(s.incluirOcultas) })
      if (r.filas.length > MAX_FILAS)
        return fallar('La planilla tiene demasiadas filas', `Trae ${r.filas.length.toLocaleString('es-CL')} movimientos y el máximo es ${MAX_FILAS.toLocaleString('es-CL')}. Divídela en dos archivos.`)
      if (!r.filas.length && !r.ignoradas.length) return fallar('No encontramos movimientos en el archivo', 'Reconocimos las columnas, pero no hay ninguna fila con datos debajo del encabezado.')
      if (r.filas.length && r.filas.filter((f) => f.errores.includes(SIN_RESULTADO)).length > r.filas.length / 2) {
        const e = rechazo('formulas')
        return fallar(e.titulo, e.message)
      }
      // Los duplicados exactos (ya importados) quedan fuera por defecto; lo que el usuario marcó o
      // desmarcó se respeta al revalidar (al asociar una categoría, incluir ocultas, etc.)
      setExcluidas((prev) => {
        const antes = new Set(nuevo ? [] : (res?.filas ?? []).map((f) => f.key))
        const sig = new Set(nuevo ? [] : [...prev].filter((k) => r.filas.some((f) => f.key === k)))
        for (const f of r.filas) if (f.duplicado === 'exacto' && !antes.has(f.key)) sig.add(f.key)
        return sig
      })
      if (nuevo) requestId.current = nuevoRequestId() // uno por vista previa: confirmar dos veces no duplica
      setMapeo(m)
      setSel(s)
      setRes(r)
      setEtapa('revisar')
    } finally {
      setActualizando(false)
    }
  }

  async function elegirArchivo(f) {
    if (!f) return
    setProblema(null)
    try {
      const [{ tipo, hojas, avisos }, hash] = await Promise.all([leerArchivo(f), sha256(f).catch(() => null)])
      procesar({ nombre: f.name, tipo, hojas, avisos, sha256: hash })
    } catch (e) {
      setArchivo({ nombre: f.name, tipo: f.name.split('.').pop() || '?', hojas: [] })
      fallar(e.titulo ?? 'No pudimos leer el archivo', e.message)
    }
    if (input.current) input.current.value = ''
  }

  function volver() {
    setEtapa('subir')
    setRes(null)
    setArchivo(null)
    setAnalisis(null)
    setMapeo(null)
    setSel(null)
    setPerfil(null)
    setProblema(null)
  }

  function cancelar() {
    volver()
    aviso('Importación cancelada: no se guardó nada')
  }

  async function cambiarHoja(h) {
    const an = { ...analizar(archivo.hojas, { ...ctxMotor(), forzarHoja: h }), alias }
    if (an.libroDiario) {
      const e = rechazo('libro_diario')
      return fallar(e.titulo, e.message)
    }
    aplicarAnalisis(an, archivo, perfil)
  }

  const asociar = (clave, id) => validar(archivo, { ...mapeo, catValores: { ...mapeo.catValores, [clave]: id || null } }, sel)

  async function confirmar() {
    setGuardando(true)
    try {
      const imp = await api('/importaciones', { method: 'POST', body: cuerpoImportacion() })
      await recargar()
      cargarHistorial()
      setHecha(imp)
      setEtapa('listo')
      aviso(`${imp.filas_importadas} movimientos importados`, { festejo: true })
    } catch (e) {
      aviso(e.message, { error: true })
    } finally {
      setGuardando(false)
    }
  }

  // Lo que viaja al backend: solo las filas válidas que no se excluyeron, ya interpretadas, y los
  // conteos de la revisión. El backend vuelve a validar todo (no confía en el navegador).
  function cuerpoImportacion() {
    const filas = res.filas
      .filter((f) => f.datos && !excluidas.has(f.key))
      .map((f) => ({ n: f.n, ...f.datos, huella: f.huella }))
    let formato = null
    if (!mapeo.plantilla) {
      const principal = archivo.hojas[seleccionDe(sel)[0]]
      // Las categorías se recuerdan aparte (alias, para toda la empresa) y el encabezado se busca
      // por la huella: no van en el formato
      // eslint-disable-next-line no-unused-vars
      const { catValores, encabezado, origen, ambiguo, ...config } = mapeo
      formato = {
        id: perfil?.id ?? null,
        guardar: Boolean(perfil?.guardar),
        nombre: perfil?.nombre?.trim() || null,
        huella: huella(principal.filas[mapeo.encabezado]),
        mapeo: config,
      }
    }
    return {
      client_request_id: requestId.current,
      nombre_archivo: archivo.nombre,
      tipo_archivo: archivo.tipo,
      archivo_sha256: archivo.sha256 ?? null,
      total_filas: res.filas.length,
      filas_con_error: res.filas.filter((f) => !f.datos).length,
      filas_omitidas: res.ignoradas.length,
      filas,
      formato,
      alias: aliasNuevos(mapeo, categorias),
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
      aviso(e.message, { error: true })
    }
  }

  async function olvidarFormato(f) {
    await api(`/importaciones/formatos/${f.id}`, { method: 'DELETE' })
    cargarHistorial()
    aviso(`Formato «${f.nombre}» olvidado: la próxima vez se vuelven a reconocer sus columnas`)
  }

  const paso = pasoDe[etapa]
  const titulo = {
    subir: 'Sube tu planilla tal como la tienes',
    analizando: 'Leyendo tu planilla…',
    mapear: 'Indícanos qué es cada columna',
    validando: 'Revisando cada fila…',
    revisar: 'Revisa antes de importar',
    listo: hecha ? `Se ${hecha.filas_importadas === 1 ? 'importó 1 movimiento' : `importaron ${hecha.filas_importadas.toLocaleString('es-CL')} movimientos`}` : '',
  }[etapa]

  return (
    <>
      <Stepper actual={paso} />
      <Cabecera
        clave={etapa}
        titulo={titulo}
        bajada={
          etapa === 'subir'
            ? 'Excel o CSV, sin adaptarla. Revisas todo antes de guardar.'
            : etapa === 'mapear'
              ? 'Elige la fecha y el monto. La próxima vez la reconocemos sola.'
              : null
        }
      />

      {/* Dentro de Cargar (celular): la revisión de una planilla larga pesa en pantalla chica */}
      {incrustado && etapa === 'subir' && (
        <p className="im-nota-movil">
          <Icon name="sheet" />
          Con muchas filas, la revisión es más cómoda en el computador.
        </p>
      )}

      {(etapa === 'analizando' || etapa === 'validando') && (
        <div className="card im-cargando" role="status" aria-live="polite">
          <span className="spinner" />
          <span>
            <strong>{etapa === 'analizando' ? 'Reconociendo la hoja, el encabezado y las columnas' : 'Validando cada fila'}</strong>
          </span>
          {archivo && <ArchivoChip archivo={archivo} />}
        </div>
      )}

      {etapa === 'mapear' && (
        <Mapeo
          archivo={archivo}
          analisis={analisis}
          mapeoInicial={mapeo}
          selInicial={sel}
          perfilInicial={perfil}
          onVolver={res ? () => setEtapa('revisar') : volver}
          onListo={(m, s, p) => {
            setPerfil(p)
            validar(archivo, m, s, { nuevo: true })
          }}
        />
      )}

      {etapa === 'revisar' && (
        <Revision
          archivo={archivo}
          analisis={analisis}
          mapeo={mapeo}
          sel={sel}
          res={res}
          perfil={perfil}
          excluidas={excluidas}
          actualizando={actualizando}
          guardando={guardando}
          onPerfil={setPerfil}
          onCambiarHoja={cambiarHoja}
          onSel={(cambios) => validar(archivo, mapeo, { ...sel, ...cambios })}
          onAsociar={asociar}
          onExcluir={(key, fuera) =>
            setExcluidas((prev) => {
              const sig = new Set(prev)
              if (fuera) sig.add(key)
              else sig.delete(key)
              return sig
            })
          }
          onCambiarColumnas={() => setEtapa('mapear')}
          onConfirmar={confirmar}
          onCancelar={cancelar}
        />
      )}

      {etapa === 'listo' && <Listo hecha={hecha} res={res} archivo={archivo} mapeo={mapeo} sel={sel} perfil={perfil} onOtra={volver} />}

      {etapa === 'subir' && (
        <>
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
              <h2>
                <span className="solo-pc">Arrástrala aquí o elígela</span>
                <span className="solo-movil">Elige tu planilla</span>
              </h2>
              <p className="muted">
                Hasta {MAX_MB} MB y {MAX_FILAS.toLocaleString('es-CL')} movimientos.
              </p>
              <button type="button" className="btn btn-primary" onClick={() => input.current.click()}>
                <Icon name="plus" />
                Elegir archivo
              </button>
              <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => elegirArchivo(e.target.files[0])} />
            </div>
            <Plantilla />
          </div>

          {problema && (
            <div className="card im-rechazo" role="alert">
              <span className="im-rechazo-ic">
                <Icon name="x" />
              </span>
              <div>
                <h2>{problema.titulo}</h2>
                <p>{problema.mensaje}</p>
                {archivo && <small className="muted mono">{archivo.nombre}</small>}
              </div>
            </div>
          )}

          {formatos?.length > 0 && <Formatos lista={formatos} onOlvidar={olvidarFormato} />}


          <Historial lista={historial} onAnular={puede('importaciones.anular') ? anular : null} />
        </>
      )}
      {etapa === 'listo' && <Historial lista={historial} onAnular={puede('importaciones.anular') ? anular : null} resaltar={hecha?.id} />}
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Pasos visibles y cabecera (el foco pasa al título en cada paso)
// ---------------------------------------------------------------------------------------------

function Stepper({ actual }) {
  return (
    <ol className="im-stepper" aria-label="Pasos de la importación">
      {PASOS.map((p, i) => (
        <li key={p} className={i < actual ? 'ok' : i === actual ? 'actual' : ''} aria-current={i === actual ? 'step' : undefined}>
          <span className="im-step-ic">{i < actual ? <Icon name="check" /> : i + 1}</span>
          {p}
        </li>
      ))}
    </ol>
  )
}

function Cabecera({ titulo, bajada, clave }) {
  const h1 = useRef(null)
  useEffect(() => {
    h1.current?.focus({ preventScroll: true })
  }, [clave])
  return (
    <div className="page-head">
      <div>
        <h1 ref={h1} tabIndex={-1}>
          {titulo}
        </h1>
        {bajada && <p className="muted">{bajada}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Mapeo mínimo: solo lo necesario a la vista (fecha, monto, descripción); el resto, plegado
// ---------------------------------------------------------------------------------------------

const MODOS = [
  { id: 'signo', label: 'Una columna con signo', ayuda: 'Negativo es gasto, positivo es ingreso' },
  { id: 'cargo_abono', label: 'Columnas separadas de gastos e ingresos', ayuda: 'Como cargos y abonos de una cartola' },
  { id: 'tipo', label: 'Una columna de monto y otra que dice si es gasto o ingreso' },
  { id: 'fijo-gasto', label: 'Todo es gasto' },
  { id: 'fijo-ingreso', label: 'Todo es ingreso' },
]
const modoUi = (m) => (m.modo === 'fijo' ? `fijo-${m.tipoFijo}` : m.modo)
const CAMPOS_POR_MODO = { signo: ['monto'], cargo_abono: ['cargo', 'abono'], tipo: ['monto', 'tipo'], 'fijo-gasto': ['monto'], 'fijo-ingreso': ['monto'] }
const revisar = (origen) => origen === 'parecido' || origen === 'datos'

function Mapeo({ archivo, analisis, mapeoInicial, selInicial, perfilInicial, onVolver, onListo }) {
  const { categorias } = useCategorias()
  const { movs } = useMovimientos()
  const [sel, setSel] = useState(selInicial)
  const [mapeo, setMapeo] = useState(mapeoInicial)
  const [perfil, setPerfil] = useState(perfilInicial ?? { id: null, nombre: nombreSugerido(archivo.nombre), guardar: true })
  const filas = archivo.hojas[sel.hoja].filas
  const ctx = useMemo(() => ({ categorias, alias: analisis.alias ?? {}, existentes: movs }), [categorias, analisis.alias, movs])
  const encabezado = useMemo(() => filas[mapeo.encabezado] ?? [], [filas, mapeo.encabezado])
  const columnas = useMemo(() => {
    const datos = filas.slice(mapeo.encabezado + 1, mapeo.encabezado + 60).filter(Boolean)
    const ancho = Math.max(encabezado.length, ...datos.map((f) => f.length))
    return Array.from({ length: ancho }, (_, i) => ({ i, nombre: String(encabezado[i] ?? '').trim(), tiene: datos.some((f) => String(f[i] ?? '').trim()) })).filter((c) => c.nombre || c.tiene)
  }, [filas, mapeo.encabezado, encabezado])
  const opcionesEncabezado = useMemo(
    () =>
      filas
        .slice(0, 30)
        .map((f, i) => ({ i, texto: (f ?? []).map((c) => String(c ?? '').trim()).filter(Boolean).slice(0, 4).join(' · ') }))
        .filter((o) => o.texto),
    [filas],
  )
  const faltan = faltantesMapeo(mapeo)
  const ambiguo = mapeo.ambiguo ?? {}

  function cambiarHoja(h) {
    const f = archivo.hojas[h].filas
    const d = detectarEncabezado(f)
    setSel({ ...sel, hoja: h, mismas: [] })
    setMapeo(mapeoDesde(f, d.fila >= 0 ? d.fila : Math.max(0, f.findIndex((x) => x?.some((c) => String(c ?? '').trim()))), ctx))
  }

  function setCol(campo, i) {
    setMapeo((m) => {
      const cols = { ...m.cols }
      for (const k of Object.keys(cols)) if (cols[k] === i && i >= 0) cols[k] = -1 // una columna, un campo
      cols[campo] = i
      const { ambiguo: a, ...formatos } = detectarFormatos(filas, { ...m, cols })
      const nuevo = { ...m, cols, ...formatos, ambiguo: a, origen: { ...m.origen, [campo]: 'manual' } }
      if (campo === 'categoria') nuevo.catValores = { ...sugerirCategorias(valoresCategoria(filas, nuevo), ctx), ...m.catValores }
      return nuevo
    })
  }

  const set = (cambios) => setMapeo((m) => ({ ...m, ...cambios }))
  const setModo = (id) => set(id.startsWith('fijo-') ? { modo: 'fijo', tipoFijo: id.slice(5) } : { modo: id })

  const selectColumna = (campo, { opcional = false } = {}) => {
    const def = CAMPOS.find((c) => c.clave === campo)
    const ej = muestras(filas, mapeo.encabezado, mapeo.cols[campo], 3, { fecha: campo === 'fecha' })
    const dudoso = mapeo.cols[campo] >= 0 && revisar(mapeo.origen?.[campo])
    return (
      <div className="field" key={campo}>
        <label htmlFor={`col-${campo}`}>
          Columna para {def.nombre.toLowerCase()}
          {dudoso && <span className="im-revisa">Revisa esto</span>}
        </label>
        <select
          id={`col-${campo}`}
          className="input"
          value={mapeo.cols[campo]}
          onChange={(e) => setCol(campo, +e.target.value)}
          aria-invalid={!opcional && mapeo.cols[campo] < 0}
        >
          <option value={-1}>{opcional ? '— No está en mi planilla —' : 'Elegir…'}</option>
          {columnas.map((c) => (
            <option key={c.i} value={c.i}>
              {letraColumna(c.i)} · {c.nombre || '(sin nombre)'}
            </option>
          ))}
        </select>
        {ej.length > 0 ? <Muestras valores={ej} /> : <span className="hint">{def.ayuda}</span>}
      </div>
    )
  }

  const formatosUi = (
    <div className="im-campos">
      <div className="field">
        <label htmlFor="m-fecha">
          Las fechas vienen como{ambiguo.fecha && <span className="im-revisa">Revisa esto</span>}
        </label>
        <select id="m-fecha" className="input" value={mapeo.fecha} onChange={(e) => set({ fecha: e.target.value })}>
          <option value="dmy">Día / mes / año (05-10-2026)</option>
          <option value="mdy">Mes / día / año (10-05-2026)</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="m-monto">
          Los montos vienen como{ambiguo.monto && <span className="im-revisa">Revisa esto</span>}
        </label>
        <select id="m-monto" className="input" value={mapeo.monto} onChange={(e) => set({ monto: e.target.value })}>
          <option value="cl">1.234.567 (punto para miles)</option>
          <option value="us">1,234,567 (coma para miles)</option>
        </select>
      </div>
    </div>
  )

  return (
    <>
      <ArchivoChip archivo={archivo} />
      <div className="im-mapeo-min">
        <section className="card im-bloque">
          <h2>Lo necesario</h2>
          <div className="im-campos">{selectColumna('fecha')}</div>

          <fieldset className="im-modos">
            <legend>¿Cómo vienen los montos?</legend>
            {MODOS.map((m) => (
              <label key={m.id} className={`im-modo${modoUi(mapeo) === m.id ? ' on' : ''}`}>
                <input type="radio" name="modo" checked={modoUi(mapeo) === m.id} onChange={() => setModo(m.id)} />
                <span>
                  {m.label}
                  {m.ayuda && <small className="muted">{m.ayuda}</small>}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="im-campos">{CAMPOS_POR_MODO[modoUi(mapeo)].map((c) => selectColumna(c))}</div>

          <div className="im-campos">{selectColumna('descripcion', { opcional: true })}</div>
          <p className="hint muted">La descripción es recomendada. Si no hay, usamos el proveedor o la categoría.</p>

          {(ambiguo.fecha || ambiguo.monto) && (
            <>
              <p className="im-nota-ambigua">
                <Icon name="spark" />
                No pudimos saber el formato de tus {ambiguo.fecha && ambiguo.monto ? 'fechas y montos' : ambiguo.fecha ? 'fechas' : 'montos'}: confírmalo.
              </p>
              {formatosUi}
            </>
          )}
        </section>

        <details className="card im-bloque im-mas">
          <summary>Más opciones (opcional)</summary>
          <div className="im-campos">
            {selectColumna('categoria', { opcional: true })}
            {selectColumna('proveedor', { opcional: true })}
            {(mapeo.modo === 'cargo_abono' || mapeo.modo === 'signo') && selectColumna('saldo', { opcional: true })}
          </div>
          <div className="im-campos">
            {archivo.hojas.length > 1 && (
              <div className="field">
                <label htmlFor="m-hoja">Hoja</label>
                <select id="m-hoja" className="input" value={sel.hoja} onChange={(e) => cambiarHoja(+e.target.value)}>
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
            </div>
          </div>
          <div className="im-campos">
            {['gasto', 'ingreso'].map((tipo) => (
              <div className="field" key={tipo}>
                <label htmlFor={`def-${tipo}`}>{tipo === 'gasto' ? 'Categoría para gastos sin categoría' : 'Categoría para ingresos sin categoría'}</label>
                <SelectCategoria id={`def-${tipo}`} tipo={tipo} valor={mapeo.catDefecto?.[tipo] ?? ''} vacio="Elegir…" onChange={(id) => set({ catDefecto: { ...mapeo.catDefecto, [tipo]: id || null } })} />
              </div>
            ))}
          </div>
          {!(ambiguo.fecha || ambiguo.monto) && formatosUi}
        </details>
      </div>

      <div className="im-barra">
        <RecordarFormato perfil={perfil} onPerfil={setPerfil} />
        {faltan.length > 0 && (
          <p className="err" role="alert">
            {faltan.join(' ')}
          </p>
        )}
        <div className="im-acts">
          <button type="button" className="btn btn-ghost" onClick={onVolver}>
            Volver
          </button>
          <button type="button" className="btn btn-primary" disabled={faltan.length > 0} onClick={() => onListo(mapeo, sel, perfil)}>
            <Icon name="check" />
            Revisar las filas
          </button>
        </div>
      </div>
    </>
  )
}

function Muestras({ valores }) {
  return (
    <span className="im-muestras" aria-label={`Ejemplos: ${valores.join(', ')}`}>
      {valores.map((v, i) => (
        <span key={i} className="mono">
          {v.length > 22 ? `${v.slice(0, 22)}…` : v}
        </span>
      ))}
    </span>
  )
}

function RecordarFormato({ perfil, onPerfil }) {
  if (!perfil) return null
  return (
    <label className="im-recordar">
      <input type="checkbox" checked={perfil.guardar || Boolean(perfil.reconocido)} onChange={(e) => onPerfil({ ...perfil, guardar: e.target.checked, reconocido: false })} />
      <span>{perfil.id ? 'Actualizar el formato' : 'Recordar este formato para la próxima vez:'}</span>
      <input
        className="input"
        value={perfil.nombre}
        onChange={(e) => onPerfil({ ...perfil, nombre: e.target.value, guardar: true, reconocido: false })}
        disabled={!perfil.guardar && !perfil.reconocido}
        aria-label="Nombre del formato"
        maxLength={60}
      />
    </label>
  )
}

function SelectCategoria({ id, valor, onChange, tipo, vacio, className = 'input' }) {
  const { categorias } = useCategorias()
  const grupo = (t) => categorias.filter((c) => c.tipo === t && !c.oculta)
  return (
    <select id={id} className={className} value={valor} onChange={(e) => onChange(e.target.value)} aria-invalid={!valor}>
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

// ---------------------------------------------------------------------------------------------
// Revisar: "Así entendimos tu planilla", categorías por asociar, resumen y filas
// ---------------------------------------------------------------------------------------------

function Revision(props) {
  const { archivo, mapeo, sel, res, perfil, excluidas, actualizando, guardando, onPerfil, onAsociar, onExcluir, onConfirmar, onCancelar } = props
  const { categoria } = useCategorias()
  const { filas, ignoradas = [] } = res
  const [filtro, setFiltro] = useState(() => (filas.some((f) => f.errores.length) ? 'error' : 'todas'))
  const seImportan = filas.filter((f) => f.datos && !excluidas.has(f.key))
  const conError = filas.filter((f) => !f.datos).length
  const duplicados = filas.filter((f) => f.duplicado).length
  const conAviso = filas.filter((f) => f.datos && (f.aviso || f.nota)).length
  const suma = (tipo) => seImportan.filter((f) => f.datos.tipo === tipo).reduce((s, f) => s + f.datos.monto, 0)
  const vistas = filas.filter((f) =>
    filtro === 'error' ? f.errores.length : filtro === 'avisos' ? f.datos && (f.aviso || f.nota) : filtro === 'duplicados' ? f.duplicado : true,
  )
  const encabezado = archivo.hojas[sel.hoja].filas[mapeo.encabezado] ?? []
  const pendientes = useMemo(() => {
    const m = new Map()
    for (const f of filas)
      if (f.catPendiente) {
        const k = normalizar(f.catPendiente)
        const x = m.get(k) ?? { clave: k, texto: f.catPendiente, filas: 0 }
        x.filas++
        m.set(k, x)
      }
    return [...m.values()]
  }, [filas])

  return (
    <div className={`im-revision${actualizando ? ' im-actualizando' : ''}`} aria-busy={actualizando}>
      <Entendimos {...props} />

      {pendientes.length > 0 && (
        <section className="card im-pendientes">
          <div>
            <h2>{plural(pendientes.length, 'categoría de tu planilla no existe', 'categorías de tu planilla no existen')} en KontadorIA</h2>
            <p className="muted">Elige a cuál corresponde. Lo recordamos para la próxima vez.</p>
          </div>
          <ul>
            {pendientes.map((p) => (
              <li key={p.clave}>
                <span>
                  <strong>«{p.texto}»</strong>
                  <small className="muted">{plural(p.filas, 'fila', 'filas')}</small>
                </span>
                <Icon name="out" />
                <SelectCategoria id={`pend-${p.clave}`} valor="" vacio="Elegir categoría…" onChange={(id) => onAsociar(p.clave, id)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Resumen para lectores de pantalla: en pantalla lo muestran las tarjetas */}
      <p className="im-resumen sr-only" aria-live="polite">
        <strong className="amt-in">{plural(seImportan.length, 'se importará', 'se importarán')}</strong>
        {' · '}
        <span className={conError ? 'amt-out' : ''}>{plural(conError, 'con error', 'con error')}</span>
        {' · '}
        {plural(ignoradas.length, 'omitida', 'omitidas')}
        {' · '}
        {plural(duplicados, 'posible duplicado', 'posibles duplicados')}
      </p>

      <div className="im-tiles">
        <div className="card im-tile ok">
          <span>Se importarán</span>
          <strong className="mono">{seImportan.length}</strong>
          {filas.length - conError - seImportan.length > 0 && <small>{plural(filas.length - conError - seImportan.length, 'quitada por ti o repetida', 'quitadas por ti o repetidas')}</small>}
        </div>
        <div className={`card im-tile ${conError ? 'mal' : ''}`}>
          <span>Con error</span>
          <strong className="mono">{conError}</strong>
          {conError > 0 && <small>No se importan</small>}
        </div>
        <div className="card im-tile">
          <span>Omitidas</span>
          <strong className="mono">{ignoradas.length}</strong>
          {ignoradas.length > 0 && <small>Totales, títulos u ocultas</small>}
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
            <strong>{plural(conError, 'fila con error no se importará.', 'filas con error no se importarán.')}</strong> Descárgalas, corrígelas en Excel y vuelve a subirlas.
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => descargarErrores(archivo.nombre, filas, encabezado)}>
            <Icon name="in" />
            Descargar filas con error
          </button>
        </div>
      )}

      {ignoradas.length > 0 && (
        <details className="card im-ignoradas">
          <summary>{plural(ignoradas.length, 'fila omitida', 'filas omitidas')} (totales, saldos, títulos u ocultas)</summary>
          <ul>
            {ignoradas.map((x) => (
              <li key={x.key}>
                <span className="mono muted">{x.hoja ? `${x.hoja} · fila ${x.n}` : `Fila ${x.n}`}</span> {x.motivo}
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
            { id: 'avisos', label: `Avisos (${conAviso})` },
            { id: 'duplicados', label: `Duplicados (${duplicados})` },
          ]}
        />
      </div>

      {/* Computador: tabla */}
      <div className="table-wrap im-tabla">
        <table>
          <thead>
            <tr>
              <th className="im-col-check">
                <span className="sr-only">Importar</span>
              </th>
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
              const fuera = !f.datos || excluidas.has(f.key)
              return (
                <tr key={f.key} className={f.errores.length ? 'im-fila-mal' : fuera ? 'im-fila-fuera' : ''}>
                  <td className="im-col-check">
                    <input type="checkbox" checked={!fuera} disabled={!f.datos} onChange={(e) => onExcluir(f.key, !e.target.checked)} aria-label={`Importar la fila ${f.n}`} />
                  </td>
                  <td className="num mono muted">
                    {f.hoja && <small className="sub">{f.hoja}</small>}
                    {f.n}
                  </td>
                  <td className="mono im-fecha">{f.datos ? fechaCorta(f.datos.fecha) : f.valores.fecha || '—'}</td>
                  <td>
                    <strong>{f.datos?.descripcion || f.valores.descripcion || <span className="muted">Sin descripción</span>}</strong>
                    {f.valores.proveedor && <small className="sub">{f.valores.proveedor}</small>}
                  </td>
                  <td>
                    {f.catPendiente ? (
                      <SelectCategoria
                        className="input im-cat-inline"
                        id={`fila-${f.key}`}
                        valor=""
                        vacio={`«${f.catPendiente}» → elegir…`}
                        onChange={(id) => onAsociar(normalizar(f.catPendiente), id)}
                      />
                    ) : c ? (
                      <>
                        <span className="cat-chip" style={{ '--c': c.color }}>
                          <span className="dot" />
                          {c.nombre}
                        </span>
                        {f.valores.categoria && normalizar(f.valores.categoria) !== normalizar(c.nombre) && <small className="sub">en tu planilla: {f.valores.categoria}</small>}
                      </>
                    ) : (
                      <span className="muted">{f.valores.categoria || '—'}</span>
                    )}
                  </td>
                  <td className={`num mono ${f.datos ? (f.datos.tipo === 'ingreso' ? 'amt-in' : 'amt-out') : 'muted'}`}>{f.datos ? clpSigno(f.datos.monto, f.datos.tipo) : f.valores.monto || '—'}</td>
                  <td className="im-estado">
                    <Estado fila={f} fuera={fuera} />
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
        {vistas.map((f) => {
          const fuera = !f.datos || excluidas.has(f.key)
          return (
            <li key={f.key} className={f.errores.length ? 'im-fila-mal' : fuera ? 'im-fila-fuera' : ''}>
              <div className="im-lista-top">
                <label className="im-lista-check">
                  <input type="checkbox" checked={!fuera} disabled={!f.datos} onChange={(e) => onExcluir(f.key, !e.target.checked)} />
                  <span className="mono muted">{f.hoja ? `${f.hoja} · fila ${f.n}` : `Fila ${f.n}`}</span>
                </label>
                <span className={`mono ${f.datos ? (f.datos.tipo === 'ingreso' ? 'amt-in' : 'amt-out') : 'muted'}`}>{f.datos ? clpSigno(f.datos.monto, f.datos.tipo) : f.valores.monto || '—'}</span>
              </div>
              <strong>{f.datos?.descripcion || f.valores.descripcion || 'Sin descripción'}</strong>
              <small className="muted">
                {[f.valores.fecha, f.datos ? categoria(f.datos.categoria_id).nombre : f.valores.categoria, f.valores.proveedor].filter(Boolean).join(' · ')}
              </small>
              {f.catPendiente && (
                <SelectCategoria id={`movil-${f.key}`} valor="" vacio={`«${f.catPendiente}» → elegir categoría…`} onChange={(id) => onAsociar(normalizar(f.catPendiente), id)} />
              )}
              <Estado fila={f} fuera={fuera} />
            </li>
          )
        })}
      </ul>

      {/* Recordar el formato es un ajuste, no una acción: va fuera de la barra fija */}
      {perfil && (
        <div className="card im-recordar-card">
          <RecordarFormato perfil={perfil} onPerfil={onPerfil} />
        </div>
      )}

      <div className="im-barra">
        <div className="im-barra-izq">
          {/* En el celular el botón ya dice cuántos se importan */}
          <p className={seImportan.length ? 'muted solo-pc' : 'muted'}>
            {seImportan.length ? (
              <>
                Se importarán <strong>{seImportan.length}</strong> movimientos a tu nombre.
              </>
            ) : (
              'Ninguna fila está lista: corrige la planilla y vuelve a subirla.'
            )}
          </p>
        </div>
        <div className="im-acts">
          <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirmar} disabled={!seImportan.length || guardando || actualizando}>
            {guardando ? <span className="spinner" /> : <Icon name="check" />}
            {guardando ? 'Importando…' : `Importar ${plural(seImportan.length, 'movimiento', 'movimientos')}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// La tarjeta "Así entendimos tu planilla": hoja, formato, cada campo con su columna y 3 muestras,
// lo que se hizo solo (hojas ocultas, celdas combinadas, saldos) y lo que se puede decidir.
function Entendimos({ archivo, mapeo, sel, res, perfil, onCambiarHoja, onSel, onCambiarColumnas }) {
  const filas = archivo.hojas[sel.hoja].filas
  const enc = filas[mapeo.encabezado] ?? []
  const nombreCol = (i) => String(enc[i] ?? '').trim() || `Columna ${letraColumna(i)}`
  const ocultasIgnoradas = res.ignoradas.filter((x) => x.oculta).length
  const ocultasEnHojas = seleccionDe(sel).reduce((n, h) => n + (archivo.hojas[h].ocultas?.length ?? 0), 0)
  const nombresMismas = sel.mismas.map((h) => archivo.hojas[h].nombre)
  const campo = (clave, etiqueta, extra) =>
    mapeo.cols[clave] >= 0 && (
      <li key={clave} className={revisar(mapeo.origen?.[clave]) ? 'dudoso' : ''}>
        <span className="im-campo-nombre">{etiqueta}</span>
        <span className="im-campo-col">← «{nombreCol(mapeo.cols[clave])}»</span>
        {extra && <span className="muted">{extra}</span>}
        <Muestras valores={muestras(filas, mapeo.encabezado, mapeo.cols[clave], 3, { fecha: clave === 'fecha' })} />
        {revisar(mapeo.origen?.[clave]) && <span className="im-revisa">Revisa esto</span>}
      </li>
    )
  const modoTexto = { signo: '(negativo = gasto)', fijo: mapeo.tipoFijo === 'ingreso' ? '(todo es ingreso)' : '(todo es gasto)' }[mapeo.modo]

  return (
    <section className="card im-entendimos">
      <div className="im-ent-head">
        <div>
          <h2>Así entendimos tu planilla</h2>
          <div className="im-ent-meta">
            <ArchivoChip archivo={archivo} />
            {mapeo.plantilla ? (
              <span className="chip">Plantilla KontadorIA</span>
            ) : perfil?.reconocido ? (
              <span className="chip">Formato guardado «{perfil.nombre}»</span>
            ) : (
              <span className="chip line">Planilla propia</span>
            )}
          </div>
        </div>
        {!mapeo.plantilla && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCambiarColumnas}>
            <Icon name="pen" />
            Cambiar columnas
          </button>
        )}
      </div>

      <div className="im-ent-hoja">
        {archivo.hojas.length > 1 ? (
          <label className="im-ent-select">
            <span>Hoja</span>
            <select className="input" value={sel.hoja} onChange={(e) => onCambiarHoja(+e.target.value)}>
              {archivo.hojas.map((h, i) => (
                <option key={i} value={i}>
                  {h.nombre}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="muted">
            Hoja <strong>{archivo.hojas[sel.hoja].nombre}</strong>
          </span>
        )}
        <span className="muted">Encabezado en la fila {mapeo.encabezado + 1}</span>
        {sel.mismas.length > 0 && (
          <label className="im-check">
            <input type="checkbox" checked={sel.incluirMismas} onChange={(e) => onSel({ incluirMismas: e.target.checked })} />
            <span>
              Importar también {nombresMismas.join(' y ')} <span className="muted">(mismo formato)</span>
            </span>
          </label>
        )}
      </div>

      <ul className="im-campos-ent">
        {campo('fecha', 'Fecha')}
        {mapeo.modo === 'cargo_abono' ? (
          <>
            {campo('cargo', 'Gastos')}
            {campo('abono', 'Ingresos')}
          </>
        ) : (
          <>
            {campo('monto', 'Monto', modoTexto)}
            {mapeo.modo === 'tipo' && campo('tipo', 'Tipo')}
          </>
        )}
        {campo('descripcion', 'Descripción')}
        {campo('proveedor', 'Proveedor')}
        {campo('categoria', 'Categoría')}
        {campo('saldo', 'Saldo', '(solo para comprobar)')}
        {mapeo.cols.descripcion < 0 && (
          <li>
            <span className="im-campo-nombre">Descripción</span>
            <span className="muted">no está en tu planilla: usamos el proveedor o la categoría</span>
          </li>
        )}
      </ul>

      {(archivo.avisos?.hojasOcultas > 0 || res.combinadas > 0 || res.saldos?.cuadran !== null || ocultasEnHojas > 0 || mapeo.ambiguo?.fecha || mapeo.ambiguo?.monto) && (
        <ul className="im-avisos">
          {(mapeo.ambiguo?.fecha || mapeo.ambiguo?.monto) && (
            <li className="ojo">
              <Icon name="receipt" />
              <span>
                {mapeo.ambiguo?.fecha && <>Leímos las fechas como {mapeo.fecha === 'mdy' ? 'mes/día/año' : 'día/mes/año'}, pero ningún día pasa de 12 y no pudimos confirmarlo. </>}
                {mapeo.ambiguo?.monto && <>Leímos los montos con {mapeo.monto === 'us' ? 'coma' : 'punto'} para los miles, pero no pudimos confirmarlo. </>}
              </span>
              {!mapeo.plantilla && (
                <button type="button" className="btn btn-text btn-sm" onClick={onCambiarColumnas}>
                  Cambiar
                </button>
              )}
            </li>
          )}
          {archivo.avisos?.hojasOcultas > 0 && (
            <li>
              <Icon name="check" />
              Ignoramos {plural(archivo.avisos.hojasOcultas, 'hoja oculta', 'hojas ocultas')} (suelen ser de configuración).
            </li>
          )}
          {res.combinadas > 0 && (
            <li>
              <Icon name="check" />
              Completamos {plural(res.combinadas, 'grupo de celdas combinadas', 'grupos de celdas combinadas')}: cada fila del grupo toma su valor.
            </li>
          )}
          {res.saldos?.cuadran === true && (
            <li className="ok">
              <Icon name="check" />
              Los saldos cuadran en los {res.saldos.filas} movimientos ({res.saldos.orden === 'desc' ? 'de la más nueva a la más antigua' : 'de la más antigua a la más nueva'}).
            </li>
          )}
          {res.saldos?.cuadran === false && (
            <li className="ojo">
              <Icon name="receipt" />
              Los saldos no cuadran: puede faltar algún movimiento en la planilla. Puedes importar igual.
            </li>
          )}
          {ocultasEnHojas > 0 && (
            <li className="ojo">
              <Icon name="receipt" />
              {sel.incluirOcultas ? (
                <span>Se incluyen {plural(ocultasEnHojas, 'fila que estaba oculta', 'filas que estaban ocultas')} por un filtro.</span>
              ) : (
                <span>{plural(ocultasIgnoradas, 'fila estaba oculta', 'filas estaban ocultas')} por un filtro y no se importarán.</span>
              )}
              <button type="button" className="btn btn-text btn-sm" onClick={() => onSel({ incluirOcultas: !sel.incluirOcultas })}>
                {sel.incluirOcultas ? 'Quitarlas' : 'Incluirlas'}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function Estado({ fila, fuera }) {
  if (fila.errores.length)
    return (
      <span className="im-mal">
        <Icon name="x" />
        <span>{fila.errores.join(' ')}</span>
      </span>
    )
  if (fila.duplicado)
    return (
      <span className="im-ojo">
        <Icon name="receipt" />
        <span>
          <strong>{fila.duplicado === 'exacto' ? (fuera ? 'Ya importada' : 'Ya importada: se importará de nuevo') : 'Posible duplicado'}</strong> {fila.aviso}
        </span>
      </span>
    )
  if (fuera)
    return (
      <span className="muted">
        <Icon name="x" /> Quitada por ti
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

// ---------------------------------------------------------------------------------------------
// Listo
// ---------------------------------------------------------------------------------------------

function Listo({ hecha, res, archivo, mapeo, sel, perfil, onOtra }) {
  const errores = res?.filas.filter((f) => f.errores.length) ?? []
  const encabezado = archivo?.hojas[sel.hoja].filas[mapeo.encabezado] ?? []
  return (
    <div className="card im-hecho rise">
      <span className="im-hecho-ic">
        <Icon name="check" />
      </span>
      <p className="muted">
        Desde <strong>{hecha.nombre_archivo}</strong>
        {hecha.hojas?.length > 1 && ` (hojas ${hecha.hojas.join(', ')})`}
        {hecha.filas_con_error > 0 && ` · ${plural(hecha.filas_con_error, 'fila con error quedó fuera', 'filas con error quedaron fuera')}`}
        {hecha.filas_excluidas > 0 && ` · ${plural(hecha.filas_excluidas, 'quitada o repetida', 'quitadas o repetidas')}`}
        {hecha.filas_omitidas > 0 && ` · ${plural(hecha.filas_omitidas, 'omitida', 'omitidas')}`}
      </p>
      {perfil?.guardar && (
        <p className="im-recordado">
          <Icon name="check" />
          <span>
            Guardamos el formato <strong>«{perfil.nombre}»</strong>: la próxima planilla igual se importa sin elegir columnas.
          </span>
        </p>
      )}
      <div className="im-acts">
        <a className="btn btn-primary" href="#/movimientos">
          Ver movimientos
        </a>
        {errores.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => descargarErrores(archivo.nombre, res.filas, encabezado)}>
            <Icon name="in" />
            Descargar filas con error
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onOtra}>
          Importar otra planilla
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Plantilla (recomendada), formatos guardados, historial
// ---------------------------------------------------------------------------------------------

function Plantilla() {
  const { categorias } = useCategorias()
  const visibles = categorias.filter((c) => !c.oculta)
  return (
    <div className="card im-plantilla">
      <div className="im-plantilla-head">
        <h2>¿Empiezas de cero?</h2>
        <span className="chip">Recomendada</span>
      </div>
      <p className="muted">Se importa directo, sin revisar columnas.</p>
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
      <details className="im-cats">
        <summary>Sus seis columnas</summary>
        <ul className="im-plantilla-cols">
          {COLUMNAS.map((c) => (
            <li key={c.clave}>
              <code>{c.nombre}</code>
              <span>{c.ayuda}</span>
              <small className="mono muted">{c.ejemplo}</small>
            </li>
          ))}
        </ul>
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
    </div>
  )
}

function Formatos({ lista, onOlvidar }) {
  const [confirmando, setConfirmando] = useState(null)
  return (
    <section className="im-formatos-guardados">
      <div className="card-head">
        <h2>Tus formatos guardados</h2>
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
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return (
    <section className="im-historial">
      <div className="card-head">
        <h2>Historial de importaciones</h2>
      </div>
      {!lista.length ? (
        <div className="card im-vacio-card">
          <p className="muted">Aún no hay importaciones.</p>
        </div>
      ) : (
        <div className="table-wrap">
          {/* En el celular cada fila se muestra como tarjeta (ver .im-hist-tabla en el CSS) */}
          <table className="im-hist-tabla">
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
                  <td className="mono muted im-h-fecha">
                    <span>{fechaCorta(imp.creado_en.slice(0, 10))}</span>
                    <small className="sub">{hora(imp.creado_en)}</small>
                    <small className="sub solo-movil">· {imp.usuario_nombre}</small>
                  </td>
                  <td className="im-h-archivo">
                    <span className="im-archivo">
                      <Icon name="sheet" />
                      <strong>{imp.nombre_archivo}</strong>
                    </span>
                    {imp.formato && <small className="sub muted">{imp.formato}</small>}
                  </td>
                  <td className="im-h-quien">{imp.usuario_nombre}</td>
                  <td className="num mono im-h-filas">
                    {imp.filas_importadas}
                    <span className="muted"> / {imp.total_filas}</span>
                    <span className="muted solo-movil"> filas</span>
                    {imp.filas_con_error > 0 && <small className="sub amt-out">{imp.filas_con_error} con error</small>}
                  </td>
                  <td className="im-h-estado">
                    {imp.anulada_en ? (
                      <span className="chip line">Anulada</span>
                    ) : imp.estado === 'completada' ? (
                      <span className="chip">Completada</span>
                    ) : (
                      <span className="chip warn">Con errores</span>
                    )}
                  </td>
                  {onAnular && (
                    <td className="num im-h-acc">
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
