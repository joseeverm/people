import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Ruta de la Edge Function de IA. NUNCA se cachea: si no hay red, la petición
 *  debe fallar limpio para que el clasificador muestre el error y la nota se
 *  quede en la cola (invariante #5: la captura nunca se pierde). */
const RUTA_LLM = /\/functions\/v1\/llm/

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Paso 7 del MVP: la app se instala en el celular y arranca sin conexión.
    // Los DATOS no pasan por aquí — viven en IndexedDB (Dexie), que ya es
    // offline por sí solo. El service worker solo cachea el app shell.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'People',
        short_name: 'People',
        description: 'Registro de señales y perfiles de las personas que conozco.',
        lang: 'es',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait',
        // Acordes al tema oscuro (--bg y --accent de src/index.css).
        theme_color: '#16171d',
        background_color: '#16171d',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Separado del `any`: Android recorta el maskable con la forma del
          // launcher, y un icono `any` recortado perdería los bordes.
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell completo: sin esto la app no arranca sin red.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff,woff2}'],
        // SPA con BrowserRouter: una navegación offline a /personas o /bandeja
        // no corresponde a ningún archivo, se sirve el index precacheado.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Coherentes con registerType 'autoUpdate': el SW nuevo toma el control
        // sin esperar a que se cierren todas las pestañas.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Explícito aunque hoy sea cross-origin (y por tanto no se cachearía
            // igualmente): deja la intención escrita y evita que una regla
            // atrapa-todo futura se lleve por delante las llamadas a la IA.
            urlPattern: RUTA_LLM,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
})
