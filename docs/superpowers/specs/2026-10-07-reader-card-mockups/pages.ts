import { writeFileSync } from "node:fs";
import { base, colors, dial, afterRings, inject, seal, text } from "./lib.ts";

const out = process.argv[2];
const [G, L] = colors("star", "paper");
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const MONO = "'Courier New', Courier, monospace";
const OWN = "◇";

const t = (x: number, y: number, s: string, o: { size?: number; font?: string; ls?: number; anchor?: string; weight?: number; italic?: boolean; op?: number; fill?: string } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="${o.anchor ?? "middle"}" font-size="${o.size ?? 7}" font-family="${o.font ?? SANS}" letter-spacing="${o.ls ?? 0}" ${o.weight ? `font-weight="${o.weight}"` : ""} ${o.italic ? `font-style="italic"` : ""} opacity="${o.op ?? 1}" style="fill:${o.fill ?? L}">${s}</text>`;
const rule = (y: number, x0 = 30, x1 = 220, sw = 0.5, extra = "") => `<path d="M${x0} ${y}H${x1}" style="stroke:${L};fill:none" stroke-width="${sw}" ${extra}/>`;
const divider = (y: number) => `<path d="M82 ${y}H117M133 ${y}H168" style="stroke:${L};fill:none" stroke-width=".8"/><circle cx="125" cy="${y}" r="2" style="fill:${L}"/>`;

function frame(inner: string, w: number) {
  const corners = [[16, 16], [234, 16], [16, 334], [234, 334]].map(([x, y]) => `M${x} ${y - 4.5}L${x + 4.5} ${y}L${x} ${y + 4.5}L${x - 4.5} ${y}Z`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" width="${w}" height="${+(w * 1.4).toFixed(1)}">
<rect width="250" height="350" rx="4" style="fill:${G}"/>
<rect x="10" y="10" width="230" height="330" style="stroke:${L};fill:none" stroke-width="1.6"/>
<rect x="16" y="16" width="218" height="318" style="stroke:${L};fill:none" stroke-width=".6"/>
<path d="${corners}" style="fill:${L}"/>${inner}</svg>`;
}
const foot = (left: string, note?: string) => (note ? t(125, 298, note, { size: 6, font: SERIF, italic: true, op: 0.75 }) : "") + rule(305) + t(30, 321, left, { size: 7.5, ls: 1.8, anchor: "start", weight: 600 }) + t(220, 321, "ANDRÉ RIBEIRO", { size: 7.5, ls: 1.8, anchor: "end", weight: 600 });

