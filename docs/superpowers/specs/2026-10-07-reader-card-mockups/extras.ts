import { writeFileSync } from "node:fs";
import { base, colors, dial, afterRings, inject, seal, text, type Print } from "./lib.ts";

const out = process.argv[2];
const W = 136;
export const INK = "#5b3b6e";
let uid = 0;

export function card(print: Print = "paper", w = W) {
  const [, line] = colors("star", print);
  const a = 135, r = 64;
  const sx = 125 + r * Math.sin((a * Math.PI) / 180), sy = 134 - r * Math.cos((a * Math.PI) / 180);
  return inject(afterRings(base("star", print, w), dial(line, { gapAt: a })), text(line, 125, 297, "WITH A STREAK OF THE LAMPLIGHTER", 5.6, 1.5) + seal("star", "lamp", print, +sx.toFixed(1), +sy.toFixed(1)));
}

export const afterGround = (svg: string, extra: string) => { const i = svg.indexOf(`rx="4"/>`) + 8; return svg.slice(0, i) + extra + svg.slice(i); };
export const afterOpen = (svg: string, extra: string) => { const i = svg.indexOf(">") + 1; return svg.slice(0, i) + extra + svg.slice(i); };

export function motto(svg: string, words: string) {
  const ribbon = `<path d="M62 41H72V57H62L66 49Z" style="fill:${INK}" opacity=".85"/><path d="M188 41H178V57H188L184 49Z" style="fill:${INK}" opacity=".85"/>` +
    `<path d="M70 38H180V54H70Z" style="fill:#f1eadb;stroke:${INK}" stroke-width="1"/><path d="M70 54L74 58V54M180 54L176 58V54" style="fill:${INK}"/>` +
    `<text x="125" y="49.5" text-anchor="middle" font-size="8" font-style="italic" font-family="'Playfair Display', Georgia, serif" letter-spacing=".6" style="fill:${INK}">${words}</text>`;
  return inject(svg.replace(` y="45" text-anchor="middle" font-size="8.5"`, ` y="31" text-anchor="middle" font-size="6"`), ribbon);
}

export const footer = (svg: string, left: string, right: string) => svg.replace(">PLATE IV<", `>${left}<`).replace(">ANDRÉ RIBEIRO<", `>${right}<`);

export function foil(svg: string) {
  const id = `foil${uid++}`;
  const defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1" spreadMethod="reflect"><stop offset="0" stop-color="#3a2049"/><stop offset=".35" stop-color="#7d5a96"/><stop offset=".5" stop-color="#e3d2ee"/><stop offset=".65" stop-color="#7d5a96"/><stop offset="1" stop-color="#3a2049"/><animateTransform attributeName="gradientTransform" type="translate" values="-.6 -.6;.6 .6;-.6 -.6" dur="5s" repeatCount="indefinite"/></linearGradient></defs>`;
  return afterOpen(svg.replaceAll(INK, `url(#${id})`), defs);
}

export function aged(svg: string) {
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let spots = "";
  for (let i = 0; i < 26; i++) spots += `<circle cx="${(rand() * 250).toFixed(1)}" cy="${(rand() * 350).toFixed(1)}" r="${(0.6 + rand() * 3.2).toFixed(1)}" fill="#8a5a2b" opacity="${(0.05 + rand() * 0.12).toFixed(2)}"/>`;
  const id = `vig${uid++}`;
  const vignette = `<defs><radialGradient id="${id}" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#8a5a2b" stop-opacity="0"/><stop offset="1" stop-color="#8a5a2b" stop-opacity=".28"/></radialGradient></defs><rect width="250" height="350" rx="4" fill="url(#${id})"/>`;
  return afterGround(svg.replaceAll("#f1eadb", "#eadab9"), vignette + spots);
}

export const CORNERS = /<path style="fill:#5b3b6e" d="M16 11\.5[^"]*"\/>/;
export const at = (fn: (sx: number, sy: number, cx: number, cy: number) => string) => [[16, 16, 1, 1], [234, 16, -1, 1], [16, 334, 1, -1], [234, 334, -1, -1]].map(([cx, cy, sx, sy]) => fn(sx, sy, cx, cy)).join("");
export const deco = at((sx, sy, cx, cy) => `<path d="M${cx + 6 * sx} ${cy + 22 * sy}V${cy + 6 * sy}H${cx + 22 * sx}M${cx + 10 * sx} ${cy + 16 * sy}V${cy + 10 * sy}H${cx + 16 * sx}" style="stroke:${INK};fill:none" stroke-width=".9"/><rect x="${cx + (sx > 0 ? 2 : -5)}" y="${cy + (sy > 0 ? 2 : -5)}" width="3" height="3" style="fill:${INK}"/>`);
export const fleuron = at((sx, sy, cx, cy) => `<circle cx="${cx + 7 * sx}" cy="${cy + 7 * sy}" r="2.6" style="fill:${INK}"/><path d="M${cx + 10 * sx} ${cy + 7 * sy}Q${cx + 20 * sx} ${cy + 3 * sy} ${cx + 26 * sx} ${cy + 8 * sy}Q${cx + 18 * sx} ${cy + 11 * sy} ${cx + 10 * sx} ${cy + 7 * sy}ZM${cx + 7 * sx} ${cy + 10 * sy}Q${cx + 3 * sx} ${cy + 20 * sy} ${cx + 8 * sx} ${cy + 26 * sy}Q${cx + 11 * sx} ${cy + 18 * sy} ${cx + 7 * sx} ${cy + 10 * sy}Z" style="fill:${INK}" opacity=".85"/>`);

