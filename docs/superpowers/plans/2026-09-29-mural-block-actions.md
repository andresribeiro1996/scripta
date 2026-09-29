# Mural Block Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native mural editor's single "Block settings" sheet with an action bar and a tabbed block sheet (preview card + Content / Style / Layout). Add friendly native style editing, theme-following colours, text alignment and inner spacing, rendered the same on web and native.

**Architecture:**
- **Shared:** `@scripta/shared` gains two `BlockStyle` fields and a `theme:<key>` colour-reference format with one resolver. Both clients' renderers resolve through it.
- **Native editor:** selection and sheet-opening become separate states. A new `BlockSheet` hosts three tab components, and the pure style presets live in a testable `.ts` module.
- **Web:** gets only the renderer changes and three small style-panel controls.

**Tech Stack:** TypeScript, React Native (Expo SDK 57, Reanimated, Gesture Handler), React + Vite + Tailwind v4 (web), `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-29-mural-block-actions-design.md`

## Global Constraints

- Build shared before checking a client, because mobile and frontend consume its `dist`: `npm run build --workspace @scripta/shared`.
- Shared checks: `npm run typecheck --workspace @scripta/shared` and `npm test --workspace @scripta/shared`.
- Mobile checks: `npm run typecheck --workspace mobile` and `npm test --workspace mobile`.
- Frontend checks: `npm run typecheck --workspace frontend`, `npm run lint --workspace frontend` and `npm test --workspace frontend`.
- Run commands from the worktree root `/Users/andreribeiro/Documents/scripta/.claude/worktrees/block-actions-screen-a7fce8`.
- Git:
  - Use `/usr/bin/git`, because the `rtk git` wrapper refuses to run in worktrees.
  - Stage and commit in one command, because another session can sweep staged files into its own commit.
  - End every commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- No code comments. The non-obvious *why* goes in the commit message (AGENTS.md).
- No new dependencies. No `eas`, and no `expo prebuild`.
- UI copy uses American spelling to match existing app copy: "color", "Center".
- Colours, spacing and radii come from `useTheme()`, `spacing` and `radii`. The only hex literals allowed are the spec's fixed-look and fixed-swatch values, copied exactly.
- Theme colour references are `theme:<key>`. The allowed keys are `background`, `surface`, `text`, `accent`, `accentSoft`, `accentFill` and `onAccent`.
- A style value the native UI doesn't offer is never rewritten unless the user uses the control that owns that field. That covers an off-preset radius, border style `double`/`groove`/`ridge`, custom border sides, `cardHoverEffect`, and an off-preset opacity.

## Review Focus

1. **Styles authored on web with off-preset values** (radius 8, border style `groove`, sides top+left, opacity 60). The Style tab highlights nothing for them, and changing an unrelated control leaves them intact. Pinned by the Task 8 matcher tests and by Task 9's `set()` spreading the full style.
2. **Stored data with an unknown theme reference** (`theme:nope`). It renders as the theme default on both clients, and never as black or a crash. Pinned by a Task 1 test.
3. **Murals saved before this change** (no `textAlign` or `innerSpacing`). They render exactly as today on both clients. Pinned by the Task 1 `resolveBlockStyle` check, Task 2's `BLOCK_PAD_SCALE.normal === 1` test, and Task 4's `normal: spacing.lg` padding.
4. **A screen-reader "Move" into an occupied cell or past the edge.** It announces "Can't move there" instead of silently doing nothing. Implemented in Task 6 and checked in Task 10.
5. **The keyboard over the Text block's Body and the Profile block's Bio** inside the fixed-height sheet. The tab body is a `FormScroll`, which keeps the focused field visible. Checked in Task 10.

---

### Task 1: Shared style fields and theme colour references

**Files:**
- Modify: `packages/shared/src/library/libraryStyle.ts` (after `BLOCK_FONT_SIZE_RANGE`, around line 376; `BlockStyle` around lines 391–432; `DEFAULT_BLOCK_STYLE` around line 443)
- Modify: `packages/shared/src/murals/blockTextColors.ts`
- Test: `packages/shared/src/murals/blockTextColors.test.ts`
- Test: `frontend/scripts/test-library-style.mts` (section 8, around line 182)

**Interfaces:**
- Produces:
  - `type BlockTextAlign = "left" | "center" | "right"`.
  - `type BlockInnerSpacing = "tight" | "normal" | "roomy"`.
  - `BLOCK_TEXT_ALIGN_OPTIONS: Array<{ value: BlockTextAlign; label: string }>`.
  - `BLOCK_INNER_SPACING_OPTIONS: Array<{ value: BlockInnerSpacing; label: string }>`.
  - `BlockStyle.textAlign` and `BlockStyle.innerSpacing`.
  - `BLOCK_THEME_COLOR_KEYS`, `type BlockThemeColorKey`, and `BLOCK_THEME_COLOR_LABELS: Record<BlockThemeColorKey, string>`.
  - `themeColorRef(key): string`.
  - `parseThemeColorRef(value: string | null): BlockThemeColorKey | null`.
  - `resolveBlockColor(value: string | null, palette: Pick<ThemeColors, BlockThemeColorKey>): string | null`.
  - `effectiveBlockColors(style, theme): { text: string; background: string }`.
  - `blockTextColors(style, theme: Pick<ThemeColors, BlockThemeColorKey | "textDim">)`.
  - All are exported from `@scripta/shared`.

- [ ] **Step 1: Write the failing shared tests**

Append to `packages/shared/src/murals/blockTextColors.test.ts`, and extend its import line to include the new names:

```ts
import { blockTextColors, contrastRatio, mutedTextColor, parseThemeColorRef, resolveBlockColor, themeColorRef } from "./blockTextColors.js";
import { themes } from "../themes/palettes.js";

const light = themes.light.colors;
const dark = themes.dark.colors;

test("resolveBlockColor turns a theme reference into the viewer's theme colour", () => {
  assert.equal(resolveBlockColor(themeColorRef("accentSoft"), light), light.accentSoft);
  assert.equal(resolveBlockColor(themeColorRef("accentSoft"), dark), dark.accentSoft);
});

test("resolveBlockColor passes hex, transparent and null through", () => {
  assert.equal(resolveBlockColor("#123456", light), "#123456");
  assert.equal(resolveBlockColor("transparent", light), "transparent");
  assert.equal(resolveBlockColor(null, light), null);
});

test("an unknown theme key resolves to the theme default, not a colour", () => {
  assert.equal(resolveBlockColor("theme:nope", light), null);
  assert.equal(parseThemeColorRef("theme:nope"), null);
  assert.equal(parseThemeColorRef("#ffffff"), null);
  assert.equal(parseThemeColorRef(themeColorRef("onAccent")), "onAccent");
});

test("blockTextColors measures a transparent block against the page background", () => {
  const colors = blockTextColors({ backgroundColor: "transparent", textColor: null }, light);
  assert.equal(colors.text, light.text);
  assert.ok(contrastRatio(colors.dim, light.background)! >= 4.5);
});

test("blockTextColors resolves theme references before measuring", () => {
  const colors = blockTextColors({ backgroundColor: themeColorRef("accent"), textColor: themeColorRef("onAccent") }, dark);
  assert.equal(colors.text, dark.onAccent);
  assert.ok(contrastRatio(colors.dim, dark.accent)! >= 4.5);
});
```

Put the `themes` import and the `light`/`dark` constants at the top of the file, under the existing imports, so every test can use them. Some existing tests in this file call `blockTextColors(style, { text, textDim, surface })` with a literal object. The new signature needs the full palette slice, so change those literals to `{ ...light, text: …, textDim: …, surface: … }`, keeping each test's own values.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, because `resolveBlockColor` / `themeColorRef` / `parseThemeColorRef` are not exported.

- [ ] **Step 3: Add the style fields**

In `packages/shared/src/library/libraryStyle.ts`, directly after `export const BLOCK_FONT_SIZE_RANGE = …;`:

```ts
export type BlockTextAlign = "left" | "center" | "right";
export type BlockInnerSpacing = "tight" | "normal" | "roomy";

export const BLOCK_TEXT_ALIGN_OPTIONS: Array<{ value: BlockTextAlign; label: string }> = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" }
];

export const BLOCK_INNER_SPACING_OPTIONS: Array<{ value: BlockInnerSpacing; label: string }> = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "roomy", label: "Roomy" }
];
```

In `BlockStyle`, after `cardHoverEffect: boolean;`:

```ts
  textAlign: BlockTextAlign;
  innerSpacing: BlockInnerSpacing;
```

In `DEFAULT_BLOCK_STYLE`, after the `cardHoverEffect` line (keep its existing comment untouched):

```ts
  textAlign: "left",
  innerSpacing: "normal"
```

- [ ] **Step 4: Add the colour references**

In `packages/shared/src/murals/blockTextColors.ts`:

1. Add at the top, next to the existing import:

```ts
import type { ThemeColors } from "../themes/palettes.js";
```

2. Add this block below the imports:

```ts
export const BLOCK_THEME_COLOR_KEYS = ["background", "surface", "text", "accent", "accentSoft", "accentFill", "onAccent"] as const;
export type BlockThemeColorKey = (typeof BLOCK_THEME_COLOR_KEYS)[number];
export const BLOCK_THEME_COLOR_LABELS: Record<BlockThemeColorKey, string> = {
  background: "Page",
  surface: "Surface",
  text: "Text",
  accent: "Accent",
  accentSoft: "Tint",
  accentFill: "Fill",
  onAccent: "On accent"
};

const THEME_REF = "theme:";

export function themeColorRef(key: BlockThemeColorKey): string {
  return `${THEME_REF}${key}`;
}

export function parseThemeColorRef(value: string | null): BlockThemeColorKey | null {
  if (!value?.startsWith(THEME_REF)) return null;
  const key = value.slice(THEME_REF.length);
  return (BLOCK_THEME_COLOR_KEYS as readonly string[]).includes(key) ? (key as BlockThemeColorKey) : null;
}

export function resolveBlockColor(value: string | null, palette: Pick<ThemeColors, BlockThemeColorKey>): string | null {
  if (!value?.startsWith(THEME_REF)) return value;
  const key = parseThemeColorRef(value);
  return key ? palette[key] : null;
}

export function effectiveBlockColors(
  style: Pick<BlockStyle, "backgroundColor" | "textColor">,
  theme: Pick<ThemeColors, BlockThemeColorKey>
): { text: string; background: string } {
  return {
    text: resolveBlockColor(style.textColor, theme) ?? theme.text,
    background: style.backgroundColor === "transparent" ? theme.background : resolveBlockColor(style.backgroundColor, theme) ?? theme.surface
  };
}
```

