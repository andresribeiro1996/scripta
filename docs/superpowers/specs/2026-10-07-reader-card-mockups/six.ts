import { writeFileSync } from "node:fs";
import { INK, card, motto, foil, aged, afterGround, afterOpen, footer, CORNERS, at, deco, fleuron } from "./extras.ts";

const out = process.argv[2];
export const SERIF = "'Playfair Display', Georgia, serif";
export const PAPER = "#f1eadb";
export const WORDS = "Per libros ad astra";
let uid = 100;

export const lift = (svg: string) => svg.replace(` y="45" text-anchor="middle" font-size="8.5"`, ` y="31" text-anchor="middle" font-size="6"`);
export const add = (svg: string, extra: string) => { const i = svg.lastIndexOf("</svg>"); return svg.slice(0, i) + extra + svg.slice(i); };
export const mtext = (y: number, size = 8, extra = "") => `<text x="125" y="${y}" text-anchor="middle" font-size="${size}" font-style="italic" font-family="${SERIF}" letter-spacing=".6" style="fill:${INK}" ${extra}>${WORDS}</text>`;
export const crop = (svg: string, vb: string, w: number, h: number) => svg.replace(/viewBox="0 0 250 350" width="[\d.]+" height="[\d.]+"/, `viewBox="${vb}" width="${w}" height="${h}"`);

export const mottos: Array<[string, string]> = [
  ["fita (atual)", motto(card(), WORDS)],
  ["pergaminho", add(lift(card()),
    `<path d="M74 39H176V55H74Z" style="fill:${PAPER};stroke:${INK}" stroke-width=".9"/>` +
    [72, 178].map((x) => `<ellipse cx="${x}" cy="47" rx="4" ry="9" style="fill:${PAPER};stroke:${INK}" stroke-width=".9"/><ellipse cx="${x}" cy="47" rx="1.6" ry="4.5" style="stroke:${INK};fill:none" stroke-width=".6"/>`).join("") + mtext(50.5))],
  ["em arco", (() => { const id = `arc${uid++}`; return add(lift(card()), `<defs><path id="${id}" d="M56.1 97.4A78 78 0 0 1 193.9 97.4"/></defs><text font-size="8.5" font-style="italic" font-family="${SERIF}" letter-spacing="1" style="fill:${INK}"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${WORDS}</textPath></text>`); })()],
  ["cartela", add(lift(card()),
    `<rect x="76" y="37" width="98" height="21" rx="10.5" style="fill:${PAPER};stroke:${INK}" stroke-width="1"/><rect x="79" y="40" width="92" height="15" rx="7.5" style="stroke:${INK};fill:none" stroke-width=".45"/><circle cx="73" cy="47.5" r="1.4" style="fill:${INK}"/><circle cx="177" cy="47.5" r="1.4" style="fill:${INK}"/>` + mtext(50.5, 7.6))],
  ["linha simples", add(lift(card()),
    `<path d="M58 47.5H84M166 47.5H192" style="stroke:${INK};fill:none" stroke-width=".7"/><path d="M58 45.3L60.2 47.5L58 49.7L55.8 47.5ZM192 45.3L194.2 47.5L192 49.7L189.8 47.5Z" style="fill:${INK}"/>` + mtext(50.5, 8.4))],
  ["faixa sob o emblema", add(card(),
    `<path d="M70 200H82V214H70L74 207Z" style="fill:${INK}" opacity=".85"/><path d="M180 200H168V214H180L176 207Z" style="fill:${INK}" opacity=".85"/><path d="M80 197.5H170V210.5H80Z" style="fill:${PAPER};stroke:${INK}" stroke-width="1"/>` + mtext(206.6, 7.2))],
];

export const monogram = `<circle cx="214" cy="318" r="7.5" style="stroke:${INK};fill:none" stroke-width=".8"/><circle cx="214" cy="318" r="6" style="stroke:${INK};fill:none" stroke-width=".35"/><text x="214" y="320.4" text-anchor="middle" font-size="6.4" font-family="${SERIF}" style="fill:${INK}">AR</text>`;
export const foot = (svg: string) => crop(svg, "0 286 250 50", 300, 60);
export const footers: Array<[string, string]> = [
  ["placa · nome (atual)", foot(card())],
  ["leitor desde · @handle", foot(footer(card(), "READER SINCE 2014", "@ANDRE"))],
  ["volumes · iniciais", foot(footer(card(), "XLVIII VOLUMES", "A. R."))],
  ["fundação · primeiro nome", foot(footer(card(), "EST. MMXIV", "ANDRÉ"))],
  ["género principal · monograma", foot(add(footer(card(), "FANTASY &amp; SF", ""), monogram))],
  ["nada · nada", foot(footer(card(), "", ""))],
];

