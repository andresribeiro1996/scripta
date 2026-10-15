# Lossy Title Re-title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-title catalog books whose accented letters were lost to `©`, from a source tied to the same book, once for the backlog (an owner-run script) and automatically for new books (a background job).

**Architecture:** A pure rule in the books domain (`domain/lossy.ts`) decides whether a source's text may replace a lossy title or author name. Two callers gather candidates and write through the merged repair's `applyMojibakeRepairs`. One is an owner-run script for the books stored today: shop feeds first, then ISBNdb. The other is a background job for new books, which `createBook` marks when they arrive lossy. The publisher importer uses the same rule to keep a shop's title over a lossy Open Library edition title.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Node 24+ `node:sqlite`, `node:test` run through `tsx`, Fastify plugin wiring, `@scripta/shared` (`repairMojibake`, `canonicalIsbn`).

**Spec:** `docs/superpowers/specs/2026-10-15-lossy-retitle-design.md`. Read it before starting. This plan argues from it.

## Global Constraints

- Tests use synthetic strings only (`P©ssaro Azul`, `In©s Duarte`), never titles from the production catalog. The repo is public.
- No comments in code (root `AGENTS.md`).
- Reuse `@scripta/shared` (`repairMojibake`, `canonicalIsbn`) and the merged `applyMojibakeRepairs`; write no second copy of the derived-data writes.
- Catch only the failures the spec names: `SourcePausedError`, `SourceUnavailableError`, `SiteSkipped`. Everything else propagates.
- Every new `*.test.ts` goes into the explicit list in `backend/package.json`'s `test` script, or CI never runs it.
- `@scripta/shared` must be built before backend tests or typecheck read it: `npm run build --workspace @scripta/shared`.
- Run git from the worktree root. Stage and commit in one command (`git add … && git commit …`): concurrent sessions share the git index. Commit messages are one imperative sentence in the repo's style, ending with the Co-Authored-By trailer your session's instructions give.
- Production commands (`railway ssh`, deploys) are the owner's. No implementer runs them.
- The match rule (spec, "The match rule"), verbatim: `stored` is NFC and trimmed; `candidate` goes through `repairMojibake`, then NFC, then trim; same number of code points; at each `©` in `stored`, `candidate` has a `\p{L}` letter that isn't ASCII; every other position equal ignoring case; a candidate with no lowercase letter is refused when `stored` has one; the result is `candidate`.
- Lossy means `/\p{L}©\p{L}/u` on the stored title or author. "Still has a `©`" means the title or author contains `©` anywhere.

## Review Focus

The five inputs the spec implies but its own test list doesn't pin, most likely first. Each has a test in the task that owns the code.

1. **Two books with the same `publisher_url`:** both take the product's title. Task 5, "two books at one publisher_url both take the product's title".
2. **A book stored with a legacy ISBN-10:** the script and the job ask ISBNdb with the ISBN-13 `canonicalIsbn` gives. Task 5, "ISBNdb fixes the author the shop's feed couldn't, asked with the ISBN-13"; Task 7, "a book stored with an ISBN-10 is asked about by its ISBN-13".
3. **A `publisher_url` on a host that isn't in `PUBLISHERS`:** no feed is read, and ISBNdb is still asked. Task 5, "a book whose publisher_url is on no known shop goes straight to ISBNdb".
4. **A lossy author written last-first** (`Duarte, In©s`): the name is split on `, `, so a first-last candidate can't match and the author stays as stored. Task 1, "a lossy name written last-first stays when the candidates are first-last".
5. **A marked book edited while ISBNdb answers:** the conditional write skips it, the edit is kept, no "re-titled" line is logged, and the mark is cleared. Task 7, "a book edited while ISBNdb answers keeps the edit, logs no change and is unmarked".

## Setup (once per session)

- [ ] Work in the worktree at `/Users/andreribeiro/Documents/scripta/.claude/worktrees/sad-torvalds-d6e6d8` (branch `claude/sad-torvalds-d6e6d8`, which holds the spec and this plan).
- [ ] Link dependencies and build the shared package:

```bash
npm run dev:link-deps && npm run build --workspace @scripta/shared
```

- [ ] One test file runs with `npm exec --workspace backend -- tsx --test <path under backend/>`, for example `npm exec --workspace backend -- tsx --test src/modules/books/seed/mojibakeRepair.test.ts` (14 pass on the base commit).

## File map

| File | Task | Responsibility |
|---|---|---|
| `backend/src/modules/books/domain/lossy.ts` (new) | 1 | The match rule, lossy tests, and the repairs a re-title produces |
| `backend/src/modules/books/domain/types.ts` | 1, 3 | `LossyBook`; `BookRow.retitle_wanted_at` |
| `backend/src/modules/books/seed/siteFetch.ts` (new) | 2 | The importer's guarded `fetchText`/`fetchBytes`, shared by both scripts |
| `backend/scripts/import-publisher-covers.mjs` | 2 | Imports the moved helpers |
| `backend/src/modules/books/adapters/sqlite/books.sql`, `connection.ts`, `sqliteBooksRepository.ts`, `domain/ports.ts` | 3 | The `retitle_wanted_at` mark: column, index, set in `createBook`, listed and cleared |
| `backend/src/modules/books/seed/importPublisherCovers.ts` | 4 | Keeps the feed title over a lossy edition title |
| `backend/src/modules/books/seed/mojibakeRepair.ts` | 5 | `applyMojibakeRepairs` takes only `books` and `works` |
| `backend/src/modules/books/seed/lossyRetitle.ts` (new) | 5 | The backlog plan: targets, feeds, ISBNdb, report |
| `backend/scripts/retitle-lossy.mjs` (new) | 6 | The owner-run script |
| `backend/src/modules/books/retitleJob.ts` (new) | 7 | The background job over marked books |
| `backend/src/modules/books/plugin.ts` | 7 | Wires the job beside the work key lookup |
| `backend/package.json` | 1, 2, 5, 7 | The test list |
| `backend/README.md` | 4, 6, 7 | Importer note, "Lossy titles", the job's `books` bullet |

---

### Task 1: The match rule

**Files:**
- Create: `backend/src/modules/books/domain/lossy.ts`
- Create: `backend/src/modules/books/domain/lossy.test.ts`
- Modify: `backend/src/modules/books/domain/types.ts` (add `LossyBook` after `NewBook`)
- Modify: `backend/package.json` (test list)

**Interfaces:**
- Consumes: `repairMojibake`, `canonicalIsbn` from `@scripta/shared`.
- Produces (later tasks import these exact names from `./domain/lossy.js` or `../domain/lossy.js`):
  - `interface BookText { title: string; author: string }`
  - `interface RetitleCandidates { titles: string[]; authors: string[] }`
  - `isLossy(text: string): boolean`
  - `hasCopyrightSign(book: BookText): boolean`
  - `wantsRetitle(book: { title: string; author: string; isbn: string | null }): boolean`
  - `fillLossy(stored: string, candidate: string): string | null`
  - `retitle(book: BookText, candidates: RetitleCandidates): BookText | null`
  - `retitleRepairs(book: LossyBook, next: BookText, origin: string): { book: { id; title; author; repairedTitle; repairedAuthor; origin }; work: { id; title; author; repairedTitle; repairedAuthor } | null }`, structurally a `BookRepair` and a `RowRepair` from `seed/mojibakeRepair.ts`
  - `textOf(book: BookText): string`, which is `"<title> — <author>"`
  - In `domain/types.ts`: `interface LossyBook { id: string; title: string; author: string; isbn: string | null; work_id: string | null; work_title: string | null; work_author: string | null }`

- [ ] **Step 1: Add `LossyBook` to `backend/src/modules/books/domain/types.ts`**, directly after the `NewBook` interface:

```ts
export interface LossyBook {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  work_id: string | null;
  work_title: string | null;
  work_author: string | null;
}
```

