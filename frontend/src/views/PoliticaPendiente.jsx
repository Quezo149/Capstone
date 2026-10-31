import { useState } from 'react'
import AceptaPolitica from '../components/AceptaPolitica'
import { LINK_POLITICA, VERSION as POLITICA_VERSION } from '../data/politica'
import { api, ApiError } from '../lib/api'
import { useSesion } from '../state/Sesion'
import { Marco } from './Acceso'

// Cuentas creadas antes de pedir el consentimiento, o que aceptaron una versión anterior de la
// política: el backend responde "politica_pendiente" en todo hasta que la acepten aquí.
export default function PoliticaPendiente() {
  const { refrescar, salir } = useSesion()
  const [marcada, setMarcada] = useState(false)
  const [error, setError] = useState(null)
  const [general, setGeneral] = useState(null)
  const [enviando, setEnviando] = useState(false)

  async function aceptar() {
    if (!marcada) {
      setError('Para seguir usando KontadorIA tienes que aceptar la política de privacidad.')
      document.getElementById('acepta-politica')?.focus()
      return
    }
    setEnviando(true)
    setGeneral(null)
    try {
      await api('/auth/politica', { method: 'POST', body: { acepta_politica: true, politica_version: POLITICA_VERSION } })
      await refrescar()
    } catch (e) {
      setGeneral(e instanceof ApiError ? e.message : 'Algo salió mal. Intenta de nuevo.')
      setEnviando(false)
    }
  }

  return (
    <Marco titulo="Actualizamos nuestra política de privacidad" eyebrow="Antes de seguir">
      <p className="muted">
        Explicamos qué datos guardamos de ti y de tu empresa, para qué los usamos y dónde se almacenan. Para seguir
        usando KontadorIA necesitamos que la leas y la aceptes.{' '}
        <a className="link-politica" href={LINK_POLITICA} target="_blank" rel="noreferrer">
          Leer la política
        </a>
      </p>
      <AceptaPolitica
        marcada={marcada}
        onCambio={(v) => {
          setMarcada(v)
          if (v) setError(null)
        }}
        error={error}
      />
      {general && <p className="acceso-aviso">{general}</p>}
      <div className="acceso-acts">
        <button type="button" className="btn btn-primary" disabled={enviando} onClick={aceptar}>
          {enviando ? 'Guardando…' : 'Continuar'}
        </button>
        <button type="button" className="btn btn-text" onClick={salir}>
          Cerrar sesión
        </button>
      </div>
    </Marco>
  )
}