3. Replace `blockTextColors` with:

```ts
export function blockTextColors(
  style: Pick<BlockStyle, "backgroundColor" | "textColor">,
  theme: Pick<ThemeColors, BlockThemeColorKey | "textDim">
): { text: string; dim: string } {
  if (!style.backgroundColor && !style.textColor) return { text: theme.text, dim: theme.textDim };
  const { text, background } = effectiveBlockColors(style, theme);
  return { text, dim: mutedTextColor(text, background) ?? theme.textDim };
}
```

`murals/index.ts` already does `export * from "./blockTextColors.js"`, so the new names reach `@scripta/shared` with no further change.

- [ ] **Step 5: Run the shared tests and typecheck**

Run: `npm test --workspace @scripta/shared && npm run typecheck --workspace @scripta/shared`
Expected: PASS. If `presets.ts` or `murals.ts` fail to typecheck, it's because they build a `BlockStyle` without spreading `DEFAULT_BLOCK_STYLE`; spread it there.

- [ ] **Step 6: Pin the defaults in the frontend style test**

In `frontend/scripts/test-library-style.mts` section 8 (after the `backgroundColor defaults to null` check), add:

```ts
  check("textAlign defaults to left and innerSpacing to normal (today's rendering)", DEFAULT_BLOCK_STYLE.textAlign === "left" && DEFAULT_BLOCK_STYLE.innerSpacing === "normal");
  check("a style saved before textAlign/innerSpacing existed resolves to today's rendering", resolveBlockStyle({ cardRadius: 4 }).textAlign === "left" && resolveBlockStyle({ cardRadius: 4 }).innerSpacing === "normal");
```

Run: `npm run build --workspace @scripta/shared && npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 7: Check the clients still compile against the new signature**

Run: `npm run typecheck --workspace mobile && npm run typecheck --workspace frontend`
Expected: PASS. Both callers pass a full theme palette (`useTheme().colors` / `themes[…].colors`), which satisfies the wider `Pick`.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add packages/shared/src/library/libraryStyle.ts packages/shared/src/murals/blockTextColors.ts packages/shared/src/murals/blockTextColors.test.ts frontend/scripts/test-library-style.mts && /usr/bin/git commit -m "Add block text alignment, inner spacing and theme colour references

A block colour can now name a palette key (theme:accentSoft) instead of a
hex value, so it follows each viewer's theme the way a null background
already does. Unknown keys resolve to the theme default rather than
black. Transparent backgrounds measure muted text against the page.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Web renderers for the new style fields

**Files:**
- Modify: `frontend/src/lib/libraryStyle.ts` (re-export list, around lines 16–40; add `BLOCK_PAD_SCALE`)
- Modify: `frontend/src/index.css` (after the `@import` lines)
- Modify: `frontend/src/components/murals/MuralCanvas.tsx` (the block wrapper `style`, around lines 150–172)
- Modify: `frontend/src/components/murals/MobileMuralCanvas.tsx` (the `BlockFrame` `style`, around lines 112–128)
- Modify: `frontend/src/components/murals/blocks/BookBlocks.tsx` lines 77, 92, 113, 336
- Modify: `frontend/src/components/murals/blocks/MiscBlocks.tsx` lines 20, 30, 94
- Modify: `frontend/src/components/murals/blocks/QuoteBlocks.tsx` lines 21, 42
- Modify: `frontend/src/components/murals/MobileBlockPreview.tsx` lines 47, 55, 59, 85, 103, 120, 143, 166
- Create: `frontend/scripts/test-block-padding.mts`
- Test: `frontend/scripts/test-library-style.mts`

**Interfaces:**
- Consumes: `resolveBlockColor`, `BlockInnerSpacing` and `BlockTextAlign` from `@scripta/shared` (Task 1).
- Produces: `BLOCK_PAD_SCALE: Record<BlockInnerSpacing, number>` in `frontend/src/lib/libraryStyle.ts`, and the Tailwind utilities `block-p-*`, `block-px-*` and `block-py-*`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/scripts/test-block-padding.mts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("index.css scales block padding by the block's --block-pad", () => {
  const css = read("../src/index.css");
  for (const name of ["block-p-*", "block-px-*", "block-py-*"]) {
    assert.match(css, new RegExp(`@utility ${name.replace("*", "\\*")} \\{[^}]*var\\(--block-pad, 1\\)`));
  }
});

test("every block view pads itself with the scaled utilities", () => {
  for (const file of ["blocks/BookBlocks.tsx", "blocks/MiscBlocks.tsx", "blocks/QuoteBlocks.tsx", "MobileBlockPreview.tsx"]) {
    assert.match(read(`../src/components/murals/${file}`), /block-p[xy]?-/, file);
  }
});
```

In `frontend/scripts/test-library-style.mts`, import `BLOCK_PAD_SCALE` from `../src/lib/libraryStyle.ts` alongside the file's existing imports from that module, then add after the Task 1 checks:

```ts
  check("Normal inner spacing pads exactly as before", BLOCK_PAD_SCALE.normal === 1);
  check("Tight pads less and Roomy more than Normal", BLOCK_PAD_SCALE.tight < 1 && BLOCK_PAD_SCALE.roomy > 1);
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test --workspace frontend`
Expected: FAIL, because the utilities aren't defined, the block views have no `block-p` classes, and `BLOCK_PAD_SCALE` doesn't exist yet.

- [ ] **Step 3: Add the scale and re-exports**

In `frontend/src/lib/libraryStyle.ts`:

1. Add `BlockInnerSpacing` and `BlockTextAlign` to the `export type { … } from "@scripta/shared"` list.
2. Add `BLOCK_INNER_SPACING_OPTIONS` and `BLOCK_TEXT_ALIGN_OPTIONS` to the value re-export list.
3. Import the type locally and add:

```ts
export const BLOCK_PAD_SCALE: Record<BlockInnerSpacing, number> = { tight: 0.5, normal: 1, roomy: 1.6 };
```

- [ ] **Step 4: Add the Tailwind utilities**

In `frontend/src/index.css`, directly after `@import "./themes.css";`:

```css
@utility block-p-* {
  padding: calc(var(--spacing) * --value(number) * var(--block-pad, 1));
}

@utility block-px-* {
  padding-inline: calc(var(--spacing) * --value(number) * var(--block-pad, 1));
}

@utility block-py-* {
  padding-block: calc(var(--spacing) * --value(number) * var(--block-pad, 1));
}
```

- [ ] **Step 5: Switch each block view's own padding to the scaled utilities**

Replace exactly these classes. Nothing else changes: chip, caption-bar and empty-state padding stay as they are.

| File:line | From | To |
|---|---|---|
| `blocks/BookBlocks.tsx:77` | `px-2.5 py-2` | `block-px-2.5 block-py-2` |
| `blocks/BookBlocks.tsx:92`, `:113`, `:336` | `p-2.5` | `block-p-2.5` |
| `blocks/MiscBlocks.tsx:20`, `:30` | `p-3.5` | `block-p-3.5` |
| `blocks/MiscBlocks.tsx:94` | `p-2.5` | `block-p-2.5` |
| `blocks/QuoteBlocks.tsx:21` | `p-4` | `block-p-4` |
| `blocks/QuoteBlocks.tsx:42` | `p-2.5` | `block-p-2.5` |
| `MobileBlockPreview.tsx:47`, `:55`, `:143`, `:166` | `p-2` | `block-p-2` |
| `MobileBlockPreview.tsx:59` | `p-1` | `block-p-1` |
| `MobileBlockPreview.tsx:85` | `px-2 py-1.5` | `block-px-2 block-py-1.5` |
| `MobileBlockPreview.tsx:103` | `p-1.5` | `block-p-1.5` |
| `MobileBlockPreview.tsx:120` | `px-2 pt-1 pb-1` | `block-px-2 block-py-1` |

- [ ] **Step 6: Resolve colours and apply alignment and spacing in both wrappers**

`themeColors` already exists in both files: `MuralCanvas.tsx:77` and `MobileMuralCanvas.tsx:89`. Import `resolveBlockColor` from `@scripta/shared` and `BLOCK_PAD_SCALE` from `../../lib/libraryStyle`.

In each wrapper's `style` object:

1. Change the three colour lines to:

```tsx
backgroundColor: resolveBlockColor(style.backgroundColor, themeColors) ?? "var(--color-surface)",
borderColor: resolveBorderColor(resolveBlockColor(style.cardBorderColor, themeColors), style.cardBorderOpacity),
color: resolveBlockColor(style.textColor, themeColors) ?? undefined,
```

2. Add these two entries (the object is already cast `as CSSProperties`):

```tsx
textAlign: style.textAlign,
"--block-pad": BLOCK_PAD_SCALE[style.innerSpacing],
```

- [ ] **Step 7: Run the tests, then build to prove Tailwind emits the utilities**

Run: `npm test --workspace frontend && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm run build --workspace frontend && grep -c "block-pad" frontend/dist/assets/*.css`
Expected: tests PASS, the build succeeds, and the grep count is at least 1. If the count is 0, Tailwind didn't accept `--value(number)` for the decimal steps (`2.5`, `3.5`, `1.5`). In that case stop and report BLOCKED with the build output rather than switching to arbitrary values.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add frontend/src/lib/libraryStyle.ts frontend/src/index.css frontend/src/components/murals frontend/scripts/test-block-padding.mts frontend/scripts/test-library-style.mts && /usr/bin/git commit -m "Render block alignment, inner spacing and theme colours on web

Each block view pads itself, so inner spacing scales those paddings
through a --block-pad variable on the wrapper rather than adding padding
around them; Normal is a scale of 1 and renders exactly as before.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Web style panel controls

**Files:**
- Modify: `frontend/src/components/StyleControls.tsx` (`CardBorderSection` around lines 187–276, `BlockAppearanceSection` around lines 363–440, `BlockTextSection` around lines 442–530)

**Interfaces:**
- Consumes: `parseThemeColorRef`, `BLOCK_THEME_COLOR_LABELS` from `@scripta/shared`, and `BLOCK_TEXT_ALIGN_OPTIONS`, `BLOCK_INNER_SPACING_OPTIONS`, `BlockTextAlign`, `BlockInnerSpacing` via `../lib/libraryStyle` (Task 2 re-exports).
- Produces: no new exports. `BlockAppearanceSection` gains the `innerSpacing` field, and `BlockTextSection` gains `textAlign`.

- [ ] **Step 1: Add the colour input that understands theme references**

Add `import { BLOCK_THEME_COLOR_LABELS, parseThemeColorRef } from "@scripta/shared";`. Also add `BLOCK_INNER_SPACING_OPTIONS`, `BLOCK_TEXT_ALIGN_OPTIONS`, `type BlockInnerSpacing` and `type BlockTextAlign` to the existing `../lib/libraryStyle` import. Then, near the top of `StyleControls.tsx` and below `SliderRow`, add:

