# App themes

Date: 2026-09-28
Status: design approved in conversation; awaiting spec review
Follow-ups (separate specs, in this order): typography (a default font per
theme plus a user font override, independent of theme), then decor (per-theme
background decor, themed logo mark, motion effects that respect reduced
motion). Nothing in this spec builds them; theme entries can grow `font` and
`decor` fields when those land.

## Problem

The app has one palette in light and dark. Web follows the OS and can only be
switched from the landing page toggle; mobile follows the OS with no choice at
all. The palette is hand-copied between `frontend/src/index.css` and
`mobile/src/ui/theme.tsx`, which DESIGN.md requires to stay byte-identical —
workable for 2 themes, not for 11.

## Goals

- Eleven themes on web and mobile: Light, Dark (today's values, unchanged),
  Sepia, Rosé, Midnight, Forest, Matrix, Synthwave, Seventies, Newsprint,
  Oxblood — plus System (follow the OS between Light and Dark).
- A theme picker in Settings on both clients.
- The choice syncs across devices through the account while signed in.
- Palettes defined once, in `@scripta/shared`.

## Non-goals

- Fonts, background decor, logo variants, motion (follow-up specs).
- Letting System map to themes other than Light/Dark.
- Web re-resolving System when the OS scheme changes while a tab is open
  (today's behaviour — resolved at load and on pick — is kept; mobile's
  `useColorScheme` already updates live).
- Changing the PWA manifest colours or the installed app icon.

## Theme registry (`packages/shared/src/themes/`)

Exported as `@scripta/shared/themes` (new `exports` entry in
`packages/shared/package.json`).

- `ThemeId` — `"light" | "dark" | "sepia" | "rose" | "midnight" | "forest" |
  "matrix" | "synthwave" | "seventies" | "newsprint" | "oxblood"`.
- `ThemeScheme` — `"light" | "dark"`.
- `ThemeColors` — the 20 tokens mobile's `palettes` carries today:
  `background, surface, surfacePressed, text, textDim, border, accent,
  accentSoft, accentFill, danger, dangerSoft, success, successSoft, info,
  infoSoft, reference, referenceSoft, scrim, onAccent, onDanger`.
- `themes: Record<ThemeId, { label: string; scheme: ThemeScheme; colors: ThemeColors }>`
  — insertion order is picker order: the table order below, Light and Dark
  first.
- `ThemePreference = ThemeId | "system"`; `THEME_PREFERENCES` lists all 12.
- `parseThemePreference(value: unknown): ThemePreference` — anything not in
  `THEME_PREFERENCES` (unknown id, empty, null, non-string) → `"system"`.
- `resolveTheme(preference, osScheme: ThemeScheme): ThemeId` — `"system"` →
  `osScheme`; otherwise the id.
- `reconcileThemePreference(account: ThemePreference | null, device: ThemePreference):
  { apply: ThemePreference | null; upload: ThemePreference | null }` — the one
  sync rule both clients call:
  - account `null` → `{ apply: null, upload: device }` (first sync seeds the
    account from this device, so existing light/dark choices carry over);
  - account === device → `{ apply: null, upload: null }`;
  - otherwise → `{ apply: account, upload: null }`.

Light and Dark are today's values byte-for-byte (DESIGN.md's Color table). The
nine new palettes:

