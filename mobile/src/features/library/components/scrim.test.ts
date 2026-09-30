import assert from "node:assert/strict";
import { test } from "node:test";
import { scrimStops } from "./scrim";

test("the default intensity peaks at 0.88 and fades out toward the top", () => {
  assert.deepEqual(scrimStops(88), [
    { offset: 0, opacity: 0.88 },
    { offset: 0.36, opacity: 0.88 },
    { offset: 0.7, opacity: 0 },
  ]);
});

test("intensity is clamped to 0-100", () => {
  assert.equal(scrimStops(150)[0].opacity, 1);
  assert.equal(scrimStops(-5)[0].opacity, 0);
});

test("the last stop is fully transparent", () => {
  for (const intensity of [0, 40, 88, 100]) assert.equal(scrimStops(intensity).at(-1)?.opacity, 0);
});
