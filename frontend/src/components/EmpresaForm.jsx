import { useRef, useState } from 'react'
import { ApiError } from '../lib/api'
import { errorRut, formatearRut } from '../lib/rut'

const MENSAJES = {
  rut_registrado: { rut: 'Ya existe una empresa registrada con ese RUT.' },
}

function validar(f) {
  const e = {}
  if (!f.nombre.trim()) e.nombre = 'Escribe el nombre de tu empresa.'
  const rut = errorRut(f.rut)
  if (rut) e.rut = rut
  return e
}

// Datos de la empresa: nombre, RUT y giro (opcional). Lo usan el registro (HU17) y Mi empresa (HU04).
// onGuardar recibe { nombre, rut, giro } y lanza ApiError si el backend rechaza algo.
export default function EmpresaForm({ inicial, textoBoton, onGuardar, onCancelar }) {
  const [f, setF] = useState(() => ({ nombre: inicial?.nombre ?? '', rut: inicial?.rut ?? '', giro: inicial?.giro ?? '' }))
  const [errores, setErrores] = useState({})
  const [general, setGeneral] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const enCurso = useRef(false)

  const set = (campo, valor) => {
    setF((x) => ({ ...x, [campo]: valor }))
    if (errores[campo]) setErrores((x) => ({ ...x, [campo]: undefined }))
  }

  async function enviar(ev) {
    ev.preventDefault()
    if (enCurso.current) return
    const e = validar(f)
    setErrores(e)
    setGeneral(null)
    if (Object.keys(e).length) {
      document.getElementById(`emp-${Object.keys(e)[0]}`)?.focus()
      return
    }
    enCurso.current = true
    setEnviando(true)
    try {
      await onGuardar({ nombre: f.nombre.trim(), rut: f.rut, giro: f.giro.trim() || null })
    } catch (err) {
      if (err instanceof ApiError && MENSAJES[err.codigo]) setErrores(MENSAJES[err.codigo])
      else if (err instanceof ApiError && err.campos) setErrores(err.campos)
      else setGeneral(err instanceof ApiError ? err.message : 'Algo salió mal. Intenta de nuevo.')
    } finally {
      enCurso.current = false
      setEnviando(false)
    }
  }

  const campo = (id, label, props, extra) => (
    <div className="field">
      <label htmlFor={`emp-${id}`}>
        {label}
        {extra}
      </label>
      <input
        id={`emp-${id}`}
        className="input"
        value={f[id]}
        aria-invalid={Boolean(errores[id])}
        aria-describedby={errores[id] ? `emp-${id}-err` : undefined}
        {...props}
      />
      {errores[id] && (
        <span className="err" id={`emp-${id}-err`}>
          {errores[id]}
        </span>
      )}
    </div>
  )

  return (
    <form className="acceso-form" onSubmit={enviar} noValidate>
      {campo('nombre', 'Nombre de la empresa', { maxLength: 150, autoComplete: 'organization', onChange: (e) => set('nombre', e.target.value) })}
      {campo('rut', 'RUT de la empresa', {
        inputMode: 'text',
        placeholder: '12.345.678-5',
        className: 'input mono',
        onChange: (e) => set('rut', formatearRut(e.target.value)),
      })}
      {campo(
        'giro',
        'Giro',
        { maxLength: 150, placeholder: 'Ej.: venta de comida', onChange: (e) => set('giro', e.target.value) },
        <span className="opcional"> (opcional)</span>,
      )}
      {general && <p className="acceso-aviso">{general}</p>}
      <div className="form-acts">
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? 'Guardando…' : textoBoton}
        </button>
        {onCancelar && (
          <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}
