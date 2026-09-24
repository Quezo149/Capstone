import { Fragment, useState } from 'react'
import Icon from './Icon'
import './HeroDemo.css'

export default function HeroDemo() {
  // Cambiar la key remonta el contenido y así las animaciones CSS parten de cero.
  const [run, setRun] = useState(0)

  return (
    <div
      className="demo play"
      aria-label="Ejemplo: una boleta fotografiada se convierte en un movimiento listo para confirmar"
    >
      <Fragment key={run}>
        <div className="receipt-wrap">
          <div className="receipt">
            <div className="scan" aria-hidden="true" />
            <div className="r-center r-name">FERRETERÍA LOS ALERCES</div>
            <div className="r-center r-small">
              RUT 76.482.915-3
              <br />
              Av. Vicuña Mackenna 7110
            </div>
            <hr />
            <div className="r-center">
              <span className="hl d1">BOLETA ELECTRÓNICA</span>
            </div>
            <div className="r-center r-small">
              N° 0048213 · <span className="hl d2">22-09-2026</span>
            </div>
            <hr />
            <div className="r-row">
              <span>TORNILLO 1/4 X100</span>
              <span>3.490</span>
            </div>
            <div className="r-row">
              <span>CINTA AISLANTE</span>
              <span>1.990</span>
            </div>
            <div className="r-row">
              <span>{'BROCHA 2"'}</span>
              <span>2.590</span>
            </div>
            <hr />
            <div className="r-row r-small">
              <span>NETO</span>
              <span>6.782</span>
            </div>
            <div className="r-row r-small">
              <span>IVA 19%</span>
              <span>1.288</span>
            </div>
            <div className="r-row r-total">
              <span>TOTAL</span>
              <span className="hl d3">$ 8.070</span>
            </div>
            <div className="r-center r-small" style={{ marginTop: 6 }}>
              Timbre electrónico SII
            </div>
          </div>
          <div className="receipt-tail" aria-hidden="true" />
        </div>

        <svg className="arrow" viewBox="0 0 60 24" aria-hidden="true">
          <path
            d="M2 12h50M44 5l8 7-8 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div className="mv-card">
          <div className="mv-head">
            <strong>Nuevo movimiento</strong>
            <span className="badge">
              <i />
              Revisa y confirma
            </span>
          </div>
          <div className="fields">
            <div className="field">
              <span>Proveedor</span>
              <b>Ferretería Los Alerces</b>
            </div>
            <div className="field">
              <span>Fecha</span>
              <b className="mono">22-09-2026</b>
            </div>
            <div className="field">
              <span>Monto</span>
              <b className="mono">$ 8.070</b>
            </div>
            <div className="field">
              <span>Categoría</span>
              <b>
                Materiales <em className="sug">sugerida</em>
              </b>
            </div>
            <div className="field">
              <span>Documento</span>
              <b>Boleta · gasto</b>
            </div>
          </div>
          <div className="mv-actions">
            <span className="btn btn-ghost" aria-hidden="true">
              Corregir
            </span>
            <span className="btn btn-primary" aria-hidden="true">
              Confirmar
            </span>
          </div>
        </div>
      </Fragment>

      <button className="replay" type="button" onClick={() => setRun((n) => n + 1)}>
        <Icon name="replay" />
        Ver de nuevo
      </button>
    </div>
  )
}
