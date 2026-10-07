# Atmyshelf Design System

Local mirror of the live [Atmyshelf Design System](https://claude.ai/artifact/3X65LF3q7Tc4pqEHmReyp6) artifact, for agents (Codex, opencode/GLM) that can't reach a Claude artifact. Claude Code should prefer reading the artifact directly when available, since it has live component previews; this file exists so every agent has the same values.

**Keeping this in sync**: the artifact is the source of truth. When tokens or components change there, ask Claude Code to regenerate this file from it. This file will drift if edited independently of the artifact.

Extracted from real app source (`packages/shared/src/themes/palettes.ts` and the component files cited per section) — not invented. One theme registry, `packages/shared/src/themes/palettes.ts`, read directly by mobile and by web through `frontend/src/themes.css`, which `npm run themes --workspace frontend` generates from it (a web test fails if it goes stale). The product is Atmyshelf; "Scripta" survives only in package names and the design system's bundle global.

## Color

| Token | Light | Dark | Usage |
|---|---|---|---|
| `bg` | `#f2f0ec` | `#141210` | Page background |
| `surface` | `#ffffff` | `#2a2724` | Cards, sheets, dialogs, inputs; the whole page on phone-width sign-in screens |
| `surface-hover` | `#f7f5f1` | `#333029` | Hover/press state (mobile: `surfacePressed`) |
| `text` | `#201e1c` | `#ece8e3` | Primary text (14.6:1 / 15.3:1 on bg) |
| `text-dim` | `#6b6560` | `#a8a199` | Secondary/caption text (5.05:1+ on bg) |
| `border` | `#ddd8d0` | `#45403a` | Hairlines only — deliberately low-contrast (~1.25–1.8:1), never the sole signal for an interactive edge |
| `accent` | `#97532d` | `#e08a52` | Primary action fill, focus ring, active tab, link underlines. Accent *text* is 5.14:1 / 7.05:1 on bg; small links are still `text` with an accent underline. One accent button per view |
| `accent-soft` | `#f1e2d8` | `#3a2c22` | Accent chip/badge bg (e.g. "Coming soon", avatar initials) — `accent` text on it 4.63:1 / 5.07:1 |
| `accent-fill` | `#e0ccbf` | `#593b26` | Mobile only: selected fill that must outrank a border (`text` on it 10.7:1 / 8.3:1) |
| `danger` | `#ae412e` | `#e08072` | Destructive actions, field error text/border |
| `danger-soft` | `#f6dfda` | `#3a2420` | Error banner bg — `danger` text on it 4.59:1 / 5.16:1 |
| `success` | `#47713c` | `#8fbf7f` | The one "done"/positive state (e.g. finished tournament) — use sparingly |
| `success-soft` | `#e4efdf` | `#262f21` | Success chip bg, paired with `success` text |
| `info` | `#285f7a` | `#7fb8d4` | Running with nothing asked of you (tournament in progress) — never an action colour |
| `info-soft` | `#dcebf2` | `#1f2d33` | Info chip bg, paired with `info` text |
| `reference` | `#6b4f8f` | `#b9a3d6` | Kept permanently as the canonical result (promoted tier list) — distinct from merely finished |
| `reference-soft` | `#ebe4f3` | `#2c2536` | Reference chip bg, paired with `reference` text |
| `scrim` | `rgba(32,30,28,.48)` | `rgba(0,0,0,.64)` | Modal/sheet backdrop |
| `on-accent` | `#ffffff` | `#141210` | Text on filled `accent` (5.85:1 / 7.05:1) |
| `on-danger` | `#ffffff` | `#141210` | Text on filled `danger` |
| `image-caption-scrim` | `rgba(10,8,6,.6)` | *(same)* | Caption bar over a mural photo — deliberately identical in both themes; pairs with hardcoded white text |

### Themes

The table above is the default Light/Dark pair. The registry defines eleven themes with the same tokens: Light, Sepia, Rosé and Newsprint use the light scheme; Dark, Midnight, Forest, Matrix, Synthwave, Seventies and Oxblood use the dark scheme. Settings → Appearance picks one, or System (Light or Dark from the OS). The choice is cached per device under `theme` and synced through `GET`/`PUT /auth/appearance` while signed in (it syncs theme and both fonts); the account wins. Every theme passes the AA pairs in `packages/shared/src/themes/themes.test.ts`. Dark-scheme themes get the reversed reader-card print and Tailwind's `dark:` variant. Text on an `accent` or `danger` fill is always `on-accent` / `on-danger`, never white. Matrix, Synthwave, Seventies, Newsprint and Oxblood also carry decor (`packages/shared/src/themes/decor.ts`): flat motifs pinned to a corner or edge, behind the content, never above 0.25 opacity. Matrix has a glyph fall at the top right, Synthwave a sliced sun and horizon grid at the bottom, Seventies a triple-stripe arc at the top right, Newsprint a double rule along the top edge and a halftone corner, and Oxblood a gilt double frame with corner diamonds. Decor has no preference of its own; a plain theme is how you get none.

### Typography

Two slots, both set per theme and overridable in Settings → Appearance: **display** (web `h1`–`h3` and the `font-display` utility; mobile text of 18pt and up or with `display`) and **text** (everything else, including inputs and buttons). The catalog lives in `packages/shared/src/themes/fonts.ts`; files are bundled (`frontend/public/fonts`, `mobile/assets/fonts`, licences alongside (SIL OFL; Apache-2.0 for Special Elite)). Defaults: Light, Dark and Midnight Playfair / System; Sepia Literata / Literata; Rosé and Forest Fraunces / System; Matrix VT323 / JetBrains Mono; Synthwave Orbitron / System; Seventies Righteous / System; Newsprint Special Elite / Literata; Oxblood Cormorant Garamond / Literata. Text with its own font (book-card and mural styles) keeps it. The choice syncs with the theme through `/auth/appearance`.

### Tier-rank colors (not theme tokens — per-tierlist mutable data, default presets)

`tier-s #c9482f` · `tier-a #d98a3d` · `tier-b #c9a53d` · `tier-c #5c9e5c` · `tier-d #4a7fc9` (the one blue in the palette) · `tier-grey #8a8580` (neutral/catch-all preset). Never alias these to `accent`/`danger`/`success` even where a hue is close — rank and state are different meanings.

## Type

In-app `h1`–`h3` (web) and mobile text 18pt and up (or with `display`) render in the theme's **display** font; body copy, buttons and inputs render in the theme's **text** font — see the Typography section above for the catalog, defaults, and how the choice is picked and synced.

Three self-hosted, Latin-subset fonts also exist separately for book-cover title/author overlay text and mural blocks, one of 6 user-selectable options (`CardFontFamily`/`BlockFontFamily`): `Playfair Display`, `Inter`, `JetBrains Mono` (files under `frontend/public/fonts/`), plus 3 unstyled system stacks — card and mural styles keep whichever of these they set for themselves, regardless of the theme's display/text choice. `Playfair Display` and `JetBrains Mono` share their font-family name with the theme catalog above: Playfair ships a 700 face for headings while the 400 face stays for card styles, and JetBrains Mono ships both 400 and 700, so a bold card/block title in either now renders the real bundled face rather than synthesized bold; `Inter` stays single-weight and still relies on `font-synthesis` for bold.

Sentence case throughout; no uppercase eyebrow labels.

App text scale (mobile named, web uses the equivalent Tailwind size):

| Style | Size/Line | Weight | Usage |
|---|---|---|---|
| `caption` | 12/16 | 400 | Helper/error text. Web: `text-xs` |
| `body` | 14/20 | 400 | Default body copy. Web: `text-sm` |
| `body-strong` | 14/20 | 600 | Labels, row titles, button text — `font-semibold` is the single most-used weight on web (190+ sites) |
| `input` | 16/22 | 400 | Field text, mobile only (16px avoids iOS auto-zoom). Web: `text-base` |
| `title` | 18/24 | 700 | Sheet/dialog headers. Web: `text-lg/xl` |
| `heading` | 24/30 | 700 | Screen headings. Web: `text-2xl/3xl` |

## Spacing (4px base unit)

`space-0` 0 · `space-xs` 4 · `space-sm` 8 (most common) · `space-md` 12 · `space-lg` 16 (card padding, button padding) · `space-xl` 20 (sheet padding) · `space-2xl` 24 · `space-3xl` 32 · `space-4xl` 48 (rare). `minimumTouchTarget` = 44px, hard floor for any tappable control.

## Radius

`radius-sm` 6 · `radius-md` 8 (default: buttons/inputs/toasts) · `radius-lg` 12 (dialogs) · `radius-xl` 16 (sheets' top corners, default book-cover radius) · `radius-full` 999 (pills, icon buttons, FAB, badges).

## Shadow

Used sparingly — surfaces are normally separated by `border`, not shadow.
- `shadow-overlay`: `0 20px 25px -5px rgb(0 0 0/.1), 0 8px 10px -6px rgb(0 0 0/.1)` — web dialogs/sheets only.
- `shadow-fab`: `0 4px 8px rgb(0 0 0/.3)` — mobile FAB only, the one elevated control on mobile.

## Iconography

No bundled icon library, by design:
- **Mobile**: native glyphs via `expo-symbols` (SF Symbols/Material Symbols), addressed by a shared `IconName` vocabulary.
- **Web**: hand-authored inline SVG — `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth` 1.9–2, round caps/joins. Nav icons 18–22px, toolbar icons 16–18px.

## Layout

Content max-width is a per-library user preference (`contentMaxWidth`, 800–1800px, default **1152px**). Book grid: CSS Grid `repeat(auto-fill, minmax(cardFloor,1fr))`, `space-lg` gap, phone-width override guarantees 3 columns. No custom breakpoints — stock Tailwind v4 defaults (`sm` = 640px).

## Motion

Web keyframes 130–200ms on `cubic-bezier(0.32, 0.72, 0, 1)` for dialogs/sheets/menus/toasts. Mobile toasts fade 180ms; skeletons pulse 700ms. The brand mark plays its theme's entrance (scan, rise, fan, register or gild; 560–700ms, `ENTRANCE` in `packages/shared/src/themes/brand.ts`) once per page load or app launch, and picking a theme fades for 250ms (a View Transition on web, a veil in the old background colour on mobile). Both fully respect `prefers-reduced-motion` / `AccessibilityInfo.isReduceMotionEnabled()`, snapping instantly instead of animating.

## Brand lockup

One lockup wherever the product names itself: the brand mark at 28px (`components/BrandMark.tsx`, drawn in the active theme's treatment) beside "Atmyshelf" in the system stack, 18px bold (`components/BrandLockup.tsx`). Used by the app sidebar and mobile drawer, the landing nav and footer, and every sign-in screen, where it links to `/`.

The name stays live system-stack text, not Playfair: the lockup is interface chrome, and Playfair's single 400 weight reads thin at 18px beside the 28px mark. The stacked lockup (`logo.png`) sets the name in Playfair Display because an image can't carry the system stack; use it only where the product isn't drawing its own UI (store listings, press, a README).

Mobile draws the same mark (`ui/BrandMark.tsx`) above the name on the login screen and beside the Home title.

## Public pages

Landing (`/`), privacy (`/privacy`) and the sign-in journey use the same tokens as the app. The theme follows the OS until the landing header's toggle (light/dark) or Settings → Appearance (any theme) picks one; `index.html` applies the choice (`localStorage` `theme`) as `data-theme` on `<html>` before first paint, so it carries into the app. Extra rules: show the product through real screenshots (regenerated with `npm run screenshots:landing --workspace frontend`, never hand-mocked), one accent button per view, no store badges or links until they point somewhere real, unreleased features labelled with an `accent-soft` "Coming soon" chip. Content width 1152px with `px-4 sm:px-6` gutters.

## Logos

The mark is a capital A made of two books leaning together on a shelf. The thin book on the left and the thick one on the right give it the thick–thin stress of a serif A (Playfair's included); a crossbar and the shelf rule finish the letter. Flat shapes only, so it holds at 16px; the notch where the tops meet and the lifted outer corners of the books only show from about 48px up.

Masters are in `design/brand/`: `mark.svg` (a 76-unit square box) and `lockup.svg` (the mark over "Atmyshelf" in Playfair Display 400, outlined to paths so nothing depends on an installed font; it carries its own copy of the mark, so change both). `node design/brand/render.mjs` rasterises every file below with Chromium — edit the SVGs and rerun it, never retouch a PNG.
- `frontend/public/favicon-48.png`, `icon-192.png`, `icon-512.png` — paper (`#f2f0ec`) mark on a full-bleed dark `bg` (`#141210`) square. `icon-512.png` is also the maskable icon, so the mark stays inside the central 80% circle.
- `frontend/public/logo.png` — the stacked lockup, ink (`#201e1c`) on transparent, 992×1070.
- `frontend/public/email/mark.png` and `mark-dark.png` — the mark at 112×112 (shown at 28px in the account emails), ink / dark-theme `text` (`#ece8e3`) on transparent.
- `mobile/assets/images/icon.png` and `favicon.png` — the web icons' treatment. `adaptive-foreground.png` and `adaptive-monochrome.png` — paper mark on transparent, inside Android's 66dp safe circle, over `app.json`'s `#141210`. `splash-icon.png` / `splash-icon-dark.png` — ink / dark-theme `text` (`#ece8e3`) mark on transparent. `amsicon-source.png` — the mark at 1254px, ink on transparent.

In the app the mark follows the theme (`markTreatment` in `packages/shared/src/themes/brand.ts`). Matrix, Synthwave, Seventies, Newsprint and Oxblood draw their themed finish, accent included: banded, sliced, a triple-stripe echo, an off-register red plate, and a gilt bookplate. Every other theme draws the plain mark in its text colour. Files outside the app (the icons, splash and `logo.png` above) keep two treatments only: ink on paper or transparent, paper on the dark `bg`. `frontend/public/Gemini_Generated_Image_....jfif` is an unrelated AI-test image, not a brand asset.

## Components

Full guidelines, states and prop shapes live in the artifact's per-component READMEs — this is the condensed version. Source files are cited so you can go straight to the real implementation.

### Core controls (`mobile/src/ui/components.tsx`; web composes the same tokens ad hoc per call site, no shared primitives)

- **Button** — variants `primary` (filled `accent`/`on-accent`) / `secondary` (`surface` + `border`, hover → `surface-hover`) / `destructive` (filled `danger`/`on-danger`). 44px min-height, `radius-md`, `body-strong` label. `disabled` → 0.55 opacity; `loading` → spinner replaces label. One primary button per screen.
- **IconButton** — glyph-only (44×44, `radius-full`) or glyph+label (pill). `tone: default | danger | accent` (accent = filled `accent`/`on-accent`, pressed `accent-soft`). Always set `accessibilityLabel`.
- **Input** — label (`body-strong`) + field (`surface`, `radius-md`, `input` text) + hint/error (`caption`). Border: `border` default → `accent` focused → `danger` on error (error wins). Optional leading icon and password show/hide toggle, each reserving 44px.
- **Toast** — `default` (`surface`/`border`) / `success` (mobile only) / `error` (`danger-soft`/`danger`). `radius-md`, `shadow-overlay` on web. One at a time, replaces not stacks.
- **EmptyState** — shared shape for "nothing here" (neutral) and "error" (`danger-soft` card, `radius-lg`). Centered column, optional primary-button action.

### Content cards

- **BookCard** (`frontend/src/components/BookCard.tsx` + `BookGrid`) — cover fills tile at `cardRadius` (user pref, default `radius-xl`/16px, 0–32 range). Optional title/author overlay in one of 6 `CardFontFamily` choices, over a scrim. No-cover fallback: plain `surface` tile with centered title, never a broken-image icon.
- **ListCard** (`ArenaListPage.tsx`, repeated classes not a shared component) — tierlist/tournament row: `radius-xl`, `border`, title (`body-strong`) + one meta line (`text-dim`). Hover/selected → border swaps to `accent`.
- **TournamentStatusBadge** (`components/arena/TournamentStatusBadge.tsx`) — pill: `seeding` (`border`/`surface`/`text-dim`) / `active` (`accent`/`accent-soft`) / `completed` (`success`/`success-soft`, the only other place `success` appears).
- **TierRow** (`components/tierlist/TierRowShell.tsx`) — colored label chip (raw per-tierlist hex, white text + shadow) + wrapping `6em×4em` book tiles. Empty row still renders at 4em min-height ("Drag books here") — never collapses to zero.
- **MuralBlock** (`components/murals/blocks/*.tsx`) — 8 variants: `shelf`/`currentlyReading` (horizontal scroll, hand-curated order; `currentlyReading` covers carry an `accent`-on-`border` progress bar + percent, no captions), `spotlight` (full-bleed single cover), `quote` (vertically centered pull-quote), `quoteCollection` (left-ruled citations, `accent` as a structural rule), `text` (no color muting — user's own words), `profile` (avatar + eyebrow-label sections, reuses `accent-soft`/`accent` as chip), `image` (zero inner padding, `image-caption-scrim`), `stats` (numbers hardcoded to `accent`, a badge not body text; when total, finished and in-progress are all selected, a library breakdown bar — `accent` / `accent-fill` / `border` — with legend replaces the number strip). `shelf`/`currentlyReading`/`quoteCollection`/`tierlist` titles are eyebrow headings (`text-dim`, uppercase), with a book count on the two book rows. All blocks size text in `em` not `rem` so per-block `fontSize` cascades. Block chrome (`radius-lg`/`border`/`surface`) applied uniformly by `MuralCanvas.tsx`.
- **DuelCard** (`components/arena/DuelCard.tsx`) — two book sides with **2px** border (the one 2px control in the system — the border carries the primary signal here), live tally bar (`accent` fill on `border` track). Winner side border → `accent`; no separate loser-red treatment.
- **BracketMap** (`components/arena/BracketMap.tsx`) — tournament bracket, pure-CSS connectors: equal `flex-1` cells per round so a parent match centers exactly on its two child matches, connected by small absolutely-positioned 1px-`border` stub elements (no SVG, no JS measuring). Winner: 2px `accent` ring on cover. Loser: 0.45 opacity. Empty slot: dashed `border`.

### Forms (web)

- **AuthCard** (`frontend/src/auth/AuthStage.tsx`) — the frame of every sign-in screen: lockup linking to `/`, then a 400px card (`surface`, `border`, `radius-lg`, 32px padding, no shadow) with a `font-display` 30px heading and an optional `text-dim` line, sentence-case `body-strong` labels, fields on `bg` with 16px text and 44px min height (error replaces hint), one accent submit, "Continue with Google" as a secondary button after an "or" divider, a text link to switch log in/sign up, and a 12px Privacy link under the card. Below `sm` the card chrome drops and the page takes `surface`. `color-scheme: light dark` on the stage so native controls follow the theme.

### Other controls

- **ToggleSwitch** (`ui/components.tsx`; Settings → Socials, Feed settings) — 44×24 pill, `accent` fill when on (not `success` — this is a settings toggle, not a status indicator).
- **TierColorPicker** (`components/tierlist/TierColorPicker.tsx`) — 6 preset swatches (S/A/B/C/D/Grey) + custom `<input type="color">` in a dashed tile. Commits on **blur**, not `change`, so dragging the native color wheel doesn't spam re-renders.

### Headers (mobile — native stack bar via `useScreenOptions()`)

- A header carries the back chevron, the title, at most **two** labelled actions and the `⋯` overflow menu — everything else belongs in the menu or in screen content.
- Every header action is an **`IconButton` with `label` + `framed`** (icon + word in a drawn 44pt target), so the visible target matches the touch target — a bare glyph reads smaller than its hit area and people aim at the ink. The `⋯` menu trigger stays glyph-only (platform convention).
- Creation stays on **FABs** (thumb zone), not the header; header buttons navigate (`Browse`, `Library`) or open modals (`Add`, `Upload`, `Save`).
- The mural, tier list and quiz editors, and the Library screen, show their name as a page heading (`EditorHeading`, tap to rename where renaming exists) at the top of the content, and the editors carry a labelled Save state button — Save in accent while there are unsaved changes, Saving… while saving, and Saved with a checkmark when saved — because an editor's title can't share a narrow header with its actions.
- A screen's primary social action (Follow) is a full-width `Button` in the profile content, never a header pill.

### Gesture components (mobile only — Reanimated + haptics, not reproducible in a static doc)

- **ArenaVoteDeck** (`mobile/src/features/arena/ArenaVoteDeck.tsx`) — drag up to vote win, down to vote lose. Commit threshold 100px drag OR velocity >850px/s + 30px travel. Rotation ±5° at threshold, tint (`success`/`danger`) ramps 0→0.25 opacity, "WINS"/"LOSES" pill fades in only in the last ~25px before commit. Spring back `dampingRatio 0.8` if released early. Always pair with a tap-to-vote fallback.
- **TierSortDeck** (`mobile/src/features/tierlists/TierSortDeck.tsx`) — long-press (220ms) + drag a book toward a ring of tier targets placed by trigonometry. Drag must *start* below the ring's center or it's ignored. Nearest target within 56px highlights and scales 1.18×; haptic on drag-start and again only on a successful drop.

---
*Regenerate this file from the [live artifact](https://claude.ai/artifact/3X65LF3q7Tc4pqEHmReyp6) via Claude Code when tokens or components change there.*
