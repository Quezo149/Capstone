import { useState } from 'react'
import { urlDocumento } from '../lib/documentos'
import Icon from './Icon'
import Seg from './Seg'

// Muestra el documento de un movimiento (o el que se está revisando). En los ejemplos permite
// ver dónde leyó la IA cada dato: en las fotos reales, con las posiciones que devolvió
// Document Intelligence (la app real puede hacer lo mismo: cada campo trae su polígono).
const ETIQUETAS = { proveedor: 'Proveedor', rut: 'RUT', tipo_documento: 'Tipo', fecha: 'Fecha', monto: 'Total' }
export function Documento({ documento, resaltable = false, altura }) {
  const [vista, setVista] = useState('ia')
  if (documento?.pdf) {
    return (
      <div className="doc-pdf">
        <Icon name="receipt" />
        <strong>{documento.pdf}</strong>
        <small>PDF guardado. En la app real se abre en una pestaña nueva.</small>
      </div>
    )
  }
  const cajas = documento?.foto ? Object.entries(documento.cajas ?? {}).filter(([, c]) => c) : []
  const marcable = resaltable && ((Boolean(documento?.plantilla) && !documento.borrosa) || cajas.length > 0)
  const url = urlDocumento(documento, { resaltar: marcable && vista === 'ia' })
  return (
    <div className="doc-visor">
      {marcable && (
        <Seg
          label="Vista del documento"
          opciones={[
            { id: 'ia', label: 'Lo que leyó la IA' },
            { id: 'original', label: 'Original' },
          ]}
          valor={vista}
          onChange={setVista}
        />
      )}
      <div className="doc-img" style={altura ? { maxHeight: altura } : undefined}>
        {!url ? (
          <p className="muted">No se pudo mostrar la imagen.</p>
        ) : cajas.length ? (
          <div className="doc-foto">
            <img src={url} alt="Documento cargado" />
            {marcable &&
              vista === 'ia' &&
              cajas.map(([campo, [x, y, w, h]]) => (
                <span
                  key={campo}
                  className={`doc-caja caja-${campo}`}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
                >
                  <em>{ETIQUETAS[campo]}</em>
                </span>
              ))}
          </div>
        ) : (
          <img src={url} alt="Documento cargado" />
        )}
      </div>
    </div>
  )
}
