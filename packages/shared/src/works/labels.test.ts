import assert from "node:assert/strict";
import { test } from "node:test";
import { editionLabel, gameOwnerLabel, readerCountsLabel, readerStatusLabel, summaryPreview } from "./labels.js";

test("reader status reads as words", () => {
  assert.equal(readerStatusLabel(0, "en"), "Wants to read");
  assert.equal(readerStatusLabel(1, "en"), "Reading");
  assert.equal(readerStatusLabel(2, "en"), "Finished");
});

test("counts read naturally, including none and one", () => {
  assert.equal(readerCountsLabel({ readers: 0, finished: 0 }, "en"), "No readers yet");
  assert.equal(readerCountsLabel({ readers: 1, finished: 0 }, "en"), "1 reader");
  assert.equal(readerCountsLabel({ readers: 12, finished: 8 }, "en"), "12 readers · 8 finished");
});

test("a promoted game is owned by Atmyshelf", () => {
  assert.equal(gameOwnerLabel("app"), "Atmyshelf");
  assert.equal(gameOwnerLabel({ username: "ana", avatarUrl: null }), "ana");
});

test("an edition label joins what is known", () => {
  assert.equal(editionLabel({ bookId: "b", title: "Dune", language: "pt-BR", year: 1965, isbn: "9780441013593", coverUrl: null, coverColor: null, pages: null, mine: false }, "en"), "pt-BR · 1965 · 9780441013593");
  assert.equal(editionLabel({ bookId: "b", title: "Dune", language: null, year: null, isbn: null, coverUrl: null, coverColor: null, pages: null, mine: false }, "en"), "Edition details unknown");
});

test("a long summary previews whole words up to a cut, a short one needs no preview", () => {
  assert.equal(summaryPreview("A short summary."), null);
  const long = `${"word ".repeat(70)}end`;
  const preview = summaryPreview(long)!;
  assert.ok(preview.length <= 321);
  assert.ok(preview.endsWith("word…"));
  assert.ok(long.startsWith(preview.slice(0, -1)));
});

test("reader counts pluralise in Portuguese", () => {
  assert.deepEqual([0, 1, 2, 1000].map((readers) => readerCountsLabel({ readers, finished: 0 }, "pt-PT")), ["Ainda sem leitores", "1 leitor", "2 leitores", "1000 leitores"]);
  assert.equal(readerCountsLabel({ readers: 12, finished: 8 }, "pt-PT"), "12 leitores · 8 lidos");
  assert.equal(readerStatusLabel(0, "pt-PT"), "Quer ler");
});
