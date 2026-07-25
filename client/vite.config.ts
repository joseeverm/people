import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Config mínima: genera manifest/service worker pero no se registra
    // automáticamente todavía. La PWA offline es el paso 7 del MVP.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'People',
        short_name: 'People',
        start_url: '.',
        display: 'standalone',
      },
    }),
  ],
})
