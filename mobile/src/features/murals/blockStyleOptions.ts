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
