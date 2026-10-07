import { writeFileSync } from "node:fs";
import { colors } from "./lib.ts";

const out = process.argv[2];
const [G, L] = colors("star", "paper");
const SERIF = "'Playfair Display', Georgia, serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const MONO = "'Courier New', Courier, monospace";
const W = 200;

const t = (x: number, y: number, s: string, o: { size?: number; font?: string; ls?: number; anchor?: string; weight?: number; italic?: boolean; op?: number; fill?: string } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="${o.anchor ?? "middle"}" font-size="${o.size ?? 7}" font-family="${o.font ?? SANS}" letter-spacing="${o.ls ?? 0}" ${o.weight ? `font-weight="${o.weight}"` : ""} ${o.italic ? `font-style="italic"` : ""} opacity="${o.op ?? 1}" style="fill:${o.fill ?? L}">${s}</text>`;
const rule = (y: number, x0 = 30, x1 = 220, sw = 0.5, extra = "") => `<path d="M${x0} ${y}H${x1}" style="stroke:${L};fill:none" stroke-width="${sw}" ${extra}/>`;
const divider = (y: number) => `<path d="M82 ${y}H117M133 ${y}H168" style="stroke:${L};fill:none" stroke-width=".8"/><circle cx="125" cy="${y}" r="2" style="fill:${L}"/>`;
const OWN = "◇";

function frame(inner: string) {
  const corners = [[16, 16], [234, 16], [16, 334], [234, 334]].map(([x, y]) => `M${x} ${y - 4.5}L${x + 4.5} ${y}L${x} ${y + 4.5}L${x - 4.5} ${y}Z`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350" width="${W}" height="${W * 1.4}">
<rect width="250" height="350" rx="4" style="fill:${G}"/>
<rect x="10" y="10" width="230" height="330" style="stroke:${L};fill:none" stroke-width="1.6"/>
<rect x="16" y="16" width="218" height="318" style="stroke:${L};fill:none" stroke-width=".6"/>
<path d="${corners}" style="fill:${L}"/>${inner}</svg>`;
}

const footer = () => t(125, 298, "genres known for 44 of 48 finished books", { size: 6, font: SERIF, italic: true, op: 0.75 }) + rule(305) + t(30, 321, "PLATE IV", { size: 7.5, ls: 1.8, anchor: "start", weight: 600 }) + t(220, 321, "ANDRÉ RIBEIRO", { size: 7.5, ls: 1.8, anchor: "end", weight: 600 });

function record(owner: boolean) {
  const rows: Array<[string, string, boolean?]> = [
    ["Finished", "48"],
    ["Fantasy & SF", "22 · 46%"],
    ["With highlights", "14"],
    ["Most-read author", "Le Guin · 6", true],
    ["Series", "Earthsea · 4", true],
    ["Signature book", "A Wizard of Earthsea"],
  ];
  let y = 82, body = "";
  for (const [k, v, ownerOnly] of rows) {
    if (ownerOnly && !owner) continue;
    const op = ownerOnly ? 0.7 : 1;
    body += t(30, y, `${ownerOnly ? `${OWN} ` : ""}${k}`, { size: 7.4, font: MONO, anchor: "start", op });
    body += t(220, y, v, { size: 7.4, font: MONO, anchor: "end", weight: 700, op });
    body += rule(y + 4, 30, 220, 0.4, `stroke-dasharray=".6 1.8" opacity=".6"`);
    y += 17;
  }
  y += 10;
  body += t(30, y, "HIGHLIGHT", { size: 6, ls: 2, anchor: "start", weight: 600 });
  const q = ["“No one would have believed in the", "last years of the nineteenth", "century…”"];
  q.forEach((line, i) => { body += t(30, y + 16 + i * 14, line, { size: 9, font: SERIF, italic: true, anchor: "start" }) + rule(y + 19 + i * 14, 30, 220, 0.35, `opacity=".45"`); });
  body += t(220, y + 16 + q.length * 14 + 4, "— H. G. WELLS, THE WAR OF THE WORLDS", { size: 5, ls: 1, anchor: "end", weight: 600 });
  return frame(
    t(125, 40, "READER’S RECORD", { size: 8.5, ls: 3.2, weight: 600 }) +
    t(125, 52, "THE STARGAZER · PLATE IV", { size: 5.8, ls: 1.6, weight: 600, op: 0.8 }) +
    rule(59, 30, 220, 0.9) + rule(61.5, 30, 220, 0.4) + body + footer());
}