- [ ] **Step 2: Write the failing test** `backend/src/modules/books/domain/lossy.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fillLossy, hasCopyrightSign, isLossy, retitle, retitleRepairs, textOf, wantsRetitle } from "./lossy.js";

test("a © takes one accented letter, and an ASCII letter in its place is refused", () => {
  assert.equal(fillLossy("P©ssaro Azul", "Pássaro Azul"), "Pássaro Azul");
  assert.equal(fillLossy("P©ssaro Azul", "Passaro Azul"), null);
});

test("two characters for one letter, or a different length, are refused", () => {
  assert.equal(fillLossy("V©Øo Alto", "Vôo Alto"), null);
  assert.equal(fillLossy("P©ssaro", "Pássaros"), null);
});

test("the other characters must match ignoring case, and the candidate's capitals are kept", () => {
  assert.equal(fillLossy("Hist©ria Do Mar", "História do Mar"), "História do Mar");
  assert.equal(fillLossy("Hist©ria Do Mar", "História de Mar"), null);
});

test("an all-caps candidate is refused for mixed-case text and accepted for all-caps text", () => {
  assert.equal(fillLossy("Hist©ria Do Mar", "HISTÓRIA DO MAR"), null);
  assert.equal(fillLossy("HIST©RIA DO MAR", "HISTÓRIA DO MAR"), "HISTÓRIA DO MAR");
});

test("a candidate is repaired, composed and trimmed before it is compared", () => {
  assert.equal(fillLossy("P©ssaro", "PÃ¡ssaro"), "Pássaro");
  assert.equal(fillLossy("P©ssaro", "Pássaro"), "Pássaro");
  assert.equal(fillLossy("  P©ssaro ", " Pássaro  "), "Pássaro");
});

test("a © at the start or the end of a word is filled too", () => {
  assert.equal(fillLossy("©gua Viva", "Água Viva"), "Água Viva");
  assert.equal(fillLossy("Mam© Azul", "Mamã Azul"), "Mamã Azul");
});

test("text without a ©, or with a real © sign, is never changed", () => {
  assert.equal(fillLossy("Livro Azul", "Livro Azul"), null);
  assert.equal(fillLossy("Livro Azul", "Lívro Azul"), null);
  assert.equal(fillLossy("Marca© Azul", "Marca© Azul"), null);
});

test("isLossy needs a © between two letters", () => {
  assert.equal(isLossy("P©ssaro"), true);
  assert.equal(isLossy("Mam© Azul"), false);
  assert.equal(isLossy("© 2010"), false);
});

test("hasCopyrightSign looks at the title and the author", () => {
  assert.equal(hasCopyrightSign({ title: "Mam© Azul", author: "Ana Lima" }), true);
  assert.equal(hasCopyrightSign({ title: "Livro", author: "In©s Duarte" }), true);
  assert.equal(hasCopyrightSign({ title: "Livro", author: "Ana Lima" }), false);
});

test("a new book wants a re-title when its title or author is lossy and its ISBN is valid", () => {
  assert.equal(wantsRetitle({ title: "P©ssaro", author: "Ana Lima", isbn: "9789720000101" }), true);
  assert.equal(wantsRetitle({ title: "Pássaro", author: "In©s Duarte", isbn: "972000000X" }), true);
  assert.equal(wantsRetitle({ title: "Pássaro", author: "Ana Lima", isbn: "9789720000101" }), false);
  assert.equal(wantsRetitle({ title: "P©ssaro", author: "Ana Lima", isbn: null }), false);
  assert.equal(wantsRetitle({ title: "P©ssaro", author: "Ana Lima", isbn: "not an isbn" }), false);
});

test("the title takes the first candidate the rule accepts", () => {
  assert.deepEqual(
    retitle({ title: "P©ssaro Azul", author: "Ana Lima" }, { titles: ["Outro Livro", "Pássaro Azul", "Pàssaro Azul"], authors: [] }),
    { title: "Pássaro Azul", author: "Ana Lima" }
  );
});

test("only the lossy author names change, whatever order the candidates come in", () => {
  const book = { title: "Livro Azul", author: "Ana Lima, In©s Duarte, J©lio Reis" };
  assert.deepEqual(retitle(book, { titles: [], authors: ["Júlio Reis", "Inês Duarte"] }), { title: "Livro Azul", author: "Ana Lima, Inês Duarte, Júlio Reis" });
  assert.deepEqual(retitle(book, { titles: [], authors: ["Inês Duarte"] }), { title: "Livro Azul", author: "Ana Lima, Inês Duarte, J©lio Reis" });
});

test("a lossy name written last-first stays when the candidates are first-last", () => {
  assert.equal(retitle({ title: "Livro Azul", author: "Duarte, In©s" }, { titles: [], authors: ["Inês Duarte"] }), null);
});

test("nothing the rule accepts gives null", () => {
  assert.equal(retitle({ title: "P©ssaro", author: "Ana Lima" }, { titles: ["Outro"], authors: ["Ana Lima"] }), null);
});

test("the repairs carry the old and new text, and the work only while it holds the book's old text", () => {
  const book = { id: "b1", title: "P©ssaro", author: "Ana Lima", isbn: "9789720000101", work_id: "w1", work_title: "P©ssaro", work_author: "Ana Lima" };
  const next = { title: "Pássaro", author: "Ana Lima" };
  assert.deepEqual(retitleRepairs(book, next, "isbndb"), {
    book: { id: "b1", title: "P©ssaro", author: "Ana Lima", repairedTitle: "Pássaro", repairedAuthor: "Ana Lima", origin: "isbndb" },
    work: { id: "w1", title: "P©ssaro", author: "Ana Lima", repairedTitle: "Pássaro", repairedAuthor: "Ana Lima" }
  });
  assert.equal(retitleRepairs({ ...book, work_title: "Pássaro" }, next, "isbndb").work, null);
  assert.equal(retitleRepairs({ ...book, work_id: null, work_title: null, work_author: null }, next, "isbndb").work, null);
});

test("textOf joins title and author", () => {
  assert.equal(textOf({ title: "P©ssaro", author: "Ana Lima" }), "P©ssaro — Ana Lima");
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/domain/lossy.test.ts`
Expected: FAIL, cannot find module `./lossy.js`.

- [ ] **Step 4: Implement** `backend/src/modules/books/domain/lossy.ts`:

```ts
import { canonicalIsbn, repairMojibake } from "@scripta/shared";
import type { LossyBook } from "./types.js";

const LOSSY = /\p{L}©\p{L}/u;
const LETTER = /\p{L}/u;
const LOWERCASE = /\p{Ll}/u;

export interface BookText {
  title: string;
  author: string;
}

export interface RetitleCandidates {
  titles: string[];
  authors: string[];
}

export const isLossy = (text: string) => LOSSY.test(text);

export const hasCopyrightSign = (book: BookText) => book.title.includes("©") || book.author.includes("©");

export const wantsRetitle = (book: { title: string; author: string; isbn: string | null }) =>
  canonicalIsbn(book.isbn ?? "") !== "" && (isLossy(book.title) || isLossy(book.author));

export const textOf = (book: BookText) => `${book.title} — ${book.author}`;

const isAccentedLetter = (char: string) => LETTER.test(char) && char.codePointAt(0)! > 0x7f;

export function fillLossy(stored: string, candidate: string): string | null {
  const have = [...stored.normalize("NFC").trim()];
  const text = repairMojibake(candidate).normalize("NFC").trim();
  const want = [...text];
  if (!have.includes("©") || have.length !== want.length) return null;
  if (!LOWERCASE.test(text) && have.some((char) => LOWERCASE.test(char))) return null;
  return have.every((char, index) => (char === "©" ? isAccentedLetter(want[index]!) : char.toLowerCase() === want[index]!.toLowerCase())) ? text : null;
}

function fillFirst(stored: string, candidates: string[]): string {
  for (const candidate of candidates) {
    const filled = fillLossy(stored, candidate);
    if (filled !== null) return filled;
  }
  return stored;
}

export function retitle(book: BookText, candidates: RetitleCandidates): BookText | null {
  const title = fillFirst(book.title, candidates.titles);
  const author = book.author.split(", ").map((name) => fillFirst(name, candidates.authors)).join(", ");
  return title === book.title && author === book.author ? null : { title, author };
}

export function retitleRepairs(book: LossyBook, next: BookText, origin: string) {
  const change = { title: book.title, author: book.author, repairedTitle: next.title, repairedAuthor: next.author };
  return {
    book: { id: book.id, ...change, origin },
    work: book.work_id !== null && book.work_title === book.title && book.work_author === book.author ? { id: book.work_id, ...change } : null
  };
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/domain/lossy.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Add the test to the list.** In `backend/package.json`'s `test` script, insert ` src/modules/books/domain/lossy.test.ts` directly after `src/modules/books/domain/normalize.test.ts`.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck --workspace backend && git add backend/src/modules/books/domain/lossy.ts backend/src/modules/books/domain/lossy.test.ts backend/src/modules/books/domain/types.ts backend/package.json && git commit -m "Add the rule that fills letters lost to © from a matching title"
```

---

### Task 2: Share the importer's fetch helpers

**Files:**
- Create: `backend/src/modules/books/seed/siteFetch.ts`
- Create: `backend/src/modules/books/seed/siteFetch.test.ts`
- Modify: `backend/scripts/import-publisher-covers.mjs:9-34`
- Modify: `backend/package.json` (test list)

**Interfaces:**
- Consumes: `USER_AGENT` from `../adapters/http/http.js`; `SourceUnavailableError` from `../domain/errors.js`.
- Produces: `fetchText(url: string): Promise<{ status: number; text: string }>` (the shape of `ImportDeps["fetchText"]`) and `fetchBytes(url: string): Promise<Buffer | null>`, exported from `seed/siteFetch.ts` and imported by both scripts from `dist/modules/books/seed/siteFetch.js`.

- [ ] **Step 1: Write the failing test** `backend/src/modules/books/seed/siteFetch.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { USER_AGENT } from "../adapters/http/http.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { fetchBytes, fetchText } from "./siteFetch.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const answer = (status: number, body = "body") => {
  globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
};
const fail = (error: Error) => {
  globalThis.fetch = (async () => {
    throw error;
  }) as typeof fetch;
};

test("fetchText returns the status and text of an ordinary answer, a 404 included", async () => {
  answer(200);
  assert.deepEqual(await fetchText("https://shop.test/a"), { status: 200, text: "body" });
  answer(404);
  assert.deepEqual(await fetchText("https://shop.test/a"), { status: 404, text: "body" });
});

test("a 429, a 5xx, a network error and a timeout become SourceUnavailableError", async () => {
  answer(429);
  await assert.rejects(fetchText("https://shop.test/a"), SourceUnavailableError);
  answer(503);
  await assert.rejects(fetchText("https://shop.test/a"), SourceUnavailableError);
  fail(new TypeError("fetch failed"));
  await assert.rejects(fetchText("https://shop.test/a"), SourceUnavailableError);
  fail(new DOMException("timed out", "TimeoutError"));
  await assert.rejects(fetchText("https://shop.test/a"), SourceUnavailableError);
});

test("any other error propagates", async () => {
  fail(new RangeError("boom"));
  await assert.rejects(fetchText("https://shop.test/a"), RangeError);
});

test("fetchBytes returns the body of a 2xx and null otherwise", async () => {
  answer(200, "bytes");
  assert.deepEqual(await fetchBytes("https://shop.test/a.jpg"), Buffer.from("bytes"));
  answer(404);
  assert.equal(await fetchBytes("https://shop.test/a.jpg"), null);
});

test("requests carry the importer's user agent", async () => {
  const agents: Array<string | null> = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    agents.push(new Headers(init?.headers).get("User-Agent"));
    return new Response("", { status: 200 });
  }) as typeof fetch;
  await fetchText("https://shop.test/a");
  assert.deepEqual(agents, [USER_AGENT]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/seed/siteFetch.test.ts`
Expected: FAIL, cannot find module `./siteFetch.js`.

