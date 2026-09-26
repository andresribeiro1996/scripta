import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PLATE_INKS, PLATE_PAPER, PLATE_REVERSED_LINE, READER_PLATES, glyph, plate, printStyle, renderGlyph, renderPlate } from "./index.js";

const masters = join(dirname(fileURLToPath(import.meta.url)), "../../../../design/reader-cards");
const standalone = (svg: string, ground: string, line: string) => svg.replace(">", `>${printStyle(ground, line)}`);
const master = (name: string) => readFileSync(join(masters, name), "utf8");

test("the port reproduces every committed master byte for byte", () => {
  for (const p of READER_PLATES) {
    const [, ink, deep] = PLATE_INKS[p.key];
    const base = `${p.numeral.toLowerCase()}-${p.key}`;
    const card = plate({ ...p, label: `The ${p.name} reader card` });
    assert.equal(standalone(card, PLATE_PAPER, ink), master(`${base}-paper.svg`), `${base}-paper`);
    assert.equal(standalone(card, deep, PLATE_REVERSED_LINE), master(`${base}-reversed.svg`), `${base}-reversed`);
    assert.equal(standalone(glyph(p.key, 48), PLATE_PAPER, ink), master(`${base}-glyph.svg`), `${base}-glyph`);
  }
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

test("reversed print uses the deep ink as ground and the reversed line", () => {
  const svg = renderPlate({ identity: "way", state: "settled", readerName: "a", print: "reversed", label: "x" });
  assert.match(svg, new RegExp(PLATE_INKS.way[2]));
  assert.match(svg, new RegExp(PLATE_REVERSED_LINE));
});

test("renderGlyph is self-contained at the requested size", () => {
  const svg = renderGlyph("loyal", 24, "paper");
  assert.match(svg, /width="24" height="24"/);
  assert.match(svg, /<style>/);
});

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

test("every ink clears 5:1 against paper", () => {
  for (const [key, [, ink]] of Object.entries(PLATE_INKS)) {
    const ratio = (luminance(PLATE_PAPER) + 0.05) / (luminance(ink) + 0.05);
    assert.ok(ratio >= 5, `${key} is ${ratio.toFixed(2)}:1`);
  }
});
