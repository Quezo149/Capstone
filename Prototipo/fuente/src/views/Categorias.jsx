import { useEffect, useState } from 'react'
import Drawer from '../components/Drawer'
import Icon from '../components/Icon'
import Seg from '../components/Seg'
import { PALETA } from '../data/categorias'
import { problemaColor } from '../lib/color'
import { useCategorias } from '../state/Categorias'
import { useSesion } from '../state/Sesion'
import { useToast } from '../state/Toasts'
import './Categorias.css'

const TIPOS = [
  { id: 'gasto', label: 'Gasto' },
  { id: 'ingreso', label: 'Ingreso' },
]

// Alta y edición, dentro del panel lateral (igual que "Nuevo movimiento").
// El tipo solo se elige al crear: después no cambia (el backend tampoco lo acepta).
function CategoriaForm({ inicial, onGuardar }) {
  const editando = Boolean(inicial)
  const [f, setF] = useState(() => inicial ?? { nombre: '', tipo: 'gasto', color: PALETA[0] })
  const [errores, setErrores] = useState({})
  const [errorGeneral, setErrorGeneral] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const set = (k, v) => {
    setF((x) => ({ ...x, [k]: v }))
    setErrores((x) => ({ ...x, [k]: undefined }))
  }
  // Se avisa apenas se elige (con el selector libre se puede llegar a negro o blanco)
  const avisoColor = problemaColor(f.color)

  async function enviar(e) {
    e.preventDefault()
    const errs = {}
    if (!f.nombre.trim()) errs.nombre = 'Escribe el nombre.'
    if (avisoColor) errs.color = avisoColor
    setErrores(errs)
    if (Object.keys(errs).length) return
    setEnviando(true)
    setErrorGeneral(null)
    try {
      await onGuardar({ nombre: f.nombre.trim(), color: f.color, ...(editando ? {} : { tipo: f.tipo }) })
    } catch (err) {
      if (err.campos) setErrores(err.campos)
      else if (err.codigo === 'categoria_repetida') setErrores({ nombre: err.message })
      else setErrorGeneral(err.message)
      setEnviando(false)
    }
  }

  return (
    <form className="mf" onSubmit={enviar} noValidate>
      <div className="mf-body">
        {!editando && (
          <div className="field">
            <span className="label">Tipo</span>
            <Seg label="Tipo de categoría" opciones={TIPOS} valor={f.tipo} onChange={(v) => set('tipo', v)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="cat-nombre">Nombre</label>
          <input
            id="cat-nombre"
            data-autofocus
            className="input"
            maxLength={50}
            placeholder={f.tipo === 'gasto' ? 'Ej: Delivery' : 'Ej: Ventas por internet'}
            value={f.nombre}
            onChange={(e) => set('nombre', e.target.value)}
            aria-invalid={Boolean(errores.nombre)}
          />
          {errores.nombre && <span className="err">{errores.nombre}</span>}
        </div>
        <div className="field">
          <span className="label" id="l-color">
            Color
          </span>
          <div className="cat-colores" role="radiogroup" aria-labelledby="l-color">
            {PALETA.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={f.color === c}
                aria-label={c}
                className="cat-color"
                style={{ '--c': c }}
                onClick={() => set('color', c)}
              />
            ))}
            <label
              className={`cat-color-libre${PALETA.includes(f.color) ? '' : ' elegido'}`}
              title="Otro color"
              style={{ '--c': f.color }}
            >
              <Icon name="pen" />
              <input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} aria-label="Otro color" />
            </label>
          </div>
          {errores.color || avisoColor ? (
            <span className="err">{errores.color ?? avisoColor}</span>
          ) : (
            <span className="hint">Se usa en los gráficos y en la lista de movimientos.</span>
          )}
        </div>

        {/* Vista previa en los dos temas: así se ve de inmediato si el color se pierde en alguno */}
        <div className="field">
          <span className="label">Vista previa</span>
          <div className="cat-preview">
            {['claro', 'oscuro'].map((tema) => (
              <div key={tema} className={`cat-preview-tema ${tema}`} style={{ '--c': f.color }}>
                <span className="cat-preview-fila">
                  <span className="dot" />
                  <span>{f.nombre.trim() || 'Nombre de la categoría'}</span>
                </span>
                <span className="cat-preview-barra">
                  <i />
                </span>
                <small>Tema {tema}</small>
              </div>
            ))}
          </div>
        </div>
      </div>

      {errorGeneral && (
        <p className="err mf-err" role="alert">
          {errorGeneral}
        </p>
      )}
      <footer className="mf-foot">
        <span className="mf-foot-space" />
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          <Icon name="check" />
          {editando ? 'Guardar cambios' : 'Crear categoría'}
        </button>
      </footer>
    </form>
  )
}

