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

test("a separator before the number is not part of the name", () => {
  assert.deepEqual(parseSeriesString("Hyperion Cantos, #1"), { name: "Hyperion Cantos", position: "1" });
  assert.deepEqual(parseSeriesString("Harry Potter, #1"), { name: "Harry Potter", position: "1" });
  assert.deepEqual(parseSeriesString("Discworld ; #3"), { name: "Discworld", position: "3" });
  assert.deepEqual(parseSeriesString("Discworld: #3"), { name: "Discworld", position: "3" });
  assert.deepEqual(parseSeriesString("Penguin classics,"), { name: "Penguin classics", position: null });
  assert.deepEqual(parseSeriesString("Penguin classics -"), { name: "Penguin classics", position: null });
});

test("a bare number after a comma, a book marker after a separator, and a decimal position are read as positions", () => {
  assert.deepEqual(parseSeriesString("Harry Potter, 1"), { name: "Harry Potter", position: "1" });
  assert.deepEqual(parseSeriesString("Dune chronicles -- bk. 1"), { name: "Dune chronicles", position: "1" });
  assert.deepEqual(parseSeriesString("The Witcher: Book 0.5"), { name: "The Witcher", position: "0.5" });
  assert.deepEqual(parseSeriesString("Discworld (2.5)"), { name: "Discworld", position: "2.5" });
  assert.deepEqual(parseSeriesString("Discworld #1.5"), { name: "Discworld", position: "1.5" });
  assert.deepEqual(parseSeriesString("Discworld; v.2"), { name: "Discworld", position: "2" });
  assert.deepEqual(parseSeriesString("Discworld, Vol. 3"), { name: "Discworld", position: "3" });
  assert.deepEqual(parseSeriesString("Discworld -- no. 4"), { name: "Discworld", position: "4" });
  assert.deepEqual(parseSeriesString("The Witcher: Book Twelve"), { name: "The Witcher", position: "12" });
  assert.deepEqual(parseSeriesString("Earth, Wind, Fire, 7"), { name: "Earth, Wind, Fire", position: "7" });
});

test("a name that merely ends in a number, or has a separator and no number, stays whole", () => {
  assert.deepEqual(parseSeriesString("Catch-22"), { name: "Catch-22", position: null });
  assert.deepEqual(parseSeriesString("1984"), { name: "1984", position: null });
  assert.deepEqual(parseSeriesString("Apollo 13"), { name: "Apollo 13", position: null });
  assert.deepEqual(parseSeriesString("Spider-Man"), { name: "Spider-Man", position: null });
  assert.deepEqual(parseSeriesString("Discworld, one"), { name: "Discworld, one", position: null });
  assert.deepEqual(parseSeriesString("Harry Potter, Book"), { name: "Harry Potter, Book", position: null });
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
  for (const raw of ["", "   ", "  ;  ", "--", "(3)", "#3", " ; 3", ", Book 1", ", 1", ", #1", "-- bk. 1"]) assert.equal(parseSeriesString(raw), null, JSON.stringify(raw));
});

test("series subjects give their names with underscores read as spaces, and other subjects are ignored", () => {
  assert.deepEqual(seriesFromSubjects(["Fantasy", "series:Malazan_Book_of_the_Fallen"]), [{ name: "Malazan Book of the Fallen", position: null }]);
  assert.deepEqual(seriesFromSubjects(["SERIES:Dune_Chronicles", "Series:Discworld_(2)", "series:", "series:--", "seriesx:Nope"]), [{ name: "Dune Chronicles", position: null }, { name: "Discworld", position: "2" }]);
  assert.deepEqual(seriesFromSubjects(["Fantasy", 7, null, { subject: "series:x" }]), []);
  for (const nothing of [undefined, null, "series:Dune", 3, {}]) assert.deepEqual(seriesFromSubjects(nothing), [], String(nothing));
});
