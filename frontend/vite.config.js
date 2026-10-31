import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // politica.json vive en la raíz del repo (lo comparten landing, app y backend). Se permite solo
  // ese archivo, no la raíz completa: ahí también están backend/local.settings.json y otros secretos.
  server: { fs: { allow: [searchForWorkspaceRoot(import.meta.dirname), resolve(import.meta.dirname, '../politica.json')] } },
  build: {
    rollupOptions: {
      // redirect.html: "redirect bridge" de MSAL (ver src/auth/msal.js)
      input: { main: resolve(import.meta.dirname, 'index.html'), redirect: resolve(import.meta.dirname, 'redirect.html') },
    },
  },
})
