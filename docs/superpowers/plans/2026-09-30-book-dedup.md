# Book Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treat variant titles, ISBN-less copies and other editions as the same book: imports stop duplicating, existing duplicates merge (certain ones automatically, likely ones after confirmation), and the backend catalog shares one entry across them.

**Architecture:**
- **Matching and merging** are pure functions in `@scripta/shared` (`bookMatch.ts`, `dedupe.ts`, plus `merge.ts` changes).
- **The server merge** is a new `POST /library/books/merge` in the library module. It rewrites the owner's editable references in murals, tierlists, arena and quizzes through per-module `rekeyXBooks` functions wired in `app.ts`, then saves the library with the existing optimistic `updatedAt` check.
- **Clients** auto-merge certain groups on load through a shared runner, and show a review sheet for likely groups.
- **The catalog** registers a title alias key next to the ISBN key.

**Tech Stack:** TypeScript, node:test + `node:assert/strict` (run through `tsx`), Fastify + zod, `node:sqlite`, React + TanStack Query (web), Expo/React Native (mobile).

**Spec:** `docs/superpowers/specs/2026-09-30-book-dedup-design.md`

## Global Constraints

- `bookKey` (`packages/shared/src/library/merge.ts`) and its copy in `backend/src/modules/library/publicResolver.ts` do not change.
- No code comments (repo rule). When you change a function whose existing doc comment becomes false, delete the false sentence. Don't add new ones.
- Logic used by more than one package goes in `@scripta/shared`, never copied.
- Tests use `node:test` + `node:assert/strict`, like the existing ones.
- Backend: every new `*.test.ts` must be added to the explicit list in `backend/package.json` `"test"`, or CI never runs it.
- Consumers read `packages/shared/dist`: run `npm run build --workspace @scripta/shared` before any backend, frontend or mobile typecheck or test.
- Verify per package:
  - shared: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
  - backend: `npm run typecheck --workspace backend && npm test --workspace backend`
  - frontend: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
  - mobile: `npm run typecheck --workspace mobile && npm test --workspace mobile`
- Git: this is a worktree where `rtk git` is refused. Run git as `/usr/bin/git` from the worktree root. Stage and commit in one call. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Different ISBNs are never a certain match.
- A book with an empty normalized title never matches anything.
- Only the owner's editable data is rewritten:
  - library `groups` and `distinctBooks`
  - all of the owner's murals
  - tierlists with `vote_code IS NULL`
  - arena tournaments with `status = 'seeding'`
  - quizzes with `vote_code IS NULL`

## Review Focus

1. **Untitled books** (empty `Title`, no ISBN; they share the `ta:|` key) must never be grouped or merged. Pinned in Task 1 and Task 3.
2. **Garbage entries** in `library.books` (non-object entries; the document is an opaque blob): `findDuplicates` and `mergeDuplicateBooks` skip them without throwing and keep them in place. Pinned in Task 3.
3. **Stale merge request** (old `updatedAt`): return 409 before any reference is rewritten, so there are no side effects. Pinned in Task 7.
4. **Auto-merge failure mid-run** (network error on the second group): the runner rejects rather than looping or reporting success, and the client invalidates its cached library. Pinned in Task 4.
5. **Large library** (3,000 books): `findDuplicates` must stay bucketed, not all-pairs. Pinned in Task 3 with a one-second budget.

---

### Task 1: Shared matching rules

**Files:**
- Create: `packages/shared/src/library/bookMatch.ts`
- Create: `packages/shared/src/library/bookMatch.test.ts`
- Modify: `packages/shared/src/library/index.ts` (add `export * from "./bookMatch.js";` after the `merge.js` line)

**Interfaces:**
- Produces:
  - `normalizeWords(value: string): string`
  - `normalizeTitle(value: string): string`
  - `titleNumbers(title: string): string`
  - `firstAuthor(attribution: string): string`
  - `canonicalIsbn(raw: unknown): string`
  - `interface MatchFacts { isbn: string; exact: string; loose: string; numbers: string }`
  - `matchFacts(book: Record<string, unknown>): MatchFacts`
  - `certainFacts(a: MatchFacts, b: MatchFacts): boolean`
  - `likelyFacts(a: MatchFacts, b: MatchFacts): boolean`
  - `isCertainMatch(a, b): boolean`
  - `isLikelyMatch(a, b): boolean`

- [ ] **Step 1: Write the failing test** — `packages/shared/src/library/bookMatch.test.ts`

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalIsbn, firstAuthor, isCertainMatch, isLikelyMatch, normalizeTitle, titleNumbers } from "./bookMatch.js";

const dune = { Title: "Dune", Attribution: "Frank Herbert" };

test("canonicalIsbn converts ISBN-10 to ISBN-13 and ignores case and hyphens", () => {
  assert.equal(canonicalIsbn("0-441-01359-7"), "9780441013593");
  assert.equal(canonicalIsbn("9780441013593"), "9780441013593");
  assert.equal(canonicalIsbn("080442957x"), canonicalIsbn("080442957X"));
  assert.equal(canonicalIsbn("urn:uuid:abc"), "");
});

test("normalizeTitle drops brackets, subtitles and diacritics; titleNumbers ignores bracketed numbers", () => {
  assert.equal(normalizeTitle("Dune (Dune Chronicles #1)"), "dune");
  assert.equal(normalizeTitle("Dune: Deluxe Edition"), "dune");
  assert.equal(normalizeTitle("Antídoto"), "antidoto");
  assert.equal(titleNumbers("Dune (Dune Chronicles #1)"), "");
  assert.equal(titleNumbers("Complete Works: Volume 2"), "2");
});

test("firstAuthor keeps only the first listed author", () => {
  assert.equal(firstAuthor("Frank Herbert, Brian Herbert"), "frank herbert");
  assert.equal(firstAuthor(""), "");
});

test("certain: same ISBN in any form, or same title and first author when at most one has an ISBN", () => {
  assert.equal(isCertainMatch({ ...dune, ISBN: "0441013597" }, { Title: "Other", Attribution: "X", ISBN: "978-0441013593" }), true);
  assert.equal(isCertainMatch({ ...dune, ISBN: "9780441013593" }, { Title: "DUNE", Attribution: "Frank Herbert, Someone Else" }), true);
  assert.equal(isCertainMatch({ ...dune, ISBN: "9780441013593" }, { ...dune, ISBN: "9780593099322" }), false);
  assert.equal(isCertainMatch(dune, { Title: "Dune (Dune Chronicles #1)", Attribution: "Frank Herbert" }), false);
});

test("likely: same main title and surname with equal numbers, never when already certain", () => {
  assert.equal(isLikelyMatch(dune, { Title: "Dune (Dune Chronicles #1)", Attribution: "Frank Herbert" }), true);
  assert.equal(isLikelyMatch(dune, { Title: "Dune: Deluxe Edition", Attribution: "F. Herbert", ISBN: "9780593099322" }), true);
  assert.equal(isLikelyMatch({ ...dune, ISBN: "9780441013593" }, { ...dune, ISBN: "9780593099322" }), true);
  assert.equal(isLikelyMatch({ Title: "Complete Works: Volume 1", Attribution: "A Poet" }, { Title: "Complete Works: Volume 2", Attribution: "A Poet" }), false);
  assert.equal(isLikelyMatch(dune, dune), false);
});

