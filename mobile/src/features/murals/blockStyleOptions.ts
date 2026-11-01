import { DEFAULT_BORDER_SIDES, blockGradient, cardBorderStyleOptions, contrastRatio, effectiveBlockColors, normalizeHexColor, resolveBlockColor, themeColorRef, type BlockStyle, type BlockThemeColorKey, type BorderSides, type CardBorderStyle } from "@scripta/shared";
import type { Locale } from "@scripta/shared/i18n";
import type { ThemeColors } from "@scripta/shared/themes";
import { translatorFor, type MessageKey } from "../../i18n";

export type Preset<T> = { key: string; label: string; value: T };
export type PresetSpec<T> = { key: string; labelKey: MessageKey; value: T };

export function presetOptions<T>(presets: readonly PresetSpec<T>[], locale: Locale): Preset<T>[] {
  const t = translatorFor(locale);
  return presets.map(({ key, labelKey, value }) => ({ key, label: t(labelKey), value }));
}

export const CORNER_PRESETS: PresetSpec<number>[] = [
  { key: "square", labelKey: "murals.cornerSquare", value: 0 },
  { key: "slight", labelKey: "murals.cornerSlight", value: 4 },
  { key: "rounded", labelKey: "murals.cornerRounded", value: 12 },
  { key: "round", labelKey: "murals.cornerRound", value: 24 },
];

export const SIZE_PRESETS: Preset<number>[] = [
  { key: "s", label: "S", value: 12 },
  { key: "m", label: "M", value: 14 },
  { key: "l", label: "L", value: 17 },
  { key: "xl", label: "XL", value: 20 },
];

export const BORDER_WIDTH_PRESETS: PresetSpec<number>[] = [
  { key: "none", labelKey: "library.none", value: 0 },
  { key: "thin", labelKey: "murals.presetThin", value: 1 },
  { key: "thick", labelKey: "murals.presetThick", value: 3 },
];

export const BORDER_STRENGTH_PRESETS: PresetSpec<number>[] = [
  { key: "faint", labelKey: "murals.presetFaint", value: 40 },
  { key: "medium", labelKey: "murals.presetMedium", value: 72 },
  { key: "solid", labelKey: "murals.presetSolid", value: 100 },
];

export const FADE_PRESETS: PresetSpec<number>[] = [
  { key: "none", labelKey: "murals.presetNone", value: 100 },
  { key: "light", labelKey: "murals.presetLight", value: 72 },
  { key: "strong", labelKey: "murals.presetStrong", value: 40 },
];

export const SHADOW_STRENGTH_PRESETS: PresetSpec<number>[] = [
  { key: "soft", labelKey: "library.soft", value: 12 },
  { key: "medium", labelKey: "murals.presetMedium", value: 24 },
  { key: "strong", labelKey: "murals.presetStrong", value: 40 },
];

export const SHADOW_BLUR_PRESETS: PresetSpec<number>[] = [
  { key: "sharp", labelKey: "murals.presetSharp", value: 0 },
  { key: "soft", labelKey: "library.soft", value: 4 },
  { key: "diffuse", labelKey: "murals.presetDiffuse", value: 12 },
];

export const SHADOW_DISTANCE_PRESETS: PresetSpec<number>[] = [
  { key: "none", labelKey: "library.none", value: 0 },
  { key: "near", labelKey: "murals.presetNear", value: 2 },
  { key: "far", labelKey: "murals.presetFar", value: 8 },
];

export const GRADIENT_DIRECTION_PRESETS: PresetSpec<number>[] = [
  { key: "up", labelKey: "murals.directionUp", value: 0 },
  { key: "right", labelKey: "murals.directionRight", value: 90 },
  { key: "down", labelKey: "murals.directionDown", value: 180 },
  { key: "diagonal", labelKey: "murals.directionDiagonal", value: 135 },
];

export const GRADIENT_STRENGTH_PRESETS: PresetSpec<number>[] = [
  { key: "subtle", labelKey: "library.subtle", value: 25 },
  { key: "medium", labelKey: "murals.presetMedium", value: 50 },
  { key: "full", labelKey: "murals.presetFull", value: 100 },
];

