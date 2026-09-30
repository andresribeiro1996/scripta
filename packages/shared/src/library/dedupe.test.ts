import assert from "node:assert/strict";
import { test } from "node:test";
import { combineBooks, findDuplicates, markDistinct, mergeCertainDuplicates, mergeDuplicateBooks, rekeyKeys, rekeyTierBoard } from "./dedupe.js";
import { bookKey } from "./merge.js";
import type { LibraryData } from "./types.js";

const kobo = { ContentID: "k1", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1, ___PercentRead: 40, _order: 0, highlights: [{ BookmarkID: "h1" }] };
const goodreads = { ContentID: "g1", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2, Rating: 5, _order: 1, highlights: [{ BookmarkID: "h2" }] };
const series = { ContentID: "k2", Title: "Dune (Dune Chronicles #1)", Attribution: "Frank Herbert", _order: 2 };
const deluxe = { ContentID: "g2", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780593099322", _order: 3 };

test("findDuplicates separates certain groups from likely ones, ISBN-bearing books first then library order", () => {
  const groups = findDuplicates({ books: [kobo, goodreads, series] });
  assert.deepEqual(groups.certain, [[bookKey(goodreads), bookKey(kobo)]]);
  assert.deepEqual(groups.likely, [[bookKey(goodreads), bookKey(kobo), bookKey(series)]]);
});

test("a certain group bridging two different ISBNs is demoted to likely", () => {
  const groups = findDuplicates({ books: [kobo, goodreads, deluxe] });
  assert.deepEqual(groups.certain, []);
  assert.deepEqual(groups.likely, [[bookKey(goodreads), bookKey(deluxe), bookKey(kobo)]]);
});

test("pairs in distinctBooks are never grouped", () => {
  const groups = findDuplicates({ books: [goodreads, deluxe], distinctBooks: [[bookKey(deluxe), bookKey(goodreads)]] });
  assert.deepEqual(groups, { certain: [], likely: [] });
});

test("corrupt distinctBooks entries are skipped instead of throwing", () => {
  const library = { books: [goodreads, deluxe], distinctBooks: [null, "x", [bookKey(goodreads)]] } as unknown as LibraryData;
  assert.doesNotThrow(() => findDuplicates(library));
  assert.doesNotThrow(() => mergeDuplicateBooks({ books: [kobo, goodreads], distinctBooks: library.distinctBooks }, bookKey(kobo), [bookKey(goodreads)]));
});

test("untitled books and non-object entries never group and never throw", () => {
  const library = { books: [{ Title: "", Attribution: "" }, { Title: "", Attribution: "" }, null, "junk", 7] } as unknown as LibraryData;
  assert.deepEqual(findDuplicates(library), { certain: [], likely: [] });
  assert.equal(mergeDuplicateBooks(library, "missing", []), library);
  const withJunk = { books: [kobo, null, goodreads, "junk"] } as unknown as LibraryData;
  assert.deepEqual(mergeDuplicateBooks(withJunk, bookKey(kobo), [bookKey(goodreads)]).books.slice(1), [null, "junk"]);
});

test("findDuplicates stays fast on a 3,000-book library", () => {
  const books = Array.from({ length: 3000 }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i % 50}`, ISBN: "" }));
  const started = Date.now();
  findDuplicates({ books });
  assert.ok(Date.now() - started < 1000);
});

test("combineBooks keeps the survivor's fields, fills gaps, and takes the furthest progress", () => {
  const combined = combineBooks(kobo, goodreads);
  assert.equal(combined.ContentID, "k1");
  assert.equal(combined.ISBN, "9780441013593");
  assert.equal(combined.Rating, 5);
  assert.equal(combined.ReadStatus, 2);
  assert.equal(combined.___PercentRead, 40);
  assert.deepEqual(combined.highlights, [{ BookmarkID: "h1" }, { BookmarkID: "h2" }]);
  assert.equal("_genres" in combined, false);
  assert.deepEqual(combineBooks({ ...kobo, _genres: ["Fantasy"] }, { ...goodreads, _genres: ["Science Fiction"] })._genres, ["Fantasy", "Science Fiction"]);
});

test("mergeDuplicateBooks keeps the survivor in place and rewrites groups and distinct pairs", () => {
  const library: LibraryData = {
    books: [kobo, series, goodreads],
    groups: [{ id: "s", type: "series", name: "Dune", bookKeys: [bookKey(goodreads), bookKey(kobo)], createdAt: "t", updatedAt: "t" }],
    distinctBooks: [[bookKey(goodreads), bookKey(series)], [bookKey(goodreads), bookKey(kobo)]]
  };
  const merged = mergeDuplicateBooks(library, bookKey(kobo), [bookKey(goodreads)]);
  assert.deepEqual(merged.books.map((book) => (book as Record<string, unknown>).ContentID), ["k1", "k2"]);
  assert.equal(merged.book_count, 2);
  assert.deepEqual(merged.groups![0]!.bookKeys, [bookKey(kobo)]);
  assert.notEqual(merged.groups![0]!.updatedAt, "t");
  assert.deepEqual(merged.distinctBooks, [[bookKey(series), bookKey(kobo)]]);
});

test("the merged survivor keeps the original's identity, so its bookKey is unchanged", () => {
  const merged = mergeDuplicateBooks({ books: [kobo, goodreads] }, bookKey(kobo), [bookKey(goodreads)]);
  const survivor = merged.books[0] as Record<string, unknown>;
  assert.equal(bookKey(survivor), bookKey(kobo));
  assert.equal("ISBN" in survivor, false);
  assert.equal(survivor.Rating, 5);
});

test("mergeDuplicateBooks is a no-op when the keys are gone", () => {
  const library: LibraryData = { books: [kobo] };
  assert.equal(mergeDuplicateBooks(library, bookKey(kobo), [bookKey(goodreads)]), library);
  assert.equal(mergeDuplicateBooks(library, "missing", [bookKey(kobo)]), library);
});

test("markDistinct records every pair of the group once", () => {
  const marked = markDistinct({ books: [], distinctBooks: [["a", "b"]] }, ["b", "a", "c"]);
  assert.deepEqual(marked.distinctBooks, [["a", "b"], ["b", "c"], ["a", "c"]]);
});

test("rekeyKeys and rekeyTierBoard rewrite and de-duplicate, tiers winning over the pool", () => {
  const from = new Set(["old"]);
  assert.deepEqual(rekeyKeys(["old", "x", "new"], from, "new"), ["new", "x"]);
  const board = { name: "n", tiers: [{ id: "s", bookKeys: ["old"] }, { id: "a", bookKeys: ["new"] }], pool: ["new", "y"] };
  assert.deepEqual(rekeyTierBoard(board, from, "new"), { name: "n", tiers: [{ id: "s", bookKeys: ["new"] }, { id: "a", bookKeys: [] }], pool: ["y"] });
});

const doc = (books: unknown[], updatedAt = "v1") => ({ data: { books } as LibraryData, updatedAt });

test("mergeCertainDuplicates merges each certain group once and returns the last document", async () => {
  const calls: Array<[string, string[], string]> = [];
  const start = doc([kobo, goodreads, series]);
  const result = await mergeCertainDuplicates(
    start,
    async (keep, merge, updatedAt) => {
      calls.push([keep, merge, updatedAt]);
      return doc([kobo, series], "v2");
    },
    async () => null,
    () => false
  );
  assert.deepEqual(calls, [[bookKey(goodreads), [bookKey(kobo)], "v1"]]);
  assert.equal(result.updatedAt, "v2");
});

test("mergeCertainDuplicates returns the same document when nothing is certain", async () => {
  const start = doc([kobo, series]);
  assert.equal(await mergeCertainDuplicates(start, async () => { throw new Error("unexpected"); }, async () => null, () => false), start);
});

test("on a conflict it refetches and retries once; a second failure rejects", async () => {
  let attempts = 0;
  const conflict = new Error("409");
  const result = await mergeCertainDuplicates(
    doc([kobo, goodreads]),
    async () => {
      attempts++;
      if (attempts === 1) throw conflict;
      return doc([kobo], "v3");
    },
    async () => doc([kobo, goodreads], "v2"),
    (error) => error === conflict
  );
  assert.equal(result.updatedAt, "v3");
  await assert.rejects(
    mergeCertainDuplicates(doc([kobo, goodreads]), async () => { throw conflict; }, async () => doc([kobo, goodreads], "v2"), (error) => error === conflict)
  );
});

test("a non-conflict failure mid-run rejects instead of looping", async () => {
  const other = { ContentID: "x", Title: "Emma", Attribution: "Jane Austen" };
  const otherCopy = { ContentID: "y", Title: "Emma", Attribution: "Jane Austen", ISBN: "9780141439587" };
  let calls = 0;
  await assert.rejects(
    mergeCertainDuplicates(
      doc([kobo, goodreads, other, otherCopy]),
      async () => {
        calls++;
        if (calls === 2) throw new Error("offline");
        return doc([kobo, other, otherCopy], "v2");
      },
      async () => null,
      () => false
    ),
    /offline/
  );
  assert.equal(calls, 2);
});
