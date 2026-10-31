import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 5174 para no chocar con /frontend (5173) al correr ambos a la vez.
    port: 5174,
    strictPort: true,
    // politica.json vive en la raíz del repo (lo comparten landing, app y backend). Se permite solo
    // ese archivo, no la raíz completa: ahí también están backend/local.settings.json y otros secretos.
    fs: { allow: [searchForWorkspaceRoot(import.meta.dirname), resolve(import.meta.dirname, '../politica.json')] },
  },
})
