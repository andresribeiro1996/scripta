import assert from "node:assert/strict";
import { test } from "node:test";
import type { Group } from "../library/groups.js";
import { bookKey } from "../library/merge.js";
import { readerIdentity } from "../library/readerIdentity.js";
import { readerCardLabel, readerCardPlateLine, readerGlyphLabel, ownGlyphPreview } from "./card.js";

const book = (i: number, fields: Record<string, unknown> = {}) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, ...fields });
const shelf = (count: number, fields: (i: number) => Record<string, unknown> = () => ({})) => Array.from({ length: count }, (_, i) => book(i, fields(i)));
const series = (books: ReturnType<typeof book>[]): Group => ({ id: "g1", type: "series", name: "Discworld", bookKeys: books.map(bookKey), createdAt: "", updatedAt: "" });

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

test("ownGlyphPreview shows the glyph and names the identity once settled", () => {
  const loyal = shelf(10, (i) => (i < 4 ? { Attribution: "Kazuo Ishiguro" } : {}));
  const identity = readerIdentity(loyal, []);
  assert.equal(identity.state, "settled");
  assert.deepEqual(ownGlyphPreview(identity), { glyph: "loyal", line: "Others see you as the Loyalist." });
});

test("ownGlyphPreview shows no glyph while leaning", () => {
  const books = shelf(11);
  const leaning = readerIdentity(books, [series(books.slice(0, 3))]);
  assert.equal(leaning.state, "leaning");
  assert.deepEqual(ownGlyphPreview(leaning), { glyph: null, line: "Your reader card isn't settled yet, so no glyph shows." });
});
