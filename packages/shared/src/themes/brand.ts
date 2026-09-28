import { DECOR_EXTRA_COLORS } from "./decor.js";
import type { ThemeId } from "./palettes.js";

export const MARK_VIEWBOX = "-4 -4 84 84";

export interface MarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rotate?: readonly [number, number, number];
}

export const MARK_RECTS: readonly MarkRect[] = [
  { x: 3.75, y: 3, width: 11, height: 66, rotate: [18, 14.75, 69] },
  { x: 55.54, y: 3, width: 17, height: 66, rotate: [-18, 55.54, 69] },
  { x: 18, y: 41, width: 36, height: 5 },
  { x: 0, y: 69, width: 76, height: 5 },
];

export const MARK_EXTRA_COLORS = { ...DECOR_EXTRA_COLORS, registerRed: "#d0392b" } as const;

export type MarkFill = "text" | "accent" | keyof typeof MARK_EXTRA_COLORS;
export type MarkEntrance = "scan" | "rise" | "fan" | "register" | "gild";

export interface MarkLayer {
  fill: MarkFill;
  offset: readonly [number, number];
  opacity: number;
}

export interface MarkTreatment {
  layers: readonly MarkLayer[];
  stripes?: readonly (readonly [number, number])[];
  bookplate?: boolean;
  entrance: MarkEntrance | null;
}

function roundedRect(x: number, y: number, size: number, radius: number, stroke: number) {
  return { x, y, size, radius, stroke, perimeter: Math.round((4 * size - (8 - 2 * Math.PI) * radius) * 100) / 100 };
}

export const MARK_BOOKPLATE = {
  outer: roundedRect(-2, -2, 80, 4, 2),
  inner: roundedRect(3, 3, 70, 2, 1),
  markTransform: "translate(15 13) scale(0.6)",
} as const;

export const MOTION = { entranceMs: 600, themeFadeMs: 250, ease: [0.32, 0.72, 0, 1] } as const;
export const FAN_EASE = [0.34, 1.56, 0.64, 1] as const;
export const ENTRANCE = {
  scan: { ms: 560, steps: 7 },
  rise: { ms: 600, from: 14 },
  fan: { ms: 600 },
  register: { ms: 620 },
  gild: { ms: 700, markDelayMs: 450, markMs: 350 },
} as const;

const MARK: MarkLayer = { fill: "accent", offset: [0, 0], opacity: 1 };
const PLAIN: MarkTreatment = { layers: [{ fill: "text", offset: [0, 0], opacity: 1 }], entrance: null };

const TREATMENTS: Partial<Record<ThemeId, MarkTreatment>> = {
  matrix: { layers: [MARK], stripes: [[14, 4], [30, 4], [52, 4]], entrance: "scan" },
  synthwave: { layers: [MARK], stripes: [[47, 2], [54, 3], [61.5, 4.5]], entrance: "rise" },
  seventies: {
    layers: [
      { fill: "rust", offset: [4, 3], opacity: 1 },
      { fill: "orange", offset: [2, 1.5], opacity: 1 },
      MARK,
    ],
    entrance: "fan",
  },
  newsprint: {
    layers: [
      { fill: "registerRed", offset: [2.4, 1.8], opacity: 0.8 },
      { fill: "text", offset: [0, 0], opacity: 1 },
    ],
    entrance: "register",
  },
  oxblood: { layers: [MARK], bookplate: true, entrance: "gild" },
};

export function markTreatment(id: ThemeId): MarkTreatment {
  return TREATMENTS[id] ?? PLAIN;
}

export interface LayerEntrance {
  from: readonly [number, number];
  fade: boolean;
  delayMs: number;
}

export function layerEntrance(treatment: MarkTreatment, index: number): LayerEntrance | null {
  const last = treatment.layers.length - 1;
  if (index >= last) return null;
  const [dx, dy] = treatment.layers[index]!.offset;
  if (treatment.entrance === "fan") return { from: [-dx, -dy], fade: false, delayMs: (last - 1 - index) * 80 };
  if (treatment.entrance === "register") return { from: [Math.round((11 - dx) * 100) / 100, Math.round((8 - dy) * 100) / 100], fade: true, delayMs: 100 };
  return null;
}