const fig = (svg: string, cap: string) => `<figure style="margin:0;text-align:center">${svg}<figcaption style="color:#555;font-size:11.5px;margin-top:4px">${cap}</figcaption></figure>`;
const row = (inner: string) => `<div style="display:flex;gap:10px;justify-content:center;align-items:flex-start;padding:14px;background:#e7e2d8;flex-wrap:wrap">${inner}</div>`;
const tag = (cost: string) => `<span style="font-size:11px;padding:2px 7px;border-radius:9px;margin-left:6px;background:${cost === "barato" ? "#dcefdc" : cost === "médio" ? "#f6ead0" : "#f4d9d9"};color:#333">${cost}</span>`;
const option = (id: string, letter: string, title: string, cost: string, desc: string, body: string) => `
  <div class="card" data-choice="${id}" onclick="toggleSelect(this)">
    <div class="card-image" style="height:auto;aspect-ratio:auto;min-height:0">${body}</div>
    <div class="card-body"><h3>${letter} · ${title}${tag(cost)}</h3><p>${desc}</p></div>
  </div>`;

if (process.argv[1]?.endsWith("extras.ts")) writeFileSync(out, `
<h2>Mais opções de edição</h2>
<p class="subtitle">Podes escolher várias. Cada opção é permanente, porque passa a ter de funcionar com as 8 placas, as 2 impressões e os 5 contadores. A etiqueta indica o custo.</p>
<div class="cards" data-multiselect style="grid-template-columns:repeat(auto-fit,minmax(470px,1fr))">
${option("motto", "A", "Lema", "barato", "A tradição dos ex-libris: uma fita com uma frase tua, até cerca de 28 caracteres. O EX LIBRIS sobe e fica mais pequeno. É texto público escrito por ti, por isso precisa de limite de tamanho e de escape.", row(fig(card(), "sem lema") + fig(motto(card(), "Per libros ad astra"), "com lema")))}
${option("footer", "B", "Rodapé", "barato", "Escolhes o que vai em cada canto do rodapé. À esquerda: placa, leitor desde (o ano do primeiro livro terminado) ou total de volumes. À direita: nome, @handle ou iniciais. As iniciais servem a quem quer mais privacidade.", row(fig(card(), "placa · nome") + fig(footer(card(), "READER SINCE 2014", "@ANDRE"), "desde · @handle") + fig(footer(card(), "XLVIII VOLUMES", "A. R."), "volumes · iniciais")))}
${option("finish", "C", "Acabamento", "médio", "Papel (o atual), envelhecido (papel quente, manchas e vinheta) ou foil, com a tinta metalizada a brilhar. No telemóvel o brilho seguiria a inclinação do aparelho. É o que mais transforma a carta num objeto especial.", row(fig(card(), "papel") + fig(aged(card()), "envelhecido") + fig(foil(card()), "foil (animado)")))}
${option("corners", "D", "Ornamentos", "barato", "Os cantos da moldura: losangos (os atuais), art déco ou florões. É pouco código, mas também muda pouco.", row(fig(card(), "losangos") + fig(card().replace(CORNERS, deco), "art déco") + fig(card().replace(CORNERS, fleuron), "florões")))}
${option("print", "E", "Impressão fixa", "barato", "Hoje a impressão segue o tema de quem vê. Com esta opção podes fixar papel ou invertida para toda a gente, e a carta passa a ter sempre o mesmo aspeto.", row(fig(card("paper"), "papel") + fig(card("reversed"), "invertida")))}
</div>

<h3 style="margin-top:26px">Sem mockup (não mudam o aspeto da frente)</h3>
<div class="options" data-multiselect>
  <div class="option" data-choice="trait" onclick="toggleSelect(this)"><div class="letter">F</div><div class="content"><h3>Traço secundário ${tag("barato")}</h3><p>Linha + selo (o que escolheste), só selo, só linha ou escondido.</p></div></div>
  <div class="option" data-choice="quotes" onclick="toggleSelect(this)"><div class="letter">G</div><div class="content"><h3>Até 3 destaques ${tag("barato")}</h3><p>A página "escolhido" mostra um destaque de cada vez, e muda a cada visita ou a cada toque.</p></div></div>
  <div class="option" data-choice="why" onclick="toggleSelect(this)"><div class="letter">H</div><div class="content"><h3>Porquê este livro ${tag("barato")}</h3><p>Uma linha curta por baixo do livro-assinatura, como a legenda do bloco spotlight.</p></div></div>
  <div class="option" data-choice="reading" onclick="toggleSelect(this)"><div class="letter">I</div><div class="content"><h3>A ler agora ${tag("médio")}</h3><p>Uma linha na ficha com o livro que estás a ler, que se atualiza sozinha. É uma escolha tua, mas o conteúdo muda sem tu fazeres nada. Fica desligada por defeito.</p></div></div>
  <div class="option" data-choice="where" onclick="toggleSelect(this)"><div class="letter">J</div><div class="content"><h3>Onde aparece ${tag("médio")}</h3><p>Interruptores para o cabeçalho do perfil público, o glifo e o bloco do mural. Junta numa secção os controlos de privacidade do sub-projeto C.</p></div></div>
  <div class="option" data-choice="download" onclick="toggleSelect(this)"><div class="letter">K</div><div class="content"><h3>Descarregar / partilhar ${tag("caro")}</h3><p>Botões no editor para exportar a carta como imagem. É o sub-projeto D a aparecer no editor.</p></div></div>
</div>
`);
