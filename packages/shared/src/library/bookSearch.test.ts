import assert from "node:assert/strict";
import test from "node:test";
import { buildManualBook, mapOpenLibraryDoc, mergeSearchResults, searchInsideOutside, searchResultByline, seriesLabel, type BookSearchResult, type BookSearchState } from "./bookSearch.js";

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

const manualFields = { title: "Dune", author: "Frank Herbert", isbn: "", publisher: null, readStatus: 0, dateRead: null, rating: null };

test("a book added with search genres marks them as from the catalog", () => {
  const book = buildManualBook({ ...manualFields, genres: ["Science Fiction"] }, "1");
  assert.deepEqual(book._genres, ["Science Fiction"]);
  assert.equal(book._genresFrom, "catalog");
});

test("a book added without genres carries neither genres nor the marker", () => {
  const book = buildManualBook(manualFields, "1");
  assert.equal("_genres" in book, false);
  assert.equal("_genresFrom" in book, false);
});

test("mapOpenLibraryDoc repairs mojibake in the title and authors", () => {
  const result = mapOpenLibraryDoc({ title: "Entre a fÃ© e a crenÃ§a", author_name: ["JosÃ© Silva"], isbn: ["9780000000002"] });
  assert.equal(result?.title, "Entre a fé e a crença");
  assert.deepEqual(result?.authors, ["José Silva"]);
});

test("mapOpenLibraryDoc repairs a title ending in a mis-decoded à", () => {
  assert.equal(mapOpenLibraryDoc({ title: "VoilÃ\xa0" })?.title, "Voilà");
});

test("mapOpenLibraryDoc drops non-sorting markers from the title and authors", () => {
  const result = mapOpenLibraryDoc({ title: "\u0098O \u009cNatal de Teste", author_name: ["Ana Co\u0098sta"] });
  assert.equal(result?.title, "O Natal de Teste");
  assert.deepEqual(result?.authors, ["Ana Costa"]);
});

test("mapOpenLibraryDoc drops non-sorting markers before repairing mojibake", () => {
  assert.equal(mapOpenLibraryDoc({ title: "\u0098A \u009cfÃ© e a crenÃ§a" })?.title, "A fé e a crença");
});

test("a search result byline reads author · year · publisher and skips what is missing", () => {
  const base = { authors: ["Isabel Allende"], publisher: "Porto Editora", year: 2013 };
  assert.equal(searchResultByline(base), "Isabel Allende · 2013 · Porto Editora");
  assert.equal(searchResultByline({ ...base, publisher: null }), "Isabel Allende · 2013");
  assert.equal(searchResultByline({ authors: [], publisher: "Porto Editora", year: null }), "Porto Editora");
});

test("a story series reads its name and position, or the name alone", () => {
  assert.equal(seriesLabel({ name: "Malazan Book of the Fallen", kind: "series", position: "1" }), "Malazan Book of the Fallen · 1");
  assert.equal(seriesLabel({ name: "Malazan Book of the Fallen", kind: "series", position: null }), "Malazan Book of the Fallen");
});

test("a collection reads its name, the word collection and its number, or no number", () => {
  assert.equal(seriesLabel({ name: "Bang!", kind: "collection", position: "248" }), "Bang! collection · 248");
  assert.equal(seriesLabel({ name: "Bang!", kind: "collection", position: null }), "Bang! collection");
});

test("a collection whose name already says collection is not given the word again", () => {
  assert.equal(seriesLabel({ name: "Penguin Collection", kind: "collection", position: null }), "Penguin Collection");
  assert.equal(seriesLabel({ name: "PENGUIN COLLECTIONS", kind: "collection", position: "3" }), "PENGUIN COLLECTIONS · 3");
  assert.equal(seriesLabel({ name: "Coleção Clássicos", kind: "collection", position: "12" }), "Coleção Clássicos · 12");
  assert.equal(seriesLabel({ name: "COLEÇÃO Bang", kind: "collection", position: null }), "COLEÇÃO Bang");
  assert.equal(seriesLabel({ name: "Colecção Mil Folhas", kind: "collection", position: null }), "Colecção Mil Folhas");
  assert.equal(seriesLabel({ name: "Colecao Mil Folhas", kind: "collection", position: null }), "Colecao Mil Folhas");
});

test("a story series never gets the word collection", () => {
  assert.equal(seriesLabel({ name: "Dune Chronicles", kind: "series", position: "2" }), "Dune Chronicles · 2");
});

test("buildManualBook stores format and a positive page count", () => {
  const book = buildManualBook({ ...manualFields, format: "audiobook", pages: 310 }, "1");
  assert.equal(book._format, "audiobook");
  assert.equal(book._pages, 310);
});

test("buildManualBook omits format and pages when not given", () => {
  for (const extra of [{}, { pages: null }, { pages: 0 }]) {
    const book = buildManualBook({ ...manualFields, ...extra }, "1");
    assert.equal("_format" in book, false);
    assert.equal("_pages" in book, false);
  }
});

test("buildManualBook leaves hand-edited genres untagged", () => {
  const edited = buildManualBook({ ...manualFields, genres: ["Fantasy"], genresEdited: true }, "1");
  assert.deepEqual(edited._genres, ["Fantasy"]);
  assert.equal("_genresFrom" in edited, false);
  const searched = buildManualBook({ ...manualFields, genres: ["Fantasy"] }, "1");
  assert.equal(searched._genresFrom, "catalog");
});

test("mapOpenLibraryDoc reads the median page count", () => {
  assert.equal(mapOpenLibraryDoc({ title: "Dune", number_of_pages_median: 412 })?.pages, 412);
  assert.equal(mapOpenLibraryDoc({ title: "Dune" })?.pages, null);
  assert.equal(mapOpenLibraryDoc({ title: "Dune", number_of_pages_median: 0 })?.pages, null);
});
