import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // redirect.html: "redirect bridge" de MSAL (ver src/auth/msal.js)
      input: { main: resolve(import.meta.dirname, 'index.html'), redirect: resolve(import.meta.dirname, 'redirect.html') },
    },
  },
})
