import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // VITE_API_URL is substituted into the bundle at build time, so a
  // production build without it ships code pointing at localhost — a
  // failure that would otherwise only surface in a user's browser. Fail
  // the build instead, so CI catches it. See src/config.ts.
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    if (!env.VITE_API_URL) {
      throw new Error(
        'VITE_API_URL is not set. A production build bakes the API URL into the bundle, so it must be set at build time (e.g. VITE_API_URL=https://api.example.com npm run build).'
      )
    }
  }

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
        }
      })
    ]
  }
})
