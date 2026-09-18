# Scripta Mobile

Expo / React Native client for the Scripta backend (Fastify, see `../backend`). Third client beside the Vite PWA in `../frontend`. Built per the plan in `../docs/history/2026-09-06-parallel-mobile-migration.md` — Task numbers below refer to it.

## Running

```bash
npm install                # from repo root (npm workspaces: backend, frontend, mobile, packages/*)
node scripts/dev-phone.mjs # from repo root
```

Idempotent — safe to re-run any time. Builds `@scripta/shared` if this worktree hasn't yet, seeds a dev account with a 24-book fixture library (`scripts/dev-account.mjs`) plus `fixture_alice/bob/charlie` (password `scripta123`) into `backend/data/dev/`, starts a real backend against that same directory in plain-http LAN mode, and starts Metro advertising on the LAN. Prints an `exp://<lan-ip>:8081` url — open that in Expo Go on a phone on the same Wi-Fi. Pass `--reset` to wipe `backend/data/dev/` and reseed from scratch; `LAN_IP=192.168.1.20 node scripts/dev-phone.mjs` overrides a wrong network-interface guess. `npm run dev:release` frees the ports when done.

That script exists because the manual version below has a trap: `dev-account.mjs` seeds `backend/data/dev/`, but a bare `npm run backend` serves `backend/data/*.sqlite` — a different database — so the seeded dev account 401s and the app just says it can't reach the server, with nothing pointing at why. Worth knowing about directly for troubleshooting, or to run each side by hand:

```bash
EXPO_PUBLIC_API_URL=http://<your-mac-lan-ip>:3000 npm run mobile
```

Backend must be up, serving the SAME database `dev-account.mjs` seeded — `node --import tsx scripts/dev-account.mjs` from the repo root writes the dev account and its refresh token into `mobile/.env.local`, but only a backend started with `devDataDirEnv()`'s overrides (see `scripts/devDataDir.mjs`) reads that same `backend/data/dev/` directory. Open in Expo Go by entering `exp://<lan-ip>:8081`. `EXPO_PUBLIC_API_URL` is validated at startup — the app refuses to boot with it unset or non-http(s).

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

If the primary checkout's default ports are occupied, pass `--slot 1` to use
the next port set without stopping the existing process. Release that slot
with `npm run dev:release` after testing.

Idempotent — boots the `scripta-dev` AVD if it isn't running (creating it
first, on a machine that's never run this before), sideloads Expo Go if
needed, builds `@scripta/shared` if this worktree hasn't yet, seeds the dev
data (below), starts the backend and Metro if either isn't already up, and
opens Expo Go pointed at this worktree's servers. Safe to re-run any time —
re-running while everything is already up just re-launches Expo Go against
the current bundle. By default, re-running **preserves** whatever you did
in the app last time; pass `--reset` to wipe the seeded data back to its
initial state:

Metro here binds `127.0.0.1` only, closed to the LAN — the emulator
reaches it through the `adb reverse` tunnel this script also sets up, so
LAN advertisement buys nothing and only costs: every worktree's Metro
that DOES advertise shows up on every device's Expo Go home screen, which
is how a reload or crash reconnects the app to a different worktree's
bundler. `adb root` drops that tunnel (it restarts `adbd`); `npm run
dev:status` warns when it's gone and `npm run dev:tunnels` puts it back.
Physical-phone testing (above) still needs LAN and is unaffected.

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
your own `backend/data/*.sqlite`. If something is already listening on
the slot's backend port, both `dev-emulator.mjs` and `scripts/dev-
phone.mjs` just adopt it as this workflow's own server rather than
re-verifying who it is — true as long as it was started by one of these
two scripts to begin with; starting a backend any other way on the same
port (a bare `npm run backend` in this worktree) leaves something a
re-run will wrongly trust. `npm run dev:release` first if in doubt.
`scripts/dev-phone.mjs` runs this exact same seeding against the exact
same directory for a physical phone over LAN instead of an emulator over
adb — see "Running" above.

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

### Account access

The shared Input supports password visibility and field hints. Login/signup validate fields before submission, preserve autofill, scroll above the keyboard, and prevent competing sign-in attempts. Sessions continue to use SecureStore and remain signed in by default.

`/forgot-password` requests a recovery email; the link completes recovery on the HTTPS web client. Settings opens `/account-security` for password changes, email verification, and correction. Existing accounts remain usable while unverified. Sign-in destinations survive username and avatar onboarding.
