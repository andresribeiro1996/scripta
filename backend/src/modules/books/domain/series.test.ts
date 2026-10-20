import assert from "node:assert/strict";
import { test } from "node:test";
import { SERIES_SOURCE_RANK, seriesNameKey } from "./series.js";

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
