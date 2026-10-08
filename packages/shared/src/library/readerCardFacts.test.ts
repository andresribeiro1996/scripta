import assert from "node:assert/strict";
import { test } from "node:test";
import type { Group } from "./groups.js";
import { DEFAULT_READER_CARD_STYLE, publicStyle } from "../readerCards/style.js";
import { bookKey } from "./merge.js";
import { publicReaderCardOf, readerCardFacts, readerCardInputOf, visitorView } from "./readerCardFacts.js";
import type { PublicReaderCard } from "./readerIdentity.js";

type Book = Record<string, unknown>;
const book = (i: number, fields: Book = {}): Book => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, ...fields });
const mark = (n: number, type = "highlight") => Array.from({ length: n }, (_, j) => ({ Type: type, Text: `line ${j}`, BookmarkID: `h${j}` }));
const series = (books: Book[], id = "s"): Group => ({ id, type: "series", name: "S", bookKeys: books.map(bookKey), createdAt: "", updatedAt: "" });
const NOW = new Date(2026, 9, 7);

test("each finished book counts in one segment, the identity's group first", () => {
  const books = [book(1, { _genres: ["Fantasy", "Mystery"] }), book(2, { _genres: ["Mystery"] }), book(3, { _genres: ["Romance"] }), book(4)];
  assert.deepEqual(readerCardFacts(books, [], "star", NOW).dial.segments, [
    { group: "star", books: 1, marked: 0 },
    { group: "lamp", books: 1, marked: 0 },
    { group: "other", books: 1, marked: 0 },
    { group: "unknown", books: 1, marked: 0 },
  ]);
  assert.deepEqual(readerCardFacts(books, [], null, NOW).dial.segments.map((s) => [s.group, s.books]), [["lamp", 2], ["other", 1], ["unknown", 1]]);
});

test("marked counts finished books with a real Kobo highlight, and highlights counts the passages", () => {
  const books = [
    book(1, { highlights: mark(3) }),
    book(2, { highlights: mark(2, "note") }),
    book(3, { highlights: mark(1), ReadStatus: 1 }),
    book(4, { highlights: [{ Type: "highlight", Text: "  ", BookmarkID: "x" }] }),
  ];
  const { dial, facts } = readerCardFacts(books, [], null, NOW);
  assert.equal(facts.finished, 3);
  assert.equal(facts.highlights, 3);
  assert.deepEqual(dial.segments, [{ group: "unknown", books: 3, marked: 1 }]);
});

test("a duplicated book counts once", () => {
  assert.equal(readerCardFacts([book(1), book(1), book(2)], [], null, NOW).facts.finished, 2);
});

test("series counts series groups holding a finished book", () => {
  const finished = [book(1), book(2)];
  const unread = book(3, { ReadStatus: 0 });
  const collection: Group = { ...series([finished[0]!], "c"), type: "collection" };
  assert.equal(readerCardFacts([...finished, unread], [series(finished, "a"), series([unread], "b"), collection], null, NOW).facts.series, 1);
});

test("since is the earliest year a finished book was last read, and edition is this year", () => {
  const books = [book(1, { DateLastRead: "2019-05-02" }), book(2, { DateLastRead: "2016-03-01T10:00:00Z" }), book(3, { DateLastRead: "garbage" }), book(4, { DateLastRead: "2001-01-01", ReadStatus: 1 })];
  const { facts } = readerCardFacts(books, [], null, NOW);
  assert.equal(facts.since, 2016);
  assert.equal(facts.edition, 2026);
  assert.equal(readerCardFacts([book(1)], [], null, NOW).facts.since, null);
});

test("no finished books gives an empty dial", () => {
  assert.deepEqual(readerCardFacts([book(1, { ReadStatus: 0 })], [], null, NOW), {
    dial: { segments: [] },
    facts: { finished: 0, highlights: 0, series: 0, since: null, edition: 2026 },
  });
});

test("the public card carries the identity fields and the facts, never the leaders", () => {
  const books = Array.from({ length: 6 }, (_, i) => book(i, { _genres: ["Fantasy"] }));
  const card = publicReaderCardOf(books, [], NOW);
  assert.equal(card.identity, "star");
  assert.equal(card.facts?.finished, 6);
  assert.deepEqual(card.dial?.segments, [{ group: "star", books: 6, marked: 0 }]);
  assert.equal("leaders" in card, false);
  assert.equal("missing" in card, false);
});

