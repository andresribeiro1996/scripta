# Mural theme twins: design

Date: 2026-11-03. Status: approved. The user confirmed D1, D3, D5 and D6 on 2026-11-03; D2 was stated in the D1 question. D4 was not asked and is the default.

## Intent

A mural has one theme out of 11. Four are light (light, sepia, rose, newsprint) and seven are dark (dark, midnight, forest, matrix, synthwave, seventies, oxblood). A light mural seen in dark app mode, or the reverse, is jarring.

From now on, every mural has two appearances, one per scheme. The app works out the second one from the theme the owner picked. The owner chooses nothing new and nothing new is stored.

On 2026-11-03 the user saw all 11 originals beside their generated twins and said "looks good". The mockup, its colours and the generator are copied beside this spec, in `docs/superpowers/specs/2026-11-03-mural-theme-twins/` (`twins.png`, `twins.json`, `twins.mjs`).

## Decisions

| # | Decision | Status |
|---|---|---|
| D1 | Light and Dark use each other as twins: Light's dark appearance is the Dark palette, and Dark's light appearance is the Light palette. The generated versions are not used for these two. | Confirmed |
| D2 | One consequence of D1: in a given mode, a Light mural and a Dark mural look the same, so their twins look the same too. The picker tiles still differ, because they show originals (see Editor). | Confirmed (stated with D1) |
| D3 | Newsprint's dark twin overrides one colour: accent becomes `#ece9e1`, Newsprint's own paper colour used as white ink. The generated accent is a flat grey (`#a3a29f`), because the original near-black ink has no hue to carry over. The override reaches 12.2:1 on surface, 11.1:1 on accentSoft, and 15.4:1 for onAccent on it. | Confirmed |
| D4 | The twin follows the **viewer's** resolved app scheme, which is `themes[resolvedAppTheme].scheme`. A viewer whose app theme is Sepia counts as light, even when their OS is in dark mode. | Default, not asked |
| D5 | Raw hex block colours flip with a lightness rule (below). Theme-ref block colours (`theme:<key>`) need nothing new: they already resolve against whichever palette is passed. Deliberate looks flip too: the dark "Ink" block turns light and the yellow "Note" sticky turns dark mustard. | Confirmed |
| D6 | The editor opens on the mural's **original** appearance, whatever the viewer's mode, and a toggle previews the twin. The toggle isn't saved. The style controls always edit the original appearance (see Editor). | Confirmed |

These are settled here and don't need the user:

- The twin keeps the source theme's fonts. Fonts are part of a theme's identity, and they don't affect contrast.
- On mobile, the twin keeps the theme's decor, recoloured from the twin palette. Web murals show no theme decor today: web decor is app-level CSS keyed off `data-theme`.
- The mobile share-sheet image (`MuralShareSheet`) always uses the **original** appearance. Its viewers' modes are unknown, and the original is the look the owner designed.
- `shadowColor` doesn't flip. A black shadow flipped to near-white would turn into a glow.
- The reader-card landing preview (`ReaderCardPreview.tsx:76`) isn't a mural. It passes `themes[look.theme].scheme` to the new `muralThemeStyle` signature, which keeps today's look.
- Uploaded mural cover images (`coverImageUrl`) can't flip. A light cover shows as-is on a dark card.
- The "hard to read" warning in the mobile style tab judges the stored style against the original palette. The twin fixes its own text contrast (see Raw hex block colours).
- On web, a "system" viewer whose OS switches mode mid-session sees the twin switch only on reload. This matches the app chrome today: `useResolvedTheme` (`frontend/src/lib/theme.ts:90`) doesn't listen for OS changes.

## The generation rule

The rule ports `twins.mjs` exactly. Every colour is converted to OKLCH (L, C, h).

Let **source** be `themes[id]` and **target** be the base theme of the other scheme: `themes.dark` for a light source, `themes.light` for a dark source. For each role in `ThemeColors`:

1. **scrim:** take target's scrim.
2. **Every other role:** use target's lightness for that role, the source's hue, and this chroma:
   - **Ground roles** (background, surface, surfacePressed, border, accentSoft, dangerSoft, successSoft, infoSoft, referenceSoft, accentFill): `min(sourceC, max(targetC, 0.045))`.
   - **Other roles:** `sourceC`.
