import { renderPlate, renderGlyph } from "../../../../packages/shared/src/readerCards/render.ts";
import { INKS, PAPER, REVERSED_LINE, type IdentityKey } from "../../../../packages/shared/src/readerCards/plates.ts";

export type Print = "paper" | "reversed";
export const colors = (key: IdentityKey, print: Print): [string, string] => {
  const [, ink, deep] = INKS[key];
  return print === "paper" ? [PAPER, ink] : [deep, REVERSED_LINE];
};

export const SEGMENTS = [
  { label: "Fantasy & SF", n: 22, marks: 9, lead: true },
  { label: "Classics & literary", n: 7, marks: 3 },
  { label: "Mystery & crime", n: 8, marks: 1 },
  { label: "History & memoir", n: 5, marks: 0 },
  { label: "Other", n: 6, marks: 1 },
];

export function dial(line: string, { gapAt }: { gapAt?: number } = {}) {
  const total = SEGMENTS.reduce((s, x) => s + x.n, 0);
  const gap = 7;
  const step = (360 - gap * SEGMENTS.length) / total;
  let angle = gap / 2;
  let d = "", dLead = "";
  for (const seg of SEGMENTS) {
    for (let i = 0; i < seg.n; i++) {
      const a = angle + step * (i + 0.5);
      if (gapAt !== undefined && Math.abs(((a - gapAt + 540) % 360) - 180) < 13) continue;
      const rad = (a * Math.PI) / 180;
      const r1 = 62.5, r2 = i < seg.marks ? 72 : 67.5;
      const p = (r: number) => `${(125 + r * Math.sin(rad)).toFixed(2)} ${(134 - r * Math.cos(rad)).toFixed(2)}`;
      const piece = `M${p(r1)}L${p(r2)}`;
      if (seg.lead) dLead += piece; else d += piece;
    }
    angle += step * seg.n + gap;
  }
  return `<path d="${dLead}" style="stroke:${line};fill:none" stroke-width="1.15" stroke-linecap="round"/><path d="${d}" style="stroke:${line};fill:none" stroke-width=".6" stroke-linecap="round" opacity=".8"/>`;
}

export function base(identity: IdentityKey, print: Print, width: number, state: "settled" | "leaning" = "settled") {
  return renderPlate({ identity, state, readerName: "André Ribeiro", print, label: "mock", width });
}

export function inject(svg: string, extra: string, before = "</svg>") {
  const at = svg.lastIndexOf(before);
  return svg.slice(0, at) + extra + svg.slice(at);
}

export function afterRings(svg: string, extra: string) {
  const marker = `r="55"`;
  const i = svg.indexOf(marker);
  const end = svg.indexOf("/>", i) + 2;
  return svg.slice(0, end) + extra + svg.slice(end);
}

export function seal(identity: IdentityKey, runnerUp: IdentityKey, print: Print, cx: number, cy: number, size = 26) {
  const [ground] = colors(identity, print);
  const g = renderGlyph(runnerUp, size, print).replace("<svg ", `<svg x="${cx - size / 2}" y="${cy - size / 2}" `);
  return `<circle cx="${cx}" cy="${cy}" r="${size / 2 + 2.5}" style="fill:${ground}"/>${g}`;
}

export const text = (line: string, x: number, y: number, s: string, size = 6, spacing = 1.6, extra = "") =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" letter-spacing="${spacing}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="600" style="fill:${line}" ${extra}>${s}</text>`;

export const renderGlyphSvg = (key: IdentityKey, size: number) => renderGlyph(key, size, "paper");
