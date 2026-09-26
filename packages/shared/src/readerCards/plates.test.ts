import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PLATE_INKS, READER_PLATES, renderGlyph, renderPlate } from "./index.js";
import { PAPER, REVERSED_LINE, glyph, plate, printStyle } from "./plates.js";

const masters = join(dirname(fileURLToPath(import.meta.url)), "../../../../design/reader-cards");
const standalone = (svg: string, ground: string, line: string) => svg.replace(">", `>${printStyle(ground, line)}`);
const master = (name: string) => readFileSync(join(masters, name), "utf8");

test("the port reproduces every committed master byte for byte", () => {
  for (const p of READER_PLATES) {
    const [, ink, deep] = PLATE_INKS[p.key];
    const base = `${p.numeral.toLowerCase()}-${p.key}`;
    const card = plate({ ...p, label: `The ${p.name} reader card` });
    assert.equal(standalone(card, PAPER, ink), master(`${base}-paper.svg`), `${base}-paper`);
    assert.equal(standalone(card, deep, REVERSED_LINE), master(`${base}-reversed.svg`), `${base}-reversed`);
    assert.equal(standalone(glyph(p.key, 48), PAPER, ink), master(`${base}-glyph.svg`), `${base}-glyph`);
  }
});

test("READER_PLATES has exactly one entry per non-graph identity", () => {
  const plateKeys = READER_PLATES.map((p) => p.key).sort();
  const inkKeys = Object.keys(PLATE_INKS).filter((k) => k !== "graph").sort();
  assert.deepEqual(plateKeys, inkKeys);
});

test("a settled plate prints THE, the identity's ink and the reader's name", () => {
  const svg = renderPlate({ identity: "star", state: "settled", readerName: "scripta_dev", print: "paper", label: "Reader card: the Stargazer" });
  assert.match(svg, />THE</);
  assert.match(svg, />Stargazer</);
  assert.match(svg, />SCRIPTA_DEV</);
  assert.match(svg, new RegExp(PLATE_INKS.star[1]));
  assert.match(svg, /aria-label="Reader card: the Stargazer"/);
});

test("a leaning plate prints LEANING TOWARD over the leading identity", () => {
  const svg = renderPlate({ identity: "carto", state: "leaning", readerName: "a", print: "paper", label: "x" });
  assert.match(svg, />LEANING TOWARD</);
  assert.match(svg, />Cartographer</);
});

test("an unwritten plate is graphite with an empty cartouche and the given line", () => {
  const svg = renderPlate({ identity: null, state: "unwritten", readerName: "a", print: "paper", label: "x", unwrittenLine: "finish 2 more books" });
  assert.match(svg, />Unwritten</);
  assert.match(svg, />NOT YET</);
  assert.match(svg, />finish 2 more books</);
  assert.match(svg, />PLATE —</);
  assert.match(svg, new RegExp(PLATE_INKS.graph[1]));
  assert.match(renderPlate({ identity: null, state: "unwritten", readerName: "a", print: "paper", label: "x" }), />five finished books to begin</);
});

test("readerName is escaped after uppercasing", () => {
  const svg = renderPlate({ identity: "carto", state: "settled", readerName: "a<b", print: "paper", label: "x" });
  assert.match(svg, />A&lt;B</);
});

test("a label containing a quote doesn't break the aria-label attribute", () => {
  const svg = renderPlate({ identity: "carto", state: "settled", readerName: "a", print: "paper", label: 'Reader "quill" card' });
  assert.match(svg, /aria-label="Reader &quot;quill&quot; card"/);
});

test("reversed print uses the deep ink as ground and the reversed line", () => {
  const svg = renderPlate({ identity: "way", state: "settled", readerName: "a", print: "reversed", label: "x" });
  assert.match(svg, new RegExp(PLATE_INKS.way[2]));
  assert.match(svg, new RegExp(REVERSED_LINE));
});

test("renderGlyph is self-contained at the requested size", () => {
  const svg = renderGlyph("loyal", 24, "paper");
  assert.match(svg, /width="24" height="24"/);
  assert.doesNotMatch(svg, /<style>/);
  assert.doesNotMatch(svg, / class="\w+"/);
});

test("renderPlate carries no page-wide selector, so two plates on one page can't recolour each other", () => {
  const a = renderPlate({ identity: "carto", state: "settled", readerName: "a", print: "paper", label: "x" });
  const b = renderPlate({ identity: "star", state: "settled", readerName: "b", print: "reversed", label: "y" });
  for (const svg of [a, b]) {
    assert.doesNotMatch(svg, /<style>/);
    assert.doesNotMatch(svg, / class="\w+"/);
  }
  assert.match(a, new RegExp(PLATE_INKS.carto[1]));
  assert.match(b, new RegExp(PLATE_INKS.star[2]));
});

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

test("every ink clears 5:1 against paper", () => {
  for (const [key, [, ink]] of Object.entries(PLATE_INKS)) {
    const ratio = (luminance(PAPER) + 0.05) / (luminance(ink) + 0.05);
    assert.ok(ratio >= 5, `${key} is ${ratio.toFixed(2)}:1`);
  }
});
