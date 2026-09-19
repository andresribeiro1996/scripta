# Scripta Design System

Local mirror of the live [Scripta Design System](https://claude.ai/artifact/3X65LF3q7Tc4pqEHmReyp6) artifact, for agents (Codex, opencode/GLM) that can't reach a Claude artifact. Claude Code should prefer reading the artifact directly when available, since it has live component previews; this file exists so every agent has the same values.

**Keeping this in sync**: the artifact is the source of truth. When tokens or components change there, ask Claude Code to regenerate this file from it. This file will drift if edited independently of the artifact.

Extracted from real app source (`frontend/src/index.css`, `mobile/src/ui/theme.tsx`, and the component files cited per section) — not invented. One palette, byte-identical between web's Tailwind v4 `@theme` block and mobile's `palettes` object.

## Color

| Token | Light | Dark | Usage |
|---|---|---|---|
| `bg` | `#f5f4f2` | `#1a1815` | Page background |
| `surface` | `#ffffff` | `#242220` | Cards, sheets, dialogs, inputs |
| `surface-hover` | `#fbfaf8` | `#2b2926` | Hover/press state |
| `text` | `#201e1c` | `#ece8e3` | Primary text (15.1:1 / 14.5:1 on bg) |
| `text-dim` | `#6b6560` | `#a39c93` | Secondary/caption text (5.2:1+ on bg) |
| `border` | `#e4e0da` | `#38342f` | Hairlines only — deliberately low-contrast (~1.2–1.4:1), never the sole signal for an interactive edge |
| `accent` | `#a85c32` | `#e08a52` | Primary action fill, links, focus ring, active tab |
| `accent-soft` | `#f1e2d8` | `#3a2c22` | Accent chip/badge bg — pair with `text`, not `accent` |
| `danger` | `#b3432f` | `#e08072` | Destructive actions, error text/border |
| `danger-soft` | `#f6dfda` | `#3a2420` | Error banner bg — `danger` text on it is 4.38:1 light (just under AA; short labels only) |
| `success` | `#47713c` | `#8fbf7f` | The one "done"/positive state (e.g. finished tournament) — use sparingly |
| `success-soft` | `#e4efdf` | `#262f21` | Success chip bg, paired with `success` text |
| `scrim` | `rgba(32,30,28,.48)` | `rgba(0,0,0,.64)` | Modal/sheet backdrop |
| `on-accent` | `#ffffff` | `#1a1815` | Text on filled `accent` |
| `on-danger` | `#ffffff` | `#1a1815` | Text on filled `danger` |
| `image-caption-scrim` | `rgba(10,8,6,.6)` | *(same)* | Caption bar over a mural photo — deliberately identical in both themes; pairs with hardcoded white text |

### Tier-rank colors (not theme tokens — per-tierlist mutable data, default presets)

`tier-s #c9482f` · `tier-a #d98a3d` · `tier-b #c9a53d` · `tier-c #5c9e5c` · `tier-d #4a7fc9` (the one blue in the palette) · `tier-grey #8a8580` (neutral/catch-all preset). Never alias these to `accent`/`danger`/`success` even where a hue is close — rank and state are different meanings.

## Type

No brand font for UI chrome — both platforms use the OS system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) for all labels/buttons/body/headings.

Three self-hosted, Latin-subset, **regular-weight-only** fonts exist for exactly one purpose — book-cover title/author overlay text, one of 6 user-selectable options (`CardFontFamily`): `Playfair Display`, `Inter`, `JetBrains Mono` (files under `frontend/public/fonts/`), plus 3 unstyled system stacks. Bold uses `font-synthesis`, never a second downloaded weight.

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

Web keyframes 130–200ms on `cubic-bezier(0.32, 0.72, 0, 1)` for dialogs/sheets/menus/toasts. Mobile toasts fade 180ms; skeletons pulse 700ms. Both fully respect `prefers-reduced-motion` / `AccessibilityInfo.isReduceMotionEnabled()` — snap instantly instead of animating.

## Logos

Files in `frontend/public/` and `mobile/assets/images/`. The mark is a serif "S" ligature that doubles as a bookshelf (crossbars read as shelf brackets).
- `frontend/public/logo.png` — full lockup (monogram + "Scripta" wordmark), dark ink on transparent. Primary mark for light contexts.
- `frontend/public/scriptap.png` — monogram alone, dark ink on transparent. Use below ~64px where the wordmark stops being legible.
- `mobile/assets/images/amsicon-source.png` — the 1254px master source art (white glyph, transparent). Regenerate any new export from this, not from a resized existing export.
- `frontend/public/icon-512.png` — shipped PWA icon: white glyph on near-black square.
- `frontend/public/favicon-48.png` — same treatment at the smallest real size it's shown.

Never recolor the mark outside these two treatments (dark ink on transparent / white on dark square). `frontend/public/Gemini_Generated_Image_....jfif` is an unrelated AI-test image, not a brand asset.

## Components

Full guidelines, states and prop shapes live in the artifact's per-component READMEs — this is the condensed version. Source files are cited so you can go straight to the real implementation.

### Core controls (`mobile/src/ui/components.tsx`; web composes the same tokens ad hoc per call site, no shared primitives)