function cover(x: number, y: number, w: number, h: number) {
  const s = w / 42;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" style="fill:${L}"/><rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" style="stroke:${G};fill:none" stroke-width=".4" opacity=".6"/>` +
    ["A WIZARD", "OF", "EARTHSEA"].map((line, i) => t(x + w / 2, y + 20 * s + i * 6.5 * s, line, { size: 4.6 * s, ls: 0.8, weight: 700, fill: G })).join("") +
    t(x + w / 2, y + h - 8 * s, "LE GUIN", { size: 3.6 * s, ls: 0.8, fill: G });
}

export function front(w: number) {
  const [, line] = colors("star", "paper");
  const a = 135, r = 64;
  const sx = 125 + r * Math.sin((a * Math.PI) / 180), sy = 134 - r * Math.cos((a * Math.PI) / 180);
  return inject(afterRings(base("star", "paper", w), dial(line, { gapAt: a })), text(line, 125, 297, "WITH A STREAK OF THE LAMPLIGHTER", 5.6, 1.5) + seal("star", "lamp", "paper", +sx.toFixed(1), +sy.toFixed(1)));
}

export function chosen(w: number) {
  const q = ["No one would have believed", "in the last years of", "the nineteenth century…"];
  return frame(
    t(125, 38, "SIGNATURE BOOK", { size: 6.5, ls: 2.6, weight: 600 }) +
    cover(99, 48, 52, 77) +
    t(125, 141, "A Wizard of Earthsea", { size: 12, font: SERIF }) +
    t(125, 153, "URSULA K. LE GUIN", { size: 5.8, ls: 1.4, weight: 600 }) +
    divider(170) +
    t(125, 202, "“", { size: 36, font: SERIF, op: 0.3 }) +
    q.map((line, i) => t(125, 197 + i * 15, line, { size: 11, font: SERIF, italic: true })).join("") +
    t(125, 250, "H. G. WELLS · THE WAR OF THE WORLDS", { size: 5.2, ls: 1.2, weight: 600, op: 0.85 }) +
    foot("CHOSEN", "chosen by the reader"), w);
}

export function evidence(owner: boolean, w: number) {
  const rows: Array<[string, string, boolean?]> = [
    ["Finished", "48"],
    ["Fantasy & SF", "22 · 46%"],
    ["Mystery & crime", "8"],
    ["Classics & literary", "7"],
    ["History & memoir", "5"],
    ["With highlights", "14"],
    ["Runner-up", "Lamplighter"],
    ["Most-read author", "Le Guin · 6", true],
    ["Series", "Earthsea · 4", true],
  ];
  let y = 80, body = "";
  for (const [k, v, ownerOnly] of rows) {
    if (ownerOnly && !owner) continue;
    const op = ownerOnly ? 0.7 : 1;
    body += t(30, y, `${ownerOnly ? `${OWN} ` : ""}${k}`, { size: 7.2, font: MONO, anchor: "start", op });
    body += t(220, y, v, { size: 7.2, font: MONO, anchor: "end", weight: 700, op });
    body += rule(y + 4, 30, 220, 0.4, `stroke-dasharray=".6 1.8" opacity=".6"`);
    y += 16;
  }
  const ly = 262;
  let ticks = "";
  for (let i = 0; i < 9; i++) ticks += `<path d="M${36 + i * 3.4} ${ly}V${ly - (i < 3 ? 8 : 5)}" style="stroke:${L};fill:none" stroke-width="${i < 3 ? 1.1 : 0.6}" stroke-linecap="round"/>`;
  body += ticks + t(72, ly - 1, "the dial: one mark per finished book;", { size: 6.2, font: SERIF, italic: true, anchor: "start" }) + t(72, ly + 9, "long marks carry your highlights", { size: 6.2, font: SERIF, italic: true, anchor: "start" });
  return frame(
    t(125, 40, "READER’S RECORD", { size: 8.5, ls: 3.2, weight: 600 }) +
    t(125, 52, "THE STARGAZER · PLATE IV", { size: 5.8, ls: 1.6, weight: 600, op: 0.8 }) +
    rule(59, 30, 220, 0.9) + rule(61.5, 30, 220, 0.4) + body + foot("RECORD", "genres known for 44 of 48 finished books"), w);
}

export function merged(owner: boolean, w: number) {
  const rows: Array<[string, string, boolean?]> = [
    ["Finished", "48"],
    ["Fantasy & SF", "22 · 46%"],
    ["With highlights", "14"],
    ["Runner-up", "Lamplighter"],
    ["Most-read author", "Le Guin · 6", true],
    ["Series", "Earthsea · 4", true],
  ];
  let body = cover(30, 30, 40, 59) +
    t(80, 44, "SIGNATURE BOOK", { size: 5.4, ls: 2, weight: 600, anchor: "start" }) +
    t(80, 60, "A Wizard of", { size: 11, font: SERIF, anchor: "start" }) + t(80, 73, "Earthsea", { size: 11, font: SERIF, anchor: "start" }) +
    t(80, 85, "URSULA K. LE GUIN", { size: 5.4, ls: 1.3, weight: 600, anchor: "start" }) +
    ["“No one would have believed in the", "last years of the nineteenth century…”"].map((line, i) => t(125, 112 + i * 13, line, { size: 9, font: SERIF, italic: true })).join("") +
    t(125, 146, "H. G. WELLS · THE WAR OF THE WORLDS", { size: 5, ls: 1.2, weight: 600, op: 0.85 }) +
    rule(158, 30, 220, 0.9) + rule(160.5, 30, 220, 0.4);
  let y = 178;
  for (const [k, v, ownerOnly] of rows) {
    if (ownerOnly && !owner) continue;
    const op = ownerOnly ? 0.7 : 1;
    body += t(30, y, `${ownerOnly ? `${OWN} ` : ""}${k}`, { size: 7, font: MONO, anchor: "start", op }) + t(220, y, v, { size: 7, font: MONO, anchor: "end", weight: 700, op }) + rule(y + 4, 30, 220, 0.4, `stroke-dasharray=".6 1.8" opacity=".6"`);
    y += 15.5;
  }
  return frame(body + foot("PLATE IV", "genres known for 44 of 48 finished books"), w);
}

export function spread(owner: boolean, w: number) {
  const page = (svg: string, x: number) => svg.replace(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 250 350" width="[\d.]+" height="[\d.]+">/, `<svg x="${x}" y="0" viewBox="0 0 250 350" width="250" height="350">`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 350" width="${w}" height="${+(w * 0.7).toFixed(1)}">
<defs><linearGradient id="gut" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".5" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
${page(chosen(250), 0)}${page(evidence(owner, 250), 250)}<rect x="232" y="0" width="36" height="350" fill="url(#gut)"/></svg>`;
}

