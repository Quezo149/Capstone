import { useMemo, useRef, useState } from 'react'
import { categoria as catPorId, categoriasDe, TIPOS_DOCUMENTO } from '../data/categorias'
import { nuevoId } from '../data/movimientos'
import { clp, desglosarIva, hoyISO, leerMonto } from '../lib/format'
import Icon from './Icon'
import Seg from './Seg'
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

// Formulario de alta y edición. `inicial` = movimiento a editar, o null para uno nuevo.
// onGuardar(datos, { otro }) → `otro` true cuando el usuario quiere seguir cargando.
export default function MovimientoForm({ inicial, proveedores = [], onGuardar, onEliminar }) {
  const editando = Boolean(inicial)
  const [f, setF] = useState(() => (inicial ? { ...inicial } : vacio()))
  // Se genera una vez por formulario abierto: si el guardado se repite, no se duplica
  const [requestId, setRequestId] = useState(nuevoId)
  const [errores, setErrores] = useState({})
  const [enviando, setEnviando] = useState(false)
  // Candado inmediato: `enviando` (estado) recién se actualiza en el próximo render, así que
  // un doble clic rápido alcanzaba a enviar dos veces. La ref cambia en el acto.
  const enCurso = useRef(false)
  const montoRef = useRef(null)

  const cats = useMemo(() => categoriasDe(f.tipo), [f.tipo])
  const set = (campo, valor) => {
    setF((x) => ({ ...x, [campo]: valor }))
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
          <label htmlFor="f-monto">Monto total</label>
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
          </div>
          {errores.categoria_id && (
            <span className="err" id="e-cat">
              {errores.categoria_id}
            </span>
          )}
        </div>

        <div className="mf-grid">
          <div className="field">
            <label htmlFor="f-fecha">Fecha</label>
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
            <span className="label">Documento</span>
            <Seg
              label="Tipo de documento"
              className="mf-doc"
              opciones={TIPOS_DOCUMENTO.map((t) => ({ id: t.id, label: t.id === 'otro' ? 'Otro' : t.nombre }))}
              valor={f.tipo_documento}
              onChange={(v) => set('tipo_documento', v)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="f-descripcion">Descripción</label>
          <input
            id="f-descripcion"
            className="input"
            maxLength={200}
            placeholder={esGasto ? 'Ej: Pollo entero 20 kg' : 'Ej: Ventas del día'}
            value={f.descripcion}
            onChange={(e) => set('descripcion', e.target.value)}
            aria-invalid={Boolean(errores.descripcion)}
          />
          {errores.descripcion && <span className="err">{errores.descripcion}</span>}
        </div>

        <div className="field">
          <label htmlFor="f-proveedor">
            {esGasto ? 'Proveedor' : 'Cliente'} <span className="muted">(opcional)</span>
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
          <datalist id="proveedores">
            {proveedores.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
      </div>

      <footer className="mf-foot">
        {editando && (
          <button type="button" className="btn btn-danger" onClick={onEliminar}>
            <Icon name="trash" />
            Eliminar
          </button>
        )}
        <span className="mf-foot-space" />
        {!editando && (
          <button type="button" className="btn btn-ghost" disabled={enviando} onClick={() => enviar(true)}>
            Guardar y otro
          </button>
        )}
        <button type="submit" className="btn btn-primary mf-save" disabled={enviando}>
          <Icon name="check" />
          {editando ? 'Guardar cambios' : esGasto ? 'Guardar gasto' : 'Guardar ingreso'}
        </button>
      </footer>
    </form>
  )
}
