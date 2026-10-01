import assert from "node:assert/strict";
import { test } from "node:test";
import { bookMatchKeys, canonicalIsbn, firstAuthor, isCertainMatch, isLikelyMatch, normalizeTitle, titleNumbers } from "./bookMatch.js";

const dune = { Title: "Dune", Attribution: "Frank Herbert" };

test("canonicalIsbn converts ISBN-10 to ISBN-13 and ignores case and hyphens", () => {
  assert.equal(canonicalIsbn("0-441-01359-7"), "9780441013593");
  assert.equal(canonicalIsbn("9780441013593"), "9780441013593");
  assert.equal(canonicalIsbn("080442957x"), canonicalIsbn("080442957X"));
  assert.equal(canonicalIsbn("urn:uuid:abc"), "");
});

test("normalizeTitle drops brackets, subtitles and diacritics; titleNumbers ignores bracketed numbers", () => {
  assert.equal(normalizeTitle("Dune (Dune Chronicles #1)"), "dune");
  assert.equal(normalizeTitle("Dune: Deluxe Edition"), "dune");
  assert.equal(normalizeTitle("Antídoto"), "antidoto");
  assert.equal(titleNumbers("Dune (Dune Chronicles #1)"), "");
  assert.equal(titleNumbers("Complete Works: Volume 2"), "2");
});

test("firstAuthor keeps only the first listed author", () => {
  assert.equal(firstAuthor("Frank Herbert, Brian Herbert"), "frank herbert");
  assert.equal(firstAuthor(""), "");
});

test("certain: same ISBN in any form, or same title and first author when at most one has an ISBN", () => {
  assert.equal(isCertainMatch({ ...dune, ISBN: "0441013597" }, { Title: "Other", Attribution: "X", ISBN: "978-0441013593" }), true);
  assert.equal(isCertainMatch({ ...dune, ISBN: "9780441013593" }, { Title: "DUNE", Attribution: "Frank Herbert, Someone Else" }), true);
  assert.equal(isCertainMatch({ ...dune, ISBN: "9780441013593" }, { ...dune, ISBN: "9780593099322" }), false);
  assert.equal(isCertainMatch(dune, { Title: "Dune (Dune Chronicles #1)", Attribution: "Frank Herbert" }), false);
});

test("likely: same main title and surname with equal numbers, never when already certain", () => {
  assert.equal(isLikelyMatch(dune, { Title: "Dune (Dune Chronicles #1)", Attribution: "Frank Herbert" }), true);
  assert.equal(isLikelyMatch(dune, { Title: "Dune: Deluxe Edition", Attribution: "F. Herbert", ISBN: "9780593099322" }), true);
  assert.equal(isLikelyMatch({ ...dune, ISBN: "9780441013593" }, { ...dune, ISBN: "9780593099322" }), true);
  assert.equal(isLikelyMatch({ Title: "Complete Works: Volume 1", Attribution: "A Poet" }, { Title: "Complete Works: Volume 2", Attribution: "A Poet" }), false);
  assert.equal(isLikelyMatch(dune, dune), false);
});

test("books without a title never match", () => {
  const untitled = { Title: "", Attribution: "" };
  assert.equal(isCertainMatch(untitled, { ...untitled }), false);
  assert.equal(isLikelyMatch(untitled, { ...untitled }), false);
});

test("bookMatchKeys returns the ISBN key then the title-and-author key", () => {
  const book = { ISBN: "978-0-00-000000-2", Title: " Dune ", Attribution: "Frank  Herbert" };
  assert.deepEqual(bookMatchKeys(book), ["isbn:9780000000002", "ta:dune|frank herbert"]);
});

test("bookMatchKeys gives an ISBN-10 and its ISBN-13 the same isbn key", () => {
  assert.deepEqual(bookMatchKeys({ ISBN: "0-441-01359-7" }), ["isbn:9780441013593"]);
  assert.deepEqual(bookMatchKeys({ ISBN: "9780441013593" }), ["isbn:9780441013593"]);
});

test("bookMatchKeys returns only the title-and-author key without a usable ISBN", () => {
  assert.deepEqual(bookMatchKeys(dune), ["ta:dune|frank herbert"]);
  assert.deepEqual(bookMatchKeys({ ...dune, ISBN: "not an isbn" }), ["ta:dune|frank herbert"]);
});

test("bookMatchKeys lets a book with an ISBN share a key with the same book without one", () => {
  const withIsbn = bookMatchKeys({ ...dune, ISBN: "9780441013593" });
  const withoutIsbn = bookMatchKeys({ Title: "DUNE", Attribution: "frank herbert" });
  assert.ok(withoutIsbn.some((key) => withIsbn.includes(key)));
});

test("bookMatchKeys omits the title-and-author key unless both title and author are present", () => {
  assert.deepEqual(bookMatchKeys({ Title: "Dune" }), []);
  assert.deepEqual(bookMatchKeys({ Attribution: "Frank Herbert" }), []);
  assert.deepEqual(bookMatchKeys({ Title: "", Attribution: "  " }), []);
  assert.deepEqual(bookMatchKeys({}), []);
  assert.deepEqual(bookMatchKeys({ ISBN: "978-0-00-000000-2", Title: "Dune" }), ["isbn:9780000000002"]);
});

test("bookMatchKeys keys the exact title and the first author, so a bracketed series stays part of the title", () => {
  assert.deepEqual(bookMatchKeys({ Title: "Dune", Attribution: "Frank Herbert, Brian Herbert" }), ["ta:dune|frank herbert"]);
  assert.deepEqual(bookMatchKeys({ Title: "Dune (Dune Chronicles #1)", Attribution: "Frank Herbert" }), ["ta:dune dune chronicles 1|frank herbert"]);
});

test("a bracketed part ends at the first closing bracket, and an unclosed bracket stays in the title", () => {
  assert.equal(normalizeTitle("Dune (Chronicles (Book 1)) Extra"), "dune extra");
  assert.equal(normalizeTitle("Dune (Chronicles"), "dune chronicles");
  assert.equal(normalizeTitle("Dune [Deluxe] (Edition)"), "dune");
  assert.equal(titleNumbers("Vol 2 [3] (4"), "2 4");
  assert.equal(titleNumbers("Vol 2 (a (3) 4) 5"), "2 4 5");
});

test("a title made of unclosed brackets is normalized in linear time", () => {
  const started = performance.now();
  normalizeTitle("(".repeat(300000));
  titleNumbers("[".repeat(300000));
  assert.ok(performance.now() - started < 1000);
});
