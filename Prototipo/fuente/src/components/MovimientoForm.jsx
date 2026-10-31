import { useEffect, useMemo, useRef, useState } from 'react'
import { TIPOS_DOCUMENTO } from '../data/categorias'
import { nuevoId } from '../data/movimientos'
import { useCategorias } from '../state/Categorias'
import { useMovimientos } from '../state/Movimientos'
import { useSesion } from '../state/Sesion'
import { clp, desglosarIva, hoyISO, leerMonto } from '../lib/format'
import Icon from './Icon'
import Seg from './Seg'
import { Documento } from './VisorDocumento'
import { formatearRut } from '../lib/documentos'
import './MovimientoForm.css'

const MAX_MONTO = 999_999_999_999 // cabe en numeric(14,0)

const SACUDIDA = [0, -5, 5, -5, 5, 0].map((x) => ({ transform: `translateX(${x}px)` }))
const reducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const vacio = () => ({
  tipo: 'gasto',
  monto: 0,
  fecha: hoyISO(),
  categoria_id: '',
  proveedor: '',
  descripcion: '',
  tipo_documento: 'boleta',
})

function validar(f) {
  const e = {}
  if (!f.monto) e.monto = 'Escribe el monto.'
  else if (f.monto > MAX_MONTO) e.monto = 'Ese monto es demasiado grande.'
  if (!f.fecha) e.fecha = 'Elige la fecha.'
  else if (f.fecha > hoyISO()) e.fecha = 'La fecha no puede ser futura.'
  if (!f.categoria_id) e.categoria_id = 'Elige una categoría.'
  if (!f.descripcion.trim()) e.descripcion = 'Cuenta en pocas palabras qué fue.'
  return e
}

// Marca junto a un campo que vino de la IA (HU09): leído, dudoso o ya corregido por el usuario
function MarcaIa({ ia, campo, corregidos }) {
  const nivel = ia?.confianza?.[campo]
  if (!nivel) return null
  if (corregidos.has(campo)) return <span className="ia-marca corregido">Corregido</span>
  if (nivel === 'media')
    return (
      <span className="ia-marca revisa" title={ia.motivos?.[campo] ?? 'La IA no está segura de este dato'}>
        Revisa este dato
      </span>
    )
  return (
    <span className="ia-marca" title="Dato leído del documento">
      <Icon name="spark" />
      Leído por IA
    </span>
  )
}

// Por qué la IA pide revisar un campo (se oculta cuando el usuario ya lo corrigió)
function MotivoIa({ ia, campo, corregidos }) {
  const motivo = ia?.confianza?.[campo] === 'media' && !corregidos.has(campo) && ia.motivos?.[campo]
  return motivo ? <span className="hint ia-motivo">{motivo}</span> : null
}

// PROTOTIPO A+B: el tipo no tiene ninguna categoría visible (no debería pasar: la API no deja
// ocultar la última, pero puede venir de datos anteriores). El admin las recupera aquí mismo, sin
// perder lo escrito; los demás roles no gestionan categorías (D2).
function SinCategorias({ tipo }) {
  const { puede } = useSesion()
  const { categoriasDe, ocultar } = useCategorias()
  const [enviando, setEnviando] = useState(false)
  const ocultas = categoriasDe(tipo).filter((c) => c.oculta)
  const nombre = tipo === 'gasto' ? 'gasto' : 'ingreso'
  async function mostrar() {
    setEnviando(true)
    try {
      for (const c of ocultas) await ocultar(c.id, false)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <div className="mf-sin-cats" role="status">
      <strong>No hay categorías de {nombre} visibles.</strong>
      {puede('categorias.gestionar') ? (
        ocultas.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={mostrar} disabled={enviando}>
            Mostrar las ocultas ({ocultas.length})
          </button>
        )
      ) : (
        <span>Pídele al administrador que active alguna en Categorías.</span>
      )}
    </div>
  )
}

