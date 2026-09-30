import type { BlockStyle } from "../library/libraryStyle.js";
import type { ThemeColors } from "../themes/palettes.js";

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

export type Rgb = { r: number; g: number; b: number };

const MIX_SHARES = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];

export function parseHexColor(value: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  if (hex.length === 3) {
    const [r, g, b] = hex.split("").map((channel) => parseInt(channel + channel, 16));
    return { r, g, b };
  }
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const [lighter, darker] = lumA >= lumB ? [lumA, lumB] : [lumB, lumA];
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastRatio(a: string, b: string): number | null {
  const rgbA = parseHexColor(a);
  const rgbB = parseHexColor(b);
  if (!rgbA || !rgbB) return null;
  return ratio(rgbA, rgbB);
}

function roundChannel(value: number): number {
  return Math.round(Math.min(255, Math.max(0, value)));
}

function roundRgb({ r, g, b }: Rgb): Rgb {
  return { r: roundChannel(r), g: roundChannel(g), b: roundChannel(b) };
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function normalizeHexColor(input: string): string | null {
  const rgb = parseHexColor(input);
  return rgb ? toHex(rgb) : null;
}

export function mutedTextColor(text: string, background: string): string | null {
  const textRgb = parseHexColor(text);
  const backgroundRgb = parseHexColor(background);
  if (!textRgb || !backgroundRgb) return null;
  const black: Rgb = { r: 0, g: 0, b: 0 };
  const white: Rgb = { r: 255, g: 255, b: 255 };
  const base = ratio(textRgb, backgroundRgb) >= 4.5 ? textRgb : ratio(black, backgroundRgb) >= ratio(white, backgroundRgb) ? black : white;
  for (const share of MIX_SHARES) {
    const mixed = roundRgb({
      r: base.r * share + backgroundRgb.r * (1 - share),
      g: base.g * share + backgroundRgb.g * (1 - share),
      b: base.b * share + backgroundRgb.b * (1 - share)
    });
    if (ratio(mixed, backgroundRgb) >= 4.5) return toHex(mixed);
  }
  return toHex(roundRgb(base));
}

export function blockTextColors(
  style: Pick<BlockStyle, "backgroundColor" | "textColor">,
  theme: Pick<ThemeColors, BlockThemeColorKey | "textDim">
): { text: string; dim: string; accent: string } {
  if (!style.backgroundColor && !style.textColor) return { text: theme.text, dim: theme.textDim, accent: theme.accent };
  const { text, background } = effectiveBlockColors(style, theme);
  const accentContrast = contrastRatio(theme.accent, background);
  return {
    text,
    dim: mutedTextColor(text, background) ?? theme.textDim,
    accent: accentContrast !== null && accentContrast < 3 ? text : theme.accent
  };
}
