import { DEFAULT_BORDER_SIDES, contrastRatio, effectiveBlockColors, normalizeHexColor, resolveBlockColor, themeColorRef, type BlockStyle, type BlockThemeColorKey, type BorderSides, type CardBorderStyle } from "@scripta/shared";
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

export const COLOR_LOOK_FIELDS = ["backgroundColor", "textColor", "cardBorderColor"] as const;
export const FRAME_LOOK_FIELDS = ["cardRadius", "cardBorderWidth", "cardBorderStyle", "cardBorderOpacity", "cardBorderSides", "cardShadow"] as const;

export type ColorLook = { key: string; label: string; style: Pick<BlockStyle, (typeof COLOR_LOOK_FIELDS)[number]> & Partial<Pick<BlockStyle, "cardShadow">> };
export type FrameLook = { key: string; label: string; style: Pick<BlockStyle, (typeof FRAME_LOOK_FIELDS)[number]> };
export type Look = ColorLook | FrameLook;

export const COLOR_LOOKS: ColorLook[] = [
  { key: "theme", label: "Theme", style: { backgroundColor: null, textColor: null, cardBorderColor: null } },
  { key: "clear", label: "Clear", style: { backgroundColor: "transparent", textColor: null, cardBorderColor: null, cardShadow: false } },
  { key: "tinted", label: "Tinted", style: { backgroundColor: themeColorRef("accentSoft"), textColor: null, cardBorderColor: null } },
  { key: "accent", label: "Accent", style: { backgroundColor: themeColorRef("accent"), textColor: themeColorRef("onAccent"), cardBorderColor: null } },
  { key: "parchment", label: "Parchment", style: { backgroundColor: "#f6efe3", textColor: "#201e1c", cardBorderColor: null } },
  { key: "note", label: "Note", style: { backgroundColor: "#fff3b0", textColor: "#201e1c", cardBorderColor: null } },
  { key: "ink", label: "Ink", style: { backgroundColor: "#201e1c", textColor: "#f2f0ec", cardBorderColor: null } },
  { key: "clay", label: "Clay", style: { backgroundColor: "#97532d", textColor: "#ffffff", cardBorderColor: null } },
];

const frameLook = (key: string, label: string, cardBorderWidth: number, cardShadow: boolean): FrameLook => ({
  key,
  label,
  style: { cardRadius: 12, cardBorderWidth, cardBorderStyle: "solid", cardBorderOpacity: 100, cardBorderSides: DEFAULT_BORDER_SIDES, cardShadow },
});

export const FRAME_LOOKS: FrameLook[] = [
  frameLook("card", "Card", 0, true),
  frameLook("framed", "Framed", 1, true),
  frameLook("flat", "Flat", 0, false),
  frameLook("outline", "Outline", 3, false),
];

export function matchPreset(presets: readonly Preset<number>[], value: number): string | null {
  return presets.find((preset) => preset.value === value)?.key ?? null;
}

export function matchSides(sides: BorderSides): string | null {
  return BORDER_SIDE_PRESETS.find(({ value }) => value.top === sides.top && value.right === sides.right && value.bottom === sides.bottom && value.left === sides.left)?.key ?? null;
}

export function applyLook(style: BlockStyle, look: Look): BlockStyle {
  return { ...style, ...look.style };
}

export function isHardToRead(style: Pick<BlockStyle, "backgroundColor" | "textColor">, colors: Pick<ThemeColors, BlockThemeColorKey>): boolean {
  const { text, background } = effectiveBlockColors(style, colors);
  const ratio = contrastRatio(text, background);
  return ratio !== null && ratio < 4.5;
}

export function selectionBorderColor(style: Pick<BlockStyle, "backgroundColor" | "cardBorderColor">, colors: Pick<ThemeColors, BlockThemeColorKey>): string {
  const isAccent = (value: string | null) => resolveBlockColor(value, colors)?.toLowerCase() === colors.accent.toLowerCase();
  return isAccent(style.backgroundColor) || isAccent(style.cardBorderColor) ? colors.text : colors.accent;
}

export type CustomColorTarget = "backgroundColor" | "textColor" | "cardBorderColor";

export function customColorStart(target: CustomColorTarget, style: Pick<BlockStyle, CustomColorTarget>, palette: Pick<ThemeColors, BlockThemeColorKey | "border">): string {
  const { text, background } = effectiveBlockColors(style, palette);
  const start = target === "backgroundColor" ? background : target === "textColor" ? text : resolveBlockColor(style.cardBorderColor, palette) ?? palette.border;
  return normalizeHexColor(start) ?? palette.text;
}
