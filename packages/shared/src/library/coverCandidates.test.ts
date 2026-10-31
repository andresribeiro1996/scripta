import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coverCandidatesQuery,
  coverSourceLabel,
  errorMessage,
  FOUND_COVERS_PENDING,
  foundCoversView,
  isAcceptableCover,
  isCurrentCover,
  pickCoverBody,
  visibleCandidates,
  type CoverCandidateView,
  type FoundCoversLoad
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
  assert.equal(coverSourceLabel("kobo", "en"), "Kobo");
  assert.equal(coverSourceLabel("isbndb", "en"), "ISBNdb");
  assert.equal(coverSourceLabel("openlibrary", "en"), "Open Library");
  assert.equal(coverSourceLabel("apple", "en"), "Apple Books");
  assert.equal(coverSourceLabel("bnp", "en"), "National Library of Portugal");
  assert.equal(coverSourceLabel("publisher", "en"), "Publisher");
  assert.equal(coverSourceLabel("upload", "en"), "Admin upload");
  assert.equal(coverSourceLabel("mystery", "en"), "mystery");
  assert.equal(coverSourceLabel("bnp", "pt-PT"), "Biblioteca Nacional de Portugal");
});

function done(candidates: CoverCandidateView[], unavailable: string[] = []): FoundCoversLoad {
  return { state: "done", response: { candidates, unavailable } };
}

test("the found-covers view lists the quick tiles first, then Apple's, and drops what failed to load", () => {
  const kobo = found("kobo", "https://kobo/1.jpg");
  const dropped = found("openlibrary", "https://ol/1.jpg");
  const apple = found("apple", "https://apple/1.jpg");
  const view = foundCoversView(done([kobo, dropped]), done([apple]), new Map([[dropped.url, null]]));
  assert.deepEqual(
    view.tiles.map((tile) => tile.candidate.url),
    [kobo.url, apple.url]
  );
  assert.equal(view.checkingApple, false);
  assert.equal(view.empty, false);
});

test("the found-covers view is checking Apple while that load is pending, even with no tiles", () => {
  const view = foundCoversView(done([]), FOUND_COVERS_PENDING, new Map());
  assert.equal(view.checkingApple, true);
  assert.equal(view.empty, false);
});

test("the found-covers view is empty once both loads are done with nothing to show", () => {
  const view = foundCoversView(done([]), done([]), new Map());
  assert.deepEqual(view, { tiles: [], unavailable: [], failures: [], checkingApple: false, empty: true });
});

test("the found-covers view is empty when every found candidate was dropped", () => {
  const candidate = found("apple", "https://apple/1.jpg");
  const view = foundCoversView(done([]), done([candidate]), new Map([[candidate.url, { width: 1400, height: 1400 }]]));
  assert.equal(view.tiles.length, 0);
  assert.equal(view.empty, true);
});

test("the found-covers view lists each unavailable source once", () => {
  const view = foundCoversView(done([], ["kobo", "isbndb"]), done([], ["kobo", "apple"]), new Map());
  assert.deepEqual(view.unavailable, ["kobo", "isbndb", "apple"]);
  assert.equal(view.empty, false);
});

test("the found-covers view lists each failure message once and does not call a failed Apple load pending", () => {
  const failed: FoundCoversLoad = { state: "failed", message: "Network request failed" };
  const view = foundCoversView(failed, failed, new Map());
  assert.deepEqual(view.failures, ["Network request failed"]);
  assert.equal(view.checkingApple, false);
  assert.equal(view.empty, false);
  assert.deepEqual(foundCoversView(failed, { state: "failed", message: "Timed out" }, new Map()).failures, ["Network request failed", "Timed out"]);
});

test("the found-covers view keeps one load's tiles when the other failed", () => {
  const kobo = found("kobo", "https://kobo/1.jpg");
  const view = foundCoversView(done([kobo]), { state: "failed", message: "Timed out" }, new Map());
  assert.equal(view.tiles.length, 1);
  assert.deepEqual(view.failures, ["Timed out"]);
});

test("an error's message is its text, anything else is stringified", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("plain"), "plain");
  assert.equal(errorMessage(404), "404");
});