| Token | Sepia (light) | Rosé (light) | Midnight (dark) | Forest (dark) | Matrix (dark) | Synthwave (dark) | Seventies (dark) | Newsprint (light) | Oxblood (dark) |
|---|---|---|---|---|---|---|---|---|---|
| `background` | `#f1e7d0` | `#f6ecec` | `#0d121c` | `#0e1612` | `#020805` | `#150d28` | `#23160d` | `#ece9e1` | `#1c0c0e` |
| `surface` | `#faf4e6` | `#fffafa` | `#1a2130` | `#19241e` | `#08170e` | `#22163b` | `#342214` | `#f7f5ef` | `#2c1518` |
| `surfacePressed` | `#f4eee0` | `#f9f3f4` | `#262d3c` | `#253029` | `#122419` | `#2f2347` | `#402e1f` | `#f0eee8` | `#382123` |
| `text` | `#3b2e20` | `#2a1d22` | `#e6e9f0` | `#e5eadd` | `#b6f5c4` | `#f7edff` | `#f7e7c6` | `#161514` | `#f4e4d2` |
| `textDim` | `#6f5f48` | `#725f67` | `#98a2b5` | `#9eac9c` | `#62ad7c` | `#b6a0da` | `#c4a57c` | `#5c5953` | `#c29f93` |
| `border` | `#dccdb0` | `#e8d4d9` | `#323c52` | `#304238` | `#174a2c` | `#402d66` | `#533a24` | `#d6d2c8` | `#4d2a2e` |
| `accent` | `#86562a` | `#a3335b` | `#dcae62` | `#b3d36a` | `#3cff7d` | `#ff4fb8` | `#e9b43c` | `#1f1e1c` | `#d9b36b` |
| `accentSoft` | `#e9dcca` | `#f0dae1` | `#36312a` | `#2f3c24` | `#0e391d` | `#441a45` | `#4b3616` | `#d4d3cd` | `#422d21` |
| `accentFill` | `#d7c4a8` | `#e2c0c9` | `#534734` | `#465630` | `#165c2e` | `#652359` | `#664c1d` | `#bbb8b2` | `#5c452e` |
| `danger` | `#ad3f2a` | `#b4461e` | `#ee8a7c` | `#ef8c7a` | `#ff6b6b` | `#ff7f4d` | `#f5775a` | `#b3302a` | `#ff8a6e` |
| `dangerSoft` | `#f2e0d1` | `#f8e8e4` | `#3a2a2f` | `#3b2e27` | `#351c19` | `#44242f` | `#4d291c` | `#eedbd5` | `#492521` |
| `success` | `#4d6b31` | `#44703c` | `#8cc79a` | `#72d0ad` | `#5ce1e6` | `#5ef2b0` | `#a9bf5c` | `#3f6b3a` | `#9fc48a` |
| `successSoft` | `#e4e2ce` | `#e5e7df` | `#263635` | `#223b31` | `#143332` | `#243b43` | `#3e381d` | `#dbe0d4` | `#363127` |
| `info` | `#2d5d70` | `#285f7a` | `#86b4e8` | `#94aaea` | `#79a8ff` | `#40d6f2` | `#79b9c9` | `#2b5a78` | `#8fb8d8` |
| `infoSoft` | `#d9dcd3` | `#dde1e6` | `#253245` | `#29343d` | `#1a2837` | `#1e3550` | `#343733` | `#d6dcdc` | `#332e36` |
| `reference` | `#6a4c84` | `#5a4b94` | `#bba8ea` | `#c7a6de` | `#d38cff` | `#b9a0ff` | `#d3a3c9` | `#664b8a` | `#c9a8e0` |
| `referenceSoft` | `#e3d9d6` | `#e5deea` | `#303045` | `#33333b` | `#2c2237` | `#362a53` | `#463233` | `#e0dadf` | `#3f2b38` |
| `scrim` | `rgba(59, 46, 32, 0.48)` | `rgba(42, 29, 34, 0.48)` | `rgba(0, 0, 0, 0.64)` | `rgba(0, 0, 0, 0.64)` | `rgba(0, 0, 0, 0.64)` | `rgba(0, 0, 0, 0.64)` | `rgba(0, 0, 0, 0.64)` | `rgba(22, 21, 20, 0.48)` | `rgba(0, 0, 0, 0.64)` |
| `onAccent` | `#ffffff` | `#ffffff` | `#0d121c` | `#0e1612` | `#020805` | `#150d28` | `#23160d` | `#ffffff` | `#1c0c0e` |
| `onDanger` | `#ffffff` | `#ffffff` | `#0d121c` | `#0e1612` | `#020805` | `#150d28` | `#23160d` | `#ffffff` | `#1c0c0e` |

Where a theme's accent sits near a status hue, the status colour moved instead
of the accent: Forest's `success` is mint (accent is fern green), Matrix's
`success` is cyan (accent is phosphor green), Rosé's `danger` is vermilion
(accent is raspberry), Synthwave's `danger` is orange-red (accent is pink).

## Backend (auth module)

Follows the `dashboard_seen_at` precedent: a column on `users`, routes in
`modules/auth/routes.ts`.

- `connection.ts`: `ALTER TABLE users ADD COLUMN theme TEXT` behind the same
  column-exists check as the others. `NULL` = never chosen.
