import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coverCandidatesQuery,
  coverSourceLabel,
  isAcceptableCover,
  isCurrentCover,
  pickCoverBody,
  visibleCandidates,
  type CoverCandidateView
} from "./coverCandidates.js";

const params = { isbn: "9780441013593", imageId: "abc", title: "Dune" };

function stored(overrides: Partial<CoverCandidateView> = {}): CoverCandidateView {
  return {
    source: "kobo",
    url: "https://api.test/covers/cached/a/thumb",
    fullUrl: "https://api.test/covers/cached/a/file",
    coverImageId: "a",
    width: 600,
    height: 900,
    ...overrides
  };
}

function found(source: string, url: string): CoverCandidateView {
  return { source, url, fullUrl: url, coverImageId: null, width: null, height: null };
}

test("only portrait covers are acceptable", () => {
  assert.equal(isAcceptableCover("apple", 900, 1400), true);
  assert.equal(isAcceptableCover("apple", 500, 500), false);
  assert.equal(isAcceptableCover("isbndb", 1030, 773), false);
  assert.equal(isAcceptableCover("openlibrary", 100, 400), false);
});

test("ISBNdb's 200x248 placeholder is refused, the same size elsewhere is not", () => {
  assert.equal(isAcceptableCover("isbndb", 200, 248), false);
  assert.equal(isAcceptableCover("openlibrary", 200, 248), true);
});

test("the candidates query is the cover query key, plus from=apple only for apple, and never the Kobo image id", () => {
  assert.equal(coverCandidatesQuery(params, "quick"), "isbn=9780441013593&title=Dune");
  assert.equal(coverCandidatesQuery(params, "apple"), "isbn=9780441013593&title=Dune&from=apple");
});

test("a pick body carries the lookup and the choice, never the Kobo image id, and everyone only when true", () => {
  assert.deepEqual(pickCoverBody(params, { url: "https://x/1.jpg" }, false), {
    isbn: "9780441013593",
    title: "Dune",
    url: "https://x/1.jpg"
  });
  const everyone = pickCoverBody(params, { coverImageId: "id" }, true);
  assert.equal(everyone.coverImageId, "id");
  assert.equal(everyone.everyone, true);
  assert.equal("imageId" in everyone, false);
  assert.equal(pickCoverBody({ ...params, author: "Frank Herbert" }, { url: "https://x/1.jpg" }, false).author, "Frank Herbert");
});

test("a stored candidate always shows with its own size", () => {
  const candidate = stored();
  assert.deepEqual(visibleCandidates([candidate], new Map()), [{ candidate, width: 600, height: 900 }]);
  assert.deepEqual(visibleCandidates([candidate], new Map([[candidate.url, null]])), [{ candidate, width: 600, height: 900 }]);
});

test("a found candidate still loading shows with no size", () => {
  const candidate = found("openlibrary", "https://ol/1.jpg");
  assert.deepEqual(visibleCandidates([candidate], new Map()), [{ candidate, width: null, height: null }]);
});

test("a found candidate that failed to load is dropped", () => {
  const candidate = found("openlibrary", "https://ol/1.jpg");
  assert.deepEqual(visibleCandidates([candidate], new Map([[candidate.url, null]])), []);
  assert.deepEqual(visibleCandidates([candidate], new Map([[candidate.url, { width: 0, height: 0 }]])), []);
});

test("a found ISBNdb candidate measured at the placeholder size is dropped", () => {
  const candidate = found("isbndb", "https://isbndb/1.jpg");
  assert.deepEqual(visibleCandidates([candidate], new Map([[candidate.url, { width: 200, height: 248 }]])), []);
});

test("a found Apple candidate measured square is dropped", () => {
  const candidate = found("apple", "https://apple/1.jpg");
  assert.deepEqual(visibleCandidates([candidate], new Map([[candidate.url, { width: 1400, height: 1400 }]])), []);
});

test("visible candidates keep their order and take measured sizes", () => {
  const first = found("kobo", "https://kobo/1.jpg");
  const dropped = found("apple", "https://apple/1.jpg");
  const second = stored();
  const third = found("openlibrary", "https://ol/1.jpg");
  const measured = new Map([
    [first.url, { width: 800, height: 1200 }],
    [dropped.url, null]
  ]);
  assert.deepEqual(visibleCandidates([first, dropped, second, third], measured), [
    { candidate: first, width: 800, height: 1200 },
    { candidate: second, width: 600, height: 900 },
    { candidate: third, width: null, height: null }
  ]);
});

test("the current cover matches a candidate's full or thumbnail URL only", () => {
  const candidate = stored();
  assert.equal(isCurrentCover(candidate, candidate.fullUrl), true);
  assert.equal(isCurrentCover(candidate, candidate.url), true);
  assert.equal(isCurrentCover(candidate, undefined), false);
  assert.equal(isCurrentCover(candidate, ""), false);
  assert.equal(isCurrentCover(candidate, "https://other/1.jpg"), false);
});

test("source labels", () => {
  assert.equal(coverSourceLabel("kobo"), "Kobo");
  assert.equal(coverSourceLabel("isbndb"), "ISBNdb");
  assert.equal(coverSourceLabel("openlibrary"), "Open Library");
  assert.equal(coverSourceLabel("apple"), "Apple Books");
  assert.equal(coverSourceLabel("bnp"), "National Library of Portugal");
  assert.equal(coverSourceLabel("publisher"), "Publisher");
  assert.equal(coverSourceLabel("upload"), "Admin upload");
  assert.equal(coverSourceLabel("mystery"), "mystery");
});
