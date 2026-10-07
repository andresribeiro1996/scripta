import type { IdentityKey } from "./plates.js";

export const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
export const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
export const MONO = "'Courier Prime', 'Courier New', Courier, monospace";

export interface PlateFace {
  key: IdentityKey | "none";
  emblemSvg: string;
  name: string;
  eyebrow: string;
  epithet: string;
  numeral: string;
  reader: string;
  width: number;
  label: string;
}

export interface PlateSlots {
  underlay?: string;
  frameBand?: string;
  corners?: string;
  header?: string;
  top?: string;
  rings?: string;
  seal?: string;
  trait?: string;
  footerLeft?: string;
  footerRight?: string;
  overlay?: string;
}

const DIAMONDS = [[16, 16], [234, 16], [16, 334], [234, 334]].map(([x, y]) => `M${x} ${y! - 4.5}L${x! + 4.5} ${y}L${x} ${y! + 4.5}L${x! - 4.5} ${y}Z`).join("");

const openSvg = (face: PlateFace) => `<svg xmlns="http://www.w3.org/2000/svg" class="plate id-${face.key}" viewBox="0 0 250 350" width="${face.width}" height="${+(face.width * 1.4).toFixed(2)}" role="img" aria-label="${face.label}">`;
const GROUND = `<rect class="pg" width="250" height="350" rx="4"/>`;
const FRAME = [`<rect class="pl" x="10" y="10" width="230" height="330" stroke-width="1.6"/>`, `<rect class="pl" x="16" y="16" width="218" height="318" stroke-width=".6"/>`];
const corners = (slots: PlateSlots) => slots.corners ?? `<path class="pf" d="${DIAMONDS}"/>`;
const footer = (face: PlateFace, slots: PlateSlots) => [
  `<path class="pl" d="M30 305H220" stroke-width=".5"/>`,
  slots.footerLeft ?? `<text class="pt" x="30" y="321" font-size="7.5" letter-spacing="1.8" font-family="${SANS}" font-weight="600">PLATE ${face.numeral}</text>`,
  slots.footerRight ?? `<text class="pt" x="220" y="321" text-anchor="end" font-size="7.5" letter-spacing="1.8" font-family="${SANS}" font-weight="600">${face.reader}</text>`,
];
const join = (parts: Array<string | undefined>) => parts.filter((line): line is string => Boolean(line)).join("\n");

export function composePlate(face: PlateFace, slots: PlateSlots = {}): string {
  return join([
    openSvg(face),
    GROUND,
    slots.underlay,
    ...FRAME,
    slots.frameBand,
    corners(slots),
    slots.header ?? `<text class="pt" x="125" y="45" text-anchor="middle" font-size="8.5" letter-spacing="3.4" font-family="${SANS}" font-weight="600">EX LIBRIS</text>`,
    slots.top,
    `<circle class="pl" cx="125" cy="134" r="60" stroke-width="1.4"/>`,
    `<circle class="pl" cx="125" cy="134" r="55" stroke-width=".6"/>`,
    slots.rings,
    face.emblemSvg,
    slots.seal,
    `<text class="pt" x="125" y="220" text-anchor="middle" font-size="8" letter-spacing="3" font-family="${SANS}" font-weight="600">${face.eyebrow}</text>`,
    `<text class="pt" x="125" y="247" text-anchor="middle" font-size="25" font-family="${SERIF}">${face.name}</text>`,
    `<path class="pl" d="M82 263H117M133 263H168" stroke-width=".8"/><circle class="pf" cx="125" cy="263" r="2"/>`,
    `<text class="pt" x="125" y="283" text-anchor="middle" font-size="11" font-style="italic" font-family="${SERIF}">${face.epithet}</text>`,
    slots.trait,
    ...footer(face, slots),
    slots.overlay,
    `</svg>`,
  ]);
}

export function composePage(face: PlateFace, body: string, slots: PlateSlots = {}): string {
  return join([openSvg(face), GROUND, slots.underlay, ...FRAME, corners(slots), body, ...footer(face, slots), slots.overlay, `</svg>`]);
}