- `GET /auth/theme` (authGuard) → `200 { theme: ThemePreference | null }`.
  A stored value that is no longer in `THEME_PREFERENCES` (a theme removed
  later) is returned as `"system"` via `parseThemePreference`, never passed
  through raw.
- `PUT /auth/theme` (authGuard), body `{ theme }` validated with
  `z.enum(THEME_PREFERENCES)` → `204`; invalid body → `400 { error }`.
- The value is not added to `AuthenticatedUser` or the JWT claims; deleting
  the account deletes it with the row.

## Sync behaviour (both clients)

- Each device caches its preference locally (web `localStorage` key `theme` —
  the key `index.html` and the landing toggle already use; mobile AsyncStorage
  key `theme`) so first paint uses the last known theme.
- While signed in, the client calls `GET /auth/theme` on mount of the
  signed-in shell and whenever the app returns to the foreground (web
  `visibilitychange` → visible; mobile `AppState` → `active`), then runs
  `reconcileThemePreference(account, device)`: apply `apply` if set (and
  cache it), `PUT` `upload` if set.
- Picking a theme in Settings applies and caches it immediately, then
  `PUT`s it. On failure the theme stays applied on this device and the
  picker shows "Couldn't save to your account. Try again." in `danger`, with
  `role="alert"` / `accessibilityRole="alert"`. Until a save succeeds, the
  next foreground sync restores the account's value — the account wins,
  consistently; there is no pending-upload queue. A failed
  `GET` during background sync changes nothing and shows nothing — the
  cached theme is still correct for this device; it is retried on the next
  foreground.
- Signed out: device-local only.
- The landing-page toggle stays a quick light/dark flip for this device
  only; the landing page has no session context. Inside the app the
  account's value wins on the next sync.

## Web

- **Generated CSS.** `frontend/scripts/generate-themes-css.mts`, run with
  `npm run themes --workspace frontend`, writes `frontend/src/themes.css`:
  - `@custom-variant dark (&:where(<every dark-scheme theme>, … *))` — moved
    out of `index.css`, so the existing `dark:hidden`/`dark:block` plate and
    glyph swaps (`ReaderGlyph`, `ReaderCardBlock`, landing) cover every
    dark-scheme theme with no component changes;
  - `@theme { … }` with Light's colours as the defaults (replacing the
    hand-written colour tokens in `index.css`; `--font-display` stays there);
  - one `:root[data-theme="<id>"] { color-scheme: <scheme>; --color-…: … }`
    block per theme, mapped onto today's variable names: `background` →
    `--color-bg`, `surfacePressed` → `--color-surface-hover`, `textDim` →
    `--color-text-dim`, the rest kebab-cased (`accentSoft` →
    `--color-accent-soft`, `onAccent` → `--color-on-accent`, …). Tokens web
    doesn't use today (`accentFill`, `scrim`) are not emitted.
  `index.css` replaces its colour `@theme` entries, the `:root` /
  `:root[data-theme="dark"]` blocks and the `@custom-variant` line with
  `@import "./themes.css";`. The file is committed with a generated-file
  header naming the command.
- **Boot script** (`index.html`): `stored = localStorage.theme`; if missing or
  `"system"`, resolve with `matchMedia("(prefers-color-scheme: dark)")`;
  otherwise set it as `data-theme` as-is. An unknown id matches no block and
  renders as Light (including `dark:` swaps) — no id list is duplicated into
  the HTML.
- **`frontend/src/lib/theme.ts`**: `readThemePreference()` (parses
  `localStorage`) and `applyThemePreference(preference)` (resolves, sets
  `document.documentElement.dataset.theme`, writes `localStorage`; storage
  errors other than `DOMException` propagate, matching `ThemeToggle` today).
- **`useAccountThemeSync()`** mounted once in the signed-in app shell; uses
  `apiFetch` for `GET`/`PUT /auth/theme`.
- **Settings page**: an "Appearance" section above "Account" — a grid of
  tiles, System first, then the 11 themes in registry order. Each tile is a
  live mini preview painted from the registry with inline styles (page
  colour, a surface card, an accent bar) plus the label; System's preview is
  split Light/Dark. Tiles are visually-hidden native radio inputs inside
  labels (one `name`), so keyboard and screen readers work natively; the
  checked tile gets a 2px ring in the current theme's accent.