export const BORDER_SIDE_PRESETS: PresetSpec<BorderSides>[] = [
  { key: "all", labelKey: "murals.sidesAll", value: DEFAULT_BORDER_SIDES },
  { key: "topBottom", labelKey: "murals.sidesTopBottom", value: { top: true, right: false, bottom: true, left: false } },
  { key: "leftRight", labelKey: "murals.sidesLeftRight", value: { top: false, right: true, bottom: false, left: true } },
  { key: "bottom", labelKey: "murals.sidesBottomOnly", value: { top: false, right: false, bottom: true, left: false } },
  { key: "left", labelKey: "murals.sidesLeftOnly", value: { top: false, right: false, bottom: false, left: true } },
];

const SUPPORTED_BORDER_STYLES: readonly CardBorderStyle[] = ["solid", "dashed", "dotted"];

export const borderStyleChoices = (locale: Locale) => cardBorderStyleOptions(locale).filter(({ value }) => SUPPORTED_BORDER_STYLES.includes(value));

export const BACKGROUND_THEME_SWATCHES: BlockThemeColorKey[] = ["background", "accentSoft", "accentFill", "accent"];
export const TEXT_THEME_SWATCHES: BlockThemeColorKey[] = ["accent", "onAccent"];
export const BORDER_THEME_SWATCHES: BlockThemeColorKey[] = ["accent", "text"];
export const BACKGROUND_FIXED_SWATCHES = ["#ffffff", "#f1e2d8", "#e4efdf", "#dcebf2", "#ebe4f3", "#fff3b0", "#201e1c"];

export const COLOR_LOOK_FIELDS = ["backgroundColor", "textColor", "cardBorderColor"] as const;
export const FRAME_LOOK_FIELDS = ["cardRadius", "cardBorderWidth", "cardBorderStyle", "cardBorderOpacity", "cardBorderSides", "cardShadow"] as const;

export type ColorLook = { key: string; labelKey: MessageKey; style: Pick<BlockStyle, (typeof COLOR_LOOK_FIELDS)[number]> & Partial<Pick<BlockStyle, "cardShadow">> };
export type FrameLook = { key: string; labelKey: MessageKey; style: Pick<BlockStyle, (typeof FRAME_LOOK_FIELDS)[number]> };
export type Look = ColorLook | FrameLook;

export const COLOR_LOOKS: ColorLook[] = [
  { key: "theme", labelKey: "settings.theme", style: { backgroundColor: null, textColor: null, cardBorderColor: null } },
  { key: "clear", labelKey: "murals.lookClear", style: { backgroundColor: "transparent", textColor: null, cardBorderColor: null, cardShadow: false } },
  { key: "tinted", labelKey: "murals.lookTinted", style: { backgroundColor: themeColorRef("accentSoft"), textColor: null, cardBorderColor: null } },
  { key: "accent", labelKey: "murals.lookAccent", style: { backgroundColor: themeColorRef("accent"), textColor: themeColorRef("onAccent"), cardBorderColor: null } },
  { key: "parchment", labelKey: "murals.lookParchment", style: { backgroundColor: "#f6efe3", textColor: "#201e1c", cardBorderColor: null } },
  { key: "note", labelKey: "murals.note", style: { backgroundColor: "#fff3b0", textColor: "#201e1c", cardBorderColor: null } },
  { key: "ink", labelKey: "murals.lookInk", style: { backgroundColor: "#201e1c", textColor: "#f2f0ec", cardBorderColor: null } },
  { key: "clay", labelKey: "murals.lookClay", style: { backgroundColor: "#97532d", textColor: "#ffffff", cardBorderColor: null } },
  { key: "sage", labelKey: "murals.lookSage", style: { backgroundColor: "#e4efdf", textColor: "#263729", cardBorderColor: null } },
  { key: "seaGlass", labelKey: "murals.lookSeaGlass", style: { backgroundColor: "#dcebf2", textColor: "#223943", cardBorderColor: null } },
  { key: "lilac", labelKey: "murals.lookLilac", style: { backgroundColor: "#ebe4f3", textColor: "#3b2b4b", cardBorderColor: null } },
  { key: "rose", labelKey: "murals.lookRose", style: { backgroundColor: "#f3e0e5", textColor: "#4b2932", cardBorderColor: null } },
  { key: "ochre", labelKey: "murals.lookOchre", style: { backgroundColor: "#f4e4b9", textColor: "#4a3515", cardBorderColor: null } },
];

