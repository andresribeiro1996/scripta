import { contrastRatio, parseHexColor, toHex, type PerCardStyle, type Rgb } from "@scripta/shared";

export function scrimStops(intensity: number): { offset: number; opacity: number }[] {
  const peak = Math.min(1, Math.max(0, intensity / 100));
  return [{ offset: 0, opacity: peak }, { offset: 0.36, opacity: peak }, { offset: 0.7, opacity: 0 }];
}

export function cardTextMayBeHardToRead(style: Pick<PerCardStyle, "cardTextColor" | "overlayIntensity" | "cardOpacity">, canvasColor: string): boolean {
  const text = parseHexColor(style.cardTextColor ?? "#ffffff");
  const canvas = parseHexColor(canvasColor);
  if (!text || !canvas) return false;
  const mix = (front: Rgb, back: Rgb, opacity: number): Rgb => ({
    r: front.r * opacity + back.r * (1 - opacity),
    g: front.g * opacity + back.g * (1 - opacity),
    b: front.b * opacity + back.b * (1 - opacity),
  });
  const scrim = { r: 10, g: 8, b: 6 };
  const opacity = Math.min(1, Math.max(0, style.cardOpacity / 100));
  const foreground = toHex(mix(text, canvas, opacity));
  return [scrim, mix(scrim, { r: 255, g: 255, b: 255 }, scrimStops(style.overlayIntensity)[0].opacity)]
    .some((background) => (contrastRatio(foreground, toHex(mix(background, canvas, opacity))) ?? 0) < 4.5);
}
