import { INKS, PAPER, PLATES, REVERSED_LINE, glyph, plate, type IdentityKey } from "./plates.js";

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

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const truncateName = (name: string) => (name.length > 16 ? `${name.slice(0, 16)}…` : name);

const rules = (g: string, l: string): Record<string, string> => ({
  pg: `fill:${g}`, pgf: `fill:${g}`, gg: `fill:${g}`,
  pf: `fill:${l}`, pt: `fill:${l}`, gd: `fill:${l}`, gi: `fill:${l}`,
  pl: `stroke:${l};fill:none`, gk: `stroke:${l};fill:none`,
  pgs: `stroke:${g};fill:none`, gr: `stroke:${g};fill:none`, gs: `stroke:${g};fill:none`,
  pgl: `fill:${g};stroke:${l}`,
});

const withStyle = (svg: string, [g, l]: [string, string]) => {
  const r = rules(g, l);
  return svg.replace(/ class="(\w+)"/g, (_, c: string) => {
    const style = r[c];
    if (!style) throw new Error(`No print rule for class "${c}"`);
    return ` style="${style}"`;
  });
};

export function renderPlate({ identity, state, readerName, print, label, unwrittenLine, width }: RenderPlateOptions): string {
  const reader = escape(truncateName(readerName).toUpperCase());
  const safeLabel = escape(label);
  if (state === "unwritten" || !identity) {
    const svg = plate({ key: "none", emblem: "none", name: "Unwritten", eyebrow: "NOT YET", epithet: escape(unwrittenLine ?? "five finished books to begin"), numeral: "—", reader, width, label: safeLabel });
    return withStyle(svg, inks("graph", print));
  }
  const p = PLATES.find((item) => item.key === identity)!;
  const svg = plate({ ...p, eyebrow: state === "leaning" ? "LEANING TOWARD" : "THE", reader, width, label: safeLabel });
  return withStyle(svg, inks(identity, print));
}

export function renderGlyph(identity: IdentityKey, size: number, print: PlatePrint): string {
  return withStyle(glyph(identity, size), inks(identity, print));
}
