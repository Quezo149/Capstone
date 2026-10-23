import { useCallback, useEffect, useState } from 'react'
import Drawer from '../components/Drawer'
import Icon from '../components/Icon'
import Seg from '../components/Seg'
import { NOMBRE_ROL } from '../data/demo'
import { api } from '../lib/api'
import { linkInvitacion } from '../lib/invitacion'
import { useSesion } from '../state/Sesion'
import { useToast } from '../state/Toasts'
import './Equipo.css'

const ROLES = [
  { id: 'empleado', label: NOMBRE_ROL.empleado, ayuda: 'Registra sus ingresos y gastos, y ve solo los suyos.' },
  { id: 'contador', label: NOMBRE_ROL.contador, ayuda: 'Ve y filtra todos los movimientos. No registra ni modifica.' },
  { id: 'admin', label: NOMBRE_ROL.admin, ayuda: 'Puede todo: movimientos, categorías, empresa y equipo.' },
]

const fechaHora = (iso) =>
  new Date(iso).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function venceEn(iso) {
  const horas = Math.round((new Date(iso) - Date.now()) / 3_600_000)
  if (horas <= 0) return 'Vencida'
  return horas < 24 ? `Vence en ${horas} h` : `Vence el ${fechaHora(iso)}`
}

// Botón que pide un segundo clic dentro de 3 s (mismo patrón que eliminar categoría)
function Confirmar({ children, pregunta, onConfirmar, className = 'btn-text' }) {
  const [armado, setArmado] = useState(false)
  useEffect(() => {
    if (!armado) return
    const t = setTimeout(() => setArmado(false), 3000)
    return () => clearTimeout(t)
  }, [armado])
  return (
    <button
      type="button"
      className={`btn btn-sm ${armado ? 'btn-danger' : className}`}
      onClick={() => (armado ? (setArmado(false), onConfirmar()) : setArmado(true))}
    >
      {armado ? pregunta : children}
    </button>
  )
}

// Panel de invitar: primero el formulario; al crear, el link (se muestra una sola vez)
function Invitar({ inicial, onCreada, onCerrar }) {
  const [f, setF] = useState(() => inicial ?? { email: '', rol: 'empleado' })
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [creada, setCreada] = useState(null) // { invitacion, link }
  const { aviso } = useToast()

  async function enviar(e) {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setError('Escribe un correo válido.')
    setEnviando(true)
    setError(null)
    try {
      const r = await api('/invitaciones', { method: 'POST', body: { email: f.email.trim(), rol: f.rol } })
      setCreada({ invitacion: r.invitacion, link: linkInvitacion(r.token) })
      onCreada(r.invitacion)
    } catch (err) {
      setError(err.campos ? 'Escribe un correo válido.' : err.message)
    } finally {
      setEnviando(false)
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(creada.link)
      aviso('Link copiado')
    } catch {
      // Sin permiso de portapapeles (HTTP en la red local): se selecciona para copiar a mano
      document.getElementById('inv-link')?.select()
    }
  }

  if (creada) {
    const { invitacion, link } = creada
    const mensaje = `Te invito a unirte a nuestro equipo en KontadorIA como ${NOMBRE_ROL[invitacion.rol]}: ${link}`
    return (
      <div className="mf">
        <div className="mf-body">
          <div className="inv-ok">
            <span className="inv-ok-ic">
              <Icon name="check" />
            </span>
            <p>
              Invitación lista para <strong>{invitacion.email}</strong> como <strong>{NOMBRE_ROL[invitacion.rol]}</strong>.
              Compártele este link:
            </p>
          </div>
          <div className="field">
            <label htmlFor="inv-link">Link de invitación</label>
            <div className="inv-link">
              <input id="inv-link" className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-primary" onClick={copiar}>
                Copiar
              </button>
            </div>
            <span className="hint">
              Sirve una sola vez, solo con ese correo, y vence el {fechaHora(invitacion.expira_en)}. Por seguridad no lo
              volveremos a mostrar: si se pierde, genera uno nuevo.
            </span>
          </div>
          <a className="btn btn-ghost inv-wsp" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer">
            Enviar por WhatsApp
          </a>
        </div>
        <footer className="mf-foot">
          <span className="mf-foot-space" />
          <button type="button" className="btn btn-primary" onClick={onCerrar}>
            Listo
          </button>
        </footer>
      </div>
    )
  }

  const rol = ROLES.find((r) => r.id === f.rol)
  return (
    <form className="mf" onSubmit={enviar} noValidate>
      <div className="mf-body">
        <div className="field">
          <label htmlFor="inv-email">Correo</label>
          <input
            id="inv-email"
            data-autofocus
            className="input"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="persona@correo.cl"
            value={f.email}
            onChange={(e) => (setF((x) => ({ ...x, email: e.target.value })), setError(null))}
            aria-invalid={Boolean(error)}
          />
          <span className="hint">Debe iniciar sesión con este mismo correo para unirse.</span>
        </div>
        <div className="field">
          <span className="label">Rol</span>
          <Seg label="Rol" opciones={ROLES} valor={f.rol} onChange={(v) => setF((x) => ({ ...x, rol: v }))} />
          <span className="hint">{rol.ayuda}</span>
        </div>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="mf-foot">
        <span className="mf-foot-space" />
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          <Icon name="check" />
          Crear invitación
        </button>
      </footer>
    </form>
  )
}