function cover(x: number, y: number, w: number, h: number) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" style="fill:${L}"/><rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" style="stroke:${G};fill:none" stroke-width=".4" opacity=".6"/>` +
    t(x + w / 2, y + 20, "A WIZARD", { size: 4.6, ls: 0.8, weight: 700, fill: G }) + t(x + w / 2, y + 26.5, "OF", { size: 4.6, ls: 0.8, weight: 700, fill: G }) + t(x + w / 2, y + 33, "EARTHSEA", { size: 4.6, ls: 0.8, weight: 700, fill: G }) +
    t(x + w / 2, y + h - 8, "LE GUIN", { size: 3.6, ls: 0.8, fill: G });
}

function classic(owner: boolean) {
  const q = ["No one would have believed", "in the last years of", "the nineteenth century…"];
  return frame(
    t(125, 38, "SIGNATURE BOOK", { size: 6.5, ls: 2.6, weight: 600 }) +
    cover(104, 47, 42, 62) +
    t(125, 124, "A Wizard of Earthsea", { size: 11, font: SERIF }) +
    t(125, 135, "URSULA K. LE GUIN", { size: 5.6, ls: 1.4, weight: 600 }) +
    divider(148) +
    t(125, 178, "“", { size: 34, font: SERIF, op: 0.3 }) +
    q.map((line, i) => t(125, 172 + i * 14, line, { size: 10, font: SERIF, italic: true })).join("") +
    t(125, 222, "H. G. WELLS · THE WAR OF THE WORLDS", { size: 5, ls: 1.2, weight: 600, op: 0.85 }) +
    [["48", "FINISHED", 62], ["46%", "FANTASY & SF", 125], ["14", "HIGHLIGHTED", 188]].map(([n, l, x]) => t(x as number, 256, n as string, { size: 17, font: SERIF }) + t(x as number, 267, l as string, { size: 5, ls: 1.2, weight: 600 })).join("") +
    (owner ? t(125, 283, `${OWN} MOST READ: LE GUIN (6) · EARTHSEA (4)`, { size: 5.4, ls: 1.1, weight: 600, op: 0.7 }) : "") +
    footer());
}

function colophon(owner: boolean) {
  const prose = ["This card was set from", "forty-eight finished books.", "Twenty-two are fantasy or", "science fiction; fourteen carry", "the reader’s own highlights."];
  const ownerProse = ["Its reader returns most often", "to Ursula K. Le Guin."];
  let y = 66, body = "";
  for (const line of prose) { body += t(125, y, line, { size: 9, font: SERIF }); y += 12.5; }
  if (owner) for (const line of ownerProse) { body += t(125, y, line, { size: 9, font: SERIF, op: 0.65 }); y += 12.5; }
  const fy = owner ? 168 : 146;
  body += `<path d="M125 ${fy - 4}L129 ${fy}L125 ${fy + 4}L121 ${fy}Z" style="fill:${L}"/><circle cx="113" cy="${fy}" r="1.3" style="fill:${L}"/><circle cx="137" cy="${fy}" r="1.3" style="fill:${L}"/>`;
  const by = fy + 22;
  body += t(125, by, "SIGNATURE BOOK", { size: 6, ls: 2.4, weight: 600 }) + t(125, by + 15, "A Wizard of Earthsea", { size: 11, font: SERIF, italic: true }) + t(125, by + 26, "URSULA K. LE GUIN", { size: 5.6, ls: 1.4, weight: 600 });
  const qy = by + 50;
  body += ["“No one would have believed", "in the last years of the", "nineteenth century…”"].map((line, i) => t(125, qy + i * 13, line, { size: 9.5, font: SERIF, italic: true })).join("");
  body += t(125, qy + 3 * 13 + 2, "H. G. WELLS · THE WAR OF THE WORLDS", { size: 5, ls: 1.2, weight: 600, op: 0.85 });
  return frame(t(125, 40, "COLOPHON", { size: 8.5, ls: 3.4, weight: 600 }) + body + footer());
}

const pair = (make: (owner: boolean) => string) => `
  <div style="display:flex;gap:14px;justify-content:center;padding:16px;background:#e7e2d8">
    <figure style="margin:0;text-align:center">${make(true)}<figcaption style="color:#555;font-size:12px;margin-top:4px">o que tu vês</figcaption></figure>
    <figure style="margin:0;text-align:center">${make(false)}<figcaption style="color:#555;font-size:12px;margin-top:4px">o que um visitante vê</figcaption></figure>
  </div>`;

const card = (id: string, letter: string, title: string, desc: string, body: string) => `
  <div class="card" data-choice="${id}" onclick="toggleSelect(this)">
    <div class="card-image">${body}</div>
    <div class="card-body"><h3>${letter} · ${title}</h3><p>${desc}</p></div>
  </div>`;

writeFileSync(out, `
<h2>Verso da carta</h2>
<p class="subtitle">Tocar na carta vira-a. O verso junta a evidência e as tuas escolhas: livro-assinatura e destaque. O que leva ◇ e aparece mais claro só tu vês. O resto é público, como decidimos.</p>
<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(470px,1fr))">
${card("record", "1", "Ficha de leitor", "Como a ficha de requisição de uma biblioteca: linhas datilografadas com os números, a evidência e o livro-assinatura, e o destaque escrito nas linhas pautadas. É a mais legível e a que mais se distingue da frente gravada.", pair(record))}
${card("classic", "2", "Verso clássico", "Na mesma linguagem da frente: a capa do livro-assinatura em cima, o destaque como peça central, e três números em baixo. A capa real viria do catálogo.", pair(classic))}
${card("colophon", "3", "Colofão", "Como a página final de um livro: a evidência contada em prosa gerada a partir dos dados, um florão, o livro-assinatura e o destaque. É a mais literária, mas os números ficam mais difíceis de ler de relance.", pair(colophon))}
</div>
<div class="section" style="margin-top:20px">
  <p class="label">Dados de exemplo</p>
  <p>O destaque é de um livro em domínio público (Wells). O livro-assinatura e o destaque são escolhas independentes. Se o leitor não escolher nenhum, essa zona fica vazia ou passa a mostrar só os números.</p>
</div>
`);
