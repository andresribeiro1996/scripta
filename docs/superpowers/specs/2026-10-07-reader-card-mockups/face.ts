import { writeFileSync } from "node:fs";
import { base, colors, dial, afterRings, inject, seal, text } from "./lib.ts";

const out = process.argv[2];
const W = 240;
const [, line] = colors("star", "paper");
const streak = text(line, 125, 297, "WITH A STREAK OF THE LAMPLIGHTER", 5.6, 1.5);

const a = inject(base("star", "paper", W), streak);
const b = inject(afterRings(base("star", "paper", W), dial(line)), streak);
const sealAt = 135, r = 64;
const sx = 125 + r * Math.sin((sealAt * Math.PI) / 180), sy = 134 - r * Math.cos((sealAt * Math.PI) / 180);
const c = inject(afterRings(base("star", "paper", W), dial(line, { gapAt: sealAt })), seal("star", "lamp", "paper", +sx.toFixed(1), +sy.toFixed(1)));

const card = (id: string, letter: string, title: string, desc: string, svg: string) => `
  <div class="card" data-choice="${id}" onclick="toggleSelect(this)">
    <div class="card-image" style="display:flex;justify-content:center;padding:18px;background:#e7e2d8">${svg}</div>
    <div class="card-body"><h3>${letter} · ${title}</h3><p>${desc}</p></div>
  </div>`;

writeFileSync(out, `
<h2>Frente da carta: traço secundário e arte única</h2>
<p class="subtitle">Stargazer com runner-up Lamplighter. Biblioteca fictícia: 48 livros terminados.</p>
<div class="cards">
${card("a", "A", "Discreto", "A placa atual com uma linha nova: o traço secundário por baixo do epíteto. Sem arte nova.", a)}
${card("b", "B", "Mostrador + linha", "À volta do emblema, um traço por livro terminado, agrupado por género. O segmento do teu género vai mais carregado e os traços longos são livros com destaques. O traço secundário fica em texto.", b)}
${card("c", "C", "Mostrador + selo", "O mesmo mostrador. O traço secundário passa a ser um selo com o glifo do runner-up, na tinta dele, pousado no anel.", c)}
</div>
<div class="section" style="margin-top:20px">
  <p class="label">Nota</p>
  <p>Com o mostrador, duas cartas Stargazer só ficam iguais se as bibliotecas forem iguais. Os visitantes veem a forma do mostrador, mas não os livros por trás dela: são contagens, coerente com o que decidimos sobre privacidade.</p>
</div>
`);