test("the owner's input carries leaders and facts beside a public card; a visitor's carries neither leaders nor missing", () => {
  const books = Array.from({ length: 6 }, (_, i) => book(i, { _genres: ["Fantasy"] }));
  const owner = readerCardInputOf(books, [], "andre");
  assert.equal(owner.view, "owner");
  assert.equal(owner.card.identity, "star");
  assert.equal(owner.card.facts?.finished, 6);
  assert.ok(Array.isArray(owner.leaders));
  assert.equal("leaders" in owner.card, false);
  assert.equal("missing" in owner.card, false);
  assert.deepEqual(owner.style, { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout: "faces", trait: "both" });
  const visitor = readerCardInputOf([], [], "andre", { ...owner.card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "ring", layout: "book", trait: "seal" } });
  assert.equal(visitor.view, "visitor");
  assert.equal(visitor.leaders, undefined);
  assert.equal(visitor.missing, undefined);
  assert.deepEqual(visitor.style, { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "ring", layout: "book", trait: "seal" });
  assert.equal(visitor.seed, owner.seed);
});

test("the owner's own card for a library with few finished books is unwritten and says what is missing", () => {
  const owner = readerCardInputOf([book(1), book(2)], [], "andre");
  assert.equal(owner.card.state, "unwritten");
  assert.ok(owner.missing);
});

test("an older or newer server style still draws: missing fields and unknown options fall back", () => {
  const card: PublicReaderCard = { state: "settled", identity: "star", runnerUp: null, signal: null, coverage: [] };
  assert.deepEqual(readerCardInputOf([], [], "x", card).style, { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout: "faces", trait: "both" });
  assert.equal(readerCardInputOf([], [], "x", { ...card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout: "scroll" as never, trait: "both" } }).style.layout, "faces");
});

test("the owner's input draws their saved style and resolves their choices from the local library", () => {
  const books = Array.from({ length: 6 }, (_, i) => book(i, { _genres: ["Fantasy"], highlights: mark(2) }));
  const style = { counter: "ring", layout: "book", trait: "seal", motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto", signature: { bookKey: bookKey(books[0]!), note: "lent twice" }, highlight: { bookKey: bookKey(books[1]!), highlightId: "h1" } } as const;
  const covers: string[] = [];
  const input = readerCardInputOf(books, [], "andre", undefined, { style, coverOf: (item) => { covers.push(String(item.Title)); return "https://covers.example.org/0.jpg"; } });
  assert.deepEqual(input.style, { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "ring", layout: "book", trait: "seal" });
  assert.deepEqual(input.card.chosen, {
    signature: { title: "Book 0", author: "Author 0", workId: null, coverUrl: "https://covers.example.org/0.jpg", note: "lent twice" },
    highlight: { text: "line 1", title: "Book 1", author: "Author 1" },
  });
  assert.deepEqual(covers, ["Book 0"]);
  assert.equal(input.view, "owner");
});

test("a choice whose book or highlight is gone is left out, and no style means the default with nothing chosen", () => {
  const books = [book(1, { highlights: [{ Type: "note", Text: "mine", BookmarkID: "n1" }] })];
  const style = { counter: "dial", layout: "faces", trait: "both", motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto", signature: { bookKey: "isbn:gone", note: null }, highlight: { bookKey: bookKey(books[0]!), highlightId: "n1" } } as const;
  assert.deepEqual(readerCardInputOf(books, [], "andre", undefined, { style, coverOf: () => null }).card.chosen, {});
  const plain = readerCardInputOf(books, [], "andre");
  assert.equal("chosen" in plain.card, false);
  assert.deepEqual(plain.style, { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout: "faces", trait: "both" });
});

test("the visitors' preview of the owner's card drops the leaders, the missing line and the owner's plate line", () => {
  const books = Array.from({ length: 2 }, (_, i) => book(i, { _genres: ["Fantasy"] }));
  const owner = readerCardInputOf(books, [], "andre", undefined, { style: { counter: "beads", layout: "merged", trait: "line", motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto", signature: null, highlight: null }, coverOf: () => null });
  const visitor = visitorView(owner);
  assert.ok(owner.missing);
  assert.equal(visitor.view, "visitor");
  assert.equal(visitor.leaders, undefined);
  assert.equal(visitor.missing, undefined);
  assert.equal(visitor.unwrittenLine, "yet to be written");
  assert.deepEqual(visitor.style, owner.style);
  assert.deepEqual(visitor.card, { ...owner.card, style: owner.style });
});

test("the owner's reader number joins the facts only when given", () => {
  const books = Array.from({ length: 6 }, (_, i) => book(i, { _genres: ["Fantasy"] }));
  const style = { ...DEFAULT_READER_CARD_STYLE, footer: { left: "readerNumber", right: "name" } } as const;
  assert.equal(readerCardInputOf(books, [], "andre", undefined, { style, coverOf: () => null, readerNumber: 42 }).card.facts?.readerNumber, 42);
  assert.equal("readerNumber" in readerCardInputOf(books, [], "andre", undefined, { style, coverOf: () => null }).card.facts!, false);
  assert.equal("readerNumber" in readerCardInputOf(books, [], "andre", undefined, { style, coverOf: () => null, readerNumber: null }).card.facts!, false);
});
