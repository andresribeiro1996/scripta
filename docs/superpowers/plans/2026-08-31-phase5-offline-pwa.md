# Phase 5 — Offline PWA Implementation Plan

**Goal:** An installed (or production-served) Scripta opened with no network shows the full library grid with covers from cache, with a clear offline banner; writes attempted offline already fail fast with the Phase 3 error toasts — no new work needed there.

**Architecture:** `vite-plugin-pwa` runs workbox `generateSW`; adding `workbox.runtimeCaching` rules gives the service worker two caches: the library document (`StaleWhileRevalidate`, single entry) and cover/gallery media (`CacheFirst`, bounded). A small `OfflineBanner` component tracks `navigator.onLine` via `online`/`offline` events and mounts atop the dashboard content area. No backend changes.

**Tech Stack:** vite-plugin-pwa workbox config, React 19 + TS. No new npm deps.

**Spec:** `docs/superpowers/plans/2026-08-31-ux-enhancements-roadmap.md` (Phase 5). Finding addressed: M8.

## Global Constraints

- `npm run typecheck` and `npm run lint` (from `frontend/`); no new warnings beyond the 8 known.
- No comments in code.
- Dev-server behavior must not change (SW only exists in production builds — vite-plugin-pwa default; leave it that way).
- Pre-accepted behavior (do not engineer around in this phase): the SW's own background revalidation of `/library` omits the app's `Authorization` header and may 401 — workbox SWR then simply keeps the cached copy; the cache still refreshes whenever the app itself refetches (its authorized requests pass through the SW and update the cache). Offline reads are the goal; silent revalidate failures are fine.
- `PUT`/`POST` are never cached (workbox runtime caching is GET-only by default) — no write caching to worry about.

---

### Task 1: Workbox runtime caching

**Files:**
- Modify: `frontend/vite.config.ts` (switch `defineConfig` to its function form)

**Interfaces:**
- Produces: SW caches `api-library` (the `/library` GET document) and `media-covers` (everything under `/covers/` and `/gallery/`).

- [ ] **Step 1: Rewrite `frontend/vite.config.ts` as:**

```ts
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
```

(The manifest block is byte-identical to today's — only the wrapper and `workbox` are new.)

- [ ] **Step 2: Verify mechanically**

From `frontend/`:

```bash
npm run typecheck && npm run lint
npm run build
grep -c "api-library" dist/sw.js
grep -c "media-covers" dist/sw.js
```

Both greps must return ≥ 1 (the generated service worker embeds the runtime caching config).

- [ ] **Step 3: Verify manually (offline round-trip)**

The backend's CORS allows only its configured `FRONTEND_URL` origin, so preview on the same port dev uses:

```bash
npm run preview -- --port 5173
```

With the backend up, open `http://localhost:5173`, sign in, let the library grid load fully (covers included). Then devtools → Network → Offline → reload the page: the app shell AND the grid with covers render from cache. Devtools → Application → Cache Storage shows `api-library` (1 entry) and `media-covers` (cover bytes). Toggle a status change while offline → Phase 3's error toast appears. Back online → reload → live data.

- [ ] **Step 4: Commit**

```bash
git add frontend/vite.config.ts
git commit -m "feat(frontend): workbox runtime caching for library and cover media"
```

### Task 2: Offline banner

**Files:**
- Create: `frontend/src/components/OfflineBanner.tsx`
- Modify: `frontend/src/layouts/DashboardLayout.tsx` (mount above `<Outlet />`)

**Interfaces:** none (self-contained).

- [ ] **Step 1: Create `frontend/src/components/OfflineBanner.tsx` with EXACTLY:**

```tsx
import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="sticky top-0 z-30 bg-(--color-accent-soft) px-4 py-2 text-center text-sm font-medium text-(--color-accent)">
      Offline — showing your last synced library. Changes won't save until you're back online.
    </div>
  );
}
```

- [ ] **Step 2: Mount it**

In `DashboardLayout.tsx`, import `OfflineBanner` and render it as the first child inside `<main>`, immediately before `<Outlet />`.

- [ ] **Step 3: Verify**

`npm run typecheck && npm run lint` (8 known warnings, none new). Manual: with the preview server up, toggle devtools offline — the banner appears at the top of the content area across all dashboard pages; toggling online removes it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OfflineBanner.tsx frontend/src/layouts/DashboardLayout.tsx
git commit -m "feat(frontend): offline banner when the network is down"
```

---

## Phase 5 exit criteria

- Production build served at the allowed origin: full offline reload renders shell + library + covers from `api-library`/`media-covers` caches; offline mutations show error toasts (Phase 3); reconnect restores live data.
- Banner appears/disappears with connectivity on every dashboard page.
- `typecheck`, `lint`, build, and all suites pass; dev server unaffected.

## Self-review

- Coverage vs. spec: runtime caching (library + covers) → Task 1; offline banner → Task 2; write guard → already satisfied by Phase 3 catches (stated in Global Constraints, no duplicate work). navigateFallback → untouched vite-plugin-pwa default (index.html).
- The CORS/origin pitfall for manual testing is handled by pinning `preview -- --port 5173`.
- No placeholders; exact config code; greps make the SW embed mechanically checkable.