function Fila({ c, admin, editando, onEditar, onEliminar }) {
  // Eliminar pide un segundo clic dentro de 3 s
  const [confirmar, setConfirmar] = useState(false)
  useEffect(() => {
    if (!confirmar) return
    const t = setTimeout(() => setConfirmar(false), 3000)
    return () => clearTimeout(t)
  }, [confirmar])

  return (
    <li className={editando ? 'activa' : ''}>
      <span className="dot" style={{ color: c.color }} />
      <span className="cat-nombre">{c.nombre}</span>
      {c.predefinida ? (
        <span className="chip line">Predefinida</span>
      ) : (
        admin && (
          <span className="cat-acts">
            <button type="button" className="icon-btn" onClick={onEditar} aria-label={`Editar ${c.nombre}`} title="Editar">
              <Icon name="pen" />
            </button>
            <button
              type="button"
              className={`btn btn-sm ${confirmar ? 'btn-danger' : 'btn-text'}`}
              onClick={() => (confirmar ? onEliminar() : setConfirmar(true))}
              aria-label={`Eliminar ${c.nombre}`}
            >
              {confirmar ? '¿Eliminar?' : <Icon name="trash" />}
            </button>
          </span>
        )
      )}
    </li>
  )
}

// HU14 — KONTADORIA-37. Todos los roles ven las categorías; solo el admin crea, edita y elimina.
export default function Categorias() {
  const { puede } = useSesion()
  const { categorias, cargando, error, crear, editar, eliminar } = useCategorias()
  const { aviso } = useToast()
  const admin = puede('categorias.gestionar')
  // null = sin formulario · 'nueva' · id de la categoría en edición
  const [form, setForm] = useState(null)

  async function guardar(datos) {
    if (form === 'nueva') {
      const c = await crear(datos)
      aviso(`Categoría "${c.nombre}" creada`)
    } else {
      await editar(form, datos)
      aviso('Cambios guardados')
    }
    setForm(null)
  }

  async function quitar(c) {
    try {
      await eliminar(c.id)
      aviso(`Eliminamos "${c.nombre}"`)
    } catch (e) {
      aviso(e.message)
    }
  }

  const enEdicion = categorias.find((c) => c.id === form)

  return (
    <section className="cat-page rise">
      <div className="page-head">
        <div>
          <span className="eyebrow">Configuración</span>
          <h1>Categorías</h1>
        </div>
        {admin && (
          <button type="button" className="btn btn-primary" onClick={() => setForm('nueva')}>
            <Icon name="plus" />
            Nueva categoría
          </button>
        )}
      </div>

      {!admin && <p className="muted">Solo el administrador puede crear o modificar categorías.</p>}
      {error && <p className="acceso-aviso">{error}</p>}
      {cargando && <p className="muted">Cargando…</p>}


      <div className="grid-2 cat-grid">
        {TIPOS.map((t) => (
          <div className="card" key={t.id}>
            <div className="card-head">
              <h2>{t.id === 'gasto' ? 'Gastos' : 'Ingresos'}</h2>
            </div>
            <ul className="cat-lista">
              {categorias
                .filter((c) => c.tipo === t.id)
                .map((c) => (
                  <Fila
                    key={c.id}
                    c={c}
                    admin={admin}
                    editando={form === c.id}
                    onEditar={() => setForm(c.id)}
                    onEliminar={() => quitar(c)}
                  />
                ))}
            </ul>
          </div>
        ))}
      </div>

      <Drawer
        abierto={form !== null}
        onCerrar={() => setForm(null)}
        eyebrow={enEdicion ? 'Editar' : 'Categorías'}
        titulo={enEdicion ? enEdicion.nombre : 'Nueva categoría'}
        ancho={440}
      >
        {form !== null && <CategoriaForm key={form} inicial={enEdicion} onGuardar={guardar} />}
      </Drawer>
    </section>
  )
}
