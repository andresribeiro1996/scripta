import assert from "node:assert/strict";
import { test } from "node:test";
import { readerCardShine, shineGradientCss } from "./shine.js";
import { FINISHES } from "./style.js";

test("only foil, holo and gilt shine", () => {
  assert.deepEqual(FINISHES.filter((finish) => readerCardShine(finish)), ["foil", "holo", "gilt"]);
  assert.equal(readerCardShine(undefined), null);
});

test("the web shine is one CSS gradient built from the shared stops", () => {
  assert.equal(shineGradientCss("foil"), "linear-gradient(110deg, rgba(255, 255, 255, 0) 40%, rgba(255, 255, 255, 0.5) 50%, rgba(255, 255, 255, 0) 60%)");
  assert.match(shineGradientCss("holo"), /^linear-gradient\(110deg, rgba\(127, 107, 214, 0\) 30%/);
});