```tsx
function ColorValueInput({ value, fallback, onChange }: { value: string; fallback: string; onChange: (color: string) => void }) {
  const themeKey = parseThemeColorRef(value);
  if (themeKey) {
    return (
      <span className="flex items-center gap-2 text-sm text-(--color-text-dim)">
        Theme color: {BLOCK_THEME_COLOR_LABELS[themeKey]}
        <button type="button" onClick={() => onChange(fallback)} className="font-semibold text-(--color-text) underline decoration-(--color-accent)">
          Use a custom color
        </button>
      </span>
    );
  }
  return <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-16 rounded border border-(--color-border) bg-transparent" />;
}
```

Replace each of the three `<input type="color" …/>` elements with it:

- Background: `<ColorValueInput value={draft.backgroundColor ?? "#ffffff"} fallback="#ffffff" onChange={(color) => onApply({ backgroundColor: color })} />`.
- Text: `<ColorValueInput value={draft.textColor ?? "#1a1a1a"} fallback="#1a1a1a" onChange={(color) => onApply({ textColor: color })} />`.
- Border: `<ColorValueInput value={draft.cardBorderColor ?? "#45403a"} fallback="#45403a" onChange={(color) => onApply({ cardBorderColor: color })} />`.

- [ ] **Step 2: Add "No background" and inner spacing to `BlockAppearanceSection`**

1. Add `"innerSpacing"` to `BlockAppearanceFields`.
2. Replace `const usingCustomBackground = draft.backgroundColor !== null;` with:

```tsx
const transparent = draft.backgroundColor === "transparent";
const usingCustomBackground = draft.backgroundColor !== null && !transparent;
```

3. Add `disabled={transparent}` to the existing "Custom background color" checkbox.
4. Directly above that checkbox's wrapping `<div className="mb-4 flex items-center justify-between">`, add:

```tsx
<label className="mb-3 flex items-center gap-2 text-sm font-semibold" htmlFor={`${idPrefix}-no-bg-toggle`}>
  <input
    id={`${idPrefix}-no-bg-toggle`}
    type="checkbox"
    checked={transparent}
    onChange={(e) => onSaveNow(e.target.checked ? { backgroundColor: "transparent", cardShadow: false } : { backgroundColor: null })}
  />
  No background
</label>
```

5. After the "Block opacity" `SliderRow`, add:

