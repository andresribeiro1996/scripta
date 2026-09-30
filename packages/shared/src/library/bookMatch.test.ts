import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalIsbn, firstAuthor, isCertainMatch, isLikelyMatch, normalizeTitle, titleNumbers } from "./bookMatch.js";

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