- [ ] **Step 3: Implement** `backend/src/modules/books/seed/siteFetch.ts`. This is the importer script's code, moved as it is:

```ts
import { USER_AGENT } from "../adapters/http/http.js";
import { SourceUnavailableError } from "../domain/errors.js";

const TIMEOUT_MS = 30_000;

async function guarded<T>(url: string, read: (res: Response) => Promise<T>): Promise<T> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429 || res.status >= 500) throw new SourceUnavailableError(new URL(url).hostname, `HTTP ${res.status}`, { status: res.status });
    return await read(res);
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) throw new SourceUnavailableError(new URL(url).hostname, error.message);
    throw error;
  }
}

export const fetchText = (url: string) => guarded(url, async (res) => ({ status: res.status, text: await res.text() }));

export const fetchBytes = (url: string) => guarded(url, async (res) => (res.ok ? Buffer.from(await res.arrayBuffer()) : null));
```

- [ ] **Step 4: Run it and see it pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/seed/siteFetch.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Point the importer script at the shared helpers.** In `backend/scripts/import-publisher-covers.mjs`:
  - delete the line `const TIMEOUT_MS = 30_000;`
  - delete the line `const { SourceUnavailableError } = await import("../dist/modules/books/domain/errors.js");`
  - change `const { USER_AGENT, createThrottle, fetchJson } = await import("../dist/modules/books/adapters/http/http.js");` to `const { createThrottle, fetchJson } = await import("../dist/modules/books/adapters/http/http.js");`
  - after the line that imports `importPublisherCovers`, add `const { fetchBytes, fetchText } = await import("../dist/modules/books/seed/siteFetch.js");`
  - delete the whole `async function guarded(url, read) { … }` and the two lines `const fetchText = …` and `const fetchBytes = …` below it.

- [ ] **Step 6: Add the test to the list.** In `backend/package.json`'s `test` script, insert ` src/modules/books/seed/siteFetch.test.ts` directly after `src/modules/books/seed/mojibakeRepair.test.ts`.

- [ ] **Step 7: Check the script still loads its imports**

Run: `npm run typecheck --workspace backend && npm run build --workspace backend && node --check backend/scripts/import-publisher-covers.mjs && node -e 'import("./backend/dist/modules/books/seed/siteFetch.js").then((m) => console.log(Object.keys(m).sort().join(",")))'`
Expected: `fetchBytes,fetchText`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/books/seed/siteFetch.ts backend/src/modules/books/seed/siteFetch.test.ts backend/scripts/import-publisher-covers.mjs backend/package.json && git commit -m "Move the publisher importer's fetch helpers into the seed module"
```

---

### Task 3: Mark new lossy books

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql` (books table)
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts:27-56` (`applyBooksMigrations`)
- Modify: `backend/src/modules/books/domain/types.ts` (`BookRow`)
- Modify: `backend/src/modules/books/domain/ports.ts` (`BooksRepository`)
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` (insert, `createBook`, two statements, two methods)
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes: `wantsRetitle` from `../../domain/lossy.js` (Task 1); `LossyBook` from `../../domain/types.js` (Task 1).
- Produces:
  - column `books.retitle_wanted_at TEXT`, index `idx_books_retitle_wanted`
  - `BookRow.retitle_wanted_at: string | null`
  - `BooksRepository.listRetitleWanted(limit: number): LossyBook[]`: oldest mark first, then rowid
  - `BooksRepository.clearRetitleWanted(id: string): void`

- [ ] **Step 1: Write the failing tests.** Append to the end of `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts` (`NOW`, `freshRepo` and `at` are already defined above):

```ts
test("createBook marks a new lossy book with a valid ISBN for a re-title, and no other", () => {
  const { repo } = freshRepo();
  const lossyTitle = repo.createBook({ title: "P©ssaro Azul", author: "Ana Lima", isbn: "9789720000101" }, ["isbn:9789720000101"], NOW);
  const lossyAuthor = repo.createBook({ title: "Pássaro Azul", author: "In©s Duarte", isbn: "9789720000118" }, ["isbn:9789720000118"], NOW);
  const clean = repo.createBook({ title: "Pássaro Verde", author: "Ana Lima", isbn: "9789720000125" }, ["isbn:9789720000125"], NOW);
  const noIsbn = repo.createBook({ title: "P©ssaro Branco", author: "Ana Lima", isbn: null }, ["ta:p ssaro branco|ana lima|"], NOW);
  const existing = repo.createBook({ title: "P©ssaro Verde", author: "Ana Lima", isbn: "9789720000125" }, ["isbn:9789720000125"], NOW);
  assert.deepEqual([lossyTitle, lossyAuthor, clean, noIsbn].map((book) => book.retitle_wanted_at), [NOW, NOW, null, null]);
  assert.equal(existing.id, clean.id);
  assert.equal(existing.retitle_wanted_at, null);
});

test("listRetitleWanted lists marked books oldest first with their work's text, and clearRetitleWanted unmarks one", () => {
  const { repo } = freshRepo();
  const later = repo.createBook({ title: "P©ssaro Azul", author: "Ana Lima", isbn: "9789720000101" }, ["isbn:9789720000101"], at(1));
  const earlier = repo.createBook({ title: "Can©o", author: "In©s Duarte", isbn: "9789720000118" }, ["isbn:9789720000118"], NOW);
  repo.createBook({ title: "Pássaro Verde", author: "Ana Lima", isbn: "9789720000125" }, ["isbn:9789720000125"], NOW);
  assert.deepEqual(repo.listRetitleWanted(10).map((row) => ({ ...row })), [
    { id: earlier.id, title: "Can©o", author: "In©s Duarte", isbn: "9789720000118", work_id: earlier.work_id, work_title: "Can©o", work_author: "In©s Duarte" },
    { id: later.id, title: "P©ssaro Azul", author: "Ana Lima", isbn: "9789720000101", work_id: later.work_id, work_title: "P©ssaro Azul", work_author: "Ana Lima" }
  ]);
  assert.deepEqual(repo.listRetitleWanted(1).map((row) => row.id), [earlier.id]);
  repo.clearRetitleWanted(earlier.id);
  assert.deepEqual(repo.listRetitleWanted(10).map((row) => row.id), [later.id]);
});

test("retitle_wanted_at and its index are added to an existing database once", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("DROP INDEX idx_books_retitle_wanted");
  db.exec("ALTER TABLE books DROP COLUMN retitle_wanted_at");
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  const columns = (db.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(columns.includes("retitle_wanted_at"));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_retitle_wanted'").get());
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: the three new tests FAIL (`retitle_wanted_at` is undefined, `repo.listRetitleWanted is not a function`, no such index). Every other test passes.

- [ ] **Step 3: Add the column for new databases.** In `books.sql`, in `CREATE TABLE IF NOT EXISTS books`, add a line between `genres_confidence REAL,` and `created_at          TEXT NOT NULL`:

```sql
  retitle_wanted_at   TEXT,
```

- [ ] **Step 4: Add the column and index for existing databases.** In `connection.ts` `applyBooksMigrations`, after the `genres_confidence` ALTER line, add:

```ts
  if (!columns.some((column) => column.name === "retitle_wanted_at")) db.exec("ALTER TABLE books ADD COLUMN retitle_wanted_at TEXT");
```

and after the `idx_books_cover_upgrade` line, add:

```ts
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_retitle_wanted ON books(retitle_wanted_at) WHERE retitle_wanted_at IS NOT NULL");
```

- [ ] **Step 5: Add the field to `BookRow`** in `domain/types.ts`, after `genres_confidence: number | null;`:

```ts
  retitle_wanted_at: string | null;
```

- [ ] **Step 6: Add the two methods to the port.** In `domain/ports.ts`, add `LossyBook` to the `import type { … } from "./types.js"` list, and add these lines to `BooksRepository` after `listUpgradeWantedIds(…)`:

```ts
  listRetitleWanted(limit: number): LossyBook[];
  clearRetitleWanted(id: string): void;
```

- [ ] **Step 7: Implement in `sqliteBooksRepository.ts`.**
  - Imports: add `import { wantsRetitle } from "../../domain/lossy.js";` and add `LossyBook` to the `import type { … } from "../../domain/types.js"` list.
  - `insertBookStmt`: add the column and its parameter, so the statement reads:

```ts
  const insertBookStmt = db.prepare(`
    INSERT INTO books (id, title, author, year, publisher, isbn, ol_cover_id, ol_work_key, work_id, genres, data_sources, created_by, title_key, retitle_wanted_at, created_at)
    VALUES ($id, $title, $author, $year, $publisher, $isbn, $ol_cover_id, $ol_work_key, $work_id, $genres, $data_sources, $created_by, $title_key, $retitle_wanted_at, $created_at)
  `);
```

  - In `createBook`, in the `insertBookStmt.run({ … })` object, after the `$title_key` line add:

```ts
          $retitle_wanted_at: wantsRetitle(input) ? createdAt : null,
```

  - After `const upgradeWantedStmt = db.prepare(UPGRADE_WANTED_SQL);` add:

```ts
  const retitleWantedStmt = db.prepare(`
    SELECT books.id, books.title, books.author, books.isbn, books.work_id, works.title AS work_title, works.author AS work_author
    FROM books LEFT JOIN works ON works.id = books.work_id
    WHERE books.retitle_wanted_at IS NOT NULL
    ORDER BY books.retitle_wanted_at, books.rowid LIMIT ?
  `);
  const clearRetitleWantedStmt = db.prepare(`UPDATE books SET retitle_wanted_at = NULL WHERE id = ?`);
```

  - After the `listUpgradeWantedIds` method (the last one in the returned object), add a comma and:

```ts
    listRetitleWanted(limit) {
      return retitleWantedStmt.all(limit) as unknown as LossyBook[];
    },

    clearRetitleWanted(id) {
      clearRetitleWantedStmt.run(id);
    }
