import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { CERT_PATH, KEY_PATH, mobileCertsExist } from '../scripts/mobileCertPaths.mjs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_URL ?? 'http://localhost:3000'
  const escapedApiBase = apiBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Once `node scripts/gen-mobile-certs.mjs` (repo root) has been run,
  // serve https here too — the backend does the same (see
  // backend/src/config/devCerts.ts) reading the exact same pair. Needed
  // for testing "Add to Home Screen"/offline on a phone: a service
  // worker only runs in a secure context, and a plain LAN address over
  // http isn't one. No cert generated, and this is unset, so both `vite`
  // and `vite preview` behave exactly as before. `preview.https`
  // inherits `server.https` when not set separately, so setting it once
  // here covers `npm run dev:mobile` AND `npm run preview:mobile` both.
  const https = mobileCertsExist() ? { key: readFileSync(KEY_PATH), cert: readFileSync(CERT_PATH) } : undefined
  return {
    server: { https },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'Scripta',
          short_name: 'Scripta',
          description: 'Your book library, wherever you left off.',
          theme_color: '#a85c32',
          background_color: '#f5f4f2',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
          ]
        },
        workbox: {
          runtimeCaching: [
            {
              urlPattern: new RegExp(`^${escapedApiBase}/library$`),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'api-library',
                expiration: { maxEntries: 1 }
              }
            },
            {
              urlPattern: new RegExp(`^${escapedApiBase}/(covers|gallery)/`),
              handler: 'CacheFirst',
              options: {
                cacheName: 'media-covers',
                cacheableResponse: { statuses: [200] },
                expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 }
              }
            }
          ]
        }
      })
    ]
  }
})