// Formulario de alta y edición. `inicial` = movimiento a editar, o null para uno nuevo.
// onGuardar(datos, { otro }) → `otro` true cuando el usuario quiere seguir cargando.
// PROTOTIPO HU09: `prellenado` + `ia` = datos leídos de una boleta, con su confianza y la
// categoría sugerida; `onCancelar` descarta sin guardar nada.
export default function MovimientoForm({ inicial, prellenado, ia, proveedores = [], onGuardar, onEliminar, onCancelar }) {
  const editando = Boolean(inicial)
  const { categoria: catPorId, categoriasDe } = useCategorias()
  const [f, setF] = useState(() =>
    inicial
      ? { ...inicial, proveedor: inicial.proveedor ?? '', descripcion: inicial.descripcion ?? '' }
      : { ...vacio(), ...prellenado },
  )
  // Campos leídos por la IA que el usuario cambió
  const [corregidos, setCorregidos] = useState(() => new Set())
  const [verDoc, setVerDoc] = useState(false)
  // Se genera una vez por formulario abierto: si el guardado se repite, no se duplica
  const [requestId, setRequestId] = useState(nuevoId)
  const [errores, setErrores] = useState({})
  // Error que devolvió la API y no corresponde a un campo (sin conexión, sin permiso, …)
  const [errorGeneral, setErrorGeneral] = useState(null)
  const [enviando, setEnviando] = useState(false)
  // Eliminar pide confirmar, mostrando qué se elimina (monto y descripción guardados)
  const [confirmar, setConfirmar] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const confirmRef = useRef(null)
  useEffect(() => {
    if (confirmar) confirmRef.current?.focus()
  }, [confirmar])
  // Candado inmediato: `enviando` (estado) recién se actualiza en el próximo render, así que
  // un doble clic rápido alcanzaba a enviar dos veces. La ref cambia en el acto.
  const enCurso = useRef(false)
  const montoRef = useRef(null)

  // PROTOTIPO A+B: primero las categorías que la empresa usa (y las propias); las predefinidas que
  // nunca se usaron van bajo "Más categorías", y las ocultas no aparecen. El grupo se arma con la
  // categoría que traía el formulario al abrirse (la del movimiento o la sugerida por la IA), no
  // con la que se toca: así una categoría elegida desde "Más" no salta de lugar.
  const { movs } = useMovimientos()
  const [catInicial] = useState(() => f.categoria_id)
  const [verTodas, setVerTodas] = useState(false)
  const usos = useMemo(() => {
    const u = {}
    for (const m of movs) u[m.categoria_id] = (u[m.categoria_id] ?? 0) + 1
    return u
  }, [movs])
  const { cats, plegadas } = useMemo(() => {
    const disponibles = categoriasDe(f.tipo).filter((c) => !c.oculta || c.id === catInicial)
    const ordenadas = [...disponibles].sort((a, b) => (usos[b.id] ?? 0) - (usos[a.id] ?? 0) || a.nombre.localeCompare(b.nombre, 'es'))
    const aMano = ordenadas.filter((c) => usos[c.id] || !c.predefinida || c.id === catInicial)
    // Empresa que recién parte: con tan pocas a mano se muestran todas
    if (aMano.length < 4) return { cats: ordenadas, plegadas: 0 }
    const resto = ordenadas.filter((c) => !aMano.includes(c))
    return { cats: verTodas ? [...aMano, ...resto] : aMano, plegadas: resto.length }
  }, [categoriasDe, f.tipo, usos, catInicial, verTodas])
  const set = (campo, valor) => {
    setF((x) => ({ ...x, [campo]: valor }))
    if (ia?.confianza?.[campo] && !corregidos.has(campo)) setCorregidos((c) => new Set(c).add(campo))
    if (errores[campo]) setErrores((x) => ({ ...x, [campo]: undefined }))
  }

  function cambiarTipo(tipo) {
    // La categoría elegida puede no existir en el otro tipo
    setF((x) => ({ ...x, tipo, categoria_id: catPorId(x.categoria_id).tipo === tipo ? x.categoria_id : '' }))
  }

  async function enviar(otro) {
    if (enCurso.current) return
    const e = validar(f)
    setErrores(e)
    if (Object.keys(e).length) {
      // Sacude los campos con error (también funciona si ya tenían error del intento anterior)
      for (const campo of reducido() ? [] : Object.keys(e)) {
        document.getElementById(`f-${campo}`)?.closest('.field')?.animate(SACUDIDA, { duration: 350, easing: 'ease-in-out' })
      }
      document.getElementById(`f-${Object.keys(e)[0]}`)?.focus()
      return
    }
    enCurso.current = true
    setEnviando(true)
    setErrorGeneral(null)
    try {
      const datos = {
        tipo: f.tipo,
        monto: f.monto,
        fecha: f.fecha,
        categoria_id: f.categoria_id,
        proveedor: f.proveedor.trim(),
        descripcion: f.descripcion.trim(),
        tipo_documento: f.tipo_documento,
        ...(editando ? {} : { client_request_id: requestId }),
      }
      await onGuardar(datos, { otro })
      if (otro) {
        // Mantiene tipo, fecha y documento: lo normal es cargar varias boletas del mismo día
        setF((x) => ({ ...vacio(), tipo: x.tipo, fecha: x.fecha, tipo_documento: x.tipo_documento }))
        setRequestId(nuevoId())
        montoRef.current?.focus()
      }
    } catch (err) {
      // 422 por campo → bajo cada campo; categoría de otro tipo → en la categoría; el resto, arriba del botón
      if (err.campos) setErrores(err.campos)
      else if (err.codigo === 'categoria_invalida') setErrores({ categoria_id: err.message })
      else setErrorGeneral(err.message)
    } finally {
      enCurso.current = false
      setEnviando(false)
    }
  }

  const iva = f.tipo === 'gasto' && f.tipo_documento === 'factura' && f.monto > 0 ? desglosarIva(f.monto) : null
  const esGasto = f.tipo === 'gasto'

  return (
    <form
      className={`mf ${esGasto ? 'is-gasto' : 'is-ingreso'}`}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        enviar(false)
      }}
    >
      <div className="mf-body">
        {inicial?.documento && (
          <button type="button" className="mf-adjunto" aria-expanded={verDoc} onClick={() => setVerDoc((v) => !v)}>
            <Icon name={inicial.origen === 'pdf' ? 'receipt' : 'camera'} />
            <span>
              <strong>Documento adjunto</strong>
              <small>{inicial.origen === 'pdf' ? 'PDF' : 'Foto'} guardado con este movimiento</small>
            </span>
            <span className="btn btn-text btn-sm">{verDoc ? 'Ocultar' : 'Ver'}</span>
          </button>
        )}
        {verDoc && <Documento documento={inicial.documento} altura="50vh" />}
        {/* Tipo: dos tarjetas grandes, fáciles de tocar */}
        <div className="mf-tipo" role="radiogroup" aria-label="Tipo de movimiento">
          {[
            ['gasto', 'Gasto', 'Salió plata', 'out'],
            ['ingreso', 'Ingreso', 'Entró plata', 'in'],
          ].map(([id, label, sub, ic]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={f.tipo === id}
              className={`mf-tipo-op op-${id}`}
              onClick={() => cambiarTipo(id)}
            >
              <span className="mf-tipo-ic">
                <Icon name={ic} />
              </span>
              <span>
                <strong>{label}</strong>
                <small>{sub}</small>
              </span>
            </button>
          ))}
        </div>

        {/* Monto grande en mono, con separador de miles mientras se escribe */}
        <div className="field">
          <label htmlFor="f-monto">
            Monto total <MarcaIa ia={ia} campo="monto" corregidos={corregidos} />
          </label>
          <div className={`mf-monto${errores.monto ? ' bad' : ''}`}>
            <span aria-hidden="true">{esGasto ? '−' : '+'} $</span>
            <input
              id="f-monto"
              ref={montoRef}
              data-autofocus
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={f.monto ? f.monto.toLocaleString('es-CL') : ''}
              onChange={(e) => set('monto', leerMonto(e.target.value))}
              aria-invalid={Boolean(errores.monto)}
              aria-describedby={errores.monto ? 'e-monto' : 'h-monto'}
            />
          </div>
          {errores.monto ? (
            <span className="err" id="e-monto">
              {errores.monto}
            </span>
          ) : ia?.motivos?.monto && ia.confianza.monto === 'media' && !corregidos.has('monto') ? (
            <span className="hint ia-motivo" id="h-monto">
              {ia.motivos.monto} Compáralo con la foto.
            </span>
          ) : (
            <span className="hint" id="h-monto">
              {iva ? (
                <>
                  Neto <span className="mono">{clp(iva.neto)}</span> + IVA <span className="mono">{clp(iva.iva)}</span>
                  {' '}(crédito fiscal para tu contador)
                </>
              ) : (
                'Con IVA incluido, tal como aparece en el documento.'
              )}
            </span>
          )}
        </div>

        <div className="field">
          <span className="label" id="l-cat">
            Categoría
          </span>
          {!cats.length ? (
            <SinCategorias tipo={f.tipo} />
          ) : (
            <div
              className="mf-cats"
              role="radiogroup"
              aria-labelledby="l-cat"
              aria-describedby={errores.categoria_id ? 'e-cat' : undefined}
              key={f.tipo}
            >
              {cats.map((c, i) => (
                <button
                  key={c.id}
                  id={i === 0 ? 'f-categoria_id' : undefined}
                  type="button"
                  role="radio"
                  aria-checked={f.categoria_id === c.id}
                  className={`mf-cat${errores.categoria_id ? ' bad' : ''}`}
                  style={{ '--c': c.color, '--d': `${i * 25}ms` }}
                  onClick={() => set('categoria_id', c.id)}
                >
                  <span className="dot" />
                  {c.nombre}
                  <Icon name="check" className="mf-cat-ok" />
                </button>
              ))}
              {plegadas > 0 && (
                <button type="button" className="mf-cat mf-cat-mas" aria-expanded={verTodas} onClick={() => setVerTodas((v) => !v)}>
                  {verTodas ? 'Mostrar menos' : `+ ${plegadas} más`}
                </button>
              )}
            </div>
          )}
          {errores.categoria_id ? (
            <span className="err" id="e-cat">
              {errores.categoria_id}
            </span>
          ) : ia && ia.sugerencia && f.categoria_id === ia.sugerencia.id ? (
            <span className="hint ia-hint">
              <Icon name="spark" />
              Sugerida: {ia.sugerencia.motivo}
            </span>
          ) : ia && !ia.sugerencia && !f.categoria_id ? (
            <span className="hint ia-hint">
              <Icon name="spark" />
              No encontramos una categoría parecida: elige una de la lista.
            </span>
          ) : null}
        </div>

        <div className="mf-grid">
          <div className="field">
            <label htmlFor="f-fecha">
              Fecha <MarcaIa ia={ia} campo="fecha" corregidos={corregidos} />
            </label>
            <input
              id="f-fecha"
              type="date"
              className="input mono"
              max={hoyISO()}
              value={f.fecha}
              onChange={(e) => set('fecha', e.target.value)}
              aria-invalid={Boolean(errores.fecha)}
            />
            {errores.fecha && <span className="err">{errores.fecha}</span>}
          </div>
          <div className="field">
            <span className="label">
              Documento <MarcaIa ia={ia} campo="tipo_documento" corregidos={corregidos} />
            </span>
            <Seg
              label="Tipo de documento"
              className="mf-doc"
              opciones={TIPOS_DOCUMENTO.map((t) => ({ id: t.id, label: t.id === 'otro' ? 'Otro' : t.nombre }))}
              valor={f.tipo_documento}
              onChange={(v) => set('tipo_documento', v)}
            />
            <MotivoIa ia={ia} campo="tipo_documento" corregidos={corregidos} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="f-descripcion">
            Descripción <MarcaIa ia={ia} campo="descripcion" corregidos={corregidos} />
          </label>
          <input
            id="f-descripcion"
            className="input"
            maxLength={200}
            placeholder={esGasto ? 'Ej: Pollo entero 20 kg' : 'Ej: Ventas del día'}
            value={f.descripcion}
            onChange={(e) => set('descripcion', e.target.value)}
            aria-invalid={Boolean(errores.descripcion)}
          />
          {errores.descripcion ? <span className="err">{errores.descripcion}</span> : <MotivoIa ia={ia} campo="descripcion" corregidos={corregidos} />}
        </div>

        <div className="field">
          <label htmlFor="f-proveedor">
            {esGasto ? 'Proveedor' : 'Cliente'} {ia ? <MarcaIa ia={ia} campo="proveedor" corregidos={corregidos} /> : <span className="muted">(opcional)</span>}
          </label>
          <input
            id="f-proveedor"
            className="input"
            list="proveedores"
            maxLength={150}
            autoComplete="off"
            placeholder={esGasto ? '¿A quién le compraste?' : '¿Quién te pagó?'}
            value={f.proveedor}
            onChange={(e) => set('proveedor', e.target.value)}
          />
          <MotivoIa ia={ia} campo="proveedor" corregidos={corregidos} />
          {ia?.rut && (
            <span className="hint ia-rut">
              RUT <span className="mono">{formatearRut(ia.rut)}</span> · leído del documento y validado con su dígito verificador
            </span>
          )}
          <datalist id="proveedores">
            {proveedores.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
      </div>

      {errorGeneral && (
        <p className="err mf-err" role="alert">
          {errorGeneral}
        </p>
      )}
      {confirmar ? (
        // El foco va a la barra misma (no a un botón): un Enter apurado no elimina ni cancela
        <footer
          className="mf-foot mf-confirm"
          role="alertdialog"
          aria-labelledby="mf-confirm-t"
          aria-describedby="mf-confirm-d"
          tabIndex={-1}
          ref={confirmRef}
        >
          <div className="mf-confirm-msg">
            <span className="mf-confirm-ic">
              <Icon name="trash" />
            </span>
            <div>
              <strong id="mf-confirm-t">¿Eliminar este {inicial.tipo}?</strong>
              <p id="mf-confirm-d">
                <span className="mono">{clp(inicial.monto)}</span>
                {inicial.descripcion && <> · {inicial.descripcion}</>}
              </p>
              <small>Podrás deshacerlo durante unos segundos.</small>
            </div>
          </div>
          <div className="mf-confirm-acts">
            <button type="button" className="btn btn-ghost" disabled={eliminando} onClick={() => setConfirmar(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-danger-solid"
              disabled={eliminando}
              onClick={async () => {
                setEliminando(true)
                try {
                  await onEliminar()
                } finally {
                  setEliminando(false)
                }
              }}
            >
              <Icon name="trash" />
              Sí, eliminar
            </button>
          </div>
        </footer>
      ) : (
      <footer className="mf-foot">
        {editando && (
          <button type="button" className="btn btn-danger" onClick={() => setConfirmar(true)}>
            <Icon name="trash" />
            Eliminar
          </button>
        )}
        <span className="mf-foot-space" />
        {onCancelar ? (
          <button type="button" className="btn btn-ghost" disabled={enviando} onClick={onCancelar}>
            Cancelar
          </button>
        ) : (
          !editando && (
            <button type="button" className="btn btn-ghost" disabled={enviando} onClick={() => enviar(true)}>
              Guardar y otro
            </button>
          )
        )}
        <button type="submit" className="btn btn-primary mf-save" disabled={enviando}>
          <Icon name="check" />
          {ia ? 'Confirmar y guardar' : editando ? 'Guardar cambios' : esGasto ? 'Guardar gasto' : 'Guardar ingreso'}
        </button>
      </footer>
      )}
    </form>
  )
}
