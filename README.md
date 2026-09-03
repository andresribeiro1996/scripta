# Scripta

A personal Kobo/Goodreads e-book library app — import your reading history, browse it as a styled card grid, organize it into series/collections, build freeform "mural" dashboards out of it, and (optionally) connect social accounts. Started as a small script to get data off a Kobo e-reader; grew into a full accounts-based web app.

## Layout

| Directory | What it is |
|---|---|
| [`backend/`](backend/README.md) | Node.js/Fastify/TypeScript API — auth, the library document store (with public share links), gallery uploads, cover-art resolution/caching, social account connections, book-bracket tournaments (arena), and murals. Modular monolith, hexagonal architecture per module. |
| [`frontend/`](frontend/README.md) | The real app ("Scripta") — React/Vite/TypeScript, Tailwind, TanStack Query. Talks to `backend/`. Installable as a PWA. |
| [`exporter/`](exporter/README.md) | Standalone Python script — reads a Kobo device's own `KoboReader.sqlite` off its USB drive and exports book metadata + highlights/notes to a single `library.json`. No dependencies beyond the stdlib. |
| [`viewer/`](viewer/README.md) | A single self-contained static HTML page that renders a `library.json` (or a Kobo `.sqlite`, or a Goodreads CSV) as a searchable card grid, no backend/build/account needed. Superseded by `frontend/` for anyone who wants accounts, but still works completely standalone. |
| `design/` | Design-canvas mockups (`.dc.html`) explored while reworking the book card layout. |

## Getting started

```bash
# backend
cd backend
npm install
cp .env.example .env   # fill in JWT secrets at minimum — see that file's own comments
npm run dev             # http://localhost:3000

# frontend, in a second terminal
cd frontend
npm install
npm run dev             # http://localhost:5173
```

Then either import a `library.json` (see `exporter/`) through the app, or point the exporter at a real Kobo device first. Each subdirectory's own README has the full detail — architecture decisions, what's built vs. deliberately not, and how each feature was verified.

## Testing on a phone

For a device on the same Wi-Fi, swap both `dev` commands above for `dev:mobile`:

```bash
cd backend  && npm run dev:mobile   # prints the LAN address it's serving on
cd frontend && npm run dev:mobile   # Vite prints a "Network:" url — open that on the phone
```

That's the whole setup. No `.env` editing: the backend script detects this machine's LAN address and sets `PUBLIC_API_URL` (so cover/gallery images, which are absolute urls, resolve from the device) and `ALLOW_LAN_ORIGINS` (so CORS accepts the phone's origin) for that run only. The frontend derives its API base from whatever host it was loaded from, so the device calls the right backend on its own. Pass `LAN_IP=192.168.1.20 npm run dev:mobile` if the detected address is wrong — a VPN or Docker bridge is the usual cause.

Two things this deliberately doesn't cover:

- **PWA install / offline.** Service workers need a secure context, and a LAN address over plain HTTP isn't one — the app runs fine, but "Add to Home Screen", the `autoUpdate` flow, and the `workbox` caching in `frontend/vite.config.ts` are all inert. Testing those needs HTTPS: an `ngrok`/Cloudflare tunnel, or a `mkcert` cert with its root CA installed on the phone.
- **Google login and the social connections.** Their callback urls (`GOOGLE_CALLBACK_URL`, `OAUTH_SUCCESS_REDIRECT_URL`, each platform's `*_CALLBACK_URL`) point at `localhost`, so the redirect dead-ends on the device. Sign in with email/password for LAN testing, or point those at the LAN address and register it with each provider first.

For a console and network inspector against the live phone tab: Android over USB via `chrome://inspect` on the desktop, iOS via Safari's Develop menu (needs a Mac).
