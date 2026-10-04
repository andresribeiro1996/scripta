# Phase E1: Works as the Reference — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every library book and every game entry (murals, tier lists, arena, quizzes) is resolved to a catalog `work_id` on the server, with no change to any request or response.

**Architecture:** The books module gains `resolveWorks`/`canonicalWorks` over a lazily opened catalog DB and treats ISBN-10/13 as one edition. The library stores `work_id` per row, resolved at save, and exposes `resolveEntryWorks(owner, entries)` that every game module calls before writing. Games store `{work_id, key}`: real-row tables get columns, JSON documents get a `<module>_works` side table; the client's key is echoed verbatim. One sweep runner in `app.ts` backfills and retries NULLs every 10 minutes.

**Tech Stack:** Fastify/TypeScript, `node:sqlite` `DatabaseSync` (synchronous), `node:test` via `tsx --test`, `zod`, `@scripta/shared`.

**Spec:** `docs/superpowers/specs/2026-10-04-works-phase-e1-design.md`

## Global Constraints

- No request or response shape changes anywhere. A response returns exactly the keys the client sent.
- The shared `normalizeIsbn` (`packages/shared/src/library/covers.ts:26`) is not changed — the library's `bookKey` depends on it.
- A library save never fails because of work resolution; a game write that can't reach the catalog returns 503 `{ error }` and stores nothing.
- Every schema change is additive (new nullable columns, new tables, new indexes). No stored JSON is rewritten.
- Every new `*.test.ts` file is added to the explicit list in `backend/package.json`'s `"test"` script, or CI never runs it.
- Test preambles set every `*_DB_PATH` the code under test opens to a scratch dir before the dynamic `import`, including `COVERS_DB_PATH` (its default `./data/covers.sqlite` would write into the repo).
- No code comments (repo rule). The *why* goes in commit messages.
- Existing route tests for public payloads (shared mural, profile, tier-list voting board, arena view) stay green **without edits**; they are the golden check that responses didn't change. If one fails, the implementation is wrong, not the test.
- After each task: `cd backend && npm run typecheck && npm test`. Both must pass before committing.
- One PR per layer, in order: Books (Tasks 1–3), Library (4–7), Clients (8), Arena (9–11), Tier lists (12–14), Quizzes (15–16), Murals (17–18). The user merges; after the Library PR deploys, the user runs the check in Task 7 and NULLs with an identity must be near 0 before the Arena PR merges.

## Review Focus

1. **A boot-time row rebuild wipes work ids.** `backfillLibraryDerived` rewrites stale accounts' rows with `work_id` null; the upsert must keep the stored id when the key at that position is unchanged. Test in Task 4.
2. **Inserting a book at the front shifts every position** so every row looks changed; with the catalog down, all of that library's rows go NULL and must be refilled by the sweep, not left NULL. Test in Task 7.
3. **A big import resolves thousands of books in one save.** 2,000 lookups must finish in one transaction well under the import stall budget. Test in Task 3.
4. **A ballot submitted before the sweep has filled a list's side table** must still save, with a NULL `work_id` that the sweep later fills. Test in Task 14.
5. **A promoted tier list whose creator deleted their account** must still resolve from its `public_books` snapshot. Test in Task 14.

---

## PR 1 — Books

### Task 1: ISBN-10/13 are one edition; reusable find-or-create; re-entrant transactions

**Files:**
- Create: `backend/src/modules/books/domain/findOrCreate.ts`
- Modify: `backend/src/modules/books/domain/normalize.ts:1,43-49,94-101`
- Modify: `backend/src/modules/books/booksService.ts:2,80-107,168-177,304,314`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts:94-104` (and the returned object)
- Modify: `backend/src/modules/books/domain/ports.ts:10-38`
- Test: `backend/src/modules/books/domain/normalize.test.ts`, `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- Produces: `BookIdentity.aliasKeys: string[]`; `findOrCreateBook(repo: BooksRepository, lookup: BookLookup, createdAt: string): BookRow | null`; `BooksRepository.transaction<T>(write: () => T): T` (re-entrant: inside an open transaction it just runs `write`).

- [ ] **Step 1: Write the failing tests**

In `normalize.test.ts`:

```ts
test("lookupIdentity keys an ISBN-10 by its ISBN-13 and keeps the ISBN-10 as an alias", () => {
  const identity = lookupIdentity({ isbn: "0-441-01359-7", title: "Dune", author: "Frank Herbert" })!;
  assert.equal(identity.key, "isbn:9780441013593");
  assert.equal(identity.isbn, "9780441013593");
  assert.deepEqual(identity.aliasKeys, ["isbn:0441013597"]);
});

test("lookupIdentity has no alias for an ISBN-13 or a title-only lookup", () => {
  assert.deepEqual(lookupIdentity({ isbn: "9780441013593", title: "Dune", author: "" })!.aliasKeys, []);
  assert.deepEqual(lookupIdentity({ title: "Dune", author: "Frank Herbert" })!.aliasKeys, []);
});
```

In `booksService.test.ts`:

```ts
test("an ISBN-10 and its ISBN-13 resolve to one edition", () => {
  const { service, db } = harness();
  service.resolveCover({ isbn: "0441013597", title: "Dune", author: "Frank Herbert" });
  service.resolveCover({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 1);
  const keys = (db.prepare("SELECT key FROM book_keys ORDER BY key").all() as Array<{ key: string }>).map((row) => row.key);
  assert.ok(keys.includes("isbn:9780441013593"));
  assert.ok(keys.includes("isbn:0441013597"));
});

test("a lookup finds an edition stored only under its ISBN-10 key", () => {
  const { service, db, repo } = harness();
  const legacy = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597" }, ["isbn:0441013597"], "2026-01-01T00:00:00.000Z");
  service.resolveCover({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 1);
  assert.equal(repo.findBookByKey("isbn:9780441013593")?.id, legacy.id);
});

test("repo.transaction nests inside an open transaction", () => {
  const { repo } = harness();
  const book = repo.transaction(() => repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: null }, ["ta:orlando|woolf|"], "2026-01-01T00:00:00.000Z"));
  assert.ok(repo.getBook(book.id));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx tsx --test src/modules/books/domain/normalize.test.ts src/modules/books/booksService.test.ts`
Expected: FAIL (`aliasKeys` undefined; two `books` rows; `repo.transaction is not a function`).

- [ ] **Step 3: Implement**

`normalize.ts` — import `canonicalIsbn` alongside the existing imports, add `aliasKeys` to `BookIdentity`, and rewrite `lookupIdentity` (leave `hasIsbnPrefix` on `normalizeIsbn`; it picks prefix tables by length):

```ts
import { canonicalIsbn, firstAuthor, normalizeIsbn, normalizeTitle, normalizeWords, titleNumbers } from "@scripta/shared";

export interface BookIdentity {
  key: string;
  aliasKeys: string[];
  titleKey: string | null;
  isbn: string | null;
  title: string;
  author: string;
}

export function lookupIdentity(lookup: BookLookup): BookIdentity | null {
  const raw = normalizeIsbn(lookup.isbn ?? "").toUpperCase();
  const isbn = canonicalIsbn(raw) || null;
  const title = (lookup.title ?? "").trim();
  const author = (lookup.author ?? "").trim();
  const titleKey = catalogTitleKey(title, author);
  if (isbn) return { key: `isbn:${isbn}`, aliasKeys: raw.length === 10 ? [`isbn:${raw}`] : [], titleKey, isbn, title, author };
  return titleKey ? { key: titleKey, aliasKeys: [], titleKey, isbn: null, title, author } : null;
}
```

`findByIdentity` checks the alias keys too:

```ts
export function findByIdentity(repo: Pick<BooksRepository, "findBookByKey">, identity: BookIdentity): BookRow | undefined {
  for (const key of [identity.key, ...identity.aliasKeys]) {
    const found = repo.findBookByKey(key);
    if (found) return found;
  }
  return identity.titleKey && identity.titleKey !== identity.key ? repo.findBookByKey(identity.titleKey) : undefined;
}
```

Create `domain/findOrCreate.ts` by moving `keysOf`, `findExisting` and `findOrCreate` out of `createBooksService` unchanged in behaviour, taking the repo as a parameter, and adding the alias keys:

```ts
import { findByIdentity, lookupIdentity, type BookIdentity, type BookLookup } from "./normalize.js";
import type { BooksRepository } from "./ports.js";
import type { BookRow } from "./types.js";

export function keysOf(repo: BooksRepository, identity: BookIdentity): string[] {
  const titleKey = identity.titleKey;
  const own = [identity.key, ...identity.aliasKeys];
  return titleKey && titleKey !== identity.key && !repo.findBookByKey(titleKey) ? [...own, titleKey] : own;
}

export function findExisting(repo: BooksRepository, identity: BookIdentity): BookRow | undefined {
  for (const key of [identity.key, ...identity.aliasKeys]) {
    const found = repo.findBookByKey(key);
    if (found) {
      for (const alias of [identity.key, ...identity.aliasKeys]) repo.addKey(alias, found.id);
      return found;
    }
  }
  const byTitle = findByIdentity(repo, identity);
  if (!byTitle || byTitle.isbn) return undefined;
  repo.addKey(identity.key, byTitle.id);
  return byTitle;
}

export function findOrCreateBook(repo: BooksRepository, lookup: BookLookup, createdAt: string): BookRow | null {
  const identity = lookupIdentity(lookup);
  if (!identity) return null;
  const existing = findExisting(repo, identity);
  if (!existing) return repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn }, keysOf(repo, identity), createdAt);
  if (!existing.title && identity.title) {
    if (identity.titleKey) repo.addKey(identity.titleKey, existing.id);
    repo.fillIdentity(existing.id, identity.title, identity.author);
    return repo.getBook(existing.id) ?? existing;
  }
  return existing;
}
```

In `booksService.ts`: delete the three closures; replace each call with `findOrCreateBook(deps.repo, lookup, now().toISOString())`, `findExisting(deps.repo, identity)` and `keysOf(deps.repo, identity)` (the `saveHits` site at :173-175 uses the latter two). Replace `normalizeIsbn(trimmed)` at :304 and :314 with `canonicalIsbn(trimmed)` and fix the import on line 2 (drop `normalizeIsbn` if unused).

In `sqliteBooksRepository.ts` make `inTransaction` re-entrant and expose it:

```ts
function inTransaction<T>(write: () => T): T {
  if (db.isTransaction) return write();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = write();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
```

Add `transaction: inTransaction,` to the returned object and `transaction<T>(write: () => T): T;` to `BooksRepository` in `ports.ts`. If any in-memory fake of `BooksRepository` exists in tests (`rg -n "BooksRepository = \{|: BooksRepository" backend/src`), add `transaction: (write) => write()` to it.

- [ ] **Step 4: Run the books tests**

Run: `cd backend && npx tsx --test src/modules/books/**/*.test.ts src/modules/books/*.test.ts`
Expected: PASS, including every pre-existing books test.

- [ ] **Step 5: Typecheck and commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/books && git commit -m "Treat an ISBN-10 and its ISBN-13 as one catalog edition

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: One-time pass joining existing ISBN-10/13 pairs

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts:11,75` (add `joinIsbn10Editions`)
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes: `canonicalIsbn` from `@scripta/shared`.
- Produces: `PRAGMA user_version = 2` on the covers DB after the pass.

- [ ] **Step 1: Write the failing tests**

Build each fixture by migrating a fresh DB, inserting through the repo, then resetting `user_version` to 1 and re-running `applyBooksMigrations`:

```ts
function rerunPass(db: DatabaseSync) {
  db.exec("PRAGMA user_version = 1");
  applyBooksMigrations(db);
}

test("the ISBN-10 pass adds the ISBN-13 key when no edition holds it", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597" }, ["isbn:0441013597"], NOW);
  rerunPass(db);
  assert.equal(repo.findBookByKey("isbn:9780441013593")?.id, book.id);
  assert.equal(repo.getBook(book.id)?.isbn, "9780441013593");
});

test("the ISBN-10 pass merges a lone keyless work into the other edition's work", () => {
  const { db, repo } = freshRepo();
  const ten = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597" }, ["isbn:0441013597"], NOW);
  const thirteen = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL893415W" }, ["isbn:9780441013593"], NOW);
  rerunPass(db);
  assert.equal(repo.getBook(ten.id)?.work_id, thirteen.work_id);
  assert.equal(workById(db, ten.work_id).merged_into, thirteen.work_id);
  assert.equal(repo.findBookByKey("isbn:0441013597")?.id, ten.id);
});

test("the ISBN-10 pass merges the other way when only the ISBN-13 work is lone and keyless", () => {
  const { db, repo } = freshRepo();
  const ten = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597", workKey: "OL893415W" }, ["isbn:0441013597"], NOW);
  const thirteen = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], NOW);
  rerunPass(db);
  assert.equal(repo.getBook(thirteen.id)?.work_id, ten.work_id);
  assert.equal(workById(db, thirteen.work_id).merged_into, ten.work_id);
});

test("the ISBN-10 pass leaves two keyed works that disagree alone", () => {
  const { db, repo } = freshRepo();
  const ten = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "0441013597", workKey: "OL1W" }, ["isbn:0441013597"], NOW);
  const thirteen = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL2W" }, ["isbn:9780441013593"], NOW);
  rerunPass(db);
  assert.notEqual(repo.getBook(ten.id)?.work_id, repo.getBook(thirteen.id)?.work_id);
});

