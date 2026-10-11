import assert from "node:assert/strict";
import { test } from "node:test";
import { blendHex, coverWash } from "./coverWash.js";

test("coverWash light returns top, mid, and topAlpha", () => {
  const result = coverWash("#e0a82e", "light");
  assert.deepEqual(result, {
    top: "rgba(224, 168, 46, 0.32)",
    mid: "rgba(224, 168, 46, 0.16)",
    topAlpha: 0.32,
  });
});

test("coverWash dark uses 0.24 and 0.12 alpha", () => {
  const result = coverWash("#e0a82e", "dark");
  assert.deepEqual(result, {
    top: "rgba(224, 168, 46, 0.24)",
    mid: "rgba(224, 168, 46, 0.12)",
    topAlpha: 0.24,
  });
});

test("coverWash returns null for null input", () => {
  assert.equal(coverWash(null, "light"), null);
});

test("coverWash returns null for malformed color", () => {
  assert.equal(coverWash("gold", "light"), null);
});

test("blendHex midpoint", () => {
  assert.equal(blendHex("#ffffff", "#000000", 0.5), "#808080");
});

test("blendHex with specific color values", () => {
  const result = blendHex("#f2efe9", "#e0a82e", 0.32);
  assert.equal(result, "#ecd8ad");
});
