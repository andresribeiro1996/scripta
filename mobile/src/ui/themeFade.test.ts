import assert from "node:assert/strict";
import { test } from "node:test";
import { nextVeil, shouldFadeTheme } from "./themeFade";

test("only a pick that changes the visible theme fades, and never under reduce-motion", () => {
  assert.equal(shouldFadeTheme({ fade: true, reduced: false, from: "light", to: "matrix" }), true);
  assert.equal(shouldFadeTheme({ fade: false, reduced: false, from: "light", to: "matrix" }), false);
  assert.equal(shouldFadeTheme({ fade: true, reduced: true, from: "light", to: "matrix" }), false);
  assert.equal(shouldFadeTheme({ fade: true, reduced: false, from: "light", to: "light" }), false);
});

test("each pick starts a fresh veil in the colour it is leaving", () => {
  const first = nextVeil(null, "#f2f0ec");
  const second = nextVeil(first, "#020805");
  assert.deepEqual(first, { color: "#f2f0ec", key: 1 });
  assert.deepEqual(second, { color: "#020805", key: 2 });
});
