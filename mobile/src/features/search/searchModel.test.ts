import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookSearchResult } from "@scripta/shared";
import type { DiscoverItem, PersonResult } from "@scripta/shared/community";
import { idleSections, libraryStatus, mergeBookResults, ownedEntry, readRecentSearches, recentSearchesKey, recordRecentSearch, searchQueryFromParam, searchRows, type ResultsInput, type SearchRow } from "./searchModel.js";

const result = (title: string, workId?: string, isbn: string | null = null): BookSearchResult => ({ title, authors: ["Author"], year: 2001, isbn, publisher: null, coverUrl: null, genres: [], ...(workId ? { workId } : {}) });
const person = (userId: string) => ({ user: { userId, username: userId, avatarUrl: null }, followerCount: 0, private: false }) as unknown as PersonResult;
const game = (id: string) => ({ author: { username: "bob", avatarUrl: null }, content: { kind: "tierlist", id, name: id } }) as unknown as DiscoverItem;
const done = <T>(rows: T[]) => ({ rows, loading: false, failed: false });
const input = (overrides: Partial<ResultsInput> = {}): ResultsInput => ({
  scope: "all",
  query: "frank",
  submitted: false,
  library: done([]),
  books: done([]),
  people: done([]),
  games: done([]),
  openLibrary: "idle",
  ...overrides,
});
const kinds = (rows: SearchRow[]) => rows.map((row) => (row.kind === "header" || row.kind === "loading" || row.kind === "failed" ? `${row.kind}:${row.section}` : row.kind));
const header = (rows: SearchRow[], section: string) => rows.find((row) => row.kind === "header" && row.section === section);

test("below two characters only your own matches show, with no No results line", () => {
  assert.deepEqual(kinds(searchRows(input({ query: "f", library: done([{ Title: "Frankenstein" }]) }))), ["header:library", "library"]);
  assert.deepEqual(searchRows(input({ query: "f" })), []);
});

test("All shows each section's first three rows in order, with See all when there are more", () => {
  const rows = searchRows(input({
    library: done([{ Title: "Frankenstein" }]),
    books: done([result("1", "w1"), result("2", "w2"), result("3", "w3"), result("4", "w4")]),
    people: done([person("p1")]),
    games: done([game("g1")]),
  }));
  assert.deepEqual(kinds(rows), ["header:library", "library", "header:books", "book", "book", "book", "addByHand", "header:people", "person", "header:games", "game"]);
  assert.deepEqual(header(rows, "books"), { kind: "header", key: "header:books", section: "books", seeAll: true });
  assert.deepEqual(header(rows, "people"), { kind: "header", key: "header:people", section: "people", seeAll: false });
});

test("a kind's chip shows only that kind, every row", () => {
  const people = ["p0", "p1", "p2", "p3", "p4"].map(person);
  assert.deepEqual(kinds(searchRows(input({ scope: "people", people: done(people), books: done([result("1", "w1")]) }))), ["header:people", "person", "person", "person", "person", "person"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "books", library: done([{ Title: "Frankenstein" }]), books: done([result("1", "w1")]), people: done(people) }))), ["header:library", "library", "header:books", "book", "addByHand"]);
});

test("Books offers Open Library until the query is submitted, then follows it", () => {
  assert.deepEqual(kinds(searchRows(input({ scope: "books" }))), ["header:books", "catalogEmpty", "addByHand"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "books", openLibrary: "pending" }))), ["header:books", "catalogEmpty", "addByHand"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "books", submitted: true, openLibrary: "pending" }))), ["header:books", "openLibrary", "addByHand"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "books", submitted: true, books: done([result("1", "w1")]), openLibrary: "failed" }))), ["header:books", "book", "openLibrary", "addByHand"]);
});

test("No results shows once every section is done and empty, with Add it by hand where books are searched", () => {
  assert.deepEqual(kinds(searchRows(input({ submitted: true }))), ["noResults", "addByHand"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "people" }))), ["noResults"]);
});

test("a failed catalog hides its rows so Retry shows even when Open Library answered", () => {
  assert.deepEqual(kinds(searchRows(input({ scope: "books", submitted: true, books: { rows: [result("1")], loading: false, failed: true }, openLibrary: "idle" }))), ["header:books", "failed:books"]);
});

test("a loading or failed section keeps its heading", () => {
  assert.deepEqual(kinds(searchRows(input({ scope: "people", people: { rows: [], loading: true, failed: false } }))), ["header:people", "loading:people"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "games", games: { rows: [], loading: false, failed: true } }))), ["header:games", "failed:games"]);
});

