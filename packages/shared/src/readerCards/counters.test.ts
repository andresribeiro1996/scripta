import assert from "node:assert/strict";
import { test } from "node:test";
import type { DialSegment } from "../library/readerCardFacts.js";
import { COUNTERS, SEAL_ANGLE, drawCounter, type CounterOptions } from "./counters.js";
import { seedOf } from "./seed.js";

const small: DialSegment[] = [
  { group: "star", books: 22, marked: 9 },
  { group: "corr", books: 7, marked: 3 },
  { group: "lamp", books: 8, marked: 1 },
  { group: "arch", books: 5, marked: 0 },
  { group: "other", books: 6, marked: 1 },
];
const options: CounterOptions = { seed: seedOf("andre"), sealGap: false, lead: "star" };
const ticks = (svg: string) => [...svg.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)].map(([, x1, y1, x2, y2]) => ({
  outer: Math.hypot(Number(x2) - 125, Number(y2) - 134),
  angle: (Math.atan2(Number(x1) - 125, 134 - Number(y1)) * 180 / Math.PI + 360) % 360,
}));

test("the dial draws one tick per finished book and a long tick per marked book", () => {
  const all = ticks(drawCounter("dial", small, options)!.svg);
  assert.equal(all.length, 48);
  assert.equal(all.filter((tick) => Math.abs(tick.outer - 72) < 0.05).length, 14);
});

test("the dial leaves room for the seal", () => {
  const all = ticks(drawCounter("dial", small, { ...options, sealGap: true })!.svg);
  assert.ok(all.length < 48);
  assert.ok(all.every((tick) => Math.abs(tick.angle - SEAL_ANGLE) >= 13));
});

test("each counter names the slot it draws in", () => {
  assert.deepEqual(Object.fromEntries(COUNTERS.map((counter) => [counter, drawCounter(counter, small, options)!.slot])), { dial: "rings", beads: "rings", shelf: "top", frame: "frameBand", ring: "rings" });
});

test("no finished books draws no counter", () => {
  for (const counter of COUNTERS) {
    assert.equal(drawCounter(counter, [], options), null);
    assert.equal(drawCounter(counter, [{ group: "unknown", books: 0, marked: 0 }], options), null);
  }
});

test("counters stay finite for one book and for two thousand", () => {
  for (const counter of COUNTERS) {
    for (const books of [1, 2000]) {
      const svg = drawCounter(counter, [{ group: "star", books, marked: Math.floor(books / 3) }], options)!.svg;
      assert.doesNotMatch(svg, /NaN|Infinity|d=""/);
      assert.ok(svg.length > 0);
    }
  }
});

test("output depends only on its inputs, and only the shelf uses the seed", () => {
  for (const counter of COUNTERS) assert.equal(drawCounter(counter, small, options)!.svg, drawCounter(counter, small, options)!.svg);
  assert.notEqual(drawCounter("shelf", small, options)!.svg, drawCounter("shelf", small, { ...options, seed: seedOf("other") })!.svg);
  assert.equal(drawCounter("dial", small, options)!.svg, drawCounter("dial", small, { ...options, seed: seedOf("other") })!.svg);
});

test("without a lead group no segment is drawn heavier", () => {
  assert.doesNotMatch(drawCounter("dial", small, { ...options, lead: null })!.svg, /stroke-width="1.15"/);
  assert.doesNotMatch(drawCounter("shelf", small, { ...options, lead: null })!.svg, /opacity=".5"/);
});
