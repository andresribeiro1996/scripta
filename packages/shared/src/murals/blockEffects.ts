import type { BlockStyle } from "../library/libraryStyle.js";
import type { ThemeColors } from "../themes/palettes.js";
import { parseHexColor, resolveBlockColor, type BlockThemeColorKey } from "./blockTextColors.js";

export function blockEffects(style: BlockStyle, palette: Pick<ThemeColors, BlockThemeColorKey>) {
  const rgb = parseHexColor(resolveBlockColor(style.shadowColor, palette) ?? "#000000") ?? { r: 0, g: 0, b: 0 };
  const enabled = style.cardShadow && style.backgroundColor !== "transparent";
  const shadow = (scale: number) => enabled ? `0 ${style.shadowOffsetY * scale}px ${style.shadowBlur * scale}px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(1, style.shadowOpacity * scale / 100)})` : "none";
  const color = resolveBlockColor(style.fadeColor, palette);
  const fadeColor = color && parseHexColor(color) ? color : null;
  const opacity = Number.isFinite(style.cardOpacity) ? Math.max(0, Math.min(100, style.cardOpacity)) / 100 : 1;
  return {
    boxShadow: shadow(1),
    hoverShadow: shadow(2),
    opacity: fadeColor ? 1 : opacity,
    fadeColor,
    fadeOpacity: fadeColor ? 1 - opacity : 0,
  };
}
