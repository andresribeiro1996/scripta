import { fontFileName, fonts, type FontId, type FontSlot, type FontWeight } from "@scripta/shared/themes";

export const DISPLAY_MIN_FONT_SIZE = 18;
const DEFAULT_FONT_SIZE = 14;

export const STYLE_FONT_FAMILIES = {
  playfairDisplay: "playfair-400",
  inter: "inter-400",
  jetbrainsMono: "jetbrainsMono-400",
} as const;

export type FontStyleInput = { fontFamily?: string; fontWeight?: string | number; fontSize?: number; lineHeight?: number };

export function slotFor(fontSize?: number, display?: boolean): FontSlot {
  if (display !== undefined) return display ? "display" : "text";
  return (fontSize ?? DEFAULT_FONT_SIZE) >= DISPLAY_MIN_FONT_SIZE ? "display" : "text";
}

function numericWeight(weight: string | number | undefined): number {
  if (weight === "bold") return 700;
  return Number(weight) || 400;
}

export function fontStyleFor(font: FontId, slot: FontSlot, style: FontStyleInput): { fontFamily: string; fontWeight: "normal" | "700"; fontSize?: number; lineHeight?: number } | null {
  if (Object.values(STYLE_FONT_FAMILIES).some((family) => family === style.fontFamily)) {
    const bold = numericWeight(style.fontWeight) >= 600;
    const family = style.fontFamily!;
    return { fontFamily: bold && family !== "inter-400" ? family.replace("-400", "-700") : family, fontWeight: bold && family === "inter-400" ? "700" : "normal" };
  }
  const definition = fonts[font];
  if (style.fontFamily || !definition.family) return null;
  const heaviest = Math.max(...definition.weights) as FontWeight;
  const lightest = Math.min(...definition.weights) as FontWeight;
  const weight = slot === "display" || numericWeight(style.fontWeight) >= 600 ? heaviest : lightest;
  const result: { fontFamily: string; fontWeight: "normal" | "700"; fontSize?: number; lineHeight?: number } = { fontFamily: fontFileName(font, weight), fontWeight: "normal" };
  if (definition.scale !== 1) {
    result.fontSize = Math.round((style.fontSize ?? DEFAULT_FONT_SIZE) * definition.scale);
    if (style.lineHeight) result.lineHeight = Math.round(style.lineHeight * definition.scale);
  }
  return result;
}
