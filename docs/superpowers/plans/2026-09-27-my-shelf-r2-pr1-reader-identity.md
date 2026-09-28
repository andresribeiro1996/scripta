# My shelf release 2, PR 1: `readerIdentity()`. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, tested function that works out a reader's identity from their finished books, with its evidence and what it doesn't know, plus the public subset that may leave the server.

**Architecture:** One module, `packages/shared/src/library/readerIdentity.ts`, beside `calculateShelfTheme`. It reuses:
- `genresForBook` for genres;
- `bookKey` and `Group` for series;
- `IdentityKey`, `CardState` and `READER_PLATES` from PR 0's `readerCards`.

**Tech Stack:** TypeScript, `node:test` via tsx.

**Spec:** `docs/superpowers/specs/2026-09-26-my-shelf-release-2-design.md`, section "1. `readerIdentity()`".

**Base:** `origin/main` after PR 0 merges. If PR 0 hasn't merged, branch from `origin/feat/reader-card-plates`.

## Global Constraints

- **Finished books only:** only books with `ReadStatus === 2` count. Dates are never required.
- **Thresholds, from the spec:**
  - Cartographer: at least 30% in a series, and at least 3 books.
  - Annotator: at least 30% with a highlight or review, and at least 20 marks.
  - Lamplighter: at least 35%.
  - Stargazer: at least 40%.
  - Archivist: at least 35%.
  - Correspondent: at least 40%.
  - Wayfarer: at least 6 genres above 5%, and none over 25%.
  - Loyalist: at least 40% by the top 3 authors.
- **The genre gate:** the four genre signals and the Wayfarer count only when genres are known for at least half of the finished books.
- **States:**
  - **Unwritten:** fewer than 5 finished books, or the strongest signal is below 0.75.
  - **Settled:** the strongest signal is at or above 1, and no other signal at or above 1 is within 5% of it.
  - **Leaning:** everything else. A tie sets `runnerUp`.
- **Nothing public names a book or a person:** the `signal.label` and `coverage` strings never contain titles, author names or series names. Only `leaders` does, and `publicReaderCard` drops `leaders` and `missing`.
- **Coverage line:** always "genres known for N of M finished books". When any finished book's `ContentID` starts with `goodreads:` or `storygraph:`, add "series unknown for Goodreads and StoryGraph imports".
- No code comments; no new packages. In a worktree session, run git as `/usr/bin/git …` and don't run `npm install`.

## Rulings made while planning

- **Loyalist counts only repeat authors.** Among the top 3 authors, only those with at least 2 finished books count. Otherwise any reader of five books by five different authors would be "60% by their top three authors" and settle as a Loyalist. The cost is a reader of three authors who has one book each, who can't be a Loyalist, which is intended.
- **The genre-signal share is out of finished books with known genres,** not all finished books. The gate already requires at least half to be known, and this keeps an unknown genre from counting against a signal.
- **Each signal's strength is the weaker of its conditions:**
  - Cartographer: `min(share / 0.30, books / 3)`.
  - Annotator: `min(share / 0.30, marks / 20)`.
  - Wayfarer: `min(genres above 5% / 6, 0.25 / largest share)`, as the spec says.
- **Floating point:** strengths are compared with a 1e-9 tolerance, so exactly 30% of 10 counts as clearing.
- **The spec's worked example isn't a test.** The real dev fixture has several books by the same authors (Tolkien, Martin), so it may read as Loyalist, not Cartographer. The tests use synthetic libraries that isolate each signal. The device check in PR 2 records what the fixture actually shows.
- **The Unwritten plate line is out of scope.** `missing` is a sentence for the sheet. PR 2 derives the short plate line from it.

---

### Task 1: `readerIdentity` and `publicReaderCard`

**Files:**
- Create: `packages/shared/src/library/readerIdentity.ts`
- Create: `packages/shared/src/library/readerIdentity.test.ts`
- Modify: `packages/shared/src/library/index.ts` (add `export * from "./readerIdentity.js";`)

**Interfaces:**
- Consumes (PR 0): `IdentityKey`, `CardState` and `READER_PLATES` from `../readerCards/index.js`.
- Produces:
  - `readerIdentity(books: Array<Record<string, unknown>>, groups: Group[]): ReaderIdentity`;
  - `publicReaderCard(identity: ReaderIdentity): PublicReaderCard`;
  - `interface ReaderIdentity { state: CardState; identity: IdentityKey | null; runnerUp: IdentityKey | null; signal: ReaderSignal | null; leaders: ReaderLeader[]; coverage: string[]; missing: string | null }`;
  - `interface ReaderSignal { counted: number; of: number; label: string }`;
  - `interface ReaderLeader { label: string; count: number }`;
  - `type PublicReaderCard = Pick<ReaderIdentity, "state" | "identity" | "runnerUp" | "signal" | "coverage">`.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/library/readerIdentity.test.ts`:

```ts
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
  const books = shelf(5);
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, because `./readerIdentity.js` doesn't exist.

