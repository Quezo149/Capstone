import { useRef, useState } from 'react'
import Icon from '../components/Icon'
import MovimientoForm from '../components/MovimientoForm'
import { Documento } from '../components/VisorDocumento'
import { EJEMPLOS, extraer, formatearRut, urlEjemplo } from '../lib/documentos'
import { clp, fechaLarga } from '../lib/format'
import { useMovimientos } from '../state/Movimientos'
import { useToast } from '../state/Toasts'
import './Cargar.css'

// PROTOTIPO HU08 (cargar boleta o factura) + HU09 (validar lo extraído).
// Pasos: elegir → leyendo → revisar (o fallo → formulario manual vacío).
const PASOS = [
  ['subiendo', 'Subiendo el documento'],
  ['leyendo', 'Leyendo proveedor, fecha y total'],
  ['categoria', 'Buscando la categoría'],
]
const MAX_MB = 4

export default function Cargar({ proveedores }) {
  const { crear } = useMovimientos()
  const { aviso } = useToast()
  const [etapa, setEtapa] = useState('elegir')
  const [paso, setPaso] = useState(null)
  const [vista, setVista] = useState(null) // documento que se muestra mientras se lee
  const [res, setRes] = useState(null)
  const [error, setError] = useState(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [vez, setVez] = useState(0)
  const camara = useRef(null)
  const archivo = useRef(null)

  async function leer(fuente) {
    setError(null)
    setEtapa('leyendo')
    setVista(fuente.ejemplo ? fuente.ejemplo.documento() : fuente.archivo.type === 'application/pdf' ? { pdf: fuente.archivo.name } : { imagen: URL.createObjectURL(fuente.archivo) })
    const r = await extraer(fuente, setPaso)
    setRes(r)
    setVez((n) => n + 1)
    setEtapa(r.ok ? 'revisar' : 'fallo')
  }

  function elegirArchivo(f) {
    if (!f) return
    if (!/^image\/(jpeg|png|webp|heic)|application\/pdf/.test(f.type)) return setError('Ese archivo no es una foto ni un PDF.')
    if (f.type === 'application/pdf' && f.size > MAX_MB * 1024 * 1024) return setError(`El PDF pesa más de ${MAX_MB} MB.`)
    leer({ archivo: f })
  }

  function volver() {
    setEtapa('elegir')
    setRes(null)
    setPaso(null)
  }

  async function guardar(datos) {
    // El RUT leído viaja con el movimiento: es la llave del historial de categorías y duplicados
    const m = await crear({ ...datos, proveedor_rut: res.datos.proveedor_rut ?? null, origen: res.origen, documento: res.documento })
    aviso(`${m.tipo === 'gasto' ? 'Gasto' : 'Ingreso'} guardado desde ${res.origen === 'pdf' ? 'el PDF' : 'la foto'}: ${clp(m.monto)}`, { festejo: true })
    window.location.hash = '#/movimientos'
  }

  if (etapa === 'leyendo') {
    return (
      <>
        <Cabecera eyebrow="Cargar boleta" titulo="Leyendo tu documento…" />
        <div className="cg-grid">
          <div className="card cg-doc cg-escaneando">
            <Documento documento={vista} altura="62vh" />
            <span className="cg-linea" aria-hidden="true" />
          </div>
          <div className="card cg-pasos" role="status" aria-live="polite">
            <h2>Un momento</h2>
            <ol>
              {PASOS.map(([id, texto], i) => {
                const actual = PASOS.findIndex(([x]) => x === paso)
                const estado = i < actual ? 'ok' : i === actual ? 'en-curso' : 'espera'
                return (
                  <li key={id} className={estado}>
                    <span className="cg-paso-ic">{estado === 'ok' ? <Icon name="check" /> : estado === 'en-curso' ? <span className="spinner" /> : i + 1}</span>
                    {texto}
                  </li>
                )
              })}
            </ol>
            <p className="muted">
              La lectura la hace Azure AI Document Intelligence. Suele tardar unos segundos; nada se guarda hasta que tú confirmes.
            </p>
          </div>
        </div>
      </>
    )
  }

  if (etapa === 'fallo') {
    return (
      <>
        <Cabecera eyebrow="Cargar boleta" titulo="No pudimos leer este documento" />
        <div className="cg-grid">
          <div className="card cg-doc">
            <Documento documento={res.documento} altura="56vh" />
          </div>
          <div className="card cg-fallo">
            <span className="cg-fallo-ic">
              <Icon name="camera" />
            </span>
            <h2>{res.motivo}</h2>
            <ul>
              <li>Toma la foto con buena luz y sin sombras.</li>
              <li>Que se vea la boleta completa, de borde a borde.</li>
              <li>Apoya el celular para que la foto no salga movida.</li>
            </ul>
            <div className="cg-acts">
              <button type="button" className="btn btn-ghost" onClick={volver}>
                Probar con otra foto
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setRes((r) => ({ ...r, ok: true, datos: {}, confianza: null, sugerencia: null, manual: true }))
                  setVez((n) => n + 1)
                  setEtapa('revisar')
                }}
              >
                <Icon name="pen" />
                Registrar a mano
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  if (etapa === 'revisar') {
    return (
      <>
        <Cabecera
          eyebrow={res.manual ? 'Registro manual' : 'Revisión'}
          titulo={res.manual ? 'Completa los datos a mano' : 'Revisa lo que leyó la IA'}
          bajada={
            res.manual
              ? 'El documento queda guardado junto al movimiento.'
              : 'Corrige lo que haga falta. No se guarda nada hasta que confirmes.'
          }
        />
        {res.simulado && (
          <p className="chip warn cg-nota">
            Prototipo: con un archivo tuyo los datos son de muestra. La app real los leerá del documento.
          </p>
        )}
        {res.duplicado && !res.manual && <AvisoDuplicado previo={res.duplicado} datos={res.datos} onDescartar={() => {
          volver()
          aviso('Listo, no se guardó nada')
        }} />}
        <div className="cg-grid cg-revisar">
          <div className="card cg-doc">
            <Documento documento={res.documento} resaltable={!res.manual} altura="70vh" />
          </div>
          <div className="card cg-form">
            <MovimientoForm
              key={vez}
              prellenado={{ ...res.datos, ...(res.sugerencia ? { categoria_id: res.sugerencia.id } : {}) }}
              ia={res.manual ? null : { confianza: res.confianza, motivos: res.motivos, sugerencia: res.sugerencia, rut: res.datos.proveedor_rut }}
              proveedores={proveedores}
              onGuardar={guardar}
              onCancelar={() => {
                volver()
                aviso('Listo, no se guardó nada')
              }}
            />
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Cabecera eyebrow="Cargar boleta" titulo="Saca una foto y nosotros la leemos" />
      <div className="cg-grid">
        <div
          className={`card cg-drop${arrastrando ? ' sobre' : ''}`}
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
          <span className="cg-drop-ic">
            <Icon name="camera" />
          </span>
          <h2>Sube tu boleta o factura</h2>
          <p className="muted">Arrástrala aquí, saca una foto o elige un archivo. JPG, PNG o PDF de hasta {MAX_MB} MB.</p>
          <div className="cg-acts">
            <button type="button" className="btn btn-primary cg-solo-movil" onClick={() => camara.current.click()}>
              <Icon name="camera" />
              Sacar foto
            </button>
            <button type="button" className="btn btn-primary cg-solo-pc" onClick={() => archivo.current.click()}>
              <Icon name="plus" />
              Elegir archivo
            </button>
            <button type="button" className="btn btn-ghost cg-solo-movil" onClick={() => archivo.current.click()}>
              Elegir de la galería
            </button>
          </div>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => elegirArchivo(e.target.files[0])} />
          <input ref={archivo} type="file" accept="image/*,application/pdf" hidden onChange={(e) => elegirArchivo(e.target.files[0])} />
        </div>

        <div className="card cg-como">
          <h2>Así funciona</h2>
          <ol>
            <li>
              <strong>Subes la foto o el PDF</strong>
              <span>Desde el celular puedes sacar la foto al tiro.</span>
            </li>
            <li>
              <strong>La IA lee los datos</strong>
              <span>Proveedor, fecha, total, si es boleta o factura, y te sugiere una categoría.</span>
            </li>
            <li>
              <strong>Tú revisas y confirmas</strong>
              <span>Nada se guarda sin tu visto bueno. El documento queda adjunto al movimiento.</span>
            </li>
          </ol>
        </div>
      </div>

      <section className="cg-ejemplos">
        <div className="card-head">
          <h2>¿No tienes una boleta a mano? Prueba con un ejemplo</h2>
        </div>
        <ul>
          {EJEMPLOS.map((ej, i) => (
            <li key={ej.id} className="rise" style={{ '--d': `${i * 60}ms` }}>
              <button type="button" onClick={() => leer({ ejemplo: ej })}>
                <span className="cg-ej-img">
                  <img src={urlEjemplo(ej)} alt="" loading="lazy" />
                  <span className={`chip ${ej.falla ? 'warn' : ''}`}>{ej.origen === 'pdf' ? 'PDF' : 'Foto'}</span>
                </span>
                <strong>{ej.titulo}</strong>
                <small>{ej.detalle}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

// Voucher de la máquina POS + boleta de la misma compra = el gasto quedaría dos veces
function AvisoDuplicado({ previo, datos, onDescartar }) {
  const porRut = datos.proveedor_rut && previo.proveedor_rut === datos.proveedor_rut
  return (
    <div className="card cg-duplicado" role="alert">
      <span className="cg-duplicado-ic">
        <Icon name="receipt" />
      </span>
      <div>
        <strong>¿Ya registraste esta compra?</strong>
        <p>
          Hay un gasto de <span className="mono">{clp(previo.monto)}</span> del {fechaLarga(previo.fecha).toLowerCase()} en{' '}
          <strong>{previo.proveedor || 'el mismo comercio'}</strong>
          {porRut ? ` (mismo RUT ${formatearRut(previo.proveedor_rut)})` : ''}
          {previo.descripcion ? `: ${previo.descripcion}` : ''}.
        </p>
        <small>Si es el voucher y la boleta de una misma compra, guárdala una sola vez.</small>
      </div>
      <div className="cg-duplicado-acts">
        <a className="btn btn-ghost btn-sm" href="#/movimientos">
          Ver movimientos
        </a>
        <button type="button" className="btn btn-primary btn-sm" onClick={onDescartar}>
          Es la misma, no guardar
        </button>
      </div>
    </div>
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
