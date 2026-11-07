import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/animations.css'
import './styles/app.css'
import { lavarSiSePide } from './lib/demoImportacion'
import { capturarInvitacion } from './lib/invitacion'
import ProtoBar from './components/ProtoBar'
import Raiz from './Raiz.jsx'
import { SesionProvider } from './state/Sesion'
import { ToastProvider } from './state/Toasts'

// Antes de todo: si se abrió un link de invitación, guardar el token (ver lib/invitacion.js)
capturarInvitacion()

// PROTOTIPO: con ?lavar en la URL, borra los datos y hace una carga de ejemplo antes de mostrar la
// app (ver lib/demoImportacion.js)
lavarSiSePide()
  .then((hechas) => hechas && console.info('Prototipo lavado. Importaciones de ejemplo:', hechas))
  .finally(() =>
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <ToastProvider>
          <SesionProvider>
            <Raiz />
            <ProtoBar />
          </SesionProvider>
        </ToastProvider>
      </StrictMode>,
    ),
  )
