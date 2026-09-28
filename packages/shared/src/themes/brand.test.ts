import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ENTRANCE, MARK_BOOKPLATE, MARK_EXTRA_COLORS, MARK_RECTS, layerEntrance, markTreatment } from "./brand.js";
import { THEME_IDS } from "./palettes.js";

const ENTRANCES: Record<string, string> = { matrix: "scan", synthwave: "rise", seventies: "fan", newsprint: "register", oxblood: "gild" };

test("MARK_RECTS is the geometry of design/brand/mark.svg", () => {
  const svg = readFileSync(new URL("../../../../design/brand/mark.svg", import.meta.url), "utf8");
  const rects = [...svg.matchAll(/<rect ([^>]*?)\/>/g)].map(([, attrs]) => {
    const get = (name: string) => attrs!.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
    const rotate = get("transform")?.match(/rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)/);
    return {
      x: Number(get("x")),
      y: Number(get("y")),
      width: Number(get("width")),
      height: Number(get("height")),
      ...(rotate ? { rotate: [Number(rotate[1]), Number(rotate[2]), Number(rotate[3])] } : {}),
    };
  });
  assert.deepEqual(rects, MARK_RECTS);
});

test("the five character themes get their entrance and every other theme the plain mark", () => {
  for (const id of THEME_IDS) {
    const treatment = markTreatment(id);
    assert.equal(treatment.entrance, ENTRANCES[id] ?? null, id);
    if (!ENTRANCES[id]) assert.deepEqual(treatment.layers, [{ fill: "text", offset: [0, 0], opacity: 1 }], id);
  }
});

test("the last layer is the mark itself, unshifted and opaque", () => {
  for (const id of THEME_IDS) {
    const last = markTreatment(id).layers.at(-1)!;
    assert.deepEqual([last.offset, last.opacity], [[0, 0], 1], id);
  }
});

test("mark fills name a theme token or a known extra colour", () => {
  const names = new Set(["text", "accent", ...Object.keys(MARK_EXTRA_COLORS)]);
  for (const id of THEME_IDS) for (const layer of markTreatment(id).layers) assert.ok(names.has(layer.fill), `${id} ${layer.fill}`);
  for (const hex of Object.values(MARK_EXTRA_COLORS)) assert.match(hex, /^#[0-9a-f]{6}$/);
});

test("layerEntrance fans the seventies echo out and slides the newsprint plate into register", () => {
  const seventies = markTreatment("seventies");
  assert.deepEqual(layerEntrance(seventies, 0), { from: [-4, -3], fade: false, delayMs: 80 });
  assert.deepEqual(layerEntrance(seventies, 1), { from: [-2, -1.5], fade: false, delayMs: 0 });
  assert.equal(layerEntrance(seventies, 2), null);
  assert.deepEqual(layerEntrance(markTreatment("newsprint"), 0), { from: [8.6, 6.2], fade: true, delayMs: 100 });
  assert.equal(layerEntrance(markTreatment("newsprint"), 1), null);
  assert.equal(layerEntrance(markTreatment("matrix"), 0), null);
});

test("entrance timings match the spec", () => {
  assert.deepEqual(ENTRANCE, {
    scan: { ms: 560, steps: 7 },
    rise: { ms: 600, from: 14 },
    fan: { ms: 600 },
    register: { ms: 620 },
    gild: { ms: 700, markDelayMs: 450, markMs: 350 },
  });
});

test("the bookplate perimeters are the rounded-rect lengths the dash animation draws", () => {
  assert.equal(MARK_BOOKPLATE.outer.perimeter, Math.round((4 * 80 - (8 - 2 * Math.PI) * 4) * 100) / 100);
  assert.equal(MARK_BOOKPLATE.inner.perimeter, Math.round((4 * 70 - (8 - 2 * Math.PI) * 2) * 100) / 100);
});