3. **Gamut:** check the colour at full chroma. If any channel falls outside -0.001..1.001, multiply chroma by 0.92 and check again, for up to 40 checks in total. If none fits, use chroma 0. Clamp and round each channel to a lowercase `#rrggbb`.
4. **Contrast nudge:** run 3 passes over the contrast pairs. For each `[fg, bg]` pair, move fg's L by 0.01 per step, at most 60 steps, until the contrast is at least 4.6. Step down when bg's relative luminance is above 0.18, otherwise step up.

Contrast is measured with `contrastRatio` from `blockTextColors.ts`, so the generator and the tests agree. It uses the 0.03928 sRGB threshold where `twins.mjs` used 0.04045. No 8-bit channel value falls between the two, so the results are identical. The nudge's "bg luminance above 0.18" test is exactly `contrastRatio(bg, "#000000") > 4.6`. The OKLCH conversion keeps its own sRGB linearisation.

The contrast pairs are the 17 `AA_PAIRS` now in `themes.test.ts`. They move into `palettes.ts` as an exported `THEME_CONTRAST_PAIRS`, so the test and the generator read one list.

Exceptions:

- `twin("light")` is `themes.dark.colors`, and `twin("dark")` is `themes.light.colors` (D1).
- Newsprint's twin then gets its accent override (D3). The test re-checks the result.

**Checked 2026-11-03 against `twins.json`:** all 9 generated twins pass all three existing palette tests:

- every AA pair reaches 4.5;
- accentFill separates from the page more than border does;
- every colour is a six-digit hex.

## Where the twin is computed: at runtime, in shared

The twin is computed **at runtime** in `packages/shared/src/murals/twins.ts`. It's memoised per theme id, so each twin is computed once per process.

A generated table checked in by a script was considered and rejected:

- **Less code.** Raw hex block colours have to flip at runtime anyway (D5), so the OKLCH helpers ship in the runtime regardless. A table would add a generator script, a generated file and a drift test on top of the same code.
- **No staleness.** When a palette changes, its twin follows. There's no regeneration step to forget.
- **Cheap.** Eleven twins, each at most 3×17×60 nudge steps, computed once.

**Risk:** Hermes and V8 may round the last bit of `Math.cbrt` or `**` differently. In theory that moves a channel by 1/255 between web and mobile. The nudge targets 4.6 against a 4.5 test, so readability still holds. The difference can't be seen, and only Node runs the test.

The module lives under `murals/` because twins are a mural concept. It uses `contrastRatio`, `parseHexColor` and `toHex` from `blockTextColors.ts`, so `themes/` doesn't import from `murals/`. `murals/index.ts` re-exports it, so consumers import from `@scripta/shared`, the way mobile already imports `muralThemeId`.

## Shared API

```ts
export function muralColors(id: ThemeId, scheme: ThemeScheme): ThemeColors;
export function muralBlockStyle(style: BlockStyle, id: ThemeId, scheme: ThemeScheme): BlockStyle;
export function themeDecor(id: ThemeId, colors: ThemeColors): Decor | undefined; // in themes/decor.ts
```

`muralColors`:

- Returns `themes[id].colors`, the same object, when `themes[id].scheme === scheme`.
- Otherwise returns the memoised twin.

`muralBlockStyle`:

- Returns the input style, the same object, when the schemes match.
- Otherwise returns a **new** style with raw hex colours flipped, as described in the next section. It never mutates its input.

`themeDecor`:

- Builds a theme's decor from any palette.
- Returns `THEME_DECOR[id]` itself when `colors === themes[id].colors`, so the mobile `Screen` doesn't rebuild SVG strings on every app screen. `THEME_DECOR` itself is therefore built from the per-theme builder functions directly, not through `themeDecor`.
- The web CSS generator keeps reading `THEME_DECOR` unchanged.

## Raw hex block colours (D5)

`BlockStyle` colour fields hold one of:

- `null`;
- `"transparent"`;
- a `theme:<key>` ref;
- a raw CSS colour (`libraryStyle.ts:440–446`).

When the viewer's scheme differs from the theme's, `muralBlockStyle` handles each field as follows.

**These fields flip:** `backgroundColor`, `textColor`, `gradientColor`, `cardBorderColor`, `fadeColor`.

- Only values that `parseHexColor` accepts flip.
- `null`, `"transparent"`, theme refs and any other CSS colour (rgba, named) pass through unchanged.

**The lightness map:**

- The map is linear in OKLCH L and passes through two anchors:
  - (L of source-base **surface** → L of target-base surface);
  - (L of source-base text → L of target-base text).