```

- [ ] **Step 8: Run the repository tests and see them pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: PASS, every test including the three new ones.

- [ ] **Step 9: Typecheck, run the books suites that create books, and commit**

Run: `npm run typecheck --workspace backend && npm exec --workspace backend -- tsx --test src/modules/books/seed/mojibakeRepair.test.ts src/modules/books/booksService.test.ts src/modules/books/seed/importPublisherCovers.test.ts`
Expected: typecheck clean, all PASS.

```bash
git add backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/domain/types.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts && git commit -m "Mark new books whose letters were lost to © for a re-title"
```

---

### Task 4: The importer keeps the shop's title over a lossy edition title

**Files:**
- Modify: `backend/src/modules/books/seed/importPublisherCovers.ts` (imports; `title = result.edition.title ?? title;` in `importSite`)
- Test: `backend/src/modules/books/seed/importPublisherCovers.test.ts`
- Modify: `backend/README.md` (the publisher importer's **Books.** bullet)

**Interfaces:**
- Consumes: `fillLossy` from `../domain/lossy.js` (Task 1); `BookRow.retitle_wanted_at` (Task 3).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Write the failing tests.** Append to the end of `importPublisherCovers.test.ts` (`harness`, `product`, `shopifyPage`, `NOW` and `Site` are already defined in the file). `9789890000109` is a synthetic Portugal ISBN with a valid check digit, which the importer requires:

```ts
const loja: Site = { name: "Loja", origin: "https://loja.test", platform: "shopify", authorFromVendor: false };
const LOJA_FEED = "https://loja.test/products.json?limit=250&page=1";
const LOSSY_ISBN = "9789890000109";

test("a lossy Open Library edition title gives way to the shop's title when only the © letters differ", async () => {
  const h = await harness({
    lookup: async () => ({ title: "Hist©ria Do Mar", author: "In©s Duarte" }),
    feeds: { [LOJA_FEED]: { text: shopifyPage([product(LOSSY_ISBN, "História do Mar", "https://cdn.example/mar.jpg")]) } }
  });

  await importPublisherCovers(h.deps, [loja], { dryRun: false });

  const row = h.repo.findBookByKey(`isbn:${LOSSY_ISBN}`)!;
  assert.equal(row.title, "História do Mar");
  assert.equal(row.author, "In©s Duarte");
  assert.equal(row.retitle_wanted_at, NOW.toISOString());
});

test("a lossy Open Library edition title stays when the shop's title differs in more than the © letters", async () => {
  const h = await harness({
    lookup: async () => ({ title: "Hist©ria Do Mar", author: "Inês Duarte" }),
    feeds: { [LOJA_FEED]: { text: shopifyPage([product(LOSSY_ISBN, "A História do Mar", "https://cdn.example/mar.jpg")]) } }
  });

  await importPublisherCovers(h.deps, [loja], { dryRun: false });

  const row = h.repo.findBookByKey(`isbn:${LOSSY_ISBN}`)!;
  assert.equal(row.title, "Hist©ria Do Mar");
  assert.equal(row.retitle_wanted_at, NOW.toISOString());
});
```

- [ ] **Step 2: Run them and see the first fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/seed/importPublisherCovers.test.ts`
Expected: the first new test FAILS (title is `Hist©ria Do Mar`). The second passes.

- [ ] **Step 3: Implement.** In `importPublisherCovers.ts`, add `import { fillLossy } from "../domain/lossy.js";` with the other `../domain/` imports, and in `importSite` replace

```ts
          title = result.edition.title ?? title;
```

with

```ts
          title = result.edition.title ? fillLossy(result.edition.title, title) ?? result.edition.title : title;
```

- [ ] **Step 4: Run the importer tests and see them pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/seed/importPublisherCovers.test.ts`
Expected: PASS, every test.

- [ ] **Step 5: Document it.** In `backend/README.md`, in the publisher importer's **Books.** bullet, after the sentence ending `or the feed's when Open Library has no edition record.`, insert:

```markdown
When that edition title has letters lost to `©` and the feed's title spells it the same way with real letters there, the feed's title is kept (the rule in "Lossy titles").
```

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck --workspace backend && git add backend/src/modules/books/seed/importPublisherCovers.ts backend/src/modules/books/seed/importPublisherCovers.test.ts backend/README.md && git commit -m "Keep the shop's title when Open Library's edition title lost its letters to ©"
```

---

### Task 5: Plan the backlog re-titles

**Files:**
- Modify: `backend/src/modules/books/seed/mojibakeRepair.ts:61` (`applyMojibakeRepairs` signature only)
- Create: `backend/src/modules/books/seed/lossyRetitle.ts`
- Create: `backend/src/modules/books/seed/lossyRetitle.test.ts`
- Modify: `backend/package.json` (test list)

**Interfaces:**
- Consumes: Task 1's `isLossy`, `hasCopyrightSign`, `retitle`, `retitleRepairs`, `textOf`, `BookText`, `RetitleCandidates`, `LossyBook`; `readSiteFeed`, `createThrottle`, `SiteSkipped`, `ImportDeps` from `./importPublisherCovers.js`; `BookCatalog` (its `search`) from `../domain/ports.js`; `BookRepair`, `RowRepair`, `MojibakeApplied`, `MojibakePlan` from `./mojibakeRepair.js`.
- Produces:
  - `applyMojibakeRepairs(db: DatabaseSync, plan: Pick<MojibakePlan, "books" | "works">): MojibakeApplied` (Task 7 relies on this)
  - `interface RetitleDeps { fetchText: ImportDeps["fetchText"]; sleep: (ms: number) => Promise<void>; isbndb: Pick<BookCatalog, "search">; log: (line: string) => void }`
  - `interface LossyPlan { targets; feeds; isbndb; books; works; stillLossy }` (below)
  - `planLossyRetitles(db: DatabaseSync, deps: RetitleDeps, sites: PublisherSite[], options: { max: number }): Promise<LossyPlan>`
  - `lossyRetitleReport(plan: LossyPlan, applied: MojibakeApplied | null)`

- [ ] **Step 1: Widen `applyMojibakeRepairs`.** In `mojibakeRepair.ts`, change

```ts
export function applyMojibakeRepairs(db: DatabaseSync, plan: MojibakePlan): MojibakeApplied {
```

to

```ts
export function applyMojibakeRepairs(db: DatabaseSync, plan: Pick<MojibakePlan, "books" | "works">): MojibakeApplied {
```

Run: `npm exec --workspace backend -- tsx --test src/modules/books/seed/mojibakeRepair.test.ts`
Expected: PASS, 14 tests (unchanged).

- [ ] **Step 2: Write the failing test** `backend/src/modules/books/seed/lossyRetitle.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { CatalogSearchHit } from "../domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "lossy-retitle-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { SourcePausedError, SourceUnavailableError } = await import("../domain/errors.js");
const { catalogTitleKey, workTitleKey } = await import("../domain/normalize.js");
const { lossyRetitleReport, planLossyRetitles } = await import("./lossyRetitle.js");
const { applyMojibakeRepairs } = await import("./mojibakeRepair.js");

type Site = Parameters<typeof planLossyRetitles>[2][number];

const NOW = "2026-10-01T00:00:00.000Z";
const SHOP: Site = { name: "Loja", origin: "https://loja.test", platform: "shopify", authorFromVendor: false };
const OTHER: Site = { name: "Outra", origin: "https://outra.test", platform: "shopify", authorFromVendor: false };
const FEED = "https://loja.test/products.json?limit=250&page=1";

function product(handle: string, title: string) {
  return { title, handle, vendor: "Loja", body_html: "", variants: [{ barcode: "", sku: "" }], images: [{ src: `https://loja.test/files/${handle}.jpg` }] };
}

const page1 = (products: unknown[]) => ({ status: 200, text: JSON.stringify({ products }) });

const hit = (title: string, authors: string[]): CatalogSearchHit => ({
  result: { title, authors, year: null, isbn: null, publisher: null, coverUrl: null, genres: [] },
  olCoverId: null,
  source: "isbndb"
});

function setup(options: { feeds?: Record<string, { status: number; text: string } | Error>; isbndb?: (isbn: string) => Promise<CatalogSearchHit[]> } = {}) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const requested: string[] = [];
  const asked: string[] = [];
  const deps = {
    sleep: async () => {},
    log: () => {},
    fetchText: async (url: string) => {
      requested.push(url);
      const entry = options.feeds?.[url];
      if (entry instanceof Error) throw entry;
      if (entry) return entry;
      if (url.endsWith("/robots.txt")) return { status: 404, text: "" };
      return { status: 200, text: JSON.stringify({ products: [] }) };
    },
    isbndb: {
      search: async (query: { isbn: string } | { text: string }) => {
        const isbn = "isbn" in query ? query.isbn : "";
        asked.push(isbn);
        return options.isbndb ? options.isbndb(isbn) : [];
      }
    }
  };
  const book = (title: string, author: string, isbn: string | null, publisherUrl?: string) => {
    const keys = [isbn && `isbn:${isbn}`, catalogTitleKey(title, author)].filter((key): key is string => Boolean(key));
    const created = repo.createBook({ title, author, isbn, createdBy: "publisher" }, keys, NOW);
    if (publisherUrl) repo.setPublisherUrl(created.id, publisherUrl);
    return created;
  };
  const stored = (id: string) => ({ ...(db.prepare("SELECT title, author, title_key FROM books WHERE id = ?").get(id) as { title: string; author: string; title_key: string | null }) });
  const dump = () => ["books", "works", "book_keys", "books_fts"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const plan = (max = 10, sites: Site[] = [SHOP]) => planLossyRetitles(db, deps, sites, { max });
  return { db, repo, requested, asked, book, stored, dump, plan };
}

test("the shop's title fixes a publisher book, and ISBNdb isn't asked when nothing is left", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "Pássaro Azul")]) } });
  const target = h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan();
  const report = lossyRetitleReport(plan, null);
  assert.deepEqual(h.asked, []);
  assert.deepEqual(plan.feeds, { Loja: { products: 1, matched: 1 } });
  assert.equal(report.dryRun, true);
  assert.equal(report.applied, null);
  assert.deepEqual(report.retitles, [{ id: target.id, isbn: "9789890000109", from: "P©ssaro Azul — Ana Lima", to: "Pássaro Azul — Ana Lima", source: "publisher" }]);
  assert.deepEqual(plan.stillLossy, []);
});

