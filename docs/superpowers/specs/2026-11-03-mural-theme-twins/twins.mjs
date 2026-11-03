import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const out = process.argv[3];
const { themes, THEME_IDS } = await import(pathToFileURL(`${root}/packages/shared/dist/themes/palettes.js`).href);

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgbHex = (rgb) => "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("");

function toOklch(hex) {
  const [r, g, b] = hexRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function oklchRgb([L, C, H]) {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(toSrgb);
}

function fromOklch([L, C, H]) {
  let c = C;
  for (let i = 0; i < 40; i++) {
    const rgb = oklchRgb([L, c, H]);
    if (rgb.every((v) => v >= -0.001 && v <= 1.001)) return rgbHex(rgb);
    c *= 0.92;
  }
  return rgbHex(oklchRgb([L, 0, H]));
}

const lum = (hex) => { const [r, g, b] = hexRgb(hex).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const GROUND = new Set(["background", "surface", "surfacePressed", "border", "accentSoft", "dangerSoft", "successSoft", "infoSoft", "referenceSoft", "accentFill"]);
const AA = [["text", "background"], ["text", "surface"], ["textDim", "surface"], ["textDim", "background"], ["accent", "surface"], ["onAccent", "accent"], ["onDanger", "danger"], ["danger", "surface"], ["success", "surface"], ["info", "surface"], ["reference", "surface"], ["accent", "accentSoft"], ["danger", "dangerSoft"], ["success", "successSoft"], ["info", "infoSoft"], ["reference", "referenceSoft"], ["text", "accentFill"]];

function twin(id) {
  const source = themes[id];
  const toScheme = source.scheme === "light" ? "dark" : "light";
  const template = themes[toScheme].colors;
  const colors = {};
  for (const [token, value] of Object.entries(source.colors)) {
    if (token === "scrim") { colors.scrim = template.scrim; continue; }
    const [, sc, sh] = toOklch(value);
    const [tl, tc] = toOklch(template[token]);
    const chroma = GROUND.has(token) ? Math.min(sc, Math.max(tc, 0.045)) : sc;
    colors[token] = fromOklch([tl, chroma, sh]);
  }
  for (let pass = 0; pass < 3; pass++) {
    for (const [fg, bg] of AA) {
      let [l, c, h] = toOklch(colors[fg]);
      const away = lum(colors[bg]) > 0.18 ? -1 : 1;
      for (let i = 0; i < 60 && contrast(colors[fg], colors[bg]) < 4.6; i++) { l += away * 0.01; colors[fg] = fromOklch([l, c, h]); }
    }
  }
  const failing = AA.filter(([fg, bg]) => contrast(colors[fg], colors[bg]) < 4.5).map(([fg, bg]) => `${fg}/${bg} ${contrast(colors[fg], colors[bg]).toFixed(2)}`);
  return { scheme: toScheme, colors, failing };
}

const mural = (c, label) => `
<div class="m" style="background:${c.background};color:${c.text}">
  <div class="lab" style="color:${c.textDim}">${label}</div>
  <div class="blk" style="background:${c.surface};border:1px solid ${c.border}">
    <div class="h" style="color:${c.textDim}">My shelf theme</div>
    <div class="b">Classics · Fantasy</div>
    <div class="row"><span class="chip" style="background:${c.accentSoft};color:${c.accent}">Fantasy</span><span class="chip" style="background:${c.infoSoft};color:${c.info}">Classics</span></div>
  </div>
  <div class="two">
    <div class="blk" style="background:${c.surface};border:1px solid ${c.border}"><div class="h" style="color:${c.textDim}">Finished</div><div class="n" style="color:${c.accent}">48</div></div>
    <div class="blk" style="background:${c.accentFill};"><div class="h" style="color:${c.text}">Reading</div><div class="b">Dune</div></div>
  </div>
  <div class="bar"><i style="background:${c.success};flex:3"></i><i style="background:${c.accent};flex:2"></i><i style="background:${c.reference};flex:1"></i></div>
  <span class="btn" style="background:${c.accent};color:${c.onAccent}">Follow</span>
</div>`;

const results = Object.fromEntries(THEME_IDS.map((id) => [id, twin(id)]));
const rows = THEME_IDS.map((id) => {
  const t = themes[id], w = results[id];
  const warn = w.failing.length ? `<div class="warn">contrast short: ${w.failing.join(", ")}</div>` : "";
  return `<div class="pair"><div class="title">${id}</div><div class="ms">${mural(t.colors, `${t.scheme} · original`)}${mural(w.colors, `${w.scheme} · generated twin`)}</div>${warn}</div>`;
}).join("");

writeFileSync(`${out}/twins.json`, JSON.stringify(Object.fromEntries(THEME_IDS.map((id) => [id, results[id].colors])), null, 2));
writeFileSync(`${out}/twins.html`, `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#fff;font:13px -apple-system,system-ui,sans-serif;color:#222}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}
.title{font-weight:700;font-size:15px;margin:0 0 6px;text-transform:capitalize}
.ms{display:flex;gap:6px}
.m{flex:1;border-radius:10px;padding:10px;min-height:210px;box-sizing:border-box}
.lab{font-size:10px;margin-bottom:7px}
.blk{border-radius:8px;padding:8px;margin-bottom:6px;box-sizing:border-box}
.h{font-size:9.5px;font-weight:600;margin-bottom:3px}.b{font-size:12px}.n{font-size:20px;font-weight:700}
.row{display:flex;gap:4px;margin-top:5px}.chip{font-size:9.5px;padding:2px 6px;border-radius:9px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.bar{display:flex;height:6px;border-radius:3px;overflow:hidden;margin:2px 0 8px}
.btn{display:inline-block;font-size:11px;font-weight:600;padding:4px 12px;border-radius:12px}
.warn{color:#b00;font-size:11px;margin-top:4px}
</style></head><body><div class="grid">${rows}</div></body></html>`);
console.log(Object.fromEntries(THEME_IDS.map((id) => [id, results[id].failing])));
