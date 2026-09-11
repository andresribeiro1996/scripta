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
needed, builds `@scripta/shared` if this worktree hasn't yet, seeds the dev
data (below), starts the backend and Metro if either isn't already up, and
opens Expo Go pointed at this worktree's servers. Safe to re-run any time —
re-running while everything is already up just re-launches Expo Go against
the current bundle. By default, re-running **preserves** whatever you did
in the app last time; pass `--reset` to wipe the seeded data back to its
initial state:

```bash
node scripts/dev-emulator.mjs --reset
```

`--reset` deletes `backend/data/dev/` (every module's database and upload
directory for this workflow — there's no reliable per-user teardown, see
`scripts/devDataDir.mjs`'s own comment) before reseeding, so it also
affects anything you did as the fixture users below, not just the dev
account.

### One server, one database, four logins

`dev-emulator.mjs` starts a single real backend
(`backend/src/server.ts`, same as `npm run backend`) against a dedicated
`backend/data/dev/` directory, and seeds it with two things before that
server starts:

- A dedicated local-only dev account (`scripta-dev@local.test` /
  `scripta_dev`, seeded by `scripts/dev-account.mjs`) carrying a ~24-book
  fixture library (`scripts/fixtures/library.json`) — two series, two
  collections, mixed read statuses, and both a book-level and a
  series-level style override, so Series/Collections/Style screens all
  have real content to look at immediately. The Expo app auto-signs into
  this account on boot (dev builds only — see `src/core/devSession.ts`'s
  own comment; it never overwrites a real signed-in session).
- The three-user fixture (`backend/scripts/three-users.mjs --shared`,
  see its own `backend/scripts/three-users.md`) — `fixture_alice`,
  `fixture_bob`, `fixture_charlie`, password `scripta123` for all three —
  for exercising multi-user flows (shared libraries, murals, tier-list
  polls, Arena) against that same server and database. Sign into one of
  these manually in the app (or a second Expo Go session/device) alongside
  the auto-signed-in dev account.

Without `--reset`, re-running preserves both the dev account's and the
fixture users' state, so testing progress across a session survives a
re-run; `--reset` wipes all of it back to each fixture's initial seed.

Every file this workflow touches (`backend/.env`, `backend/data/dev/`,
`mobile/.env.local`) is gitignored and worktree-local — it never touches
your own `backend/data/*.sqlite`, and if something else is already
listening on the backend port, `dev-emulator.mjs` verifies it's actually
this workflow's server (logging in as the dev account) before reusing it,
rather than silently trusting whatever is there.

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