- **Button** — variants `primary` (filled `accent`/`on-accent`) / `secondary` (`surface` + `border`, hover → `surface-hover`) / `destructive` (filled `danger`/`on-danger`). 44px min-height, `radius-md`, `body-strong` label. `disabled` → 0.55 opacity; `loading` → spinner replaces label. One primary button per screen.
- **IconButton** — glyph-only (44×44, `radius-full`) or glyph+label (pill). `tone: default | danger`. Always set `accessibilityLabel`.
- **Input** — label (`body-strong`) + field (`surface`, `radius-md`, `input` text) + hint/error (`caption`). Border: `border` default → `accent` focused → `danger` on error (error wins). Optional leading icon and password show/hide toggle, each reserving 44px.
- **Toast** — `default` (`surface`/`border`) / `success` (mobile only) / `error` (`danger-soft`/`danger`). `radius-md`, `shadow-overlay` on web. One at a time, replaces not stacks.
- **EmptyState** — shared shape for "nothing here" (neutral) and "error" (`danger-soft` card, `radius-lg`). Centered column, optional primary-button action.

### Content cards

- **BookCard** (`frontend/src/components/BookCard.tsx` + `BookGrid`) — cover fills tile at `cardRadius` (user pref, default `radius-xl`/16px, 0–32 range). Optional title/author overlay in one of 6 `CardFontFamily` choices, over a scrim. No-cover fallback: plain `surface` tile with centered title, never a broken-image icon.
- **ListCard** (`ArenaListPage.tsx`, repeated classes not a shared component) — tierlist/tournament row: `radius-xl`, `border`, title (`body-strong`) + one meta line (`text-dim`). Hover/selected → border swaps to `accent`.
- **TournamentStatusBadge** (`components/arena/TournamentStatusBadge.tsx`) — pill: `seeding` (`border`/`surface`/`text-dim`) / `active` (`accent`/`accent-soft`) / `completed` (`success`/`success-soft`, the only other place `success` appears).
- **TierRow** (`components/tierlist/TierRowShell.tsx`) — colored label chip (raw per-tierlist hex, white text + shadow) + wrapping `6em×4em` book tiles. Empty row still renders at 4em min-height ("Drag books here") — never collapses to zero.
- **MuralBlock** (`components/murals/blocks/*.tsx`) — 8 variants: `shelf`/`currentlyReading` (horizontal scroll, hand-curated order), `spotlight` (full-bleed single cover), `quote` (vertically centered pull-quote), `quoteCollection` (left-ruled citations, `accent` as a structural rule), `text` (no color muting — user's own words), `profile` (avatar + eyebrow-label sections, reuses `accent-soft`/`accent` as chip), `image` (zero inner padding, `image-caption-scrim`), `stats` (numbers hardcoded to `accent`, a badge not body text). All blocks size text in `em` not `rem` so per-block `fontSize` cascades. Block chrome (`radius-lg`/`border`/`surface`) applied uniformly by `MuralCanvas.tsx`.
- **DuelCard** (`components/arena/DuelCard.tsx`) — two book sides with **2px** border (the one 2px control in the system — the border carries the primary signal here), live tally bar (`accent` fill on `border` track). Winner side border → `accent`; no separate loser-red treatment.
- **BracketMap** (`components/arena/BracketMap.tsx`) — tournament bracket, pure-CSS connectors: equal `flex-1` cells per round so a parent match centers exactly on its two child matches, connected by small absolutely-positioned 1px-`border` stub elements (no SVG, no JS measuring). Winner: 2px `accent` ring on cover. Loser: 0.45 opacity. Empty slot: dashed `border`.

### Other controls

- **ToggleSwitch** (inline in `SocialsSection.tsx`, worth extracting) — 44×24 pill, `accent` fill when on (not `success` — this is a settings toggle, not a status indicator).
- **TierColorPicker** (`components/tierlist/TierColorPicker.tsx`) — 6 preset swatches (S/A/B/C/D/Grey) + custom `<input type="color">` in a dashed tile. Commits on **blur**, not `change`, so dragging the native color wheel doesn't spam re-renders.

### Gesture components (mobile only — Reanimated + haptics, not reproducible in a static doc)

- **ArenaVoteDeck** (`mobile/src/features/arena/ArenaVoteDeck.tsx`) — drag up to vote win, down to vote lose. Commit threshold 100px drag OR velocity >850px/s + 30px travel. Rotation ±5° at threshold, tint (`success`/`danger`) ramps 0→0.25 opacity, "WINS"/"LOSES" pill fades in only in the last ~25px before commit. Spring back `dampingRatio 0.8` if released early. Always pair with a tap-to-vote fallback.
- **TierSortDeck** (`mobile/src/features/tierlists/TierSortDeck.tsx`) — long-press (220ms) + drag a book toward a ring of tier targets placed by trigonometry. Drag must *start* below the ring's center or it's ignored. Nearest target within 56px highlights and scales 1.18×; haptic on drag-start and again only on a successful drop.

---
*Regenerate this file from the [live artifact](https://claude.ai/artifact/3X65LF3q7Tc4pqEHmReyp6) via Claude Code when tokens or components change there.*