test("the ISBN-10 pass runs once", () => {
  const { db } = freshRepo();
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 2);
});
```

`workById(db, …)` already exists in this file; `freshRepo()` returns the post-migration `{ db, repo }`. Use `repo.getBook(ten.id)!.work_id` where TS needs a non-null id. (`createBook` takes the ISBN as given; that's why `isbn: "0441013597"` produces a legacy-shaped row.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: FAIL (no `isbn:9780441013593` key; `user_version` is 1).

- [ ] **Step 3: Implement** in `connection.ts`, called right after `backfillTitleKeys(db)`:

```ts
function joinIsbn10Editions(db: DatabaseSync): void {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version >= 2) return;
  const tens = db.prepare("SELECT key, book_id FROM book_keys WHERE key LIKE 'isbn:%' AND length(key) = 15").all() as Array<{ key: string; book_id: string }>;
  const ownerOf = db.prepare("SELECT book_id FROM book_keys WHERE key = ?");
  const addKey = db.prepare("INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)");
  const setIsbn = db.prepare("UPDATE books SET isbn = ? WHERE id = ? AND (isbn IS NULL OR length(isbn) = 10)");
  const workOf = db.prepare(`
    SELECT works.id AS id, works.ol_work_key AS ol_work_key, (SELECT COUNT(*) FROM books AS other WHERE other.work_id = works.id) AS editions
    FROM books JOIN works ON works.id = books.work_id WHERE books.id = ?
  `);
  const moveBook = db.prepare("UPDATE books SET work_id = ? WHERE id = ?");
  const mergeWork = db.prepare("UPDATE works SET merged_into = ? WHERE id = ?");
  type Work = { id: string; ol_work_key: string | null; editions: number };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { key, book_id: tenId } of tens) {
      const isbn13 = canonicalIsbn(key.slice("isbn:".length));
      if (isbn13.length !== 13) continue;
      const thirteenId = (ownerOf.get(`isbn:${isbn13}`) as { book_id: string } | undefined)?.book_id;
      if (!thirteenId) {
        addKey.run(`isbn:${isbn13}`, tenId);
        setIsbn.run(isbn13, tenId);
        continue;
      }
      if (thirteenId === tenId) continue;
      const tenWork = workOf.get(tenId) as Work | undefined;
      const thirteenWork = workOf.get(thirteenId) as Work | undefined;
      if (!tenWork || !thirteenWork || tenWork.id === thirteenWork.id) continue;
      if (!tenWork.ol_work_key && tenWork.editions === 1) {
        moveBook.run(thirteenWork.id, tenId);
        mergeWork.run(thirteenWork.id, tenWork.id);
      } else if (!thirteenWork.ol_work_key && thirteenWork.editions === 1) {
        moveBook.run(tenWork.id, thirteenId);
        mergeWork.run(tenWork.id, thirteenWork.id);
      } else {
        console.warn(`books: left ISBN-10 pair apart: ${key} (${tenWork.ol_work_key ?? "no key"}) vs isbn:${isbn13} (${thirteenWork.ol_work_key ?? "no key"})`);
      }
    }
    db.exec("PRAGMA user_version = 2");
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
```

Add `import { canonicalIsbn } from "@scripta/shared";` at the top.

- [ ] **Step 4: Run the books tests** — `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/books && git commit -m "Join catalog editions stored under an ISBN-10 and its ISBN-13

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: `resolveWorks` and `canonicalWorks`

**Files:**
- Create: `backend/src/modules/books/works.ts`, `backend/src/modules/books/works.test.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` (one statement + method), `backend/src/modules/books/domain/ports.ts`, `backend/src/modules/books/index.ts`, `backend/package.json` (test list: add `src/modules/books/works.test.ts` after `src/modules/books/booksService.test.ts`)

**Interfaces:**
- Consumes: `findOrCreateBook`, `BooksRepository.transaction` (Task 1).
- Produces (exported from `books/index.ts`):
  - `type WorkLookup = { isbn?: string | null; title?: string | null; author?: string | null }`
  - `resolveWorks(lookups: WorkLookup[]): Array<string | null>`
  - `canonicalWorks(ids: string[]): Map<string, string>`
  - Internal for tests: `resolveWorksWith(repo, lookups)`, `canonicalWorksWith(repo, ids)`; `BooksRepository.canonicalWorkIds(ids: string[]): Map<string, string>`.

- [ ] **Step 1: Write the failing tests** (`works.test.ts`; preamble like `sqliteBooksRepository.test.ts:8-17` with `COVERS_DB_PATH`, then `const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js"); const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js"); const { resolveWorksWith, canonicalWorksWith } = await import("./works.js");`):

```ts
function freshRepo() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

test("resolveWorks creates an edition and returns its work, then finds it again", () => {
  const { repo, db } = freshRepo();
  const [first] = resolveWorksWith(repo, [{ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }]);
  const [again] = resolveWorksWith(repo, [{ isbn: "0441013597", title: "Dune", author: "Frank Herbert" }]);
  assert.ok(first);
  assert.equal(again, first);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 1);
});

test("resolveWorks returns null for a lookup with neither ISBN nor title", () => {
  const { repo } = freshRepo();
  assert.deepEqual(resolveWorksWith(repo, [{ isbn: null, title: "", author: "Someone" }]), [null]);
});

test("resolveWorks and canonicalWorks follow merged_into", () => {
  const { repo, db } = freshRepo();
  const [lone] = resolveWorksWith(repo, [{ title: "Hábitos Atômicos", author: "James Clear" }]);
  const keyed = repo.createBook({ title: "Atomic Habits", author: "James Clear", isbn: "9780735211292", workKey: "OL17930368W" }, ["isbn:9780735211292"], "2026-10-04T00:00:00.000Z");
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(keyed.work_id, lone);
  assert.deepEqual(resolveWorksWith(repo, [{ title: "Hábitos Atômicos", author: "James Clear" }]), [keyed.work_id]);
  assert.equal(canonicalWorksWith(repo, [lone!]).get(lone!), keyed.work_id);
  assert.equal(canonicalWorksWith(repo, [keyed.work_id!]).get(keyed.work_id!), keyed.work_id);
});

test("resolveWorks resolves 2,000 new books in one transaction quickly", () => {
  const { repo } = freshRepo();
  const lookups = Array.from({ length: 2000 }, (_, i) => ({ title: `Book ${i}`, author: `Author ${i}` }));
  const started = performance.now();
  const ids = resolveWorksWith(repo, lookups);
  assert.equal(ids.filter(Boolean).length, 2000);
  assert.ok(performance.now() - started < 3000, `took ${performance.now() - started} ms`);
});
```

(The merge test sets `merged_into` by hand on a work that still has an edition; `resolveWorks` must still answer with the canonical id.)

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/books/works.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Repository statement and method (`sqliteBooksRepository.ts`), plus `canonicalWorkIds(ids: string[]): Map<string, string>;` in `ports.ts` (and in any in-memory fake: `canonicalWorkIds: (ids) => new Map(ids.map((id) => [id, id]))`):

```ts
const canonicalWorksStmt = db.prepare(`SELECT id, COALESCE(merged_into, id) AS canonical FROM works WHERE id IN (SELECT value FROM json_each(?))`);
// in the returned object:
canonicalWorkIds(ids) {
  const rows = canonicalWorksStmt.all(JSON.stringify(ids)) as Array<{ id: string; canonical: string }>;
  return new Map(rows.map((row) => [row.id, row.canonical]));
},
```

`works.ts`:

```ts
import { openBooksDb } from "./adapters/sqlite/connection.js";
import { createSqliteBooksRepository } from "./adapters/sqlite/sqliteBooksRepository.js";
import { findOrCreateBook } from "./domain/findOrCreate.js";
import type { BookLookup } from "./domain/normalize.js";
import type { BooksRepository } from "./domain/ports.js";

export type WorkLookup = BookLookup;

let repo: BooksRepository | null = null;

function booksRepository(): BooksRepository {
  return (repo ??= createSqliteBooksRepository(openBooksDb()));
}

export function canonicalWorksWith(books: BooksRepository, ids: string[]): Map<string, string> {
  return ids.length === 0 ? new Map() : books.canonicalWorkIds(ids);
}

export function resolveWorksWith(books: BooksRepository, lookups: WorkLookup[]): Array<string | null> {
  const createdAt = new Date().toISOString();
  const ids = books.transaction(() => lookups.map((lookup) => findOrCreateBook(books, lookup, createdAt)?.work_id ?? null));
  const canonical = canonicalWorksWith(books, ids.filter((id): id is string => id !== null));
  return ids.map((id) => (id ? canonical.get(id) ?? id : null));
}

export function resolveWorks(lookups: WorkLookup[]): Array<string | null> {
  return resolveWorksWith(booksRepository(), lookups);
}

export function canonicalWorks(ids: string[]): Map<string, string> {
  return canonicalWorksWith(booksRepository(), ids);
}
```

`index.ts` — add:

```ts
export { canonicalWorks, resolveWorks } from "./works.js";
export type { WorkLookup } from "./works.js";
```

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/books/works.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/books backend/package.json && git commit -m "Resolve catalog works for any book lookup

Opens the catalog lazily like peekCachedCoverUrls, so callers work whatever
order the plugins register in.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**PR 1 ends here.** Open it with the `ship` skill; the user merges.

---

## PR 2 — Library

### Task 4: `library_books.work_id`, kept across rewrites of the same book

**Files:**
- Modify: `backend/src/modules/library/adapters/sqlite/schema.sql:32-49`
- Modify: `backend/src/modules/library/adapters/sqlite/connection.ts:14-37`
- Modify: `backend/src/modules/library/adapters/sqlite/sqliteLibraryRepository.ts:54-59,84-119`
- Modify: `backend/src/modules/library/domain/types.ts:54-60`, `backend/src/modules/library/domain/ports.ts:8-30`
- Modify: `backend/src/modules/library/service.ts` (`bookRow` return)
- Test: `backend/src/modules/library/service.test.ts`

**Interfaces:**
- Produces: `LibraryBookRow.work_id: string | null`; `LibraryRepository.rowHashes(userId: string): Map<number, string>`; the upsert keeps a stored `work_id` when the incoming row's is null and the key at that position is unchanged.

- [ ] **Step 1: Write the failing tests** (in `service.test.ts`, using its `setup()`):

```ts
test("a row rewrite with no work id keeps the stored one for the same book", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" }] });
  db.prepare("UPDATE library_books SET work_id = 'w-dune' WHERE user_id = 'u1'").run();
  service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 }] });
  assert.equal((db.prepare("SELECT work_id FROM library_books WHERE user_id = 'u1'").get() as { work_id: string | null }).work_id, "w-dune");
});

test("a different book at the same position does not inherit the work id", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" }] });
  db.prepare("UPDATE library_books SET work_id = 'w-dune' WHERE user_id = 'u1'").run();
  service.saveLibrary("u1", { books: [{ Title: "Orlando", Attribution: "Virginia Woolf" }] });
  assert.equal((db.prepare("SELECT work_id FROM library_books WHERE user_id = 'u1'").get() as { work_id: string | null }).work_id, null);
});

test("an existing database gains library_books.work_id", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE library_books (user_id TEXT NOT NULL, position INTEGER NOT NULL, book_key TEXT NOT NULL, title TEXT, author TEXT, isbn TEXT, image_id TEXT, read_status REAL, series_number REAL, sort_order REAL, cover_url TEXT, finished_year INTEGER, row_hash TEXT NOT NULL, PRIMARY KEY (user_id, position))");
  applyLibrarySchema(db);
  const columns = (db.prepare("PRAGMA table_info(library_books)").all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(columns.includes("work_id"));
});
```

