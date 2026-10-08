import { INKS, PAPER, REVERSED_LINE, type IdentityKey } from "./plates.js";
import type { PlatePrint } from "./render.js";

export function inks(key: IdentityKey | "graph", print: PlatePrint): [string, string] {
  const [, ink, deep] = INKS[key];
  return print === "paper" ? [PAPER, ink] : [deep, REVERSED_LINE];
}

const rules = (g: string, l: string): Record<string, string> => ({
  pg: `fill:${g}`, pgf: `fill:${g}`, gg: `fill:${g}`,
  pf: `fill:${l}`, pt: `fill:${l}`, gd: `fill:${l}`, gi: `fill:${l}`,
  pl: `stroke:${l};fill:none`, gk: `stroke:${l};fill:none`,
  pgs: `stroke:${g};fill:none`, gr: `stroke:${g};fill:none`, gs: `stroke:${g};fill:none`,
  pgl: `fill:${g};stroke:${l}`,
});

export function withStyle(svg: string, [g, l]: [string, string]): string {
  const r = rules(g, l);
  return svg.replace(/<[^>]*>/g, (tag) => tag.replace(/ class="(\w+)"/g, (_, c: string) => {
    const style = r[c];
    if (!style) throw new Error(`No print rule for class "${c}"`);
    return ` style="${style}"`;
  }));
}

export function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, "0")).join("")}`;
}
