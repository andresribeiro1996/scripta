# App typography

Date: 2026-09-28
Status: design approved in conversation; awaiting spec review
Depends on: `2026-09-28-app-themes-design.md` (merged as #58)
Follow-up after this: decor (per-theme background decor, themed logo mark,
motion effects).

## Problem

Themes change colour only. Web body text is a hardcoded system stack and only
the landing/sign-in/privacy pages use a display face (Playfair); the 82 in-app
`h1`–`h3` headings use the system font. Mobile loads no custom fonts at all:
~400 `Text` elements in 73 files set no family, and the card/mural style
"Playfair/Inter/JetBrains" options map to the OS serif/sans/mono.

## Goals

- Two font slots, each defaulting per theme and each overridable by the user
  independently of the theme: **display** (headings) and **text** (everything
  else: body, buttons, labels, inputs).
- The same fonts on web and mobile, self-hosted/bundled (no runtime CDN).
- The choice syncs through the account together with the theme.

## Non-goals

- Changing the card/mural style font options (`CardFontFamily`,
  `BlockFontFamily`) or how they render.
- iOS verification (the emulator is Android; bold rendering on iOS is reported
  as unverified).
- Fixing deferred items from the themes work (M6–M8 in that PR).

## Font catalog (`packages/shared/src/themes/fonts.ts`, exported from `@scripta/shared/themes`)

```ts
export type FontSlot = "display" | "text";
export type FontWeight = 400 | 600 | 700;
export interface FontDefinition {
  label: string;           // shown in pickers
  family: string | null;   // CSS/Google family name; null for system
  slots: readonly FontSlot[];
  weights: readonly FontWeight[]; // bundled static files; [] for system
  scale: number;           // size correction vs the system font
  fallback: string;        // CSS fallbacks after the family
}
```

`fontStack(id)` builds the CSS value (`"<family>", <fallback>`, or just the
fallback for system); `fontFileName(id, weight)` is `<id>-<weight>`.

| id | label | slots | weights | scale | fallback in `stack` |
|---|---|---|---|---|---|
| `system` | System | display, text | — | 1 | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` (today's body stack) |
| `playfair` | Playfair | display | 700 | 1 | `ui-serif, Georgia, serif` |
| `literata` | Literata | display, text | 400, 700 | 1 | `ui-serif, Georgia, serif` |
| `fraunces` | Fraunces | display | 700 | 1 | `ui-serif, Georgia, serif` |
| `cormorant` | Cormorant Garamond | display | 600 | 1.12 | `ui-serif, Georgia, serif` |
| `specialElite` | Special Elite | display | 400 | 1 | `ui-monospace, monospace` |
| `vt323` | VT323 | display | 400 | 1.3 | `ui-monospace, monospace` |
| `orbitron` | Orbitron | display | 700 | 0.88 | `sans-serif` |
| `righteous` | Righteous | display | 400 | 1 | `sans-serif` |
| `pressStart` | Press Start 2P | display | 400 | 0.72 | `ui-monospace, monospace` |
| `monoton` | Monoton | display | 400 | 0.85 | `sans-serif` |
| `atkinson` | Atkinson Hyperlegible | text | 400, 700 | 1 | `sans-serif` |
| `jetbrainsMono` | JetBrains Mono | text | 400, 700 | 1 | `ui-monospace, monospace` |

- `DISPLAY_FONT_IDS` (picker order): `system, playfair, literata, fraunces, cormorant, specialElite, vt323, orbitron, righteous, pressStart, monoton`.
- `TEXT_FONT_IDS` (picker order): `system, literata, atkinson, jetbrainsMono`.
- Scales are starting values; the verification pass may tune them (a scale
  change is a one-line registry edit). `playfair` and `jetbrainsMono` stay at
  1 because card/mural styles also use those families, and web `size-adjust`
  applies to every use of a family.
- Each web `@font-face` family is the font's label (`"Playfair Display"` for
  `playfair`, matching today's card-style family so its new 700 file also
  improves bold card titles).

### Theme defaults

`ThemeDefinition` gains `fonts: { display: FontId; text: FontId }`:

| Themes | display | text |
|---|---|---|
| light, dark, midnight | playfair | system |
| sepia | literata | literata |
| rose, forest | fraunces | system |
| matrix | vt323 | jetbrainsMono |
| synthwave | orbitron | system |
| seventies | righteous | system |
| newsprint | specialElite | literata |
| oxblood | cormorant | literata |

`pressStart` and `monoton` are override-only.

### Preferences

- `FontPreference = FontId | "theme"`.
- `DISPLAY_FONT_PREFERENCES = ["theme", ...DISPLAY_FONT_IDS]`,
  `TEXT_FONT_PREFERENCES = ["theme", ...TEXT_FONT_IDS]` (readonly tuples,
  usable with `z.enum`).
- `parseFontPreference(slot, value: unknown): FontPreference` — anything not
  in that slot's list → `"theme"`.
- `Appearance = { theme: ThemePreference; displayFont: FontPreference; textFont: FontPreference }`;
  `AccountAppearance` = same keys, each `| null` (null = never chosen).
- `resolveFonts(themeId: ThemeId, displayFont: FontPreference, textFont: FontPreference): { display: FontId; text: FontId }`
  — `"theme"` → the theme's default; ids are trusted only if eligible for the slot.
- `reconcileAppearance(account: AccountAppearance, device: Appearance): { apply: Partial<Appearance>; upload: Partial<Appearance> }`
  — per field, the existing rule: account null → upload device; equal →
  nothing; different → apply account. `reconcileThemePreference` is replaced
  by it.

## Backend (auth module)

- `connection.ts`: add `display_font TEXT` and `text_font TEXT` with the same
  column-exists check; add both to `schema.sql`. `UserRow` gains
  `display_font?`/`text_font?`.
- Port: `setTheme` becomes `setAppearance(userId, fields: { theme?: string; display_font?: string; text_font?: string })`
  (one `UPDATE` of only the given columns).
- Service: `getAppearance(userId): AccountAppearance` (stored values parsed:
  unknown theme → `"system"`, unknown font → `"theme"`; null stays null) and
  `setAppearance(userId, patch: Partial<Appearance>)`.
- Routes: `GET /auth/appearance` → `200 AccountAppearance`;
  `PUT /auth/appearance` with a partial body, `z.object({ theme: z.enum(THEME_PREFERENCES), displayFont: z.enum(DISPLAY_FONT_PREFERENCES), textFont: z.enum(TEXT_FONT_PREFERENCES) }).partial().strict()`
  plus "at least one field" → `204`; otherwise `400 { error: "Unknown appearance." }`.
  Both behind `authGuard` with `config: { rateLimit: { max: 120, timeWindow: "1 minute" } }`.
  `GET`/`PUT /auth/theme` and their tests are removed.

## Sync (both clients)

- Local cache keys: `theme` (unchanged), `fontDisplay`, `fontText`.
- One `GET /auth/appearance` on mount of the signed-in shell and on
  foreground; `reconcileAppearance`; apply each `apply` field; one `PUT` with
  all `upload` fields if any.
- Picking in Settings applies + caches immediately, then `PUT`s only that
  field. Failure: same alert copy as today ("Couldn't save to your account.
  Try again."), same catch filter (`ApiError`/`TypeError` only).
- Web: the `storage` follower re-applies on changes to any of the three keys.

## Web

- **Files**: `frontend/public/fonts/<id>-<weight>.woff2` (latin subset) for
  every non-system (id, weight) pair. The generated `jetbrainsMono-400` face
  replaces the hand-written `JetBrains Mono` `@font-face` in `index.css` (same
  family and weight — delete the hand-written rule and
  `jetbrains-mono-regular.woff2`). The hand-written `Playfair Display` 400 and
  `Inter` 400 faces stay (card styles use them). OFL texts in
  `frontend/public/fonts/licenses/<id>.txt`.
- **Generated `themes.css`** (same generator, same stale-file test) gains:
  - `@font-face` per (id, weight): `font-family: "<label>"`, `src: url("/fonts/<id>-<weight>.woff2") format("woff2")`,
    `font-display: swap`, `size-adjust: <scale*100>%`, and — for display-only
    fonts with a single weight, except `playfair` — `font-weight: 100 900` so
    headings never get synthesized bold. `playfair` declares `700` exactly
    (its family also has the hand-written 400 card face, which a range would
    shadow); text fonts declare their real weights.
  - `--font-display` and `--font-text` (the font's `stack`) in `@theme`
    (Light's defaults) and in every `:root[data-theme]` block.
  - After all theme blocks: `:root[data-font-display="<id>"] { --font-display: … }`
    for every display id and `:root[data-font-text="<id>"] { --font-text: … }`
    for every text id.
- **`index.css`**: `body { font-family: var(--font-text) }` (replacing the
  hardcoded stack); `@layer base { h1, h2, h3 { font-family: var(--font-display) } }`
  (in the base layer so utilities such as `font-mono` still win); the
  hand-written `--font-display` in `@theme` is removed (now generated). The
  Tailwind `font-display` utility therefore follows the theme (landing/auth
  headings stay Playfair under Light). Existing hand-written `@font-face`
  rules for the card-style fonts stay.
- **Boot script**: also sets `data-font-display` / `data-font-text` from
  `fontDisplay` / `fontText` when the stored value is anything other than
  missing or `"theme"` (an ineligible or unknown id matches no rule and falls
  back to the theme default).
- **`lib/theme.ts`**: font read/apply alongside theme read/apply (set/remove
  the data attribute, write the key, dispatch the existing change event);
  `useAppearance()` replaces `useThemePreference()` for consumers that need
  all three.
- **Settings → Appearance**: under the theme grid, "Headings" and "Text"
  radio-chip groups; each chip's label is rendered in its own font; the first
  chip reads `Theme default · <resolved font label>`.

## Mobile

- **Files**: `mobile/assets/fonts/<id>-<weight>.ttf`, same (id, weight) set;
  OFL texts alongside in `mobile/assets/fonts/licenses/`.
- **Loading**: `expo-font` becomes a direct dependency (`npx expo install
  expo-font`, SDK-57 version); the root layout calls `useFonts` with
  `{ "<id>-<weight>": require(…) }` and renders nothing (splash stays up)
  until fonts and the provider's stored preferences are both ready. A font
  load error is logged with `console.warn` and the app continues on system
  fonts (a missing face must not brick the app).
- **`ThemeProvider`**: holds `displayFont`/`textFont` preferences (AsyncStorage
  `fontDisplay`/`fontText`) next to `theme`; context adds
  `fonts: { display: FontId; text: FontId }` (resolved) and
  `setFontPreference(slot, pref)`.
- **`mobile/src/ui/fontStyle.ts`** (pure, unit-tested):
  `fontStyleFor(fontId, slot, style: { fontWeight?, fontSize?, lineHeight? })`
  → `{ fontFamily?, fontWeight?, fontSize?, lineHeight? }`: `system` returns
  nothing; display → `"<id>-<its weight>"`; text → `"<id>-700"` when
  weight ≥ 600 else `"<id>-400"`; a custom family drops `fontWeight`; sizes
  multiply by `scale` (rounded).
- **`mobile/src/ui/Text.tsx`**: `Text` wrapping React Native's, applying
  `fontStyleFor` — the display slot when the resolved font size is ≥ 18
  (`typography.title` and up), the text slot otherwise, with a `display`
  prop to force either way. An explicit `fontFamily` in the passed style
  always wins (card/mural styling keeps working). `TextInput` is not
  wrapped: its single render site (`ui/components.tsx` `Input`) applies the
  text font directly (it is also used as a ref type, which a wrapper would
  break).
- **Migration**: every `Text` import from `"react-native"` in `mobile/src`
  moves to `ui/Text`; `navigation.tsx` header titles use the display font and
  the tab bar labels the text font.
- **Load failure**: `ThemeProvider` takes `bundledFonts`; when the fonts
  failed to load, both slots resolve to System rather than naming faces that
  were never registered. The splash screen is held until fonts are ready.

## Testing

- **Shared**: catalog integrity (unique ids; every theme default exists and is
  eligible for its slot; picker lists only contain eligible ids; every
  non-system font has ≥ 1 weight and display-only fonts exactly one);
  `parseFontPreference`; `resolveFonts` (theme default, override, ineligible
  id); `reconcileAppearance` per field.
- **Backend**: `/auth/appearance` — 401 without token, never-set → all null,
  partial `PUT` round-trips one field without touching others, empty body →
  400, unknown value → 400, unknown stored value reads back as default,
  theme-routes-style rate-limit isolation test; migration adds both columns.
- **Web**: generated-CSS tests extended — a `@font-face` per (id, weight),
  override blocks after theme blocks, every theme block sets both font vars;
  typecheck/lint/test.
- **Mobile**: `fontStyleFor` unit tests (system passthrough, weight mapping,
  explicit family untouched by the wrapper's contract, scale rounding);
  typecheck/test; a guard test that no file under `mobile/src` imports `Text`
  from `"react-native"` except `ui/Text.tsx`.
- **Manual**: browser pass (Matrix, Oxblood, Press Start 2P override,
  cross-tab), emulator pass (same three plus a cold start), both only after
  checking the lease per AGENTS.md.

## Docs

DESIGN.md gains a Typography section (catalog, slots, defaults, where each
slot applies). DESIGN.md mirrors the live Design System artifact, which still
needs this change and the themes one — flagged to the user, not edited here.

## Sourcing

Files come from Google Fonts (SIL OFL 1.1; Apache-2.0 for Special Elite): web WOFF2 latin subsets from
the CSS2 API with a modern user agent, mobile static TTFs from the same API
with a plain user agent (static instances per weight, including variable
families — if the API returns only a variable file for some family, the
static instance is cut with fontTools' `instancer` instead), licences from
`github.com/google/fonts/ofl/<family>/OFL.txt`.
About 30 files, ~2 MB total. Downloading needs the user's explicit go-ahead.
