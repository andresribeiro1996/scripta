import { writeFileSync } from "node:fs";
import { base, colors, afterRings, inject, seal, text } from "./lib.ts";

const out = process.argv[2];
const [ground, line] = colors("star", "paper");
type Seg = { n: number; marks: number; lead?: boolean };
export const SMALL: Seg[] = [{ n: 22, marks: 9, lead: true }, { n: 7, marks: 3 }, { n: 8, marks: 1 }, { n: 5, marks: 0 }, { n: 6, marks: 1 }];
const LARGE: Seg[] = [{ n: 146, marks: 60, lead: true }, { n: 47, marks: 20 }, { n: 53, marks: 7 }, { n: 33, marks: 0 }, { n: 41, marks: 7 }];
export const SEAL_AT = 135;
const total = (segs: Seg[]) => segs.reduce((s, x) => s + x.n, 0);
const polar = (a: number, r: number): [number, number] => [125 + r * Math.sin((a * Math.PI) / 180), 134 - r * Math.cos((a * Math.PI) / 180)];
const near = (a: number, b: number, w: number) => Math.abs(((a - b + 540) % 360) - 180) < w;
const f = (n: number) => n.toFixed(2);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function perBook(segs: Seg[], gap: number, each: (a: number, seg: Seg, i: number, step: number) => string) {
  const step = (360 - gap * segs.length) / total(segs);
  let angle = gap / 2, outStr = "";
  for (const seg of segs) {
    for (let i = 0; i < seg.n; i++) outStr += each(angle + step * (i + 0.5), seg, i, step);
    angle += step * seg.n + gap;
  }
  return outStr;
}

export function beads(segs: Seg[]) {
  const step = (360 - 7 * segs.length) / total(segs);
  const r = Math.min(1.7, Math.max(0.42, step * 0.5 * 0.4));
  return perBook(segs, 7, (a, seg, i) => {
    if (near(a, SEAL_AT, 13)) return "";
    const [x, y] = polar(a, 57.5);
    const filled = i < seg.marks;
    return filled || seg.lead
      ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" style="fill:${line}" opacity="${filled ? 1 : 0.55}"/>`
      : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.8)}" style="stroke:${line};fill:none" stroke-width="${f(Math.min(0.5, r * 0.5))}"/>`;
  });
}

export function shelf(segs: Seg[]) {
  seed = 11;
  const x0 = 36, x1 = 214, baseY = 66, gap = 2.4;
  const n = total(segs);
  const pitch = (x1 - x0 - gap * (segs.length - 1)) / n;
  const w = Math.max(0.35, pitch * 0.78);
  let x = x0, d = "";
  for (const seg of segs) {
    for (let i = 0; i < seg.n; i++) {
      const h = 7 + rand() * 6;
      const op = seg.lead ? 1 : 0.5;
      d += `<rect x="${f(x)}" y="${f(baseY - h)}" width="${f(w)}" height="${f(h)}" style="fill:${line}" opacity="${op}"/>`;
      if (i < seg.marks && pitch > 2) d += `<rect x="${f(x)}" y="${f(baseY - h + 1.6)}" width="${f(w)}" height=".7" style="fill:${ground}"/>`;
      x += pitch;
    }
    x += gap;
  }
  return `${d}<path d="M30 ${baseY + 0.4}H220" style="stroke:${line};fill:none" stroke-width=".8"/>`;
}

export function frame(segs: Seg[]) {
  const inset = 13, L = inset, R = 250 - inset, T = inset, B = 350 - inset;
  const legs = [[125, T, R, T], [R, T, R, B], [R, B, L, B], [L, B, L, T], [L, T, 125, T]] as const;
  const lens = legs.map(([ax, ay, bx, by]) => Math.hypot(bx - ax, by - ay));
  const at = (s: number) => {
    for (let k = 0; k < legs.length; k++) {
      if (s <= lens[k]) {
        const [ax, ay, bx, by] = legs[k];
        const t = s / lens[k];
        return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, horiz: ay === by };
      }
      s -= lens[k];
    }
    return null;
  };
  const corners = [[L, T], [R, T], [L, B], [R, B]];
  const pitch = 3.1, gap = 5;
  let s = 0, d = "", dLong = "";
  for (const seg of segs) {
    for (let i = 0; i < seg.n; i++) {
      let p = at(s);
      while (p && corners.some(([cx, cy]) => Math.hypot(p!.x - cx, p!.y - cy) < 7)) { s += pitch; p = at(s); }
      if (!p) break;
      const len = i < seg.marks ? 2.6 : 1.5;
      const piece = p.horiz ? `M${f(p.x)} ${f(p.y - len)}V${f(p.y + len)}` : `M${f(p.x - len)} ${f(p.y)}H${f(p.x + len)}`;
      if (seg.lead) dLong += piece; else d += piece;
      s += pitch;
    }
    s += gap;
  }
  return `<path d="${dLong}" style="stroke:${line};fill:none" stroke-width=".9"/><path d="${d}" style="stroke:${line};fill:none" stroke-width=".55" opacity=".75"/>`;
}

