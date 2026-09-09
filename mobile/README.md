# Scripta Mobile

Expo / React Native client for the Scripta backend (Fastify, see `../backend`). Third client beside the Vite PWA in `../frontend`. Built per the plan in `../2026-09-06-parallel-mobile-migration.md` — Task numbers below refer to it.

## Running

```bash
npm install                # from repo root (npm workspaces: backend, frontend, mobile, packages/*)
EXPO_PUBLIC_API_URL=http://<your-mac-lan-ip>:3000 npm run mobile
```

Backend must be up (`npm run backend`). Open in Expo Go by entering `exp://<lan-ip>:8081`. `EXPO_PUBLIC_API_URL` is validated at startup — the app refuses to boot with it unset or non-http(s).

## Testing on an emulator

A physical phone works (see above), but it locks its screen, can't be driven
headlessly, and is a single shared device across concurrent worktrees. For
anything scripted — an agent verifying a change, a quick "does this still
work" — an Android emulator has none of those problems: no lock screen, no
screen timeout, and `adb`/`uiautomator` drive it the same as a real device.

One-time setup (no `sudo`, ~3GB):

```bash
brew install openjdk
brew install --cask android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools PATH="$JAVA_HOME/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
yes | sdkmanager --licenses
sdkmanager platform-tools emulator platforms\;android-35 "system-images;android-35;google_apis;arm64-v8a"
```

Then, from the repo root, any time:

```bash
node scripts/dev-emulator.mjs
```

Idempotent — boots the `scripta-dev` AVD if it isn't running (creating it
first, on a machine that's never run this before), sideloads Expo Go if
needed, builds `@scripta/shared` if this worktree hasn't yet, starts the
backend and Metro if either isn't already up, and opens Expo Go pointed at
this worktree's servers. Safe to re-run any time — re-running while
everything is already up just re-launches Expo Go against the current
bundle.

It signs straight into a dedicated local-only dev account
(`scripta-dev@local.test`, seeded by `scripts/dev-account.mjs`) carrying a
~24-book fixture library (`scripts/fixtures/library.json`) — two series,
two collections, mixed read statuses, and both a book-level and a
series-level style override, so Series/Collections/Style screens all have
real content to look at immediately. Re-running `dev-account.mjs` (or
`dev-emulator.mjs`, which calls it) resets that account back to the
fixture's known state without touching any other account.

The auto-sign-in is dev-only by construction — see
`src/core/devSession.ts`'s own comment — and only ever seeds a session
when SecureStore has none yet; it never overwrites a real signed-in
session. Every file it touches (`backend/.env`, `backend/data/*.sqlite`,
`mobile/.env.local`) is gitignored and worktree-local.

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
