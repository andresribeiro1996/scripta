import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bookKey } from "./merge.js";
import type { Group } from "./groups.js";
import { publicReaderCard, readerIdentity } from "./readerIdentity.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/fixtures/library.json");

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
  assert.equal(result.missing, "Genres known for 4 of 10 books");
  assert.deepEqual(result.coverage, ["genres known for 4 of 10 finished books"]);
});

test("40% fantasy or science fiction settles the Stargazer", () => {
  const others = ["Romance", "Philosophy", "Science", "Travel", "Cooking", "Psychology"];
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
  assert.equal(result.signal?.label, "4 of 10 finished books are by authors you keep returning to");
  assert.deepEqual(result.leaders, [{ label: "Kazuo Ishiguro", count: 4 }]);
  assert.equal(readerIdentity(shelf(5), []).state, "unwritten");
});

test("two signals clear with the winner more than 5% ahead: settled, no runner-up", () => {
  const books = shelf(10, (i) => (i < 5 ? { Attribution: "Author A" } : {}));
  const result = readerIdentity(books, [series(books.slice(5, 8))]);
  assert.equal(result.state, "settled");
  assert.equal(result.identity, "loyal");
  assert.equal(result.runnerUp, null);
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
  assert.deepEqual(Object.keys(card).sort(), ["coverage", "identity", "runnerUp", "signal", "state", "streak"]);
  const text = JSON.stringify(card);
  for (const leak of ["Ishiguro", "Klara", "Secret Series", "Book 5"]) assert.ok(!text.includes(leak), leak);
});

test("Wayfarer's largest share names its source: a grouped signal when that's largest", () => {
  const groupGenres = ["Romance", "Historical Fiction", "Philosophy", "Psychology", "Science", "Technology", "Business"];
  const books = shelf(20, (i) => {
    if (i < 3) return { _genres: ["Fantasy"] };
    if (i < 6) return { _genres: ["Science Fiction"] };
    return { _genres: [groupGenres[Math.floor((i - 6) / 2)]!] };
  });
  const result = readerIdentity(books, []);
  assert.equal(result.identity, "way");
  assert.equal(result.state, "leaning");
  assert.equal(result.signal?.label, "9 genres above 5% of books with known genres; the largest, fantasy or science fiction, is 30%");
});

test("gap percentages round down so a near-miss doesn't read as settled", () => {
  const books = shelf(27);
  const result = readerIdentity(books, [series(books.slice(0, 8))]);
  assert.equal(result.state, "leaning");
  assert.equal(result.missing, "29% of finished books are in a series; 30% settles it");
});

test("each genre signal settles exactly at threshold and not one book below", () => {
  const cases = [
    { key: "lamp", genre: "Mystery", threshold: 0.35 },
    { key: "star", genre: "Fantasy", threshold: 0.4 },
    { key: "arch", genre: "History", threshold: 0.35 },
    { key: "corr", genre: "Classics", threshold: 0.4 },
  ];
  const m = 20;
  for (const { key, genre, threshold } of cases) {
    const atThreshold = Math.round(threshold * m);
    const atBooks = shelf(m, (i) => ({ _genres: [i < atThreshold ? genre : "Romance"] }));
    const atResult = readerIdentity(atBooks, []);
    assert.equal(atResult.identity, key, `${key} at threshold identity`);
    assert.equal(atResult.state, "settled", `${key} at threshold state`);

    const belowBooks = shelf(m, (i) => ({ _genres: [i < atThreshold - 1 ? genre : "Romance"] }));
    const belowResult = readerIdentity(belowBooks, []);
    assert.notEqual(belowResult.state, "settled", `${key} one book below`);
  }
});

test("Wayfarer needs six genres above 5%, with none of them over 25%", () => {
  const fiveGenres = ["Romance", "Philosophy", "Psychology", "Science", "Technology"];
  const onlyFive = shelf(21, (i) => ({ _genres: [i < 20 ? fiveGenres[Math.floor(i / 4)]! : "Religion"] }));
  assert.notEqual(readerIdentity(onlyFive, []).state, "settled");

  const sixButSkewed = ["Philosophy", "Psychology", "Science", "Technology", "Business"];
  const skewed = shelf(20, (i) => ({ _genres: [i < 10 ? "Romance" : sixButSkewed[(i - 10) % 5]!] }));
  assert.notEqual(readerIdentity(skewed, []).state, "settled");
});

