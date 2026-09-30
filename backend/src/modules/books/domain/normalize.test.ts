import assert from "node:assert/strict";
import { test } from "node:test";
import { authorMatches, lookupIdentity, normalizeTitle, searchTokens, titleMatches } from "./normalize.js";

test("titles drop series brackets, subtitles and diacritics", () => {
  assert.equal(normalizeTitle("Red Rising (Red Rising Saga, #1)"), "red rising");
  assert.equal(normalizeTitle("The Dispossessed: An Ambiguous Utopia"), "the dispossessed");
  assert.equal(normalizeTitle("Antídoto"), "antidoto");
  assert.equal(normalizeTitle("Orlando (Penguin Modern Classics)"), "orlando");
  assert.equal(normalizeTitle("Wool Omnibus [Silo #1]"), "wool omnibus");
});

test("title matching is strict equality after normalization", () => {
  assert.equal(titleMatches("Orlando (Penguin Modern Classics)", "Orlando"), true);
  assert.equal(titleMatches("ECOTOPIA", "Ecotopia"), true);
  assert.equal(titleMatches("Illness as Metaphor", "Illness as Metaphor and AIDS and Its Metaphors"), false);
  assert.equal(titleMatches("?!", "?!"), false);
});

test("author matching accepts any listed name, including translator-first records", () => {
  assert.equal(authorMatches("Paulo Faria, George Orwell", ["George Orwell"]), true);
  assert.equal(authorMatches("Stanisław Lem", ["Stanisław Lem"]), true);
  assert.equal(authorMatches("Ursula K. Le Guin", ["Ursula K. Le Guin"]), true);
  assert.equal(authorMatches("Virginia Woolf", ["Susan Sontag"]), false);
  assert.equal(authorMatches("", ["Anyone"]), false);
});

test("lookup identity prefers a valid ISBN and falls back to title + author", () => {
  assert.deepEqual(lookupIdentity({ isbn: "978-0-14-118427-2", title: "Orlando", author: "Virginia Woolf" }), {
    key: "isbn:9780141184272",
    isbn: "9780141184272",
    title: "Orlando",
    author: "Virginia Woolf"
  });
  assert.deepEqual(lookupIdentity({ isbn: "urn:uuid:ac11a7ae-d21e-42bb-8cfe-b85022867ac4", title: " The Stranger ", author: "Albert Camus" }), {
    key: "ta:the stranger|albert camus",
    isbn: null,
    title: "The Stranger",
    author: "Albert Camus"
  });
  assert.equal(lookupIdentity({ title: "?!", author: "Someone" }), null);
  assert.equal(lookupIdentity({}), null);
});

test("search tokens are plain words, safe for FTS", () => {
  assert.deepEqual(searchTokens('"Dune" -messiah* (Herbert)'), ["dune", "messiah", "herbert"]);
  assert.deepEqual(searchTokens("***"), []);
  assert.equal(searchTokens("a b c d e f g h i j").length, 8);
});
