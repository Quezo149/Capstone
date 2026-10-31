import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import MovimientoForm from '../components/MovimientoForm'
import { Documento } from '../components/VisorDocumento'
import { MAX_MB, cancelar, errorArchivo, extraer } from '../lib/documentos'
import { clp, fechaLarga } from '../lib/format'
import { useMovimientos } from '../state/Movimientos'
import { useToast } from '../state/Toasts'
import './Cargar.css'

// HU08 (cargar boleta o factura) + HU09 (validar lo extraído). KONTADORIA-57 y 60.
// Etapas: elegir → leyendo → revisar (o fallo → formulario manual vacío, con el archivo adjunto
// si alcanzó a guardarse). Nada queda en la base hasta "Confirmar y guardar".
const PASOS = [
  ['subiendo', 'Subiendo el documento'],
  ['leyendo', 'Leyendo proveedor, fecha y total'],
  ['categoria', 'Buscando la categoría'],
]

// La lectura es un solo request: los pasos avanzan con el tiempo y el último se completa al responder
const TIEMPOS = [0, 1200, 4500]

// Lo que devuelve la IA en null no pisa los valores por defecto del formulario (fecha de hoy, etc.)
const sinVacios = (datos) => Object.fromEntries(Object.entries(datos ?? {}).filter(([, v]) => v != null && v !== ''))