```tsx
<div className="mb-4">
  <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-inner-spacing`}>
    Inner spacing
  </label>
  <select
    id={`${idPrefix}-inner-spacing`}
    value={draft.innerSpacing}
    onChange={(e) => onSaveNow({ innerSpacing: e.target.value as BlockInnerSpacing })}
    className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
  >
    {BLOCK_INNER_SPACING_OPTIONS.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 3: Add alignment to `BlockTextSection`**

1. Add `"textAlign"` to `BlockTextFields`.
2. After the "Text size" `SliderRow`, add:

```tsx
<div className="mb-4">
  <label className="mb-1 block text-sm font-semibold" htmlFor={`${idPrefix}-text-align`}>
    Alignment
  </label>
  <select
    id={`${idPrefix}-text-align`}
    value={draft.textAlign}
    onChange={(e) => onSaveNow({ textAlign: e.target.value as BlockTextAlign })}
    className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
  >
    {BLOCK_TEXT_ALIGN_OPTIONS.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS. `BlockStylePanel` passes the whole draft, so it needs no change.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add frontend/src/components/StyleControls.tsx && /usr/bin/git commit -m "Let the web block style panel edit alignment, spacing and no background

A colour holding a theme reference shows its name instead of a colour
input: <input type=color> can't display 'theme:accent', would show black,
and would overwrite the reference on first touch.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Native block frame, preview and canvas interactions

**Files:**
- Modify: `mobile/src/features/murals/MuralCanvas.tsx`

**Interfaces:**
- Consumes: `resolveBlockColor` from `@scripta/shared` (Task 1), and the new `BlockStyle` fields.
- Produces:
  - `export function BlockPreview(props: { block: MuralBlock; canvasWidth: number; maxHeight: number; books: Array<Record<string, unknown>>; images: GalleryImage[]; tierlists: Tierlist[]; profile?: ReaderProfile; groups?: Group[] })`.
  - `MuralCanvas`'s `onSelectBlock` becomes `(id: string | null) => void`. It's called with `null` when empty canvas is tapped.
  - `CanvasBlock` exposes `accessibilityActions` for moveLeft / moveRight / moveUp / moveDown, calling the existing `onMove(dx, dy)`.

This file renders React Native views, and the repo has no renderer tests. It's verified by typecheck here and on the device in Task 10.

- [ ] **Step 1: Alignment in text styles**

In `blockTextStyles`, add `textAlign: style.textAlign,` to the `face` object.

- [ ] **Step 2: Extract the frame style**

Below `blockShadow`, add:

```tsx
const BLOCK_PADDING = { tight: spacing.sm, normal: spacing.lg, roomy: spacing.xxl } as const;

function sideWidths(width: number, sides: BlockStyle["cardBorderSides"]) {
  return {
    borderTopWidth: sides.top ? width : 0,
    borderRightWidth: sides.right ? width : 0,
    borderBottomWidth: sides.bottom ? width : 0,
    borderLeftWidth: sides.left ? width : 0,
  };
}

function blockFrameStyle(style: BlockStyle, colors: ThemeColors) {
  return {
    padding: BLOCK_PADDING[style.innerSpacing] ?? BLOCK_PADDING.normal,
    backgroundColor: resolveBlockColor(style.backgroundColor, colors) ?? colors.surface,
    borderColor: resolveBorderColor(resolveBlockColor(style.cardBorderColor, colors), style.cardBorderOpacity, colors.border),
    ...sideWidths(style.cardBorderWidth, style.cardBorderSides),
    borderStyle: resolveBorderStyle(style.cardBorderStyle),
    borderRadius: style.cardRadius,
    opacity: style.cardOpacity / 100,
  };
}

function frameShadow(style: BlockStyle) {
  return style.cardShadow && style.backgroundColor !== "transparent" ? blockShadow : null;
}
```

- `ThemeColors` comes from `useTheme`'s theme type: import `type ThemeColors` from `../../ui/theme`, which re-exports it (`theme.tsx:21`).
- `frameShadow` skips transparent backgrounds because iOS draws a shadow-casting view with no background by shadowing each child, so every line of text would get a shadow.

- [ ] **Step 3: Use it in `CanvasBlock`**

Replace the frame entries in `CanvasBlock`'s `Animated.View` style array. Keep `left`/`top`/`width`/`height` and `animated`:

```tsx
styles.block,
frameShadow(style),
blockFrameStyle(style, colors),
selected ? { borderColor: colors.accent, ...sideWidths(Math.max(2, style.cardBorderWidth), DEFAULT_BORDER_SIDES) } : null,
{
  left: block.layout.x * columnWidth,
  top: block.layout.y * ROW_HEIGHT,
  width: block.layout.w * columnWidth - GAP,
  height: block.layout.h * ROW_HEIGHT - GAP,
},
animated,
```

Import `DEFAULT_BORDER_SIDES` and `resolveBlockColor` from `@scripta/shared`. Remove `padding: spacing.lg` from `styles.block`, because the frame owns padding now.

- [ ] **Step 4: Accessibility move actions**

Above `CanvasBlock`, add:

```tsx
const MOVES: Record<string, [number, number]> = { moveLeft: [-1, 0], moveRight: [1, 0], moveUp: [0, -1], moveDown: [0, 1] };
const MOVE_ACTIONS = [
  { name: "moveLeft", label: "Move left" },
  { name: "moveRight", label: "Move right" },
  { name: "moveUp", label: "Move up" },
  { name: "moveDown", label: "Move down" },
];
```

On the editable `Pressable` in `CanvasBlock`, add:

```tsx
accessibilityActions={MOVE_ACTIONS}
onAccessibilityAction={(event) => { const move = MOVES[event.nativeEvent.actionName]; if (move) onMove(move[0], move[1]); }}
```

- [ ] **Step 5: Tapping empty canvas deselects**

1. Change `onSelectBlock?: (id: string) => void;` to `onSelectBlock?: (id: string | null) => void;`.
2. In `MuralCanvas`, assign the existing returned `<View onLayout=…>…</View>` to `const canvas =`.
3. Return:

```tsx
return editable ? <Pressable accessible={false} onPress={() => onSelectBlock?.(null)}>{canvas}</Pressable> : canvas;
```

- [ ] **Step 6: Add `BlockPreview`**

Add this after `CanvasBlock`. Import `radii` from `../../ui/theme`.

```tsx
export function BlockPreview({ block, canvasWidth, maxHeight, books, images, tierlists, profile, groups = [] }: {
  block: MuralBlock;
  canvasWidth: number;
  maxHeight: number;
  books: Array<Record<string, unknown>>;
  images: GalleryImage[];
  tierlists: Tierlist[];
  profile?: ReaderProfile;
  groups?: Group[];
}) {
  const { colors } = useTheme();
  const [boxWidth, setBoxWidth] = useState(0);
  const [day] = useState(() => new Date().toISOString().slice(0, 10));
  const resolved = useMemo(() => resolveHomeBlock(block, books, groups, day), [block, books, groups, day]);
  const style = resolveBlockStyle(resolved.style);
  const width = block.layout.w * (canvasWidth / GRID_COLUMNS) - GAP;
  const height = block.layout.h * ROW_HEIGHT - GAP;
  const room = boxWidth - spacing.md * 2;
  const scale = room > 0 ? Math.min(1, room / width, maxHeight / height) : 0;
  return (
    <View
      accessibilityLabel={`Preview of this ${BLOCK_TYPE_LABELS[block.type]} block`}
      onLayout={(event) => setBoxWidth(event.nativeEvent.layout.width)}
      style={[styles.previewBox, { height: (scale ? height * scale : maxHeight) + spacing.md * 2, backgroundColor: colors.background }]}
    >
      {scale ? (
        <View style={[styles.previewBlock, frameShadow(style), blockFrameStyle(style, colors), { width, height, transform: [{ scale }] }]}>
          <View style={styles.blockBody}>
            <BlockContent block={resolved} books={books} images={images} tierlists={tierlists} profile={profile} groups={groups} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
```

Add to `styles`:

```tsx
previewBox: { borderRadius: radii.lg, alignItems: "center", justifyContent: "center", overflow: "hidden" },
previewBlock: { overflow: "hidden" },
```

- [ ] **Step 7: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS. `MuralEditorScreen` still passes `setSelectedId`, which accepts `null`, so it compiles unchanged.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add mobile/src/features/murals/MuralCanvas.tsx && /usr/bin/git commit -m "Share one block frame between the native canvas and a scaled preview

The frame now resolves theme colours, draws per-side borders the way
BookCard already does, and pads by inner spacing. Screen readers get
move actions in place of the arrow buttons the editor is losing, and a
tap on empty canvas deselects.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Layout step helper

**Files:**
- Modify: `mobile/src/features/murals/layout.ts`
- Test: `mobile/src/features/murals/layout.test.ts`

**Interfaces:**
- Produces:
  - `type LayoutStepBlock = "minimum" | "edge" | "overlap"`.
  - `layoutStepBlocked(blocks: MuralBlock[], blockId: string, patch: Partial<BlockLayout>): LayoutStepBlock | null`. It returns `null` when `changeBlockLayout` would accept the patch.

- [ ] **Step 1: Write the failing tests**

Append to `layout.test.ts`, and extend the import to `import { changeBlockLayout, layoutStepBlocked, muralCanvasHeight } from "./layout.js";`:

```ts
const grid: MuralBlock[] = [
  { id: "a", type: "text", heading: "A", body: "", layout: { x: 0, y: 0, w: 4, h: 2 } },
  { id: "b", type: "text", heading: "B", body: "", layout: { x: 4, y: 0, w: 3, h: 2 } },
  { id: "c", type: "text", heading: "C", body: "", layout: { x: 9, y: 4, w: 3, h: 1 } },
];

test("a step into another block is blocked by that block", () => {
  assert.equal(layoutStepBlocked(grid, "a", { w: 5 }), "overlap");
});

test("a step past the right edge is blocked by the edge", () => {
  assert.equal(layoutStepBlocked(grid, "c", { w: 4 }), "edge");
});

test("shrinking below one cell is the minimum", () => {
  assert.equal(layoutStepBlocked(grid, "c", { h: 0 }), "minimum");
  assert.equal(layoutStepBlocked(grid, "c", { w: 0 }), "minimum");
});

test("free steps are allowed, and growing taller never meets an edge", () => {
  assert.equal(layoutStepBlocked(grid, "a", { h: 3 }), null);
  assert.equal(layoutStepBlocked(grid, "c", { h: 40 }), null);
});

test("the helper agrees with changeBlockLayout", () => {
  const patches = [{ w: 5 }, { w: 3 }, { h: 3 }, { h: 0 }, { x: 11 }, { w: 4 }];
  for (const id of ["a", "b", "c"]) {
    for (const patch of patches) {
      assert.equal(layoutStepBlocked(grid, id, patch) === null, changeBlockLayout(grid, id, patch) !== grid, `${id} ${JSON.stringify(patch)}`);
    }
  }
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test --workspace mobile`
Expected: FAIL, because `layoutStepBlocked` is not exported.

- [ ] **Step 3: Implement**

In `layout.ts`, extend the import to `import { GRID_COLUMNS, isValidBlockLayout, type BlockLayout, type MuralBlock } from "@scripta/shared";` and add:

```ts
export type LayoutStepBlock = "minimum" | "edge" | "overlap";

export function layoutStepBlocked(blocks: MuralBlock[], blockId: string, patch: Partial<BlockLayout>): LayoutStepBlock | null {
  const block = blocks.find((item) => item.id === blockId);
  if (!block) return null;
  const layout = { ...block.layout, ...patch };
  if (layout.w < 1 || layout.h < 1) return "minimum";
  if (layout.x < 0 || layout.y < 0 || layout.x + layout.w > GRID_COLUMNS) return "edge";
  return isValidBlockLayout(layout, blocks, blockId) ? null : "overlap";
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test --workspace mobile && npm run typecheck --workspace mobile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add mobile/src/features/murals/layout.ts mobile/src/features/murals/layout.test.ts && /usr/bin/git commit -m "Say why a mural block can't grow instead of ignoring the tap

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Action bar and block sheet (native editor)

**Files:**
- Modify: `mobile/src/ui/icon.tsx` (`GLYPHS`)
- Create: `mobile/src/features/murals/BlockActionBar.tsx`
- Create: `mobile/src/features/murals/BlockSheet.tsx`
- Create: `mobile/src/features/murals/LayoutTab.tsx`
- Create: `mobile/src/features/murals/ContentTab.tsx`
- Modify: `mobile/src/features/murals/MuralEditorScreen.tsx`

**Interfaces:**
- Consumes: `BlockPreview` and the `onSelectBlock(id | null)` prop (Task 4); `layoutStepBlocked` and `LayoutStepBlock` (Task 5).
- Produces:
  - `type SheetTab = "content" | "style" | "layout"`, from `BlockSheet.tsx`.
  - `BlockSheet` props: `{ block: MuralBlock | null; visible: boolean; tab: SheetTab | null; onTabChange: (tab: SheetTab) => void; onClose: () => void; preview: ReactNode; content: ReactNode | null; style: ReactNode | null; layout: ReactNode }`.
  - `ContentTab` props: `{ block: MuralBlock; books; groups: Group[]; images: GalleryImage[]; tierlists: Tierlist[]; update: (transform: (block: MuralBlock) => MuralBlock) => void; onPick: (kind: PickerKind) => void }`.
  - `type PickerKind = "book" | "image" | "tierlist"` and `hasContentFields(type: BlockType): boolean`, both from `ContentTab.tsx`.
  - `BlockActionBar({ actions: BlockAction[] })`, where `type BlockAction = { key: string; label: string; icon: IconName; onPress: () => void; tone?: "danger" }`.
  - New icon names: `edit`, `style`, `resize`, `duplicate`.

This task moves the existing content fields into `ContentTab` **unchanged**, so the reviewer can see the move separately from the redesign in Task 7. The Style tab arrives in Task 8.

- [ ] **Step 1: Icons**

Add to `GLYPHS` in `icon.tsx`, before `} as const satisfies`:

```ts
  edit: { ios: "pencil", android: "edit" },
  style: { ios: "paintbrush", android: "brush" },
  resize: { ios: "arrow.up.left.and.arrow.down.right", android: "open_in_full" },
  duplicate: { ios: "plus.square.on.square", android: "content_copy" },
```

- [ ] **Step 2: `BlockActionBar.tsx`**

```tsx
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName } from "../../ui";
import { Text } from "../../ui/Text";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";

export type BlockAction = { key: string; label: string; icon: IconName; onPress: () => void; tone?: "danger" };

export function BlockActionBar({ actions }: { actions: BlockAction[] }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="toolbar" style={styles.bar}>
      {actions.map((action) => {
        const color = action.tone === "danger" ? colors.danger : colors.text;
        return (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            style={({ pressed }) => [styles.action, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
          >
            <Icon name={action.icon} color={color} size={22} />
            <Text numberOfLines={1} style={[typography.caption, { color }]}>{action.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flex: 1, flexDirection: "row" },
  action: { flex: 1, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: spacing.xs, borderRadius: radii.md },
});
```

- [ ] **Step 3: `LayoutTab.tsx`**

```tsx
import { GRID_COLUMNS, type BlockLayout, type MuralBlock } from "@scripta/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { layoutStepBlocked, type LayoutStepBlock } from "./layout";

const REASONS: Partial<Record<LayoutStepBlock, string>> = { edge: "Reached the edge of the mural", overlap: "Another block is in the way" };

function SizeStepper({ label, value, unit, decrease, increase, onStep }: {
  label: string;
  value: number;
  unit: string;
  decrease: LayoutStepBlock | null;
  increase: LayoutStepBlock | null;
  onStep: (delta: number) => void;
}) {
  const { colors } = useTheme();
  const button = (delta: number, blocked: LayoutStepBlock | null, glyph: string, verb: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${verb} ${label.toLowerCase()}`}
      accessibilityState={{ disabled: blocked !== null }}
      disabled={blocked !== null}
      onPress={() => onStep(delta)}
      style={[styles.step, { borderColor: colors.border, opacity: blocked ? 0.4 : 1 }]}
    >
      <Text style={{ color: colors.text, fontWeight: "700" }}>{glyph}</Text>
    </Pressable>
  );
  const reason = increase ? REASONS[increase] : undefined;
  return (
    <View style={styles.row}>
      <View style={styles.line}>
        <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{label}</Text>
        <View style={styles.stepper}>
          {button(-1, decrease, "−", "Decrease")}
          <Text style={[typography.body, styles.value, { color: colors.text }]}>{value} {unit}</Text>
          {button(1, increase, "+", "Increase")}
        </View>
      </View>
      {reason ? <Text style={[typography.caption, { color: colors.textDim }]}>{reason}</Text> : null}
    </View>
  );
}

export function LayoutTab({ block, blocks, onChange }: { block: MuralBlock; blocks: MuralBlock[]; onChange: (patch: Partial<BlockLayout>) => void }) {
  const { colors } = useTheme();
  const { w, h } = block.layout;
  return (
    <View style={styles.tab}>
      <SizeStepper label="Width" value={w} unit={`of ${GRID_COLUMNS} columns`} decrease={layoutStepBlocked(blocks, block.id, { w: w - 1 })} increase={layoutStepBlocked(blocks, block.id, { w: w + 1 })} onStep={(delta) => onChange({ w: w + delta })} />
      <SizeStepper label="Height" value={h} unit={h === 1 ? "row" : "rows"} decrease={layoutStepBlocked(blocks, block.id, { h: h - 1 })} increase={layoutStepBlocked(blocks, block.id, { h: h + 1 })} onStep={(delta) => onChange({ h: h + delta })} />
      <Text style={[typography.caption, { color: colors.textDim }]}>To move this block, close this sheet, then long-press and drag it on the mural.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { gap: spacing.lg },
  row: { gap: spacing.xs },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  step: { minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, borderWidth: 1, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  value: { minWidth: 96, textAlign: "center" },
});
```

- [ ] **Step 4: `ContentTab.tsx` (a move, not a redesign)**

1. Create the file with `PickerKind`, `hasContentFields` and a `ContentTab` component with the props listed under Interfaces.
2. Its body is the JSX currently at `MuralEditorScreen.tsx` lines 145–157 (the shelf/quote/text/profile/title/caption/stats fields) and lines 161–163 (the "Choose books / image / tier list" buttons), wrapped in `<View style={styles.tab}>` with `tab: { gap: spacing.sm }`.
3. In that moved JSX, make these substitutions:
   - `selected` → `block`
   - `updateSelected` → `update`
   - `setPicking("book")` / `"image"` / `"tierlist"` → `onPick("book")` / etc.
   - `library?.data.groups ?? []` → `groups`
   - `colors` comes from `useTheme()`.
4. Carry `styles.genreChoices` / `styles.genreChoice` over from the editor.
5. Leave out the position readout, the arrow and size buttons, Duplicate and Delete (lines 158–160 and 164–165). Those move to the bar and the Layout tab.

```tsx
export type PickerKind = "book" | "image" | "tierlist";

const CONTENTLESS: ReadonlySet<BlockType> = new Set<BlockType>(["currentlyReading", "empty", "readerCard"]);

export function hasContentFields(type: BlockType): boolean {
  return !CONTENTLESS.has(type);
}
```

- [ ] **Step 5: `BlockSheet.tsx`**

```tsx
import { BLOCK_TYPE_LABELS, type MuralBlock } from "@scripta/shared";
import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { FormScroll, Segmented, Sheet } from "../../ui";
import { spacing } from "../../ui/theme";

export type SheetTab = "content" | "style" | "layout";

export function BlockSheet({ block, visible, tab, onTabChange, onClose, preview, content, style, layout }: {
  block: MuralBlock | null;
  visible: boolean;
  tab: SheetTab | null;
  onTabChange: (tab: SheetTab) => void;
  onClose: () => void;
  preview: ReactNode;
  content: ReactNode | null;
  style: ReactNode | null;
  layout: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const tabs: Array<{ value: SheetTab; label: string }> = [
    ...(content ? [{ value: "content" as const, label: "Content" }] : []),
    ...(style ? [{ value: "style" as const, label: "Style" }] : []),
    { value: "layout", label: "Layout" },
  ];
  const current = tabs.some((item) => item.value === tab) ? tab! : "layout";
  return (
    <Sheet visible={visible} title={block ? BLOCK_TYPE_LABELS[block.type] : ""} onClose={onClose}>
      <View style={[styles.frame, { height: Math.round(height * 0.7) }]}>
        {preview}
        <Segmented options={tabs} value={current} onChange={onTabChange} accessibilityLabel="Block settings" />
        <FormScroll contentContainerStyle={styles.body}>{current === "content" ? content : current === "style" ? style : layout}</FormScroll>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  frame: { gap: spacing.md },
  body: { paddingBottom: spacing.xl },
});
```

`FormScroll` is already exported from `ui/components.tsx`, and `Input` registers with it to stay above the keyboard. If `FormScroll` isn't in `ui/index.ts`'s exports, it's reachable through `export * from "./components"`.

- [ ] **Step 6: Rewire `MuralEditorScreen.tsx`**

1. Imports:
   - Add `AccessibilityInfo` and `useWindowDimensions` to the `react-native` import.
   - Add `BlockPreview` from `./MuralCanvas`.
   - Add `BlockActionBar` and `type BlockAction` from `./BlockActionBar`.
   - Add `BlockSheet` and `type SheetTab` from `./BlockSheet`.
   - Add `ContentTab` and `hasContentFields` from `./ContentTab`.
   - Add `LayoutTab` from `./LayoutTab`.
   - Drop imports that become unused (`ALL_STAT_METRICS`, `BOOK_GENRES` and `resolveHomeBlock` move to `ContentTab`).
2. State and derived values:

```tsx
const [sheetTab, setSheetTab] = useState<SheetTab | null>(null);
const { width: windowWidth } = useWindowDimensions();
const groups = library?.data.groups ?? [];
const profile = user?.username ? { username: user.username, avatarUrl: user.avatarId ? `${API_URL}/auth/avatar/${user.avatarId}/file` : null } : undefined;
```

   Use `profile` and `groups` in the three places the inline expressions appear today: the canvas, the share sheet, and the new sheet.

3. `add(type)` opens the new block's content, which is what selecting it did before:

```tsx
function add(type: BlockType) {
  const block = createBlockCandidate(type, currentBlocks);
  setBlocks([...currentBlocks, block]);
  setSelectedId(block.id);
  setSheetTab(hasContentFields(type) ? "content" : null);
  setAdding(false);
}
```

4. Canvas handlers:

```tsx
onSelectBlock={(blockId) => { setSelectedId(blockId); if (blockId === null) setSheetTab(null); }}
onLayoutChange={(blockId, layout) => {
  const next = changeBlockLayout(currentBlocks, blockId, layout);
  if (next === currentBlocks) AccessibilityInfo.announceForAccessibility("Can't move there");
  else setBlocks(next);
}}
```

5. The dock:

```tsx
<View style={[styles.dock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
  {selected ? <BlockActionBar actions={blockActions} /> : <>
    <Button label="Add block" onPress={() => setAdding(true)} />
    <Button label="Share" variant="secondary" onPress={() => setShareFor(draftMural)} />
  </>}
</View>
```

   Define `blockActions` above the `return`:

```tsx
const blockActions: BlockAction[] = selected ? [
  { key: "done", label: "Done", icon: "confirm", onPress: () => setSelectedId(null) },
  ...(hasContentFields(selected.type) ? [{ key: "edit", label: "Edit", icon: "edit" as const, onPress: () => setSheetTab("content") }] : []),
  { key: "size", label: "Size", icon: "resize", onPress: () => setSheetTab("layout") },
  { key: "copy", label: "Copy", icon: "duplicate", onPress: () => { const copy = createDuplicateCandidate(selected, currentBlocks); setBlocks([...currentBlocks, copy]); setSelectedId(copy.id); } },
  { key: "delete", label: "Delete", icon: "delete", tone: "danger", onPress: () => { setBlocks(currentBlocks.filter((block) => block.id !== selected.id)); setSelectedId(null); } },
] : [];
```

6. Replace the whole `<Sheet visible={selected !== null && picking === null} title="Block settings" …>…</Sheet>` (lines 143–167) with:

```tsx
<BlockSheet
  block={selected}
  visible={selected !== null && sheetTab !== null && picking === null}
  tab={sheetTab}
  onTabChange={setSheetTab}
  onClose={() => setSheetTab(null)}
  preview={selected ? <BlockPreview block={selected} canvasWidth={windowWidth - spacing.sm * 2} maxHeight={200} books={books} images={gallery.data ?? []} tierlists={tierlists.data ?? []} profile={profile} groups={groups} /> : null}
  content={selected && hasContentFields(selected.type) ? <ContentTab block={selected} books={books} groups={groups} images={gallery.data ?? []} tierlists={tierlists.data ?? []} update={updateSelected} onPick={setPicking} /> : null}
  style={null}
  layout={selected ? <LayoutTab block={selected} blocks={currentBlocks} onChange={(patch) => setBlocks(changeBlockLayout(currentBlocks, selected.id, patch))} /> : null}
/>
```

   The picker `Sheet` stays exactly as it is. Closing a picker sets `picking` back to `null`, which makes the block sheet visible again on the same tab.

7. Remove styles that are no longer used (`row`, and `genreChoices`/`genreChoice`, which moved).

- [ ] **Step 7: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add mobile/src/ui/icon.tsx mobile/src/features/murals && /usr/bin/git commit -m "Split mural block selection from the settings sheet

Selecting a block used to open its settings sheet, which covered the
dock; that coupling is what made the old selected-block dock unreachable
(#43). Selection now swaps the dock for an action bar, and a tabbed
sheet with a preview opens only from Edit or Size. Content fields move
across unchanged; the arrow and size buttons and the coordinate readout
are gone.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Content tab redesign

**Files:**
- Modify: `mobile/src/features/murals/ContentTab.tsx`

**Interfaces:**
- Consumes: the `ContentTab` props, `PickerKind` and `hasContentFields` from Task 6. The props don't change.
- Produces: nothing new.

- [ ] **Step 1: Add the picker row**

```tsx
function PickerRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={({ pressed }) => [styles.pickerRow, { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : colors.surface }]}
    >
      <Text style={[typography.body, { color: colors.text, fontWeight: "600" }]}>{label}</Text>
      <View style={styles.pickerValue}>
        <Text numberOfLines={1} style={[typography.body, styles.pickerValueText, { color: colors.textDim }]}>{value}</Text>
        <Icon name="chevronRight" color={colors.textDim} size={18} />
      </View>
    </Pressable>
  );
}
```

Styles:

```tsx
pickerRow: { minHeight: minimumTouchTarget, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
pickerValue: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs },
pickerValueText: { flexShrink: 1 },
```

- [ ] **Step 2: Replace the body with the per-type layout from the spec**

Constants:

```tsx
const SHELF_SOURCES = [{ value: "pick", label: "Pick books" }, { value: "follow", label: "Follow a collection" }] as const;
const QUOTE_SOURCES = [{ value: "pinned", label: "Pinned passage" }, { value: "rediscover", label: "Rediscover" }] as const;
```

Inside `ContentTab`:

```tsx
const { colors } = useTheme();
const collections = groups.filter((group) => group.type === "collection");
const bookTitle = (key: string) => key ? String(books.find((book) => bookKey(book) === key)?.Title ?? "Book unavailable") : "None";
const hint = (text: string) => <Text style={[typography.caption, { color: colors.textDim }]}>{text}</Text>;
```

Return one branch per type, each wrapped in `<View style={styles.tab}>`:

**Shelf:**

```tsx
<Input label="Title" value={block.title} onChangeText={(title) => update((item) => item.type === "shelf" ? { ...item, title } : item)} />
{collections.length ? <Segmented options={SHELF_SOURCES} value={block.collectionId ? "follow" : "pick"} accessibilityLabel="Shelf source" onChange={(source) => update((item) => item.type !== "shelf" ? item : source === "follow" ? { ...item, collectionId: collections[0]!.id, bookKeys: [] } : { ...item, collectionId: undefined, bookKeys: (resolveHomeBlock(item, books, groups, "") as typeof item).bookKeys })} /> : null}
{block.collectionId
  ? <><SelectRow label="Collection" value={block.collectionId} options={collections.map((group) => ({ value: group.id, label: group.name }))} onChange={(collectionId) => update((item) => item.type === "shelf" ? { ...item, collectionId, bookKeys: [] } : item)} />{hint("Leave the title blank to use the collection's name.")}</>
  : <PickerRow label="Books" value={`${block.bookKeys.length} chosen`} onPress={() => onPick("book")} />}
```

**Spotlight:** `PickerRow` "Book" with `bookTitle(block.bookKey)` → `onPick("book")`, then `<Input label="Caption" value={block.caption ?? ""} … />`, using the same update expression the moved code used.

**Quote:**

```tsx
<Segmented options={QUOTE_SOURCES} value={block.mode === "rediscover" ? "rediscover" : "pinned"} accessibilityLabel="Passage source" onChange={(source) => update((item) => item.type !== "quote" ? item : source === "rediscover" ? { ...item, mode: "rediscover", bookKey: "", highlightId: "" } : { ...item, mode: undefined })} />
{block.mode === "rediscover"
  ? hint("A different passage from your books each day. Only passages from known books are used.")
  : <PickerRow label="Passage" value={String(resolveQuote(block, books)?.highlight.Text ?? "None")} onPress={() => onPick("book")} />}
```

**Quote collection:** `Input` "Title", then `PickerRow` "Passages" with `String(block.quotes.length)` → `onPick("book")`.

**Image:** `PickerRow` "Image" with `images.find((image) => image.id === block.imageId)?.filename ?? "None"` → `onPick("image")`, then the Caption input.

**Text:** the moved Heading and Body inputs, unchanged.

**Profile:** the moved Bio input and genre chips, unchanged.

**Stats:**

```tsx
{ALL_STAT_METRICS.map((metric) => <ToggleRow key={metric} label={STAT_METRIC_LABELS[metric]} checked={block.metrics.includes(metric)} onChange={(checked) => update((item) => item.type === "stats" ? { ...item, metrics: checked ? [...item.metrics, metric] : item.metrics.filter((value) => value !== metric) } : item)} />)}
```

**Tier list:** `PickerRow` "Tier list" with `tierlists.find((item) => item.id === block.tierlistId)?.name ?? "None"` → `onPick("tierlist")`.

**Any other type:** `null`.

Imports:
- `SelectRow` and `ToggleRow` from `../library/components/StyleControls`.
- `Icon`, `Input` and `Segmented` from `../../ui`.
- `resolveQuote`, `STAT_METRIC_LABELS`, `bookKey`, `resolveHomeBlock`, `ALL_STAT_METRICS` and `BOOK_GENRES` from `@scripta/shared`.

Remove the old "Choose books / Choose image / Choose tier list" buttons, the "Pick books (keep the current selection)" and "Follow …" buttons, and the "Rediscover a passage" button. Everything they did is now a row or a segmented choice.

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add mobile/src/features/murals/ContentTab.tsx && /usr/bin/git commit -m "Show each block's content as its current choices

Every list-backed field is a row naming what is chosen, opening the
existing picker. Shelf and quote sources are one segmented choice rather
than a stack of buttons, and stats metrics are real switches with their
labels — ticked and unticked used to differ only in colour.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Style options (pure module)

**Files:**
- Create: `mobile/src/features/murals/blockStyleOptions.ts`
- Test: `mobile/src/features/murals/blockStyleOptions.test.ts`

**Interfaces:**
- Consumes: `effectiveBlockColors`, `contrastRatio`, `themeColorRef`, `DEFAULT_BORDER_SIDES` and the `BlockThemeColorKey` / `BorderSides` / `CardBorderStyle` / `BlockStyle` types from `@scripta/shared`; `ThemeColors` from `@scripta/shared/themes`.
- Produces:
  - `type Preset<T> = { key: string; label: string; value: T }`.
  - Presets: `CORNER_PRESETS`, `SIZE_PRESETS`, `BORDER_WIDTH_PRESETS`, `BORDER_STRENGTH_PRESETS` and `FADE_PRESETS` (`Preset<number>[]`), and `BORDER_SIDE_PRESETS` (`Preset<BorderSides>[]`).
  - `BORDER_STYLE_CHOICES: Array<{ value: CardBorderStyle; label: string }>`.
  - Swatches: `BACKGROUND_THEME_SWATCHES`, `TEXT_THEME_SWATCHES` and `BORDER_THEME_SWATCHES` (`BlockThemeColorKey[]`), and `BACKGROUND_FIXED_SWATCHES` (`string[]`).
  - `type QuickLook = { key: string; label: string; group: "theme" | "fixed"; style: Pick<BlockStyle, LookField> }` and `QUICK_LOOKS: QuickLook[]`.
  - Functions:
    - `matchPreset(presets: readonly Preset<number>[], value: number): string | null`
    - `matchSides(sides: BorderSides): string | null`
    - `applyLook(style: BlockStyle, look: QuickLook): BlockStyle`
    - `isHardToRead(style, colors: Pick<ThemeColors, BlockThemeColorKey>): boolean`

This file must not import `react-native` or anything under `ui/`, so `node --test` can load it.

- [ ] **Step 1: Write the failing tests**

```ts
/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCK_FONT_SIZE_RANGE, CARD_BORDER_OPACITY_RANGE, CARD_OPACITY_RANGE, CARD_RADIUS_RANGE, DEFAULT_BLOCK_STYLE, type BlockStyle } from "@scripta/shared";
import { THEME_IDS, themes } from "@scripta/shared/themes";
import { BORDER_STRENGTH_PRESETS, CORNER_PRESETS, FADE_PRESETS, QUICK_LOOKS, SIZE_PRESETS, applyLook, isHardToRead, matchPreset, matchSides } from "./blockStyleOptions.js";

const onGrid = (value: number, range: { min: number; max: number; step: number }) => value >= range.min && value <= range.max && (value - range.min) % range.step === 0;

test("a value authored on web between presets highlights no preset", () => {
  assert.equal(matchPreset(CORNER_PRESETS, 8), null);
  assert.equal(matchPreset(CORNER_PRESETS, 12), "rounded");
  assert.equal(matchPreset(BORDER_STRENGTH_PRESETS, 60), null);
  assert.equal(matchSides({ top: true, right: false, bottom: false, left: true }), null);
  assert.equal(matchSides({ top: true, right: false, bottom: true, left: false }), "topBottom");
});

test("every preset sits on the grid the web sliders use", () => {
  for (const preset of CORNER_PRESETS) assert.ok(onGrid(preset.value, CARD_RADIUS_RANGE), preset.key);
  for (const preset of SIZE_PRESETS) assert.ok(onGrid(preset.value, BLOCK_FONT_SIZE_RANGE), preset.key);
  for (const preset of BORDER_STRENGTH_PRESETS) assert.ok(onGrid(preset.value, CARD_BORDER_OPACITY_RANGE), preset.key);
  for (const preset of FADE_PRESETS) assert.ok(onGrid(preset.value, CARD_OPACITY_RANGE), preset.key);
});

test("a look leaves size, alignment, spacing and fade alone", () => {
  const before: BlockStyle = { ...DEFAULT_BLOCK_STYLE, fontSize: 20, textAlign: "center", innerSpacing: "roomy", cardOpacity: 72, cardHoverEffect: true };
  for (const look of QUICK_LOOKS) {
    const after = applyLook(before, look);
    assert.equal(after.fontSize, 20, look.key);
    assert.equal(after.textAlign, "center", look.key);
    assert.equal(after.innerSpacing, "roomy", look.key);
    assert.equal(after.cardOpacity, 72, look.key);
    assert.equal(after.cardHoverEffect, true, look.key);
  }
});

test("a look resets web-only border settings to plain ones", () => {
  const web: BlockStyle = { ...DEFAULT_BLOCK_STYLE, cardBorderStyle: "groove", cardBorderOpacity: 60, cardBorderSides: { top: true, right: false, bottom: false, left: false } };
  const after = applyLook(web, QUICK_LOOKS.find((look) => look.key === "plain")!);
  assert.equal(after.cardBorderStyle, "solid");
  assert.equal(after.cardBorderOpacity, 100);
  assert.equal(matchSides(after.cardBorderSides), "all");
});

test("every theme look is readable in every theme", () => {
  for (const look of QUICK_LOOKS.filter((item) => item.group === "theme")) {
    for (const id of THEME_IDS) assert.equal(isHardToRead(applyLook(DEFAULT_BLOCK_STYLE, look), themes[id].colors), false, `${look.key} in ${id}`);
  }
});

test("every fixed look is readable, whatever the theme", () => {
  for (const look of QUICK_LOOKS.filter((item) => item.group === "fixed")) {
    for (const id of THEME_IDS) assert.equal(isHardToRead(applyLook(DEFAULT_BLOCK_STYLE, look), themes[id].colors), false, `${look.key} in ${id}`);
  }
});

test("isHardToRead flags low contrast and measures a transparent block against the page", () => {
  assert.equal(isHardToRead({ backgroundColor: "#ffffff", textColor: "#eeeeee" }, themes.light.colors), true);
  assert.equal(isHardToRead({ backgroundColor: "transparent", textColor: themes.dark.colors.background }, themes.dark.colors), true);
  assert.equal(isHardToRead({ backgroundColor: null, textColor: null }, themes.light.colors), false);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test --workspace mobile`
Expected: FAIL, because `./blockStyleOptions.js` doesn't exist.

- [ ] **Step 3: Implement `blockStyleOptions.ts`**

```ts
import { DEFAULT_BORDER_SIDES, contrastRatio, effectiveBlockColors, themeColorRef, type BlockStyle, type BlockThemeColorKey, type BorderSides, type CardBorderStyle } from "@scripta/shared";
import type { ThemeColors } from "@scripta/shared/themes";

export type Preset<T> = { key: string; label: string; value: T };

export const CORNER_PRESETS: Preset<number>[] = [
  { key: "square", label: "Square", value: 0 },
  { key: "slight", label: "Slight", value: 4 },
  { key: "rounded", label: "Rounded", value: 12 },
  { key: "round", label: "Round", value: 24 },
];

export const SIZE_PRESETS: Preset<number>[] = [
  { key: "s", label: "S", value: 12 },
  { key: "m", label: "M", value: 14 },
  { key: "l", label: "L", value: 17 },
  { key: "xl", label: "XL", value: 20 },
];

export const BORDER_WIDTH_PRESETS: Preset<number>[] = [
  { key: "none", label: "None", value: 0 },
  { key: "thin", label: "Thin", value: 1 },
  { key: "thick", label: "Thick", value: 3 },
];

export const BORDER_STRENGTH_PRESETS: Preset<number>[] = [
  { key: "faint", label: "Faint", value: 40 },
  { key: "medium", label: "Medium", value: 72 },
  { key: "solid", label: "Solid", value: 100 },
];

export const FADE_PRESETS: Preset<number>[] = [
  { key: "none", label: "None", value: 100 },
  { key: "light", label: "Light", value: 72 },
  { key: "strong", label: "Strong", value: 40 },
];

export const BORDER_SIDE_PRESETS: Preset<BorderSides>[] = [
  { key: "all", label: "All", value: DEFAULT_BORDER_SIDES },
  { key: "topBottom", label: "Top & bottom", value: { top: true, right: false, bottom: true, left: false } },
  { key: "leftRight", label: "Left & right", value: { top: false, right: true, bottom: false, left: true } },
  { key: "bottom", label: "Bottom only", value: { top: false, right: false, bottom: true, left: false } },
];

export const BORDER_STYLE_CHOICES: Array<{ value: CardBorderStyle; label: string }> = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

export const BACKGROUND_THEME_SWATCHES: BlockThemeColorKey[] = ["background", "accentSoft", "accentFill", "accent"];
export const TEXT_THEME_SWATCHES: BlockThemeColorKey[] = ["accent", "onAccent"];
export const BORDER_THEME_SWATCHES: BlockThemeColorKey[] = ["accent", "text"];
export const BACKGROUND_FIXED_SWATCHES = ["#ffffff", "#f1e2d8", "#e4efdf", "#dcebf2", "#ebe4f3", "#fff3b0", "#201e1c"];

type LookField = "backgroundColor" | "textColor" | "fontFamily" | "bold" | "italic" | "codeStyle" | "cardRadius" | "cardBorderWidth" | "cardBorderColor" | "cardBorderStyle" | "cardBorderOpacity" | "cardBorderSides" | "cardShadow";

export type QuickLook = { key: string; label: string; group: "theme" | "fixed"; style: Pick<BlockStyle, LookField> };

const LOOK_BASE: Pick<BlockStyle, LookField> = {
  backgroundColor: null,
  textColor: null,
  fontFamily: "sans",
  bold: false,
  italic: false,
  codeStyle: false,
  cardRadius: 12,
  cardBorderWidth: 0,
  cardBorderColor: null,
  cardBorderStyle: "solid",
  cardBorderOpacity: 100,
  cardBorderSides: DEFAULT_BORDER_SIDES,
  cardShadow: true,
};

export const QUICK_LOOKS: QuickLook[] = [
  { key: "plain", label: "Plain", group: "theme", style: { ...LOOK_BASE, cardBorderWidth: 1 } },
  { key: "bare", label: "Bare", group: "theme", style: { ...LOOK_BASE, backgroundColor: "transparent", cardShadow: false } },
  { key: "tinted", label: "Tinted", group: "theme", style: { ...LOOK_BASE, backgroundColor: themeColorRef("accentSoft") } },
  { key: "accent", label: "Accent", group: "theme", style: { ...LOOK_BASE, backgroundColor: themeColorRef("accent"), textColor: themeColorRef("onAccent"), bold: true } },
  { key: "outline", label: "Outline", group: "theme", style: { ...LOOK_BASE, backgroundColor: "transparent", cardBorderWidth: 3, cardBorderColor: themeColorRef("accent"), cardShadow: false } },
  { key: "paper", label: "Paper", group: "fixed", style: { ...LOOK_BASE, backgroundColor: "#f6efe3", textColor: "#201e1c", fontFamily: "serif", cardRadius: 4, cardBorderWidth: 1 } },
  { key: "note", label: "Note", group: "fixed", style: { ...LOOK_BASE, backgroundColor: "#fff3b0", textColor: "#201e1c", fontFamily: "mono", cardRadius: 0 } },
  { key: "ink", label: "Ink", group: "fixed", style: { ...LOOK_BASE, backgroundColor: "#201e1c", textColor: "#f2f0ec", fontFamily: "serif" } },
  { key: "clay", label: "Clay", group: "fixed", style: { ...LOOK_BASE, backgroundColor: "#97532d", textColor: "#ffffff", bold: true } },
];

export function matchPreset(presets: readonly Preset<number>[], value: number): string | null {
  return presets.find((preset) => preset.value === value)?.key ?? null;
}

export function matchSides(sides: BorderSides): string | null {
  return BORDER_SIDE_PRESETS.find(({ value }) => value.top === sides.top && value.right === sides.right && value.bottom === sides.bottom && value.left === sides.left)?.key ?? null;
}

export function applyLook(style: BlockStyle, look: QuickLook): BlockStyle {
  return { ...style, ...look.style };
}

export function isHardToRead(style: Pick<BlockStyle, "backgroundColor" | "textColor">, colors: Pick<ThemeColors, BlockThemeColorKey>): boolean {
  const { text, background } = effectiveBlockColors(style, colors);
  const ratio = contrastRatio(text, background);
  return ratio !== null && ratio < 4.5;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run build --workspace @scripta/shared && npm test --workspace mobile && npm run typecheck --workspace mobile`
Expected: PASS. If "every theme look is readable in every theme" fails for a theme, **don't loosen the test or change the look's colours on your own**. The spec says a failure there means a bad look definition, and that choice belongs to the user. Stop and report BLOCKED with the failing `look in theme` messages.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add mobile/src/features/murals/blockStyleOptions.ts mobile/src/features/murals/blockStyleOptions.test.ts && /usr/bin/git commit -m "Define the native block style presets and quick looks

Presets sit on the web sliders' own grids so a value picked on the
phone is one the web can show. Theme looks store palette references and
are checked readable in all eleven themes.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Style tab

**Files:**
- Modify: `mobile/src/features/library/components/StyleControls.tsx`: export `SWATCHES`, and let `SelectRow` take `value: V | null`.
- Create: `mobile/src/features/murals/StyleTab.tsx`
- Modify: `mobile/src/features/murals/MuralEditorScreen.tsx`

**Interfaces:**
- Consumes: everything from Task 8; `BLOCK_FONT_FAMILY_OPTIONS`, `BLOCK_TEXT_ALIGN_OPTIONS`, `BLOCK_INNER_SPACING_OPTIONS`, `BLOCK_THEME_COLOR_LABELS`, `resolveBlockColor` and `themeColorRef` from `@scripta/shared`; `blockFontFamily` from `../../ui/libraryStyle`; `BlockSheet`'s `style` prop and `BlockAction` (Task 6).
- Produces: `StyleTab({ style, onChange, onReset, onCopy, onPaste, canPaste }: { style: BlockStyle; onChange: (style: BlockStyle) => void; onReset: () => void; onCopy: () => void; onPaste: () => void; canPaste: boolean })`.

- [ ] **Step 1: Small `StyleControls` changes**

1. `const SWATCHES` → `export const SWATCHES`.
2. In `SelectRow`, change `value: V;` to `value: V | null;`. The `active` comparison already handles `null`, because nothing matches it.

- [ ] **Step 2: Write `StyleTab.tsx`**

```tsx
import { BLOCK_FONT_FAMILY_OPTIONS, BLOCK_INNER_SPACING_OPTIONS, BLOCK_TEXT_ALIGN_OPTIONS, BLOCK_THEME_COLOR_LABELS, resolveBlockColor, themeColorRef, type BlockStyle, type BlockThemeColorKey } from "@scripta/shared";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../ui";
import { Text } from "../../ui/Text";
import { blockFontFamily } from "../../ui/libraryStyle";
import { minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui/theme";
import { SelectRow, SWATCHES } from "../library/components/StyleControls";
import {
  BACKGROUND_FIXED_SWATCHES, BACKGROUND_THEME_SWATCHES, BORDER_SIDE_PRESETS, BORDER_STRENGTH_PRESETS, BORDER_STYLE_CHOICES, BORDER_THEME_SWATCHES,
  BORDER_WIDTH_PRESETS, CORNER_PRESETS, FADE_PRESETS, QUICK_LOOKS, SIZE_PRESETS, TEXT_THEME_SWATCHES,
  applyLook, isHardToRead, matchPreset, matchSides, type Preset, type QuickLook,
} from "./blockStyleOptions";

function Group({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={[typography.caption, styles.groupTitle, { color: colors.textDim }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Caption({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[typography.caption, { color: colors.textDim }]}>{children}</Text>;
}

function Chip({ label, selected, onPress, fontFamily }: { label: string; selected: boolean; onPress: () => void; fontFamily?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}>
      <Text style={{ color: selected ? colors.accent : colors.text, fontSize: 14, fontWeight: selected ? "700" : "500", fontFamily }}>{label}</Text>
    </Pressable>
  );
}

function Tile({ label, selected, onPress, children }: { label: string; selected: boolean; onPress: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={styles.tileWrap}>
      <View style={[styles.tile, { borderColor: selected ? colors.accent : colors.border, borderWidth: selected ? 2 : 1, backgroundColor: selected ? colors.accentSoft : colors.surface }]}>{children}</View>
      <Text style={[typography.caption, { color: colors.textDim }]}>{label}</Text>
    </Pressable>
  );
}

function PresetRow({ label, presets, value, onChange }: { label: string; presets: readonly Preset<number>[]; value: number; onChange: (value: number) => void }) {
  return <SelectRow label={label} value={matchPreset(presets, value)} options={presets.map((preset) => ({ value: preset.key, label: preset.label }))} onChange={(key) => onChange(presets.find((preset) => preset.key === key)!.value)} />;
}

function ColorRow({ label, value, defaults, themeKeys, fixed, onChange }: {
  label: string;
  value: string | null;
  defaults: Array<{ label: string; value: string | null }>;
  themeKeys: readonly BlockThemeColorKey[];
  fixed: readonly string[];
  onChange: (value: string | null) => void;
}) {
  const { colors } = useTheme();
  const current = value?.toLowerCase() ?? null;
  const swatch = (key: string, accessibilityLabel: string, fill: string, stored: string) => {
    const selected = current === stored.toLowerCase();
    return <Pressable key={key} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected }} onPress={() => onChange(stored)} style={[styles.swatch, { backgroundColor: fill, borderColor: selected ? colors.accent : colors.border, borderWidth: selected ? 3 : 1 }]} />;
  };
  return (
    <View style={styles.colorRow}>
      <Text style={[typography.body, styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <View style={styles.wrap}>{defaults.map((option) => <Chip key={option.label} label={option.label} selected={value === option.value} onPress={() => onChange(option.value)} />)}</View>
      <Caption>Theme · changes with the theme</Caption>
      <View style={styles.wrap}>{themeKeys.map((key) => swatch(key, `${BLOCK_THEME_COLOR_LABELS[key]}, theme color`, colors[key], themeColorRef(key)))}</View>
      <Caption>Fixed</Caption>
      <View style={styles.wrap}>{fixed.map((hex) => swatch(hex, `Use ${hex}`, hex, hex))}</View>
    </View>
  );
}

function LookCard({ look, onPress }: { look: QuickLook; onPress: () => void }) {
  const { colors } = useTheme();
  const { style } = look;
  const background = resolveBlockColor(style.backgroundColor, colors) ?? colors.surface;
  const text = resolveBlockColor(style.textColor, colors) ?? colors.text;
  const border = resolveBlockColor(style.cardBorderColor, colors) ?? colors.border;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Apply the ${look.label} look`} onPress={onPress} style={styles.lookWrap}>
      <View style={[styles.look, { backgroundColor: background, borderColor: style.cardBorderWidth ? border : colors.border, borderWidth: Math.max(1, style.cardBorderWidth), borderStyle: style.cardBorderWidth ? "solid" : "dashed", borderRadius: Math.min(style.cardRadius, radii.lg) }]}>
        <Text style={{ color: text, fontFamily: blockFontFamily(style.fontFamily), fontWeight: style.bold ? "700" : "400", fontSize: 16 }}>Aa</Text>
      </View>
      <Text style={[typography.caption, { color: colors.textDim }]}>{look.label}</Text>
    </Pressable>
  );
}

export function StyleTab({ style, onChange, onReset, onCopy, onPaste, canPaste }: {
  style: BlockStyle;
  onChange: (style: BlockStyle) => void;
  onReset: () => void;
  onCopy: () => void;
  onPaste: () => void;
  canPaste: boolean;
}) {
  const { colors } = useTheme();
  const set = (patch: Partial<BlockStyle>) => onChange({ ...style, ...patch });
  const looks = (group: QuickLook["group"]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.looks}>
      {QUICK_LOOKS.filter((look) => look.group === group).map((look) => <LookCard key={look.key} look={look} onPress={() => onChange(applyLook(style, look))} />)}
    </ScrollView>
  );
  return (
    <View style={styles.tab}>
      <Group title="Quick looks">
        <Caption>Theme looks change with the theme</Caption>
        {looks("theme")}
        <Caption>Fixed looks</Caption>
        {looks("fixed")}
      </Group>
      <ColorRow label="Background" value={style.backgroundColor} defaults={[{ label: "None", value: "transparent" }, { label: "Theme", value: null }]} themeKeys={BACKGROUND_THEME_SWATCHES} fixed={BACKGROUND_FIXED_SWATCHES} onChange={(backgroundColor) => set(backgroundColor === "transparent" ? { backgroundColor, cardShadow: false } : { backgroundColor })} />
      <Group title="Corners">
        <View style={styles.wrap}>
          {CORNER_PRESETS.map((preset) => (
            <Tile key={preset.key} label={preset.label} selected={style.cardRadius === preset.value} onPress={() => set({ cardRadius: preset.value })}>
              <View style={[styles.corner, { borderColor: colors.text, borderTopLeftRadius: preset.value }]} />
            </Tile>
          ))}
        </View>
      </Group>
      <Group title="Text">
        <View style={styles.wrap}>
          {BLOCK_FONT_FAMILY_OPTIONS.map((option) => <Chip key={option.value} label={option.label.replace(" (system)", "")} fontFamily={blockFontFamily(option.value)} selected={style.fontFamily === option.value} onPress={() => set({ fontFamily: option.value })} />)}
        </View>
        <PresetRow label="Size" presets={SIZE_PRESETS} value={style.fontSize} onChange={(fontSize) => set({ fontSize })} />
        <View style={styles.wrap}>
          <Chip label="Bold" selected={style.bold} onPress={() => set({ bold: !style.bold })} />
          <Chip label="Italic" selected={style.italic} onPress={() => set({ italic: !style.italic })} />
          <Chip label="Code" selected={style.codeStyle} onPress={() => set({ codeStyle: !style.codeStyle })} />
        </View>
        <SelectRow label="Alignment" value={style.textAlign} options={BLOCK_TEXT_ALIGN_OPTIONS} onChange={(textAlign) => set({ textAlign })} />
        <ColorRow label="Text color" value={style.textColor} defaults={[{ label: "Auto", value: null }]} themeKeys={TEXT_THEME_SWATCHES} fixed={SWATCHES} onChange={(textColor) => set({ textColor })} />
        {isHardToRead(style, colors) ? <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.danger }]}>Hard to read on this background</Text> : null}
      </Group>
      <Group title="Border">
        <PresetRow label="Width" presets={BORDER_WIDTH_PRESETS} value={style.cardBorderWidth} onChange={(cardBorderWidth) => set({ cardBorderWidth })} />
        {style.cardBorderWidth > 0 ? <>
          <SelectRow label="Style" value={BORDER_STYLE_CHOICES.some((choice) => choice.value === style.cardBorderStyle) ? style.cardBorderStyle : null} options={BORDER_STYLE_CHOICES} onChange={(cardBorderStyle) => set({ cardBorderStyle })} />
          <PresetRow label="Strength" presets={BORDER_STRENGTH_PRESETS} value={style.cardBorderOpacity} onChange={(cardBorderOpacity) => set({ cardBorderOpacity })} />
          <Text style={[typography.body, styles.rowLabel, { color: colors.text }]}>Sides</Text>
          <View style={styles.wrap}>
            {BORDER_SIDE_PRESETS.map((preset) => {
              const edge = (on: boolean) => (on ? colors.text : colors.border);
              return (
                <Tile key={preset.key} label={preset.label} selected={matchSides(style.cardBorderSides) === preset.key} onPress={() => set({ cardBorderSides: preset.value })}>
                  <View style={[styles.sides, { borderTopColor: edge(preset.value.top), borderRightColor: edge(preset.value.right), borderBottomColor: edge(preset.value.bottom), borderLeftColor: edge(preset.value.left) }]} />
                </Tile>
              );
            })}
          </View>
          <ColorRow label="Border color" value={style.cardBorderColor} defaults={[{ label: "Auto", value: null }]} themeKeys={BORDER_THEME_SWATCHES} fixed={SWATCHES} onChange={(cardBorderColor) => set({ cardBorderColor })} />
        </> : null}
      </Group>
      <SelectRow label="Shadow" value={style.cardShadow ? "soft" : "none"} options={[{ value: "none", label: "None" }, { value: "soft", label: "Soft" }]} onChange={(value) => set({ cardShadow: value === "soft" })} />
      <PresetRow label="Fade" presets={FADE_PRESETS} value={style.cardOpacity} onChange={(cardOpacity) => set({ cardOpacity })} />
      <SelectRow label="Inner spacing" value={style.innerSpacing} options={BLOCK_INNER_SPACING_OPTIONS} onChange={(innerSpacing) => set({ innerSpacing })} />
      <View style={styles.footer}>
        <Button label="Reset" variant="secondary" onPress={onReset} />
        <Button label="Copy style" variant="secondary" onPress={onCopy} />
        <Button label="Paste style" variant="secondary" disabled={!canPaste} onPress={onPaste} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: { gap: spacing.xl },
  group: { gap: spacing.sm },
  groupTitle: { fontWeight: "700", letterSpacing: 0.4 },
  rowLabel: { fontWeight: "600" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: minimumTouchTarget, justifyContent: "center", borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md },
  tileWrap: { alignItems: "center", gap: spacing.xs },
  tile: { width: 64, height: 48, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  corner: { width: 36, height: 26, borderTopWidth: 2, borderLeftWidth: 2 },
  sides: { width: 32, height: 22, borderWidth: 2 },
  colorRow: { gap: spacing.sm },
  swatch: { width: minimumTouchTarget, height: minimumTouchTarget, borderRadius: radii.full },
  looks: { gap: spacing.sm },
  lookWrap: { alignItems: "center", gap: spacing.xs },
  look: { width: 64, height: 44, alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
```

- [ ] **Step 3: Wire the tab and the Style action into the editor**

In `MuralEditorScreen.tsx`:

1. Add state: `const [copiedStyle, setCopiedStyle] = useState<BlockStyle | null>(null);`.
2. Add imports:
   - `StyleTab` from `./StyleTab`.
   - `resolveBlockStyle` and `type BlockStyle` from `@scripta/shared`.
3. In `blockActions`, insert this right after the Edit entry:

```tsx
{ key: "style", label: "Style", icon: "style", onPress: () => setSheetTab("style") },
```

4. Replace `style={null}` on `BlockSheet` with:

```tsx
style={selected ? <StyleTab
  style={resolveBlockStyle(selected.style)}
  onChange={(style) => updateSelected((block) => ({ ...block, style }))}
  onReset={() => updateSelected((block) => { const next = { ...block }; delete next.style; return next; })}
  onCopy={() => setCopiedStyle(resolveBlockStyle(selected.style))}
  onPaste={() => { if (copiedStyle) updateSelected((block) => ({ ...block, style: copiedStyle })); }}
  canPaste={copiedStyle !== null}
/> : null}
```

- [ ] **Step 4: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS. The existing library style screens that use `SelectRow` still typecheck, because widening `value` to `V | null` is compatible.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add mobile/src/features/library/components/StyleControls.tsx mobile/src/features/murals/StyleTab.tsx mobile/src/features/murals/MuralEditorScreen.tsx && /usr/bin/git commit -m "Add a friendly Style tab to native mural blocks

Pictures and named presets replace pixel steppers; colours offer theme
swatches that follow each viewer's theme beside fixed ones. Values set
on web that no preset matches stay put and simply show nothing
selected, so a phone edit never quietly rewrites them.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Full verification and device pass

**Files:** none, unless the device pass finds a defect. A defect found here gets fixed in the file that owns it, with its own commit.

- [ ] **Step 1: Run every check**

```bash
npm run build --workspace @scripta/shared && npm run typecheck --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend
```

Expected: every command PASSES. Report the output. Don't summarise it as "all green" without the output.

- [ ] **Step 2: Check the emulator lease**

Run: `node scripts/dev-status.mjs --json`. If another worktree holds the emulator, skip Step 3 and say so in the report. Don't wait, retry, take the lease or start a second emulator.

- [ ] **Step 3: Device pass (UI only)**

Follow `docs/dev-workflow.md` and `node scripts/dev-emulator.mjs`. Never write the dev database directly. Using the seeded account, open a mural and check:

1. Tap a block: the bar shows Done · Edit · Style · Size · Copy · Delete, and no sheet opens. Tap empty canvas: the block is deselected.
2. **Edit:** the sheet opens on Content with the preview at the top. Open the book picker and close it: you're back on the block sheet on the same tab.
3. **Text block, Body field:** type with the keyboard up, and confirm the field stays visible. Do the same for a Profile block's Bio.
4. **Size:** widen a block until another block is in the way, and confirm the reason line shows. Widen a block at the right edge, and confirm "Reached the edge of the mural".
5. **Style:** apply each theme look, then switch the app theme (light → dark → Matrix) and confirm the theme looks re-colour. Apply a fixed look and confirm it doesn't re-colour.
6. Border **Sides** "Top & bottom" draws only those edges on the canvas.
7. **Copy style** on one block, then **Paste style** on another. **Reset** returns the defaults.
8. **Copy** selects the copy. **Delete** removes the block and shows Add block / Share again.
9. With TalkBack on, the block's actions menu lists Move left / right / up / down, and a blocked move announces "Can't move there".

Capture a screenshot of the bar, the Content tab and the Style tab for the report.
