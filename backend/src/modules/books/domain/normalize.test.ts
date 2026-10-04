import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BRAZIL_ISBN10_PREFIXES,
  BRAZIL_ISBN13_PREFIXES,
  PORTUGAL_ISBN10_PREFIXES,
  PORTUGAL_ISBN13_PREFIXES,
  authorMatches,
  catalogTitleKey,
  editionLanguage,
  isPortugalIsbn,
  isPortugueseIsbn,
  lookupIdentity,
  normalizeTitle,
  searchTokens,
  titleMatches
} from "./normalize.js";

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
    aliasKeys: [],
    titleKey: "ta:orlando|virginia woolf|",
    isbn: "9780141184272",
    title: "Orlando",
    author: "Virginia Woolf"
  });
  assert.deepEqual(lookupIdentity({ isbn: "urn:uuid:ac11a7ae-d21e-42bb-8cfe-b85022867ac4", title: " The Stranger ", author: "Albert Camus" }), {
    key: "ta:the stranger|albert camus|",
    aliasKeys: [],
    titleKey: "ta:the stranger|albert camus|",
    isbn: null,
    title: "The Stranger",
    author: "Albert Camus"
  });
  assert.equal(lookupIdentity({ title: "?!", author: "Someone" }), null);
  assert.equal(lookupIdentity({}), null);
});

test("lookupIdentity keys an ISBN-10 by its ISBN-13 and keeps the ISBN-10 as an alias", () => {
  const identity = lookupIdentity({ isbn: "0-441-01359-7", title: "Dune", author: "Frank Herbert" })!;
  assert.equal(identity.key, "isbn:9780441013593");
  assert.equal(identity.isbn, "9780441013593");
  assert.deepEqual(identity.aliasKeys, ["isbn:0441013597"]);
});

test("lookupIdentity has no alias for an ISBN-13 or a title-only lookup", () => {
  assert.deepEqual(lookupIdentity({ isbn: "9780441013593", title: "Dune", author: "" })!.aliasKeys, []);
  assert.deepEqual(lookupIdentity({ title: "Dune", author: "Frank Herbert" })!.aliasKeys, []);
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

const PORTUGAL_ISBNS = ["9789722518888", "9789896410001", "978-972-25-1888-8", "9722518887", "989641000X"];
const BRAZIL_ISBNS = ["9788535914849", "978-65-5921-001-1", "8535914846", "6559210014"];
const OTHER_ISBNS = ["9780141184272", "0141184272", "9782070360024", "not an isbn", "", null];

test("the Portugal and Brazil group prefixes are listed apart, for both ISBN forms", () => {
  assert.deepEqual(PORTUGAL_ISBN13_PREFIXES, ["978972", "978989"]);
  assert.deepEqual(PORTUGAL_ISBN10_PREFIXES, ["972", "989"]);
  assert.deepEqual(BRAZIL_ISBN13_PREFIXES, ["97885", "97865"]);
  assert.deepEqual(BRAZIL_ISBN10_PREFIXES, ["85", "65"]);
});

test("only an ISBN registered in Portugal is a Portugal ISBN", () => {
  for (const isbn of PORTUGAL_ISBNS) assert.equal(isPortugalIsbn(isbn), true, isbn);
  for (const isbn of [...BRAZIL_ISBNS, ...OTHER_ISBNS]) assert.equal(isPortugalIsbn(isbn), false, String(isbn));
});

test("a MARC language code maps to its two-letter tag, with or without the Open Library path", () => {
  const table = [["eng", "en"], ["por", "pt"], ["spa", "es"], ["fre", "fr"], ["ger", "de"], ["ita", "it"], ["dut", "nl"], ["cat", "ca"], ["glg", "gl"], ["jpn", "ja"], ["chi", "zh"], ["rus", "ru"]] as const;
  for (const [marc, tag] of table) {
    assert.equal(editionLanguage([marc], null), tag, marc);
    assert.equal(editionLanguage([`/languages/${marc}`], null), tag, `/languages/${marc}`);
  }
});

test("the first mappable code wins, and no mappable code gives null", () => {
  assert.equal(editionLanguage(["lat", "ger", "eng"], null), "de");
  assert.equal(editionLanguage(["lat", "grc"], null), null);
  assert.equal(editionLanguage(["/languages/lat"], null), null);
  assert.equal(editionLanguage([""], null), null);
  assert.equal(editionLanguage([], "9789722518888"), null);
});

test("Portuguese takes its region from the ISBN group: pt-PT for Portugal, pt-BR for Brazil, pt for anything else", () => {
  for (const isbn of PORTUGAL_ISBNS) assert.equal(editionLanguage(["por"], isbn), "pt-PT", isbn);
  for (const isbn of BRAZIL_ISBNS) assert.equal(editionLanguage(["por"], isbn), "pt-BR", isbn);
  for (const isbn of OTHER_ISBNS) assert.equal(editionLanguage(["por"], isbn), "pt", String(isbn));
  assert.equal(editionLanguage(["/languages/por"], "9788535914849"), "pt-BR");
});

test("only Portuguese is regional: another language ignores the ISBN group", () => {
  assert.equal(editionLanguage(["eng"], "9789722518888"), "en");
  assert.equal(editionLanguage(["spa"], "9788535914849"), "es");
});
