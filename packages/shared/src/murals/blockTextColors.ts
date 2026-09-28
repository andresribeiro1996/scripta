import type { BlockStyle } from "../library/libraryStyle.js";

type Rgb = { r: number; g: number; b: number };

const MIX_SHARES = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];

function parseHexColor(value: string): Rgb | null {
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

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
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
  theme: { text: string; textDim: string; surface: string }
): { text: string; dim: string } {
  if (!style.backgroundColor && !style.textColor) return { text: theme.text, dim: theme.textDim };
  const text = style.textColor ?? theme.text;
  const background = style.backgroundColor ?? theme.surface;
  return { text, dim: mutedTextColor(text, background) ?? theme.textDim };
}