test("before typing, readers and new games follow the chip", () => {
  assert.deepEqual(idleSections("all"), { readers: true, newGames: true });
  assert.deepEqual(idleSections("books"), { readers: false, newGames: false });
  assert.deepEqual(idleSections("people"), { readers: true, newGames: false });
  assert.deepEqual(idleSections("games"), { readers: false, newGames: true });
});

test("a library row's chip reads its shelf", () => {
  assert.deepEqual(libraryStatus({ ReadStatus: 1 }), { label: "Reading", tone: "accent" });
  assert.deepEqual(libraryStatus({ ReadStatus: 2 }), { label: "Finished", tone: "success" });
  assert.deepEqual(libraryStatus({}), { label: "To read", tone: "neutral" });
});

test("Open Library results merge into Books by work, and works you own are left out", () => {
  const owned = [{ Title: "Mine", ISBN: "0441013597" }];
  const catalog = [result("Dune", "w-dune"), result("Owned", "w-owned")];
  const outside = [result("Dune again", "w-dune"), result("New", "w-new"), result("Owned by ISBN", undefined, "9780441013593"), result("Loose", undefined, "9781234567897")];
  assert.deepEqual(mergeBookResults(catalog, outside, owned, new Set(["w-owned"])).map((book) => book.title), ["Dune", "New", "Loose"]);
});

test("a work you own keeps its catalog row when the library section doesn't list it", () => {
  const owned = [{ Title: "Mine", ISBN: "0441013597" }];
  const catalog = [result("Owned", "w-owned"), result("Other", "w-other")];
  assert.deepEqual(mergeBookResults(catalog, [], owned, new Set()).map((book) => book.title), ["Owned", "Other"]);
  assert.deepEqual(mergeBookResults(catalog, [], owned, new Set(["w-owned"])).map((book) => book.title), ["Other"]);
});

test("a catalog result with a work id is hidden when a library book matches by ISBN but has no work mapping", () => {
  const owned = [{ Title: "Dune", Attribution: "Author", ISBN: "9780441013593" }];
  const catalog = [result("Dune", "w-dune", "9780441013593"), result("Other", "w-other")];
  assert.deepEqual(mergeBookResults(catalog, [], owned, new Set()).map((book) => book.title), ["Other"]);
});

test("a search param reads as its trimmed text, or its first item, or nothing", () => {
  assert.equal(searchQueryFromParam("  Malazan Book of the Fallen "), "Malazan Book of the Fallen");
  assert.equal(searchQueryFromParam(["Dune", "Other"]), "Dune");
  assert.equal(searchQueryFromParam(["  ", "Other"]), null);
  assert.equal(searchQueryFromParam([]), null);
  assert.equal(searchQueryFromParam("   "), null);
  assert.equal(searchQueryFromParam(""), null);
  assert.equal(searchQueryFromParam(undefined), null);
});

test("recent searches keep the newest eight, once each, ignoring case and surrounding spaces", () => {
  let list: string[] = [];
  for (const query of ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]) list = recordRecentSearch(list, query);
  assert.deepEqual(list, ["nine", "eight", "seven", "six", "five", "four", "three", "two"]);
  assert.deepEqual(recordRecentSearch(list, "  SEVEN "), ["SEVEN", "nine", "eight", "six", "five", "four", "three", "two"]);
  assert.deepEqual(recordRecentSearch(list, "   "), list);
  assert.equal(recentSearchesKey("u1"), "search.recent.u1");
});

test("stored recent searches are read back safely", () => {
  assert.deepEqual(readRecentSearches(null), []);
  assert.deepEqual(readRecentSearches("not json"), []);
  assert.deepEqual(readRecentSearches('["dune", 3, "frank"]'), ["dune", "frank"]);
  assert.deepEqual(readRecentSearches('{"a":1}'), []);
});

test("ownedEntry finds a library book by ISBN, in either ISBN form", () => {
  const mine = { Title: "Mine", ISBN: "0441013597", ReadStatus: 1 };
  assert.equal(ownedEntry({ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" }, [{ Title: "Other", ISBN: "9781234567897" }, mine]), mine);
});

test("ownedEntry matches a hand-added book with no ISBN by title and author", () => {
  const mine = { Title: "The Hobbit", Attribution: "J.R.R. Tolkien", ReadStatus: 2 };
  assert.equal(ownedEntry({ Title: "The hobbit", Attribution: "J.R.R. Tolkien", ISBN: "9780261102217" }, [mine]), mine);
});

test("ownedEntry returns nothing for another edition the server's rule rejects", () => {
  const mine = { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" };
  assert.equal(ownedEntry({ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780593099322" }, [mine]), undefined);
});