export function ring(segs: Seg[]) {
  const patterns = ["", "1.2 .9", ".5 1.3", "2.6 1.2", ".25 2.2"];
  const n = total(segs), gap = 6;
  const span = 360 - gap * segs.length;
  let angle = gap / 2, outStr = "";
  segs.forEach((seg, k) => {
    let a0 = angle, a1 = angle + (span * seg.n) / n;
    if (a0 < SEAL_AT + 13 && a1 > SEAL_AT - 13) {
      if (a0 < SEAL_AT - 13) outStr += arc(a0, SEAL_AT - 13, patterns[k], seg.lead);
      a0 = Math.max(a0, SEAL_AT + 13);
    }
    if (a1 > a0) outStr += arc(a0, a1, patterns[k], seg.lead);
    angle = a1 + gap;
  });
  return outStr;
}

function arc(a0: number, a1: number, dash: string, lead?: boolean) {
  const [x0, y0] = polar(a0, 57.5), [x1, y1] = polar(a1, 57.5);
  return `<path d="M${f(x0)} ${f(y0)}A57.5 57.5 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}" style="stroke:${line};fill:none" stroke-width="${lead ? 4.4 : 3.2}" ${dash ? `stroke-dasharray="${dash}"` : ""} opacity="${lead ? 1 : 0.8}"/>`;
}

export const streak = text(line, 125, 297, "WITH A STREAK OF THE LAMPLIGHTER", 5.6, 1.5);
const [sx, sy] = polar(SEAL_AT, 64);
export const sealSvg = seal("star", "lamp", "paper", +sx.toFixed(1), +sy.toFixed(1));
const W = 168;
const plateWith = (counter: string, atRings = true) => {
  let svg = base("star", "paper", W);
  svg = atRings ? afterRings(svg, counter) : inject(svg, counter);
  return inject(svg, streak + sealSvg);
};

const pair = (make: (s: Seg[]) => string, atRings = true) => `
  <div style="display:flex;gap:14px;justify-content:center;padding:16px;background:#e7e2d8">
    <figure style="margin:0;text-align:center">${plateWith(make(SMALL), atRings)}<figcaption style="color:#555;font-size:12px;margin-top:4px">48 livros</figcaption></figure>
    <figure style="margin:0;text-align:center">${plateWith(make(LARGE), atRings)}<figcaption style="color:#555;font-size:12px;margin-top:4px">320 livros</figcaption></figure>
  </div>`;

const card = (id: string, letter: string, title: string, desc: string, body: string) => `
  <div class="card" data-choice="${id}" onclick="toggleSelect(this)">
    <div class="card-image">${body}</div>
    <div class="card-body"><h3>${letter} · ${title}</h3><p>${desc}</p></div>
  </div>`;

if (process.argv[1]?.endsWith("counters.ts")) writeFileSync(out, `
<h2>Alternativas para o contador de livros</h2>
<p class="subtitle">Todas levam a linha e o selo do traço secundário (B + C). Cada uma aparece com 48 e com 320 livros terminados, para veres como escala.</p>
<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(390px,1fr))">
${card("beads", "D", "Contas", "Uma conta por livro, no espaço entre os dois anéis. Contas cheias são livros com destaques; as do teu género vêm em tinta inteira. Com muitos livros, fica uma textura fina tipo rosário.", pair(beads))}
${card("shelf", "E", "Estante", "Uma lombada por livro, numa prateleira por baixo do EX LIBRIS. Alturas variadas, o teu género em tinta inteira, e uma faixa na lombada dos livros com destaques. Com muitos livros, a prateleira fica cheia e compacta.", pair(shelf, false))}
${card("frame", "F", "Moldura", "Um traço por livro no friso entre as duas molduras, a começar no topo e a andar no sentido dos ponteiros. O espaçamento é fixo, por isso a moldura vai enchendo à medida que lês. Também funciona como progresso.", pair(frame, false))}
${card("ring", "G", "Anel de género", "Sem traço por livro: o anel entre os círculos divide-se em arcos proporcionais a cada género, cada um com o seu padrão. É igual aos 48 e aos 320 livros, mais limpo mas menos teu.", pair(ring))}
</div>
`);
