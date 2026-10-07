import { writeFileSync } from "node:fs";
import { INK, card, afterGround, footer, CORNERS, at } from "./extras.ts";
import { SERIF, PAPER, WORDS, lift, add, mtext, crop, mottos, foot, footers, finishes, corners, corner, W2 } from "./six.ts";
import { renderGlyphSvg } from "./lib.ts";

const out = process.argv[2];
const SCRIPT = "'Snell Roundhand','Apple Chancery','Brush Script MT',cursive";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const RUNNER = "#2f5a3d";
let uid = 500;
const NEW = " ✦";

const wrapAfterGround = (svg: string, open: string, close: string, before = "") => {
  const i = svg.indexOf(`rx="4"/>`) + 8, end = svg.lastIndexOf("</svg>");
  return svg.slice(0, i) + before + open + svg.slice(i, end) + close + svg.slice(end);
};

const newMottos: Array<[string, string]> = [
  ["fita ondulada" + NEW, (() => { const id = `wv${uid++}`; return add(lift(card()),
    `<path d="M62 46L70 44V57L62 59L66 52Z" style="fill:${INK}" opacity=".85"/><path d="M188 46L180 44V57L188 59L184 52Z" style="fill:${INK}" opacity=".85"/>` +
    `<path d="M70 44C85 38 100 50 125 44S165 38 180 44V57C165 51 150 63 125 57S85 51 70 57Z" style="fill:${PAPER};stroke:${INK}" stroke-width=".9"/>` +
    `<defs><path id="${id}" d="M72 53C87 47 102 59 125 53S163 47 178 53"/></defs><text font-size="7.6" font-style="italic" font-family="${SERIF}" letter-spacing=".5" style="fill:${INK}"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${WORDS}</textPath></text>`); })()],
  ["entre filetes" + NEW, add(lift(card()),
    `<path d="M48 36.5H202M48 38.6H202M48 55.4H202M48 57.5H202" style="stroke:${INK};fill:none" stroke-width=".55"/>` +
    `<text x="125" y="49.6" text-anchor="middle" font-size="6.8" letter-spacing="2.4" font-weight="600" font-family="${SANS}" style="fill:${INK}">PER LIBROS AD ASTRA</text>`)],
  ["capitular" + NEW, add(lift(card()),
    `<rect x="72" y="36" width="18" height="20" style="stroke:${INK};fill:none" stroke-width=".9"/><rect x="74" y="38" width="14" height="16" style="stroke:${INK};fill:none" stroke-width=".4"/>` +
    `<text x="81" y="51.5" text-anchor="middle" font-size="15" font-family="${SERIF}" style="fill:${INK}">P</text>` +
    `<text x="94" y="50.5" font-size="8.6" font-style="italic" font-family="${SERIF}" style="fill:${INK}">er libros ad astra</text>`)],
  ["faixa diagonal" + NEW, (() => { const clip = `cl${uid++}`; return add(card(),
    `<defs><clipPath id="${clip}"><rect x="16" y="16" width="218" height="318"/></clipPath></defs><g clip-path="url(#${clip})"><g transform="rotate(45 200 50)">` +
    `<rect x="140" y="43" width="120" height="14" style="fill:${INK}"/><path d="M140 45.2H260M140 54.8H260" style="stroke:${PAPER};fill:none" stroke-width=".4"/>` +
    `<text x="200" y="52.6" text-anchor="middle" font-size="6.8" font-style="italic" font-family="${SERIF}" style="fill:${PAPER}">${WORDS}</text></g></g>`); })()],
  ["manuscrito" + NEW, add(lift(card()),
    `<text x="125" y="51" text-anchor="middle" font-size="12.5" font-family="${SCRIPT}" style="fill:${INK}">${WORDS}</text>` +
    `<path d="M72 56.5Q125 62.5 178 55" style="stroke:${INK};fill:none" stroke-width=".7" stroke-linecap="round"/>`)],
  ["placa gravada" + NEW, add(lift(card()),
    `<path d="M71 37H179L182 40V52L179 55H71L68 52V40Z" style="fill:${INK}"/><path d="M72.5 39H177.5L180 41.5V50.5L177.5 53H72.5L70 50.5V41.5Z" style="stroke:${PAPER};fill:none" stroke-width=".4"/>` +
    `<text x="125" y="49.3" text-anchor="middle" font-size="8" font-style="italic" font-family="${SERIF}" letter-spacing=".5" style="fill:${PAPER}">${WORDS}</text>`)],
];

