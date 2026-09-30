import assert from "node:assert/strict";
import test from "node:test";
import { mergeSearchResults, searchInsideOutside, type BookSearchResult, type BookSearchState } from "./bookSearch.js";

function result(title: string, authors: string[], isbn: string | null): BookSearchResult {
  return { title, authors, year: null, isbn, publisher: null, coverUrl: null, genres: [] };
}

test("inside results come first and outside-only results are appended", () => {
  const messiah = result("Dune Messiah", ["Frank Herbert"], "9780593098233");
  const dune = result("Dune", ["Frank Herbert"], "9780441013593");
  assert.deepEqual(mergeSearchResults([messiah], [dune]), [messiah, dune]);
});

test("the same ISBN is a duplicate, however it is written", () => {
  const inside = result("Dune", ["Frank Herbert"], "9780441013593");
  const outside = result("Dune (50th anniversary)", ["Frank Herbert"], "978-0-441-01359-3");
  assert.deepEqual(mergeSearchResults([inside], [outside]), [inside]);
});

test("different ISBNs with the same title are different editions", () => {
  const inside = result("Dune", ["Frank Herbert"], "9780441013593");
  const outside = result("Dune", ["Frank Herbert"], "9780340960196");
  assert.equal(mergeSearchResults([inside], [outside]).length, 2);
});

test("without an ISBN on either side, title and first author decide", () => {
  const inside = result("Dune", ["Frank Herbert"], null);
  assert.deepEqual(mergeSearchResults([inside], [result("  dune ", ["FRANK HERBERT", "Someone"], "9780441013593")]), [inside]);
  assert.equal(mergeSearchResults([inside], [result("Dune", ["Brian Herbert"], null)]).length, 2);
  assert.equal(mergeSearchResults([result("Dune", [], null)], [result("Dune", [], null)]).length, 1);
});

test("an empty side returns the other unchanged", () => {
  const only = result("Dune", ["Frank Herbert"], null);
  assert.deepEqual(mergeSearchResults([], [only]), [only]);
  assert.deepEqual(mergeSearchResults([only], []), [only]);
});

async function run(query: string, inside: () => Promise<BookSearchResult[]>, outside: () => Promise<BookSearchResult[]>) {
  const states: BookSearchState[] = [];
  const calls: string[] = [];
  await searchInsideOutside(
    query,
    { inside: () => { calls.push("inside"); return inside(); }, outside: () => { calls.push("outside"); return outside(); } },
    (state) => states.push(state)
  );
  return { states, calls };
}

const messiah = result("Dune Messiah", ["Frank Herbert"], "9780593098233");
const dune = result("Dune", ["Frank Herbert"], "9780441013593");

test("inside results are reported first, then the merged list", async () => {
  const { states, calls } = await run("dune", async () => [messiah], async () => [messiah, dune]);
  assert.deepEqual(calls, ["inside", "outside"]);
  assert.deepEqual(states, [
    { results: [messiah], outsidePending: true, outsideFailed: false },
    { results: [messiah, dune], outsidePending: false, outsideFailed: false }
  ]);
});

test("an ISBN that inside answers never calls outside", async () => {
  const { states, calls } = await run("978-0-441-01359-3", async () => [dune], async () => [messiah]);
  assert.deepEqual(calls, ["inside"]);
  assert.deepEqual(states, [{ results: [dune], outsidePending: false, outsideFailed: false }]);
});

test("an ISBN that inside misses asks outside", async () => {
  const { states, calls } = await run("9780441013593", async () => [], async () => [dune]);
  assert.deepEqual(calls, ["inside", "outside"]);
  assert.deepEqual(states.at(-1), { results: [dune], outsidePending: false, outsideFailed: false });
});

test("outside failing behind inside results keeps them and flags it", async () => {
  const { states } = await run("dune", async () => [messiah], async () => { throw new Error("down"); });
  assert.deepEqual(states.at(-1), { results: [messiah], outsidePending: false, outsideFailed: true });
});

test("outside failing with nothing inside rejects with its error", async () => {
  await assert.rejects(run("dune", async () => [], async () => { throw new Error("down"); }), /down/);
});

test("inside failing rejects even when outside would succeed", async () => {
  await assert.rejects(run("dune", async () => { throw new Error("local"); }, async () => [dune]), /local/);
});
