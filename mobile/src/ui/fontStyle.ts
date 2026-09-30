import { fontFileName, fonts, type FontId, type FontSlot, type FontWeight } from "@scripta/shared/themes";

export const DISPLAY_MIN_FONT_SIZE = 18;
const DEFAULT_FONT_SIZE = 14;

export type FontStyleInput = { fontFamily?: string; fontWeight?: string | number; fontSize?: number; lineHeight?: number };

export function slotFor(fontSize?: number, display?: boolean): FontSlot {
  if (display !== undefined) return display ? "display" : "text";
  return (fontSize ?? DEFAULT_FONT_SIZE) >= DISPLAY_MIN_FONT_SIZE ? "display" : "text";
}

function numericWeight(weight: string | number | undefined): number {
  if (weight === "bold") return 700;
  return Number(weight) || 400;
}

export function fontStyleFor(font: FontId, slot: FontSlot, style: FontStyleInput): { fontFamily: string; fontWeight: "normal"; fontSize?: number; lineHeight?: number } | null {
  const definition = fonts[font];
  if (style.fontFamily || !definition.family) return null;
  const heaviest = Math.max(...definition.weights) as FontWeight;
  const lightest = Math.min(...definition.weights) as FontWeight;
  const weight = slot === "display" || numericWeight(style.fontWeight) >= 600 ? heaviest : lightest;
  const result: { fontFamily: string; fontWeight: "normal"; fontSize?: number; lineHeight?: number } = { fontFamily: fontFileName(font, weight), fontWeight: "normal" };
  if (definition.scale !== 1) {
    result.fontSize = Math.round((style.fontSize ?? DEFAULT_FONT_SIZE) * definition.scale);
    if (style.lineHeight) result.lineHeight = Math.round(style.lineHeight * definition.scale);
  }
  return result;
}