const glyphAt = (x: number, y: number, size: number) => renderGlyphSvg("star", size).replace("<svg ", `<svg x="${x}" y="${y}" `);
const diamondMono = `<path d="M214 309L223 318L214 327L205 318Z" style="stroke:${INK};fill:none" stroke-width=".8"/><text x="214" y="320.3" text-anchor="middle" font-size="6" font-family="${SERIF}" style="fill:${INK}">AR</text>`;
const newFooters: Array<[string, string]> = [
  ["placa e nome · catálogo" + NEW, foot(footer(card(), "IV · STARGAZER", "RIBEIRO, A."))],
  ["glifo · assinatura" + NEW, foot(add(footer(card(), "", ""), glyphAt(29, 310.5, 14) + `<text x="221" y="323" text-anchor="end" font-size="12" font-family="${SCRIPT}" style="fill:${INK}">André Ribeiro</text>`))],
  ["destaques · nome e inicial" + NEW, foot(footer(card(), "CXL HIGHLIGHTS", "ANDRÉ R."))],
  ["séries · monograma em losango" + NEW, foot(add(footer(card(), "XII SERIES", ""), diamondMono))],
  ["edição · apelido" + NEW, foot(footer(card(), "EDITION MMXXVI", "RIBEIRO"))],
  ["número de leitor · nome" + NEW, foot(footer(card(), "Nº XLII", "ANDRÉ RIBEIRO"))],
];

function vellum(svg: string) {
  const f = `vel${uid++}`, v = `vv${uid++}`;
  return afterGround(svg.replaceAll(PAPER, "#efe2c4"),
    `<defs><filter id="${f}"><feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="3" seed="9"/><feColorMatrix values="0 0 0 0 .55 0 0 0 0 .4 0 0 0 0 .2 0 0 0 .55 -.12"/></filter><radialGradient id="${v}" cx=".5" cy=".45" r=".7"><stop offset=".6" stop-color="#8a6a3a" stop-opacity="0"/><stop offset="1" stop-color="#8a6a3a" stop-opacity=".22"/></radialGradient></defs><rect width="250" height="350" rx="4" filter="url(#${f})"/><rect width="250" height="350" rx="4" fill="url(#${v})"/>`);
}
function watercolor(svg: string) {
  const f = `wc${uid++}`;
  return afterGround(svg,
    `<defs><filter id="${f}" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="5" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="16"/><feGaussianBlur stdDeviation="1.2"/></filter></defs>` +
    `<g filter="url(#${f})"><circle cx="125" cy="134" r="60" fill="${INK}" opacity=".15"/><ellipse cx="125" cy="244" rx="74" ry="17" fill="${INK}" opacity=".1"/><circle cx="170" cy="179" r="17" fill="${RUNNER}" opacity=".14"/></g>`);
}
function gilt(svg: string) {
  const g = `gilt${uid++}`;
  const defs = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1" spreadMethod="reflect"><stop offset="0" stop-color="#7d5e1c"/><stop offset=".45" stop-color="#e7cd78"/><stop offset=".55" stop-color="#f6e7b0"/><stop offset="1" stop-color="#8f6d22"/><animateTransform attributeName="gradientTransform" type="translate" values="-.5 -.5;.5 .5;-.5 -.5" dur="6s" repeatCount="indefinite"/></linearGradient></defs>`;
  svg = svg.replace(`style="stroke:${INK};fill:none" x="10" y="10"`, `style="stroke:url(#${g});fill:none" x="10" y="10"`)
    .replace(`style="stroke:${INK};fill:none" x="16" y="16"`, `style="stroke:url(#${g});fill:none" x="16" y="16"`)
    .replace(CORNERS, (m) => m.replace(`fill:${INK}`, `fill:url(#${g})`));
  return afterGround(svg, defs + `<rect x=".9" y=".9" width="248.2" height="348.2" rx="3.4" style="stroke:url(#${g});fill:none" stroke-width="1.8"/>`);
}
function stamp(svg: string) {
  const f = `st${uid++}`;
  return wrapAfterGround(svg, `<g filter="url(#${f})" transform="rotate(-1.4 125 175)">`, `</g>`,
    `<defs><filter id="${f}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="d"/><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="2" result="g"/><feColorMatrix in="g" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.2 0 0 0 1.75" result="gm"/><feComposite in="d" in2="gm" operator="in"/></filter></defs>`);
}
function kraft(svg: string) {
  const f = `kr${uid++}`;
  return afterGround(svg.replaceAll(PAPER, "#caa97c"),
    `<defs><filter id="${f}"><feTurbulence type="fractalNoise" baseFrequency=".7 .08" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 .3 0 0 0 0 .2 0 0 0 0 .1 0 0 0 .35 -.05"/></filter></defs><rect width="250" height="350" rx="4" filter="url(#${f})"/>`);
}
function riso(svg: string) {
  const f = `gr${uid++}`;
  const i = svg.indexOf(`rx="4"/>`) + 8, end = svg.lastIndexOf("</svg>");
  const content = svg.slice(i, end);
  const copy = content.replaceAll(INK, RUNNER).replaceAll(PAPER, "none").replace(/fill:none;stroke:none|style="fill:none"/g, `style="fill:none"`);
  return svg.slice(0, i) + `<g transform="translate(1.6 1.1)" opacity=".55" style="mix-blend-mode:multiply">${copy}</g><g style="mix-blend-mode:multiply">${content}</g>` +
    `<defs><filter id="${f}"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="8"/><feColorMatrix values="0 0 0 0 .2 0 0 0 0 .15 0 0 0 0 .1 0 0 0 .25 0"/></filter></defs><rect width="250" height="350" rx="4" filter="url(#${f})"/>` + svg.slice(end);
}
const newFinishes: Array<[string, string]> = [
  ["velino" + NEW, vellum(card("paper", W2))],
  ["aguarela" + NEW, watercolor(card("paper", W2))],
  ["dourado nas bordas" + NEW, gilt(card("paper", W2))],
  ["carimbo" + NEW, stamp(card("paper", W2))],
  ["kraft" + NEW, kraft(card("paper", W2))],
  ["riso (duas tintas)" + NEW, riso(card("paper", W2))],
];