const frameLook = (key: string, labelKey: MessageKey, cardBorderWidth: number, cardShadow: boolean, cardRadius = 12, cardBorderSides = DEFAULT_BORDER_SIDES): FrameLook => ({
  key,
  labelKey,
  style: { cardRadius, cardBorderWidth, cardBorderStyle: "solid", cardBorderOpacity: 100, cardBorderSides, cardShadow },
});

export const FRAME_LOOKS: FrameLook[] = [
  frameLook("card", "murals.lookCard", 0, true),
  frameLook("framed", "murals.lookFramed", 1, true),
  frameLook("flat", "murals.lookFlat", 0, false),
  frameLook("outline", "murals.lookOutline", 3, false),
  frameLook("bookplate", "murals.lookBookplate", 1, false, 4),
  frameLook("marginNote", "murals.lookMarginNote", 3, false, 0, { top: false, right: false, bottom: false, left: true }),
];

export function matchPreset(presets: readonly { key: string; value: number }[], value: number): string | null {
  return presets.find((preset) => preset.value === value)?.key ?? null;
}

export function matchSides(sides: BorderSides): string | null {
  return BORDER_SIDE_PRESETS.find(({ value }) => value.top === sides.top && value.right === sides.right && value.bottom === sides.bottom && value.left === sides.left)?.key ?? null;
}

export function applyLook(style: BlockStyle, look: Look): BlockStyle {
  return { ...style, ...look.style };
}

export function isHardToRead(style: Pick<BlockStyle, "backgroundColor" | "textColor"> & Partial<Pick<BlockStyle, "gradientColor" | "gradientAngle" | "gradientStrength">>, colors: Pick<ThemeColors, BlockThemeColorKey>): boolean {
  const { text, background } = effectiveBlockColors(style, colors);
  const ratio = contrastRatio(text, background);
  const gradient = blockGradient({ backgroundColor: style.backgroundColor, gradientColor: style.gradientColor ?? null, gradientAngle: style.gradientAngle ?? 135, gradientStrength: style.gradientStrength ?? 100 }, colors);
  const endRatio = gradient ? contrastRatio(text, gradient.endColor) : null;
  return ratio !== null && ratio < 4.5 || endRatio !== null && endRatio < 4.5;
}

export function selectionBorderColor(style: Pick<BlockStyle, "backgroundColor" | "cardBorderColor">, colors: Pick<ThemeColors, BlockThemeColorKey>): string {
  const isAccent = (value: string | null) => resolveBlockColor(value, colors)?.toLowerCase() === colors.accent.toLowerCase();
  return isAccent(style.backgroundColor) || isAccent(style.cardBorderColor) ? colors.text : colors.accent;
}

export type CustomColorTarget = "backgroundColor" | "textColor" | "cardBorderColor" | "shadowColor" | "fadeColor" | "gradientColor";

export function customColorStart(target: CustomColorTarget, style: Pick<BlockStyle, "backgroundColor" | "textColor" | "cardBorderColor"> & Partial<Pick<BlockStyle, "shadowColor" | "fadeColor" | "gradientColor">>, palette: Pick<ThemeColors, BlockThemeColorKey | "border">): string {
  const { text, background } = effectiveBlockColors(style, palette);
  const fallback = target === "shadowColor" ? "#000000" : target === "fadeColor" ? palette.background : target === "gradientColor" ? palette.accent : palette.border;
  const start = target === "backgroundColor" ? background : target === "textColor" ? text : resolveBlockColor(style[target] ?? null, palette) ?? fallback;
  return normalizeHexColor(start) ?? palette.text;
}
