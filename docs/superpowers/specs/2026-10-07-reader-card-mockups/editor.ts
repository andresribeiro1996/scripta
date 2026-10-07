import { writeFileSync } from "node:fs";
import { base, colors, dial, afterRings, inject, renderGlyphSvg } from "./lib.ts";
import { SMALL, beads, shelf, frame, ring, streak, sealSvg } from "./counters.ts";
import { front } from "./pages.ts";

const out = process.argv[2];
const [, line] = colors("star", "paper");

const withCounter = (kind: string, w: number) => {
  const plate = base("star", "paper", w);
  const counter = kind === "dial" ? afterRings(plate, dial(line, { gapAt: 135 }))
    : kind === "beads" ? afterRings(plate, beads(SMALL))
    : kind === "ring" ? afterRings(plate, ring(SMALL))
    : inject(plate, kind === "shelf" ? shelf(SMALL) : frame(SMALL));
  return inject(counter, streak + sealSvg);
};

const COUNTERS = [["dial", "Dial"], ["beads", "Beads"], ["shelf", "Shelf"], ["frame", "Frame"], ["ring", "Genre ring"]];
const thumbs = (w: number) => COUNTERS.map(([k, label], i) => `
  <div style="flex:none;text-align:center;width:${w + 8}px">
    <div style="padding:3px;border-radius:6px;border:2px solid ${i === 0 ? "#5b3b6e" : "transparent"}">${withCounter(k, w)}</div>
    <div style="font-size:11px;margin-top:3px;color:${i === 0 ? "#222" : "#666"};font-weight:${i === 0 ? 600 : 400}">${label}${i === 0 ? " ✓" : ""}</div>
  </div>`).join("");

const icon = (kind: string) => {
  const s = `stroke="#5b3b6e" fill="#f1eadb" stroke-width="1.2"`;
  if (kind === "three") return `<svg width="46" height="26" viewBox="0 0 46 26"><rect x="2" y="2" width="12" height="17" ${s}/><rect x="17" y="2" width="12" height="17" ${s}/><rect x="32" y="2" width="12" height="17" ${s}/><circle cx="17" cy="23.5" r="1.4" fill="#5b3b6e"/><circle cx="23" cy="23.5" r="1.4" fill="#bbb"/><circle cx="29" cy="23.5" r="1.4" fill="#bbb"/></svg>`;
  if (kind === "book") return `<svg width="46" height="26" viewBox="0 0 46 26"><path d="M23 4Q15 1 5 3V22Q15 20 23 23Q31 20 41 22V3Q31 1 23 4Z" ${s}/><path d="M23 4V23" stroke="#5b3b6e" stroke-width="1"/></svg>`;
  return `<svg width="46" height="26" viewBox="0 0 46 26"><rect x="10" y="2" width="12" height="17" ${s}/><rect x="24" y="2" width="12" height="17" ${s}/><path d="M22 10.5H24" stroke="#5b3b6e"/></svg>`;
};
const layouts = [["three", "Three faces"], ["book", "Opens like a book"], ["merged", "Single back"]];
const layoutChips = layouts.map(([k, label], i) => `
  <div style="flex:1;min-width:0;border:1.5px solid ${i === 0 ? "#5b3b6e" : "#ddd"};border-radius:8px;padding:8px 4px;text-align:center;background:${i === 0 ? "#f6f1f8" : "#fff"}">
    ${icon(k)}<div style="font-size:11px;margin-top:2px;color:${i === 0 ? "#222" : "#555"};font-weight:${i === 0 ? 600 : 400}">${label}</div>
  </div>`).join("");

const miniCover = `<svg width="30" height="44" viewBox="0 0 30 44"><rect width="30" height="44" rx="1.5" fill="#5b3b6e"/><text x="15" y="16" text-anchor="middle" font-size="4.4" font-weight="700" fill="#f1eadb" font-family="sans-serif">A WIZARD</text><text x="15" y="21" text-anchor="middle" font-size="4.4" font-weight="700" fill="#f1eadb" font-family="sans-serif">OF EARTHSEA</text></svg>`;
const section = (label: string) => `<div style="font-size:10.5px;letter-spacing:1.4px;color:#888;font-weight:600;margin:18px 0 8px">${label}</div>`;
const rowBox = (inner: string) => `<div style="display:flex;align-items:center;gap:10px;border:1px solid #e3e3e3;border-radius:10px;padding:10px;background:#fff">${inner}</div>`;
const change = `<span style="margin-left:auto;color:#5b3b6e;font-size:12.5px;font-weight:600;white-space:nowrap">Change ›</span>`;
const glyph = renderGlyphSvg("star", 26);