These tests run before Task 5 wires resolution in, so `setup()`'s service writes `work_id` null; the first test's second save changes the row hash and must keep `w-dune`.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/library/service.test.ts` → FAIL (`no such column: work_id`).

- [ ] **Step 3: Implement**

`schema.sql`: add `work_id TEXT,` after `finished_year INTEGER,` in `library_books`. Do **not** put the index here (an old DB would fail creating it before the column exists).

`connection.ts`, after the `share_token` retrofit:

```ts
const bookColumns = db.prepare(`PRAGMA table_info(library_books)`).all() as { name: string }[];
if (!bookColumns.some((c) => c.name === "work_id")) {
  db.exec(`ALTER TABLE library_books ADD COLUMN work_id TEXT`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_library_books_work ON library_books (work_id, user_id)`);
```

`types.ts`: add `work_id: string | null;` to `LibraryBookRow`. `service.ts` `bookRow`: add `work_id: null,` to the returned `book`.

`sqliteLibraryRepository.ts` — replace `upsertBookStmt`:

```ts
const upsertBookStmt = db.prepare(`
  INSERT INTO library_books (user_id, position, book_key, title, author, isbn, image_id, read_status, series_number, sort_order, cover_url, finished_year, row_hash, work_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (user_id, position) DO UPDATE SET
    book_key = excluded.book_key, title = excluded.title, author = excluded.author, isbn = excluded.isbn,
    image_id = excluded.image_id, read_status = excluded.read_status, series_number = excluded.series_number,
    sort_order = excluded.sort_order, cover_url = excluded.cover_url, finished_year = excluded.finished_year,
    row_hash = excluded.row_hash,
    work_id = COALESCE(excluded.work_id, CASE WHEN library_books.book_key = excluded.book_key THEN library_books.work_id END)
`);
```

Both call sites (`writeRows` and `writeSmallSave`) append `book.work_id` as the 14th argument. Add to the returned object and to `LibraryRepository` in `ports.ts`:

```ts
rowHashes(userId) {
  return new Map((listRowHashesStmt.all(userId) as Array<{ position: number; row_hash: string }>).map((row) => [row.position, row.row_hash]));
},
```

```ts
rowHashes(userId: string): Map<number, string>;
```

Any hand-written `LibraryRepository` fake (`rg -n "LibraryRepository = \{|: LibraryRepository" backend/src`) gets `rowHashes: () => new Map()`.

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/library/service.test.ts src/modules/library/adapters/sqlite/sqliteLibraryRepository.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/library && git commit -m "Store a work id on each library row

The upsert keeps a stored id when the same book is rewritten without one, so
the boot-time row rebuild never wipes resolved works.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Resolve works on every library save path

**Files:**
- Modify: `backend/src/modules/library/service.ts:14-22,285-290,292-308,329-447`
- Test: `backend/src/modules/library/service.test.ts`

**Interfaces:**
- Consumes: `resolveWorks` from `../books/index.js`; `repo.rowHashes` (Task 4).
- Produces: `export type ResolveWorks = (lookups: Array<{ isbn: string | null; title: string | null; author: string | null }>) => Array<string | null>;` and an 8th positional parameter on `createLibraryService(..., logError?: LogError, resolveWorks: ResolveWorks = resolveCatalogWorks)`.

- [ ] **Step 1: Write the failing tests** (add a `setupWorks` next to `setupMerge`):

```ts
function setupWorks(resolve: (lookups: Array<{ isbn: string | null; title: string | null; author: string | null }>) => Array<string | null>) {
  const db = memoryDb();
  const calls: number[] = [];
  const errors: string[] = [];
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", MAX_DOCUMENT_BYTES, undefined, undefined, undefined, (_error, message) => { errors.push(message); }, (lookups) => {
    calls.push(lookups.length);
    return resolve(lookups);
  });
  const workOf = (position: number) => (db.prepare("SELECT work_id FROM library_books WHERE user_id = 'u1' AND position = ?").get(position) as { work_id: string | null }).work_id;
  return { db, service, calls, errors, workOf };
}

const fakeWorks = (lookups: Array<{ title: string | null }>) => lookups.map((lookup) => `w-${lookup.title}`);

test("saving a library resolves each book's work", () => {
  const { service, workOf } = setupWorks(fakeWorks);
  service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }, { Title: "Orlando", Attribution: "Virginia Woolf" }] });
  assert.equal(workOf(0), "w-Dune");
  assert.equal(workOf(1), "w-Orlando");
});

test("an unchanged save resolves nothing", () => {
  const { service, calls } = setupWorks(fakeWorks);
  const data = { books: [{ Title: "Dune", Attribution: "Frank Herbert" }] };
  const first = service.saveLibrary("u1", data);
  service.saveLibrary("u1", data, JSON.parse(first).updatedAt);
  assert.deepEqual(calls, [1]);
});

test("a single-book change resolves only that book", () => {
  const { service, calls, workOf } = setupWorks(fakeWorks);
  service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }, { Title: "Orlando", Attribution: "Virginia Woolf" }] });
  service.applyChange("u1", { kind: "book", key: "ta:orlando|virginia woolf", patch: { ReadStatus: 2 } } as never);
  assert.deepEqual(calls, [2, 1]);
  assert.equal(workOf(1), "w-Orlando");
});

test("a catalog failure still saves the library and logs", () => {
  const { service, errors, workOf } = setupWorks(() => { throw new Error("catalog down"); });
  service.saveLibrary("u1", { books: [{ Title: "Dune", Attribution: "Frank Herbert" }] });
  assert.equal(workOf(0), null);
  assert.ok(errors.some((message) => message.startsWith("work resolve failed")));
});

test("adding a book resolves its work", () => {
  const { service, workOf } = setupWorks(fakeWorks);
  service.addBook("u1", { title: "Dune", author: "Frank Herbert" } as never);
  assert.equal(workOf(0), "w-Dune");
});
```

Before writing the `applyChange` test, read `applyLibraryChange`'s `book` change shape in `packages/shared/src/library` (`rg -n "kind: \"book\"" packages/shared/src`) and build the change object exactly as that type defines it; do the same for `addBook`'s input type in `service.ts`. Drop the `as never` casts once the literals match the real types. Read how `saveLibrary`'s return is shaped (`toLibraryDocumentText`) to get `updatedAt` correctly in the second test.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/library/service.test.ts` → FAIL (`work_id` null; 8th parameter ignored).

- [ ] **Step 3: Implement** in `service.ts`:

```ts
import { resolveWorks as resolveCatalogWorks } from "../books/index.js";

export type ResolveWorks = (lookups: Array<{ isbn: string | null; title: string | null; author: string | null }>) => Array<string | null>;
```

Add `resolveWorks: ResolveWorks = resolveCatalogWorks` as the 8th parameter of `createLibraryService`. Inside it, next to `rowsOf`:

```ts
function withWorks(userId: string, books: LibraryBookRow[]): void {
  const stored = repo.rowHashes(userId);
  const pending = books.filter((book) => stored.get(book.position) !== book.row_hash);
  if (pending.length === 0) return;
  try {
    const ids = resolveWorks(pending.map((book) => ({ isbn: book.isbn, title: book.title, author: book.author })));
    pending.forEach((book, index) => { book.work_id = ids[index] ?? null; });
  } catch (error) {
    logSkipped(error, `work resolve failed for ${userId} (${pending.length} books)`);
  }
}

function rowsWithWorks(userId: string, data: unknown): LibraryRows {
  const rows = rowsOf(userId, data);
  withWorks(userId, rows.books.map(({ book }) => book));
  return rows;
}
```

Replace `rowsOf(userId, …)` with `rowsWithWorks(userId, …)` at every `repo.upsertDocument` call: `saveLibrary`, both `addBook` sites, `mergeBooks`, and the `applyChange` upsert branch. In `applyChange`'s `updateDocumentData` branch, build the small save first and resolve its books:

```ts
const small = row && change.kind !== "add" ? smallSave(userId, previous, result.data, change, glyph !== "keep") : undefined;
if (small) withWorks(userId, small.books);
const updatedAt = small
  ? repo.updateDocumentData(userId, json, row!.updated_at, glyph, small)
  : repo.upsertDocument(userId, json, deriveLibraryData(result.data), rowsWithWorks(userId, result.data), row?.updated_at)?.updated_at;
```

Import `LibraryBookRow` and `LibraryRows` types if not already imported. The `withWorks` try/catch wraps only the `resolveWorks` call, so the repo errors still propagate.

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/library/service.test.ts` → PASS (including all existing tests: the default `resolveCatalogWorks` opens the scratch `COVERS_DB_PATH` the preamble already sets).

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/library && git commit -m "Resolve library books to works when they are saved

Only new or changed rows are resolved. A catalog failure is logged and the
save goes through; the sweep fills the gap.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: `resolveEntryWorks` for the game modules

**Files:**
- Create: `backend/src/modules/library/works.ts`, `backend/src/modules/library/works.test.ts`
- Modify: `backend/src/modules/library/index.ts`, `backend/package.json` (add `src/modules/library/works.test.ts` next to the other library tests)

**Interfaces:**
- Consumes: `resolveWorks`, `canonicalWorks` from `../books/index.js`; `openLibraryDb`.
- Produces (exported from `library/index.ts`):

```ts
export interface WorkEntry { key: string; title?: string | null; author?: string | null; isbn?: string | null }
export interface WorkRef { workId: string | null; title: string | null }
export class WorkResolutionError extends Error {}
export function resolveEntryWorks(ownerUserId: string, entries: WorkEntry[]): Map<string, WorkRef>;
export function firstDuplicateWork(keys: string[], works: Map<string, WorkRef>): WorkRef | undefined;
export function keepFirstPerWork<T>(items: T[], keyOf: (item: T) => string, works: Map<string, WorkRef>): T[];
export function workIdsByKey(keys: string[], works: Map<string, WorkRef>): Map<string, string | null>;
export function duplicateWorkMessage(ref: WorkRef): string;
```

- [ ] **Step 1: Write the failing tests** (`works.test.ts`; standard library preamble with `COVERS_DB_PATH`; build a resolver over an in-memory library DB with fake catalog functions):

```ts
const { applyLibrarySchema } = await import("./adapters/sqlite/connection.js");
const { createEntryWorksResolver, firstDuplicateWork, keepFirstPerWork, WorkResolutionError } = await import("./works.js");

function harness(resolve: (lookups: Array<{ isbn?: string | null; title?: string | null }>) => Array<string | null> = (lookups) => lookups.map((lookup) => `w-${lookup.title ?? lookup.isbn}`), canonical: Record<string, string> = {}) {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const insert = db.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, row_hash, work_id) VALUES ('u1', ?, ?, ?, ?, ?, 'h', ?)");
  const lookups: unknown[] = [];
  const resolver = createEntryWorksResolver({
    db,
    resolveWorks: (batch) => { lookups.push(...batch); return resolve(batch); },
    canonicalWorks: (ids) => new Map(ids.map((id) => [id, canonical[id] ?? id]))
  });
  return { insert, resolver, lookups };
}

test("a key in the owner's library uses its stored work, canonicalised", () => {
  const { insert, resolver, lookups } = harness(undefined, { "w-old": "w-new" });
  insert.run(0, "isbn:9780441013593", "Dune", "Frank Herbert", "9780441013593", "w-old");
  assert.deepEqual(resolver("u1", [{ key: "isbn:9780441013593" }]).get("isbn:9780441013593"), { workId: "w-new", title: "Dune" });
  assert.deepEqual(lookups, []);
});

test("a library row with no work yet resolves from the row", () => {
  const { insert, resolver } = harness();
  insert.run(0, "ta:dune|frank herbert", "Dune", "Frank Herbert", null, null);
  assert.equal(resolver("u1", [{ key: "ta:dune|frank herbert" }]).get("ta:dune|frank herbert")?.workId, "w-Dune");
});

test("a key outside the library resolves from the entry's snapshot", () => {
  const { resolver } = harness();
  assert.deepEqual(resolver("u1", [{ key: "pool-1984", title: "1984", author: "George Orwell" }]).get("pool-1984"), { workId: "w-1984", title: "1984" });
});

test("an empty key and an orphaned key get no work", () => {
  const { resolver } = harness();
  const works = resolver("u1", [{ key: "" }, { key: "ta:gone|nobody" }]);
  assert.equal(works.has(""), false);
  assert.deepEqual(works.get("ta:gone|nobody"), { workId: null, title: null });
});

test("a catalog failure becomes WorkResolutionError", () => {
  const { resolver } = harness(() => { throw new Error("locked"); });
  assert.throws(() => resolver("u1", [{ key: "x", title: "X" }]), WorkResolutionError);
});

test("firstDuplicateWork and keepFirstPerWork compare works, not keys", () => {
  const works = new Map([["a", { workId: "w1", title: "A" }], ["b", { workId: "w1", title: "B" }], ["c", { workId: null, title: null }], ["d", { workId: null, title: null }]]);
  assert.deepEqual(firstDuplicateWork(["a", "c", "d", "b"], works), { workId: "w1", title: "B" });
  assert.deepEqual(keepFirstPerWork(["a", "b", "c", "d"], (key) => key, works), ["a", "c", "d"]);
});
```

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/library/works.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `works.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { canonicalWorks, resolveWorks, type WorkLookup } from "../books/index.js";
import { openLibraryDb } from "./adapters/sqlite/connection.js";

export interface WorkEntry {
  key: string;
  title?: string | null;
  author?: string | null;
  isbn?: string | null;
}

export interface WorkRef {
  workId: string | null;
  title: string | null;
}

export class WorkResolutionError extends Error {
  constructor(cause: unknown) {
    super("The book catalog is unavailable. Try again in a moment.", { cause });
  }
}

interface ResolverDeps {
  db: DatabaseSync;
  resolveWorks: (lookups: WorkLookup[]) => Array<string | null>;
  canonicalWorks: (ids: string[]) => Map<string, string>;
}

interface LibraryWorkRow {
  book_key: string;
  work_id: string | null;
  isbn: string | null;
  title: string | null;
  author: string | null;
}

export function createEntryWorksResolver(deps: ResolverDeps) {
  const rowsStmt = deps.db.prepare(`
    SELECT book_key, work_id, isbn, title, author FROM library_books
    WHERE user_id = ? AND book_key IN (SELECT value FROM json_each(?)) ORDER BY position
  `);
  return (ownerUserId: string, entries: WorkEntry[]): Map<string, WorkRef> => {
    const byKey = new Map<string, WorkEntry>();
    for (const entry of entries) if (entry.key !== "" && !byKey.has(entry.key)) byKey.set(entry.key, entry);
    const result = new Map<string, WorkRef>();
    if (byKey.size === 0) return result;
    const rows = new Map<string, LibraryWorkRow>();
    for (const row of rowsStmt.all(ownerUserId, JSON.stringify([...byKey.keys()])) as unknown as LibraryWorkRow[]) {
      if (!rows.has(row.book_key)) rows.set(row.book_key, row);
    }
    const stored: Array<[string, string]> = [];
    const pending: Array<{ key: string; lookup: WorkLookup }> = [];
    for (const [key, entry] of byKey) {
      const row = rows.get(key);
      result.set(key, { workId: null, title: row?.title ?? entry.title ?? null });
      if (row?.work_id) stored.push([key, row.work_id]);
      else if (row) pending.push({ key, lookup: { isbn: row.isbn, title: row.title, author: row.author } });
      else if (entry.title || entry.isbn) pending.push({ key, lookup: { isbn: entry.isbn ?? null, title: entry.title ?? null, author: entry.author ?? null } });
    }
    try {
      const canonical = stored.length > 0 ? deps.canonicalWorks(stored.map(([, id]) => id)) : new Map<string, string>();
      for (const [key, id] of stored) result.get(key)!.workId = canonical.get(id) ?? id;
      const ids = pending.length > 0 ? deps.resolveWorks(pending.map((item) => item.lookup)) : [];
      pending.forEach((item, index) => { result.get(item.key)!.workId = ids[index] ?? null; });
    } catch (error) {
      throw new WorkResolutionError(error);
    }
    return result;
  };
}

let resolver: ReturnType<typeof createEntryWorksResolver> | null = null;

export function resolveEntryWorks(ownerUserId: string, entries: WorkEntry[]): Map<string, WorkRef> {
  resolver ??= createEntryWorksResolver({ db: openLibraryDb(), resolveWorks, canonicalWorks });
  return resolver(ownerUserId, entries);
}

export function firstDuplicateWork(keys: string[], works: Map<string, WorkRef>): WorkRef | undefined {
  const seen = new Set<string>();
  for (const key of keys) {
    const ref = works.get(key);
    if (!ref?.workId) continue;
    if (seen.has(ref.workId)) return ref;
    seen.add(ref.workId);
  }
  return undefined;
}

export function keepFirstPerWork<T>(items: T[], keyOf: (item: T) => string, works: Map<string, WorkRef>): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const workId = works.get(keyOf(item))?.workId;
    if (!workId) return true;
    if (seen.has(workId)) return false;
    seen.add(workId);
    return true;
  });
}

