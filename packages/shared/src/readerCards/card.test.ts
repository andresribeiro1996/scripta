import assert from "node:assert/strict";
import { test } from "node:test";
import { readerCardLabel, readerCardPlateLine, readerGlyphLabel } from "./card.js";

test("the card's accessible label names the identity and how sure it is", () => {
  assert.equal(readerCardLabel({ state: "settled", identity: "star" }), "Reader card: the Stargazer");
  assert.equal(readerCardLabel({ state: "leaning", identity: "carto" }), "Reader card: the Cartographer, leaning");
  assert.equal(readerCardLabel({ state: "unwritten", identity: null }), "Reader card: unwritten");
});

test("the Unwritten plate line is the missing sentence with a lowercase first letter", () => {
  assert.equal(readerCardPlateLine("Finish 2 more books"), "finish 2 more books");
  assert.equal(readerCardPlateLine("Genres known for 4 of 10 books"), "genres known for 4 of 10 books");
  assert.equal(readerCardPlateLine(null), undefined);
});

test("readerGlyphLabel names the identity, and is undefined for no or an unknown identity", () => {
  assert.equal(readerGlyphLabel("star"), "the Stargazer");
  assert.equal(readerGlyphLabel(undefined), undefined);
  assert.equal(readerGlyphLabel("ghost" as never), undefined);
});