const settings = (thumbW: number) => `
  ${section("FRONT · COUNTER")}
  <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px">${thumbs(thumbW)}</div>
  ${section("BACK · LAYOUT")}
  <div style="display:flex;gap:6px">${layoutChips}</div>
  ${section("SIGNATURE BOOK")}
  ${rowBox(`${miniCover}<div style="min-width:0"><div style="font-size:13.5px;font-weight:600">A Wizard of Earthsea</div><div style="font-size:12px;color:#777">Ursula K. Le Guin · finished 2024</div></div>${change}`)}
  ${section("HIGHLIGHT")}
  ${rowBox(`<div style="min-width:0"><div style="font-size:13px;font-style:italic;font-family:Georgia,serif">“No one would have believed in the last years of the nineteenth century…”</div><div style="font-size:11.5px;color:#777;margin-top:3px">The War of the Worlds · H. G. Wells</div></div>${change}`)}
  ${section("GLYPH")}
  ${rowBox(`${glyph}<div style="min-width:0"><div style="font-size:13.5px;font-weight:600">Show next to your name</div><div style="font-size:12px;color:#777">Others see you as the Stargazer.</div></div><span style="margin-left:auto;width:38px;height:22px;border-radius:11px;background:#5b3b6e;position:relative;flex:none"><span style="position:absolute;right:2px;top:2px;width:18px;height:18px;border-radius:9px;background:#fff"></span></span>`)}
  <p style="font-size:11.5px;color:#888;margin-top:14px;line-height:1.45">What you choose here is public on your card. The ◇ lines on the record page are only for you.</p>`;

const previewBlock = (w: number) => `
  <div style="text-align:center">
    <div style="display:inline-block;filter:drop-shadow(0 6px 14px rgba(0,0,0,.18))">${front(w)}</div>
    <div style="margin-top:8px;font-size:16px;letter-spacing:4px;color:#5b3b6e">● <span style="color:#ccc">● ●</span></div>
    <div style="font-size:11px;color:#999">Tap to turn</div>
    <div style="display:inline-flex;margin-top:10px;border:1px solid #ddd;border-radius:8px;overflow:hidden;font-size:12px">
      <span style="padding:5px 14px;background:#5b3b6e;color:#fff">You</span><span style="padding:5px 14px;background:#fff;color:#555">Visitors</span>
    </div>
  </div>`;

const phone = `
<div style="width:360px;border-radius:28px;border:8px solid #222;background:#faf8f5;color:#222;overflow:hidden;flex:none">
  <div style="height:22px"></div>
  <div style="display:flex;align-items:center;padding:6px 14px 10px;border-bottom:1px solid #eee">
    <span style="color:#5b3b6e;font-size:14px">‹ My shelf</span><span style="margin:0 auto;font-weight:600;font-size:15px;transform:translateX(-30px)">Reader card</span>
  </div>
  <div style="padding:16px;max-height:880px;overflow:hidden">
    ${previewBlock(180)}
    ${settings(56)}
  </div>
</div>`;

const web = `
<div style="flex:1;min-width:640px;border:1px solid #ccc;border-radius:10px;background:#faf8f5;color:#222;overflow:hidden;display:flex">
  <div style="width:150px;flex:none;background:#f0ece6;padding:16px 12px;font-size:12.5px;color:#555;line-height:2.1">Home<br>Library<br>Series<br>Collections<br>Gallery<br>Murals<br>Games<br>Settings</div>
  <div style="flex:1;padding:20px 24px">
    <div style="font-size:12.5px;color:#5b3b6e">‹ My shelf</div>
    <div style="font-size:21px;font-weight:600;margin:4px 0 16px">Reader card</div>
    <div style="display:flex;gap:28px;align-items:flex-start">
      <div style="flex:none;position:sticky;top:0">${previewBlock(230)}</div>
      <div style="flex:1;min-width:0;margin-top:-18px">${settings(62)}</div>
    </div>
  </div>
</div>`;

writeFileSync(out, `
<h2>Editor da carta</h2>
<p class="subtitle">Chega-se lá pelo botão "Edit card" em qualquer sítio onde vês a tua própria carta, e também pelas Definições. A pré-visualização no topo é a carta real: vira com um toque e o interruptor You/Visitors mostra o que é público. Cada escolha guarda logo, sem botão "Guardar".</p>
<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap">${phone}${web}</div>
`);