- Light to dark maps L 1.000 → 0.275 and L 0.236 → 0.933. Dark to light is the inverse.
- The anchor is surface, not background, because a block sits on the page the way a surface does. Anchoring on background (the first draft) flipped every light block to the page's own near-black: the Note sticky came out at 1.00:1 against the Sepia twin's page.
- Clamp L to [0, 1]. Keep hue and chroma, gamut-fitted the same way as the palette.
- The base themes are always `themes.light` and `themes.dark`, whatever the mural's own theme. Checked against the Sepia dark twin: the Note `#fff3b0` becomes `#383103` (dark mustard, 1.43:1 against the page), Parchment `#f6efe3` becomes `#363127`, white becomes `#282828`, and Ink `#201e1c` becomes `#ebe8e5`.

**`shadowColor` doesn't flip.**

**Readable text:**

1. After flipping, compute the **effective** colours: `effectiveBlockColors(flipped, muralColors(id, scheme))`. This covers a null or theme-ref text on a flipped hex background too.
2. If both effective colours are hex and their contrast is below 4.5, step the text's L by 0.01 toward white or black, whichever contrasts more with the background, until it reaches 4.5, for at most 100 steps. Write the result into `textColor` only when a step happened.
   - The palette's fixed 0.18 direction rule is wrong here. Block text can start on the same side as a mid-tone background: a `#777777` block with default text would drop from 3.42:1 to 2.89:1. With the toward-white-or-black direction, the Ink block's twin-default text goes from 1.00:1 to dark text, and `#777777` reaches 4.55:1.
3. Gradient ends aren't checked.
4. The dim text and accent fallbacks then come from the existing guard in `blockTextColors()` (`mutedTextColor`, and accent below 3:1 falls back to text), unchanged.

**Render only.** The flipped style exists only where a renderer computes colours. It must never reach an edit callback or a save:

- On web, the canvases already hand `originalBlock(block)` to edit callbacks. Flipping happens on the local `style` from `resolveBlockStyle(block.style)`.
- On mobile, flipping happens at the same `resolveBlockStyle` sites (`MuralCanvas.tsx:180`, `:331`, `:379`).
- The style editors (`BlockStylePanel` and `StyleControls` on web, `StyleTab` on mobile) keep reading and writing the **stored** style, against the **original** palette. Mobile keeps `palette={themes[currentTheme].colors}` (`MuralEditorScreen.tsx:308`); it does not become the twin. Otherwise `customColorStart` (`blockStyleOptions.ts:159–163`) would seed the custom picker with a twin hex and save it as a source-scheme colour. `LookCard` previews and `isHardToRead` (`StyleTab.tsx:69–78`, `:152`) likewise stay on the original.
- A colour row shows the hex the owner picked, even while the canvas shows it flipped.

## Viewer scheme (D4)

**Web:**

- Add `useAppScheme(): ThemeScheme` to `frontend/src/lib/theme.ts`. It returns `themes[useResolvedTheme()].scheme`.
- `muralThemeStyle(id)` becomes `muralThemeStyle(id, scheme)`. It emits `themeColorVariables(muralColors(id, scheme))`, `colorScheme: scheme`, and the background and text colours from that palette.

**Mobile:**

- `MuralThemeScope` takes an optional `scheme`, which defaults to the parent `useTheme().mode`.
- The value it provides:
  - `id`: the mural's theme;
  - `mode`: the scheme;
  - `colors`: `muralColors(theme, scheme)`;
  - `fonts`: the source theme's fonts, as now.
- Nested scopes read the outer scope's `mode`. Since that is the effective scheme, a canvas inside a mural screen, or a block preview inside the editor, stays consistent.
- The tab bar and status bar already follow `useTheme()` inside `MuralScreen`, so they switch with the twin.
- The mobile editor's header actions (`MuralEditorScreen.tsx:217`) are rendered by the native stack outside `MuralScreen`. Their own `MuralThemeScope` must get `scheme={editorScheme}` explicitly.
- Inside a scope, `useTheme().id` is still the source theme. Any code that does `themes[theme.id]` inside a mural subtree must use `colors` instead. The plan greps for this.

## Editor (D6)

**The preview toggle:**

