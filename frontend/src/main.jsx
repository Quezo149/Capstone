import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/animations.css'
import './styles/app.css'
import App from './App.jsx'
import { MovimientosProvider } from './state/Movimientos'
import { ToastProvider } from './state/Toasts'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <MovimientosProvider>
        <App />
      </MovimientosProvider>
    </ToastProvider>
  </StrictMode>,
)