function linen(svg: string) {
  const id = `lin${uid++}`;
  return afterGround(svg.replaceAll(PAPER, "#ece3cf"), `<defs><pattern id="${id}" width="2.2" height="2.2" patternUnits="userSpaceOnUse"><path d="M0 .2H2.2M.2 0V2.2" stroke="#7a6a48" stroke-width=".35" opacity=".32"/></pattern></defs><rect width="250" height="350" rx="4" fill="url(#${id})"/>`);
}

function letterpress(svg: string) {
  const f = `lp${uid++}`, n = `fib${uid++}`;
  svg = svg.replaceAll(PAPER, "#f5f0e6");
  const i = svg.indexOf(`rx="4"/>`) + 8;
  const end = svg.lastIndexOf("</svg>");
  const defs = `<defs><filter id="${f}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feOffset in="SourceAlpha" dx=".5" dy=".6" result="o"/><feFlood flood-color="#fff" flood-opacity=".95"/><feComposite in2="o" operator="in" result="hl"/><feOffset in="SourceAlpha" dx="-.25" dy="-.3" result="o2"/><feFlood flood-color="#000" flood-opacity=".22"/><feComposite in2="o2" operator="in" result="sh"/><feMerge><feMergeNode in="sh"/><feMergeNode in="hl"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="${n}"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .45 0 0 0 0 .38 0 0 0 0 .3 0 0 0 .12 0"/></filter></defs><rect width="250" height="350" rx="4" filter="url(#${n})"/>`;
  return svg.slice(0, i) + defs + `<g filter="url(#${f})">` + svg.slice(i, end) + `</g>` + svg.slice(end);
}

function holo(svg: string) {
  const id = `holo${uid++}`, s = `sheen${uid++}`;
  const defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1" spreadMethod="reflect"><stop offset="0" stop-color="#5b3b6e"/><stop offset=".25" stop-color="#2b7f93"/><stop offset=".5" stop-color="#b89a2e"/><stop offset=".75" stop-color="#a8406f"/><stop offset="1" stop-color="#5b3b6e"/><animateTransform attributeName="gradientTransform" type="translate" values="-.8 -.8;.8 .8;-.8 -.8" dur="6s" repeatCount="indefinite"/></linearGradient><linearGradient id="${s}" x1="0" y1="0" x2="1" y2=".6" spreadMethod="reflect"><stop offset="0" stop-color="#7fd6e8" stop-opacity="0"/><stop offset=".4" stop-color="#e8a0d8" stop-opacity=".16"/><stop offset=".6" stop-color="#f0e08a" stop-opacity=".16"/><stop offset="1" stop-color="#7fd6e8" stop-opacity="0"/><animateTransform attributeName="gradientTransform" type="translate" values="-1 0;1 0;-1 0" dur="6s" repeatCount="indefinite"/></linearGradient></defs>`;
  return afterGround(afterOpen(svg.replaceAll(INK, `url(#${id})`), defs), `<rect width="250" height="350" rx="4" fill="url(#${s})"/>`);
}

export const W2 = 142;
export const finishes: Array<[string, string]> = [
  ["papel (atual)", card("paper", W2)],
  ["envelhecido", aged(card("paper", W2))],
  ["linho", linen(card("paper", W2))],
  ["relevo (tipografia)", letterpress(card("paper", W2))],
  ["foil", foil(card("paper", W2))],
  ["holográfico", holo(card("paper", W2))],
];

