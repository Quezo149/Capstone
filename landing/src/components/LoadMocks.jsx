import CountUp from './CountUp'
import Icon from './Icon'

// Mini-pantallas de ejemplo que acompañan a cada pestaña de LoadTabs.
// Se animan cada vez que su panel se muestra (ver LoadTabs.css). `--i` es el orden de aparición.

export function DropMock() {
  return (
    <div className="shot">
      <div className="shot-title">
        Subir documento <em>ejemplo</em>
      </div>
      <div className="drop">
        <span className="drop-scan" aria-hidden="true" />
        <Icon name="upload" />
        <b style={{ color: 'var(--ink)' }}>Arrastra la boleta o factura</b>
        <span>JPG, PNG o PDF</span>
      </div>
      <div className="pills">
        <span className="pill">factura_proveedor.pdf · 3 págs.</span>
        <span className="pill busy">
          Leyendo datos
          <span className="dots" aria-hidden="true">
            <i>.</i>
            <i>.</i>
            <i>.</i>
          </span>
        </span>
      </div>
    </div>
  )
}

const IMPORT_ROWS = [
  { fecha: '02-09-2026', proveedor: 'Copec', categoria: 'Combustible', monto: '45.000' },
  { fecha: '03-09-2026', proveedor: 'Arriendo local', categoria: 'Arriendo', monto: '480.000' },
  { fecha: 'Falta fecha', proveedor: 'Líder', categoria: 'Insumos', monto: '18.450', error: true },
  { fecha: '05-09-2026', proveedor: 'Entel', categoria: 'Servicios', monto: '24.990' },
]

export function ImportMock() {
  return (
    <div className="shot">
      <div className="shot-title">
        Vista previa de importación <em>ejemplo</em>
      </div>
      <div className="pills">
        <span className="pill">
          <CountUp to={148} /> filas válidas
        </span>
        <span className="pill warn">3 con error</span>
      </div>
      <div className="table-scroll">
        <table className="mini">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Proveedor</th>
              <th>Categoría</th>
              <th style={{ textAlign: 'right' }}>Monto</th>
            </tr>
          </thead>
          <tbody>
            {IMPORT_ROWS.map((r, i) => (
              <tr key={r.proveedor} className={r.error ? 'err' : undefined} style={{ '--i': i }}>
                <td>{r.fecha}</td>
                <td>{r.proveedor}</td>
                <td>{r.categoria}</td>
                <td className="num">{r.monto}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FormMock() {
  return (
    <div className="shot form-mock">
      <div className="shot-title">
        Nuevo movimiento <em>ejemplo</em>
      </div>
      <div className="seg">
        <span>Gasto</span>
        <span className="on">Ingreso</span>
      </div>
      <div className="two">
        <label>
          Fecha
          <span className="inp mono" style={{ '--i': 0 }}>
            21-09-2026
          </span>
        </label>
        <label>
          Monto
          <span className="inp mono" style={{ '--i': 1 }}>
            $ 150.000
          </span>
        </label>
      </div>
      <label>
        Descripción
        <span className="inp" style={{ '--i': 2 }}>
          Transferencia cliente, pedido 214
        </span>
      </label>
      <label>
        Categoría
        <span className="inp" style={{ '--i': 3 }}>
          Ventas
        </span>
      </label>
    </div>
  )
}
