import assert from "node:assert/strict";
import { test } from "node:test";
import { DISPLAY_MIN_FONT_SIZE, fontStyleFor, slotFor, textBreakStrategyFor } from "./fontStyle";

test("slotFor picks display from 18pt up unless display says otherwise", () => {
  assert.equal(DISPLAY_MIN_FONT_SIZE, 18);
  assert.equal(slotFor(undefined, undefined), "text");
  assert.equal(slotFor(17, undefined), "text");
  assert.equal(slotFor(18, undefined), "display");
  assert.equal(slotFor(24, false), "text");
  assert.equal(slotFor(12, true), "display");
});

test("system fonts and text with its own family are left alone", () => {
  assert.equal(fontStyleFor("system", "text", { fontSize: 14 }), null);
  assert.equal(fontStyleFor("system", "display", { fontSize: 24 }), null);
  assert.equal(fontStyleFor("literata", "text", { fontFamily: "serif", fontSize: 14 }), null);
});

test("text fonts map weight to the bundled file and reset fontWeight", () => {
  assert.deepEqual(fontStyleFor("literata", "text", { fontSize: 14 }), { fontFamily: "literata-400", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("literata", "text", { fontWeight: "700" }), { fontFamily: "literata-700", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("atkinson", "text", { fontWeight: "600" }), { fontFamily: "atkinson-700", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("atkinson", "text", { fontWeight: "bold" }), { fontFamily: "atkinson-700", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("jetbrainsMono", "text", { fontWeight: "normal" }), { fontFamily: "jetbrainsMono-400", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("jetbrainsMono", "text", { fontWeight: 500 }), { fontFamily: "jetbrainsMono-400", fontWeight: "normal" });
});

test("display fonts use their heading weight and scale size and line height", () => {
  assert.deepEqual(fontStyleFor("playfair", "display", { fontSize: 24, lineHeight: 30, fontWeight: "700" }), { fontFamily: "playfair-700", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("literata", "display", { fontSize: 18 }), { fontFamily: "literata-700", fontWeight: "normal" });
  assert.deepEqual(fontStyleFor("vt323", "display", { fontSize: 24, lineHeight: 30 }), { fontFamily: "vt323-400", fontWeight: "normal", fontSize: 31, lineHeight: 39 });
  assert.deepEqual(fontStyleFor("pressStart", "display", {}), { fontFamily: "pressStart-400", fontWeight: "normal", fontSize: 10 });
  assert.deepEqual(fontStyleFor("cormorant", "display", { fontSize: 24 }), { fontFamily: "cormorant-600", fontWeight: "normal", fontSize: 27 });
});

test("textBreakStrategyFor picks simple for custom fonts unless the caller requested otherwise", () => {
  assert.equal(textBreakStrategyFor(true, undefined), "simple");
  assert.equal(textBreakStrategyFor(true, "highQuality"), "highQuality");
  assert.equal(textBreakStrategyFor(false, undefined), undefined);
  assert.equal(textBreakStrategyFor(false, "balanced"), "balanced");
});
