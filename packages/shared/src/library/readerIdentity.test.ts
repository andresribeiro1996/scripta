import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "./merge.js";
import type { Group } from "./groups.js";
import { publicReaderCard, readerIdentity } from "./readerIdentity.js";

type Book = Record<string, unknown>;
const book = (i: number, fields: Book = {}): Book => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, ...fields });
const shelf = (count: number, fields: (i: number) => Book = () => ({})) => Array.from({ length: count }, (_, i) => book(i, fields(i)));
const series = (books: Book[], name = "Discworld"): Group => ({ id: "g1", type: "series", name, bookKeys: books.map(bookKey), createdAt: "", updatedAt: "" });
const mark = (n: number) => Array.from({ length: n }, (_, j) => ({ Type: "highlight", Text: `line ${j}`, BookmarkID: `h${j}` }));

test("fewer than five finished books is unwritten and says how many more", () => {
  const result = readerIdentity(shelf(3), []);
  assert.equal(result.state, "unwritten");
  assert.equal(result.identity, null);
  assert.equal(result.missing, "Finish 2 more books");
  assert.equal(readerIdentity(shelf(4), []).missing, "Finish 1 more book");
});

test("unfinished books don't count", () => {
  const books = [...shelf(4), book(9, { ReadStatus: 1 }), book(10, { ReadStatus: 0 })];
  assert.equal(readerIdentity(books, []).missing, "Finish 1 more book");
});

test("30% in a series with at least 3 books settles the Cartographer", () => {
  const books = shelf(10);
  const result = readerIdentity(books, [series(books.slice(0, 3))]);
  assert.equal(result.state, "settled");
  assert.equal(result.identity, "carto");
  assert.deepEqual(result.signal, { counted: 3, of: 10, label: "3 of 10 finished books are in a series" });
  assert.deepEqual(result.leaders, [{ label: "Discworld", count: 3 }]);
});

test("27% in a series leans Cartographer", () => {
  const books = shelf(11);
  const result = readerIdentity(books, [series(books.slice(0, 3))]);
  assert.equal(result.state, "leaning");
  assert.equal(result.identity, "carto");
  assert.equal(result.runnerUp, null);
  assert.ok(result.missing);
});

test("the Cartographer needs at least three series books", () => {
  const books = shelf(5, () => ({ _genres: ["Romance"] }));
  const result = readerIdentity(books, [series(books.slice(0, 2))]);
  assert.equal(result.state, "unwritten");
  assert.equal(result.missing, "No reading pattern stands out yet");
});

test("the Annotator needs 30% marked and at least 20 marks", () => {
  const settled = shelf(10, (i) => (i < 3 ? { highlights: mark(i === 0 ? 10 : 5) } : {}));
  assert.equal(readerIdentity(settled, []).identity, "anno");
  assert.equal(readerIdentity(settled, []).state, "settled");
  const short = shelf(10, (i) => (i < 3 ? { highlights: mark(i === 0 ? 9 : 5) } : {}));
  assert.equal(readerIdentity(short, []).state, "leaning");
  const reviews = shelf(10, (i) => (i < 3 ? { highlights: [{ Type: "review", Text: "Loved it", BookmarkID: "r" }, ...mark(7)] } : {}));
  assert.equal(readerIdentity(reviews, []).identity, "anno");
});

test("genre signals wait until genres are known for half the finished books", () => {
  const books = shelf(10, (i) => (i < 4 ? { _genres: ["Fantasy"] } : {}));
  const result = readerIdentity(books, []);
  assert.equal(result.state, "unwritten");
  assert.equal(result.missing, "Genres are known for 4 of 10 finished books");
  assert.deepEqual(result.coverage, ["genres known for 4 of 10 finished books"]);
});

test("40% fantasy or science fiction settles the Stargazer", () => {
  const others = ["Romance", "Romance", "Philosophy", "Philosophy", "Science", "Science"];
  const books = shelf(10, (i) => ({ _genres: [i < 4 ? (i % 2 ? "Fantasy" : "Science Fiction") : others[i - 4]!] }));
  const result = readerIdentity(books, []);
  assert.equal(result.identity, "star");
  assert.equal(result.state, "settled");
  assert.equal(result.signal?.label, "4 of 10 finished books with known genres are fantasy or science fiction");
});

test("six genres above 5% with none over 25% settles the Wayfarer", () => {
  const genres = ["Romance", "Philosophy", "Science", "Travel", "Cooking", "Psychology"];
  const books = shelf(12, (i) => ({ _genres: [genres[i % 6]!] }));
  const result = readerIdentity(books, []);
  assert.equal(result.identity, "way");
  assert.equal(result.state, "settled");
});

test("the Loyalist counts only authors with at least two finished books", () => {
  const loyal = shelf(10, (i) => (i < 4 ? { Attribution: "Kazuo Ishiguro" } : {}));
  const result = readerIdentity(loyal, []);
  assert.equal(result.identity, "loyal");
  assert.equal(result.state, "settled");
  assert.equal(result.signal?.label, "4 of 10 finished books are by your three most-read authors");
  assert.deepEqual(result.leaders, [{ label: "Kazuo Ishiguro", count: 4 }]);
  assert.equal(readerIdentity(shelf(5), []).state, "unwritten");
});

test("two signals clearing within 5% lean, naming both", () => {
  const books = shelf(10, (i) => (i < 3 ? { highlights: mark(7) } : {}));
  const result = readerIdentity(books, [series(books.slice(0, 3))]);
  assert.equal(result.state, "leaning");
  assert.deepEqual([result.identity, result.runnerUp].sort(), ["anno", "carto"]);
});

test("Goodreads and StoryGraph imports add a series coverage line", () => {
  const books = shelf(6, (i) => ({ ContentID: i < 2 ? `goodreads:${i}` : `kobo-${i}` }));
  assert.deepEqual(readerIdentity(books, []).coverage, ["genres known for 0 of 6 finished books", "series unknown for Goodreads and StoryGraph imports"]);
});

test("the public card carries no titles, authors, series or missing line", () => {
  const books = shelf(10, (i) => (i < 4 ? { Attribution: "Kazuo Ishiguro", Title: `Klara ${i}` } : {}));
  const card = publicReaderCard(readerIdentity(books, [series(books.slice(0, 2), "Secret Series")]));
  assert.deepEqual(Object.keys(card).sort(), ["coverage", "identity", "runnerUp", "signal", "state"]);
  const text = JSON.stringify(card);
  for (const leak of ["Ishiguro", "Klara", "Secret Series", "Book 5"]) assert.ok(!text.includes(leak), leak);
});
