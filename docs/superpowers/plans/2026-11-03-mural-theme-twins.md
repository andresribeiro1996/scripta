# Mural Theme Twins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mural renders in a generated twin palette when the viewer's app scheme differs from its theme's scheme. The owner chooses nothing new, and nothing new is stored.

**Architecture:** A runtime, memoised generator in `@scripta/shared` (`murals/twins.ts`) produces the twin palette. The same file flips raw hex block colours. Web and mobile resolve every mural palette through `muralColors(id, scheme)` and every block style through `muralBlockStyle(style, id, scheme)`. The scheme is the viewer's resolved app scheme, or, in the editor, the original plus a twin-preview toggle.

**Tech Stack:** TypeScript, `node --test` with tsx (shared, mobile), `tsx --test scripts/test-*.mts` (frontend), React, React Native/Expo.

**Spec:** `docs/superpowers/specs/2026-11-03-mural-theme-twins-design.md`. Approved colours and the original generator are in `docs/superpowers/specs/2026-11-03-mural-theme-twins/` (`twins.mjs`, `twins.json`, `twins.png`).

## Global Constraints

- **Generation rule:** port it exactly from the spec's "The generation rule" section and `twins.mjs`:
  - ground roles: background, surface, surfacePressed, border, accentSoft, dangerSoft, successSoft, infoSoft, referenceSoft, accentFill;
  - ground chroma: `min(sourceC, max(targetC, 0.045))`;
  - gamut: multiply chroma by 0.92, up to 40 checks, then chroma 0;
  - nudge: 3 passes, 0.01 L steps, at most 60 steps, target 4.6. Step down when bg's luminance is above 0.18, otherwise up.
- **Contrast:** measure with `contrastRatio` from `packages/shared/src/murals/blockTextColors.ts`. Don't add a second WCAG luminance helper.
  - The palette nudge's "bg luminance above 0.18" test is written as `contrastRatio(bg, "#000000")! > 4.6`; the two are equivalent.
  - The OKLCH conversion keeps its own sRGB linearisation.
- **Fixed pairs and overrides:**
  - `muralColors("light", "dark")` is `themes.dark.colors`, and `muralColors("dark", "light")` is `themes.light.colors`, as the same objects.
  - Newsprint's dark twin has `accent: "#ece9e1"`.
- **Raw hex flipping:**
  - These fields flip: `backgroundColor`, `textColor`, `gradientColor`, `cardBorderColor`, `fadeColor`. `shadowColor` never flips.
  - Only values `parseHexColor` accepts flip. Everything else passes through unchanged.
- **Lightness map:** linear in OKLCH L through (source-base **surface** L → target-base surface L) and (source-base text L → target-base text L). The base themes are `themes.light` and `themes.dark`; light to dark maps L 1.000 → 0.275 and 0.236 → 0.933. Clamp L to [0, 1].
- **Block text guard:** this is not the palette nudge. Step the text's L by 0.01 toward white if `contrastRatio(bg, "#ffffff") > contrastRatio(bg, "#000000")`, otherwise toward black, until it reaches 4.5, for at most 100 steps. Write `textColor` only when a step happened.
- **Imports:** `murals/index.ts` re-exports `twins.ts`, so web and mobile import the new functions from `@scripta/shared`.
- **Render only:** a flipped style never reaches an edit callback, a style editor or a save. The style editors keep the original palette.
- **Viewer scheme:** web uses `themes[useResolvedTheme()].scheme`; mobile uses the parent `useTheme().mode`.
- **Editor:** it opens on the mural's original appearance. A `showTwin` toggle, not saved, previews the twin. Its label names the scheme a tap will show, and it has no pressed state on either platform. The theme picker tiles don't change.
- **Share image:** the mobile share-sheet image uses the original appearance.
- **Repo rules:**
  - no comments in code;
  - logic shared by web and mobile lives in `@scripta/shared`;
  - rebuild shared (`npm run build --workspace @scripta/shared`) before any consumer typecheck or test;
  - run git from the worktree root.
- **No backend change** and no stored-data change.

## Review Focus

