// The data half (types, defaults, ranges, priority-resolution functions)
// moved to packages/shared/src/library/libraryStyle.ts (Task 3A) — see
// that file's own top comment. Re-exported here so every existing
// `from "./lib/libraryStyle"` import keeps working unchanged.
//
// Three functions stay HERE, by name, not in the shared package:
// `cardFontFamilyCss` and `blockFontFamilyCss` return comma-joined CSS
// font stacks, and `resolveBorderColor` returns `var(--color-border)` /
// `color-mix(in srgb, ...)` strings — all three only mean something to a
// CSS renderer. React Native takes a single font family and has neither
// `var()` nor `color-mix()`; Task 4D builds its own equivalents rather
// than reusing these.

import { BLOCK_FONT_FAMILY_OPTIONS, CARD_FONT_FAMILY_OPTIONS, type BlockFontFamily, type CardFontFamily } from "@scripta/shared";

export type {
  CardAspectRatio,
  CardBorderStyle,
  CardFontFamily,
  BorderSides,
  LibraryStyleSettings,
  PerCardStyle,
  BlockFontFamily,
  BlockStyle
} from "@scripta/shared";

export {
  CARD_FONT_FAMILY_OPTIONS,
  CARD_FONT_SIZE_RANGE,
  DEFAULT_BORDER_SIDES,
  DEFAULT_LIBRARY_STYLE,
  CARD_MIN_WIDTH_RANGE,
  CARD_GAP_RANGE,
  CARD_RADIUS_RANGE,
  CARD_BORDER_WIDTH_RANGE,
  CARD_BORDER_OPACITY_RANGE,
  CARD_OPACITY_RANGE,
  CARD_BORDER_STYLE_OPTIONS,
  OVERLAY_INTENSITY_RANGE,
  CONTENT_MAX_WIDTH_RANGE,
  CONTENT_PADDING_RANGE,
  CARD_ASPECT_RATIO_OPTIONS,
  resolveLibraryStyle,
  PER_CARD_STYLE_KEYS,
  extractPerCardStyle,
  resolvePerCardStyle,
  BLOCK_FONT_FAMILY_OPTIONS,
  BLOCK_FONT_SIZE_RANGE,
  DEFAULT_BLOCK_STYLE,
  resolveBlockStyle,
  CARD_OVERLAY_TEXT_MIN_WIDTH,
  CARD_OVERLAY_COMPACT_WIDTH,
  PHONE_COLUMNS_AT_DEFAULT_SIZE,
  PHONE_GRID_BREAKPOINT,
  effectiveCardStyle
} from "@scripta/shared";

/** Resolves a CardFontFamily value to its real CSS `font-family` stack —
 *  used wherever a card's style is actually applied (BookCard.tsx), not
 *  by the picker itself. Falls back to the first option for any
 *  unrecognized value, same reasoning as blockFontFamilyCss below. */
export function cardFontFamilyCss(value: CardFontFamily): string {
  return CARD_FONT_FAMILY_OPTIONS.find((o) => o.value === value)?.css ?? CARD_FONT_FAMILY_OPTIONS[0].css;
}

/** Resolves a BlockFontFamily value to its real CSS `font-family` stack —
 *  used wherever a block's style is actually applied (MuralCanvas.tsx),
 *  not by the picker itself (StyleControls.tsx's select just stores the
 *  short key). Falls back to the first option for any unrecognized value
 *  (hand-edited data, a future removed option) rather than rendering with
 *  no font-family at all. */
export function blockFontFamilyCss(value: BlockFontFamily): string {
  return BLOCK_FONT_FAMILY_OPTIONS.find((o) => o.value === value)?.css ?? BLOCK_FONT_FAMILY_OPTIONS[0].css;
}

/** Applies `cardBorderOpacity` on top of `cardBorderColor` — kept as two
 *  independent settings so a chosen color can be faded without re-picking
 *  it, and so the theme-default border still has an opacity knob even
 *  though there's no literal color value to fade (`color-mix()` handles
 *  that case; an explicit hex color converts to `rgba()` instead, since
 *  `<input type="color">` itself can't carry alpha). Opacity 100 skips
 *  the math entirely — returns the plain color/CSS-var, unchanged. Used
 *  by BookCard.tsx's border and directly unit-tested (see
 *  scripts/test-library-style.mts) since it's the one non-trivial bit of
 *  string math in this whole settings feature. */
export function resolveBorderColor(color: string | null, opacityPercent: number): string {
  if (opacityPercent >= 100) return color ?? "var(--color-border)";
  if (!color) return `color-mix(in srgb, var(--color-border) ${opacityPercent}%, transparent)`;
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return color; // not a hex color we can parse — fall back as-is
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacityPercent / 100})`;
}