- [ ] **Step 3: Implement**

`packages/shared/src/library/readerIdentity.ts`:

```ts
import { READER_PLATES, type CardState, type IdentityKey } from "../readerCards/index.js";
import { genresForBook, type BookGenre } from "./bookGenres.js";
import type { Group } from "./groups.js";
import { bookKey } from "./merge.js";

type Book = Record<string, unknown>;

export interface ReaderSignal { counted: number; of: number; label: string }
export interface ReaderLeader { label: string; count: number }
export interface ReaderIdentity {
  state: CardState;
  identity: IdentityKey | null;
  runnerUp: IdentityKey | null;
  signal: ReaderSignal | null;
  leaders: ReaderLeader[];
  coverage: string[];
  missing: string | null;
}
export type PublicReaderCard = Pick<ReaderIdentity, "state" | "identity" | "runnerUp" | "signal" | "coverage">;

interface Candidate { key: IdentityKey; strength: number; signal: ReaderSignal; leaders: ReaderLeader[]; gap: string }

const EPSILON = 1e-9;
const MIN_BOOKS = 5;

const GENRE_SIGNALS: Array<{ key: IdentityKey; genres: BookGenre[]; threshold: number; words: string }> = [
  { key: "lamp", genres: ["Mystery", "Crime", "Thriller", "Horror"], threshold: 0.35, words: "mystery, crime, thriller or horror" },
  { key: "star", genres: ["Fantasy", "Science Fiction"], threshold: 0.4, words: "fantasy or science fiction" },
  { key: "arch", genres: ["History", "Biography & Memoir", "Politics"], threshold: 0.35, words: "history, biography or politics" },
  { key: "corr", genres: ["Classics", "Literary Fiction", "Poetry"], threshold: 0.4, words: "classics, literary fiction or poetry" },
];

const pct = (value: number) => `${Math.round(value * 100)}%`;
const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
const nameOf = (key: IdentityKey) => READER_PLATES.find((plate) => plate.key === key)!.name;

function bump(counts: Map<string, number>, key: string, by = 1) {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

function top(counts: Map<string, number>, n = 3): ReaderLeader[] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([label, count]) => ({ label, count }));
}

function markCount(book: Book) {
  return (Array.isArray(book.highlights) ? book.highlights : []).filter((h) => {
    if (!h || typeof h !== "object") return false;
    const mark = h as Book;
    return (mark.Type === "highlight" || mark.Type === "review") && String(mark.Text ?? "").trim() !== "";
  }).length;
}

export function readerIdentity(books: Book[], groups: Group[]): ReaderIdentity {
  const finished = books.filter((book) => book.ReadStatus === 2);
  const n = finished.length;
  const known = finished.filter((book) => genresForBook(book).length > 0);
  const coverage = [`genres known for ${known.length} of ${n} finished books`];
  if (finished.some((book) => /^(goodreads|storygraph):/.test(String(book.ContentID ?? "")))) coverage.push("series unknown for Goodreads and StoryGraph imports");
  const unwritten = (missing: string): ReaderIdentity => ({ state: "unwritten", identity: null, runnerUp: null, signal: null, leaders: [], coverage, missing });
  if (n < MIN_BOOKS) return unwritten(`Finish ${plural(MIN_BOOKS - n, "more book")}`);

  const candidates: Candidate[] = [];

  const keys = new Set(finished.map(bookKey));
  const inSeries = new Set<string>();
  const seriesCounts = new Map<string, number>();
  for (const group of groups) {
    if (group.type !== "series") continue;
    for (const key of group.bookKeys) if (keys.has(key)) { inSeries.add(key); bump(seriesCounts, group.name); }
  }
  candidates.push({
    key: "carto",
    strength: Math.min(inSeries.size / n / 0.3, inSeries.size / 3),
    signal: { counted: inSeries.size, of: n, label: `${inSeries.size} of ${n} finished books are in a series` },
    leaders: top(seriesCounts),
    gap: `${pct(inSeries.size / n)} of finished books are in a series; 30% settles it`,
  });

  const marked = finished.filter((book) => markCount(book) > 0);
  const marks = finished.reduce((sum, book) => sum + markCount(book), 0);
  candidates.push({
    key: "anno",
    strength: Math.min(marked.length / n / 0.3, marks / 20),
    signal: { counted: marked.length, of: n, label: `${marked.length} of ${n} finished books have highlights or notes` },
    leaders: top(new Map(marked.map((book) => [String(book.Title ?? "Untitled"), markCount(book)] as const))),
    gap: `${pct(marked.length / n)} of finished books have highlights or notes, with ${plural(marks, "mark")}; 30% and 20 marks settle it`,
  });

  const authors = new Map<string, number>();
  for (const book of finished) {
    const author = String(book.Attribution ?? "").trim();
    if (author) bump(authors, author);
  }
  const loyalAuthors = top(authors).filter((author) => author.count >= 2);
  const byLoyal = loyalAuthors.reduce((sum, author) => sum + author.count, 0);
  candidates.push({
    key: "loyal",
    strength: byLoyal / n / 0.4,
    signal: { counted: byLoyal, of: n, label: `${byLoyal} of ${n} finished books are by your three most-read authors` },
    leaders: loyalAuthors,
    gap: `${pct(byLoyal / n)} of finished books are by your three most-read authors; 40% settles it`,
  });

  if (known.length * 2 >= n) {
    const m = known.length;
    for (const signal of GENRE_SIGNALS) {
      const matching = known.filter((book) => genresForBook(book).some((genre) => signal.genres.includes(genre)));
      const genreCounts = new Map<string, number>();
      for (const book of matching) for (const genre of genresForBook(book)) if (signal.genres.includes(genre)) bump(genreCounts, genre);
      candidates.push({
        key: signal.key,
        strength: matching.length / m / signal.threshold,
        signal: { counted: matching.length, of: m, label: `${matching.length} of ${m} finished books with known genres are ${signal.words}` },
        leaders: top(genreCounts),
        gap: `${pct(matching.length / m)} of finished books with known genres are ${signal.words}; ${pct(signal.threshold)} settles it`,
      });
    }
    const all = new Map<string, number>();
    for (const book of known) for (const genre of genresForBook(book)) bump(all, genre);
    const shares = [...all.values()].map((count) => count / m);
    const wide = shares.filter((share) => share > 0.05).length;
    const largest = Math.max(...shares);
    candidates.push({
      key: "way",
      strength: Math.min(wide / 6, 0.25 / largest),
      signal: { counted: wide, of: all.size, label: `${wide} genres above 5% of finished books; the largest is ${pct(largest)}` },
      leaders: top(all),
      gap: `${plural(wide, "genre")} above 5%, the largest at ${pct(largest)}; 6 genres with none over 25% settle it`,
    });
  }

  const [best, second] = [...candidates].sort((a, b) => b.strength - a.strength);
  if (!best || best.strength < 0.75 - EPSILON) {
    return unwritten(known.length * 2 < n ? `Genres are known for ${known.length} of ${n} finished books` : "No reading pattern stands out yet");
  }
  const clears = (candidate: Candidate | undefined) => Boolean(candidate && candidate.strength >= 1 - EPSILON);
  const tie = clears(best) && clears(second) && second!.strength >= best.strength * 0.95 - EPSILON;
  const shared = { identity: best.key, signal: best.signal, leaders: best.leaders, coverage };
  if (clears(best) && !tie) return { state: "settled", runnerUp: null, missing: null, ...shared };
  return {
    state: "leaning",
    runnerUp: tie ? second!.key : null,
    missing: tie ? `Close between the ${nameOf(best.key)} and the ${nameOf(second!.key)}` : best.gap,
    ...shared,
  };
}

export function publicReaderCard({ state, identity, runnerUp, signal, coverage }: ReaderIdentity): PublicReaderCard {
  return { state, identity, runnerUp, signal, coverage };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: PASS.

If a test fails because a synthetic library trips a second signal the test didn't intend, fix the test library, not the thresholds, and report which one. For example, distinct `Author ${i}` never counts toward the Loyalist, but repeated genres can raise the Wayfarer.

- [ ] **Step 5: Typecheck consumers and commit**

Run: `npm run typecheck --workspace mobile && npm run typecheck --workspace frontend && npm run typecheck --workspace backend`
Expected: PASS.

```bash
/usr/bin/git add packages/shared/src/library
/usr/bin/git commit -m "Shared: readerIdentity works out a reader's card from finished books"
```

The body gives the why: one pure function, so both clients and the server agree on a card. The public subset is a separate function, so leaders and the missing line can't leak by accident. And the Loyalist counts only repeat authors.

---

## Self-review

- **Spec coverage:**
  - the eight signals and thresholds, the genre gate, and the three states with the 5% tie rule;
  - `leaders`, `coverage` including the import line, and `missing`;
  - `publicReaderCard` and the no-leak test.

  The worked example is replaced by synthetic tests, by ruling.
- **Types:** `IdentityKey` and `CardState` are imported from PR 0, not redefined, as the spec was updated to say. `ReaderIdentity` matches the spec's shape.
