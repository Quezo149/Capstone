import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { NOMBRE_ROL } from '../data/demo'
import { api } from '../lib/api'
import { olvidarInvitacion } from '../lib/invitacion'
import { useSesion } from '../state/Sesion'
import { Marco } from './Acceso'

// Qué puede hacer cada rol, en palabras del invitado (tabla de roles, app/core/permisos.py)
const QUE_PUEDE = {
  admin: 'Podrás registrar movimientos, ver todo y administrar la empresa y su equipo.',
  contador: 'Podrás ver y filtrar todos los movimientos de la empresa.',
  empleado: 'Podrás registrar tus ingresos y gastos, y ver los que tú registraste.',
}

const NO_VIGENTE = {
  usada: 'Este link ya se usó.',
  revocada: 'Esta invitación fue anulada.',
  vencida: 'Este link venció: dura 72 horas.',
}

// HU02 — KONTADORIA-40. Pantalla de quien abre un link de invitación. Sin sesión: quién lo
// invita y con qué rol, y los botones para entrar o crear su cuenta con el correo invitado.
// Con sesión: confirmar y unirse. El backend valida correo, vigencia y un solo uso.
// onTerminar: la invitación ya no aplica (aceptada, inválida o descartada); Raiz deja de mostrarla.
export default function Invitacion({ token, onTerminar }) {
  const { estado, entrar, salir, refrescar } = useSesion()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null) // { mensaje, salir? }
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    api(`/invitaciones/publica/${token}`, { publica: true })
      .then(setInfo)
      .catch((e) => setError({ mensaje: e.message }))
  }, [token])

  // Seguir a la app (o al registro) sin la invitación
  async function continuar() {
    olvidarInvitacion()
    onTerminar()
    if (estado !== 'anonimo') await refrescar()
  }

  async function aceptar() {
    setEnviando(true)
    setError(null)
    try {
      await api('/invitaciones/aceptar', { method: 'POST', body: { token } })
      olvidarInvitacion()
      await refrescar() // ahora /auth/me trae la empresa y el rol: entra a la app
      onTerminar()
    } catch (e) {
      // Con otro correo se ofrece cerrar sesión y la invitación se conserva para el reintento
      setError({ mensaje: e.message, salir: e.codigo === 'correo_distinto', fin: e.codigo !== 'correo_distinto' })
      setEnviando(false)
    }
  }

  if (!info && !error) return <Marco titulo="Abriendo tu invitación…" eyebrow="Invitación" />

  if (!info || NO_VIGENTE[info.estado]) {
    return (
      <Marco titulo="Esta invitación no sirve" eyebrow="Invitación">
        <p className="acceso-aviso">{info ? `${NO_VIGENTE[info.estado]} Pide uno nuevo a quien te invitó.` : error.mensaje}</p>
        <div className="acceso-acts">
          <button type="button" className="btn btn-ghost" onClick={continuar}>
            Continuar sin la invitación
          </button>
        </div>
      </Marco>
    )
  }

  return (
    <Marco titulo={`${info.empresa} te invitó a su equipo`} eyebrow="Invitación">
      <div className="inv-rol">
        <span className="chip">{NOMBRE_ROL[info.rol]}</span>
        <p className="muted">{QUE_PUEDE[info.rol]}</p>
      </div>

      {error && <p className="acceso-aviso">{error.mensaje}</p>}

      {estado === 'anonimo' ? (
        <>
          <p className="muted">
            Entra o crea tu cuenta con <strong>{info.email}</strong>: la invitación es solo para ese correo.
          </p>
          <div className="acceso-acts">
            <button type="button" className="btn btn-primary" onClick={() => entrar({ correo: info.email })}>
              <Icon name="lock" />
              Ya tengo cuenta: iniciar sesión
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => entrar({ crear: true, correo: info.email })}>
              Crear mi cuenta
            </button>
          </div>
        </>
      ) : (
        <div className="acceso-acts">
          {error?.salir ? (
            <button type="button" className="btn btn-primary" onClick={salir}>
              Cerrar sesión y entrar con {info.email}
            </button>
          ) : error?.fin ? (
            <button type="button" className="btn btn-ghost" onClick={continuar}>
              Continuar sin la invitación
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={enviando} onClick={aceptar}>
              <Icon name="check" />
              Unirme a {info.empresa}
            </button>
          )}
        </div>
      )}
    </Marco>
  )
}
