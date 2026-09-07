# Scripta Mobile

Expo / React Native client for the Scripta backend (Fastify, see `../backend`). Third client beside the Vite PWA in `../frontend`. Built per the plan in `../2026-09-06-parallel-mobile-migration.md` — Task numbers below refer to it.

## Running

```bash
npm install                # from repo root (npm workspaces: backend, frontend, mobile, packages/*)
EXPO_PUBLIC_API_URL=http://<your-mac-lan-ip>:3000 npm run mobile
```

Backend must be up (`npm run backend`). Open in Expo Go by entering `exp://<lan-ip>:8081`. `EXPO_PUBLIC_API_URL` is validated at startup — the app refuses to boot with it unset or non-http(s).

## Layout

- `src/core/` — config (validated API URL), token store (refresh token in `expo-secure-store`, access token in memory only), API client, `AuthProvider` (cold-start refresh).
- `src/app/` — Expo Router file routes. `(public)/` unauthenticated (login), `(app)/` auth-guarded tab shell (Library, Arena, Murals, Settings). The guard redirects to login when no session.
- Route groups follow the PWA's split in `frontend/src/App.tsx`: everything under `dashboard` is authenticated; public routes arrive in Task 5E.

## Conventions

- One React version across the workspace: root `package.json` `overrides` pins `react`/`react-dom` to Expo SDK 57's exact version, and `frontend` declares the same. Do not widen either range without checking the other — two React copies in one Metro bundle fail with "Invalid hook call".
- No `metro.config.js`: `@expo/metro-config` auto-detects the npm workspace root.
- Shared logic goes in `@scripta/shared` (`packages/shared`, compiled `dist`), never duplicated between clients. Wave 1 fills it.
- Commands: `npm run typecheck --workspace mobile` (CI runs typecheck + `expo-doctor`).