1. **Saving while previewing the twin stores the owner's picked colours unchanged.** Covered by Task 2's no-mutation test, and by the source tests in Task 3 (web) and Task 6 (mobile) that keep `muralBlockStyle` and the twin palette out of the style editors.
2. **A feed item with an unknown or legacy theme string** renders the Light palette without crashing. Covered by Task 3's `MuralThumb` "vaporwave" test.
3. **Short or uppercase hex (`#FFF`, `#FFF3B0`)** flips to a lowercase six-digit hex, and rgba or named colours pass through. Covered by Task 2.
4. **The yellow "Note" sticky** (`#fff3b0`, theme-default text) on a light mural viewed in dark mode becomes dark mustard, distinct from the page, with text at 4.5:1 or better. So does a below-4.5 grey text on it, and a mid-grey `#777777` block. Covered by Task 2.
5. **A theme in its own scheme returns its original palette object**, so every same-scheme screen is pixel-identical to today. Covered by Task 1.

---

### Task 1: Twin palettes in shared

**Files:**
- Create: `packages/shared/src/murals/twins.ts`
- Create: `packages/shared/src/murals/twins.test.ts`
- Modify: `packages/shared/src/murals/index.ts`
- Modify: `packages/shared/src/themes/palettes.ts`
- Modify: `packages/shared/src/themes/themes.test.ts`

**Interfaces:**
- Produces, in `palettes.ts`: `export const THEME_CONTRAST_PAIRS: ReadonlyArray<readonly [keyof ThemeColors, keyof ThemeColors]>`. These are the 17 pairs now in `themes.test.ts`'s `AA_PAIRS`, in the same order.
- Produces, in `murals/twins.ts`:
  - `export function oppositeScheme(scheme: ThemeScheme): ThemeScheme`
  - `export function muralColors(id: ThemeId, scheme: ThemeScheme): ThemeColors`
- Module-private, for Task 2 to reuse: the OKLCH helpers (`toOklch`, and `fromOklch`, which does the gamut fit).
- Module-private, palette only: the palette nudge (60 steps, target 4.6, direction by the 0.18 rule).
- `murals/index.ts` gains `export * from "./twins.js"`.

- [ ] **Step 1: Write the failing tests in `twins.test.ts`**

```ts
test("a theme in its own scheme is its own palette", () => {
  for (const id of THEME_IDS) assert.strictEqual(muralColors(id, themes[id].scheme), themes[id].colors);
});
test("Light and Dark are each other's twins", () => {
  assert.strictEqual(muralColors("light", "dark"), themes.dark.colors);
  assert.strictEqual(muralColors("dark", "light"), themes.light.colors);
});
test("Newsprint's dark twin inks with its paper colour", () => {
  assert.equal(muralColors("newsprint", "dark").accent, "#ece9e1");
});
test("a twin takes the target base theme's scrim", () => {
  for (const id of THEME_IDS) { const to = oppositeScheme(themes[id].scheme); assert.equal(muralColors(id, to).scrim, themes[to].colors.scrim); }
});
test("twins are computed once", () => {
  assert.strictEqual(muralColors("sepia", "dark"), muralColors("sepia", "dark"));
});
test("oppositeScheme swaps light and dark", () => {
  assert.equal(oppositeScheme("light"), "dark");
  assert.equal(oppositeScheme("dark"), "light");
});
```

- [ ] **Step 2: Make `themes.test.ts` check all 22 palettes**
  - Delete the local `luminance`, `contrast` and `AA_PAIRS`. Import `THEME_CONTRAST_PAIRS` from `./palettes.js`, `contrastRatio` from `../murals/blockTextColors.js` and `muralColors` from `../murals/twins.js`.
  - Wrap the three per-theme tests in `for (const scheme of ["light", "dark"] as const)`, with `const colors = muralColors(id, scheme)`.
  - Name the tests `${id} (${scheme}): …`. Keep each assertion message, with the scheme added.

- [ ] **Step 3: Run and confirm they fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL. `twins.js` can't be resolved and `THEME_CONTRAST_PAIRS` isn't exported.

- [ ] **Step 4: Implement**
  - Export `THEME_CONTRAST_PAIRS` from `palettes.ts`, and re-export `twins.js` from `murals/index.ts`.
  - Write `twins.ts`. It ports `twin()` from `twins.mjs`, using the Global Constraints rule, `contrastRatio`, `parseHexColor` and `toHex`, plus the Light/Dark swap and the Newsprint override.
  - Memoise the twins in a `Map<ThemeId, ThemeColors>`.