export default function Cargar({ proveedores }) {
  const { crear } = useMovimientos()
  const { aviso } = useToast()
  const [etapa, setEtapa] = useState('elegir')
  const [paso, setPaso] = useState(null)
  const [vista, setVista] = useState(null) // documento en pantalla ({ imagen, cajas } | { pdf, url })
  const [res, setRes] = useState(null) // respuesta de POST /documentos/extraer (+ manual)
  const [error, setError] = useState(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [vez, setVez] = useState(0)
  const camara = useRef(null)
  const archivo = useRef(null)
  const urls = useRef([])
  const [repetido, setRepetido] = useState(null) // { previo, datos }: el backend avisó al guardar
  const [ultimo, setUltimo] = useState(null) // el último archivo elegido, para "Intentar de nuevo"

  // Las vistas previas son URLs locales del navegador: se liberan al salir de la pantalla
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  async function leer(f) {
    setUltimo(f)
    setError(null)
    setEtapa('leyendo')
    const previa = URL.createObjectURL(f)
    urls.current.push(previa)
    setVista(f.type === 'application/pdf' ? { pdf: f.name, url: previa } : { imagen: previa })
    const relojes = TIEMPOS.map((ms, i) => setTimeout(() => setPaso(PASOS[i][0]), ms))
    try {
      const { vista: leida, respuesta } = await extraer(f)
      urls.current.push(leida.url ?? leida.imagen)
      setVista(leida)
      setRes(respuesta)
      setVez((n) => n + 1)
      setEtapa(respuesta.ok ? 'revisar' : 'fallo')
    } catch (e) {
      if (e.codigo === 'lectura_no_disponible') {
        // La IA no respondió (suele ser momentáneo: el plan gratuito limita las lecturas por
        // segundo). El backend ya borró el archivo: se puede reintentar o registrar a mano.
        setRes({ ok: false, motivo: e.message, archivo_id: null, reintentable: true })
        setEtapa('fallo')
      } else {
        setEtapa('elegir')
        setError(e.message)
      }
    } finally {
      relojes.forEach(clearTimeout)
      setPaso(null)
    }
  }

  function elegirArchivo(f) {
    if (!f) return
    const motivo = errorArchivo(f)
    if (motivo) return setError(motivo)
    leer(f)
  }

  function volver() {
    setEtapa('elegir')
    setRes(null)
    setVista(null)
    setRepetido(null)
  }

  function descartar() {
    cancelar(res?.archivo_id)
    volver()
    aviso('Listo, no se guardó nada')
  }

  async function guardar(datos, { aceptarDuplicado = false } = {}) {
    let m
    try {
      // El RUT leído viaja con el movimiento: es la llave del historial de categorías y duplicados
      m = await crear({
        ...datos,
        proveedor_rut: res.manual ? null : (res.datos?.proveedor_rut ?? null),
        archivo_id: res.archivo_id ?? null,
        aceptar_duplicado: aceptarDuplicado,
      })
    } catch (e) {
      if (e.codigo !== 'posible_duplicado') throw e
      const previo = e.detalle.duplicado
      // Es el mismo que ya se avisó al leer y aun así confirmó: ya lo vio, se guarda
      if (res.duplicado?.id === previo.id) return guardar(datos, { aceptarDuplicado: true })
      // Con los datos finales apareció uno (la IA no leyó la fecha o se corrigió el monto)
      setRepetido({ previo, datos })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const desde = !res.archivo_id ? '' : res.origen === 'pdf' ? ' desde el PDF' : ' desde la foto'
    aviso(`${m.tipo === 'gasto' ? 'Gasto' : 'Ingreso'} guardado${desde}: ${clp(m.monto)}`, { festejo: true })
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
            <Documento documento={vista} altura="56vh" />
          </div>
          <div className="card cg-fallo">
            <span className="cg-fallo-ic">
              <Icon name="camera" />
            </span>
            <h2>{res.motivo}</h2>
            {!res.reintentable && (
              <ul>
                <li>Toma la foto con buena luz y sin sombras.</li>
                <li>Que se vea la boleta completa, de borde a borde.</li>
                <li>Apoya el celular para que la foto no salga movida.</li>
              </ul>
            )}
            <div className="cg-acts">
              {res.reintentable && ultimo && (
                <button type="button" className="btn btn-ghost" onClick={() => leer(ultimo)}>
                  <Icon name="undo" />
                  Intentar de nuevo
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  cancelar(res.archivo_id)
                  volver()
                }}
              >
                Probar con otra foto
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setRes((r) => ({ ...r, datos: {}, manual: true }))
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
    const ia = res.manual
      ? null
      : { confianza: res.confianza, motivos: res.motivos, sugerencia: res.sugerencia, rut: res.datos.proveedor_rut }
    return (
      <>
        <Cabecera
          eyebrow={res.manual ? 'Registro manual' : 'Revisión'}
          titulo={res.manual ? 'Completa los datos a mano' : 'Revisa lo que leyó la IA'}
          bajada={
            res.manual
              ? res.archivo_id
                ? 'El documento queda guardado junto al movimiento.'
                : 'Esta vez el documento no queda guardado: la lectura no estaba disponible.'
              : 'Corrige lo que haga falta. No se guarda nada hasta que confirmes.'
          }
        />
        {repetido ? (
          <AvisoDuplicado
            previo={repetido.previo}
            onDescartar={descartar}
            onGuardarIgual={() => guardar(repetido.datos, { aceptarDuplicado: true }).catch((e) => aviso(e.message))}
          />
        ) : (
          res.duplicado && !res.manual && <AvisoDuplicado previo={res.duplicado} onDescartar={descartar} />
        )}
        <div className="cg-grid cg-revisar">
          <div className="card cg-doc">
            <Documento documento={vista} resaltable={!res.manual} altura="70vh" />
          </div>
          <div className="card cg-form">
            <MovimientoForm
              key={vez}
              prellenado={{ ...sinVacios(res.datos), ...(res.sugerencia ? { categoria_id: res.sugerencia.categoria_id } : {}) }}
              ia={ia}
              proveedores={proveedores}
              onGuardar={guardar}
              onCancelar={descartar}
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
          {/* value = '' al elegir: permite volver a elegir el mismo archivo después de un error */}
          <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { elegirArchivo(e.target.files[0]); e.target.value = '' }} />
          <input ref={archivo} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { elegirArchivo(e.target.files[0]); e.target.value = '' }} />
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
    </>
  )
}

// Voucher de la máquina POS + boleta de la misma compra = el gasto quedaría dos veces
// onGuardarIgual: el aviso llegó al guardar; el usuario decide si es otra compra
function AvisoDuplicado({ previo, onDescartar, onGuardarIgual }) {
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
          {previo.usuario_nombre ? `, registrado por ${previo.usuario_nombre}` : ''}.
        </p>
        <small>Si es el voucher y la boleta de una misma compra, guárdala una sola vez.</small>
      </div>
      <div className="cg-duplicado-acts">
        {onGuardarIgual ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onGuardarIgual}>
            No es la misma, guardar igual
          </button>
        ) : (
          <a className="btn btn-ghost btn-sm" href="#/movimientos">
            Ver movimientos
          </a>
        )}
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
