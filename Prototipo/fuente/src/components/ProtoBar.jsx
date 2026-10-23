import { NOMBRE_ROL } from '../data/demo'
import Icon from './Icon'
import { reiniciar, rolActual, verComo } from '../lib/proto'
import './ProtoBar.css'

// PROTOTIPO: aviso fijo con el selector de rol, para ver la app como cada persona del equipo
export default function ProtoBar() {
  return (
    <aside className="proto-bar" aria-label="Controles del prototipo">
      <strong>Prototipo</strong>
      <label>
        <span>Ver como</span>
        <select value={rolActual()} onChange={(e) => verComo(e.target.value)}>
          {Object.entries(NOMBRE_ROL).map(([id, nombre]) => (
            <option key={id} value={id}>
              {nombre}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={reiniciar} title="Reiniciar: vuelve a los datos de ejemplo" aria-label="Reiniciar datos de ejemplo">
        <Icon name="undo" />
      </button>
    </aside>
  )
}
