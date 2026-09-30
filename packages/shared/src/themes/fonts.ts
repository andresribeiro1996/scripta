export type FontSlot = "display" | "text";
export type FontWeight = 400 | 600 | 700;

export interface FontDefinition {
  label: string;
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
  system: { label: "System", family: null, slots: ["display", "text"], weights: [], scale: 1, fallback: SYSTEM_STACK },
  playfair: { label: "Playfair", family: "Playfair Display", slots: ["display"], weights: [700], scale: 1, fallback: SERIF },
  literata: { label: "Literata", family: "Literata", slots: ["display", "text"], weights: [400, 700], scale: 1, fallback: SERIF },
  fraunces: { label: "Fraunces", family: "Fraunces", slots: ["display"], weights: [700], scale: 1, fallback: SERIF },
  cormorant: { label: "Cormorant Garamond", family: "Cormorant Garamond", slots: ["display"], weights: [600], scale: 1.12, fallback: SERIF },
  specialElite: { label: "Special Elite", family: "Special Elite", slots: ["display"], weights: [400], scale: 1, fallback: MONO },
  vt323: { label: "VT323", family: "VT323", slots: ["display"], weights: [400], scale: 1.3, fallback: MONO },
  orbitron: { label: "Orbitron", family: "Orbitron", slots: ["display"], weights: [700], scale: 0.88, fallback: SANS },
  righteous: { label: "Righteous", family: "Righteous", slots: ["display"], weights: [400], scale: 1, fallback: SANS },
  atkinson: { label: "Atkinson Hyperlegible", family: "Atkinson Hyperlegible", slots: ["text"], weights: [400, 700], scale: 1, fallback: SANS },
  jetbrainsMono: { label: "JetBrains Mono", family: "JetBrains Mono", slots: ["text"], weights: [400, 700], scale: 1, fallback: MONO },
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