const photo = at((sx, sy) => {
  const x0 = sx > 0 ? 10 : 240, y0 = sy > 0 ? 10 : 340;
  return `<path d="M${x0} ${y0}L${x0 + 28 * sx} ${y0}L${x0} ${y0 + 28 * sy}Z" style="fill:${INK}"/><path d="M${x0 + 22 * sx} ${y0 + 2.5 * sy}L${x0 + 2.5 * sx} ${y0 + 22 * sy}" style="stroke:${PAPER};fill:none" stroke-width=".7"/>`;
});
const stars = at((sx, sy, cx, cy) => {
  const s = (x: number, y: number, r: number, k = 0.24) => `M${x} ${y - r}L${x + r * k} ${y - r * k}L${x + r} ${y}L${x + r * k} ${y + r * k}L${x} ${y + r}L${x - r * k} ${y + r * k}L${x - r} ${y}L${x - r * k} ${y - r * k}Z`;
  return `<path d="${s(cx, cy, 7)}" style="fill:${INK}"/><path d="${s(cx + 14 * sx, cy, 2.6)}${s(cx, cy + 14 * sy, 2.6)}" style="fill:${INK}"/>`;
});
const laurel = at((sx, sy, cx, cy) => {
  const A = [cx + 30 * sx, cy + 3 * sy], C = [cx + 5 * sx, cy + 5 * sy], B = [cx + 3 * sx, cy + 30 * sy];
  const q = (t: number, k: number) => (1 - t) ** 2 * A[k] + 2 * (1 - t) * t * C[k] + t * t * B[k];
  const dq = (t: number, k: number) => 2 * (1 - t) * (C[k] - A[k]) + 2 * t * (B[k] - C[k]);
  let leaves = "";
  for (const t of [0.12, 0.26, 0.4, 0.6, 0.74, 0.88]) {
    const x = q(t, 0), y = q(t, 1), ang = (Math.atan2(dq(t, 1), dq(t, 0)) * 180) / Math.PI;
    for (const side of [-1, 1]) leaves += `<ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="3" ry="1.15" transform="rotate(${(ang + side * 38).toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)}) translate(${2.4} 0)" style="fill:${INK}"/>`;
  }
  return `<path d="M${A[0]} ${A[1]}Q${C[0]} ${C[1]} ${B[0]} ${B[1]}" style="stroke:${INK};fill:none" stroke-width=".7"/>${leaves}<circle cx="${cx}" cy="${cy}" r="1.6" style="fill:${INK}"/>`;
});
export const corner = (svg: string) => crop(svg, "0 0 100 100", 128, 128);
export const corners: Array<[string, string]> = [
  ["losangos (atual)", corner(card())],
  ["art déco", corner(card().replace(CORNERS, deco))],
  ["florões", corner(card().replace(CORNERS, fleuron))],
  ["cantoneiras", corner(card().replace(CORNERS, photo))],
  ["estrelas", corner(card().replace(CORNERS, stars))],
  ["louros", corner(card().replace(CORNERS, laurel))],
];

export const grid = (items: Array<[string, string]>, min: number) => `<div style="width:100%;box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fill,minmax(${min}px,1fr));gap:12px;padding:16px;background:#e7e2d8;justify-items:center">${items.map(([cap, svg]) => `<figure style="margin:0;text-align:center">${svg}<figcaption style="color:#555;font-size:11.5px;margin-top:4px">${cap}</figcaption></figure>`).join("")}</div>`;
const option = (letter: string, title: string, desc: string, body: string) => `
  <div class="card" style="cursor:default">
    <div class="card-image" style="height:auto;aspect-ratio:auto;min-height:0">${body}</div>
    <div class="card-body"><h3>${letter} · ${title}</h3><p>${desc}</p></div>
  </div>`;

if (process.argv[1]?.endsWith("six.ts")) writeFileSync(out, `
<h2>Seis opções para A, B, C e D</h2>
<p class="subtitle">Estão incluídas as que já tinhas visto. Diz quais cortas ou trocas.</p>
<div class="cards" style="grid-template-columns:1fr">
${option("A", "Lema: seis estilos (o texto é teu)", "O lema é sempre texto livre. O que muda é a forma de o mostrar. Na faixa sob o emblema o EX LIBRIS fica no sítio; nas outras sobe e fica mais pequeno.", grid(mottos.map(([c, s]) => [c, crop(s, "30 18 190 210", 190, 210)]), 200))}
${option("B", "Rodapé: seis opções por canto", "À esquerda: placa, leitor desde, volumes, fundação (ano em romano), género principal ou nada. À direita: nome, @handle, iniciais, primeiro nome, monograma ou nada. Os exemplos são seis combinações; na prática, cada canto escolhe-se em separado.", grid(footers, 310))}
${option("C", "Acabamento: seis", "O linho é uma trama fina no papel. O relevo usa papel de algodão com a tinta afundada, como na tipografia. O foil e o holográfico estão animados aqui; no telemóvel seguiriam a inclinação do aparelho.", grid(finishes, 150))}
${option("D", "Ornamentos: seis (canto superior esquerdo ampliado)", "As cantoneiras lembram os cantos de fotografia num álbum. Os louros são ramos que acompanham o canto.", grid(corners, 140))}
</div>
`);