- **Text on accent and danger fills**: 44 elements put hardcoded
  `text-white` on `bg-(--color-accent)` and 4 on `bg-(--color-danger)`.
  White on Dark's accent is already ~2.6:1 and on the light accents of
  Midnight, Forest, Matrix, Synthwave, Seventies and Oxblood it is
  unreadable, so these become `text-(--color-on-accent)` /
  `text-(--color-on-danger)` (mobile already uses `onAccent`), guarded by a
  web test that fails if the pairing comes back.
- **Landing `ThemeToggle`**: reads the active theme's `scheme` from the
  registry (Midnight shows the sun) and flips to `"light"`/`"dark"` through
  `applyThemePreference`.

## Mobile

- **`mobile/src/ui/theme.tsx`**: `palettes` is deleted; colours come from
  `@scripta/shared/themes`. `ThemeColors` is re-exported from there so
  existing imports keep compiling.
  - Context value: `{ id, mode, colors, preference, setPreference }`. `mode`
    keeps its meaning (the theme's scheme), so `ThemedStatusBar`,
    `ReaderCardBlock` and `ReaderGlyph` are unchanged.
  - `ThemeProvider` reads AsyncStorage `theme` once and renders `null` until
    it resolves, so the first frame is already the right palette. A rejected
    read is not swallowed silently: it `console.warn`s and falls back to
    `"system"` (a missing theme is recoverable; the app must still start).
  - `setPreference(p)`: set state, write AsyncStorage, and call
    `Appearance.setColorScheme(scheme)` for an explicit theme or
    `"unspecified"` for System, so native alerts, keyboard and pickers match
    (confirmed on RN 0.86: `ColorSchemeName = 'light' | 'dark' | 'unspecified'`).
  - The unused `mode` prop on `ThemeProvider` is removed — nothing passes it.
- **`useAccountThemeSync()`** (mobile) mounted in `(app)/_layout.tsx` once
  `user` is set; uses the existing `apiClient`.
- **`SettingsScreen`**: "Appearance" section at the top — same tile previews,
  three per row, each `accessibilityRole="radio"` with
  `accessibilityState.checked`, at least `minimumTouchTarget` tall, accent
  ring on the selected tile.

## Testing

- **Shared** (`src/themes/themes.test.ts`):
  - Every theme: ≥ 4.5:1 for `text`/`background`, `text`/`surface`,
    `textDim`/`surface`, `textDim`/`background`, `accent`/`surface`,
    `onAccent`/`accent`, `onDanger`/`danger`, each of
    `danger|success|info|reference` on `surface`, each of
    `accent|danger|success|info|reference` on its own `*Soft`, and `text` on
    `accentFill`; and `accentFill` separates from `background` more than
    `border` does (the rule documented in `theme.tsx`). No exceptions —
    Light's accent and danger were darkened to pass before this spec landed.
  - `parseThemePreference`: every valid value round-trips; unknown string,
    `""`, `null`, a number → `"system"`.
  - `resolveTheme`: System under both OS schemes; an explicit id ignores the
    OS.
  - `reconcileThemePreference`: account null, equal, different.
- **Backend** (`routes.test.ts`, `sqliteAuthRepository.test.ts`; any new test
  file is added to backend's explicit `test` list): `GET`/`PUT` without a
  token → 401; `PUT` unknown id → 400; `PUT` then `GET` round-trips; `GET`
  for a never-set account → `null`; a stored unknown value reads back as
  `"system"`; the migration adds `theme` to a database created without it.
- **Web**: `scripts/test-themes-css.mts` fails when `src/themes.css` differs
  from the generator's output; `typecheck`, `lint`, `test`. Manual pass in the
  browser pane: the picker under one light and one dark theme, plates under
  Midnight, the landing toggle with a named theme active.
- **Mobile**: `typecheck`, `test`. Emulator pass only if
  `node scripts/dev-status.mjs --json` shows the emulator lease is free;
  otherwise reported as skipped.

## Docs

DESIGN.md's Color section: palettes live in `@scripta/shared/themes`; web's
CSS is generated from them (`npm run themes --workspace frontend`); list the
11 themes and their schemes. The Light/Dark token table stays as the
reference for the default theme. The line "One palette, byte-identical
between web … and mobile" becomes "one registry, consumed by mobile directly
and by web through generated CSS".
