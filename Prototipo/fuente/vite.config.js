import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// PROTOTIPO: rutas relativas, para abrirlo con cualquier servidor estático
// (python -m http.server). `npm run build` copia dist/ a la carpeta Prototipo/.
export default defineConfig({
  plugins: [react()],
  base: './',
})