test("ISBNdb fixes the author the shop's feed couldn't, asked with the ISBN-13", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "Pássaro Azul")]) }, isbndb: async () => [hit("Passaro Azul", ["Inês Duarte"])] });
  const target = h.book("P©ssaro Azul", "In©s Duarte", "972000000X", "https://loja.test/products/passaro");
  const plan = await h.plan();
  assert.deepEqual(h.asked, ["9789720000002"]);
  assert.deepEqual(lossyRetitleReport(plan, null).retitles, [{ id: target.id, isbn: "972000000X", from: "P©ssaro Azul — In©s Duarte", to: "Pássaro Azul — Inês Duarte", source: "publisher+isbndb" }]);
  assert.deepEqual(plan.isbndb, { max: 10, asked: 1, unavailable: 0, notAsked: 0, pausedUntil: null });
});

test("a shop that lists authors gives each name as a candidate", async () => {
  const h = setup({ feeds: { [FEED]: page1([{ ...product("passaro", "Pássaro Azul"), vendor: "Ana Lima, Inês Duarte" }]) } });
  h.book("P©ssaro Azul", "Ana Lima, In©s Duarte", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan(10, [{ ...SHOP, authorFromVendor: true }]);
  assert.deepEqual(h.asked, []);
  assert.deepEqual(plan.books.map((book) => [book.repairedTitle, book.repairedAuthor, book.origin]), [["Pássaro Azul", "Ana Lima, Inês Duarte", "publisher"]]);
});

test("a shop is read when its host matches ignoring www., and products still match by exact URL", async () => {
  const h = setup({ feeds: { "https://www.loja.test/products.json?limit=250&page=1": page1([product("passaro", "Pássaro Azul")]) } });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan(10, [{ ...SHOP, origin: "https://www.loja.test" }, OTHER]);
  assert.ok(h.requested.length > 0 && h.requested.every((url) => url.startsWith("https://www.loja.test/")));
  assert.deepEqual(plan.feeds, { Loja: { products: 1, matched: 0 } });
});

test("a book whose publisher_url is on no known shop goes straight to ISBNdb", async () => {
  const h = setup({ isbndb: async () => [hit("Pássaro Azul", ["Ana Lima"])] });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://fechada.test/products/passaro");
  const plan = await h.plan();
  assert.deepEqual(h.requested, []);
  assert.deepEqual(plan.feeds, {});
  assert.deepEqual(plan.books.map((book) => [book.repairedTitle, book.origin]), [["Pássaro Azul", "isbndb"]]);
});

test("two books at one publisher_url both take the product's title", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "Pássaro Azul")]) } });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://loja.test/products/passaro");
  h.book("P©ssaro Azul", "Rui Costa", "9789890000116", "https://loja.test/products/passaro");
  const plan = await h.plan();
  assert.deepEqual(plan.books.map((book) => book.repairedTitle), ["Pássaro Azul", "Pássaro Azul"]);
  assert.deepEqual(plan.feeds, { Loja: { products: 1, matched: 2 } });
});

test("a shop that can't be read is reported, and its books go to ISBNdb", async () => {
  const h = setup({ feeds: { "https://loja.test/robots.txt": { status: 503, text: "" } }, isbndb: async () => [hit("Pássaro Azul", ["Ana Lima"])] });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan();
  assert.deepEqual(plan.feeds, { Loja: { skipped: "robots.txt answered HTTP 503" } });
  assert.deepEqual(plan.books.map((book) => book.origin), ["isbndb"]);
});

test("--max caps the ISBNdb requests, and the rest count as not asked", async () => {
  const h = setup();
  h.book("P©ssaro 1", "Ana Lima", "9789890000109");
  h.book("P©ssaro 2", "Ana Lima", "9789890000116");
  h.book("P©ssaro 3", "Ana Lima", "9789720000101");
  const plan = await h.plan(2);
  assert.equal(h.asked.length, 2);
  assert.deepEqual(plan.isbndb, { max: 2, asked: 2, unavailable: 0, notAsked: 1, pausedUntil: null });
  assert.deepEqual(plan.stillLossy.map((book) => book.isbndb), ["no record", "no record", "not asked"]);
});

test("--max 0 reads the feeds and asks ISBNdb nothing", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "Pássaro Azul")]) } });
  h.book("P©ssaro Azul", "In©s Duarte", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan(0);
  assert.deepEqual(h.asked, []);
  assert.deepEqual(plan.books.map((book) => book.repairedTitle), ["Pássaro Azul"]);
  assert.deepEqual(plan.isbndb, { max: 0, asked: 0, unavailable: 0, notAsked: 1, pausedUntil: null });
  assert.deepEqual(plan.stillLossy.map((book) => [book.text, book.isbndb]), [["Pássaro Azul — In©s Duarte", "not asked"]]);
});

test("a pause stops the ISBNdb requests and reports when it lifts", async () => {
  const retryAt = Date.parse("2026-10-02T00:00:00.000Z");
  const h = setup({
    isbndb: async () => {
      throw new SourcePausedError("isbndb", "paused", { retryAt });
    }
  });
  h.book("P©ssaro 1", "Ana Lima", "9789890000109");
  h.book("P©ssaro 2", "Ana Lima", "9789890000116");
  const plan = await h.plan();
  assert.equal(h.asked.length, 1);
  assert.deepEqual(plan.isbndb, { max: 10, asked: 1, unavailable: 0, notAsked: 2, pausedUntil: "2026-10-02T00:00:00.000Z" });
  assert.deepEqual(plan.stillLossy.map((book) => book.isbndb), ["not asked", "not asked"]);
});

test("an unavailable answer is counted and the next book is still asked", async () => {
  let calls = 0;
  const h = setup({
    isbndb: async () => {
      calls++;
      if (calls === 1) throw new SourceUnavailableError("isbndb", "HTTP 503", { status: 503 });
      return [hit("Pássaro 2", ["Ana Lima"])];
    }
  });
  h.book("P©ssaro 1", "Ana Lima", "9789890000109");
  h.book("P©ssaro 2", "Ana Lima", "9789890000116");
  const plan = await h.plan();
  assert.deepEqual(plan.isbndb, { max: 10, asked: 2, unavailable: 1, notAsked: 0, pausedUntil: null });
  assert.deepEqual(plan.stillLossy.map((book) => [book.text, book.isbndb]), [["P©ssaro 1 — Ana Lima", "unavailable"]]);
  assert.deepEqual(plan.books.map((book) => book.repairedTitle), ["Pássaro 2"]);
});

test("a book left lossy lists what it was compared against", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "O Pássaro Azul")]) }, isbndb: async () => [hit("Pássaro Azul!", ["Ana Lima"])] });
  const target = h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan();
  assert.deepEqual(plan.stillLossy, [{ id: target.id, isbn: "9789890000109", text: "P©ssaro Azul — Ana Lima", isbndb: "answered", candidates: { titles: ["O Pássaro Azul", "Pássaro Azul!"], authors: ["Ana Lima"] } }]);
  assert.deepEqual(plan.books, []);
});

test("a lossy book with no ISBN and no shop is listed and not asked about", async () => {
  const h = setup();
  const target = h.book("P©ssaro Azul", "Ana Lima", null);
  const plan = await h.plan();
  assert.deepEqual(h.asked, []);
  assert.deepEqual(plan.stillLossy, [{ id: target.id, isbn: null, text: "P©ssaro Azul — Ana Lima", isbndb: "not asked", candidates: { titles: [], authors: [] } }]);
});

test("an unexpected error propagates before anything is written", async () => {
  const h = setup({
    isbndb: async () => {
      throw new RangeError("boom");
    }
  });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  const before = h.dump();
  await assert.rejects(h.plan(), RangeError);
  assert.deepEqual(h.dump(), before);
});

test("a book's work is planned only while it holds the book's old text", async () => {
  const h = setup({ isbndb: async () => [hit("Pássaro Azul", ["Ana Lima"])] });
  const follows = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  const differs = h.book("P©ssaro Azul", "Rui Costa", "9789890000116");
  h.db.prepare("UPDATE works SET title = 'Outro' WHERE id = ?").run(differs.work_id);
  const plan = await h.plan();
  assert.deepEqual(plan.works.map((work) => work.id), [follows.work_id]);
});

test("planning writes nothing", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "Pássaro Azul")]) }, isbndb: async () => [hit("Pássaro Azul", ["Inês Duarte"])] });
  h.book("P©ssaro Azul", "In©s Duarte", "9789890000109", "https://loja.test/products/passaro");
  const before = h.dump();
  const plan = await h.plan();
  assert.equal(plan.books.length, 1);
  assert.deepEqual(h.dump(), before);
});

test("applying the plan updates the book, its keys, its search row and its work", async () => {
  const h = setup({ isbndb: async () => [hit("Pássaro Azul", ["Inês Duarte"])] });
  const target = h.book("P©ssaro Azul", "In©s Duarte", "9789890000109");
  const plan = await h.plan();
  const applied = applyMojibakeRepairs(h.db, plan);
  assert.deepEqual(applied, { books: 1, works: 1, skipped: 0 });
  assert.deepEqual(h.stored(target.id), { title: "Pássaro Azul", author: "Inês Duarte", title_key: workTitleKey("Pássaro Azul", "Inês Duarte") });
  assert.equal(h.repo.findBookByKey(catalogTitleKey("Pássaro Azul", "Inês Duarte")!)?.id, target.id);
  assert.deepEqual({ ...(h.db.prepare("SELECT title, author FROM books_fts WHERE book_id = ?").get(target.id) as object) }, { title: "Pássaro Azul", author: "Inês Duarte" });
  assert.deepEqual({ ...(h.db.prepare("SELECT title, author FROM works WHERE id = ?").get(target.work_id) as object) }, { title: "Pássaro Azul", author: "Inês Duarte" });
  assert.equal(lossyRetitleReport(plan, applied).dryRun, false);
  assert.equal((await h.plan()).targets, 0);
});

