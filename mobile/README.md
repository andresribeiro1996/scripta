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
- Public share, arena, and ballot routes are outside the authenticated `(app)` group. Dashboard URLs redirect into guarded native screens.

## Route adaptations

The web route tree has a native equivalent. The native tab shell uses shorter internal paths while incoming web links keep working through redirects.

| Web route | Native destination |
|---|---|
| `/dashboard` | Library tab `/` |
| `/dashboard/series`, `/dashboard/collections`, `/dashboard/style` | Library tab views |
| `/dashboard/gallery`, `/dashboard/murals`, `/dashboard/settings` | `/gallery`, `/murals`, `/settings` |
| `/dashboard/arena` | Arena tab `/my-arena` |
| `/dashboard/arena/tierlist/:id`, `/dashboard/arena/:id/seed` | Guarded native editor routes |
| `/welcome-avatar` | Native skippable avatar onboarding |
| `/oauth-success` | Native OAuth uses the `scripta://oauth-redirect` auth-session callback; the web callback path returns to login |

`/arena`, `/arena/:id`, `/vote/:code`, `/shared/library/:token`, and `/shared/murals/:token` remain public and never pass through the app auth guard.

## Conventions

- One React version across the workspace: root `package.json` `overrides` pins `react`/`react-dom` to Expo SDK 57's exact version, and `frontend` declares the same. Do not widen either range without checking the other — two React copies in one Metro bundle fail with "Invalid hook call".
- No `metro.config.js`: `@expo/metro-config` auto-detects the npm workspace root.
- Shared logic goes in `@scripta/shared` (`packages/shared`, compiled `dist`), never duplicated between clients. Wave 1 fills it.
- Commands: `npm run typecheck --workspace mobile` (CI runs typecheck + `expo-doctor`).