export function workIdsByKey(keys: string[], works: Map<string, WorkRef>): Map<string, string | null> {
  return new Map(keys.filter((key) => key !== "").map((key) => [key, works.get(key)?.workId ?? null]));
}

export function duplicateWorkMessage(ref: WorkRef): string {
  return `${ref.title ?? "That book"} is already here as another edition.`;
}
```

`index.ts` — add:

```ts
export { WorkResolutionError, duplicateWorkMessage, firstDuplicateWork, keepFirstPerWork, resolveEntryWorks, workIdsByKey } from "./works.js";
export type { WorkEntry, WorkRef } from "./works.js";
```

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/library/works.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/library backend/package.json && git commit -m "Let game modules resolve their book keys to works

Owner's library first, then the entry's own title and author, so curated
quiz books and arena snapshots resolve too.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The works sweep, its library step, and the production check

**Files:**
- Create: `backend/src/modules/library/worksSweep.ts`, `backend/src/modules/library/worksSweep.test.ts`, `backend/scripts/works-check.mjs`
- Modify: `backend/src/modules/library/index.ts`, `backend/src/app.ts` (after the last `app.register(...)`), `backend/package.json` (test list)

**Interfaces:**
- Consumes: `resolveWorks` from `../books/index.js`.
- Produces (exported from `library/index.ts`):

```ts
export interface SweepBatch { lastRowid: number; visited: number; resolved: number }
export type WorksSweepStep = (afterRowid: number, limit: number) => SweepBatch;
export function startWorksSweep(steps: WorksSweepStep[], log: { info(details: object, message: string): void; error(details: object, message: string): void }, intervalMs?: number, batch?: number): () => void;
export function sweepLibraryWorks(afterRowid: number, limit: number): SweepBatch;
```

- [ ] **Step 1: Write the failing tests** (`worksSweep.test.ts`, library preamble):

```ts
const { applyLibrarySchema } = await import("./adapters/sqlite/connection.js");
const { createLibraryWorksStep, startWorksSweep } = await import("./worksSweep.js");

function libraryDb() {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const insert = db.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, row_hash, work_id) VALUES (?, ?, ?, ?, ?, ?, 'h', ?)");
  return { db, insert };
}

test("the library step fills NULL work ids and skips rows with no identity", () => {
  const { db, insert } = libraryDb();
  insert.run("u1", 0, "ta:dune|frank herbert", "Dune", "Frank Herbert", null, null);
  insert.run("u1", 1, "ta:|", null, null, null, null);
  insert.run("u2", 0, "isbn:9780441013593", "Dune", "Frank Herbert", "9780441013593", "w-kept");
  const step = createLibraryWorksStep(db, (lookups) => lookups.map((lookup) => `w-${lookup.title}`));
  const batch = step(0, 250);
  assert.equal(batch.visited, 1);
  assert.equal(batch.resolved, 1);
  const works = db.prepare("SELECT work_id FROM library_books ORDER BY user_id, position").all() as Array<{ work_id: string | null }>;
  assert.deepEqual(works.map((row) => row.work_id), ["w-Dune", null, "w-kept"]);
});

test("the library step pages by rowid so unresolvable rows can't loop", () => {
  const { db, insert } = libraryDb();
  for (let i = 0; i < 3; i++) insert.run("u1", i, `ta:book ${i}|a`, `Book ${i}`, "A", null, null);
  const step = createLibraryWorksStep(db, (lookups) => lookups.map(() => null));
  const first = step(0, 2);
  const second = step(first.lastRowid, 2);
  assert.equal(first.visited, 2);
  assert.equal(second.visited, 1);
  assert.equal(step(second.lastRowid, 2).visited, 0);
});

test("a front insert during a catalog outage is refilled by the next sweep", () => {
  const { db, insert } = libraryDb();
  insert.run("u1", 0, "ta:new|a", "New", "A", null, null);
  insert.run("u1", 1, "ta:dune|frank herbert", "Dune", "Frank Herbert", null, null);
  createLibraryWorksStep(db, (lookups) => lookups.map((lookup) => `w-${lookup.title}`))(0, 250);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM library_books WHERE work_id IS NULL").get() as { n: number }).n, 0);
});

test("startWorksSweep runs every step to the end and logs what it resolved", async () => {
  const seen: Array<[string, number]> = [];
  const infos: object[] = [];
  const pages = (name: string, total: number) => (after: number, limit: number) => {
    seen.push([name, after]);
    const visited = Math.max(0, Math.min(limit, total - after));
    return { lastRowid: after + visited, visited, resolved: visited };
  };
  const stop = startWorksSweep([pages("a", 3), pages("b", 1)], { info: (details) => infos.push(details), error: () => undefined }, 60_000, 2);
  await new Promise((resolve) => setTimeout(resolve, 50));
  stop();
  assert.deepEqual(seen, [["a", 0], ["a", 2], ["b", 0]]);
  assert.deepEqual(infos, [{ resolved: 4 }]);
});
```

The third test stands in for review-focus item 2: rows a failed save left NULL are exactly what the step picks up.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/library/worksSweep.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `worksSweep.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { resolveWorks, type WorkLookup } from "../books/index.js";
import { openLibraryDb } from "./adapters/sqlite/connection.js";

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SWEEP_BATCH = 250;

export interface SweepBatch {
  lastRowid: number;
  visited: number;
  resolved: number;
}

export type WorksSweepStep = (afterRowid: number, limit: number) => SweepBatch;

interface SweepLog {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
}

export function startWorksSweep(steps: WorksSweepStep[], log: SweepLog, intervalMs = SWEEP_INTERVAL_MS, batch = SWEEP_BATCH): () => void {
  let running = false;
  let stopped = false;
  async function run() {
    if (running || stopped) return;
    running = true;
    let resolved = 0;
    try {
      for (const step of steps) {
        let after = 0;
        for (;;) {
          await new Promise(setImmediate);
          if (stopped) return;
          const page = step(after, batch);
          resolved += page.resolved;
          if (page.visited < batch) break;
          after = page.lastRowid;
        }
      }
      if (resolved > 0) log.info({ resolved }, "works sweep resolved entries");
    } catch (error) {
      log.error({ err: error }, "works sweep failed");
    } finally {
      running = false;
    }
  }
  void run();
  const timer = setInterval(() => void run(), intervalMs).unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function createLibraryWorksStep(db: DatabaseSync, resolve: (lookups: WorkLookup[]) => Array<string | null>): WorksSweepStep {
  const pendingStmt = db.prepare(`
    SELECT rowid, isbn, title, author FROM library_books
    WHERE work_id IS NULL AND rowid > ? AND (isbn IS NOT NULL OR title IS NOT NULL)
    ORDER BY rowid LIMIT ?
  `);
  const setStmt = db.prepare(`UPDATE library_books SET work_id = ? WHERE rowid = ? AND work_id IS NULL`);
  return (afterRowid, limit) => {
    const rows = pendingStmt.all(afterRowid, limit) as Array<{ rowid: number; isbn: string | null; title: string | null; author: string | null }>;
    if (rows.length === 0) return { lastRowid: afterRowid, visited: 0, resolved: 0 };
    const ids = resolve(rows.map((row) => ({ isbn: row.isbn, title: row.title, author: row.author })));
    let resolved = 0;
    rows.forEach((row, index) => {
      const id = ids[index];
      if (id && setStmt.run(id, row.rowid).changes === 1) resolved++;
    });
    return { lastRowid: rows[rows.length - 1]!.rowid, visited: rows.length, resolved };
  };
}

let libraryStep: WorksSweepStep | null = null;

export function sweepLibraryWorks(afterRowid: number, limit: number): SweepBatch {
  libraryStep ??= createLibraryWorksStep(openLibraryDb(), resolveWorks);
  return libraryStep(afterRowid, limit);
}
```

The sweep's `ids` are already canonical (Task 3). Export from `index.ts`:

```ts
export { startWorksSweep, sweepLibraryWorks } from "./worksSweep.js";
export type { SweepBatch, WorksSweepStep } from "./worksSweep.js";
```

`app.ts` — import both from `./modules/library/index.js` and, after the last `app.register(...)`:

```ts
const stopWorksSweep = startWorksSweep([sweepLibraryWorks], app.log);
app.addHook("onClose", async () => {
  stopWorksSweep();
});
```

`backend/scripts/works-check.mjs` (read-only; every section skips cleanly when its table or column isn't deployed yet):

```js
import { DatabaseSync } from "node:sqlite";

const report = {};
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
const count = (db, sql) => db.prepare(sql).get().n;

function section(name, path, check) {
  if (!path) return void (report[name] = "no path");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    report[name] = check(db);
  } finally {
    db.close();
  }
}

section("covers", process.env.COVERS_DB_PATH, (db) => ({
  userVersion: db.prepare("PRAGMA user_version").get().user_version,
  works: count(db, "SELECT COUNT(*) AS n FROM works"),
  mergedWorks: count(db, "SELECT COUNT(*) AS n FROM works WHERE merged_into IS NOT NULL"),
  isbn10KeysWithoutIsbn13: count(db, "SELECT COUNT(*) AS n FROM book_keys AS k JOIN books AS b ON b.id = k.book_id WHERE k.key LIKE 'isbn:%' AND length(k.key) = 15 AND (b.isbn IS NULL OR length(b.isbn) = 10)")
}));

section("library", process.env.LIBRARY_DB_PATH, (db) => columns(db, "library_books").includes("work_id") ? {
  rows: count(db, "SELECT COUNT(*) AS n FROM library_books"),
  nullWithIdentity: count(db, "SELECT COUNT(*) AS n FROM library_books WHERE work_id IS NULL AND (isbn IS NOT NULL OR title IS NOT NULL)"),
  nullWithoutIdentity: count(db, "SELECT COUNT(*) AS n FROM library_books WHERE work_id IS NULL AND isbn IS NULL AND title IS NULL")
} : "work_id not deployed");

section("arena", process.env.ARENA_DB_PATH, (db) => columns(db, "tournament_slots").includes("work_id") ? {
  slotsNull: count(db, "SELECT COUNT(*) AS n FROM tournament_slots WHERE work_id IS NULL AND book_key != ''"),
  duelSidesNull: count(db, "SELECT COUNT(*) AS n FROM duels WHERE book_a_work_id IS NULL OR book_b_work_id IS NULL"),
  winnersNull: count(db, "SELECT COUNT(*) AS n FROM duels WHERE winner_key IS NOT NULL AND winner_work_id IS NULL")
} : "not deployed");