const arrow = `<div style="align-self:center;color:#777;font-size:22px">→</div>`;
const fig = (svg: string, cap: string) => `<figure style="margin:0;text-align:center">${svg}<figcaption style="color:#555;font-size:12px;margin-top:4px">${cap}</figcaption></figure>`;
const row = (inner: string) => `<div style="display:flex;gap:12px;justify-content:center;align-items:flex-start;padding:16px;background:#e7e2d8;flex-wrap:wrap">${inner}</div>`;
const card = (id: string, letter: string, title: string, desc: string, body: string) => `
  <div class="card" data-choice="${id}" onclick="toggleSelect(this)">
    <div class="card-image" style="height:auto;aspect-ratio:auto;min-height:0">${body}</div>
    <div class="card-body"><h3>${letter} · ${title}</h3><p>${desc}</p></div>
  </div>`;

if (process.argv[1]?.endsWith("pages.ts")) writeFileSync(out, `
<h2>Juntar 1 e 2, ou duas páginas?</h2>
<p class="subtitle">Ao separar o verso, os dois lados alinham com a regra de privacidade: a página 2 é o que escolheste (público) e a página 3 é o que foi calculado (com as linhas ◇ só para ti).</p>
<div class="cards" style="grid-template-columns:1fr">
${card("three", "X", "Três faces, toque a toque", "Frente → Escolhido → Ficha → frente. Cada toque vira a carta, e três pontos mostram onde estás. Se não escolheste nada, os visitantes saltam a página 2 e tu vês lá um convite para escolher.", row(fig(front(170), "frente") + arrow + fig(chosen(170), "2 · escolhido") + arrow + fig(evidence(true, 170), "3 · ficha (tu)")))}
${card("book", "Y", "A carta abre como um livro", "A frente é a capa. Tocar abre-a e mostra o interior: Escolhido à esquerda, Ficha à direita. Num ecrã largo vês as duas lado a lado; no telemóvel deslizas de uma para a outra. É a metáfora mais \"livro\", mas dá mais trabalho a animar.", row(fig(front(150), "capa") + arrow + fig(spread(true, 380), "interior aberto (tu)")))}
${card("merged", "Z", "Um só verso, fundido", "A capa pequena e o destaque em cima, a ficha em baixo. Há só um virar, mas cabe menos: entra só o género principal em vez dos cinco e não há legenda do mostrador.", row(fig(front(170), "frente") + arrow + fig(merged(true, 170), "verso (tu)") + fig(merged(false, 170), "verso (visitante)")))}
</div>
`);
