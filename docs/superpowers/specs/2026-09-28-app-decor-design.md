# App decor

Date: 2026-09-28
Status: design approved in conversation; awaiting spec review
Depends on: `2026-09-28-app-typography-design.md` (#60, open). Branch
`claude/app-decor` is cut from `claude/app-typography`; its PR targets `main`
after #60 merges.

## Problem

The five character themes (Matrix, Synthwave, Seventies, Newsprint, Oxblood)
change colour and fonts, but nothing else sets them apart. Every background is a
flat `background` fill. The brand mark ignores the theme: web shows
`icon-192.png` (a paper mark on a dark square) and mobile has no mark at all,
only the text "Atmyshelf" on the login screen. Nothing marks the switch
between themes.

## Goals

- Static background decor for the five character themes: flat vector motifs
  in a corner or along an edge, behind the content, at a quiet opacity.
- A themed brand mark: the five get a themed finish, and every other theme
  draws the plain mark in its text colour.
- Two brief motion moments: the mark's themed entrance, once per app open, and
  a fade when the user picks a theme. Both are off under reduce-motion.
- The same art on web and mobile, defined once in `@scripta/shared`.

## Non-goals

- Decor for Light, Dark, Midnight, Sepia, Rosé or Forest.
- Ambient or looping motion, and decor entrance animations.
- A decor on/off preference, or any backend or sync change. Picking a plain
  theme is how the user opts out.
- App icon, favicon, PWA/maskable icons, splash, `logo.png`: these are fixed
  by the OS or browser and stay as they are.
- iOS verification (the emulator is Android).

## Shared (`packages/shared/src/themes/`, exported from `@scripta/shared/themes`)

### `decor.ts`

```ts
export type DecorAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top" | "bottom";
export interface DecorPiece {
  anchor: DecorAnchor;
  width: number | "full";  // dp / CSS px; "full" only for the "top" and "bottom" anchors
  height: number;
  svg: string;             // complete <svg …> document with a viewBox
}
export interface DecorFrame {
  color: string;
  lines: readonly { inset: number; width: number; radius: number; opacity: number }[];
}
export interface Decor { pieces: readonly DecorPiece[]; frame?: DecorFrame }
export const THEME_DECOR: Partial<Record<ThemeId, Decor>>;
export const DECOR_MAX_OPACITY = 0.25;
export const DECOR_EXTRA_COLORS = { orange: "#d9702b", rust: "#a8432a" } as const;
```

The SVG strings are built from `themes[id].colors` when the module loads. The
Seventies stripes are the only colours not taken from a palette; they are
`DECOR_EXTRA_COLORS`. Full-width pieces use `preserveAspectRatio="none"` and
`vector-effect="non-scaling-stroke"` on their strokes, so a wider screen
stretches the lines without thickening them. Opacities are about half of the
mockups the user reviewed (the "quieter" choice).

| Theme | Pieces |
|---|---|
| matrix | `top-right` 128×248: five columns of monospace glyphs (fill `accent`, 16px, 20px row pitch, columns 24px apart; lengths 5, 9, 6, 12, 8 rows). Each glyph's opacity fades down its column from 0.21 to 0.02. Glyphs come from a fixed string of katakana, digits and capitals, so the result is the same on every render. |
| synthwave | `bottom-right` 120×104: a half-disc sun (r 52, centre at (60, 56), fill `accent`, 0.15), cut by three `background`-coloured slices at y 40 (h 2), 46 (h 3), 52 (h 4), with the bottom 48 left empty. `bottom` full×48: a horizon line at the top (0.28) and horizontal lines at y 8, 18, 31, 47 (0.15). Verticals fan out from the middle of the horizon to the bottom edge (0.14). All strokes are `accent`, 1px, non-scaling. |
| seventies | `top-right` 136×136: three arcs centred at (140, −8), stroke 18: radius 68 `accent`, 92 orange, 116 rust, each 0.22. |
| newsprint | `top` full×10: a double rule, 2.4px at y 1.5 and 0.9px at y 7.5, stroke `text`, 0.25. `bottom-right` 136×136: a halftone of dots on a 12px grid, radius `5.2 × (1 − d / 132)` where d is the distance from the bottom-right corner (dots under 0.6 dropped), fill `text`, 0.08. |
| oxblood | frame, colour `accent`: an outer line (inset 10, width 1.5, radius 16, opacity 0.2) and an inner line (inset 17, width 0.75, radius 12, opacity 0.14). Plus four 34×34 corner pieces, one per corner anchor, each a diamond centred on the inner line's corner (`M17 11 L23 17 L17 23 L11 17Z`, fill `accent`, 0.25). |

### `brand.ts`

```ts
export const MARK_VIEWBOX = "-4 -4 84 84";
export const MARK_RECTS: readonly { x: number; y: number; width: number; height: number; rotate?: [number, number, number] }[];
export type MarkEntrance = "scan" | "rise" | "fan" | "register" | "gild";
export type MarkFill = "text" | "accent" | keyof typeof MARK_EXTRA_COLORS;
export interface MarkLayer { fill: MarkFill; offset: [number, number]; opacity: number }
export interface MarkTreatment {
  layers: readonly MarkLayer[];                      // painted in order; the last is the mark itself
  stripes?: readonly [y: number, height: number][];  // horizontal gaps masked out of every layer
  bookplate?: boolean;                               // gilt double frame, with the mark scaled 0.6 inside
  entrance: MarkEntrance | null;
}
export function markTreatment(id: ThemeId): MarkTreatment;
export const MARK_EXTRA_COLORS = { ...DECOR_EXTRA_COLORS, registerRed: "#d0392b" } as const;
export const MOTION = { entranceMs: 600, themeFadeMs: 250, ease: [0.32, 0.72, 0, 1] } as const;
```

`MARK_RECTS` is the geometry of `design/brand/mark.svg` (the 76-unit box). A
test parses that file and compares the two. Fills are names, and each client
resolves them. Web maps `text` and `accent` to `var(--color-text)` and
`var(--color-accent)`, so the colours follow `data-theme` without a
re-render, and System needs no OS-scheme listener. Mobile maps them to
`colors.text` and `colors.accent`. The extra names map to
`MARK_EXTRA_COLORS`.

| Theme | Treatment | Entrance |
|---|---|---|
| matrix | one layer, `accent`; stripes (4-unit gaps) at y 14, 30, 52, which gives four thick bands that hold at 24–28px | `scan`: revealed top to bottom in 7 steps over 560ms |
| synthwave | one layer, `accent`; stripes `[47,2]`, `[54,3]`, `[61.5,4.5]` (sliced sun) | `rise`: up 14 units from below, fading in over 600ms |
| seventies | rust at (4, 3), orange at (2, 1.5), then `accent` | `fan`: the back layers start at (0, 0) and spring out to their offsets (`cubic-bezier(0.34,1.56,0.64,1)`, 600ms, rust 80ms later) |
| newsprint | `registerRed` at (2.4, 1.8) with opacity 0.8, then `text` | `register`: the red layer moves in from (11, 8) at opacity 0 to its resting offset over 620ms, after a 100ms delay |
| oxblood | `accent` with `bookplate`: outer frame rect (−2, −2, 80, 80, rx 4, stroke 2), inner frame (3, 3, 70, 70, rx 2, stroke 1), and the mark at `translate(15 13) scale(0.6)` | `gild`: both frame strokes draw in (dash offset, 700ms), then the mark fades in (350ms, starting at 450ms) |
| every other theme | one layer, `text` | none |

## Web

- **Decor CSS.** `frontend/scripts/themesCss.mts` appends, after the font
  override blocks, one rule per decor theme:
  `:root[data-theme="<id>"] body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; background: <layers>; }`.
  Each piece becomes one `url("data:image/svg+xml,…")` background layer,
  positioned at its anchor and sized `<w>px <h>px` (`100% <h>px` for full
  width), with `no-repeat`. The Oxblood frame is drawn by
  `:root[data-theme="oxblood"] body::after`, fixed, `z-index: -1`, and
  `pointer-events: none`. Its `inset`, `border` and `border-radius` come from
  the outer line. The inner line is an `outline` with a negative
  `outline-offset` (inner inset − outer inset), which follows the rounded
  corners. Colours are `rgba()` at each line's opacity. Because `data-theme` is set before first paint, the decor loads with
  the page, with no JavaScript. Cards, covers and the sidebar keep their own
  backgrounds and cover the decor; content scrolls over it.
- **`BrandMark`** (`frontend/src/components/BrandMark.tsx`, `size` prop).
  Inline SVG from `markTreatment(resolved)`. `resolved` comes from
  `useThemePreference()` + `resolveTheme` + `osScheme()`; System always
  resolves to a plain theme. Stripes become an SVG `<mask>`, and the ids
  carry `useId()` so two marks on one page don't clash.
  - `BrandLockup` renders `<BrandMark size={28} />` instead of
    `<img src="/icon-192.png">`. Its uses (sidebar, drawer, `AuthStage`,
    `LandingNav`, `LandingFooter`) pick this up.
  - The entrance class (`mark-scan`, `mark-rise`, …) is added on the first
    `BrandMark` mount per page load (a module-level flag) and on no later
    mount.
  - The keyframes live in `index.css` inside the existing
    `@media (prefers-reduced-motion: no-preference)` block.
  - On a phone-width screen the first mount can be the hidden `lg:` sidebar,
    so the entrance plays unseen. That is accepted.
- **Theme fade.** `ThemePicker`'s select handler calls
  `document.startViewTransition(() => applyThemePreference(p))` when the
  function exists and `matchMedia("(prefers-reduced-motion: reduce)")` does
  not match; otherwise it applies the preference directly (the same feature
  test LibraryPage uses). `::view-transition-old(root)` and
  `::view-transition-new(root)` get `animation-duration: 250ms` inside the
  no-preference block. Account sync, other-tab changes and font picks keep
  applying instantly.

## Mobile

- **Decor layer.** `Screen` (`mobile/src/ui/components.tsx`) renders, as its
  first child and only when `THEME_DECOR[id]` exists, an absolute,
  `pointerEvents="none"` layer. It fills the Screen's content box (inside the
  safe-area padding it applies), so top pieces never sit under the status bar.
  - Each piece is an `SvgXml`, positioned by a pure helper
    `pieceStyle(piece): ViewStyle` that maps anchors to
    `top`/`right`/`bottom`/`left` and `"full"` to `left: 0, right: 0`.
  - The frame is one absolute bordered `View` per line (`borderWidth`,
    `borderRadius`, `borderColor` at the line's opacity).
  - The layer is memoised per theme id.
  - Screens under a native stack header (`top={false}`, e.g. Home) keep the
    header plain, and the top pieces start below it. The tab bar sits outside
    `Screen`, so bottom pieces rest on it.
- **`ui/BrandMark.tsx`** (`size` prop). Draws the treatment with
  `react-native-svg` (`Svg`, `G`, `Rect`, `Mask`), using `colors` from
  `useTheme()`.
  - The entrance uses Reanimated animated props (`transform`, `opacity`, the
    stepped reveal's clip height, and `strokeDashoffset` for `gild`). It
    plays on the first mount per JS runtime (a module-level flag).
  - When `useReducedMotion()` (from `ui/theme.tsx`) is true, the mark renders
    in its final state.
- **Placement.** Login (`app/(public)/login.tsx`): `<BrandMark size={56} />`
  above the existing "Atmyshelf" text. Home (`features/home/HomeScreen.tsx`):
  `headerLeft: () => <BrandMark size={24} />` in the `Stack.Screen` options.
- **Theme fade.** `ThemeProvider` gains a veil: a full-screen, absolute,
  `pointerEvents="none"` `Animated.View` rendered above its children in the old
  `background` colour.
  - It shows only when a theme is picked through `setPreference(next, { fade: true })`.
    Only `ThemePicker` passes that flag; account sync and the cold-start load
    call `setPreference(next)` and apply instantly.
  - The veil starts at opacity 1 over the new theme and fades to 0 in 250ms,
    then unmounts.
  - It is skipped when `useReducedMotion()` is true or when the resolved
    theme id doesn't change (for example, System to Light while the OS is
    light).

## Testing

- **Shared** (`decor.test.ts`, `brand.test.ts`):
  - only matrix, synthwave, seventies, newsprint and oxblood have decor or a
    non-plain treatment;
  - every decor `svg` starts with `<svg`, has a `viewBox`, ends with `</svg>`,
    and has balanced tags;
  - every colour in a piece is from that theme's palette or
    `DECOR_EXTRA_COLORS`, and every mark colour is from the palette or
    `MARK_EXTRA_COLORS`;
  - every `opacity` and `fill-opacity` in decor is at most `DECOR_MAX_OPACITY`;
  - `"full"` width appears only on `top`/`bottom` anchors;
  - `MARK_RECTS` equals the rects parsed from `design/brand/mark.svg`.
- **Web** (`frontend/scripts/test-themes-css.mts` and a new script test where
  needed):
  - the generated CSS has a `body::before` decor rule for exactly the five
    themes, after every theme block, with `pointer-events: none`;
  - `mark-*` keyframes and the `::view-transition-*(root)` duration appear
    only inside the no-preference block;
  - the checked-in `themes.css` is not stale (existing test).
- **Mobile**:
  - `pieceStyle` maps each anchor correctly;
  - the once-per-launch flag plays the entrance only on the first call;
  - the veil decision (skip under reduce-motion, skip without `fade`, skip
    when the resolved id is unchanged) is a pure function with a test;
  - the `textImports` guard keeps passing (`BrandMark` has no `Text`).
- **Manual, browser:** each of the five themes at 1280px and 390px; reduce
  motion emulated on and off; picking a theme fades, while a change made in
  another tab doesn't; Light looks as before apart from the bare mark.
- **Manual, Android emulator:** the five themes on Home, My shelf, Settings
  and Login; the entrance on a cold start; the fade on a pick; a plain theme
  unchanged apart from the header mark.

## Docs

- `DESIGN.md` → Logos: replace "Two treatments only … No accent in the mark"
  with the per-theme rule. The five character themes draw their themed
  finish, accent included. Every other theme draws the plain mark in its text
  colour. App icon, favicon, splash and `logo.png` keep the ink/paper
  treatments.
- `DESIGN.md` → Themes: a Decor paragraph covering the five motifs, where they
  sit (corners and edges, behind content, at most 0.25 opacity), and that
  decor has no preference of its own.
- `DESIGN.md` → Motion: the mark entrance (about 600ms, once per launch) and
  the 250ms theme fade, both off under reduce-motion.
- The Design System artifact mirrors `DESIGN.md`; update it together with the
  pending typography changes.