for (const [name, envName, table, item, idColumn] of [
  ["tierlists", "TIERLISTS_DB_PATH", "tierlist_works", "tierlists", "tierlist_id"],
  ["quizzes", "QUIZZES_DB_PATH", "quiz_works", "quizzes", "quiz_id"],
  ["murals", "MURALS_DB_PATH", "mural_works", "murals", "mural_id"]
]) {
  section(name, process.env[envName], (db) => columns(db, table).length > 0 ? {
    itemsWithoutRows: count(db, `SELECT COUNT(*) AS n FROM ${item} WHERE NOT EXISTS (SELECT 1 FROM ${table} AS w WHERE w.${idColumn} = ${item}.id)`),
    rowsNull: count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE work_id IS NULL`),
    ...(name === "tierlists" ? { placementsNull: count(db, "SELECT COUNT(*) AS n FROM tierlist_ballot_placements WHERE work_id IS NULL") } : {})
  } : "not deployed");
}

console.log(JSON.stringify(report, null, 2));
```

`itemsWithoutRows` includes items with no book keys at all (an empty quiz, a mural of collection shelves only); read it next to `rowsNull`, not as a bug count by itself.

Add to `backend/README.md` beside the other `railway ssh` commands, under a short "Works check (phase E1)" heading:

```bash
railway ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/works-check.mjs'
```

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/library/worksSweep.test.ts` → PASS. Then against the dev data: `cd backend && LIBRARY_DB_PATH=data/dev/library.sqlite COVERS_DB_PATH=data/dev/covers.sqlite node scripts/works-check.mjs` prints JSON (paths per `docs/dev-workflow.md`; skip if no dev data exists).

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src backend/scripts/works-check.mjs backend/README.md backend/package.json && git commit -m "Sweep library rows into works and add a read-only works check

The sweep pages by rowid so rows that never resolve can't spin it, and it
retries every NULL on the next tick.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**PR 2 ends here.** After it deploys, hand the user the check command above; continue to PR 3 once `library.nullWithIdentity` is near 0.

---

## PR 3 — Clients show the new 409s

### Task 8: Web and mobile surface a 409's `error` message on the writes that gain one

**Files (read each; modify only those that don't already show the server's `error` text on a non-2xx):**
- Web: `frontend/src/pages/TierListCreatePage.tsx`, `frontend/src/pages/TierListEditorPage.tsx`, `frontend/src/components/tierlist/AddBooksSheet.tsx`, `frontend/src/pages/ArenaSeedPage.tsx`, `frontend/src/pages/QuizEditorPage.tsx`
- Mobile: `mobile/src/features/tierlists/TierlistCreateScreen.tsx`, `mobile/src/features/tierlists/TierlistEditorScreen.tsx`, `mobile/src/features/arena/ArenaSeedScreen.tsx`, `mobile/src/features/quizzes/QuizEditorScreen.tsx` (confirm paths with `rg --files mobile/src | rg -i "tierlist|arena|quiz"`)

The writes: `POST /tierlists`, `PUT /tierlists/:id`, `PUT /arenas/:id/slots`, `PUT /quizzes/:id`. Each will start returning `409 { error: "<Title> is already here as another edition." }` when a second edition of a work is added.

- [ ] **Step 1: For each write, trace the client call** to its API helper (`rg -n "/tierlists|/arenas|/quizzes" frontend/src/lib mobile/src --glob '!*.test.*'`) and the caller's error branch. Record, per call site, whether a non-2xx shows the response body's `error` string to the user.
- [ ] **Step 2: Where it doesn't, write a failing test first** in that package's existing test style for that component/hook (e.g. the API helper throws an error carrying the server message; the screen shows it), then make the minimal change using that file's existing error display (toast, inline text, `Alert`), not a new pattern. Autosave paths (tier-list and quiz editors) must surface the message without retry-looping the same rejected payload; if an autosave keeps resending, stop it on a 409 the same way it stops on other 4xx.
- [ ] **Step 3: Verify** — `cd frontend && npm run typecheck && npm run lint && npm test`; `cd mobile && npm run typecheck && npm test`.
- [ ] **Step 4: Commit** (skip the PR entirely if every site already surfaces the message; say so in the report):

```bash
git add frontend mobile && git commit -m "Show the server's message when a tier list, bracket or quiz rejects a book

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Mobile JS ships over the air; this needs no store build.

---

## PR 4 — Arena

### Task 9: Arena stores works on slots and duels and carries them through rounds

**Files:**
- Modify: `backend/src/modules/arena/adapters/sqlite/schema.sql:31-62`, `backend/src/modules/arena/adapters/sqlite/connection.ts:25-62`
- Modify: `backend/src/modules/arena/domain/types.ts` (`TournamentSlotRow`, `DuelRow` :45-63, `SeedBookInput` :82-87), `backend/src/modules/arena/domain/errors.ts:49-53`
- Modify: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts:33,48,65,~219,~248`
- Modify: `backend/src/modules/arena/service.ts:168-207,355-418`
- Test: `backend/src/modules/arena/service.test.ts`, `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts`

**Interfaces:**
- Produces: `SeedBookInput.workId?: string | null`; `TournamentSlotRow.work_id: string | null`; `DuelRow.book_a_work_id`, `book_b_work_id`, `winner_work_id: string | null`; `DuplicateBookError(title?: string)`.

- [ ] **Step 1: Write the failing tests**

Repository (`sqliteArenaRepository.test.ts`, which has `freshDb()` and `columnNames()`):

```ts
test("arena tables gain work id columns on an existing database", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE tournaments (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name_key TEXT)");
  db.exec("CREATE TABLE tournament_slots (tournament_id TEXT NOT NULL, slot_index INTEGER NOT NULL, book_key TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, cover_url TEXT, PRIMARY KEY (tournament_id, slot_index))");
  db.exec("CREATE TABLE duels (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL, round_number INTEGER NOT NULL, duel_index INTEGER NOT NULL, book_a_key TEXT NOT NULL, book_a_title TEXT NOT NULL, book_a_author TEXT NOT NULL, book_a_cover TEXT, book_b_key TEXT NOT NULL, book_b_title TEXT NOT NULL, book_b_author TEXT NOT NULL, book_b_cover TEXT, winner_key TEXT, status TEXT NOT NULL DEFAULT 'active', opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, settled_at TEXT)");
  applyArenaMigrations(db);
  assert.ok(columnNames(db, "tournament_slots").includes("work_id"));
  for (const column of ["book_a_work_id", "book_b_work_id", "winner_work_id"]) assert.ok(columnNames(db, "duels").includes(column));
});

test("settling a duel records the winner's work", () => {
  const db = freshDb();
  const repo = createSqliteArenaRepository(db);
  // insert a tournament and one duel using this file's existing fixtures/helpers, with
  // book_a_key "a", book_a_work_id "w-a", book_b_key "b", book_b_work_id "w-b"
  repo.updateDuelSettlement(duelId, "settled", "b", "2026-10-04T00:00:00.000Z");
  assert.equal((db.prepare("SELECT winner_work_id FROM duels WHERE id = ?").get(duelId) as { winner_work_id: string | null }).winner_work_id, "w-b");
});
```

Build the tournament and duel rows with the helpers this test file already uses for `insertTournament`/`insertDuels` (read the file's existing settlement test and copy its fixture, adding the three work-id fields).

Service (`service.test.ts`, in-memory fake — extend it: `replaceSlots` stores rows as given, `insertDuels` stores rows as given, `updateDuelSettlement` sets `winner_work_id` from the matching side, exactly as the SQL below does):

```ts
test("works flow from slots into round one and on to the next round's duels", () => {
  // create a 2-round (4-slot) tournament with the file's helpers; seed slots via
  // setSlotsManual with books { key: "k1".."k4", workId: "w1".."w4" }; start it;
  // settle round one so k1 and k3 win; assert the round-two duel row has
  // book_a_work_id "w1" and book_b_work_id "w3".
});

test("two editions of one work can't fill two slots", () => {
  // setSlotsManual with keys "k1" and "k2" both workId "w1" (title "Dune") throws
  // DuplicateBookError whose message includes "Dune".
});

test("random fill keeps the first edition of each work", () => {
  // bracket of 2; pool [{key:"k1",workId:"w1"},{key:"k2",workId:"w1"},{key:"k3",workId:"w3"}];
  // randomFill; slots hold exactly k1 and k3 (any order).
});

test("random fill counts distinct works against the bracket size", () => {
  // bracket of 2; pool of k1/k2 both "w1"; randomFill throws NotEnoughBooksError.
});
```

Write each body out in full using the file's existing tournament helpers (read the top of `service.test.ts` and one existing `setSlotsManual`/`randomFill` test, then mirror them); the comments above are the exact assertions to make.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/arena/service.test.ts src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`schema.sql`: add `work_id TEXT,` to `tournament_slots` (after `cover_url`); add `book_a_work_id TEXT,` after `book_a_cover`, `book_b_work_id TEXT,` after `book_b_cover`, `winner_work_id TEXT,` after `winner_key` in `duels`; append:

```sql
CREATE INDEX IF NOT EXISTS idx_tournament_slots_work ON tournament_slots(work_id);
```

`connection.ts`, before `db.exec(schema)` (existing tables only, same guard idiom as `name_key`):

```ts
const slotColumns = db.prepare(`PRAGMA table_info(tournament_slots)`).all() as { name: string }[];
if (slotColumns.length > 0 && !slotColumns.some((column) => column.name === "work_id")) {
  db.exec(`ALTER TABLE tournament_slots ADD COLUMN work_id TEXT`);
}
const duelColumns = db.prepare(`PRAGMA table_info(duels)`).all() as { name: string }[];
for (const column of ["book_a_work_id", "book_b_work_id", "winner_work_id"]) {
  if (duelColumns.length > 0 && !duelColumns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE duels ADD COLUMN ${column} TEXT`);
  }
}
```

`types.ts`: add the fields listed under Interfaces. `errors.ts`:

```ts
export class DuplicateBookError extends ArenaError {
  constructor(title?: string) {
    super(title ? `${title} is already here as another edition.` : "The same book can't fill two bracket slots.");
  }
}
```

Repository: add `work_id` / `$work_id` to `insertSlotStmt` and `replaceSlots`; add `book_a_work_id`, `book_b_work_id`, `winner_work_id` to `insertDuelStmt` and `insertDuels`; replace `updateDuelSettlementStmt`:

```ts
const updateDuelSettlementStmt = db.prepare(`
  UPDATE duels SET status = $status, winner_key = $winner_key, settled_at = $settled_at,
    winner_work_id = CASE WHEN $winner_key = book_a_key THEN book_a_work_id WHEN $winner_key = book_b_key THEN book_b_work_id END
  WHERE id = $id
`);
```

Service:
- `setSlotsManual`, after the existing key check:

```ts
const works = new Set<string>();
for (const { book } of entries) {
  if (!book.workId) continue;
  if (works.has(book.workId)) throw new DuplicateBookError(book.title);
  works.add(book.workId);
}
```

  and add `work_id: e.book.workId ?? null` to each row.
- `randomFill`: before the `NotEnoughBooksError` check, `const seen = new Set<string>(); const unique = pool.filter((book) => !book.workId || (!seen.has(book.workId) && (seen.add(book.workId), true)));` then use `unique` for the length check and the shuffle; add `work_id: book.workId ?? null` to rows.
- `start`: map slots with `workId: s.work_id`.
- `buildDuelsForRound`: `book_a_work_id: a.workId ?? null`, `book_b_work_id: b.workId ?? null`, `winner_work_id: null`.
- `winnerBookFromDuel`: add `workId: d.book_a_work_id` / `workId: d.book_b_work_id` to the two branches.

- [ ] **Step 4: Run** — same command as Step 2 → PASS, plus `npx tsx --test src/modules/arena/routes.test.ts` still PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/arena && git commit -m "Store works on arena slots and duels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Arena routes resolve works; duplicates are 409

**Files:**
- Modify: `backend/src/modules/arena/routes.ts:8-22,115-140`
- Test: `backend/src/modules/arena/routes.test.ts` (preamble: add `process.env.COVERS_DB_PATH ??= join(scratch, "covers.sqlite");` before the imports)

**Interfaces:**
- Consumes: `resolveEntryWorks`, `WorkResolutionError` from `../library/index.js`; `DuplicateBookError(title)` (Task 9).

- [ ] **Step 1: Write the failing tests** (Fastify inject; bearer token = user id; reuse this file's tournament-creation helper):

```ts
test("PUT slots echoes keys and stores each slot's work", async () => {
  // create a tournament as "u1"; PUT /arenas/:id/slots with two books
  // { key: "ta:dune|frank herbert", title: "Dune", author: "Frank Herbert", cover: null } and
  // { key: "ta:orlando|virginia woolf", title: "Orlando", author: "Virginia Woolf", cover: null };
  // expect 204; GET /arenas/:id returns slots[].key exactly those two strings;
  // the slots table has a non-null work_id for both.
});

test("PUT slots with two editions of one work is a 409 naming it", async () => {
  // two slots: { key: "isbn:0441013597", title: "Dune", ... } and { key: "isbn:9780441013593", title: "Dune", ... };
  // expect 409 and body.error includes "Dune".
});
```

Write them out fully against the file's existing helpers. Both editions resolve to one work because Task 1 treats the ISBN-10 and ISBN-13 as one edition.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/arena/routes.test.ts` → FAIL (no work ids; 204 on the duplicate).

- [ ] **Step 3: Implement**

Imports: add `DuplicateBookError` to the errors import and `import { resolveEntryWorks, WorkResolutionError, type WorkRef } from "../library/index.js";`. In `statusForArenaError` add `if (err instanceof DuplicateBookError) return 409;`. A helper in `routes.ts`:

```ts
function withWorks<T extends { key: string; title: string; author: string }>(works: Map<string, WorkRef>, book: T): T & { workId: string | null } {
  return { ...book, workId: works.get(book.key)?.workId ?? null };
}
```

Slots handler, before `service.setSlotsManual`:

```ts
let works: Map<string, WorkRef>;
try {
  works = resolveEntryWorks(request.user.id, body.data.slots.map((slot) => slot.book));
} catch (err) {
  if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });
  throw err;
}
service.setSlotsManual(params.data.id, request.user.id, body.data.slots.map((slot) => ({ ...slot, book: withWorks(works, slot.book) })));
```

Random-fill handler: the same `try` around `resolveEntryWorks(request.user.id, body.data.pool)`, then `service.randomFill(params.data.id, request.user.id, body.data.pool.map((book) => withWorks(works, book)))`.

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/arena/routes.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/arena && git commit -m "Resolve arena books to works and reject a second edition of one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Arena sweep step and work-aware rekey

**Files:**
- Create: `backend/src/modules/arena/worksSweep.ts`, `backend/src/modules/arena/worksSweep.test.ts`
- Modify: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.ts:139-162`, `backend/src/modules/arena/domain/ports.ts`, `backend/src/modules/arena/plugin.ts:62-72`, `backend/src/modules/arena/index.ts`, `backend/src/app.ts:164-166` and the `startWorksSweep` call, `backend/package.json`
- Test: `backend/src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts`

**Interfaces:**
- Consumes: `WorksSweepStep`, `SweepBatch`, `resolveEntryWorks`, `WorkEntry`, `WorkRef` from `../library/index.js`.
- Produces: `ArenaRepository.rekeyBooks(userId, fromKeys, toKey, toWork: string | null)`; `rekeyArenaBooks(userId, fromKeys, toKey, toWork)`; `sweepArenaWorks: WorksSweepStep`; `createArenaWorksStep(db, resolve)`.

- [ ] **Step 1: Write the failing tests**

`worksSweep.test.ts` (arena preamble):

```ts
const { applyArenaMigrations } = await import("./adapters/sqlite/connection.js");
const { createArenaWorksStep } = await import("./worksSweep.js");

test("the arena step fills slot and duel works from titles, then the winner", () => {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  // insert tournament t1 owned by "u1" (status 'active', using the columns schema.sql requires),
  // slots k1 "Dune"/"Frank Herbert" and k2 "Orlando"/"Virginia Woolf" with work_id NULL,
  // and one settled duel k1 vs k2 with winner_key "k2" and all work ids NULL.
  const calls: Array<[string, string[]]> = [];
  const step = createArenaWorksStep(db, (owner, entries) => {
    calls.push([owner, entries.map((entry) => entry.key)]);
    return new Map(entries.map((entry) => [entry.key, { workId: `w-${entry.title}`, title: entry.title ?? null }]));
  });
  const batch = step(0, 250);
  assert.equal(batch.visited, 1);
  assert.deepEqual(calls, [["u1", ["k1", "k2"]]]);
  const duel = db.prepare("SELECT book_a_work_id, book_b_work_id, winner_work_id FROM duels").get();
  assert.deepEqual({ ...duel }, { book_a_work_id: "w-Dune", book_b_work_id: "w-Orlando", winner_work_id: "w-Orlando" });
  assert.equal(step(batch.lastRowid, 250).visited, 0);
});
```

Repository test:

```ts
test("rekeying a seeding tournament moves the slot to the kept copy's work", () => {
  // seeding tournament for "u1" with slot k-old (work_id "w-old");
  // repo.rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  // the slot now has book_key "k-keep" and work_id "w-keep".
});
```

Write the inserts out against `schema.sql`'s required columns.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/arena/worksSweep.test.ts src/modules/arena/adapters/sqlite/sqliteArenaRepository.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`worksSweep.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { resolveEntryWorks, type SweepBatch, type WorkEntry, type WorkRef, type WorksSweepStep } from "../library/index.js";
import { openArenaDb } from "./adapters/sqlite/connection.js";

type Resolve = (ownerUserId: string, entries: WorkEntry[]) => Map<string, WorkRef>;

export function createArenaWorksStep(db: DatabaseSync, resolve: Resolve): WorksSweepStep {
  const pendingStmt = db.prepare(`
    SELECT rowid, id, owner_user_id FROM tournaments
    WHERE rowid > ? AND (
      EXISTS (SELECT 1 FROM tournament_slots s WHERE s.tournament_id = tournaments.id AND s.work_id IS NULL)
      OR EXISTS (SELECT 1 FROM duels d WHERE d.tournament_id = tournaments.id AND (d.book_a_work_id IS NULL OR d.book_b_work_id IS NULL OR (d.winner_key IS NOT NULL AND d.winner_work_id IS NULL)))
    )
    ORDER BY rowid LIMIT ?
  `);
  const slotsStmt = db.prepare(`SELECT book_key AS key, title, author FROM tournament_slots WHERE tournament_id = ?`);
  const duelSidesStmt = db.prepare(`
    SELECT book_a_key AS key, book_a_title AS title, book_a_author AS author FROM duels WHERE tournament_id = ?
    UNION SELECT book_b_key, book_b_title, book_b_author FROM duels WHERE tournament_id = ?
  `);
  const setSlot = db.prepare(`UPDATE tournament_slots SET work_id = ? WHERE tournament_id = ? AND book_key = ? AND work_id IS NULL`);
  const setSideA = db.prepare(`UPDATE duels SET book_a_work_id = ? WHERE tournament_id = ? AND book_a_key = ? AND book_a_work_id IS NULL`);
  const setSideB = db.prepare(`UPDATE duels SET book_b_work_id = ? WHERE tournament_id = ? AND book_b_key = ? AND book_b_work_id IS NULL`);
  const setWinners = db.prepare(`
    UPDATE duels SET winner_work_id = CASE WHEN winner_key = book_a_key THEN book_a_work_id WHEN winner_key = book_b_key THEN book_b_work_id END
    WHERE tournament_id = ? AND winner_key IS NOT NULL AND winner_work_id IS NULL
  `);
  return (afterRowid, limit): SweepBatch => {
    const tournaments = pendingStmt.all(afterRowid, limit) as Array<{ rowid: number; id: string; owner_user_id: string }>;
    let resolved = 0;
    for (const tournament of tournaments) {
      const rows = [...slotsStmt.all(tournament.id), ...duelSidesStmt.all(tournament.id, tournament.id)] as unknown as WorkEntry[];
      const entries = [...new Map(rows.map((row) => [row.key, row])).values()];
      const works = resolve(tournament.owner_user_id, entries);
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const [key, ref] of works) {
          if (!ref.workId) continue;
          resolved += setSlot.run(ref.workId, tournament.id, key).changes;
          setSideA.run(ref.workId, tournament.id, key);
          setSideB.run(ref.workId, tournament.id, key);
        }
        setWinners.run(tournament.id);
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }
    return { lastRowid: tournaments.at(-1)?.rowid ?? afterRowid, visited: tournaments.length, resolved };
  };
}

let arenaStep: WorksSweepStep | null = null;

export function sweepArenaWorks(afterRowid: number, limit: number): SweepBatch {
  arenaStep ??= createArenaWorksStep(openArenaDb(), resolveEntryWorks);
  return arenaStep(afterRowid, limit);
}
```

Export `sweepArenaWorks` from `arena/index.ts`.

Repository `rekeyBooks` gains `toWork: string | null`; the rename statement becomes `UPDATE tournament_slots SET book_key = ?, work_id = ? WHERE tournament_id = ? AND slot_index = ?` and runs with `(toKey, toWork, id, slot.slot_index)`. Update the port and the service test's fake signature. `plugin.ts`: `rekeyArenaBooks(userId: string, fromKeys: string[], toKey: string, toWork: string | null)` passes `toWork` through.

`app.ts` — add `resolveEntryWorks` to the library import, `sweepArenaWorks` to the arena import, and change the rekey closure and the sweep:

```ts
rekeyBooks: (userId: string, fromKeys: string[], toKey: string) => {
  const toWork = resolveEntryWorks(userId, [{ key: toKey }]).get(toKey)?.workId ?? null;
  rekeyArenaBooks(userId, fromKeys, toKey, toWork);
  for (const rekey of [rekeyMuralsBooks, rekeyTierlistsBooks, rekeyQuizzesBooks]) rekey(userId, fromKeys, toKey);
}
```

```ts
const stopWorksSweep = startWorksSweep([sweepLibraryWorks, sweepArenaWorks], app.log);
```

A `WorkResolutionError` from the rekey closure propagates: `mergeBooks` rekeys before saving, so the merge fails as a whole and nothing changes.

Add `src/modules/arena/worksSweep.test.ts` to the `package.json` test list next to the other arena tests.

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/arena/*.test.ts src/modules/arena/**/*.test.ts src/modules/library/service.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src backend/package.json && git commit -m "Backfill arena works and move them with merged library copies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**PR 4 ends here.**

---

## PR 5 — Tier lists

### Task 12: `tierlist_works` side table and ballot placement works

**Files:**
- Modify: `backend/src/modules/tierlists/adapters/sqlite/schema.sql:53-61`, `backend/src/modules/tierlists/adapters/sqlite/connection.ts:17-49`
- Modify: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts:11-20,77-81,112-131,151-221`
- Modify: `backend/src/modules/tierlists/domain/ports.ts:8-60`, `backend/src/modules/tierlists/service.ts:203-250`
- Test: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts`, `backend/src/modules/tierlists/service.test.ts` (fake gains the new parameters)

**Interfaces:**
- Produces: `TierlistsRepository.insert(row: TierlistRow, works?: Map<string, string | null>)`; `update(id, userId, patch, works?: Map<string, string | null>)`; `createTierlist(userId, name, data, access, publicBooks, works?)`; `updateTierlist(userId, id, patch, works?)`. Placements take their `work_id` from `tierlist_works` in SQL.

- [ ] **Step 1: Write the failing tests** (repository test, `freshDb()` exists there):

```ts
const works = (entries: Array<[string, string | null]>) => new Map(entries);

test("insert and update write the list's works in step with its data", () => {
  const db = freshDb();
  const repo = createSqliteTierlistsRepository(db);
  repo.insert(tierlistRow({ id: "t1", data: JSON.stringify({ tiers: [], pool: ["a", "b"] }) }), works([["a", "w1"], ["b", null]]));
  repo.update("t1", "u1", { data: JSON.stringify({ tiers: [], pool: ["b", "c"] }) }, works([["b", null], ["c", "w3"]]));
  const rows = db.prepare("SELECT key, work_id FROM tierlist_works WHERE tierlist_id = 't1' ORDER BY key").all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [{ key: "b", work_id: null }, { key: "c", work_id: "w3" }]);
});

test("a ballot placement takes its work from the list", () => {
  // insert a published list t1 with works a→w1; saveBallot with placement { bookKey: "a", tierId: "s" };
  // the placement row has work_id "w1".
});

test("a ballot on a list with no works rows yet still saves with a NULL work", () => {
  // published list t2 inserted without works; saveBallot placement { bookKey: "a", tierId: "s" } succeeds;
  // placement work_id is NULL.
});

test("deleting a list or a user's data clears its works", () => {
  // insert t1 for u1 with works; repo.delete("t1", "u1"); no tierlist_works rows for t1;
  // insert t2 for u1 with works; repo.deleteUserData("u1"); none for t2.
});

test("an existing database gains the placement work column", () => {
  // an old db: CREATE TABLE tierlists (...existing columns from schema.sql...),
  // tierlist_ballots, and tierlist_ballot_placements without work_id; applyTierlistsMigrations;
  // columnNames(db, "tierlist_ballot_placements") includes "work_id".
});
```

Use the file's existing `TierlistRow`/ballot fixtures (read its top; if it has no `tierlistRow` helper, add one that fills every `TierlistRow` field with the values its other tests use). Write the commented tests out in full.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`schema.sql`: add `work_id TEXT,` after `tier_id` in `tierlist_ballot_placements`, and append:

```sql
CREATE TABLE IF NOT EXISTS tierlist_works (
  tierlist_id TEXT NOT NULL,
  key         TEXT NOT NULL,
  work_id     TEXT,
  PRIMARY KEY (tierlist_id, key)
);
CREATE INDEX IF NOT EXISTS idx_tierlist_works_work ON tierlist_works(work_id);
CREATE INDEX IF NOT EXISTS idx_tierlist_placements_work ON tierlist_ballot_placements(work_id, tier_id);
```

`connection.ts`, in the existing-database branch before the schema re-run:

```ts
const placementColumns = db.prepare(`PRAGMA table_info(tierlist_ballot_placements)`).all() as { name: string }[];
if (placementColumns.length > 0 && !placementColumns.some((c) => c.name === "work_id")) {
  db.exec(`ALTER TABLE tierlist_ballot_placements ADD COLUMN work_id TEXT`);
}
```

Repository:

```ts
const deleteWorksStmt = db.prepare(`DELETE FROM tierlist_works WHERE tierlist_id = ?`);
const insertWorkStmt = db.prepare(`INSERT OR REPLACE INTO tierlist_works (tierlist_id, key, work_id) VALUES (?, ?, ?)`);

function setWorks(tierlistId: string, works: Map<string, string | null>) {
  deleteWorksStmt.run(tierlistId);
  for (const [key, workId] of works) insertWorkStmt.run(tierlistId, key, workId);
}

function inTransaction<T>(write: () => T): T {
  if (db.isTransaction) return write();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = write();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
```

- `insert(row, works)`: `inTransaction(() => { insertStmt.run(...); if (works) setWorks(row.id, works); })`.
- `update(id, userId, patch, works)`: wrap the existing body in `inTransaction`; after a successful `updateStmt.run` (row found), `if (works) setWorks(id, works)`.
- `insertPlacementStmt`:

```ts
const insertPlacementStmt = db.prepare(`
  INSERT INTO tierlist_ballot_placements (ballot_id, tierlist_id, book_key, tier_id, work_id)
  VALUES ($ballot_id, $tierlist_id, $book_key, $tier_id, (SELECT work_id FROM tierlist_works WHERE tierlist_id = $tierlist_id AND key = $book_key))
`);
```

- `delete` and `deleteUserData`: add `DELETE FROM tierlist_works WHERE tierlist_id = ?` (by id) and `DELETE FROM tierlist_works WHERE tierlist_id IN (SELECT id FROM tierlists WHERE owner_user_id = ?)` before the list rows are deleted, inside their existing transactions.

Ports and service: thread the optional `works` parameter through `insert`, `update`, `createTierlist`, `updateTierlist` exactly as named under Interfaces. The service test's in-memory fake accepts and ignores it.

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/tierlists/**/*.test.ts src/modules/tierlists/*.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/tierlists && git commit -m "Store the works behind each tier list and ballot placement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Tier-list routes resolve works; duplicates are 409

**Files:**
- Create: `backend/src/modules/tierlists/domain/boardKeys.ts`
- Modify: `backend/src/modules/tierlists/routes.ts:14-15,73-119`
- Test: `backend/src/modules/tierlists/routes.test.ts`

**Interfaces:**
- Consumes: `resolveEntryWorks`, `firstDuplicateWork`, `workIdsByKey`, `duplicateWorkMessage`, `WorkResolutionError` from `../library/index.js`.
- Produces: `boardKeys(data: unknown): string[]` (pool first, then tiers, de-duplicated, non-empty strings only).

- [ ] **Step 1: Write the failing tests** (Fastify inject against `buildTierlistRoutes`; this file already sets `COVERS_DB_PATH`):

```ts
test("creating a list echoes its keys and stores their works", async () => {
  // POST /tierlists as "u1" with data { tiers: [{ id: "s", label: "S", color: "#f00", bookKeys: [] }], pool: ["pool-a", "pool-b"] };
  // 201; response data.pool deepEquals ["pool-a", "pool-b"]; tierlist_works has two rows for the new id.
});

test("creating or updating a list with two editions of one work is a 409", async () => {
  // seed the "u1" library rows for "isbn:0441013597" and "isbn:9780441013593" (both Dune) in the
  // scratch library DB via applyLibrarySchema + INSERT INTO library_books, or via the library service;
  // POST /tierlists with both keys in the pool → 409, error mentions "Dune";
  // create a list with one of them, then PUT with both → 409.
});
```

Write them out fully. For the library rows, open the scratch `LIBRARY_DB_PATH` with `openLibraryDb()` from `../library/adapters/sqlite/connection.js` and insert two rows with `title` "Dune", the two ISBNs, and `work_id` NULL; resolution will put both on one work.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/tierlists/routes.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`domain/boardKeys.ts`:

```ts
export function boardKeys(data: unknown): string[] {
  const board = data && typeof data === "object" ? (data as { pool?: unknown; tiers?: unknown }) : {};
  const pool = Array.isArray(board.pool) ? board.pool : [];
  const tiers = Array.isArray(board.tiers) ? board.tiers : [];
  const tierKeys = tiers.flatMap((tier) => {
    const keys = tier && typeof tier === "object" ? (tier as { bookKeys?: unknown }).bookKeys : undefined;
    return Array.isArray(keys) ? keys : [];
  });
  return [...new Set([...pool, ...tierKeys].filter((key): key is string => typeof key === "string" && key !== ""))];
}
```

`routes.ts` — a local helper and its use in create and PUT:

```ts
function resolveBoard(userId: string, data: unknown): { keys: string[]; works: Map<string, WorkRef> } {
  const keys = boardKeys(data);
  return { keys, works: resolveEntryWorks(userId, keys.map((key) => ({ key }))) };
}
```

In `POST /tierlists`, after the existing duplicate and pool checks and before `resolvePublicLibraryData`:

```ts
let board: { keys: string[]; works: Map<string, WorkRef> } = { keys: [], works: new Map() };
if (data) {
  try {
    board = resolveBoard(request.user.id, data);
  } catch (err) {
    if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });
    throw err;
  }
  const duplicate = firstDuplicateWork(board.keys, board.works);
  if (duplicate) return reply.code(409).send({ error: duplicateWorkMessage(duplicate) });
}
```

and pass `workIdsByKey(board.keys, board.works)` as the new last argument of `service.createTierlist`. In `PUT /tierlists/:id`, when `body.data.data !== undefined`, do the same (503 / 409) and pass the map to `service.updateTierlist`; otherwise pass `undefined`.

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/tierlists/routes.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/tierlists && git commit -m "Resolve tier-list books to works and reject a second edition of one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Tier-list sweep step and work-aware rekey

**Files:**
- Create: `backend/src/modules/tierlists/worksSweep.ts`, `backend/src/modules/tierlists/worksSweep.test.ts`
- Modify: `backend/src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.ts:134-150`, `backend/src/modules/tierlists/domain/ports.ts`, `backend/src/modules/tierlists/plugin.ts`, `backend/src/modules/tierlists/index.ts`, `backend/src/app.ts`, `backend/package.json`

**Interfaces:**
- Consumes: `boardKeys` (Task 13), `WorksSweepStep`, `resolveEntryWorks`, `WorkEntry`, `WorkRef`.
- Produces: `sweepTierlistsWorks: WorksSweepStep`; `createTierlistsWorksStep(db, resolve)`; `rekeyBooks(userId, fromKeys, toKey, toWork)`; `rekeyTierlistsBooks(userId, fromKeys, toKey, toWork)`.

- [ ] **Step 1: Write the failing tests** (`worksSweep.test.ts`, tierlists preamble; `applyTierlistsMigrations` on `:memory:`):

```ts
test("the step resolves a list from its creator's library, then fills its placements", () => {
  // insert list t1 (origin_user_id "u1", data pool ["a","b"], public_books NULL), no works rows;
  // insert a ballot with placements a→"s" (work_id NULL).
  // step = createTierlistsWorksStep(db, fake resolving a→"w-a", b→null); step(0, 250);
  // tierlist_works rows: a→w-a, b→NULL; the placement's work_id is "w-a"; the fake was called with owner "u1".
});

test("a promoted list whose creator is gone resolves from its public_books snapshot", () => {
  // list t2: owner "__app__", origin "gone", data pool ["k1","k2"],
  // public_books [{title:"Dune",author:"Frank Herbert",isbn:null,...},{title:"Orlando",author:"Virginia Woolf",isbn:null,...}];
  // the fake asserts entries carry title "Dune" for k1 and "Orlando" for k2 and returns works from titles;
  // after the step both rows have works.
});

test("lists whose rows are all resolved are not visited again", () => {
  // after one full step over t1 with every key resolved, step(0, 250).visited is 0 for t1's rowid range.
});
```

Repository test:

```ts
test("rekeying a private list moves its works rows to the kept copy", () => {
  // private list t1 for u1, pool ["k-old"], works k-old→w-old;
  // repo.rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  // data.pool is ["k-keep"]; tierlist_works for t1 is exactly k-keep→w-keep.
});
```

Write them out fully; build `public_books` with the `PublicBookData` fields from `library/publicResolver.ts:7-14`.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/tierlists/worksSweep.test.ts src/modules/tierlists/adapters/sqlite/sqliteTierlistsRepository.test.ts` → FAIL.

- [ ] **Step 3: Implement** `worksSweep.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { resolveEntryWorks, type SweepBatch, type WorkEntry, type WorkRef, type WorksSweepStep } from "../library/index.js";
import { openTierlistsDb } from "./adapters/sqlite/connection.js";
import { boardKeys } from "./domain/boardKeys.js";

type Resolve = (ownerUserId: string, entries: WorkEntry[]) => Map<string, WorkRef>;
type SnapshotBook = { title?: string; author?: string; isbn?: string | null };

function entriesOf(data: string, publicBooks: string | null): WorkEntry[] {
  const board = JSON.parse(data) as { pool?: unknown };
  const pool = Array.isArray(board.pool) ? board.pool : [];
  const snapshot = publicBooks ? (JSON.parse(publicBooks) as SnapshotBook[]) : [];
  return boardKeys(board).map((key) => {
    const book = snapshot[pool.indexOf(key)];
    return { key, title: book?.title ?? null, author: book?.author ?? null, isbn: book?.isbn ?? null };
  });
}

export function createTierlistsWorksStep(db: DatabaseSync, resolve: Resolve): WorksSweepStep {
  const pendingStmt = db.prepare(`
    SELECT rowid, id, origin_user_id, data, public_books FROM tierlists
    WHERE rowid > ? AND (
      NOT EXISTS (SELECT 1 FROM tierlist_works w WHERE w.tierlist_id = tierlists.id)
      OR EXISTS (SELECT 1 FROM tierlist_works w WHERE w.tierlist_id = tierlists.id AND w.work_id IS NULL)
      OR EXISTS (SELECT 1 FROM tierlist_ballot_placements p WHERE p.tierlist_id = tierlists.id AND p.work_id IS NULL)
    )
    ORDER BY rowid LIMIT ?
  `);
  const deleteWorks = db.prepare(`DELETE FROM tierlist_works WHERE tierlist_id = ?`);
  const insertWork = db.prepare(`INSERT OR REPLACE INTO tierlist_works (tierlist_id, key, work_id) VALUES (?, ?, ?)`);
  const fillPlacements = db.prepare(`
    UPDATE tierlist_ballot_placements SET work_id = (SELECT w.work_id FROM tierlist_works w WHERE w.tierlist_id = tierlist_ballot_placements.tierlist_id AND w.key = tierlist_ballot_placements.book_key)
    WHERE tierlist_id = ? AND work_id IS NULL
  `);
  return (afterRowid, limit): SweepBatch => {
    const lists = pendingStmt.all(afterRowid, limit) as Array<{ rowid: number; id: string; origin_user_id: string; data: string; public_books: string | null }>;
    let resolved = 0;
    for (const list of lists) {
      const works = resolve(list.origin_user_id, entriesOf(list.data, list.public_books));
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteWorks.run(list.id);
        for (const [key, ref] of works) {
          insertWork.run(list.id, key, ref.workId);
          if (ref.workId) resolved++;
        }
        fillPlacements.run(list.id);
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }
    return { lastRowid: lists.at(-1)?.rowid ?? afterRowid, visited: lists.length, resolved };
  };
}

let tierlistsStep: WorksSweepStep | null = null;

export function sweepTierlistsWorks(afterRowid: number, limit: number): SweepBatch {
  tierlistsStep ??= createTierlistsWorksStep(openTierlistsDb(), resolveEntryWorks);
  return tierlistsStep(afterRowid, limit);
}
```

Repository `rekeyBooks(userId, fromKeys, toKey, toWork)`: after `update.run(after, now, row.id)` for a changed list, run `DELETE FROM tierlist_works WHERE tierlist_id = ? AND key IN (SELECT value FROM json_each(?))` with `(row.id, JSON.stringify(fromKeys))`, then `INSERT OR REPLACE INTO tierlist_works (tierlist_id, key, work_id) VALUES (?, ?, ?)` with `(row.id, toKey, toWork)`, all inside the existing transaction. Update the port, the service-test fake, and `plugin.ts`'s `rekeyTierlistsBooks` to take and pass `toWork`. Export `sweepTierlistsWorks` from `index.ts`.

`app.ts`: move tier lists out of the loop — `rekeyTierlistsBooks(userId, fromKeys, toKey, toWork);` — and add `sweepTierlistsWorks` after `sweepArenaWorks` in `startWorksSweep`. Add the new test file to `package.json`.

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/tierlists/*.test.ts src/modules/tierlists/**/*.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src backend/package.json && git commit -m "Backfill tier-list works and move them with merged library copies

A list resolves from its creator's library, so a promoted list still finds
the creator's copies and falls back to its snapshot once they're gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**PR 5 ends here.**

---

## PR 6 — Quizzes

### Task 15: `quiz_works`, resolution on create and update

**Files:**
- Modify: `backend/src/modules/quizzes/adapters/sqlite/schema.sql`, `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.ts:70-104,132-148`, `backend/src/modules/quizzes/domain/ports.ts:8-45`, `backend/src/modules/quizzes/service.ts` (`createQuiz`, `updateQuiz`), `backend/src/modules/quizzes/routes.ts:10,59-94`
- Test: `backend/src/modules/quizzes/routes.test.ts` (preamble already sets `COVERS_DB_PATH`), `backend/src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts`, `backend/src/modules/quizzes/service.test.ts` (fake gains params)

**Interfaces:**
- Produces: `QuizzesRepository.insert(row, works?: Map<string, string | null>)`; `update(id, userId, patch, works?)`; `createQuiz(userId, name, data, works?)`; `updateQuiz(userId, id, patch, works?)`.

- [ ] **Step 1: Write the failing tests**

Repository:

```ts
test("insert and update keep quiz_works in step; delete clears it", () => {
  // insert quiz-1 with works b0→w0; update data with works b1→w1; rows are exactly b1→w1;
  // delete("quiz-1","u1") leaves no rows; deleteUserData clears another quiz's rows.
});
```

Routes:

```ts
test("creating a quiz from a shelf keeps the first edition of each work", async () => {
  // POST /quizzes as "u1" with books
  // { key: "isbn:0441013597", title: "Dune", author: "Frank Herbert" },
  // { key: "isbn:9780441013593", title: "Dune", author: "Frank Herbert" },
  // { key: "pool-1984", title: "1984", author: "George Orwell" };
  // 201; data.books keys are ["isbn:0441013597", "pool-1984"]; quiz_works has 2 rows, both non-null.
});

test("updating a quiz with two editions of one work is a 409", async () => {
  // create a quiz with "isbn:0441013597"; PUT data.books with both Dune editions → 409 naming Dune.
});
```

Write them out fully with the file's `book(key)` helper adjusted to take a title.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/quizzes/routes.test.ts src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`schema.sql` — append:

```sql
CREATE TABLE IF NOT EXISTS quiz_works (
  quiz_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  work_id TEXT,
  PRIMARY KEY (quiz_id, key)
);
CREATE INDEX IF NOT EXISTS idx_quiz_works_work ON quiz_works(work_id);
```

Repository: the same `setWorks` + re-entrant `inTransaction` helpers as Task 12 (with `quiz_works`/`quiz_id`), used by `insert` and `update` when `works` is given; `delete` adds `DELETE FROM quiz_works WHERE quiz_id = ?` inside its transaction; `deleteUserData` adds `DELETE FROM quiz_works WHERE quiz_id IN (SELECT id FROM quizzes WHERE owner_user_id = ?)` before the quizzes delete. Thread `works` through ports and service.

Routes — import `resolveEntryWorks, keepFirstPerWork, firstDuplicateWork, workIdsByKey, duplicateWorkMessage, WorkResolutionError, type WorkRef` alongside `resolvePublicLibraryData`. Create, after the existing duplicate-key check:

```ts
let works: Map<string, WorkRef>;
try {
  works = resolveEntryWorks(request.user.id, data.books);
} catch (err) {
  if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });
  throw err;
}
const books = keepFirstPerWork(data.books, (book) => book.key, works);
const quiz = service.createQuiz(request.user.id, name, { ...data, books }, workIdsByKey(books.map((book) => book.key), works));
```

PUT, when `body.data.data` is present, after the duplicate-key check: resolve the same way (503 on `WorkResolutionError`), `firstDuplicateWork(keys, works)` → `409 { error: duplicateWorkMessage(duplicate) }`, and pass `workIdsByKey(keys, works)` to `service.updateQuiz`.

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/quizzes/*.test.ts src/modules/quizzes/**/*.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/quizzes && git commit -m "Resolve quiz books to works; a shelf keeps one edition of each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: Quiz sweep step and work-aware rekey

**Files:**
- Create: `backend/src/modules/quizzes/worksSweep.ts`, `backend/src/modules/quizzes/worksSweep.test.ts`
- Modify: `sqliteQuizzesRepository.ts:106-131`, `domain/ports.ts`, `plugin.ts`, `index.ts` (quizzes), `backend/src/app.ts`, `backend/package.json`

**Interfaces:**
- Produces: `sweepQuizzesWorks: WorksSweepStep`; `createQuizzesWorksStep(db, resolve)`; `rekeyBooks(userId, fromKeys, toKey, toWork)`; `rekeyQuizzesBooks(userId, fromKeys, toKey, toWork)`.

- [ ] **Step 1: Write the failing tests**

```ts
test("the quiz step resolves each book from the owner's library or its title", () => {
  // quiz q1 (owner u1) with data.books [{key:"k1",title:"Dune",author:"Frank Herbert"},{key:"pool-1984",title:"1984",author:"George Orwell"}], no works rows;
  // step with a fake asserting entries carry those titles; quiz_works rows exist for both; step(0,250) again visits 0 once all resolve.
});
```

```ts
test("rekeying a private quiz moves its works rows to the kept copy", () => {
  // private quiz with books k-old (works k-old→w-old); rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  // data.books[0].key "k-keep"; quiz_works exactly k-keep→w-keep.
});
```

Write them out fully.

- [ ] **Step 2: Run to verify they fail** — `cd backend && npx tsx --test src/modules/quizzes/worksSweep.test.ts src/modules/quizzes/adapters/sqlite/sqliteQuizzesRepository.test.ts` → FAIL.

- [ ] **Step 3: Implement** `worksSweep.ts` with the same shape as Task 14's, adapted:

```ts
import type { DatabaseSync } from "node:sqlite";
import { resolveEntryWorks, type SweepBatch, type WorkEntry, type WorkRef, type WorksSweepStep } from "../library/index.js";
import { openQuizzesDb } from "./adapters/sqlite/connection.js";

type Resolve = (ownerUserId: string, entries: WorkEntry[]) => Map<string, WorkRef>;

function entriesOf(data: string): WorkEntry[] {
  const parsed = JSON.parse(data) as { books?: unknown };
  const books = Array.isArray(parsed.books) ? parsed.books : [];
  return books.flatMap((book) => {
    if (!book || typeof book !== "object") return [];
    const { key, title, author } = book as { key?: unknown; title?: unknown; author?: unknown };
    return typeof key === "string" && key !== "" ? [{ key, title: typeof title === "string" ? title : null, author: typeof author === "string" ? author : null }] : [];
  });
}

export function createQuizzesWorksStep(db: DatabaseSync, resolve: Resolve): WorksSweepStep {
  const pendingStmt = db.prepare(`
    SELECT rowid, id, owner_user_id, data FROM quizzes
    WHERE rowid > ? AND (
      NOT EXISTS (SELECT 1 FROM quiz_works w WHERE w.quiz_id = quizzes.id)
      OR EXISTS (SELECT 1 FROM quiz_works w WHERE w.quiz_id = quizzes.id AND w.work_id IS NULL)
    )
    ORDER BY rowid LIMIT ?
  `);
  const deleteWorks = db.prepare(`DELETE FROM quiz_works WHERE quiz_id = ?`);
  const insertWork = db.prepare(`INSERT OR REPLACE INTO quiz_works (quiz_id, key, work_id) VALUES (?, ?, ?)`);
  return (afterRowid, limit): SweepBatch => {
    const quizzes = pendingStmt.all(afterRowid, limit) as Array<{ rowid: number; id: string; owner_user_id: string; data: string }>;
    let resolved = 0;
    for (const quiz of quizzes) {
      const works = resolve(quiz.owner_user_id, entriesOf(quiz.data));
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteWorks.run(quiz.id);
        for (const [key, ref] of works) {
          insertWork.run(quiz.id, key, ref.workId);
          if (ref.workId) resolved++;
        }
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }
    return { lastRowid: quizzes.at(-1)?.rowid ?? afterRowid, visited: quizzes.length, resolved };
  };
}

let quizzesStep: WorksSweepStep | null = null;

export function sweepQuizzesWorks(afterRowid: number, limit: number): SweepBatch {
  quizzesStep ??= createQuizzesWorksStep(openQuizzesDb(), resolveEntryWorks);
  return quizzesStep(afterRowid, limit);
}
```

Repository `rekeyBooks(..., toWork)`: when a quiz's JSON changed, inside the transaction run `DELETE FROM quiz_works WHERE quiz_id = ? AND key IN (SELECT value FROM json_each(?))` and `INSERT OR REPLACE INTO quiz_works (quiz_id, key, work_id) VALUES (?, ?, ?)` with `(row.id, toKey, toWork)`. Thread `toWork` through the port, the fake, and `plugin.ts`'s `rekeyQuizzesBooks`. Export `sweepQuizzesWorks`. In `app.ts`, call `rekeyQuizzesBooks(userId, fromKeys, toKey, toWork);` outside the loop and add `sweepQuizzesWorks` to `startWorksSweep`. Add the test file to `package.json`.

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/quizzes/*.test.ts src/modules/quizzes/**/*.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src backend/package.json && git commit -m "Backfill quiz works and move them with merged library copies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**PR 6 ends here.**

---

## PR 7 — Murals

### Task 17: `mural_works`, resolution on update

**Files:**
- Modify: `backend/src/modules/murals/adapters/sqlite/schema.sql`, `backend/src/modules/murals/adapters/sqlite/sqliteMuralsRepository.ts:51-61,87-125`, `backend/src/modules/murals/domain/ports.ts:9-53`, `backend/src/modules/murals/service.ts:111-123`, `backend/src/modules/murals/routes.ts` (PUT handler)
- Test: `backend/src/modules/murals/adapters/sqlite/sqliteMuralsRepository.test.ts`, the murals routes test file (`rg --files backend/src/modules/murals | rg routes.*test`; add `COVERS_DB_PATH` to its preamble), `backend/src/modules/murals/service.test.ts` (fake gains param)

**Interfaces:**
- Produces: `MuralsRepository.update(id, userId, patch, expectedUpdatedAt?, works?: Map<string, string | null>)`; `MuralsService.updateMural(userId, id, patch, works?)`.

- [ ] **Step 1: Write the failing tests**

Repository (`freshDb()` there execs `schema.sql`):

```ts
test("a blocks update rewrites the mural's works; a stale update writes none", () => {
  // insert mural m1 (updated_at "t0"); update with blocks + works k1→w1, expectedUpdatedAt "t0" → rows k1→w1;
  // update with expectedUpdatedAt "stale" and works k2→w2 → returns undefined and rows stay k1→w1.
});

test("deleting a mural or a user's data clears its works", () => {
  // as in Task 12's equivalent, for mural_works.
});
```

Routes:

```ts
test("saving blocks echoes them byte-for-byte and stores works for their keys", async () => {
  // create a mural as "u1"; seed u1's library with a Dune row (title, author, work_id NULL);
  // PUT blocks [{type:"spotlight", bookKey:"ta:dune|frank herbert"}, {type:"quote", mode:"rediscover", bookKey:""}];
  // response blocks deepEqual the request's; mural_works has exactly one row for "ta:dune|frank herbert" with a work.
});
```

Write them out fully; build blocks with the shape `extractReferences` reads (`blockRefs.ts`), including any `id` field the route's existing tests use.

- [ ] **Step 2: Run to verify they fail** — run the two files with `npx tsx --test` → FAIL.

- [ ] **Step 3: Implement**

`schema.sql` — append:

```sql
CREATE TABLE IF NOT EXISTS mural_works (
  mural_id TEXT NOT NULL,
  key      TEXT NOT NULL,
  work_id  TEXT,
  PRIMARY KEY (mural_id, key)
);
CREATE INDEX IF NOT EXISTS idx_mural_works_work ON mural_works(work_id);
```

Repository: `setWorks`/re-entrant `inTransaction` helpers as in Task 12 (with `mural_works`/`mural_id`); wrap `update`'s body in `inTransaction` and, only when `result.changes > 0` and `works` is given, `setWorks(id, works)`. `delete` and `deleteUserData` clear `mural_works` (by id; by `mural_id IN (SELECT id FROM murals WHERE user_id = ?)` before the murals delete). Thread `works` through ports and `updateMural` (pass it as the 5th argument of `repo.update`).

Routes — import `resolveEntryWorks, workIdsByKey, WorkResolutionError` from `../library/index.js` and `extractReferences` from `./domain/blockRefs.js`. In the PUT handler, before `service.updateMural`:

```ts
let works: Map<string, string | null> | undefined;
if (body.data.blocks !== undefined) {
  const keys = [...extractReferences(body.data.blocks).bookKeys];
  try {
    works = workIdsByKey(keys, resolveEntryWorks(request.user.id, keys.map((key) => ({ key }))));
  } catch (err) {
    if (err instanceof WorkResolutionError) return reply.code(503).send({ error: err.message });
    throw err;
  }
}
```

and pass `works` as the new last argument. No duplicate check (the spec allows two editions on a mural).

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/murals/*.test.ts src/modules/murals/**/*.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src/modules/murals && git commit -m "Store the works behind each mural's books

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 18: Mural sweep step and work-aware rekey

**Files:**
- Create: `backend/src/modules/murals/worksSweep.ts`, `backend/src/modules/murals/worksSweep.test.ts`
- Modify: `sqliteMuralsRepository.ts:62-78`, `domain/ports.ts`, `plugin.ts`, `index.ts` (murals), `backend/src/app.ts`, `backend/package.json`

**Interfaces:**
- Produces: `sweepMuralsWorks: WorksSweepStep`; `createMuralsWorksStep(db, resolve)`; `rekeyBooks(userId, fromKeys, toKey, toWork)`; `rekeyMuralsBooks(userId, fromKeys, toKey, toWork)`.

- [ ] **Step 1: Write the failing tests**

```ts
test("the mural step resolves the keys its blocks reference", () => {
  // mural m1 (user u1) blocks: spotlight k1, shelf bookKeys [k1, k2], quote rediscover "";
  // step with a fake mapping k1→w1, k2→null; mural_works rows k1→w1, k2→NULL; the fake saw keys [k1, k2] for owner u1.
});
```

```ts
test("rekeying moves a mural's works rows to the kept copy", () => {
  // mural with spotlight k-old (works k-old→w-old); rekeyBooks("u1", ["k-old"], "k-keep", "w-keep");
  // blocks now reference k-keep; mural_works exactly k-keep→w-keep.
});
```

Write them out fully.

- [ ] **Step 2: Run to verify they fail** — `npx tsx --test` on both files → FAIL.

- [ ] **Step 3: Implement** `worksSweep.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { resolveEntryWorks, type SweepBatch, type WorkEntry, type WorkRef, type WorksSweepStep } from "../library/index.js";
import { openMuralsDb } from "./adapters/sqlite/connection.js";
import { extractReferences } from "./domain/blockRefs.js";

type Resolve = (ownerUserId: string, entries: WorkEntry[]) => Map<string, WorkRef>;

export function createMuralsWorksStep(db: DatabaseSync, resolve: Resolve): WorksSweepStep {
  const pendingStmt = db.prepare(`
    SELECT rowid, id, user_id, blocks FROM murals
    WHERE rowid > ? AND (
      NOT EXISTS (SELECT 1 FROM mural_works w WHERE w.mural_id = murals.id)
      OR EXISTS (SELECT 1 FROM mural_works w WHERE w.mural_id = murals.id AND w.work_id IS NULL)
    )
    ORDER BY rowid LIMIT ?
  `);
  const deleteWorks = db.prepare(`DELETE FROM mural_works WHERE mural_id = ?`);
  const insertWork = db.prepare(`INSERT OR REPLACE INTO mural_works (mural_id, key, work_id) VALUES (?, ?, ?)`);
  return (afterRowid, limit): SweepBatch => {
    const murals = pendingStmt.all(afterRowid, limit) as Array<{ rowid: number; id: string; user_id: string; blocks: string }>;
    let resolved = 0;
    for (const mural of murals) {
      const keys = [...extractReferences(JSON.parse(mural.blocks)).bookKeys];
      const works = resolve(mural.user_id, keys.map((key) => ({ key })));
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteWorks.run(mural.id);
        for (const [key, ref] of works) {
          insertWork.run(mural.id, key, ref.workId);
          if (ref.workId) resolved++;
        }
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }
    return { lastRowid: murals.at(-1)?.rowid ?? afterRowid, visited: murals.length, resolved };
  };
}

let muralsStep: WorksSweepStep | null = null;

export function sweepMuralsWorks(afterRowid: number, limit: number): SweepBatch {
  muralsStep ??= createMuralsWorksStep(openMuralsDb(), resolveEntryWorks);
  return muralsStep(afterRowid, limit);
}
```

If `openMuralsDb` is not exported from `connection.ts`, export it (it already exists there). Repository `rekeyBooks(..., toWork)`: when a mural's blocks changed, inside the transaction delete that mural's `mural_works` rows for `fromKeys` (`key IN (SELECT value FROM json_each(?))`) and `INSERT OR REPLACE` `(mural.id, toKey, toWork)`. Thread `toWork` through the port, the service-test fake and `plugin.ts`'s `rekeyMuralsBooks`; export `sweepMuralsWorks`.

`app.ts` — every module now takes `toWork`, so the closure becomes a single loop again:

```ts
rekeyBooks: (userId: string, fromKeys: string[], toKey: string) => {
  const toWork = resolveEntryWorks(userId, [{ key: toKey }]).get(toKey)?.workId ?? null;
  for (const rekey of [rekeyMuralsBooks, rekeyTierlistsBooks, rekeyArenaBooks, rekeyQuizzesBooks]) rekey(userId, fromKeys, toKey, toWork);
}
```

```ts
const stopWorksSweep = startWorksSweep([sweepLibraryWorks, sweepArenaWorks, sweepTierlistsWorks, sweepQuizzesWorks, sweepMuralsWorks], app.log);
```

Add the test file to `package.json`.

- [ ] **Step 4: Run** — `cd backend && npx tsx --test src/modules/murals/*.test.ts src/modules/murals/**/*.test.ts` → PASS.

- [ ] **Step 5: Typecheck, full tests, commit**

```bash
cd backend && npm run typecheck && npm test
git add backend/src backend/package.json && git commit -m "Backfill mural works and move them with merged library copies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**PR 7 ends here.** After it deploys, the user runs the works check; every `*Null` count with a key should be near 0, and what remains is orphaned keys.

---

## Execution notes

- Each PR is cut from `origin/main` after the previous one merges (the `ship` skill). Tasks 1–3 can start immediately; nothing else until its PR's predecessor is on `main`.
- A `branch-reviewer` pass runs once per PR before it's opened.
- The backend `AGENTS.md` and `README.md` get a short "Works (phase E1)" note in the Library PR describing `resolveEntryWorks`, the sweep, and the check script; each game PR adds one line for its table.
