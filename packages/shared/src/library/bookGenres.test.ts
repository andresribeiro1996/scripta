import assert from "node:assert/strict";
import { test } from "node:test";
import { GENRE_LOOKUP_BATCH, genreLookupOrder } from "./bookGenres.js";

test("genreLookupOrder puts finished books first, unread/reading after, both in stable order", () => {
  const unread = { Title: "A", ReadStatus: 0 };
  const finished1 = { Title: "B", ReadStatus: 2 };
  const reading = { Title: "C", ReadStatus: 1 };
  const finished2 = { Title: "D", ReadStatus: 2 };
  assert.deepEqual(genreLookupOrder([unread, finished1, reading, finished2]), [finished1, finished2, unread, reading]);
});

test("genreLookupOrder skips books that already have _genres, even an empty array", () => {
  const withGenres = { Title: "A", ReadStatus: 2, _genres: ["Fantasy"] };
  const withEmptyGenres = { Title: "B", ReadStatus: 2, _genres: [] };
  const needsLookup = { Title: "C", ReadStatus: 0 };
  assert.deepEqual(genreLookupOrder([withGenres, withEmptyGenres, needsLookup]), [needsLookup]);
});

test("GENRE_LOOKUP_BATCH is 20", () => {
  assert.equal(GENRE_LOOKUP_BATCH, 20);
});
