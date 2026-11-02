import { readFileSync, writeFileSync } from "node:fs";
const people = JSON.parse(readFileSync(process.argv[2], "utf8"));
const NAMES = { star: "Astrónomo", lamp: "Acendedor", carto: "Cartógrafo", way: "Caminhante" };
const b64 = (s) => Buffer.from(s).toString("base64");
const img = (svg, w, style = "") => `<img src="data:image/svg+xml;base64,${b64(svg)}" width="${w}" style="display:block;${style}">`;
const phone = (body) => `<div style="width:200px;height:400px;border:6px solid #1d1d1f;border-radius:26px;overflow:hidden;background:#faf8f4;font-family:-apple-system,system-ui,sans-serif;color:#222;position:relative;flex:none">${body}</div>`;
const follow = `<span style="display:block;background:#222;color:#fff;border-radius:12px;padding:4px 0;font-size:10px;font-weight:600;text-align:center">Seguir</span>`;
const tabs = (h) => `<div style="display:flex;gap:10px;padding:6px 10px;font-size:9px;border-bottom:1px solid #e5e0d8;color:#888"><b style="color:#222">Mural</b><span>Atividade</span><span>Biblioteca</span></div><div style="padding:8px 10px;display:grid;grid-template-columns:1fr 1fr;gap:6px">${`<div style='background:#efe9df;border-radius:6px;height:${h}px'></div>`.repeat(4)}</div>`;
const avatar = `<div style="width:20px;height:20px;border-radius:50%;background:#c9b8a6;flex:none"></div>`;
const bHeader = (p, w, dark = false) => `<div style="position:relative;display:flex;gap:10px;padding:0 10px 12px;align-items:center;${dark ? "color:#f1eadb" : ""}">
  ${img(p.svg, w, "filter:drop-shadow(0 4px 10px rgba(0,0,0,.35));border-radius:4px")}
  <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:5px">${avatar}<div style="font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${p.name}</div></div>
  <div style="font-size:9px;opacity:.7;margin:3px 0 1px">48 lidos · 31 a seguir</div>
  <div style="font-size:9px;font-weight:700;margin-bottom:6px">${NAMES[p.id]} ›</div>${follow}</div></div>`;
const backdrop = (p, solid = false) => `<div style="position:absolute;inset:-30px;background:url('data:image/svg+xml;base64,${b64(p.svg)}') center/cover;filter:blur(16px) saturate(1.4)"></div>${solid ? '<div style="position:absolute;inset:0;background:rgba(0,0,0,.15)"></div>' : '<div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.08) 20%,#faf8f4 98%)"></div>'}`;
const B = (p) => phone(`<div style="height:30px"></div>${bHeader(p, 72)}${tabs(70)}`);
const BD = (p) => { const dark = p.print === "reversed"; return phone(`<div style="position:relative;overflow:hidden">${backdrop(p, true)}<div style="position:relative;height:30px"></div>${bHeader(p, 80, dark)}</div>${tabs(64)}`); };
const D = (p) => phone(`<div style="position:relative;overflow:hidden">${backdrop(p)}<div style="position:relative;height:30px"></div><div style="position:relative;display:flex;flex-direction:column;align-items:center;padding:0 10px 10px">${img(p.svg, 108, "filter:drop-shadow(0 6px 14px rgba(0,0,0,.45));border-radius:5px")}<div style="font-size:13px;font-weight:700;margin-top:8px">${p.name}</div><div style="font-size:9px;color:#777;margin:2px 0 6px">48 lidos · 31 a seguir</div><span style="background:#222;color:#fff;border-radius:12px;padding:3px 11px;font-size:10px;font-weight:600">Seguir</span></div></div>${tabs(44)}`);
const row = (label, desc, f, id) => `<div class="option" data-choice="${id}" onclick="toggleSelect(this)" style="display:block"><h3 style="margin:0 0 4px">${label}</h3><p style="margin:0 0 10px">${desc}</p><div style="display:flex;gap:14px;overflow-x:auto;padding-bottom:6px">${people.map(f).join("")}</div></div>`;
writeFileSync(process.argv[3], `
<h2>B, D, ou os dois juntos</h2>
<p class="subtitle">Quatro leitores: Marta e Inês com cards claros, Rui e João com cards escuros.</p>
<div class="options">
${row("B · Card ao lado do nome", "Compacto. O mural começa logo a meio do ecrã. Tocar no card abre-o em grande.", B, "b")}
${row("B + D · Card ao lado do nome, sobre o fundo do card", "O mesmo cabeçalho compacto, mas a faixa de cima ganha a cor do card. Ocupa quase o mesmo espaço que o B.", BD, "bd")}
${row("D · Capa de disco", "O card grande ao centro, com o fundo pintado por ele. É o que mais diz «este é o meu card», mas empurra o mural para baixo.", D, "d")}
</div>`);
