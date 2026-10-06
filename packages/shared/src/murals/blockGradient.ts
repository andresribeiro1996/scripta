import type { BlockStyle } from "../library/libraryStyle.js";
import type { ThemeColors } from "../themes/palettes.js";
import { normalizeHexColor, parseHexColor, resolveBlockColor, toHex, type BlockThemeColorKey } from "./blockTextColors.js";

export function blockGradient(style: Pick<BlockStyle, "backgroundColor" | "gradientColor" | "gradientAngle" | "gradientStrength">, palette: Pick<ThemeColors, BlockThemeColorKey>) {
  if (!style.gradientColor || style.backgroundColor === "transparent") return null;
  const start = normalizeHexColor(resolveBlockColor(style.backgroundColor, palette) ?? palette.surface);
  const end = parseHexColor(resolveBlockColor(style.gradientColor, palette) ?? "");
  if (!start || !end) return null;
  const base = parseHexColor(start)!;
  const strength = style.gradientStrength / 100;
  return {
    image: `linear-gradient(${style.gradientAngle}deg, ${start}, rgba(${end.r}, ${end.g}, ${end.b}, ${strength}))`,
    endColor: toHex({ r: base.r * (1 - strength) + end.r * strength, g: base.g * (1 - strength) + end.g * strength, b: base.b * (1 - strength) + end.b * strength }),
  };
}