- [ ] **Step 5: Run the tests**

Run: `npm test --workspace @scripta/shared`
Expected: PASS, including all 66 per-palette checks.

- [ ] **Step 6: One-time check against the approved colours (don't commit it)**

Run:

```bash
npm run build --workspace @scripta/shared
```

```bash
node --input-type=module -e 'import { muralColors } from "./packages/shared/dist/murals/twins.js"; import { themes, THEME_IDS } from "./packages/shared/dist/themes/palettes.js"; import { readFileSync } from "node:fs"; const j = JSON.parse(readFileSync("docs/superpowers/specs/2026-11-03-mural-theme-twins/twins.json", "utf8")); for (const id of THEME_IDS) { if (id === "light" || id === "dark") continue; const c = muralColors(id, themes[id].scheme === "light" ? "dark" : "light"); for (const [k, v] of Object.entries(j[id])) { if (k === "scrim" || (id === "newsprint" && k === "accent")) continue; const d = [1, 3, 5].map((i) => Math.abs(parseInt(c[k].slice(i, i + 2), 16) - parseInt(v.slice(i, i + 2), 16))); if (Math.max(...d) > 1) console.log(id, k, c[k], v); } }'
```

Expected: no output. A printed line means the port differs from the approved colours by more than ±1/255. Fix the port, not the JSON.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/murals/twins.ts packages/shared/src/murals/twins.test.ts packages/shared/src/murals/index.ts packages/shared/src/themes/palettes.ts packages/shared/src/themes/themes.test.ts && git commit -m "Generate a twin palette for each mural theme in the other scheme"
```

### Task 2: Flip raw hex block colours

**Files:**
- Modify: `packages/shared/src/murals/twins.ts`
- Test: `packages/shared/src/murals/twins.test.ts`

**Interfaces:**
- Consumes: Task 1's `muralColors` and the private OKLCH helpers. Also `effectiveBlockColors`, `parseHexColor` and `contrastRatio` (`blockTextColors.ts`), and `BlockStyle` / `DEFAULT_BLOCK_STYLE` (`library/libraryStyle.ts`).
- Produces: `export function muralBlockStyle(style: BlockStyle, id: ThemeId, scheme: ThemeScheme): BlockStyle`.

- [ ] **Step 1: Write the failing tests**

All styles are `{ ...DEFAULT_BLOCK_STYLE, … }`. `flip(style) = muralBlockStyle(style, "sepia", "dark")`, and `dark = muralColors("sepia", "dark")`.

```ts
test("a block in its theme's own scheme keeps its style object", () => {
  const style = { ...DEFAULT_BLOCK_STYLE, backgroundColor: "#fff3b0" };
  assert.strictEqual(muralBlockStyle(style, "sepia", "light"), style);
});
test("non-hex colours and the shadow colour pass through", () => {
  const style = { ...DEFAULT_BLOCK_STYLE, backgroundColor: "transparent", textColor: "theme:accent", cardBorderColor: "rgba(0, 0, 0, 0.5)", fadeColor: "red", gradientColor: null, shadowColor: "#000000" };
  assert.deepEqual(flip(style), style);
});
test("the light surface lands on the dark surface", () => {
  const out = flip({ ...DEFAULT_BLOCK_STYLE, backgroundColor: themes.light.colors.surface });
  assert.ok(contrastRatio(out.backgroundColor!, themes.dark.colors.surface)! < 1.1);
});
test("a light block stays apart from the twin's page", () => {
  const out = flip({ ...DEFAULT_BLOCK_STYLE, backgroundColor: "#fff3b0" });
  assert.ok(contrastRatio(out.backgroundColor!, dark.background)! > 1.3);
});
test("short and uppercase hex flips to lowercase six-digit hex", () => {
  const out = flip({ ...DEFAULT_BLOCK_STYLE, backgroundColor: "#FFF", gradientColor: "#FFF3B0" });
  assert.match(out.backgroundColor!, /^#[0-9a-f]{6}$/);
  assert.match(out.gradientColor!, /^#[0-9a-f]{6}$/);
  assert.ok(contrastRatio(out.backgroundColor!, themes.dark.colors.surface)! < 1.2);
});
test("flipped blocks keep readable text", () => {
  for (const [backgroundColor, textColor] of [["#fff3b0", null], ["#fff3b0", "#8a8a8a"], ["#777777", null], ["#201e1c", null]] as const) {
    const out = flip({ ...DEFAULT_BLOCK_STYLE, backgroundColor, textColor });
    const { text, background } = effectiveBlockColors(out, dark);
    assert.ok(contrastRatio(text, background)! >= 4.5, `${backgroundColor} ${textColor}`);
  }
});
test("text that needs no nudge stays unset", () => {
  assert.equal(flip({ ...DEFAULT_BLOCK_STYLE, backgroundColor: "#ffffff", textColor: null }).textColor, null);
});
test("the stored style is never mutated", () => {
  const style = { ...DEFAULT_BLOCK_STYLE, backgroundColor: "#fff3b0", textColor: "#8a8a8a" };
  const copy = structuredClone(style);
  flip(style);
  assert.deepEqual(style, copy);
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL. `muralBlockStyle` isn't exported.

- [ ] **Step 3: Implement `muralBlockStyle`**
  1. Return `style` itself when `themes[id].scheme === scheme`.
  2. Otherwise flip the five fields with the lightness map from Global Constraints, gamut-fitted like the palette.
  3. Then guard the text with the block text guard from Global Constraints, applied to `effectiveBlockColors(flipped, muralColors(id, scheme))` when both are hex.
  4. Return a new object.

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/murals/twins.ts packages/shared/src/murals/twins.test.ts && git commit -m "Flip raw hex block colours for a mural's twin appearance"
```

### Task 3: Web surfaces follow the viewer's scheme

**Files:**
- Modify: `frontend/src/lib/theme.ts`
- Modify: `frontend/src/components/murals/MuralCanvas.tsx`
- Modify: `frontend/src/components/murals/MobileMuralCanvas.tsx`
- Modify: `frontend/src/components/murals/MuralBlockDetail.tsx`
- Modify: `frontend/src/components/murals/MuralThumb.tsx`
- Modify: `frontend/src/pages/SharedMuralPage.tsx`
- Modify: `frontend/src/pages/MuralEditorPage.tsx`
- Modify: `frontend/src/components/landing/ReaderCardPreview.tsx`
- Test: `frontend/scripts/test-mural-theme.mts`
- Test: `frontend/scripts/test-panels-and-cards.mts`
- Test: `frontend/scripts/test-feed-card.mts`
- Test: `frontend/scripts/test-i18n-muralEditor.mts`

**Interfaces:**
- Consumes: `muralColors` and `muralBlockStyle` from `@scripta/shared`.
- Produces:
  - `useAppScheme(): ThemeScheme` and `muralThemeStyle(id: ThemeId, scheme: ThemeScheme): CSSProperties` in `frontend/src/lib/theme.ts`;
  - an optional `scheme?: ThemeScheme` prop on `MuralCanvas`, defaulting to `useAppScheme()`;
  - a required `scheme: ThemeScheme` prop on `MobileMuralCanvas` and `MuralBlockDetail`.

- [ ] **Step 1: Write the failing tests**

In `test-mural-theme.mts`:

```ts
test("muralThemeStyle paints the palette of the scheme it is given", () => {
  for (const id of THEME_IDS) for (const scheme of ["light", "dark"] as const) {
    const style = muralThemeStyle(id, scheme) as Record<string, string>;
    for (const [name, value] of Object.entries(themeColorVariables(muralColors(id, scheme)))) assert.equal(style[name], value, `${id} ${scheme} ${name}`);
    assert.equal(style.colorScheme, scheme);
  }
});
```

In `test-feed-card.mts`, which renders `MuralThumb` through `FeedCard`, add the same top-level stub `test-sheet.mts:8` uses: `Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false }), configurable: true });`.

In `test-i18n-muralEditor.mts:175`, pass `scheme: "dark"` to `MuralBlockDetail`. The scripts aren't typechecked, so a missing prop would silently render the wrong palette.

In `test-panels-and-cards.mts`, add a `withScheme(scheme, fn)` helper. It sets `globalThis.matchMedia` to `(query) => ({ matches: scheme === "dark" && query === "(prefers-color-scheme: dark)" })`, runs `fn`, and deletes the stub in `finally`. Make the existing `MuralThumb` test's `render` run inside `withScheme("light", …)`, then add:

```ts
test("MuralThumb paints a sepia mural's dark twin for a dark viewer", () => {
  const html = withScheme("dark", () => renderToString(createElement(MuralThumb, { theme: "sepia", layouts: [{ x: 0, y: 0, w: 6, h: 2 }] })));
  assert.match(html, new RegExp(`background:${muralColors("sepia", "dark").background}`));
});
test("MuralThumb falls back to Light for an unknown theme", () => {
  const html = withScheme("light", () => renderToString(createElement(MuralThumb, { theme: "vaporwave" as ThemeId })));
  assert.match(html, new RegExp(`background:${themes.light.colors.background}`));
});
test("the style editors never see a flipped block style", () => {
  for (const file of ["pages/MuralEditorPage", "components/murals/BlockStylePanel", "components/StyleControls"]) assert.doesNotMatch(src(file), /muralBlockStyle/, file);
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npm run build --workspace @scripta/shared && npm test --workspace frontend`
Expected: FAIL. `muralThemeStyle` ignores the scheme, and `MuralThumb` paints the original Sepia.

- [ ] **Step 3: Implement**
  - **`lib/theme.ts`:**
    - `useAppScheme` returns `themes[useResolvedTheme()].scheme`.
    - `muralThemeStyle(id, scheme)` uses `muralColors(id, scheme)` and `colorScheme: scheme`.
  - **`MuralCanvas.tsx`:**
    - Add `const appScheme = useAppScheme(); const scheme = schemeProp ?? appScheme;`. A conditional hook call fails oxlint's `react/rules-of-hooks`.
    - `themeColors = muralColors(mural.theme, scheme)` (`:95`).
    - `muralThemeStyle(mural.theme, scheme)` (`:155`).
    - `const style = muralBlockStyle(resolveBlockStyle(block.style), mural.theme, scheme)` (`:169`).
    - Pass `scheme` to the compact `MobileMuralCanvas` (`:114–143`) and to `MuralBlockDetail` (`:231`).
  - **`MobileMuralCanvas.tsx`:**
    - Take `scheme`.
    - `muralThemeStyle(mural.theme, scheme)` (`:282`).
    - `BlockFrame` takes `theme` and `scheme` instead of `themeColors`. It derives `themeColors = muralColors(theme, scheme)` and `style = muralBlockStyle(resolveBlockStyle(block.style), theme, scheme)` (`:97–143`, `:324`).
    - Pass `scheme` to `MuralBlockDetail` (`:430`).
  - **`MuralBlockDetail.tsx`:** `detailSheetStyle(theme, scheme)`, with a `scheme` prop.
  - **`MuralThumb.tsx`:** `const colors = muralColors(muralThemeId(theme), useAppScheme())`. Widen the `theme` prop type to `string` only if FeedCard's type requires it.
  - **`SharedMuralPage.tsx:111`:** `muralThemeStyle(mural.theme, useAppScheme())`, with the hook called at the top of the component.
  - **`MuralEditorPage.tsx:562`:** `muralThemeStyle(view.theme, themes[view.theme].scheme)` for now. Task 4 replaces it.
  - **`ReaderCardPreview.tsx:76`:** `muralThemeStyle(look.theme, themes[look.theme].scheme)`.

- [ ] **Step 4: Check that no call site is missed**

Run: `rg -n "muralThemeStyle\(|themes\[[^\]]*theme[^\]]*\]\.colors" frontend/src`
Expected:
- every `muralThemeStyle(` call has two arguments;
- no `themes[...theme].colors` read remains in `components/murals/` or the mural pages. Remaining hits elsewhere (for example the reader-card landing) are reviewed one by one and left alone only when they aren't mural renderers.

- [ ] **Step 5: Run the frontend checks**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/theme.ts frontend/src/components/murals/MuralCanvas.tsx frontend/src/components/murals/MobileMuralCanvas.tsx frontend/src/components/murals/MuralBlockDetail.tsx frontend/src/components/murals/MuralThumb.tsx frontend/src/pages/SharedMuralPage.tsx frontend/src/pages/MuralEditorPage.tsx frontend/src/components/landing/ReaderCardPreview.tsx frontend/scripts/test-mural-theme.mts frontend/scripts/test-panels-and-cards.mts frontend/scripts/test-feed-card.mts frontend/scripts/test-i18n-muralEditor.mts && git commit -m "Render web murals in the viewer's scheme"
```

### Task 4: Web editor opens on the original, with a twin preview

**Files:**
- Modify: `frontend/src/pages/MuralEditorPage.tsx`
- Modify: `frontend/src/i18n/messages/en/muralEditor.ts`
- Modify: `frontend/src/i18n/messages/pt-PT/muralEditor.ts`
- Test: `frontend/scripts/test-mural-theme.mts`

**Interfaces:**
- Consumes: `oppositeScheme` (Task 1), `MuralCanvas`'s `scheme` prop and `muralThemeStyle(id, scheme)` (Task 3).

- [ ] **Step 1: Write the failing test** in `test-mural-theme.mts`. It reads `../src/pages/MuralEditorPage.tsx` the same way `test-panels-and-cards.mts`'s `src()` does.

```ts
test("the mural editor renders every view of the mural in the editor's scheme", () => {
  const page = readFileSync(new URL("../src/pages/MuralEditorPage.tsx", import.meta.url), "utf8");
  assert.equal(page.match(/scheme=\{editorScheme\}/g)?.length, 2);
  assert.match(page, /muralThemeStyle\(view\.theme, editorScheme\)/);
  assert.match(page, /const editorScheme = showTwin \? oppositeScheme\(themes\[view\.theme\]\.scheme\) : themes\[view\.theme\]\.scheme/);
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test --workspace frontend`
Expected: FAIL on the new test.

- [ ] **Step 3: Implement**
  - `const [showTwin, setShowTwin] = useState(false)`. Compute `editorScheme` exactly as the test pins it.
  - Pass `scheme={editorScheme}` to the main `MuralCanvas` (`:580`) and the style-panel preview `MuralCanvas` (`:629`).
  - Use `muralThemeStyle(view.theme, editorScheme)` at `:562`.
  - Add a `BUTTON_SECONDARY` button right after the Theme button (`:513–518`), with no `aria-pressed`:
    - `onClick={() => setShowTwin((value) => !value)}`;
    - label `t(oppositeScheme(editorScheme) === "dark" ? "muralEditor.previewDark" : "muralEditor.previewLight")`.
  - Add the strings. English: `"muralEditor.previewDark": "Preview dark"`, `"muralEditor.previewLight": "Preview light"`. pt-PT: `"Pré-visualizar escuro"`, `"Pré-visualizar claro"`.

- [ ] **Step 4: Run the frontend checks**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/MuralEditorPage.tsx frontend/src/i18n/messages/en/muralEditor.ts frontend/src/i18n/messages/pt-PT/muralEditor.ts frontend/scripts/test-mural-theme.mts && git commit -m "Open the web mural editor on the original look with a twin preview"
```

### Task 5: Mobile surfaces follow the viewer's scheme

**Files:**
- Modify: `packages/shared/src/themes/decor.ts`
- Test: `packages/shared/src/themes/decor.test.ts`
- Modify: `mobile/src/ui/theme.tsx`
- Modify: `mobile/src/ui/components.tsx`
- Modify: `mobile/src/features/murals/MuralScreen.tsx`
- Modify: `mobile/src/features/murals/MuralCanvas.tsx`
- Modify: `mobile/src/features/murals/MuralsScreen.tsx`
- Modify: `mobile/src/features/murals/MuralShareSheet.tsx`
- Modify: `mobile/src/features/home/FeedPreview.tsx`
- Modify: `mobile/src/features/search/ReaderPortraitCard.tsx`

**Interfaces:**
- Consumes: `muralColors` and `muralBlockStyle` (Tasks 1–2).
- Produces:
  - `export function themeDecor(id: ThemeId, colors: ThemeColors): Decor | undefined` in `decor.ts`;
  - `MuralThemeScope({ theme, scheme, children }: { theme: ThemeId; scheme?: ThemeScheme; children: ReactNode })`;
  - `MuralScreen({ theme, scheme, bottom, children })`, with `scheme?: ThemeScheme` passed through.

- [ ] **Step 1: Write the failing test** in `decor.test.ts`:

```ts
test("themeDecor rebuilds a theme's decor from any palette", () => {
  for (const id of THEME_IDS) assert.strictEqual(themeDecor(id, themes[id].colors), THEME_DECOR[id]);
  assert.notDeepEqual(themeDecor("matrix", muralColors("matrix", "light")), THEME_DECOR.matrix);
  assert.equal(themeDecor("sepia", muralColors("sepia", "dark")), undefined);
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL. `themeDecor` isn't exported.

- [ ] **Step 3: Implement**
  - **`decor.ts`:** move the per-id builders into a `Record`. Build `THEME_DECOR` by calling the builders directly with `themes[id].colors`, never through `themeDecor`, since `themeDecor` reads `THEME_DECOR`. `themeDecor` returns `THEME_DECOR[id]` when `colors === themes[id].colors`, and otherwise calls the builder.
  - **`theme.tsx`:** `MuralThemeScope` sets `const mode = scheme ?? parent.mode`, and provides `mode` and `colors: muralColors(theme, mode)`. Fonts are unchanged. The `useMemo` dependencies must include `mode`, or the editor toggle won't re-render.
  - **`components.tsx`:** `DecorLayer` takes `colors` and uses `themeDecor(id, colors)`. `Screen` passes `colors` from `useTheme()`.
  - **`MuralScreen.tsx`:** pass `scheme` to `MuralThemeScope`.
  - **`MuralCanvas.tsx`:**
    - Inside the scope (`:180`, `:331`): `const { id, mode } = useTheme()`, then `muralBlockStyle(resolveBlockStyle(block.style), id, mode)`.
    - In `BlockPreview` (`:375–379`) and `MuralCanvas` (`:426–427`): `const { mode } = useTheme()`, then `colors = muralColors(theme, mode)`, and style through `muralBlockStyle(…, theme, mode)`.
  - **List surfaces:** use `muralColors(muralThemeId(…), useTheme().mode)` in `MuralsScreen.tsx:218`, `FeedPreview.tsx:46` and `ReaderPortraitCard.tsx:31`.
  - **`MuralShareSheet.tsx:45`:** wrap `MuralCanvas` in `<MuralThemeScope theme={id} scheme={themes[id].scheme}>`, with `const id = muralThemeId(mural.theme)`.

- [ ] **Step 4: Check that no call site is missed**

Run: `rg -n "themes\[" mobile/src/features/murals mobile/src/features/home mobile/src/features/search mobile/src/features/public`
Expected: only these remain:
- `MuralShareSheet` (the original scheme and background);
- `MuralEditorScreen.tsx:110` and `:308`, until Task 6.

- [ ] **Step 5: Run the checks**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/themes/decor.ts packages/shared/src/themes/decor.test.ts mobile/src/ui/theme.tsx mobile/src/ui/components.tsx mobile/src/features/murals/MuralScreen.tsx mobile/src/features/murals/MuralCanvas.tsx mobile/src/features/murals/MuralsScreen.tsx mobile/src/features/murals/MuralShareSheet.tsx mobile/src/features/home/FeedPreview.tsx mobile/src/features/search/ReaderPortraitCard.tsx && git commit -m "Render mobile murals in the viewer's scheme"
```

### Task 6: Mobile editor opens on the original, with a twin preview

**Files:**
- Modify: `mobile/src/features/murals/MuralEditorScreen.tsx`
- Modify: `mobile/src/ui/icon.tsx`
- Modify: `mobile/src/i18n/messages/en/murals.ts`
- Modify: `mobile/src/i18n/messages/pt-PT/murals.ts`
- Create: `mobile/src/features/murals/twinEditing.test.ts`

**Interfaces:**
- Consumes: `oppositeScheme` and `muralColors` (Task 1), and `MuralScreen`'s and `MuralThemeScope`'s `scheme` (Task 5).

- [ ] **Step 1: Write the failing test** in `twinEditing.test.ts`. It reads sources with `readFileSync(new URL("./<file>", import.meta.url), "utf8")`.

```ts
test("the mural editor previews the twin but styles blocks against the original palette", () => {
  const editor = read("MuralEditorScreen.tsx");
  assert.match(editor, /const editorScheme = showTwin \? oppositeScheme\(themes\[currentTheme\]\.scheme\) : themes\[currentTheme\]\.scheme/);
  assert.match(editor, /<MuralScreen theme=\{currentTheme\} scheme=\{editorScheme\}>/);
  assert.match(editor, /palette=\{themes\[currentTheme\]\.colors\}/);
  for (const file of ["StyleTab.tsx", "blockStyleOptions.ts"]) assert.doesNotMatch(read(file), /muralBlockStyle|muralColors/, file);
});
```

Run: `npm test --workspace mobile`. Expected: FAIL on the `editorScheme` match.

- [ ] **Step 2: Implement**
  - **State and scheme:**
    - `const [showTwin, setShowTwin] = useState(false)`;
    - `const editorScheme = showTwin ? oppositeScheme(themes[currentTheme].scheme) : themes[currentTheme].scheme`;
    - `const colors = muralColors(currentTheme, editorScheme)` at `:110`.
  - **Header (`:217`):** use `<MuralThemeScope theme={currentTheme} scheme={editorScheme}>`. Add an `IconButton` before the theme button:
    - `name={oppositeScheme(editorScheme) === "dark" ? "moon" : "sun"}`;
    - `accessibilityLabel={t(oppositeScheme(editorScheme) === "dark" ? "murals.previewDark" : "murals.previewLight")}`;
    - `onPress={() => setShowTwin((value) => !value)}`.
  - **Screen (`:251`):** `<MuralScreen theme={currentTheme} scheme={editorScheme}>`.
  - **Style tab:** leave `palette={themes[currentTheme].colors}` (`:308`) as it is.
  - **`icon.tsx`:** add `sun: { ios: "sun.max", android: "light_mode" }` and `moon: { ios: "moon", android: "dark_mode" }`.
  - **Strings:**
    - en: `"murals.previewDark": "Preview dark"`, `"murals.previewLight": "Preview light"`;
    - pt-PT: `"Pré-visualizar escuro"`, `"Pré-visualizar claro"`.

- [ ] **Step 3: Run the checks.** The i18n parity test covers the new keys.

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/features/murals/MuralEditorScreen.tsx mobile/src/ui/icon.tsx mobile/src/i18n/messages/en/murals.ts mobile/src/i18n/messages/pt-PT/murals.ts mobile/src/features/murals/twinEditing.test.ts && git commit -m "Open the mobile mural editor on the original look with a twin preview"
```

## Final verification (not a task; it changes no files)

- [ ] **Step 1: Run the gate**

Run: `node scripts/gate.mjs`. The branch is committed, so also run each Verify command for shared, frontend and mobile: build, typecheck, lint and test.
Expected: all PASS.

- [ ] **Step 2: Web browser pass**

Use headless system Chrome with `prefers-color-scheme: dark` emulated and a Sepia mural on the dev stack. Check:
- the Home feed card and the murals list thumbnail;
- the shared mural page;
- the canvas at 1280px and at 375px, which is the compact `MobileMuralCanvas` path;
- fullscreen;
- the editor: it opens light, and "Preview dark" shows the twin at both widths.

Expected: the dark Sepia twin everywhere except the editor's opening view.

- [ ] **Step 3: Device pass**

Dispatch `device-checker` with the worktree path and a screenshot dir. Use the fixture account, which has a mural. Set the mural's theme to Sepia in the editor and save. Then, with the app in **dark** mode, check:
- **Murals list card and Home feed card:** the dark Sepia twin, with readable text.
- **Mural screen:** dark background, the status bar's light content, and the tab bar in the twin.
- **Editor:** opens light, the original Sepia. Tapping the moon action shows the dark twin. The theme sheet's tiles are unchanged.
- **A block styled with the "Note" look in the editor:** in the twin, a dark mustard note with readable text. Back on the original, it's the yellow note again. Save, reopen, and confirm the original yellow is still stored.
- **Share sheet image:** original light Sepia.

Expected: all of the above as described. The device pass gates merge, not the PR.

- [ ] **Step 4: Release note for the runbook.** The change is client-only: web ships with a Pages deploy, and mobile is JS-only, so it ships over the air. The over-the-air update publishes only if a production Android build with the same fingerprint exists. Main's runtime changed with #404, so ask `deploy-ops` to confirm before telling the user phones have twins.