const P = (sx: number, sy: number, cx: number, cy: number) => (u: number, v: number) => `${cx + u * sx} ${cy + v * sy}`;
const knot = at((sx, sy, cx, cy) => {
  const x = cx + 5 * sx, y = cy + 5 * sy;
  return `<circle cx="${cx}" cy="${cy}" r="9" style="fill:${PAPER}"/><ellipse cx="${x}" cy="${y}" rx="8" ry="3.2" transform="rotate(45 ${x} ${y})" style="stroke:${INK};fill:none" stroke-width="1"/><ellipse cx="${x}" cy="${y}" rx="8" ry="3.2" transform="rotate(-45 ${x} ${y})" style="stroke:${INK};fill:none" stroke-width="1"/><circle cx="${x}" cy="${y}" r="1.3" style="fill:${INK}"/>`;
});
const volute = at((sx, sy, cx, cy) => {
  const p = P(sx, sy, cx, cy), sw = sx * sy > 0 ? 1 : 0, sw2 = 1 - sw;
  return `<path d="M${p(28, 3)}Q${p(10, 3)} ${p(8, 8)}A4 4 0 1 ${sw2} ${p(13, 11)}A2 2 0 1 ${sw2} ${p(10, 8.5)}M${p(3, 28)}Q${p(3, 10)} ${p(8, 8)}" style="stroke:${INK};fill:none" stroke-width=".9" stroke-linecap="round"/>`;
});
const meander = at((sx, sy, cx, cy) => {
  const p = P(sx, sy, cx, cy);
  return `<path d="M${p(2, 26)}V${cy + 2 * sy}H${cx + 26 * sx}M${p(6, 22)}V${cy + 6 * sy}H${cx + 22 * sx}V${cy + 14 * sy}H${cx + 14 * sx}V${cy + 10 * sy}H${cx + 18 * sx}" style="stroke:${INK};fill:none" stroke-width=".8" stroke-linejoin="miter"/>`;
});
const rosette = at((_sx, _sy, cx, cy) => {
  let petals = "";
  for (let k = 0; k < 8; k++) petals += `<ellipse cx="${cx + 3.6}" cy="${cy}" rx="3.2" ry="1.25" transform="rotate(${k * 45} ${cx} ${cy})" style="fill:${INK}"/>`;
  return `<circle cx="${cx}" cy="${cy}" r="7.6" style="fill:${PAPER}"/>${petals}<circle cx="${cx}" cy="${cy}" r="1.3" style="fill:${PAPER}"/>`;
});
const register = at((_sx, _sy, cx, cy) => `<circle cx="${cx}" cy="${cy}" r="5.5" style="fill:${PAPER};stroke:${INK}" stroke-width=".7"/><circle cx="${cx}" cy="${cy}" r="2.4" style="stroke:${INK};fill:none" stroke-width=".5"/><path d="M${cx - 8} ${cy}H${cx + 8}M${cx} ${cy - 8}V${cy + 8}" style="stroke:${INK};fill:none" stroke-width=".5"/>`);
const newCorners: Array<[string, string]> = [
  ["nó" + NEW, corner(card().replace(CORNERS, knot))],
  ["volutas" + NEW, corner(card().replace(CORNERS, volute))],
  ["grega" + NEW, corner(card().replace(CORNERS, meander))],
  ["rosácea" + NEW, corner(card().replace(CORNERS, rosette))],
  ["marca de registo" + NEW, corner(card().replace(CORNERS, register))],
  ["nenhum" + NEW, corner(card().replace(CORNERS, ""))],
];

