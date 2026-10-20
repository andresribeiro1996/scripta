import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSeriesString, SERIES_SOURCE_RANK, seriesFromSubjects, seriesNameKey } from "./series.js";

test("a series name key ignores case, accents, punctuation and surrounding space", () => {
  assert.equal(seriesNameKey("  Bang! "), seriesNameKey("bang"));
  assert.equal(seriesNameKey("Bang!"), "bang");
  assert.equal(seriesNameKey("Coleção Clássicos"), "colecao classicos");
  assert.equal(seriesNameKey("Malazan: Book of the Fallen"), seriesNameKey("malazan book of the fallen"));
});

test("a name with no letters or digits has no key", () => {
  assert.equal(seriesNameKey("--"), null);
  assert.equal(seriesNameKey("   "), null);
  assert.equal(seriesNameKey(""), null);
});

test("sources rank Wikidata, then Open Library editions, then subjects, then original titles", () => {
  assert.deepEqual(SERIES_SOURCE_RANK, { wikidata: 0, "ol-edition": 1, "ol-subject": 2, "original-title": 3 });
});

test("a series string gives its name and the position written in any of Open Library's forms", () => {
  assert.deepEqual(parseSeriesString("Malazan Book of the Fallen (3)"), { name: "Malazan Book of the Fallen", position: "3" });
  assert.deepEqual(parseSeriesString("Malazan Book of the Fallen #3"), { name: "Malazan Book of the Fallen", position: "3" });
  assert.deepEqual(parseSeriesString("Malazan Book of the Fallen ; 3"), { name: "Malazan Book of the Fallen", position: "3" });
  assert.deepEqual(parseSeriesString("Dune Chronicles, Book 1"), { name: "Dune Chronicles", position: "1" });
  assert.deepEqual(parseSeriesString("Dune Chronicles, book 12"), { name: "Dune Chronicles", position: "12" });
});

test("a position written as a word from one to twenty reads as its number", () => {
  assert.deepEqual(parseSeriesString("Dune Chronicles, Book Three"), { name: "Dune Chronicles", position: "3" });
  assert.deepEqual(parseSeriesString("Dune Chronicles, book one"), { name: "Dune Chronicles", position: "1" });
  assert.deepEqual(parseSeriesString("Discworld, BOOK TWENTY"), { name: "Discworld", position: "20" });
});

test("a series string without a position is just a name, trimmed", () => {
  assert.deepEqual(parseSeriesString("Bang!"), { name: "Bang!", position: null });
  assert.deepEqual(parseSeriesString("  Penguin classics  "), { name: "Penguin classics", position: null });
  assert.deepEqual(parseSeriesString("Fahrenheit 451"), { name: "Fahrenheit 451", position: null });
});

test("an empty or punctuation-only series name has no entry", () => {
  for (const raw of ["", "   ", "  ;  ", "--", "(3)", "#3", " ; 3", ", Book 1"]) assert.equal(parseSeriesString(raw), null, JSON.stringify(raw));
});

test("series subjects give their names with underscores read as spaces, and other subjects are ignored", () => {
  assert.deepEqual(seriesFromSubjects(["Fantasy", "series:Malazan_Book_of_the_Fallen"]), [{ name: "Malazan Book of the Fallen", position: null }]);
  assert.deepEqual(seriesFromSubjects(["SERIES:Dune_Chronicles", "Series:Discworld_(2)", "series:", "series:--", "seriesx:Nope"]), [{ name: "Dune Chronicles", position: null }, { name: "Discworld", position: "2" }]);
  assert.deepEqual(seriesFromSubjects(["Fantasy", 7, null, { subject: "series:x" }]), []);
  for (const nothing of [undefined, null, "series:Dune", 3, {}]) assert.deepEqual(seriesFromSubjects(nothing), [], String(nothing));
});
