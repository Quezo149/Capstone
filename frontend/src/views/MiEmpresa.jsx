import { useEffect, useState } from 'react'
import EmpresaForm from '../components/EmpresaForm'
import Icon from '../components/Icon'
import { NOMBRE_ROL } from '../data/demo'
import { api } from '../lib/api'
import { useSesion } from '../state/Sesion'
import { useToast } from '../state/Toasts'
import './Acceso.css'

// Mi empresa (HU04): todos los miembros ven los datos; solo el administrador los edita.
// El backend aplica la misma regla (PUT /empresas/actual exige rol admin).
export default function MiEmpresa() {
  const { perfil, refrescar } = useSesion()
  const { aviso } = useToast()
  const [empresa, setEmpresa] = useState(null)
  const [editando, setEditando] = useState(false)
  const [error, setError] = useState(null)
  const esAdmin = perfil.rol === 'admin'

  useEffect(() => {
    api('/empresas/actual')
      .then((r) => setEmpresa(r.empresa))
      .catch((e) => setError(e.message))
  }, [])

  async function guardar(datos) {
    const r = await api('/empresas/actual', { method: 'PUT', body: datos })
    setEmpresa(r.empresa)
    setEditando(false)
    aviso('Datos de la empresa guardados')
    refrescar() // el nombre también se muestra en la barra superior
  }

  return (
    <section className="empresa-page rise">
      <div className="page-head">
        <div>
          <span className="eyebrow">Configuración</span>
          <h1>Mi empresa</h1>
        </div>
        <span className="chip line">Tu rol: {NOMBRE_ROL[perfil.rol]}</span>
      </div>

      <div className="card">
        {error && <p className="acceso-aviso">{error}</p>}
        {!empresa && !error && <p className="muted">Cargando…</p>}
        {empresa && editando && (
          <EmpresaForm inicial={empresa} textoBoton="Guardar cambios" onGuardar={guardar} onCancelar={() => setEditando(false)} />
        )}
        {empresa && !editando && (
          <>
            <dl className="empresa-datos">
              <div>
                <dt>Nombre</dt>
                <dd>{empresa.nombre}</dd>
              </div>
              <div>
                <dt>RUT</dt>
                <dd className="mono">{empresa.rut}</dd>
              </div>
              <div>
                <dt>Giro</dt>
                <dd>{empresa.giro ?? <span className="muted">Sin giro registrado</span>}</dd>
              </div>
            </dl>
            {esAdmin ? (
              <div className="form-acts" style={{ marginTop: 20 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setEditando(true)}>
                  <Icon name="pen" />
                  Editar datos
                </button>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 16 }}>
                Solo el administrador puede modificar estos datos.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
