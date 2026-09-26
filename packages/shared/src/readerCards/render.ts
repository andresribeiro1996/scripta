import { INKS, PAPER, PLATES, REVERSED_LINE, glyph, plate, printStyle, type IdentityKey } from "./plates.js";

export type PlatePrint = "paper" | "reversed";
export type CardState = "settled" | "leaning" | "unwritten";

export interface RenderPlateOptions {
  identity: IdentityKey | null;
  state: CardState;
  readerName: string;
  print: PlatePrint;
  label: string;
  unwrittenLine?: string;
  width?: number;
}

function inks(key: IdentityKey | "graph", print: PlatePrint): [string, string] {
  const [, ink, deep] = INKS[key];
  return print === "paper" ? [PAPER, ink] : [deep, REVERSED_LINE];
}

const withStyle = (svg: string, [ground, line]: [string, string]) => svg.replace(">", `>${printStyle(ground, line)}`);

export function renderPlate({ identity, state, readerName, print, label, unwrittenLine, width }: RenderPlateOptions): string {
  const reader = readerName.toUpperCase();
  if (state === "unwritten" || !identity) {
    const svg = plate({ key: "none", emblem: "none", name: "Unwritten", eyebrow: "NOT YET", epithet: unwrittenLine ?? "five finished books to begin", numeral: "—", reader, width, label });
    return withStyle(svg, inks("graph", print));
  }
  const p = PLATES.find((item) => item.key === identity)!;
  const svg = plate({ ...p, eyebrow: state === "leaning" ? "LEANING TOWARD" : "THE", reader, width, label });
  return withStyle(svg, inks(identity, print));
}

export function renderGlyph(identity: IdentityKey, size: number, print: PlatePrint): string {
  return withStyle(glyph(identity, size), inks(identity, print));
}
