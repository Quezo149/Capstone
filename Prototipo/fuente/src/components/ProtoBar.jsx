import { useEffect, useReducer, useState } from 'react'
import { NOMBRE_ROL } from '../data/demo'
import Icon from './Icon'
import { cambiarModo, entrarComo, esProduccion, leerDb, reiniciar, rolActual, usuarioSesion, verComo } from '../lib/proto'
import './ProtoBar.css'

// PROTOTIPO: aviso fijo con el ambiente (demo con datos de ejemplo / producción vacía) y la persona
// con la que se ve la app: en demo, una de ejemplo por rol; en producción, los miembros del equipo
// (el dueño y quienes aceptaron una invitación en este navegador)
export default function ProtoBar() {
  const [, refrescar] = useReducer((n) => n + 1, 0)
  // En el celular la barra va plegada en la cabecera; en el escritorio siempre se ve completa
  const [abierta, setAbierta] = useState(false)
  useEffect(() => {
    window.addEventListener('proto-db', refrescar)
    return () => window.removeEventListener('proto-db', refrescar)
  }, [])
  const db = leerDb()
  const propio = usuarioSesion(db)
  const equipo = db.empresa ? db.usuarios.filter((u) => u.activo !== false || u.id === propio?.id) : []
  return (
    <aside className={`proto-bar${esProduccion ? ' prod' : ''}${abierta ? ' abierta' : ''}`} aria-label="Controles del prototipo">
      <strong className="proto-titulo">Prototipo</strong>
      <button type="button" className="proto-toggle" aria-expanded={abierta} onClick={() => setAbierta((x) => !x)}>
        {abierta ? 'Cerrar' : esProduccion ? 'Prod.' : 'Demo'}
        {abierta && <Icon name="x" />}
      </button>
      <label>
        <span>Ambiente</span>
        <select value={esProduccion ? 'produccion' : 'demo'} onChange={(e) => cambiarModo(e.target.value)}>
          <option value="demo">Demo</option>
          <option value="produccion">Producción</option>
        </select>
      </label>
      {esProduccion ? (
        equipo.length > 1 && (
          <label>
            <span>Entrar como</span>
            <select value={propio?.id ?? 'u-admin'} onChange={(e) => entrarComo(e.target.value)}>
              {equipo.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} ({NOMBRE_ROL[u.rol]})
                </option>
              ))}
            </select>
          </label>
        )
      ) : (
        <label>
          <span>Ver como</span>
          <select value={propio ? 'propio' : rolActual()} onChange={(e) => verComo(e.target.value)}>
            {propio && (
              <option value="propio" disabled>
                {propio.nombre} ({NOMBRE_ROL[propio.rol]})
              </option>
            )}
            {Object.entries(NOMBRE_ROL).map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={reiniciar}
        title={esProduccion ? 'Reiniciar: borra todo y vuelve a registrar la empresa' : 'Reiniciar: vuelve a los datos de ejemplo'}
        aria-label={esProduccion ? 'Reiniciar producción desde cero' : 'Reiniciar datos de ejemplo'}
      >
        <Icon name="undo" />
      </button>
    </aside>
  )
}
