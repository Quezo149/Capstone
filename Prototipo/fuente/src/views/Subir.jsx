import { useCallback, useEffect, useState } from 'react'
import Seg from '../components/Seg'
import Cargar from './Cargar'
import Importar from './Importar'
import './Subir.css'

// PROTOTIPO: en el celular, "Cargar" sube boletas o planillas con un selector arriba (por defecto,
// boleta). Cada opción usa su propio motor: Cargar (lectura con IA) o Importar (planillas).
// En el escritorio Importar sigue en el menú lateral, así que el selector solo se ve en el celular.
// La opción vive en la URL (#/cargar?tipo=planilla) para que funcione el botón atrás.
const leerTipo = () => (new URLSearchParams(window.location.hash.split('?')[1]).get('tipo') === 'planilla' ? 'planilla' : 'boleta')

const OPCIONES = [
  { id: 'boleta', label: 'Boleta o factura' },
  { id: 'planilla', label: 'Planilla' },
]

// importa: el rol puede importar planillas (si no, solo boletas y sin selector)
export default function Subir({ proveedores, importa }) {
  const [tipo, setTipo] = useState(leerTipo)
  // Con una lectura o una importación en curso el selector se esconde: cambiar perdería el avance
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    const onHash = () => setTipo(leerTipo())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const planilla = importa && tipo === 'planilla'
  const onCargar = useCallback((etapa) => setOcupado(etapa !== 'elegir'), [])
  const onImportar = useCallback((etapa) => setOcupado(!['subir', 'listo'].includes(etapa)), [])

  function elegir(t) {
    setOcupado(false)
    window.location.hash = t === 'planilla' ? '#/cargar?tipo=planilla' : '#/cargar'
  }

  return (
    <>
      {importa && !ocupado && (
        <Seg className="subir-sel solo-movil" label="Qué vas a subir" opciones={OPCIONES} valor={planilla ? 'planilla' : 'boleta'} onChange={elegir} />
      )}
      {planilla ? <Importar key="planilla" incrustado onEtapa={onImportar} /> : <Cargar key="boleta" proveedores={proveedores} onEtapa={onCargar} />}
    </>
  )
}
