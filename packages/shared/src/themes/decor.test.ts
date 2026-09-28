import assert from "node:assert/strict";
import { test } from "node:test";
import { DECOR_EXTRA_COLORS, DECOR_MAX_OPACITY, THEME_DECOR, withOpacity } from "./decor.js";
import { THEME_IDS, themes } from "./palettes.js";

const DECOR_THEMES = ["matrix", "newsprint", "oxblood", "seventies", "synthwave"];

function balanced(svg: string): boolean {
  const stack: string[] = [];
  for (const [, closing, name, selfClosing] of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else stack.push(name!);
  }
  return stack.length === 0;
}

test("only the five character themes have decor", () => {
  assert.deepEqual(Object.keys(THEME_DECOR).sort(), DECOR_THEMES);
});

test("every decor piece is a complete, balanced svg document", () => {
  for (const [id, decor] of Object.entries(THEME_DECOR)) {
    for (const piece of decor!.pieces) {
      assert.ok(piece.svg.startsWith("<svg "), id);
      assert.ok(piece.svg.endsWith("</svg>"), id);
      assert.match(piece.svg, /viewBox="[\d. -]+"/, id);
      assert.ok(balanced(piece.svg), id);
      assert.ok(piece.height > 0, id);
      assert.ok(piece.width === "full" || piece.width > 0, id);
    }
  }
});

test("decor only uses its own theme's colours and the two stripe colours", () => {
  for (const id of THEME_IDS) {
    const decor = THEME_DECOR[id];
    if (!decor) continue;
    const allowed = new Set<string>([...Object.values(themes[id].colors), ...Object.values(DECOR_EXTRA_COLORS)]);
    for (const piece of decor.pieces) {
      for (const [hex] of piece.svg.matchAll(/#[0-9a-fA-F]{6}\b/g)) assert.ok(allowed.has(hex), `${id} ${hex}`);
    }
    if (decor.frame) assert.ok(allowed.has(decor.frame.color), id);
  }
});

test("decor stays quiet", () => {
  for (const [id, decor] of Object.entries(THEME_DECOR)) {
    for (const piece of decor!.pieces) {
      for (const [, value] of piece.svg.matchAll(/(?:fill-)?opacity="([\d.]+)"/g)) assert.ok(Number(value) <= DECOR_MAX_OPACITY, `${id} ${value}`);
    }
    for (const line of decor!.frame?.lines ?? []) assert.ok(line.opacity <= DECOR_MAX_OPACITY, id);
  }
});

test("full width only on the top and bottom edges, and it stretches without thickening", () => {
  for (const [id, decor] of Object.entries(THEME_DECOR)) {
    for (const piece of decor!.pieces) {
      const edge = piece.anchor === "top" || piece.anchor === "bottom";
      assert.equal(piece.width === "full", edge, `${id} ${piece.anchor}`);
      if (!edge) continue;
      assert.match(piece.svg, /preserveAspectRatio="none"/, id);
      for (const [element] of piece.svg.matchAll(/<[a-z]+ [^>]*stroke="[^"]*"[^>]*>/g)) assert.match(element, /vector-effect="non-scaling-stroke"/, `${id} ${element}`);
    }
  }
});

test("the oxblood frame is two lines, outer then inner", () => {
  const lines = THEME_DECOR.oxblood!.frame!.lines;
  assert.deepEqual(lines.map((line) => line.inset), [10, 17]);
});

test("withOpacity turns a hex colour into rgba", () => {
  assert.equal(withOpacity("#d9b36b", 0.2), "rgba(217, 179, 107, 0.2)");
});
