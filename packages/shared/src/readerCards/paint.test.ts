import assert from "node:assert/strict";
import { test } from "node:test";
import { inks, mix, withStyle } from "./paint.js";

test("mix blends two colours channel by channel", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#ff0000", "#0000ff", 0), "#ff0000");
  assert.equal(mix("#1f4e6b", "#1f4e6b", 0.3), "#1f4e6b");
});

test("withStyle turns print classes into inline rules and refuses an unknown class", () => {
  assert.equal(withStyle(`<rect class="pg"/><path class="pl"/>`, ["#111111", "url(#rc-foilInk-1-paper)"]), `<rect style="fill:#111111"/><path style="stroke:url(#rc-foilInk-1-paper);fill:none"/>`);
  assert.throws(() => withStyle(`<rect class="nope"/>`, ["#000000", "#ffffff"]), /No print rule/);
  assert.deepEqual(inks("star", "paper"), ["#f1eadb", "#5b3b6e"]);
});