test("a book edited after planning is skipped when the plan is applied", async () => {
  const h = setup({ isbndb: async () => [hit("Pássaro Azul", ["Ana Lima"])] });
  const target = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  const plan = await h.plan();
  h.db.prepare("UPDATE books SET title = 'Editado' WHERE id = ?").run(target.id);
  assert.deepEqual(applyMojibakeRepairs(h.db, plan), { books: 0, works: 1, skipped: 1 });
  assert.equal(h.stored(target.id).title, "Editado");
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/seed/lossyRetitle.test.ts`
Expected: FAIL, cannot find module `./lossyRetitle.js`.

- [ ] **Step 4: Implement** `backend/src/modules/books/seed/lossyRetitle.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { canonicalIsbn } from "@scripta/shared";
import { SourcePausedError, SourceUnavailableError } from "../domain/errors.js";
import { hasCopyrightSign, isLossy, retitle, retitleRepairs, textOf, type BookText, type RetitleCandidates } from "../domain/lossy.js";
import type { BookCatalog } from "../domain/ports.js";
import type { LossyBook } from "../domain/types.js";
import { createThrottle, readSiteFeed, SiteSkipped, type ImportDeps } from "./importPublisherCovers.js";
import type { BookRepair, MojibakeApplied, RowRepair } from "./mojibakeRepair.js";
import type { PublisherSite } from "./publishers.js";

type LossyTarget = LossyBook & { publisher_url: string | null };
type IsbndbStatus = "answered" | "no record" | "unavailable" | "not asked";

export interface RetitleDeps {
  fetchText: ImportDeps["fetchText"];
  sleep: (ms: number) => Promise<void>;
  isbndb: Pick<BookCatalog, "search">;
  log: (line: string) => void;
}

export interface LossyPlan {
  targets: number;
  feeds: Record<string, { products: number; matched: number } | { skipped: string }>;
  isbndb: { max: number; asked: number; unavailable: number; notAsked: number; pausedUntil: string | null };
  books: Array<BookRepair & { isbn: string | null }>;
  works: RowRepair[];
  stillLossy: Array<{ id: string; isbn: string | null; text: string; isbndb: IsbndbStatus; candidates: RetitleCandidates }>;
}

const TARGETS_SQL = `
  SELECT books.id, books.title, books.author, books.isbn, books.publisher_url, books.work_id, works.title AS work_title, works.author AS work_author
  FROM books LEFT JOIN works ON works.id = books.work_id
  WHERE books.title LIKE '%©%' OR books.author LIKE '%©%'
  ORDER BY books.rowid
`;

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") : null);

async function readFeeds(targets: LossyTarget[], deps: RetitleDeps, sites: PublisherSite[], plan: LossyPlan, candidates: Map<string, RetitleCandidates>) {
  const byUrl = new Map<string, LossyTarget[]>();
  for (const book of targets) if (book.publisher_url) byUrl.set(book.publisher_url, [...(byUrl.get(book.publisher_url) ?? []), book]);
  const hosts = new Set([...byUrl.keys()].map(hostOf));
  for (const site of sites.filter((site) => hosts.has(hostOf(site.origin)))) {
    try {
      const feed = await readSiteFeed(site, deps.fetchText, createThrottle(deps.sleep));
      let matched = 0;
      for (const product of feed.books) {
        for (const book of byUrl.get(product.productUrl) ?? []) {
          matched++;
          const found = candidates.get(book.id)!;
          found.titles.push(product.title);
          if (product.author) found.authors.push(...product.author.split(", "));
        }
      }
      plan.feeds[site.name] = { products: feed.products, matched };
    } catch (error) {
      if (!(error instanceof SiteSkipped || error instanceof SourceUnavailableError)) throw error;
      plan.feeds[site.name] = { skipped: error.message };
    }
    deps.log(`${site.name}: ${JSON.stringify(plan.feeds[site.name])}`);
  }
}

export async function planLossyRetitles(db: DatabaseSync, deps: RetitleDeps, sites: PublisherSite[], options: { max: number }): Promise<LossyPlan> {
  const targets = (db.prepare(TARGETS_SQL).all() as unknown as LossyTarget[]).filter((book) => isLossy(book.title) || isLossy(book.author));
  const plan: LossyPlan = { targets: targets.length, feeds: {}, isbndb: { max: options.max, asked: 0, unavailable: 0, notAsked: 0, pausedUntil: null }, books: [], works: [], stillLossy: [] };
  const candidates = new Map<string, RetitleCandidates>(targets.map((book) => [book.id, { titles: [], authors: [] }]));
  await readFeeds(targets, deps, sites, plan, candidates);
  for (const book of targets) {
    const found = candidates.get(book.id)!;
    const fromFeed = retitle(book, found);
    let current: BookText = fromFeed ?? book;
    let fromIsbndb: BookText | null = null;
    let status: IsbndbStatus = "not asked";
    const isbn = canonicalIsbn(book.isbn ?? "");
    if (hasCopyrightSign(current)) {
      if (isbn && plan.isbndb.pausedUntil === null && plan.isbndb.asked < options.max) {
        plan.isbndb.asked++;
        try {
          const hit = (await deps.isbndb.search({ isbn }))[0]?.result;
          status = hit ? "answered" : "no record";
          if (hit) {
            found.titles.push(hit.title);
            found.authors.push(...hit.authors);
            fromIsbndb = retitle(current, { titles: [hit.title], authors: hit.authors });
            current = fromIsbndb ?? current;
          }
        } catch (error) {
          if (error instanceof SourcePausedError) plan.isbndb.pausedUntil = new Date(error.retryAt).toISOString();
          else if (error instanceof SourceUnavailableError) {
            status = "unavailable";
            plan.isbndb.unavailable++;
          } else throw error;
        }
      }
      if (status === "not asked") plan.isbndb.notAsked++;
    }
    if (fromFeed || fromIsbndb) {
      const repairs = retitleRepairs(book, current, [fromFeed && "publisher", fromIsbndb && "isbndb"].filter(Boolean).join("+"));
      plan.books.push({ ...repairs.book, isbn: book.isbn });
      if (repairs.work && !plan.works.some((work) => work.id === repairs.work!.id)) plan.works.push(repairs.work);
    }
    if (hasCopyrightSign(current)) plan.stillLossy.push({ id: book.id, isbn: book.isbn, text: textOf(current), isbndb: status, candidates: found });
  }
  deps.log(`isbndb: ${JSON.stringify(plan.isbndb)}`);
  return plan;
}

export function lossyRetitleReport(plan: LossyPlan, applied: MojibakeApplied | null) {
  return {
    dryRun: applied === null,
    targets: plan.targets,
    feeds: plan.feeds,
    isbndb: plan.isbndb,
    retitles: plan.books.map((book) => ({ id: book.id, isbn: book.isbn, from: textOf(book), to: textOf({ title: book.repairedTitle, author: book.repairedAuthor }), source: book.origin })),
    stillLossy: plan.stillLossy,
    applied
  };
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/seed/lossyRetitle.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 6: Add the test to the list.** In `backend/package.json`'s `test` script, insert ` src/modules/books/seed/lossyRetitle.test.ts` directly after `src/modules/books/seed/siteFetch.test.ts`.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck --workspace backend && git add backend/src/modules/books/seed/mojibakeRepair.ts backend/src/modules/books/seed/lossyRetitle.ts backend/src/modules/books/seed/lossyRetitle.test.ts backend/package.json && git commit -m "Plan re-titles of lossy catalog books from shop feeds and ISBNdb"
```

---

### Task 6: The owner-run script and its README section

**Files:**
- Create: `backend/scripts/retitle-lossy.mjs`
- Modify: `backend/README.md` ("Mojibake repair" first bullet; new "Lossy titles" subsection)

**Interfaces:**
- Consumes: `planLossyRetitles`, `lossyRetitleReport` (Task 5); `applyMojibakeRepairs` (Task 5's signature); `fetchText` from `dist/modules/books/seed/siteFetch.js` (Task 2); `createIsbndbCatalog`, `createIsbndbGate`, `createThrottle` from `dist`; `env`, `isbndbConfigured` from `dist/config/env.js`; `PUBLISHERS` from `dist/modules/books/seed/publishers.js`.
- Produces: the command the owner runs.

- [ ] **Step 1: Write the script** `backend/scripts/retitle-lossy.mjs`:

```js
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, max: { type: "string" } } });
const max = Number(values.max);
if (!Number.isInteger(max) || max < 0) {
  console.error("Usage: node scripts/retitle-lossy.mjs --max N [--dry-run]");
  process.exit(1);
}
const dryRun = values["dry-run"];

const ISBNDB_GAP_MS = 1100;

