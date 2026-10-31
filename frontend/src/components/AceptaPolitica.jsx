import { LINK_POLITICA } from '../data/politica'

// Casilla de consentimiento (Ley 19.628 art. 4 / Ley 21.719): sin marcar por defecto y obligatoria.
// Registrarse no implica aceptar: tiene que ser una acción expresa de la persona. El backend
// guarda versión y fecha (usuarios.politica_version / politica_aceptada_en).
export default function AceptaPolitica({ id = 'acepta-politica', marcada, onCambio, error }) {
  return (
    <div className="field">
      <label className="check-politica" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={marcada}
          onChange={(e) => onCambio(e.target.checked)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
        />
        <span>
          Acepto la{' '}
          <a href={LINK_POLITICA} target="_blank" rel="noreferrer">
            política de privacidad
          </a>{' '}
          y autorizo el tratamiento de mis datos y los de mi empresa para usar KontadorIA, incluido su almacenamiento
          en servidores de Microsoft Azure en Estados Unidos.
        </span>
      </label>
      {error && (
        <span className="err" id={`${id}-err`}>
          {error}
        </span>
      )}
    </div>
  )
}
