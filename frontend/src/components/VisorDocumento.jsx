import { useEffect, useState } from 'react'
import { comprobante } from '../data/movimientos'
import Icon from './Icon'
import Seg from './Seg'

// Muestra el documento que se está revisando (HU09). En las fotos marca dónde leyó la IA cada
// dato: Document Intelligence devuelve la posición de cada campo y el backend la entrega en
// fracciones de la imagen (cajas: { campo: [x, y, ancho, alto] }).
// documento = { imagen: url, cajas? } | { pdf: nombre, url? }
const ETIQUETAS = { proveedor: 'Proveedor', rut: 'RUT', tipo_documento: 'Tipo', fecha: 'Fecha', monto: 'Total' }

export function Documento({ documento, resaltable = false, altura }) {
  const [vista, setVista] = useState('ia')
  if (!documento) return null
  if (documento.pdf) {
    return documento.url ? (
      <object className="doc-pdf-visor" data={documento.url} type="application/pdf" style={altura ? { height: altura } : undefined}>
        <PdfNombre nombre={documento.pdf} />
      </object>
    ) : (
      <PdfNombre nombre={documento.pdf} />
    )
  }
  const cajas = Object.entries(documento.cajas ?? {}).filter(([campo, c]) => c && ETIQUETAS[campo])
  const marcable = resaltable && cajas.length > 0
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
        <div className="doc-foto">
          <img src={documento.imagen} alt="Documento cargado" />
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
      </div>
    </div>
  )
}

function PdfNombre({ nombre }) {
  return (
    <div className="doc-pdf">
      <Icon name="receipt" />
      <strong>{nombre}</strong>
      <small>PDF cargado</small>
    </div>
  )
}

/**
 * El comprobante guardado de un movimiento (HU09). Pide un link temporal a la API cada vez que se
 * monta: el padre le pone key={mov.id} para que otro movimiento parta de cero.
 */
export function Comprobante({ mov, altura }) {
  const [c, setC] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true
    comprobante(mov.id)
      .then((r) => vigente && setC(r))
      .catch((e) => vigente && setError(e.message))
    return () => {
      vigente = false
    }
  }, [mov.id])

  if (error) return <p className="err">{error}</p>
  if (!c) return <p className="muted">Abriendo el documento…</p>
  const esPdf = c.tipo === 'application/pdf'
  return (
    <div className="comprobante">
      <Documento documento={esPdf ? { pdf: 'Factura o boleta en PDF', url: c.url } : { imagen: c.url }} altura={altura} />
      {/* En el celular un PDF no siempre se ve dentro de la página: así se abre con el visor del teléfono */}
      <a className="btn btn-text btn-sm" href={c.url} target="_blank" rel="noopener noreferrer">
        Abrir en una pestaña nueva
      </a>
    </div>
  )
}
