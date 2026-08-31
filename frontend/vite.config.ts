import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_URL ?? 'http://localhost:3000'
  const escapedApiBase = apiBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return {
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