- The editor holds a `showTwin` boolean. It starts `false` and isn't saved.
- The scheme the editor renders with is `editorScheme = showTwin ? other(themes[theme].scheme) : themes[theme].scheme`. So the editor opens on the original, and picking a new theme keeps the toggle's position.
- A toggle button flips `showTwin`. Its label names the scheme a tap will show: "Preview dark" or "Preview light", with the matching icon. It has no pressed state on either platform, so a screen reader never hears "Preview light, pressed" while dark is showing.
- On **web** it sits beside the theme button in the editor toolbar.
- On **mobile** it's a header action on `MuralEditorScreen`.

**What follows `editorScheme`:** everything that shows the mural's appearance. The style controls don't: they always edit the original appearance (see Raw hex block colours).

- **Web:**
  - the canvas, including its compact path;
  - the style panel's block preview;
  - the fullscreen view.
  - The editor chrome stays in the app theme, as it does today.
- **Mobile:**
  - the whole mural editor screen, which is already themed by the mural through `MuralScreen`;
  - the header actions' scope (`:217`);
  - the editor's own `colors` (`:110`), which paint the drag-help text, the dock and the actions sheet (`:257`, `:264`, `:287–290`). Left on the original palette, Sepia's textDim on the dark twin would be about 2.5:1.
- **Web, while previewing:** reader-card blocks keep the app's `dark:` print (`ReaderCardImage.tsx:15–16`), because Tailwind's `dark:` keys off the root `data-theme`. This is accepted for the preview. In normal viewing the mural's scheme now always equals the app's, so `dark:` matches.

**The theme picker tiles don't change.** They keep showing each theme's original palette. With the editor opening on the original, that matches the canvas, and `ThemeOptionGrid` and `ThemeGrid` need no new prop.

## Surfaces that switch

All of these resolve the mural palette through `muralColors` or `muralThemeStyle` with the viewer's scheme, unless noted.

| Surface | File | Change |
|---|---|---|
| Web canvas | `frontend/src/components/murals/MuralCanvas.tsx:93–95, 155, 169–200, 231` | `scheme` prop, defaulting to `useAppScheme()`. Palette from `muralColors`. Style through `muralBlockStyle`. Passes the scheme to `MuralBlockDetail`. |
| Web phone-layout canvas | `frontend/src/components/murals/MobileMuralCanvas.tsx:102–143, 282, 324, 430` | Same as the web canvas. `MuralCanvas`'s compact path (`MuralCanvas.tsx:114–143`) must pass its `scheme` through, or the editor toggle does nothing on narrow or touch screens. |
| Block detail sheet | `frontend/src/components/murals/MuralBlockDetail.tsx:30` | Takes a `scheme`. |
| Web editor | `frontend/src/pages/MuralEditorPage.tsx:461, 562, 629` | `showTwin` state and toggle. Passes `editorScheme` to the canvases and the fullscreen view. |
| Web shared mural page | `frontend/src/pages/SharedMuralPage.tsx:84, 111` | Viewer scheme. |
| Web thumbnails, which cover the Home feed and the murals list | `frontend/src/components/murals/MuralThumb.tsx:6` | `muralColors(muralThemeId(theme), useAppScheme())`. Normalising inside `MuralThumb` covers FeedCard's raw theme and leaves the call sites' source alone, which `test-panels-and-cards.mts:51, 69` match by regex. |
| Reader-card landing | `frontend/src/components/landing/ReaderCardPreview.tsx:76` | `muralThemeStyle(look.theme, themes[look.theme].scheme)`: no visible change. |
| Web profile and shelf | `CommunityProfilePage`, `OwnShelfView` | Nothing new: they render `MuralCanvas`. The fallback murals use the viewer's own theme, so the schemes always match. |
| Mobile scope | `mobile/src/ui/theme.tsx:164` | `scheme` prop and twin colours. |
| Mobile screen and decor | `mobile/src/ui/components.tsx:22–33` | `DecorLayer` takes `colors` and uses `themeDecor(id, colors)`. |
| Mobile mural screen | `mobile/src/features/murals/MuralScreen.tsx:11` | Passes the optional `scheme` through. |
| Mobile canvas and block preview | `mobile/src/features/murals/MuralCanvas.tsx:180, 331, 375–379, 426–427` | Palette from `muralColors(theme, useTheme().mode)`. Style through `muralBlockStyle`. |
| Mobile editor | `mobile/src/features/murals/MuralEditorScreen.tsx:109–110, 217, 251` | `showTwin` and toggle. `colors = muralColors(currentTheme, editorScheme)`. Passes `editorScheme` to the header scope and `MuralScreen`. The style tab's `palette` (`:308`) stays the original. |
| Mobile murals list | `mobile/src/features/murals/MuralsScreen.tsx:217–218` | `muralColors`. |
| Mobile Home feed | `mobile/src/features/home/FeedPreview.tsx:46` | `muralColors(muralThemeId(...), mode)`. |
| Mobile search portrait | `mobile/src/features/search/ReaderPortraitCard.tsx:31` | `muralColors`. |
| Mobile shared mural | `mobile/src/features/public/SharedMuralScreen.tsx:29` | Nothing new: it goes through `MuralScreen`. |
| Mobile profile, My shelf, shelf preview | `ProfileScreen.tsx:150`, `MyShelfScreen.tsx:213`, `ShelfPreview.tsx:31` | Nothing new: `MuralCanvas` reads the app scheme from its parent. |
| Mobile share sheet | `mobile/src/features/murals/MuralShareSheet.tsx:45` | **Original** appearance: wraps the canvas in `MuralThemeScope scheme={themes[id].scheme}`. |