// HU02 — KONTADORIA-42. El admin invita, ve las invitaciones abiertas, cambia roles y desactiva.
// El contador ve el equipo en solo lectura; el empleado no entra (la sección no se le muestra).
export default function Equipo() {
  const { perfil, puede, refrescar } = useSesion()
  const { aviso } = useToast()
  const admin = puede('usuarios.gestionar')
  const [usuarios, setUsuarios] = useState(null)
  const [invitaciones, setInvitaciones] = useState([])
  const [error, setError] = useState(null)
  // null = cerrado · {} = nueva · { email, rol } = nuevo link para una existente
  const [panel, setPanel] = useState(null)

  const cargar = useCallback(() => {
    api('/usuarios')
      .then(setUsuarios)
      .catch((e) => setError(e.message))
    if (admin) api('/invitaciones').then(setInvitaciones).catch(() => {})
  }, [admin])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Cambios de rol o de estado. Si es sobre uno mismo, la sesión se refresca (cambian los permisos).
  async function cambiar(u, ruta, body, mensaje) {
    try {
      const nuevo = await api(`/usuarios/${u.id}/${ruta}`, { method: 'PUT', body })
      setUsuarios((l) => l.map((x) => (x.id === u.id ? nuevo : x)))
      aviso(mensaje)
      if (u.id === perfil.usuario_id) await refrescar()
    } catch (e) {
      aviso(e.message)
    }
  }

  async function revocar(inv) {
    try {
      await api(`/invitaciones/${inv.id}`, { method: 'DELETE' })
      setInvitaciones((l) => l.filter((x) => x.id !== inv.id))
      aviso('Invitación anulada')
    } catch (e) {
      aviso(e.message)
    }
  }

  return (
    <section className="eq-page rise">
      <div className="page-head">
        <div>
          <span className="eyebrow">Configuración</span>
          <h1>Equipo</h1>
        </div>
        {admin && (
          <button type="button" className="btn btn-primary" onClick={() => setPanel({})}>
            <Icon name="plus" />
            Invitar
          </button>
        )}
      </div>

      {!admin && <p className="muted">Solo el administrador puede invitar personas o cambiar roles.</p>}
      {error && <p className="acceso-aviso">{error}</p>}

      <div className="card">
        <div className="card-head">
          <h2>Personas</h2>
          {usuarios && <span className="muted">{usuarios.filter((u) => u.activo).length} activas</span>}
        </div>
        {!usuarios && !error && <p className="muted">Cargando…</p>}
        <ul className="eq-lista">
          {usuarios?.map((u) => {
            const yo = u.id === perfil.usuario_id
            return (
              <li key={u.id} className={u.activo ? '' : 'inactivo'}>
                <span className="eq-quien">
                  <strong>
                    {u.nombre || u.email}
                    {yo && <span className="chip line">Tú</span>}
                    {!u.activo && <span className="chip warn">Desactivado</span>}
                  </strong>
                  {u.nombre && <small className="muted">{u.email}</small>}
                </span>
                {admin ? (
                  <span className="eq-acts">
                    <select
                      className="input eq-rol"
                      value={u.rol}
                      aria-label={`Rol de ${u.nombre || u.email}`}
                      onChange={(e) => cambiar(u, 'rol', { rol: e.target.value }, 'Rol actualizado')}
                    >
                      {ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    {u.activo ? (
                      <Confirmar
                        pregunta="¿Desactivar?"
                        onConfirmar={() => cambiar(u, 'activo', { activo: false }, 'Usuario desactivado: ya no puede entrar')}
                      >
                        Desactivar
                      </Confirmar>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => cambiar(u, 'activo', { activo: true }, 'Usuario reactivado')}
                      >
                        Reactivar
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="chip line">{NOMBRE_ROL[u.rol]}</span>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {admin && invitaciones.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Invitaciones abiertas</h2>
          </div>
          <ul className="eq-lista">
            {invitaciones.map((inv) => (
              <li key={inv.id}>
                <span className="eq-quien">
                  <strong>
                    {inv.email}
                    <span className="chip line">{NOMBRE_ROL[inv.rol]}</span>
                  </strong>
                  <small className={inv.estado === 'vencida' ? 'eq-vencida' : 'muted'}>
                    {inv.estado === 'vencida' ? 'Vencida' : venceEn(inv.expira_en)} · invitó {inv.invitado_por}
                  </small>
                </span>
                <span className="eq-acts">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPanel({ email: inv.email, rol: inv.rol })}>
                    Nuevo link
                  </button>
                  <Confirmar pregunta="¿Anular?" onConfirmar={() => revocar(inv)}>
                    Anular
                  </Confirmar>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Drawer abierto={panel !== null} onCerrar={() => setPanel(null)} eyebrow="Equipo" titulo="Invitar a tu equipo" ancho={460}>
        {panel !== null && (
          <Invitar
            key={JSON.stringify(panel)}
            inicial={panel.email ? panel : null}
            // Un link nuevo anula el anterior para el mismo correo (backend): se recarga la lista
            onCreada={() => api('/invitaciones').then(setInvitaciones).catch(() => {})}
            onCerrar={() => setPanel(null)}
          />
        )}
      </Drawer>
    </section>
  )
}
