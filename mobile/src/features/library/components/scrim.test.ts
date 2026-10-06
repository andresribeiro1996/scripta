import assert from "node:assert/strict";
import { test } from "node:test";
import { cardTextMayBeHardToRead, scrimStops } from "./scrim";

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

test("readability feedback accounts for backdrop, text color and fade over the canvas", () => {
  const style = { cardTextColor: null, overlayIntensity: 88, cardOpacity: 100 };
  assert.equal(cardTextMayBeHardToRead(style, "#ffffff"), false);
  assert.equal(cardTextMayBeHardToRead({ ...style, overlayIntensity: 40 }, "#ffffff"), true);
  assert.equal(cardTextMayBeHardToRead({ ...style, cardTextColor: "#000000" }, "#ffffff"), true);
  assert.equal(cardTextMayBeHardToRead({ ...style, cardOpacity: 30 }, "#ffffff"), true);
  assert.equal(cardTextMayBeHardToRead({ ...style, cardOpacity: 70 }, "#000000"), false);
  assert.equal(cardTextMayBeHardToRead({ ...style, cardOpacity: -10 }, "#ffffff"), true);
  assert.equal(cardTextMayBeHardToRead({ ...style, cardOpacity: 200 }, "#ffffff"), false);
  assert.equal(cardTextMayBeHardToRead({ ...style, cardTextColor: "rgba(0,0,0,0.5)" }, "#ffffff"), false);
});
