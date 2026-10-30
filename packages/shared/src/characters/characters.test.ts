import assert from "node:assert/strict";
import { test } from "node:test";
import { booksByWork } from "../library/works.js";
import { bookTierlists, bracketSizes, canCreate, characterBooks, characterSnapshot, defaultTicked, isCharacterBook, itemNoun, type CastCharacter, type CharacterSubject } from "./index.js";

const subject: CharacterSubject = {
  kind: "characters",
  scope: { kind: "series", key: "harry potter", label: "Harry Potter", coverUrl: null },
  characters: [
    { id: "ch:s:harry potter|harry potter", name: "Harry Potter" },
    { id: "ch:s:harry potter|hermione granger", name: "Hermione Granger" }
  ]
};

test("characterBooks makes library-shaped records in subject order", () => {
  assert.deepEqual(characterBooks(subject), [
    { Title: "Harry Potter", _workId: "ch:s:harry potter|harry potter", _character: true },
    { Title: "Hermione Granger", _workId: "ch:s:harry potter|hermione granger", _character: true }
  ]);
  assert.equal(booksByWork(characterBooks(subject)).get(subject.characters[1]!.id)?.Title, "Hermione Granger");
});

test("isCharacterBook is false for a library book", () => {
  assert.equal(isCharacterBook({ Title: "Dune", _workId: "w1" }), false);
  assert.equal(isCharacterBook(characterBooks(subject)[0]!), true);
});

test("characterSnapshot carries the scope label as author and no covers", () => {
  const [first] = characterSnapshot(subject);
  assert.deepEqual(first, { key: subject.characters[0]!.id, workId: subject.characters[0]!.id, title: "Harry Potter", author: "Harry Potter", isbn: null, imageId: null, coverUrl: null, readStatus: null });
  assert.equal(characterSnapshot(subject).length, 2);
});

test("bracketSizes are powers of two from 4 up to 128", () => {
  assert.deepEqual(bracketSizes(3), []);
  assert.deepEqual(bracketSizes(10), [4, 8]);
  assert.equal(bracketSizes(300).at(-1), 128);
});

test("defaultTicked takes 20 for a tier list and the bracket size for a tournament", () => {
  const cast: CastCharacter[] = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, name: `N${i}`, works: 1 }));
  assert.deepEqual(defaultTicked(cast, "tierlist", 0), cast.slice(0, 20).map((c) => c.id));
  assert.equal(defaultTicked(cast, "tournament", 8).length, 8);
});

test("canCreate needs 4 for a tier list and exactly the size for a tournament", () => {
  assert.equal(canCreate("tournament", 7, 8), false);
  assert.equal(canCreate("tournament", 8, 8), true);
  assert.equal(canCreate("tierlist", 4, 0), true);
  assert.equal(canCreate("tierlist", 3, 0), false);
});

test("itemNoun names characters when there is a subject", () => {
  assert.equal(itemNoun(subject, 12), "characters");
  assert.equal(itemNoun(subject, 1), "character");
  assert.equal(itemNoun(undefined, 1), "book");
  assert.equal(itemNoun(null, 2), "books");
});

test("bookTierlists drops lists with a subject", () => {
  assert.equal(bookTierlists([{ subject: null }, { subject }, {}]).length, 2);
});
