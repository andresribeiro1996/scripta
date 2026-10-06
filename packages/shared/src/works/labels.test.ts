import assert from "node:assert/strict";
import { test } from "node:test";
import { editionLabel, gameOwnerLabel, readerCountsLabel, readerStatusLabel } from "./labels.js";

test("reader status reads as words", () => {
  assert.equal(readerStatusLabel(0), "Wants to read");
  assert.equal(readerStatusLabel(1), "Reading");
  assert.equal(readerStatusLabel(2), "Finished");
});

test("counts read naturally, including none and one", () => {
  assert.equal(readerCountsLabel({ readers: 0, finished: 0 }), "No readers yet");
  assert.equal(readerCountsLabel({ readers: 1, finished: 0 }), "1 reader");
  assert.equal(readerCountsLabel({ readers: 12, finished: 8 }), "12 readers · 8 finished");
});

test("a promoted game is owned by Scripta", () => {
  assert.equal(gameOwnerLabel("app"), "Scripta");
  assert.equal(gameOwnerLabel({ username: "ana", avatarUrl: null }), "ana");
});

test("an edition label joins what is known", () => {
  assert.equal(editionLabel({ bookId: "b", title: "Dune", language: "pt-BR", year: 1965, isbn: "9780441013593", mine: false }), "pt-BR · 1965 · 9780441013593");
  assert.equal(editionLabel({ bookId: "b", title: "Dune", language: null, year: null, isbn: null, mine: false }), "Edition details unknown");
});
