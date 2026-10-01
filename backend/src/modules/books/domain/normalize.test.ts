import assert from "node:assert/strict";
import { test } from "node:test";
import { authorMatches, catalogTitleKey, isPortugueseIsbn, lookupIdentity, normalizeTitle, searchTokens, titleMatches } from "./normalize.js";

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
    titleKey: "ta:orlando|virginia woolf|",
    isbn: "9780141184272",
    title: "Orlando",
    author: "Virginia Woolf"
  });
  assert.deepEqual(lookupIdentity({ isbn: "urn:uuid:ac11a7ae-d21e-42bb-8cfe-b85022867ac4", title: " The Stranger ", author: "Albert Camus" }), {
    key: "ta:the stranger|albert camus|",
    titleKey: "ta:the stranger|albert camus|",
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

test("catalogTitleKey ignores series brackets and later authors but keeps volume numbers", () => {
  assert.equal(catalogTitleKey("Dune (Dune Chronicles #1)", "Frank Herbert, Brian Herbert"), catalogTitleKey("Dune", "Frank Herbert"));
  assert.notEqual(catalogTitleKey("Complete Works: Volume 1", "A Poet"), catalogTitleKey("Complete Works: Volume 2", "A Poet"));
  assert.equal(catalogTitleKey("", "Anyone"), null);
});

test("Portuguese and Brazilian ISBNs are recognised by group prefix in both ISBN forms", () => {
  for (const isbn of ["9788535914849", "978-65-5921-001-1", "9789722518888", "9789896410001", "8535914846", "6559210014", "9722518887", "989641000X"]) {
    assert.equal(isPortugueseIsbn(isbn), true, isbn);
  }
  for (const isbn of ["9780141184272", "9782070360024", "0141184272", "2070360024", "9788420412146", "not an isbn", "", null]) {
    assert.equal(isPortugueseIsbn(isbn), false, String(isbn));
  }
});