test("the Loyalist needs 40% share, not just three books", () => {
  const books = shelf(10, (i) => (i < 3 ? { Attribution: "Author A" } : {}));
  const result = readerIdentity(books, []);
  assert.ok(!(result.state === "settled" && result.identity === "loyal"));
});

test("the Loyalist needs the repeat authors to cover at least three books", () => {
  const books = shelf(5, (i) => (i < 2 ? { Attribution: "Author A" } : {}));
  const result = readerIdentity(books, []);
  assert.ok(!(result.state === "settled" && result.identity === "loyal"));
});

test("the Annotator needs 30% of finished books marked, not just enough marks", () => {
  const books = shelf(10, (i) => (i < 2 ? { highlights: mark(15) } : {}));
  const result = readerIdentity(books, []);
  assert.ok(!(result.state === "settled" && result.identity === "anno"));
});

test("Annotator marks count Kobo notes with Text or Annotation, but not dogears", () => {
  const notes = (n: number) => Array.from({ length: n }, (_, j) => ({ Type: "note", Text: `passage ${j}`, Annotation: `note ${j}`, BookmarkID: `n${j}` }));
  const books = shelf(10, (i) => {
    if (i < 3) return { highlights: notes(7) };
    if (i === 3) return { highlights: [{ Type: "dogear", BookmarkID: "d1" }] };
    return {};
  });
  const result = readerIdentity(books, []);
  assert.equal(result.identity, "anno");
  assert.equal(result.state, "settled");
  assert.equal(result.signal?.counted, 3);
});

test("duplicate finished books (same key) count once", () => {
  const base = shelf(10);
  const dup = [...base, { ...base[0]! }];
  assert.deepEqual(readerIdentity(dup, []), readerIdentity(base, []));
});

test("author names normalize before counting; the first spelling seen is displayed", () => {
  const books = shelf(10, (i) => (i < 4 ? { Attribution: i === 2 ? "terry  pratchett" : "Terry Pratchett" } : {}));
  const result = readerIdentity(books, []);
  assert.equal(result.identity, "loyal");
  assert.deepEqual(result.leaders[0], { label: "Terry Pratchett", count: 4 });
});

test("the sample library fixture leans Cartographer with 3 of 11 finished books in a series", () => {
  const data = JSON.parse(readFileSync(fixturePath, "utf8")) as { books: Book[]; groups: Group[] };
  const result = readerIdentity(data.books, data.groups);
  assert.equal(result.identity, "carto");
  assert.equal(result.state, "leaning");
  assert.deepEqual(result.signal, { counted: 3, of: 11, label: "3 of 11 finished books are in a series" });
});

test("a settled card names the second-strongest reading as its streak", () => {
  const books = shelf(10, (i) => (i < 3 ? { highlights: mark(7) } : {}));
  const result = readerIdentity(books, [series(books.slice(3, 7))]);
  assert.equal(result.state, "settled");
  assert.equal(result.identity, "carto");
  assert.equal(result.runnerUp, null);
  assert.equal(result.streak, "anno");
});

test("a settled card with no second reading near the threshold has no streak", () => {
  const books = shelf(10);
  const result = readerIdentity(books, [series(books.slice(0, 4))]);
  assert.equal(result.state, "settled");
  assert.equal(result.streak, null);
});

test("a tied leaning card's streak is its runner-up", () => {
  const books = shelf(10, (i) => (i < 3 ? { highlights: mark(7) } : {}));
  const result = readerIdentity(books, [series(books.slice(3, 6))]);
  assert.equal(result.state, "leaning");
  assert.equal(result.runnerUp, "anno");
  assert.equal(result.streak, "anno");
});

test("an unwritten card has no streak, and the public card carries the streak", () => {
  assert.equal(readerIdentity(shelf(3), []).streak, null);
  const books = shelf(10, (i) => (i < 3 ? { highlights: mark(7) } : {}));
  assert.equal(publicReaderCard(readerIdentity(books, [series(books.slice(3, 7))])).streak, "anno");
});