test("books without a title never match", () => {
  const untitled = { Title: "", Attribution: "" };
  assert.equal(isCertainMatch(untitled, { ...untitled }), false);
  assert.equal(isLikelyMatch(untitled, { ...untitled }), false);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL. `./bookMatch.js` can't be found.

- [ ] **Step 3: Implement** — `packages/shared/src/library/bookMatch.ts`

```ts
import { normalizeIsbn } from "./covers.js";

type Book = Record<string, unknown>;

export interface MatchFacts {
  isbn: string;
  exact: string;
  loose: string;
  numbers: string;
}

export function normalizeWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function withoutBrackets(value: string): string {
  return value.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
}

export function normalizeTitle(value: string): string {
  return normalizeWords(withoutBrackets(value).split(":")[0] ?? "");
}

export function titleNumbers(title: string): string {
  return (withoutBrackets(title).match(/\d+/g) ?? []).join(" ");
}

export function firstAuthor(attribution: string): string {
  return normalizeWords(attribution.split(",")[0] ?? "");
}

export function canonicalIsbn(raw: unknown): string {
  const isbn = normalizeIsbn(raw).toUpperCase();
  if (isbn.length !== 10) return isbn;
  const core = `978${isbn.slice(0, 9)}`;
  const sum = [...core].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

export function matchFacts(book: Book): MatchFacts {
  const title = String(book.Title ?? "");
  const author = firstAuthor(String(book.Attribution ?? ""));
  const exactTitle = normalizeWords(title);
  const mainTitle = normalizeTitle(title);
  const surname = author.split(" ").at(-1) ?? "";
  return {
    isbn: canonicalIsbn(book.ISBN),
    exact: exactTitle && author ? `${exactTitle}|${author}` : "",
    loose: mainTitle && surname ? `${mainTitle}|${surname}` : "",
    numbers: titleNumbers(title)
  };
}

export function certainFacts(a: MatchFacts, b: MatchFacts): boolean {
  if (a.isbn !== "" && a.isbn === b.isbn) return true;
  return a.exact !== "" && a.exact === b.exact && (a.isbn === "" || b.isbn === "");
}

export function likelyFacts(a: MatchFacts, b: MatchFacts): boolean {
  return !certainFacts(a, b) && a.loose !== "" && a.loose === b.loose && a.numbers === b.numbers;
}

export function isCertainMatch(a: Book, b: Book): boolean {
  return certainFacts(matchFacts(a), matchFacts(b));
}

export function isLikelyMatch(a: Book, b: Book): boolean {
  return likelyFacts(matchFacts(a), matchFacts(b));
}
```

Note: a title-less book with an ISBN still matches on ISBN. The `exact` and `loose` guards only stop title-less books from matching each other through empty strings.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: PASS, including every test that already existed.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/shared/src/library/bookMatch.ts packages/shared/src/library/bookMatch.test.ts packages/shared/src/library/index.ts && /usr/bin/git commit -m "Add shared certain/likely book matching rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Imports pair on the certain rule and keep the existing identity

**Files:**
- Modify: `packages/shared/src/library/merge.ts`
  - `mergeBookLists` and its doc comment: the "Deliberately does NOT deduplicate" sentence becomes false; delete it.
  - export `unionHighlights`
- Create: `packages/shared/src/library/merge.test.ts`

**Interfaces:**
- Consumes: `matchFacts`, `certainFacts` (Task 1).
- Produces:
  - `export function unionHighlights(existing: unknown, incoming: unknown): Array<Record<string, unknown>>` (same body as today, now exported)
  - `mergeBookLists(existingBooks, incomingBooks)`: same signature, new pairing.

- [ ] **Step 1: Write the failing test** — `packages/shared/src/library/merge.test.ts`

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey, mergeBookLists } from "./merge.js";

test("a Goodreads row with an ISBN merges into the ISBN-less Kobo copy and keeps the Kobo key", () => {
  const kobo = { ContentID: "k1", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1, highlights: [{ BookmarkID: "h1" }] };
  const goodreads = { ContentID: "goodreads:9", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 };
  const merged = mergeBookLists([kobo], [goodreads]);
  assert.equal(merged.length, 1);
  assert.equal(bookKey(merged[0]!), bookKey(kobo));
  assert.equal("ISBN" in merged[0]!, false);
  assert.equal(merged[0]!.ReadStatus, 2);
  assert.deepEqual(merged[0]!.highlights, [{ BookmarkID: "h1" }]);
});

test("ISBN-10 and ISBN-13 of the same book pair", () => {
  const merged = mergeBookLists([{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "0441013597" }], [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.ISBN, "0441013597");
});

test("likely matches and different ISBNs are appended, not merged", () => {
  const existing = [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" }];
  const merged = mergeBookLists(existing, [
    { Title: "Dune (Dune Chronicles #1)", Attribution: "Frank Herbert" },
    { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780593099322" }
  ]);
  assert.equal(merged.length, 3);
});

test("certain duplicates inside one import collapse into the first", () => {
  const merged = mergeBookLists([], [
    { ContentID: "a", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 0 },
    { ContentID: "b", Title: "DUNE", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.Title, "Dune");
  assert.equal(merged[0]!.ReadStatus, 2);
});

test("each existing book pairs at most once", () => {
  const merged = mergeBookLists([{ Title: "Dune", Attribution: "Frank Herbert" }], [
    { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" },
    { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780593099322" }
  ]);
  assert.equal(merged.length, 2);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: FAIL. The first test gets 2 books, because today's key-equality pairing misses the ISBN-less copy.

- [ ] **Step 3: Implement**

In `merge.ts`:
- add `import { certainFacts, matchFacts } from "./bookMatch.js";`
- change `function unionHighlights` to `export function unionHighlights`
- replace the body of `mergeBookLists` with:

```ts
const IDENTITY_FIELDS = ["Title", "Attribution", "ISBN"] as const;

function withIdentityOf(book: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const next = { ...book };
  for (const field of IDENTITY_FIELDS) {
    if (field in source) next[field] = source[field];
    else delete next[field];
  }
  return next;
}

function collapseCertain(books: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const kept: Array<Record<string, unknown>> = [];
  const facts: ReturnType<typeof matchFacts>[] = [];
  for (const book of books) {
    const bookFacts = matchFacts(book);
    const index = facts.findIndex((other) => certainFacts(other, bookFacts));
    if (index < 0) {
      kept.push(book);
      facts.push(bookFacts);
    } else {
      kept[index] = withIdentityOf(mergeBookPair(kept[index]!, book), kept[index]!);
    }
  }
  return kept;
}

export function mergeBookLists(
  existingBooks: Array<Record<string, unknown>>,
  incomingBooks: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const existingFacts = existingBooks.map(matchFacts);
  const paired = new Set<number>();
  const merged = [...existingBooks];
  for (const book of collapseCertain(incomingBooks)) {
    const facts = matchFacts(book);
    const index = existingFacts.findIndex((other, i) => !paired.has(i) && certainFacts(other, facts));
    if (index < 0) {
      merged.push(book);
      continue;
    }
    paired.add(index);
    merged[index] = withIdentityOf(mergeBookPair(existingBooks[index]!, book), existingBooks[index]!);
  }
  return merged;
}
```

`IDENTITY_FIELDS`, `withIdentityOf` and `collapseCertain` sit above `mergeBookLists`. `mergeBookPair` stays unchanged.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/shared/src/library/merge.ts packages/shared/src/library/merge.test.ts && /usr/bin/git commit -m "Pair imported books on the certain match rule and keep the existing identity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared dedupe operations

**Files:**
- Create: `packages/shared/src/library/dedupe.ts`
- Create: `packages/shared/src/library/dedupe.test.ts`
- Modify: `packages/shared/src/library/types.ts` (add `distinctBooks?: string[][];` to `LibraryData`, before the index signature)
- Modify: `packages/shared/src/library/index.ts` (add `export * from "./dedupe.js";`)

**Interfaces:**
- Consumes: `matchFacts`, `certainFacts`, `likelyFacts` (Task 1); `bookKey`, `unionHighlights` (Task 2); `normalizeBookGenres` (`bookGenres.ts`).
- Produces:
  - `interface DuplicateGroups { certain: string[][]; likely: string[][] }`
  - `findDuplicates(library: LibraryData): DuplicateGroups`. Each group is `bookKey`s ordered by library position; the first entry is the one to keep.
  - `combineBooks(keep: Record<string, unknown>, other: Record<string, unknown>): Record<string, unknown>`
  - `mergeDuplicateBooks(library: LibraryData, keep: string, merge: string[]): LibraryData`. Returns the same object when fewer than two books match.
  - `markDistinct(library: LibraryData, keys: string[]): LibraryData`
  - `rekeyKeys(keys: readonly string[], from: ReadonlySet<string>, to: string): string[]`
  - `rekeyTierBoard<T extends Record<string, unknown>>(board: T, from: ReadonlySet<string>, to: string): T`

- [ ] **Step 1: Write the failing test** — `packages/shared/src/library/dedupe.test.ts`

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { combineBooks, findDuplicates, markDistinct, mergeDuplicateBooks, rekeyKeys, rekeyTierBoard } from "./dedupe.js";
import { bookKey } from "./merge.js";
import type { LibraryData } from "./types.js";

const kobo = { ContentID: "k1", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1, ___PercentRead: 40, _order: 0, highlights: [{ BookmarkID: "h1" }] };
const goodreads = { ContentID: "g1", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2, Rating: 5, _order: 1, highlights: [{ BookmarkID: "h2" }] };
const series = { ContentID: "k2", Title: "Dune (Dune Chronicles #1)", Attribution: "Frank Herbert", _order: 2 };
const deluxe = { ContentID: "g2", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780593099322", _order: 3 };

test("findDuplicates separates certain groups from likely ones, in library order", () => {
  const groups = findDuplicates({ books: [kobo, goodreads, series] });
  assert.deepEqual(groups.certain, [[bookKey(kobo), bookKey(goodreads)]]);
  assert.deepEqual(groups.likely, [[bookKey(kobo), bookKey(goodreads), bookKey(series)]]);
});

test("a certain group bridging two different ISBNs is demoted to likely", () => {
  const groups = findDuplicates({ books: [kobo, goodreads, deluxe] });
  assert.deepEqual(groups.certain, []);
  assert.deepEqual(groups.likely, [[bookKey(kobo), bookKey(goodreads), bookKey(deluxe)]]);
});

test("pairs in distinctBooks are never grouped", () => {
  const groups = findDuplicates({ books: [goodreads, deluxe], distinctBooks: [[bookKey(deluxe), bookKey(goodreads)]] });
  assert.deepEqual(groups, { certain: [], likely: [] });
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: FAIL. `./dedupe.js` can't be found.

- [ ] **Step 3: Implement** — `packages/shared/src/library/dedupe.ts`

```ts
import { normalizeBookGenres } from "./bookGenres.js";
import { certainFacts, likelyFacts, matchFacts, type MatchFacts } from "./bookMatch.js";
import { bookKey, unionHighlights } from "./merge.js";
import type { LibraryData } from "./types.js";

type Book = Record<string, unknown>;

export interface DuplicateGroups {
  certain: string[][];
  likely: string[][];
}

const MAX_FIELDS = ["ReadStatus", "___PercentRead", "TimeSpentReading"] as const;

function isBook(value: unknown): value is Book {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function pairId(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function components(size: number, edges: Array<[number, number]>): number[][] {
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < size; i++) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);
  return [...groups.values()].filter((group) => group.length > 1);
}

export function findDuplicates(library: LibraryData): DuplicateGroups {
  const books = library.books.filter(isBook);
  const facts: MatchFacts[] = books.map(matchFacts);
  const keys = books.map(bookKey);
  const distinct = new Set((library.distinctBooks ?? []).map(([a, b]) => pairId(String(a), String(b))));
  const buckets = new Map<string, number[]>();
  facts.forEach((fact, i) => {
    for (const bucket of [fact.isbn && `i:${fact.isbn}`, fact.exact && `e:${fact.exact}`, fact.loose && `l:${fact.loose}`]) {
      if (bucket) buckets.set(bucket, [...(buckets.get(bucket) ?? []), i]);
    }
  });
  const certainEdges: Array<[number, number]> = [];
  const likelyEdges: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (const members of buckets.values()) {
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const a = members[x]!;
        const b = members[y]!;
        if (seen.has(`${a}:${b}`)) continue;
        seen.add(`${a}:${b}`);
        if (distinct.has(pairId(keys[a]!, keys[b]!))) continue;
        if (certainFacts(facts[a]!, facts[b]!)) certainEdges.push([a, b]);
        else if (likelyFacts(facts[a]!, facts[b]!)) likelyEdges.push([a, b]);
      }
    }
  }
  const position = (i: number) => (typeof books[i]!._order === "number" ? (books[i]!._order as number) : Number.MAX_SAFE_INTEGER);
  const ordered = (group: number[]) => [...group].sort((a, b) => position(a) - position(b) || a - b);
  const toKeys = (group: number[]) => [...new Set(ordered(group).map((i) => keys[i]!))];
  const signature = (group: number[]) => [...group].sort((a, b) => a - b).join(",");
  const certainGroups = components(books.length, certainEdges).filter((group) => new Set(group.map((i) => facts[i]!.isbn).filter(Boolean)).size <= 1);
  const certainSignatures = new Set(certainGroups.map(signature));
  const likelyGroups = components(books.length, [...certainEdges, ...likelyEdges]).filter((group) => !certainSignatures.has(signature(group)));
  return { certain: certainGroups.map(toKeys), likely: likelyGroups.map(toKeys) };
}

export function combineBooks(keep: Book, other: Book): Book {
  const combined: Book = { ...keep };
  for (const [field, value] of Object.entries(other)) {
    if (isBlank(combined[field]) && !isBlank(value)) combined[field] = value;
  }
  for (const field of MAX_FIELDS) {
    const values = [keep[field], other[field]].filter((value): value is number => typeof value === "number");
    if (values.length > 0) combined[field] = Math.max(...values);
  }
  if (!isBlank(keep.DateLastRead) && !isBlank(other.DateLastRead)) {
    combined.DateLastRead = String(other.DateLastRead) > String(keep.DateLastRead) ? other.DateLastRead : keep.DateLastRead;
  }
  combined.highlights = unionHighlights(keep.highlights, other.highlights);
  if ("_genres" in keep || "_genres" in other) {
    const list = (value: unknown) => (Array.isArray(value) ? value : []);
    combined._genres = normalizeBookGenres([...list(keep._genres), ...list(other._genres)]);
  }
  return combined;
}

export function rekeyKeys(keys: readonly string[], from: ReadonlySet<string>, to: string): string[] {
  return [...new Set(keys.map((key) => (from.has(key) ? to : key)))];
}

export function rekeyTierBoard<T extends Record<string, unknown>>(board: T, from: ReadonlySet<string>, to: string): T {
  const placed = new Set<string>();
  const tiers = Array.isArray(board.tiers)
    ? board.tiers.map((tier: unknown) => {
        if (!isBook(tier) || !Array.isArray(tier.bookKeys)) return tier;
        const bookKeys = rekeyKeys(tier.bookKeys as string[], from, to).filter((key) => !placed.has(key));
        bookKeys.forEach((key) => placed.add(key));
        return { ...tier, bookKeys };
      })
    : board.tiers;
  const pool = Array.isArray(board.pool) ? rekeyKeys(board.pool as string[], from, to).filter((key) => !placed.has(key)) : board.pool;
  return { ...board, tiers, pool };
}

function rekeyPairs(pairs: readonly unknown[][], from: ReadonlySet<string>, to: string): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const [a, b] of pairs) {
    if (typeof a !== "string" || typeof b !== "string") continue;
    const left = from.has(a) ? to : a;
    const right = from.has(b) ? to : b;
    if (left === right || seen.has(pairId(left, right))) continue;
    seen.add(pairId(left, right));
    result.push(left < right ? [left, right] : [right, left]);
  }
  return result;
}

export function markDistinct(library: LibraryData, keys: string[]): LibraryData {
  const pairs: unknown[][] = [...(library.distinctBooks ?? [])];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) pairs.push([keys[i], keys[j]]);
  return { ...library, distinctBooks: rekeyPairs(pairs, new Set(), "") };
}

export function mergeDuplicateBooks(library: LibraryData, keep: string, merge: string[]): LibraryData {
  const keys = new Set([keep, ...merge]);
  const original = library.books.find((book) => isBook(book) && bookKey(book) === keep);
  const members = library.books.filter((book): book is Book => isBook(book) && keys.has(bookKey(book)));
  if (!original || members.length < 2) return library;
  const survivor = members.reduce((acc, book) => (book === original ? acc : combineBooks(acc, book)), original);
  const books = library.books.flatMap((book) => (book === original ? [survivor] : isBook(book) && keys.has(bookKey(book)) ? [] : [book]));
  const from = new Set(merge.filter((key) => key !== keep));
  const now = new Date().toISOString();
  const groups = library.groups?.map((group) => {
    const bookKeys = rekeyKeys(group.bookKeys, from, keep);
    return bookKeys.join("\u0000") === group.bookKeys.join("\u0000") ? group : { ...group, bookKeys, updatedAt: now };
  });
  return {
    ...library,
    books,
    book_count: books.length,
    ...(groups ? { groups } : {}),
    ...(library.distinctBooks ? { distinctBooks: rekeyPairs(library.distinctBooks, from, keep) } : {})
  };
}
```

Note: `rekeyPairs` sorts the two keys inside each pair by string order and keeps the pairs themselves in insertion order. That's why `distinctBooks` puts the series key (`ta:dune (…` sorts before `ta:dune|`) first, and `markDistinct` yields `b-c` before `a-c`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/shared/src/library/dedupe.ts packages/shared/src/library/dedupe.test.ts packages/shared/src/library/types.ts packages/shared/src/library/index.ts && /usr/bin/git commit -m "Add shared duplicate grouping, book combining and key rewriting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared auto-merge runner

**Files:**
- Modify: `packages/shared/src/library/dedupe.ts` (append)
- Modify: `packages/shared/src/library/dedupe.test.ts` (append)

**Interfaces:**
- Consumes: `findDuplicates` (Task 3).
- Produces:
  - `interface MergeableDocument { data: LibraryData; updatedAt: string }`
  - `mergeCertainDuplicates<D extends MergeableDocument>(document: D, mergeBooks: (keep: string, merge: string[], updatedAt: string) => Promise<D>, refetch: () => Promise<D | null>, isConflict: (error: unknown) => boolean): Promise<D>`. It resolves to the same `document` object when there is nothing to merge.

- [ ] **Step 1: Write the failing test** (append to `dedupe.test.ts`; add `mergeCertainDuplicates` to the import)

```ts
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
  assert.deepEqual(calls, [[bookKey(kobo), [bookKey(goodreads)], "v1"]]);
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: FAIL. `mergeCertainDuplicates` isn't exported.

- [ ] **Step 3: Implement** (append to `dedupe.ts`)

```ts
export interface MergeableDocument {
  data: LibraryData;
  updatedAt: string;
}

async function mergeGroups<D extends MergeableDocument>(document: D, mergeBooks: (keep: string, merge: string[], updatedAt: string) => Promise<D>): Promise<D> {
  let current = document;
  for (const [keep, ...merge] of findDuplicates(document.data).certain) {
    current = await mergeBooks(keep!, merge, current.updatedAt);
  }
  return current;
}

export async function mergeCertainDuplicates<D extends MergeableDocument>(
  document: D,
  mergeBooks: (keep: string, merge: string[], updatedAt: string) => Promise<D>,
  refetch: () => Promise<D | null>,
  isConflict: (error: unknown) => boolean
): Promise<D> {
  try {
    return await mergeGroups(document, mergeBooks);
  } catch (error) {
    if (!isConflict(error)) throw error;
    const fresh = await refetch();
    return fresh ? mergeGroups(fresh, mergeBooks) : document;
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add packages/shared/src/library/dedupe.ts packages/shared/src/library/dedupe.test.ts && /usr/bin/git commit -m "Add shared runner that merges certain duplicates once per load

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Backend reference rewrites — murals and tierlists

**Files:**
- Create: `backend/src/modules/murals/domain/rekeyBlocks.ts`
- Create: `backend/src/modules/murals/domain/rekeyBlocks.test.ts`
- Create: `backend/src/modules/murals/adapters/sqlite/sqliteMuralsRepository.test.ts`
- Modify:
  - `backend/src/modules/murals/domain/ports.ts` (add `rekeyBooks(userId: string, fromKeys: string[], toKey: string): void;`)
  - `backend/src/modules/murals/adapters/sqlite/sqliteMuralsRepository.ts` (implement)
  - `backend/src/modules/murals/plugin.ts` + `index.ts` (export `rekeyMuralsBooks`)
  - `backend/src/modules/murals/service.test.ts` (its in-memory fake repo gains `rekeyBooks() {}`)
  - `backend/src/modules/tierlists/domain/ports.ts`, `adapters/sqlite/sqliteTierlistsRepository.ts`, `adapters/sqlite/sqliteTierlistsRepository.test.ts`, `plugin.ts`, `index.ts` (export `rekeyTierlistsBooks`)
  - Any other fake implementing these ports (`npm run typecheck --workspace backend` lists them): add `rekeyBooks() {}`
  - `backend/package.json` `"test"`: add `src/modules/murals/domain/rekeyBlocks.test.ts src/modules/murals/adapters/sqlite/sqliteMuralsRepository.test.ts`

**Interfaces:**
- Consumes: `rekeyKeys`, `rekeyTierBoard` from `@scripta/shared` (Task 3).
- Produces:
  - `rekeyBlocks(blocks: unknown, from: ReadonlySet<string>, to: string): unknown`
  - `MuralsRepository.rekeyBooks` and `TierlistsRepository.rekeyBooks`: `(userId: string, fromKeys: string[], toKey: string) => void`
  - `export function rekeyMuralsBooks(userId: string, fromKeys: string[], toKey: string): void`
  - `export function rekeyTierlistsBooks(userId: string, fromKeys: string[], toKey: string): void`

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/murals/domain/rekeyBlocks.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { rekeyBlocks } from "./rekeyBlocks.js";

const from = new Set(["old"]);

test("rewrites every book reference a block can hold and de-duplicates", () => {
  const blocks = [
    { id: "1", type: "spotlight", bookKey: "old" },
    { id: "2", type: "shelf", title: "", bookKeys: ["old", "new", "x"] },
    { id: "3", type: "quote", bookKey: "old", highlightId: "h1" },
    { id: "4", type: "quoteCollection", title: "", quotes: [{ bookKey: "old", highlightId: "h1" }, { bookKey: "new", highlightId: "h1" }, { bookKey: "x", highlightId: "h2" }] },
    { id: "5", type: "tierlist", tiers: [{ id: "s", bookKeys: ["old"] }], pool: ["new"] },
    { id: "6", type: "text", body: "old" }
  ];
  assert.deepEqual(rekeyBlocks(blocks, from, "new"), [
    { id: "1", type: "spotlight", bookKey: "new" },
    { id: "2", type: "shelf", title: "", bookKeys: ["new", "x"] },
    { id: "3", type: "quote", bookKey: "new", highlightId: "h1" },
    { id: "4", type: "quoteCollection", title: "", quotes: [{ bookKey: "new", highlightId: "h1" }, { bookKey: "x", highlightId: "h2" }] },
    { id: "5", type: "tierlist", tiers: [{ id: "s", bookKeys: ["new"] }], pool: [] },
    { id: "6", type: "text", body: "old" }
  ]);
});

test("leaves non-array input and non-object blocks alone", () => {
  assert.equal(rekeyBlocks("nope", from, "new"), "nope");
  assert.deepEqual(rekeyBlocks([null, 3], from, "new"), [null, 3]);
});
```

`backend/src/modules/murals/adapters/sqlite/sqliteMuralsRepository.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createSqliteMuralsRepository } from "./sqliteMuralsRepository.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  return db;
}

test("rekeyBooks rewrites only the owner's murals and bumps updated_at only where blocks changed", () => {
  const db = freshDb();
  const insert = db.prepare("INSERT INTO murals (id, user_id, name, blocks, updated_at) VALUES (?, ?, 'm', ?, 't0')");
  insert.run("mine", "u1", JSON.stringify([{ id: "b", type: "spotlight", bookKey: "old" }]));
  insert.run("untouched", "u1", JSON.stringify([{ id: "b", type: "text", body: "hi" }]));
  insert.run("theirs", "u2", JSON.stringify([{ id: "b", type: "spotlight", bookKey: "old" }]));
  createSqliteMuralsRepository(db).rekeyBooks("u1", ["old"], "new");
  const row = (id: string) => db.prepare("SELECT blocks, updated_at FROM murals WHERE id = ?").get(id) as { blocks: string; updated_at: string };
  assert.deepEqual(JSON.parse(row("mine").blocks), [{ id: "b", type: "spotlight", bookKey: "new" }]);
  assert.notEqual(row("mine").updated_at, "t0");
  assert.equal(row("untouched").updated_at, "t0");
  assert.deepEqual(JSON.parse(row("theirs").blocks), [{ id: "b", type: "spotlight", bookKey: "old" }]);
});
```

Append to `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`. It uses the file's existing `freshDb()`; add `createSqliteTierlistsRepository` to the imports if it isn't there already.

```ts
test("rekeyBooks rewrites the owner's unpublished tier lists only", () => {
  const db = freshDb();
  const insert = db.prepare("INSERT INTO tierlists (id, owner_user_id, origin_user_id, name, data, vote_code, created_at, updated_at) VALUES (?, ?, ?, 'n', ?, ?, 't0', 't0')");
  const data = JSON.stringify({ tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: ["old"] }], pool: ["new", "y"] });
  insert.run("draft", "u1", "u1", data, null);
  insert.run("published", "u1", "u1", data, "CODE1");
  insert.run("other", "u2", "u2", data, null);
  createSqliteTierlistsRepository(db).rekeyBooks("u1", ["old"], "new");
  const read = (id: string) => db.prepare("SELECT data, updated_at FROM tierlists WHERE id = ?").get(id) as { data: string; updated_at: string };
  assert.deepEqual(JSON.parse(read("draft").data), { tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: ["new"] }], pool: ["y"] });
  assert.notEqual(read("draft").updated_at, "t0");
  assert.equal(read("published").data, data);
  assert.equal(read("other").data, data);
});
```

If the tierlists table has more NOT NULL columns without defaults than this `INSERT` names, add them with neutral values. Check with `sqlite3`-free inspection of `tierlists/adapters/sqlite/schema.sql`, and don't change the assertions.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run build --workspace @scripta/shared && npm test --workspace backend`
Expected: FAIL. `rekeyBlocks.js` can't be found, and `rekeyBooks is not a function`.

- [ ] **Step 3: Implement**

`backend/src/modules/murals/domain/rekeyBlocks.ts`:

```ts
import { rekeyKeys, rekeyTierBoard } from "@scripta/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rekeyQuotes(quotes: unknown[], from: ReadonlySet<string>, to: string): unknown[] {
  const seen = new Set<string>();
  return quotes.flatMap((quote) => {
    if (!isRecord(quote)) return [quote];
    const next = typeof quote.bookKey === "string" && from.has(quote.bookKey) ? { ...quote, bookKey: to } : quote;
    const id = `${String(next.bookKey)}\u0000${String(next.highlightId)}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [next];
  });
}

export function rekeyBlocks(blocks: unknown, from: ReadonlySet<string>, to: string): unknown {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((block) => {
    if (!isRecord(block)) return block;
    let next: Record<string, unknown> = block;
    if (typeof next.bookKey === "string" && from.has(next.bookKey)) next = { ...next, bookKey: to };
    if (Array.isArray(next.bookKeys)) next = { ...next, bookKeys: rekeyKeys(next.bookKeys as string[], from, to) };
    if (Array.isArray(next.quotes)) next = { ...next, quotes: rekeyQuotes(next.quotes, from, to) };
    if (Array.isArray(next.tiers) || Array.isArray(next.pool)) next = rekeyTierBoard(next, from, to);
    return next;
  });
}
```

Add to the object returned by `createSqliteMuralsRepository`:

```ts
    rekeyBooks(userId, fromKeys, toKey) {
      const from = new Set(fromKeys);
      const now = new Date().toISOString();
      const update = db.prepare("UPDATE murals SET blocks = ?, updated_at = ? WHERE id = ?");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of db.prepare("SELECT id, blocks FROM murals WHERE user_id = ?").all(userId) as Array<{ id: string; blocks: string }>) {
          const before = JSON.stringify(JSON.parse(row.blocks));
          const after = JSON.stringify(rekeyBlocks(JSON.parse(row.blocks), from, toKey));
          if (after !== before) update.run(after, now, row.id);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
```

(import `rekeyBlocks` from `../../domain/rekeyBlocks.js`).

Add to the object returned by `createSqliteTierlistsRepository` (import `rekeyTierBoard` from `@scripta/shared`):

```ts
    rekeyBooks(userId, fromKeys, toKey) {
      const from = new Set(fromKeys);
      const now = new Date().toISOString();
      const update = db.prepare("UPDATE tierlists SET data = ?, updated_at = ? WHERE id = ?");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of db.prepare("SELECT id, data FROM tierlists WHERE owner_user_id = ? AND vote_code IS NULL").all(userId) as Array<{ id: string; data: string }>) {
          const parsed = JSON.parse(row.data) as Record<string, unknown>;
          const after = JSON.stringify(rekeyTierBoard(parsed, from, toKey));
          if (after !== JSON.stringify(parsed)) update.run(after, now, row.id);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
```

In `murals/plugin.ts`, next to `deleteMuralsUserData`:

```ts
let rekeyingMurals: ReturnType<typeof createSqliteMuralsRepository> | undefined;

export function rekeyMuralsBooks(userId: string, fromKeys: string[], toKey: string) {
  (rekeyingMurals ??= createSqliteMuralsRepository(openMuralsDb())).rekeyBooks(userId, fromKeys, toKey);
}
```

Add `rekeyMuralsBooks` to the `plugin.js` export line in `murals/index.ts`. Do the same for tierlists: `rekeyTierlistsBooks`, `rekeyingTierlists`, `createSqliteTierlistsRepository(openTierlistsDb())`.

Add `rekeyBooks() {}` to the fake repo in `murals/service.test.ts`, and to any other fake that `npm run typecheck --workspace backend` flags.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src/modules/murals backend/src/modules/tierlists backend/package.json && /usr/bin/git commit -m "Rewrite merged book keys in murals and draft tier lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Backend reference rewrites — arena and quizzes

**Files:**
- Modify:
  - `backend/src/modules/arena/domain/ports.ts`, `adapters/sqlite/sqliteArenaRepository.ts`, `adapters/sqlite/sqliteArenaRepository.test.ts`, `plugin.ts`, `index.ts`
  - `backend/src/modules/quizzes/domain/ports.ts` (or wherever `QuizzesRepository` is declared), `adapters/sqlite/sqliteQuizzesRepository.ts`, `adapters/sqlite/sqliteQuizzesRepository.test.ts`, `plugin.ts`, `index.ts`
  - Fakes flagged by typecheck: add `rekeyBooks() {}`

**Interfaces:**
- Produces:
  - `ArenaRepository.rekeyBooks` and `QuizzesRepository.rekeyBooks`: `(userId: string, fromKeys: string[], toKey: string) => void`
  - `export function rekeyArenaBooks(userId: string, fromKeys: string[], toKey: string): void`
  - `export function rekeyQuizzesBooks(userId: string, fromKeys: string[], toKey: string): void`

- [ ] **Step 1: Write the failing tests**

Append to `sqliteArenaRepository.test.ts`. It uses the existing `freshDb()`; import `createSqliteArenaRepository` if needed.

```ts
test("rekeyBooks rewrites seeding slots only and drops a slot that would duplicate the survivor", () => {
  const db = freshDb();
  const tournament = db.prepare("INSERT INTO tournaments (id, owner_user_id, name, bracket_size, round_duration_minutes, status) VALUES (?, ?, 'n', 8, 60, ?)");
  tournament.run("seeding", "u1", "seeding");
  tournament.run("both", "u1", "seeding");
  tournament.run("active", "u1", "active");
  const slot = db.prepare("INSERT INTO tournament_slots (tournament_id, slot_index, book_key, title, author) VALUES (?, ?, ?, 't', 'a')");
  slot.run("seeding", 0, "old");
  slot.run("both", 0, "new");
  slot.run("both", 1, "old");
  slot.run("active", 0, "old");
  createSqliteArenaRepository(db).rekeyBooks("u1", ["old"], "new");
  const keys = (id: string) => (db.prepare("SELECT book_key FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id) as Array<{ book_key: string }>).map((row) => row.book_key);
  assert.deepEqual(keys("seeding"), ["new"]);
  assert.deepEqual(keys("both"), ["new"]);
  assert.deepEqual(keys("active"), ["old"]);
});
```

Append to `sqliteQuizzesRepository.test.ts`. `makeRepo()` hides the db, so this test builds its own:

```ts
test("rekeyBooks rewrites the owner's unpublished quiz books and de-duplicates by key", () => {
  const db = new DatabaseSync(":memory:");
  applyQuizzesMigrations(db);
  const insert = db.prepare("INSERT INTO quizzes (id, owner_user_id, name, data, vote_code, updated_at) VALUES (?, ?, 'q', ?, ?, 't0')");
  const data = JSON.stringify({ sourceLabel: "", questionCount: 5, allowedTypes: [], books: [{ key: "new", title: "Dune" }, { key: "old", title: "Dune" }, { key: "x", title: "X" }], questions: null });
  insert.run("draft", "u1", data, null);
  insert.run("published", "u1", data, "CODE1");
  createSqliteQuizzesRepository(db).rekeyBooks("u1", ["old"], "new");
  const read = (id: string) => db.prepare("SELECT data, updated_at FROM quizzes WHERE id = ?").get(id) as { data: string; updated_at: string };
  assert.deepEqual(JSON.parse(read("draft").data).books, [{ key: "new", title: "Dune" }, { key: "x", title: "X" }]);
  assert.notEqual(read("draft").updated_at, "t0");
  assert.equal(read("published").data, data);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test --workspace backend`
Expected: FAIL. `rekeyBooks is not a function`.

- [ ] **Step 3: Implement**

Arena repository:

```ts
    rekeyBooks(userId, fromKeys, toKey) {
      const from = new Set(fromKeys);
      const remove = db.prepare("DELETE FROM tournament_slots WHERE tournament_id = ? AND slot_index = ?");
      const rename = db.prepare("UPDATE tournament_slots SET book_key = ? WHERE tournament_id = ? AND slot_index = ?");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const { id } of db.prepare("SELECT id FROM tournaments WHERE owner_user_id = ? AND status = 'seeding'").all(userId) as Array<{ id: string }>) {
          const slots = db.prepare("SELECT slot_index, book_key FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index ASC").all(id) as Array<{ slot_index: number; book_key: string }>;
          let hasTarget = slots.some((slot) => slot.book_key === toKey);
          for (const slot of slots) {
            if (!from.has(slot.book_key)) continue;
            if (hasTarget) remove.run(id, slot.slot_index);
            else {
              rename.run(toKey, id, slot.slot_index);
              hasTarget = true;
            }
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
```

Quizzes repository:

```ts
    rekeyBooks(userId, fromKeys, toKey) {
      const from = new Set(fromKeys);
      const now = new Date().toISOString();
      const update = db.prepare("UPDATE quizzes SET data = ?, updated_at = ? WHERE id = ?");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of db.prepare("SELECT id, data FROM quizzes WHERE owner_user_id = ? AND vote_code IS NULL").all(userId) as Array<{ id: string; data: string }>) {
          const parsed = JSON.parse(row.data) as Record<string, unknown>;
          if (!Array.isArray(parsed.books)) continue;
          const seen = new Set<string>();
          const books = parsed.books.flatMap((book: unknown) => {
            if (typeof book !== "object" || book === null || typeof (book as { key?: unknown }).key !== "string") return [book];
            const key = from.has((book as { key: string }).key) ? toKey : (book as { key: string }).key;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{ ...book, key }];
          });
          const after = JSON.stringify({ ...parsed, books });
          if (after !== JSON.stringify(parsed)) update.run(after, now, row.id);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
```

Exports: `rekeyArenaBooks` in `arena/plugin.ts`, using `rekeyingArena ??= createSqliteArenaRepository(openArenaDb())`. `rekeyQuizzesBooks` in `quizzes/plugin.ts`, using `rekeyingQuizzes ??= createSqliteQuizzesRepository(openQuizzesDb())`. Add both to each module's `index.ts` export line. Add both port declarations, plus `rekeyBooks() {}` in the flagged fakes.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src/modules/arena backend/src/modules/quizzes && /usr/bin/git commit -m "Rewrite merged book keys in seeding brackets and draft quizzes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Library merge endpoint, add-book rule, wiring

**Files:**
- Modify:
  - `backend/src/modules/library/service.ts`
    - `RekeyBooks` type and a 5th constructor param
    - `mergeBooks`
    - `addBook` switches to the certain rule
  - `backend/src/modules/library/routes.ts` (`POST /library/books/merge`)
  - `backend/src/modules/library/plugin.ts` (`LibraryPluginOptions.rekeyBooks`)
  - `backend/src/modules/library/index.ts` (export type `RekeyBooks`)
  - `backend/src/app.ts` (wire all four rekey functions)
  - `backend/src/modules/library/service.test.ts`

**Interfaces:**
- Consumes:
  - `mergeDuplicateBooks`, `isCertainMatch`, `bookKey` (shared)
  - `rekeyMuralsBooks`, `rekeyTierlistsBooks`, `rekeyArenaBooks`, `rekeyQuizzesBooks` (Tasks 5–6)
- Produces:
  - `export type RekeyBooks = (userId: string, fromKeys: string[], toKey: string) => void`
  - `LibraryService.mergeBooks(userId: string, keep: string, merge: string[], expectedUpdatedAt: string): LibraryDocument`
  - `POST /library/books/merge`, body `{ keep: string; merge: string[]; updatedAt: string }`. Responses: 200 `LibraryDocument`, 400, 404, 409 `{ error, current }`.

- [ ] **Step 1: Write the failing tests** (append to `library/service.test.ts`)

```ts
function setupMerge() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE library_documents (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    share_token TEXT UNIQUE
  )`);
  const rekeys: Array<[string, string[], string]> = [];
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", undefined, undefined, (userId, fromKeys, toKey) => {
    rekeys.push([userId, fromKeys, toKey]);
  });
  return { service, rekeys };
}

const koboDune = { ContentID: "k1", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1 };
const goodreadsDune = { ContentID: "g1", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 };

test("mergeBooks rewrites references, then saves the merged library", () => {
  const { service, rekeys } = setupMerge();
  const saved = service.saveLibrary("u1", { books: [koboDune, goodreadsDune], groups: [{ id: "g", type: "collection", name: "c", bookKeys: [bookKey(goodreadsDune)], createdAt: "t", updatedAt: "t" }] });
  const merged = service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], saved.updatedAt);
  assert.deepEqual(rekeys, [["u1", [bookKey(goodreadsDune)], bookKey(koboDune)]]);
  const data = merged.data as { books: Array<Record<string, unknown>>; groups: Array<{ bookKeys: string[] }> };
  assert.equal(data.books.length, 1);
  assert.equal(data.books[0]!.ReadStatus, 2);
  assert.deepEqual(data.groups[0]!.bookKeys, [bookKey(koboDune)]);
});

test("mergeBooks with a stale updatedAt throws a conflict before touching any reference", () => {
  const { service, rekeys } = setupMerge();
  service.saveLibrary("u1", { books: [koboDune, goodreadsDune] });
  assert.throws(() => service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], "2000-01-01T00:00:00.000Z"), LibraryConflictError);
  assert.deepEqual(rekeys, []);
});

test("mergeBooks is a no-op when the keys are already gone", () => {
  const { service, rekeys } = setupMerge();
  const saved = service.saveLibrary("u1", { books: [koboDune] });
  const again = service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], saved.updatedAt);
  assert.equal(again.updatedAt, saved.updatedAt);
  assert.deepEqual(rekeys, []);
});

test("mergeBooks without a library throws NoLibraryDocumentError", async () => {
  const { NoLibraryDocumentError } = await import("./domain/errors.js");
  const { service } = setupMerge();
  assert.throws(() => service.mergeBooks("nobody", "a", ["b"], "2000-01-01T00:00:00.000Z"), NoLibraryDocumentError);
});

test("mergeBooks does not save the library when a reference rewrite fails", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE library_documents (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, share_token TEXT UNIQUE)`);
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", undefined, undefined, () => {
    throw new Error("murals db locked");
  });
  const saved = service.saveLibrary("u1", { books: [koboDune, goodreadsDune] });
  assert.throws(() => service.mergeBooks("u1", bookKey(koboDune), [bookKey(goodreadsDune)], saved.updatedAt), /murals db locked/);
  assert.equal((service.getLibrary("u1")!.data as { books: unknown[] }).books.length, 2);
});

test("addBook matches an ISBN-less copy by title and author", () => {
  const { service } = setup();
  service.saveLibrary("u1", { books: [koboDune] });
  const result = service.addBook("u1", { title: "Dune", author: "Frank Herbert", isbn: "9780441013593", readStatus: 2 });
  assert.equal(result.updated, true);
  assert.equal(booksOf(service, "u1").length, 1);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run build --workspace @scripta/shared && npm test --workspace backend`
Expected: FAIL. `service.mergeBooks is not a function`, and the `addBook` test appends a second book.

- [ ] **Step 3: Implement**

`service.ts`:
- import `bookKey`, `isCertainMatch`, `mergeDuplicateBooks` and `type LibraryData` from `@scripta/shared`
- add `export type RekeyBooks = (userId: string, fromKeys: string[], toKey: string) => void;`
- change the signature to `createLibraryService(repo, publicUrlFor, emitBookEvents?, enqueueCovers?, rekeyBooks?: RekeyBooks)`
- add `mergeBooks(userId: string, keep: string, merge: string[], expectedUpdatedAt: string): LibraryDocument;` to the `LibraryService` interface
- implement:

```ts
    mergeBooks(userId, keep, merge, expectedUpdatedAt) {
      const row = repo.getDocument(userId);
      if (!row) throw new NoLibraryDocumentError();
      if (row.updated_at !== expectedUpdatedAt) throw new LibraryConflictError();
      const parsed: unknown = JSON.parse(row.data);
      if (!isRecord(parsed) || !Array.isArray(parsed.books)) throw new Error("Stored library document is unreadable; refusing to rewrite it.");
      const library = parsed as LibraryData;
      const next = mergeDuplicateBooks(library, keep, merge);
      if (next === library) return toLibraryDocument(row, publicUrlFor);
      const present = new Set(library.books.filter(isRecord).map(bookKey));
      const fromKeys = merge.filter((key) => key !== keep && present.has(key));
      if (fromKeys.length > 0 && rekeyBooks) rekeyBooks(userId, fromKeys, keep);
      const saved = repo.upsertDocument(userId, JSON.stringify(next), row.updated_at);
      if (!saved) throw new LibraryConflictError();
      return toLibraryDocument(saved, publicUrlFor);
    },
```

In `addBook`, replace the `norm`/`needle`/`match` block with:

```ts
      const incoming = { Title: input.title, Attribution: input.author, ISBN: input.isbn ?? "" };
      const match = books.find((b): b is Record<string, unknown> => isRecord(b) && isCertainMatch(b, incoming));
```

Also update the `addBook` doc comment on `LibraryService`, which describes the old matching, to say it matches with the shared certain rule. If an existing `addBook` test now fails, stop and report the test name and why. Don't edit its assertion.

`routes.ts`, inside `buildLibraryRoutes` after `POST /library/books` (import `NoLibraryDocumentError` if it isn't already):

```ts
    const mergeBooksSchema = z.object({
      keep: z.string().min(1),
      merge: z.array(z.string().min(1)).max(50),
      updatedAt: z.string().datetime()
    });

    app.post("/library/books/merge", { preHandler: authGuard }, async (request, reply) => {
      const parsed = mergeBooksSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Expected { keep, merge: [...], updatedAt }." });
      }
      try {
        return reply.send(service.mergeBooks(request.user.id, parsed.data.keep, parsed.data.merge, parsed.data.updatedAt));
      } catch (error) {
        if (error instanceof NoLibraryDocumentError) return reply.code(404).send({ error: "No library saved yet." });
        if (error instanceof LibraryConflictError) {
          return reply.code(409).send({ error: error.message, current: service.getLibrary(request.user.id) });
        }
        throw error;
      }
    });
```

Declare `mergeBooksSchema` at module level next to `addBookSchema`, not inside the function.

`plugin.ts`: add `rekeyBooks: RekeyBooks;` (required) to `LibraryPluginOptions`, change the signature to `libraryPlugin(app: FastifyInstance, opts: LibraryPluginOptions)`, and pass `opts.rekeyBooks` as the 5th argument. `index.ts`: add `RekeyBooks` to the exported types.

`app.ts`: import the four `rekey*Books` functions from their module indexes and add to the `registerLibraryModule` options:

```ts
    rekeyBooks: (userId: string, fromKeys: string[], toKey: string) => {
      for (const rekey of [rekeyMuralsBooks, rekeyTierlistsBooks, rekeyArenaBooks, rekeyQuizzesBooks]) rekey(userId, fromKeys, toKey);
    },
```

No try/catch here: a failed rewrite must reach the error handler as a 500 so the library isn't saved.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src && /usr/bin/git commit -m "Add POST /library/books/merge and match added books on the certain rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Catalog title alias

**Files:**
- Modify:
  - `backend/src/modules/books/domain/normalize.ts`: import and re-export `normalizeWords`/`normalizeTitle` from `@scripta/shared` instead of defining them; add `catalogTitleKey`, `titleKey` on `BookIdentity`, and `findByIdentity`
  - `backend/src/modules/books/domain/normalize.test.ts`: update the `lookupIdentity` expectations and add alias tests
  - `backend/src/modules/books/domain/ports.ts`: `createBook(input, keys: string[], createdAt)` and `addKey(key: string, bookId: string): void`
  - `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
  - `backend/src/modules/books/adapters/sqlite/connection.ts`: `backfillTitleKeys`, called from `applyBooksMigrations`
  - `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
  - `backend/src/modules/books/booksService.ts`: `findOrCreate`, `saveHits`, `rejectCover`
  - `backend/src/modules/books/publicCoverLookup.ts`
  - `backend/src/modules/books/booksService.test.ts`: fakes and expectations the typecheck flags

**Interfaces:**
- Consumes: `normalizeWords`, `normalizeTitle`, `firstAuthor`, `titleNumbers` (Task 1).
- Produces:
  - `catalogTitleKey(title: string, author: string): string | null`
  - `interface BookIdentity { key: string; titleKey: string | null; isbn: string | null; title: string; author: string }`
  - `findByIdentity(repo: Pick<BooksRepository, "findBookByKey">, identity: BookIdentity): BookRow | undefined`

- [ ] **Step 1: Write the failing tests**

In `normalize.test.ts`, replace the `lookupIdentity` test's expected objects with:

```ts
  assert.deepEqual(lookupIdentity({ isbn: "978-0-14-118427-2", title: "Orlando", author: "Virginia Woolf" }), {
    key: "isbn:9780141184272",
    titleKey: "ta:orlando|virginia woolf|",
    isbn: "9780141184272",
    title: "Orlando",
    author: "Virginia Woolf"
  });
  assert.deepEqual(lookupIdentity({ isbn: "urn:uuid:ac11a7ae-d21e-42bb-8cfe-b85022867ac4", title: " The Stranger ", author: "Albert Camus" }), {
    key: "ta:the stranger|albert camus|",
    titleKey: "ta:the stranger|albert camus|",
    isbn: null,
    title: "The Stranger",
    author: "Albert Camus"
  });
```

Keep any further assertions in that test and update them the same way. Then add:

```ts
test("catalogTitleKey ignores series brackets and later authors but keeps volume numbers", () => {
  assert.equal(catalogTitleKey("Dune (Dune Chronicles #1)", "Frank Herbert, Brian Herbert"), catalogTitleKey("Dune", "Frank Herbert"));
  assert.notEqual(catalogTitleKey("Complete Works: Volume 1", "A Poet"), catalogTitleKey("Complete Works: Volume 2", "A Poet"));
  assert.equal(catalogTitleKey("", "Anyone"), null);
});
```

In `sqliteBooksRepository.test.ts`, which already has `freshRepo()` returning `{ db, repo }`, add:

```ts
test("createBook registers every key and addKey aliases an existing book", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593", "ta:dune|frank herbert|"], "2026-09-30T00:00:00.000Z");
  assert.equal(repo.findBookByKey("ta:dune|frank herbert|")?.id, book.id);
  repo.addKey("isbn:9780593099322", book.id);
  repo.addKey("isbn:9780593099322", "someone-else");
  assert.equal(repo.findBookByKey("isbn:9780593099322")?.id, book.id);
});

test("backfill adds a title key to existing rows once", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.prepare("INSERT INTO books (id, title, author, genres, created_at) VALUES ('b1', 'Orlando', 'Virginia Woolf', '[]', 't')").run();
  db.exec("PRAGMA user_version = 0");
  applyBooksMigrations(db);
  assert.equal((db.prepare("SELECT book_id FROM book_keys WHERE key = 'ta:orlando|virginia woolf|'").get() as { book_id: string }).book_id, "b1");
});
```

In `booksService.test.ts`, add the test below. It uses the file's `harness()`; if `harness()` doesn't already return `repo`, add `repo` to its returned object.

```ts
test("an edition's ISBN resolves through the title alias to the existing catalog book", () => {
  const { service, repo } = harness();
  service.resolveCover({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  const first = repo.findBookByKey("isbn:9780441013593")!;
  service.resolveCover({ isbn: "9780593099322", title: "Dune: Deluxe Edition", author: "Frank Herbert" });
  assert.equal(repo.findBookByKey("isbn:9780593099322")?.id, first.id);
  service.resolveCover({ title: "Complete Works: Volume 1", author: "A Poet" });
  service.resolveCover({ title: "Complete Works: Volume 2", author: "A Poet" });
  assert.notEqual(repo.findBookByKey("ta:complete works|a poet|1")?.id, repo.findBookByKey("ta:complete works|a poet|2")?.id);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test --workspace backend`
Expected: FAIL. `catalogTitleKey` isn't exported, and `addKey` isn't a function.

- [ ] **Step 3: Implement**

`normalize.ts`:

```ts
import { firstAuthor, normalizeIsbn, normalizeTitle, normalizeWords, titleNumbers } from "@scripta/shared";
import type { BooksRepository } from "./ports.js";
import type { BookRow } from "./types.js";

export { normalizeTitle, normalizeWords } from "@scripta/shared";

export interface BookIdentity {
  key: string;
  titleKey: string | null;
  isbn: string | null;
  title: string;
  author: string;
}

export function catalogTitleKey(title: string, author: string): string | null {
  const main = normalizeTitle(title);
  return main ? `ta:${main}|${firstAuthor(author)}|${titleNumbers(title)}` : null;
}

export function lookupIdentity(lookup: BookLookup): BookIdentity | null {
  const isbn = normalizeIsbn(lookup.isbn ?? "") || null;
  const title = (lookup.title ?? "").trim();
  const author = (lookup.author ?? "").trim();
  const titleKey = catalogTitleKey(title, author);
  if (isbn) return { key: `isbn:${isbn}`, titleKey, isbn, title, author };
  return titleKey ? { key: titleKey, titleKey, isbn: null, title, author } : null;
}

export function findByIdentity(repo: Pick<BooksRepository, "findBookByKey">, identity: BookIdentity): BookRow | undefined {
  return repo.findBookByKey(identity.key) ?? (identity.titleKey && identity.titleKey !== identity.key ? repo.findBookByKey(identity.titleKey) : undefined);
}
```

`titleMatches`, `authorMatches` and `searchTokens` stay, using the imported `normalizeWords`/`normalizeTitle`. Delete the local definitions of those two. If `ports.ts` imports from `normalize.ts`, move `findByIdentity` into `booksService.ts` as a local function instead, to avoid an import cycle.

Repository:
- `const insertKeyIfMissingStmt = db.prepare("INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)")`
- `addKey: (key, bookId) => { insertKeyIfMissingStmt.run(key, bookId); }`
- in `createBook(input, keys, createdAt)`:
  - `const existing = keys.map((key) => byKeyStmt.get(key) as BookRow | undefined).find(Boolean); if (existing) return existing;`
  - inside the transaction: `insertKeyStmt.run(keys[0], id); for (const key of keys.slice(1)) insertKeyIfMissingStmt.run(key, id);`

`connection.ts`: restructure `applyBooksMigrations` so the legacy branch no longer returns before the backfill (wrap the legacy work in `if (legacy) { ... }`), then call `backfillTitleKeys(db)` last. First run `grep -rn user_version backend/src/modules/books`: if the books DB already uses `user_version`, use the next free number instead of 1.

```ts
function backfillTitleKeys(db: DatabaseSync): void {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version >= 1) return;
  const rows = db.prepare("SELECT id, title, author FROM books WHERE title != '' ORDER BY created_at ASC").all() as Array<{ id: string; title: string; author: string }>;
  const insertKey = db.prepare("INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)");
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const key = catalogTitleKey(row.title, row.author);
      if (key) insertKey.run(key, row.id);
    }
    db.exec("PRAGMA user_version = 1");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
```

`booksService.ts`:

```ts
  function keysOf(identity: BookIdentity): string[] {
    return identity.titleKey && identity.titleKey !== identity.key ? [identity.key, identity.titleKey] : [identity.key];
  }

  function findExisting(identity: BookIdentity): BookRow | undefined {
    const direct = deps.repo.findBookByKey(identity.key);
    if (direct) return direct;
    const byTitle = findByIdentity(deps.repo, identity);
    if (byTitle) deps.repo.addKey(identity.key, byTitle.id);
    return byTitle;
  }
```

- `findOrCreate`: use `findExisting(identity)` and `createBook(..., keysOf(identity), ...)`. In the `fillIdentity` branch, also call `if (identity.titleKey) deps.repo.addKey(identity.titleKey, existing.id);`.
- `saveHits`: `findExisting(identity) ?? deps.repo.createBook({...}, keysOf(identity), now().toISOString())`.
- `rejectCover`: `identity ? findByIdentity(deps.repo, identity) : undefined`.
- `publicCoverLookup.ts`: `findByIdentity(repo, identity)?.cover_image_id`.

Import `type BookIdentity` and `findByIdentity` from `./domain/normalize.js`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add backend/src/modules/books && /usr/bin/git commit -m "Alias catalog books by title so editions and ISBN-less copies share one entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Web — auto-merge and review sheet

**Files:**
- Modify: `frontend/src/api/library.ts` (add `mergeLibraryBooks`)
- Create: `frontend/src/hooks/useDuplicateMerge.ts`
- Modify: `frontend/src/layouts/DashboardLayout.tsx` (call the hook next to `useGenreEnrichment`)
- Create: `frontend/src/components/DuplicatesSheet.tsx`
- Modify: `frontend/src/pages/LibraryPage.tsx` (banner + sheet)

**Interfaces:**
- Consumes: `mergeCertainDuplicates`, `findDuplicates`, `markDistinct`, `bookKey`, `statusLabel` (shared); `POST /library/books/merge` (Task 7).
- Produces: `mergeLibraryBooks(keep: string, merge: string[], updatedAt: string): Promise<LibraryDocument>`

There's no component test harness on the web (`npm test` runs the style scripts only). The logic is covered by Tasks 3–4. This task is verified by typecheck, lint, the existing tests, and the manual check in Step 4.

- [ ] **Step 1: API + hook**

Append to `frontend/src/api/library.ts`:

```ts
export async function mergeLibraryBooks(keep: string, merge: string[], updatedAt: string): Promise<LibraryDocument> {
  return (await apiFetch("/library/books/merge", { method: "POST", body: JSON.stringify({ keep, merge, updatedAt }) })) as LibraryDocument;
}
```

`frontend/src/hooks/useDuplicateMerge.ts`:

```ts
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { mergeCertainDuplicates } from "@scripta/shared";
import { ApiError } from "../api/client";
import { fetchLibrary, mergeLibraryBooks, type LibraryDocument } from "../api/library";

export function useDuplicateMerge(library: LibraryDocument | null | undefined) {
  const queryClient = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (!library || ran.current) return;
    ran.current = true;
    void mergeCertainDuplicates(library, mergeLibraryBooks, fetchLibrary, (error) => error instanceof ApiError && error.status === 409)
      .then((merged) => {
        if (merged !== library) queryClient.setQueryData(["library"], merged);
      })
      .catch((error: unknown) => {
        console.error(error);
        void queryClient.invalidateQueries({ queryKey: ["library"] });
      });
  }, [library, queryClient]);
}
```

In `DashboardLayout.tsx`, below `useGenreEnrichment(...)`, add `useDuplicateMerge(library);` and import the hook.

- [ ] **Step 2: Sheet** — `frontend/src/components/DuplicatesSheet.tsx`

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bookKey, markDistinct, statusLabel } from "@scripta/shared";
import { mergeLibraryBooks, type LibraryDocument } from "../api/library";
import { useLibrary } from "../hooks/useLibrary";
import { CoverImage } from "./BookCard";
import { Sheet } from "./Sheet";
import { useToast } from "./Toaster";

export function DuplicatesSheet({ groups, library, onClose }: { groups: string[][]; library: LibraryDocument; onClose: () => void }) {
  const { updateLibrary } = useLibrary();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const byKey = new Map(library.data.books.map((book) => [bookKey(book), book] as const));

  async function run(action: () => Promise<unknown>, failure: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch {
      toast({ message: failure, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  const merge = (group: string[]) =>
    run(async () => {
      const current = queryClient.getQueryData<LibraryDocument | null>(["library"]) ?? library;
      queryClient.setQueryData(["library"], await mergeLibraryBooks(group[0]!, group.slice(1), current.updatedAt));
    }, "Couldn't merge these books.");

  const keepApart = (group: string[]) => run(() => updateLibrary((data) => markDistinct(data, group)), "Couldn't save that.");

  return (
    <Sheet title="Possible duplicates" onClose={onClose}>
      <ul className="flex flex-col gap-4 px-3 pb-4">
        {groups.map((group) => (
          <li key={group.join("|")} className="flex flex-col gap-3 rounded-lg border border-(--color-border) p-3">
            {group.map((key) => {
              const book = byKey.get(key);
              if (!book) return null;
              return (
                <div key={key} className="flex items-center gap-3">
                  <div className="aspect-[2/3] w-12 shrink-0 overflow-hidden rounded bg-(--color-border)">
                    <CoverImage book={book} />
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-semibold">{String(book.Title ?? "Untitled")}</p>
                    <p className="truncate text-(--color-text-dim)">{String(book.Attribution ?? "")}</p>
                    <p className="text-xs text-(--color-text-dim)">{[book.ISBN ? `ISBN ${String(book.ISBN)}` : null, statusLabel(book.ReadStatus)].filter(Boolean).join(" · ")}</p>
                  </div>
                </div>
              );
            })}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void merge(group)} className="min-h-11 flex-1 rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-(--color-on-accent) disabled:opacity-50">
                Merge
              </button>
              <button type="button" disabled={busy} onClick={() => void keepApart(group)} className="min-h-11 flex-1 rounded-lg border border-(--color-border) px-3 py-2 text-sm font-semibold hover:bg-(--color-surface-hover) disabled:opacity-50">
                Not the same
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
```

- [ ] **Step 3: Banner in `LibraryPage.tsx`**
  - Import `findDuplicates` from `@scripta/shared` and `DuplicatesSheet`.
  - Add state next to the other modal state: `const [reviewingDuplicates, setReviewingDuplicates] = useState(false);`.
  - Add the memo after the `useLibrary()` line: `const likelyDuplicates = useMemo(() => (library ? findDuplicates(library.data).likely : []), [library]);`.
  - Immediately before the `{books.length > 0 && displayBooks.length > 0 && (` block that renders `<DndContext`, insert:

```tsx
      {likelyDuplicates.length > 0 && (
        <button
          type="button"
          onClick={() => setReviewingDuplicates(true)}
          className="mb-3 flex min-h-11 w-full items-center justify-between rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
        >
          <span>{likelyDuplicates.length === 1 ? "1 possible duplicate" : `${likelyDuplicates.length} possible duplicates`}</span>
          <span className="font-semibold">Review</span>
        </button>
      )}
```

  - Next to `{addingBook && <AddBookModal ... />}` add:

```tsx
      {reviewingDuplicates && library && likelyDuplicates.length > 0 && (
        <DuplicatesSheet groups={likelyDuplicates} library={library} onClose={() => setReviewingDuplicates(false)} />
      )}
```

- [ ] **Step 4: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS.

Manual check (read `docs/dev-workflow.md` before starting servers; claim a port slot):
1. Start the backend and frontend against a dev library that holds `Dune` (no ISBN), `Dune` (ISBN 9780441013593) and `Dune (Dune Chronicles #1)`.
2. On load, the first two merge into one book.
3. The banner shows "1 possible duplicate".
4. "Not the same" hides it for good.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add frontend/src && /usr/bin/git commit -m "Web: auto-merge certain duplicates and review likely ones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Mobile — auto-merge and review sheet

**Files:**
- Modify: `mobile/src/features/library/api/client.ts` (add `mergeLibraryBooks`)
- Create: `mobile/src/features/library/hooks/useDuplicateMerge.ts`
- Modify: `mobile/src/app/(app)/_layout.tsx` (call the hook after `useGenreEnrichment`)
- Create: `mobile/src/features/library/components/DuplicatesSheet.tsx`
- Modify: `mobile/src/features/library/LibraryScreen.tsx` (banner in `ListHeaderComponent`, plus a `Sheet`)

**Interfaces:**
- Consumes: the same shared functions as Task 9; `LIBRARY_QUERY_KEY`, `useLibrary` (mobile).
- Produces: mobile `mergeLibraryBooks(keep: string, merge: string[], updatedAt: string): Promise<LibraryDocument>`

- [ ] **Step 1: API + hook**

Append to `mobile/src/features/library/api/client.ts`:

```ts
export async function mergeLibraryBooks(keep: string, merge: string[], updatedAt: string): Promise<LibraryDocument> {
  return apiClient.request<LibraryDocument>("/library/books/merge", { method: "POST", auth: true, body: { keep, merge, updatedAt } });
}
```

`mobile/src/features/library/hooks/useDuplicateMerge.ts`:

```ts
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { mergeCertainDuplicates } from "@scripta/shared";
import { ApiError } from "../../../core/api";
import { fetchLibrary, mergeLibraryBooks } from "../api/client";
import type { LibraryDocument } from "../api/types";
import { LIBRARY_QUERY_KEY } from "./useLibrary";

export function useDuplicateMerge(library: LibraryDocument | null | undefined) {
  const queryClient = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (!library || ran.current) return;
    ran.current = true;
    void mergeCertainDuplicates(library, mergeLibraryBooks, fetchLibrary, (error) => error instanceof ApiError && error.status === 409)
      .then((merged) => {
        if (merged !== library) queryClient.setQueryData(LIBRARY_QUERY_KEY, merged);
      })
      .catch((error: unknown) => {
        console.error(error);
        void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY });
      });
  }, [library, queryClient]);
}
```

In `(app)/_layout.tsx`, below `useGenreEnrichment(...)`, add `useDuplicateMerge(library);` and import it.

- [ ] **Step 2: Sheet body** — `mobile/src/features/library/components/DuplicatesSheet.tsx`

```tsx
import { useState } from "react";
import { Alert, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { bookKey, markDistinct, statusLabel } from "@scripta/shared";
import { Text } from "../../../ui/Text";
import { Button } from "../../../ui/components";
import { spacing, typography, useTheme } from "../../../ui/theme";
import { mergeLibraryBooks } from "../api/client";
import type { LibraryDocument } from "../api/types";
import { LIBRARY_QUERY_KEY, useLibrary } from "../hooks/useLibrary";
import { CoverImage } from "./CoverImage";

export function DuplicatesSheetBody({ groups, library }: { groups: string[][]; library: LibraryDocument }) {
  const { colors } = useTheme();
  const { updateLibrary } = useLibrary();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const byKey = new Map(library.data.books.map((book) => [bookKey(book), book] as const));

  async function run(action: () => Promise<unknown>, failure: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch {
      Alert.alert(failure);
    } finally {
      setBusy(false);
    }
  }

  const merge = (group: string[]) =>
    run(async () => {
      const current = queryClient.getQueryData<LibraryDocument | null>(LIBRARY_QUERY_KEY) ?? library;
      queryClient.setQueryData(LIBRARY_QUERY_KEY, await mergeLibraryBooks(group[0]!, group.slice(1), current.updatedAt));
    }, "Couldn't merge these books.");

  const keepApart = (group: string[]) => run(() => updateLibrary((data) => markDistinct(data, group)), "Couldn't save that.");

  return (
    <View style={{ gap: spacing.lg }}>
      {groups.map((group) => (
        <View key={group.join("|")} style={{ gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.md }}>
          {group.map((key) => {
            const book = byKey.get(key);
            if (!book) return null;
            return (
              <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <View style={{ width: 48, aspectRatio: 2 / 3, overflow: "hidden", borderRadius: 6, backgroundColor: colors.border }}>
                  <CoverImage book={book} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[typography.body, { color: colors.text }]}>{String(book.Title ?? "Untitled")}</Text>
                  <Text numberOfLines={1} style={[typography.caption, { color: colors.textDim }]}>{String(book.Attribution ?? "")}</Text>
                  <Text style={[typography.caption, { color: colors.textDim }]}>{[book.ISBN ? `ISBN ${String(book.ISBN)}` : null, statusLabel(book.ReadStatus)].filter(Boolean).join(" · ")}</Text>
                </View>
              </View>
            );
          })}
          <Button label="Merge" disabled={busy} onPress={() => void merge(group)} />
          <Button label="Not the same" variant="secondary" disabled={busy} onPress={() => void keepApart(group)} />
        </View>
      ))}
    </View>
  );
}
```

If `typography.body`, `spacing.md` or the radius values don't exist in `mobile/src/ui/theme.tsx`, swap in the nearest existing token. `DESIGN.md` is the reference. Don't add new tokens.

- [ ] **Step 3: Banner in `LibraryScreen.tsx`**
  - Import `findDuplicates` from `@scripta/shared` and `DuplicatesSheetBody`.
  - Add `const [reviewingDuplicates, setReviewingDuplicates] = useState(false);`.
  - Add `const likelyDuplicates = useMemo(() => (library ? findDuplicates(library.data).likely : []), [library]);`, using whatever name the screen gives its library document.
  - Inside `ListHeaderComponent`'s `<View style={styles.shelfHead}>`, after the `shelfToolbar` view, add:

```tsx
                  {likelyDuplicates.length > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setReviewingDuplicates(true)}
                      style={({ pressed }) => [styles.sortPill, { borderColor: colors.border }, pressed ? { backgroundColor: colors.surfacePressed } : null]}
                    >
                      <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.text }]}>
                        {likelyDuplicates.length === 1 ? "1 possible duplicate · Review" : `${likelyDuplicates.length} possible duplicates · Review`}
                      </Text>
                    </Pressable>
                  ) : null}
```

  - Next to the existing `<Sheet visible={editingName} ...>`, add:

```tsx
      <Sheet visible={reviewingDuplicates && likelyDuplicates.length > 0} title="Possible duplicates" onClose={() => setReviewingDuplicates(false)}>
        {library ? <DuplicatesSheetBody groups={likelyDuplicates} library={library} /> : null}
      </Sheet>
```

- [ ] **Step 4: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS.

Optional device check: first run `node scripts/dev-status.mjs --json`. If another worktree holds the emulator, skip. Otherwise repeat the Task 9 manual check on the emulator.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add mobile/src && /usr/bin/git commit -m "Mobile: auto-merge certain duplicates and review likely ones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Deviations from the spec

- **Client tests:** the spec lists component tests for the clients, but neither client has a component test harness. The auto-merge loop and every rule behind the sheet live in `@scripta/shared` and are unit-tested there (Tasks 3–4). The UI tasks are verified by typecheck, lint and a manual check.
- **Identical `bookKey`s:** books sharing an identical key group only when they also match on content. Two untitled, ISBN-less books share `ta:|` and must stay apart (Review Focus 1).
- **Empty `merge`:** the merge endpoint accepts an empty `merge` list. `mergeDuplicateBooks` then collapses books that share `keep`'s key.