These don't change:

- The **backend**. It only validates and stores the theme id, and it renders no mural images.
- **Stored data.** There's no migration and no API change.
- The `themes.css` generator.
- Web `StyleControls` seeds custom colours from the root CSS variables, which hold the app theme rather than the mural theme (`StyleControls.tsx:291, 438, 625`). That is already true today and is unaffected by twins. It is a follow-up, not part of this work.

## Tests

**Shared (`npm test --workspace @scripta/shared`):**

- In `themes.test.ts`, the per-theme loop runs its three checks over all 22 palettes: `muralColors(id, "light")` and `muralColors(id, "dark")` for every id. Pairs come from `THEME_CONTRAST_PAIRS`.
- `twins.test.ts` checks that:
  - `muralColors` with the theme's own scheme returns `themes[id].colors` (`strictEqual`);
  - Light and Dark map to each other;
  - Newsprint's dark accent is `#ece9e1`;
  - a twin's scrim equals the target base theme's scrim;
  - `muralBlockStyle` returns the same object when the schemes match;
  - it passes null, `"transparent"`, theme refs, rgba values and `shadowColor` through;
  - it maps `themes.light.colors.surface` onto `themes.dark.colors.surface` (contrast below 1.1), and keeps the Note sticky visibly apart from the twin's page;
  - it steps a flipped text/background pair that would fall under 4.5 up to at least 4.5, including a mid-grey `#777777` block with default text;
  - it doesn't mutate its input.
- `decor.test.ts` checks that `THEME_DECOR[id]` deep-equals `themeDecor(id, themes[id].colors)`.

**Web (`npm test --workspace frontend`):**

- `frontend/scripts/test-mural-theme.mts` keeps its `themes.css` equality check for each theme in its own scheme.
- `test-panels-and-cards.mts` renders `MuralThumb` in Node, where `matchMedia` doesn't exist and `osScheme()` would throw. The test installs a `matchMedia` stub before rendering. It adds one assertion: with the stub reporting dark, a `sepia` thumb paints the twin's background.
- It adds a check that `muralThemeStyle(id, scheme)` carries `themeColorVariables(muralColors(id, scheme))` and `colorScheme: scheme` for both schemes.

**One-time check while implementing (not committed):**

- The 9 generated twins equal `twins.json`, the colours the user approved, within ±1/255 per channel. That tolerance absorbs the contrast-threshold difference.
- Light and Dark differ from `twins.json` by design (D1). Newsprint's accent differs by design (D3).

**Mobile (`npm test --workspace mobile`):** a source test checks that the style tab keeps the original palette (`palette={themes[currentTheme].colors}` in `MuralEditorScreen.tsx`) and that `StyleTab.tsx` and `blockStyleOptions.ts` never call `muralBlockStyle`.

**Web browser pass (headless Chrome, before merge):** a Sepia mural with the OS in dark mode. Covers the feed and list thumbnails, the shared page, the canvas at desktop width and below 768px, fullscreen, and the editor toggle.

**Device pass (`device-checker`, before merge):**

- A Sepia mural in dark app mode, in the editor, the Murals list and the Home feed card.
- The editor: it opens on the original, and the toggle shows the twin.
- A raw-hex block, before and after the toggle.

## Rollout

The change is client-only:

- The web ships with a Pages deploy.
- Mobile ships over the air: no native change, so no store build.
- The backend and the stored data are untouched, so deploy order doesn't matter.
