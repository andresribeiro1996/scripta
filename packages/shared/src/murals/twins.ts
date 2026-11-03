import type { BlockStyle } from "../library/libraryStyle.js";
import { THEME_CONTRAST_PAIRS, themes, type ThemeColors, type ThemeId, type ThemeScheme } from "../themes/palettes.js";
import { contrastRatio, effectiveBlockColors, parseHexColor, toHex } from "./blockTextColors.js";

type Oklch = readonly [number, number, number];

const GROUND_ROLES = new Set<keyof ThemeColors>([
  "background",
  "surface",
  "surfacePressed",
  "border",
  "accentSoft",
  "dangerSoft",
  "successSoft",
  "infoSoft",
  "referenceSoft",
  "accentFill",
]);

const MIN_GROUND_CHROMA = 0.045;
const GAMUT_CHECKS = 40;
const GAMUT_CHROMA_STEP = 0.92;
const GAMUT_TOLERANCE = 0.001;
const NUDGE_PASSES = 3;
const NUDGE_STEPS = 60;
const NUDGE_STEP = 0.01;
const NUDGE_TARGET = 4.6;
const BLOCK_TEXT_TARGET = 4.5;
const BLOCK_TEXT_STEPS = 100;
const BLOCK_COLOR_FIELDS = ["backgroundColor", "textColor", "gradientColor", "cardBorderColor", "fadeColor"] as const;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklch(hex: string): Oklch {
  const rgb = parseHexColor(hex)!;
  const r = toLinear(rgb.r / 255);
  const g = toLinear(rgb.g / 255);
  const b = toLinear(rgb.b / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, bb), Math.atan2(bb, a)];
}

function oklchToSrgb([lightness, chroma, hue]: Oklch): [number, number, number] {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function srgbToHex([r, g, b]: readonly number[]): string {
  return toHex({ r: r! * 255, g: g! * 255, b: b! * 255 });
}

function fromOklch([lightness, chroma, hue]: Oklch): string {
  let c = chroma;
  for (let i = 0; i < GAMUT_CHECKS; i++) {
    const rgb = oklchToSrgb([lightness, c, hue]);
    if (rgb.every((v) => v >= -GAMUT_TOLERANCE && v <= 1 + GAMUT_TOLERANCE)) return srgbToHex(rgb);
    c *= GAMUT_CHROMA_STEP;
  }
  return srgbToHex(oklchToSrgb([lightness, 0, hue]));
}

function nudgeContrast(colors: ThemeColors): void {
  for (let pass = 0; pass < NUDGE_PASSES; pass++) {
    for (const [fg, bg] of THEME_CONTRAST_PAIRS) {
      let [lightness, chroma, hue] = toOklch(colors[fg]);
      const away = contrastRatio(colors[bg], "#000000")! > NUDGE_TARGET ? -1 : 1;
      for (let i = 0; i < NUDGE_STEPS && contrastRatio(colors[fg], colors[bg])! < NUDGE_TARGET; i++) {
        lightness += away * NUDGE_STEP;
        colors[fg] = fromOklch([lightness, chroma, hue]);
      }
    }
  }
}

function generateTwin(id: ThemeId): ThemeColors {
  const source = themes[id].colors;
  const template = themes[oppositeScheme(themes[id].scheme)].colors;
  const colors = { ...source };
  for (const token of Object.keys(source) as Array<keyof ThemeColors>) {
    if (token === "scrim") {
      colors.scrim = template.scrim;
      continue;
    }
    const [, sourceChroma, hue] = toOklch(source[token]);
    const [targetLightness, targetChroma] = toOklch(template[token]);
    const chroma = GROUND_ROLES.has(token) ? Math.min(sourceChroma, Math.max(targetChroma, MIN_GROUND_CHROMA)) : sourceChroma;
    colors[token] = fromOklch([targetLightness, chroma, hue]);
  }
  nudgeContrast(colors);
  if (id === "newsprint") colors.accent = "#ece9e1";
  return colors;
}

const twins = new Map<ThemeId, ThemeColors>();

export function oppositeScheme(scheme: ThemeScheme): ThemeScheme {
  return scheme === "light" ? "dark" : "light";
}

export function muralColors(id: ThemeId, scheme: ThemeScheme): ThemeColors {
  const theme = themes[id];
  if (theme.scheme === scheme) return theme.colors;
  if (id === "light") return themes.dark.colors;
  if (id === "dark") return themes.light.colors;
  let twin = twins.get(id);
  if (!twin) {
    twin = generateTwin(id);
    twins.set(id, twin);
  }
  return twin;
}

export function muralBlockStyle(style: BlockStyle, id: ThemeId, scheme: ThemeScheme): BlockStyle {
  if (themes[id].scheme === scheme) return style;
  const from = themes[oppositeScheme(scheme)].colors;
  const to = themes[scheme].colors;
  const [surfaceFrom, surfaceTo] = [toOklch(from.surface)[0], toOklch(to.surface)[0]];
  const [textFrom, textTo] = [toOklch(from.text)[0], toOklch(to.text)[0]];
  const slope = (textTo - surfaceTo) / (textFrom - surfaceFrom);
  const flipped = { ...style };
  for (const field of BLOCK_COLOR_FIELDS) {
    const value = style[field];
    if (typeof value !== "string" || !parseHexColor(value)) continue;
    const [lightness, chroma, hue] = toOklch(value);
    const mapped = surfaceTo + (lightness - surfaceFrom) * slope;
    flipped[field] = fromOklch([Math.min(1, Math.max(0, mapped)), chroma, hue]);
  }
  const palette = muralColors(id, scheme);
  const { text, background } = effectiveBlockColors(flipped, palette);
  if (!parseHexColor(text) || !parseHexColor(background)) return flipped;
  const towardWhite = contrastRatio(background, "#ffffff")! > contrastRatio(background, "#000000")!;
  let [lightness, chroma, hue] = toOklch(text);
  let nudged = text;
  for (let i = 0; i < BLOCK_TEXT_STEPS && contrastRatio(nudged, background)! < BLOCK_TEXT_TARGET; i++) {
    lightness += towardWhite ? NUDGE_STEP : -NUDGE_STEP;
    nudged = fromOklch([lightness, chroma, hue]);
    flipped.textColor = nudged;
  }
  return flipped;
}