const { env, isbndbConfigured } = await import("../dist/config/env.js");
if (!isbndbConfigured) {
  console.error("ISBNDB_API_KEY is not set.");
  process.exit(1);
}
const { createThrottle } = await import("../dist/modules/books/adapters/http/http.js");
const { createIsbndbCatalog } = await import("../dist/modules/books/adapters/isbndb/isbndbCatalog.js");
const { createIsbndbGate } = await import("../dist/modules/books/adapters/isbndb/isbndbGate.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { lossyRetitleReport, planLossyRetitles } = await import("../dist/modules/books/seed/lossyRetitle.js");
const { applyMojibakeRepairs } = await import("../dist/modules/books/seed/mojibakeRepair.js");
const { PUBLISHERS } = await import("../dist/modules/books/seed/publishers.js");
const { fetchText } = await import("../dist/modules/books/seed/siteFetch.js");

const gate = createIsbndbGate({ onPause: ({ reason, until }) => console.error(`ISBNdb paused (${reason}) until ${new Date(until).toISOString()}`) });
const isbndb = createIsbndbCatalog(env.ISBNDB_API_KEY, createThrottle(ISBNDB_GAP_MS), gate, false);
const db = dryRun ? new DatabaseSync(env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const plan = await planLossyRetitles(
  db,
  { fetchText, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), isbndb, log: (line) => console.error(line) },
  PUBLISHERS,
  { max }
);
console.log(JSON.stringify(lossyRetitleReport(plan, dryRun ? null : applyMojibakeRepairs(db, plan)), null, 2));
```

- [ ] **Step 2: Smoke-run it against an empty scratch database.** This makes no network request: no book is lossy, so no shop is read and ISBNdb isn't asked.

```bash
npm run build --workspace backend && (S=$(mktemp -d); export AUTH_DB_PATH=$S/auth.sqlite LIBRARY_DB_PATH=$S/library.sqlite GALLERY_DB_PATH=$S/gallery.sqlite COVERS_DB_PATH=$S/covers.sqlite JWT_ACCESS_SECRET=$(printf 'a%.0s' $(seq 64)) JWT_REFRESH_SECRET=$(printf 'b%.0s' $(seq 64)); ISBNDB_API_KEY=smoke node backend/scripts/retitle-lossy.mjs --max 0; ISBNDB_API_KEY=smoke node backend/scripts/retitle-lossy.mjs --dry-run --max 0; ISBNDB_API_KEY=smoke node backend/scripts/retitle-lossy.mjs; echo "exit $?"; node backend/scripts/retitle-lossy.mjs --max 0; echo "exit $?")
```

Expected, in order:
1. The real run prints `"dryRun": false`, `"targets": 0`, `"feeds": {}`, `"isbndb": { "max": 0, "asked": 0, "unavailable": 0, "notAsked": 0, "pausedUntil": null }`, `"retitles": []`, `"stillLossy": []`, `"applied": { "books": 0, "works": 0, "skipped": 0 }`.
2. The dry run prints the same with `"dryRun": true` and `"applied": null`.
3. Without `--max` it prints the usage line and `exit 1`.
4. Without `ISBNDB_API_KEY` it prints `ISBNDB_API_KEY is not set.` and `exit 1`.

- [ ] **Step 3: Point the repair's section at the new one.** In `backend/README.md`, under "#### Mojibake repair", change the end of the first bullet from

```markdown
is lossy; the report lists those books under `stillBroken` and leaves them alone.
```

to

```markdown
is lossy; the report lists those books under `stillBroken` and leaves them alone, and "Lossy titles" below re-titles them from other sources.
```

- [ ] **Step 4: Add the "Lossy titles" subsection** to `backend/README.md`, directly before `#### Known limitations of covers, details and search, and the options for each`:

````markdown
#### Lossy titles

Some Open Library records lost every accented letter to `©` (`N©o Abras Este Livro`), which the repair above can't undo. `scripts/retitle-lossy.mjs` re-titles the books stored before new books were re-titled in the background (see the `books` section), from a source tied to the same book: the product at the book's `publisher_url` in its shop's feed, read as the importer reads it (robots.txt and the 3 s gap included) and only for the shops that hold such books, then ISBNdb (`GET /book/{isbn}`) for what is still lossy.

- A title, or one author name, changes only when the source has the same characters, ignoring case, with a non-ASCII letter at each `©`. The source's text is written, capitals included. An all-caps source can't replace mixed-case text. Two characters for one letter (`Tri©Øngulo`) and source typos stay.
- Writes are the repair's (`applyMojibakeRepairs`): one transaction per book, `title_key`, the corrected `ta:` key, the search row, and the work when it holds the book's old text. A book edited since it was read is skipped.
- Run it after the repair's real run. `--max` is required and caps the ISBNdb requests; `--max 0` reads the feeds only. The dry run opens the database read-only and makes the same lookups as the real run. A run takes about 5 minutes, mostly the feeds; hold deploys meanwhile.
- The JSON report has `targets`, `feeds` (per shop read: `products` and `matched`, or `skipped`), `isbndb` (`max`, `asked`, `unavailable`, `notAsked`, `pausedUntil`), `retitles` (every planned change as `{ id, isbn, from, to, source }`), `stillLossy` (each book left with a `©`, why ISBNdb didn't fix it, and the candidates it was compared against) and `applied` (`null` on a dry run). Save the real run's output: it holds the original text.

```bash
npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/retitle-lossy.mjs --dry-run --max 30'
npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/retitle-lossy.mjs --max 30'
```
````

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/retitle-lossy.mjs backend/README.md && git commit -m "Add the owner-run re-title script for books whose letters were lost to ©"
```

---

### Task 7: Re-title new books in the background

**Files:**
- Create: `backend/src/modules/books/retitleJob.ts`
- Create: `backend/src/modules/books/retitleJob.test.ts`
- Modify: `backend/src/modules/books/plugin.ts` (imports; keep the database handle; start and stop the job)
- Modify: `backend/package.json` (test list)
- Modify: `backend/README.md` (`books` bullet)

**Interfaces:**
- Consumes: Task 1's `hasCopyrightSign`, `retitle`, `retitleRepairs`, `textOf`; Task 3's `listRetitleWanted`, `clearRetitleWanted`; Task 5's `applyMojibakeRepairs(db, plan: Pick<MojibakePlan, "books" | "works">)`; `startDetailsBackfill` from `./backfill.js`.
- Produces: `RETITLE_BATCH_SIZE = 25`; `retitleWanted(deps: RetitleJobDeps, limit: number, signal?: AbortSignal): Promise<number | null>`, which returns a pause's retry time or `null`.

- [ ] **Step 1: Write the failing test** `backend/src/modules/books/retitleJob.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { CatalogSearchHit } from "./domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "retitle-job-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { SourcePausedError, SourceUnavailableError } = await import("./domain/errors.js");
const { catalogTitleKey } = await import("./domain/normalize.js");
const { applyMojibakeRepairs } = await import("./seed/mojibakeRepair.js");
const { RETITLE_BATCH_SIZE, retitleWanted } = await import("./retitleJob.js");

const NOW = "2026-10-01T00:00:00.000Z";
const at = (days: number) => new Date(Date.parse(NOW) + days * 24 * 60 * 60 * 1000).toISOString();

const hit = (title: string, authors: string[]): CatalogSearchHit => ({
  result: { title, authors, year: null, isbn: null, publisher: null, coverUrl: null, genres: [] },
  olCoverId: null,
  source: "isbndb"
});

function setup(answer: (isbn: string) => Promise<CatalogSearchHit[]> = async () => []) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const asked: string[] = [];
  const infos: Array<[object, string]> = [];
  const warns: Array<[object, string]> = [];
  const deps = {
    repo,
    isbndb: {
      search: async (query: { isbn: string } | { text: string }) => {
        const isbn = "isbn" in query ? query.isbn : "";
        asked.push(isbn);
        return answer(isbn);
      }
    },
    write: (plan: Parameters<typeof applyMojibakeRepairs>[1]) => applyMojibakeRepairs(db, plan),
    info: (details: object, message: string) => {
      infos.push([details, message]);
    },
    warn: (details: object, message: string) => {
      warns.push([details, message]);
    }
  };
  const book = (title: string, author: string, isbn: string, createdAt = NOW) =>
    repo.createBook({ title, author, isbn, createdBy: "publisher" }, [`isbn:${isbn}`, catalogTitleKey(title, author)!], createdAt);
  const marked = () => repo.listRetitleWanted(100).map((row) => row.id);
  const run = (limit = RETITLE_BATCH_SIZE) => retitleWanted(deps, limit);
  return { db, repo, asked, infos, warns, book, marked, run };
}

test("a marked book is re-titled from ISBNdb, its work too, and its mark is cleared", async () => {
  const h = setup(async () => [hit("Pássaro Azul", ["Inês Duarte"])]);
  const created = h.book("P©ssaro Azul", "In©s Duarte", "9789890000109");
  assert.equal(await h.run(), null);
  assert.equal(h.repo.getBook(created.id)!.title, "Pássaro Azul");
  assert.equal(h.repo.getBook(created.id)!.author, "Inês Duarte");
  assert.deepEqual({ ...(h.db.prepare("SELECT title, author FROM works WHERE id = ?").get(created.work_id) as object) }, { title: "Pássaro Azul", author: "Inês Duarte" });
  assert.deepEqual(h.marked(), []);
  assert.deepEqual(h.infos, [[{ bookId: created.id, from: "P©ssaro Azul — In©s Duarte", to: "Pássaro Azul — Inês Duarte" }, "lossy book re-titled"]]);
});

test("a book ISBNdb doesn't know, or spells differently, is left as it is and unmarked", async () => {
  const h = setup(async (isbn) => (isbn === "9789890000116" ? [hit("Outro Livro", ["Ana Lima"])] : []));
  const unknown = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  const different = h.book("P©ssaro Verde", "Ana Lima", "9789890000116");
  await h.run();
  assert.equal(h.repo.getBook(unknown.id)!.title, "P©ssaro Azul");
  assert.equal(h.repo.getBook(different.id)!.title, "P©ssaro Verde");
  assert.deepEqual(h.marked(), []);
  assert.deepEqual(h.infos.map(([, message]) => message), ["lossy book left", "lossy book left"]);
});

test("a marked book that is no longer lossy is unmarked without a request", async () => {
  const h = setup();
  const created = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  h.db.prepare("UPDATE books SET title = 'Pássaro Azul' WHERE id = ?").run(created.id);
  await h.run();
  assert.deepEqual(h.asked, []);
  assert.deepEqual(h.marked(), []);
});

test("an outage keeps the mark and the run goes on to the next book", async () => {
  const h = setup(async (isbn) => {
    if (isbn === "9789890000109") throw new SourceUnavailableError("isbndb", "HTTP 503", { status: 503 });
    return [hit("Pássaro Verde", ["Ana Lima"])];
  });
  const failing = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  const next = h.book("P©ssaro Verde", "Ana Lima", "9789890000116", at(1));
  assert.equal(await h.run(), null);
  assert.deepEqual(h.marked(), [failing.id]);
  assert.equal(h.repo.getBook(next.id)!.title, "Pássaro Verde");
  assert.equal(h.warns.length, 1);
});

test("a pause returns its retry time and keeps every mark", async () => {
  const retryAt = Date.parse("2026-10-02T00:00:00.000Z");
  const h = setup(async () => {
    throw new SourcePausedError("isbndb", "paused", { retryAt });
  });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  h.book("P©ssaro Verde", "Ana Lima", "9789890000116", at(1));
  assert.equal(await h.run(), retryAt);
  assert.equal(h.asked.length, 1);
  assert.equal(h.marked().length, 2);
});

test("the oldest marks go first, up to the limit", async () => {
  const h = setup();
  h.book("P©ssaro 2", "Ana Lima", "9789890000116", at(2));
  h.book("P©ssaro 1", "Ana Lima", "9789890000109", at(1));
  h.book("P©ssaro 3", "Ana Lima", "9789720000101", at(3));
  await h.run(2);
  assert.deepEqual(h.asked, ["9789890000109", "9789890000116"]);
  assert.equal(h.marked().length, 1);
});

test("a lossy book without a mark is never asked about", async () => {
  const h = setup(async () => [hit("Pássaro Azul", ["Ana Lima"])]);
  const backlog = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  h.db.prepare("UPDATE books SET retitle_wanted_at = NULL WHERE id = ?").run(backlog.id);
  await h.run();
  assert.deepEqual(h.asked, []);
  assert.equal(h.repo.getBook(backlog.id)!.title, "P©ssaro Azul");
});

test("a book stored with an ISBN-10 is asked about by its ISBN-13", async () => {
  const h = setup();
  h.book("P©ssaro Azul", "Ana Lima", "972000000X");
  await h.run();
  assert.deepEqual(h.asked, ["9789720000002"]);
});

test("a book edited while ISBNdb answers keeps the edit, logs no change and is unmarked", async () => {
  let edit: () => unknown = () => undefined;
  const h = setup(async () => {
    edit();
    return [hit("Pássaro Azul", ["Ana Lima"])];
  });
  const created = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  edit = () => h.db.prepare("UPDATE books SET author = 'Rui Costa' WHERE id = ?").run(created.id);
  await h.run();
  assert.equal(h.repo.getBook(created.id)!.title, "P©ssaro Azul");
  assert.equal(h.repo.getBook(created.id)!.author, "Rui Costa");
  assert.deepEqual(h.infos.map(([, message]) => message), ["lossy book left"]);
  assert.deepEqual(h.marked(), []);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/retitleJob.test.ts`
Expected: FAIL, cannot find module `./retitleJob.js`.

- [ ] **Step 3: Implement** `backend/src/modules/books/retitleJob.ts`:

```ts
import { canonicalIsbn } from "@scripta/shared";
import { SourcePausedError, SourceUnavailableError } from "./domain/errors.js";
import { hasCopyrightSign, retitle, retitleRepairs, textOf, type BookText } from "./domain/lossy.js";
import type { BookCatalog, BooksRepository } from "./domain/ports.js";
import type { LossyBook } from "./domain/types.js";
import type { MojibakeApplied, MojibakePlan } from "./seed/mojibakeRepair.js";

export const RETITLE_BATCH_SIZE = 25;

export interface RetitleJobDeps {
  repo: Pick<BooksRepository, "listRetitleWanted" | "clearRetitleWanted">;
  isbndb: Pick<BookCatalog, "search">;
  write: (plan: Pick<MojibakePlan, "books" | "works">) => MojibakeApplied;
  info: (details: object, message: string) => void;
  warn: (details: object, message: string) => void;
}

function applyRetitle(deps: RetitleJobDeps, book: LossyBook, next: BookText): boolean {
  const repairs = retitleRepairs(book, next, "isbndb");
  return deps.write({ books: [repairs.book], works: repairs.work ? [repairs.work] : [] }).books === 1;
}

export async function retitleWanted(deps: RetitleJobDeps, limit: number, signal?: AbortSignal): Promise<number | null> {
  for (const book of deps.repo.listRetitleWanted(limit)) {
    if (signal?.aborted) return null;
    const isbn = canonicalIsbn(book.isbn ?? "");
    if (isbn && hasCopyrightSign(book)) {
      try {
        const hit = (await deps.isbndb.search({ isbn }))[0]?.result;
        const next = hit ? retitle(book, { titles: [hit.title], authors: hit.authors }) : null;
        if (next && applyRetitle(deps, book, next)) {
          deps.info({ bookId: book.id, from: textOf(book), to: textOf(next) }, "lossy book re-titled");
          if (hasCopyrightSign(next)) deps.info({ bookId: book.id, text: textOf(next) }, "lossy book left");
        } else {
          deps.info({ bookId: book.id, text: textOf(book) }, "lossy book left");
        }
      } catch (error) {
        if (error instanceof SourcePausedError) return error.retryAt;
        if (!(error instanceof SourceUnavailableError)) throw error;
        deps.warn({ bookId: book.id, source: error.source, error: error.message }, "lossy title source unavailable");
        continue;
      }
    }
    deps.repo.clearRetitleWanted(book.id);
  }
  return null;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/retitleJob.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Wire it into `plugin.ts`.**
  - Imports: add `import { RETITLE_BATCH_SIZE, retitleWanted } from "./retitleJob.js";` and `import { applyMojibakeRepairs } from "./seed/mojibakeRepair.js";`.
  - Keep the database handle. Replace

```ts
  const repo = timedMethods(createSqliteBooksRepository(timeStep(app.log, "startup:books-open", openBooksDb)), app.log, "books");
```

with

```ts
  const booksDb = timeStep(app.log, "startup:books-open", openBooksDb);
  const repo = timedMethods(createSqliteBooksRepository(booksDb), app.log, "books");
```

  - After the `const stopColorBackfill = …;` line, add:

```ts
  const retitleIsbndb = isbndbConfigured ? createIsbndbCatalog(env.ISBNDB_API_KEY, isbndbThrottle, isbndbGate, false) : null;
  const stopRetitleJob = retitleIsbndb
    ? startDetailsBackfill(
        (signal) => retitleWanted({
          repo,
          isbndb: retitleIsbndb,
          write: (plan) => applyMojibakeRepairs(booksDb, plan),
          info: (details, message) => app.log.info(details, message),
          warn: (details, message) => app.log.warn(details, message)
        }, RETITLE_BATCH_SIZE, signal),
        (error) => app.log.error({ err: error }, "lossy retitle failed")
      )
    : null;
```

  - In the `onClose` hook, after `stopColorBackfill();`, add `stopRetitleJob?.();`.

- [ ] **Step 6: Add the test to the list.** In `backend/package.json`'s `test` script, insert ` src/modules/books/retitleJob.test.ts` directly after `src/modules/books/booksService.test.ts`.

- [ ] **Step 7: Check the app still boots without a key.** `src/booksWiring.test.ts` builds the whole app with no `ISBNDB_API_KEY`, so the job isn't started. This is the spec's "isn't started without a key", through the same `isbndbConfigured` guard every other ISBNdb consumer in `plugin.ts` uses.

Run: `npm run typecheck --workspace backend && npm exec --workspace backend -- tsx --test src/booksWiring.test.ts src/modules/books/retitleJob.test.ts`
Expected: typecheck clean, PASS.

- [ ] **Step 8: Document the job.** In `backend/README.md`'s `books` section, directly after the bullet that starts `- **The work key lookup fills Open Library work keys by ISBN.**`, add:

```markdown
- **New books whose letters were lost to `©` are re-titled from ISBNdb.** `createBook` stamps `books.retitle_wanted_at` when a new book's title or author has a `©` between two letters (`N©o`) and its ISBN is valid, so every path that adds a book is covered, the publisher importer included. On boot and every 10 minutes, up to 25 stamped books, oldest first, are looked up with `GET /book/{isbn}` through the shared ISBNdb gate and throttle on the normal lane, and changed by the same rule and writes as `scripts/retitle-lossy.mjs` (see "Lossy titles"). The stamp is cleared once ISBNdb answers, whether or not anything changed, so a miss isn't asked again; an outage keeps it, and a pause holds the job until it lifts. Each change, and each book left with a `©`, is logged at info level (`lossy book re-titled`, `lossy book left`). Books stored before the stamp existed have none; the script handles them. Not started without `ISBNDB_API_KEY`.
```

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/books/retitleJob.ts backend/src/modules/books/retitleJob.test.ts backend/src/modules/books/plugin.ts backend/package.json backend/README.md && git commit -m "Re-title new books whose letters were lost to © from ISBNdb in the background"
```

---

### Task 8: Verify the branch, review it, ship it

- [ ] **Step 1: Run CI's sequence**

```bash
npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend
```

Expected: typecheck clean, every backend test passes, including the four new files.

- [ ] **Step 2: Branch review.** Dispatch the `branch-reviewer` agent with the worktree path, the spec (`docs/superpowers/specs/2026-10-15-lossy-retitle-design.md`) and this plan. Fix what it confirms, re-run Step 1, and commit.

- [ ] **Step 3: Ship.** Use the repo's `ship` skill: push, open the PR against `main` with auto-merge, and let CI decide. Deploying, and every production command below, is the owner's.

- [ ] **Step 4: Hand the owner the rollout** (spec, "Rollout"). After the owner deploys `main`:
  1. `repair-mojibake.mjs --dry-run`, then the real run, with the output saved (README "Mojibake repair").
  2. `retitle-lossy.mjs --dry-run --max 30`. The owner pastes the report, and every `retitles` entry and the `stillLossy` list are reviewed with them before step 3.
  3. `retitle-lossy.mjs --max 30`, with the output saved.
  4. Hold deploys during steps 1–3.
  5. Check: rerun the 2026-10-15 read-only count. The 25 lossy books should drop to the real run's `stillLossy`.
