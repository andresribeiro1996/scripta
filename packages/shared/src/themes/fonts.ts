import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";

export type FontSlot = "display" | "text";
export type FontWeight = 400 | 600 | 700;

export interface FontDefinition {
  family: string | null;
  slots: readonly FontSlot[];
  weights: readonly FontWeight[];
  scale: number;
  fallback: string;
}

const SYSTEM_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const SERIF = "ui-serif, Georgia, serif";
const MONO = "ui-monospace, monospace";
const SANS = "sans-serif";

export const FONT_IDS = ["system", "playfair", "literata", "fraunces", "cormorant", "specialElite", "vt323", "orbitron", "righteous", "atkinson", "jetbrainsMono"] as const;

export type FontId = (typeof FONT_IDS)[number];

export const fonts: Record<FontId, FontDefinition> = {
  system: { family: null, slots: ["display", "text"], weights: [], scale: 1, fallback: SYSTEM_STACK },
  playfair: { family: "Playfair Display", slots: ["display"], weights: [700], scale: 1, fallback: SERIF },
  literata: { family: "Literata", slots: ["display", "text"], weights: [400, 700], scale: 1, fallback: SERIF },
  fraunces: { family: "Fraunces", slots: ["display"], weights: [700], scale: 1, fallback: SERIF },
  cormorant: { family: "Cormorant Garamond", slots: ["display"], weights: [600], scale: 1.12, fallback: SERIF },
  specialElite: { family: "Special Elite", slots: ["display"], weights: [400], scale: 1, fallback: MONO },
  vt323: { family: "VT323", slots: ["display"], weights: [400], scale: 1.3, fallback: MONO },
  orbitron: { family: "Orbitron", slots: ["display"], weights: [700], scale: 0.88, fallback: SANS },
  righteous: { family: "Righteous", slots: ["display"], weights: [400], scale: 1, fallback: SANS },
  atkinson: { family: "Atkinson Hyperlegible", slots: ["text"], weights: [400, 700], scale: 1, fallback: SANS },
  jetbrainsMono: { family: "JetBrains Mono", slots: ["text"], weights: [400, 700], scale: 1, fallback: MONO },
};

export const DISPLAY_FONT_IDS = ["system", "playfair", "literata", "fraunces", "cormorant", "specialElite", "vt323", "orbitron", "righteous"] as const satisfies readonly FontId[];

export const TEXT_FONT_IDS = ["system", "literata", "atkinson", "jetbrainsMono"] as const satisfies readonly FontId[];

export function fontStack(id: FontId): string {
  const font = fonts[id];
  return font.family ? `"${font.family}", ${font.fallback}` : font.fallback;
}

export function fontFileName(id: FontId, weight: FontWeight): string {
  return `${id}-${weight}`;
}

export function fontLabel(id: FontId, locale: Locale): string {
  return sharedT(locale)(`shared.fonts.${id}`);
}
