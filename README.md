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
