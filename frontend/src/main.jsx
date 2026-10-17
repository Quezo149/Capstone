import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/animations.css'
import './styles/app.css'
import Raiz from './Raiz.jsx'
import { SesionProvider } from './state/Sesion'
import { ToastProvider } from './state/Toasts'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <SesionProvider>
        <Raiz />
      </SesionProvider>
    </ToastProvider>
  </StrictMode>,
)