const grid = (items: Array<[string, string]>, min: number) => `<div style="width:100%;box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fill,minmax(${min}px,1fr));gap:12px;padding:16px;background:#e7e2d8;justify-items:center">${items.map(([cap, svg], i) => `<figure style="margin:0;text-align:center"><div style="position:relative">${svg}<span style="position:absolute;top:2px;left:4px;font-size:10px;color:#888">${i + 1}</span></div><figcaption style="color:#555;font-size:11.5px;margin-top:4px">${cap}</figcaption></figure>`).join("")}</div>`;
const option = (letter: string, title: string, desc: string, body: string) => `
  <div class="card" style="cursor:default">
    <div class="card-image" style="height:auto;aspect-ratio:auto;min-height:0">${body}</div>
    <div class="card-body"><h3>${letter} · ${title}</h3><p>${desc}</p></div>
  </div>`;

const motto = (s: string) => crop(s, "30 18 190 210", 170, 188);
writeFileSync(out, `
<h2>Doze opções para A, B, C e D</h2>
<p class="subtitle">As novas estão marcadas com ✦. Cada uma tem um número, para poderes dizer "fico com A 1, 3 e 9".</p>
<div class="cards" style="grid-template-columns:1fr">
${option("A", "Lema", "O manuscrito precisa de uma fonte de caligrafia carregada na app, porque hoje só existem a Playfair e a fonte do sistema. A faixa diagonal cobre o canto superior direito, tal como faria uma faixa de lacre.", grid([...mottos.map(([c, s]) => [c, motto(s)] as [string, string]), ...newMottos.map(([c, s]) => [c, motto(s)] as [string, string])], 180))}
${option("B", "Rodapé (cada canto escolhe-se em separado)", "Novos à esquerda: placa e nome da placa, glifo, destaques, séries, edição (o ano em que a carta foi composta) e número de leitor. Novos à direita: catálogo (\"RIBEIRO, A.\"), assinatura manuscrita, nome e inicial, monograma em losango e apelido. O número de leitor revela a ordem de inscrição na app, e isso é informação sobre os outros utilizadores.", grid([...footers, ...newFooters], 310))}
${option("C", "Acabamento", "Velino: pele translúcida e manchada. Aguarela: uma mancha da tinta da placa por trás do emblema, e da tinta do runner-up por trás do selo. Dourado: só a moldura e os cantos ficam a ouro. Carimbo: tinta irregular, falhada e ligeiramente torta. Kraft: papel de embrulho. Riso: impressão a duas tintas desalinhadas, com a segunda tinta a ser a do runner-up.", grid([...finishes, ...newFinishes], 150))}
${option("D", "Ornamentos (canto superior esquerdo ampliado)", "Nó, volutas, grega (meandro), rosácea, marca de registo de tipografia, ou nenhum, para uma moldura limpa.", grid([...corners, ...newCorners], 140))}
</div>
`);
