# Keyless Works Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group keyless catalog works by title key, look up missing Open Library work keys by ISBN in the background, and let the admin merge and detach works, with every merged work id still resolving.

**Architecture:** All changes live in the books module (`backend/src/modules/books`, database `covers.sqlite`). Two new `books` columns (`title_key`, `title_group_blocked_at`) feed a grouping pass that runs in the existing works tick. A new background job reuses `startDetailsBackfill` to call Open Library's `/isbn/{isbn}.json`. Repository operations (`mergeWorks`, `detachEdition`, `resolveWorkId`, `getWorkView`) back two admin routes and a cross-module `peekWorkId`.

**Tech Stack:** Node 26, TypeScript, Fastify, `node:sqlite` (`DatabaseSync`), zod, `node:test` run through `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-04-keyless-works-design.md`. Read it before starting any task.

## Global Constraints

- Work in the worktree `/Users/andreribeiro/Documents/scripta/.claude/worktrees/keyless-works`, branch `worktree-keyless-works`. Run git from the worktree root.
- No comments in code (repo rule). Put any non-obvious *why* in the commit message.
- Every read-then-write in the repository runs inside the existing `inTransaction` helper (`BEGIN IMMEDIATE`). The importer and the seed write `covers.sqlite` from other processes.
- Catch only the error you expect and let everything else propagate. No bare `catch`.
- API changes are additive. No existing route or response field changes.
- No new test files except where a task says so. `npm test --workspace backend` names its test files explicitly, and every file this plan edits is already in that list.
- Build shared before backend tests: `npm run build --workspace @scripta/shared`.
- One test file: `npm exec --workspace backend -- tsx --test src/modules/books/<path>.test.ts`. Add `--test-name-pattern "<text>"` to run a subset.
- Before each commit: `npm run typecheck --workspace backend`.
- Stage and commit in one command. Concurrent sessions share the git index.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `ta:` aliases in `book_keys` never choose a work. Only `books.title_key` groups, and only through `groupKeylessWorks`.
- Keyed works (`works.ol_work_key IS NOT NULL`) are never merged into another work.
- No `merged_into` chain is ever longer than one hop.

## Review Focus

1. **Rows written by older code.** A process still running older code (the importer or seed in another process) inserts rows with `title_key` NULL. The backfill must fill them, and the grouping pass must never treat NULL as a key. Pinned in Task 1 (`fillTitleKeys` after NULLing the column) and Task 3 (a NULL-key work is not a candidate).
2. **Skipped candidates stay skipped.** Ambiguous, blocked, mixed-key and authorless works are not returned by the query, so the drain loop in `startWorksBackfill` ends instead of spinning. Pinned in Task 3: `groupKeylessWorks` returns 0 when only skipped candidates remain.
3. **A detached edition stays detached** even after a keyed edition with its title key arrives later. Pinned in Task 3.
4. **An admin lookup with an ISBN uses only the ISBN.** It must never fall back to the title alias and silently merge a different edition. If the ISBN isn't in the catalog, the answer is 404. Pinned in Task 5.
5. **An edition leaving a grouped work through `setWorkKey` can empty that work.** Works earlier merged into it must then be repointed, or the chain becomes two hops. Pinned in Task 2.

---

### Task 1: Store each edition's title key

**Files:**
- Modify: `backend/src/modules/books/domain/normalize.ts` (add `workTitleKey` after `catalogTitleKey`, around line 92)
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql` (the `books` table)
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts:40-42` (migrations)
- Modify: `backend/src/modules/books/domain/types.ts` (`BookRow`)
- Modify: `backend/src/modules/books/domain/ports.ts` (`BooksRepository`)
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/domain/normalize.test.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces: `workTitleKey(title: string, author: string): string` in `domain/normalize.ts`. It returns `catalogTitleKey(title, author)` when both the main title and `firstAuthor(author)` are non-empty, else `""`.
- Produces: `BookRow.title_key: string | null` and `BookRow.title_group_blocked_at: string | null`.
- Produces: `BooksRepository.fillTitleKeys(limit: number): number`, the number of rows it computed.
- Produces: columns `books.title_key TEXT` and `books.title_group_blocked_at TEXT`, and the index `idx_books_title_key`.

- [ ] **Step 1: Write the failing normalize test**

Add `workTitleKey` to the import list at the top of `normalize.test.ts`, then append:

```ts
test("workTitleKey is the catalog title key only when both the title and the first author have letters", () => {
  assert.equal(workTitleKey("Dune", "Frank Herbert"), "ta:dune|frank herbert|");
  assert.equal(workTitleKey("Ensaio sobre a Cegueira", "José Saramago, Outro"), "ta:ensaio sobre a cegueira|jose saramago|");
  assert.equal(workTitleKey("The Complete Works 2", "Shakespeare"), "ta:the complete works 2|shakespeare|2");
  assert.equal(workTitleKey("Dune", ""), "");
  assert.equal(workTitleKey("Dune", "—"), "");
  assert.equal(workTitleKey("?!", "Frank Herbert"), "");
});
```

- [ ] **Step 2: Write the failing repository tests**

Append to `sqliteBooksRepository.test.ts`:

```ts
test("createBook and fillIdentity store the edition's title key, and only a titled edition gets one", () => {
  const { repo } = freshRepo();
  const dune = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], NOW);
  const authorless = repo.createBook({ title: "Dune", author: "", isbn: "9780441013594" }, ["isbn:9780441013594"], NOW);
  const untitled = repo.createBook({ title: "", author: "", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  assert.deepEqual([dune.title_key, authorless.title_key, untitled.title_key], ["ta:dune|frank herbert|", "", null]);
  assert.equal(untitled.title_group_blocked_at, null);
  repo.fillIdentity(untitled.id, "Ensaio sobre a Cegueira", "José Saramago");
  assert.equal(repo.getBook(untitled.id)!.title_key, "ta:ensaio sobre a cegueira|jose saramago|");
});

test("fillTitleKeys computes the keys stored rows lack, in batches, and leaves untitled rows for fillIdentity", () => {
  const { db, repo } = freshRepo();
  const ids = [
    repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593" }, ["isbn:9780441013593"], NOW).id,
    repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], NOW).id,
    repo.createBook({ title: "Orlando", author: "", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW).id
  ];
  const untitled = repo.createBook({ title: "", author: "", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW).id;
  db.exec("UPDATE books SET title_key = NULL");
  assert.equal(repo.fillTitleKeys(2), 2);
  assert.equal(repo.fillTitleKeys(2), 1);
  assert.equal(repo.fillTitleKeys(2), 0);
  assert.deepEqual(ids.map((id) => repo.getBook(id)!.title_key), ["ta:dune|frank herbert|", "ta:emma|jane austen|", ""]);
  assert.equal(repo.getBook(untitled)!.title_key, null);
});

test("the title key columns are added to an existing database once", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("DROP INDEX idx_books_title_key");
  db.exec("ALTER TABLE books DROP COLUMN title_key");
  db.exec("ALTER TABLE books DROP COLUMN title_group_blocked_at");
  applyBooksMigrations(db);
  applyBooksMigrations(db);
  const columns = (db.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>).map((column) => column.name);
  assert.ok(columns.includes("title_key") && columns.includes("title_group_blocked_at"));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_books_title_key'").get());
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/domain/normalize.test.ts src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: FAIL. `workTitleKey` is not exported, `title_key` is undefined, and `fillTitleKeys` is not a function.

- [ ] **Step 4: Add `workTitleKey`**

In `domain/normalize.ts`, directly after `catalogTitleKey`:

```ts
export function workTitleKey(title: string, author: string): string {
  return firstAuthor(author) ? catalogTitleKey(title, author) ?? "" : "";
}
```

- [ ] **Step 5: Add the columns**

In `books.sql`, in `CREATE TABLE IF NOT EXISTS books`, add these two lines directly after `work_checked_at     TEXT,`:

```sql
  title_key           TEXT,
  title_group_blocked_at TEXT,
```

In `connection.ts`, directly after the `work_checked_at` migration line:

```ts
  if (!columns.some((column) => column.name === "title_key")) db.exec("ALTER TABLE books ADD COLUMN title_key TEXT");
  if (!columns.some((column) => column.name === "title_group_blocked_at")) db.exec("ALTER TABLE books ADD COLUMN title_group_blocked_at TEXT");
```

and directly after `db.exec("CREATE INDEX IF NOT EXISTS idx_books_work ON books(work_id)");`:

```ts
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_title_key ON books(title_key)");
```

In `types.ts`, add these two lines to `BookRow`, directly after `work_checked_at: string | null;`:

```ts
  title_key: string | null;
  title_group_blocked_at: string | null;
```

In `ports.ts`, add to `BooksRepository`, directly after `assignMissingWorks(limit: number): number;`:

```ts
  fillTitleKeys(limit: number): number;
```

- [ ] **Step 6: Write the key in the repository**

In `sqliteBooksRepository.ts`:

Change the import line to `import { normalizeWorkKey, workTitleKey } from "../../domain/normalize.js";`.

Replace `insertBookStmt` with:

```ts
  const insertBookStmt = db.prepare(`
    INSERT INTO books (id, title, author, year, publisher, isbn, ol_cover_id, ol_work_key, work_id, genres, data_sources, created_by, title_key, created_at)
    VALUES ($id, $title, $author, $year, $publisher, $isbn, $ol_cover_id, $ol_work_key, $work_id, $genres, $data_sources, $created_by, $title_key, $created_at)
  `);
```

Replace `fillIdentityStmt` with:

```ts
  const fillIdentityStmt = db.prepare(`UPDATE books SET title = ?, author = ?, title_key = ? WHERE id = ? AND title = ''`);
```

Add these statements next to `unassignedStmt`:

```ts
  const missingTitleKeyStmt = db.prepare(`SELECT id, title, author FROM books WHERE title_key IS NULL AND title <> '' LIMIT ?`);
  const setTitleKeyStmt = db.prepare(`UPDATE books SET title_key = ? WHERE id = ?`);
```

In `createBook`, add `$title_key: input.title ? workTitleKey(input.title, input.author) : null,` to the `insertBookStmt.run({...})` object, directly before `$created_at`.

Replace `fillIdentity` with:

```ts
    fillIdentity(id, title, author) {
      inTransaction(() => {
        fillIdentityStmt.run(title, author, title ? workTitleKey(title, author) : null, id);
        fillWorkIdentityStmt.run(id);
      });
    },
```

Add after `assignMissingWorks`:

```ts
    fillTitleKeys(limit) {
      return inTransaction(() => {
        const rows = missingTitleKeyStmt.all(limit) as Array<{ id: string; title: string; author: string }>;
        for (const row of rows) setTitleKeyStmt.run(workTitleKey(row.title, row.author), row.id);
        return rows.length;
      });
    },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/domain/normalize.test.ts src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: PASS, including every existing test in both files.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck --workspace backend && git add backend/src/modules/books/domain/normalize.ts backend/src/modules/books/domain/normalize.test.ts backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/domain/types.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts && git commit -m "Store each edition's title key for grouping keyless works

book_keys gives a ta: alias to the first edition only, so grouping needs the
key on every edition. '' marks an edition with no usable title or author so
the backfill computes it once; NULL means not computed yet.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Merge, detach and resolve works

**Files:**
- Modify: `backend/src/modules/books/domain/errors.ts`
- Modify: `backend/src/modules/books/domain/types.ts` (add `WorkView`)
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes: `books.title_group_blocked_at` from Task 1.
- Produces: `class WorkMergeError extends Error` in `domain/errors.ts`, constructed as `new WorkMergeError(message)`.
- Produces: `interface WorkView { id: string; olWorkKey: string | null; title: string; author: string; editions: Array<{ id: string; isbn: string | null; title: string; author: string; olWorkKey: string | null }> }` in `domain/types.ts`.
- Produces, on `BooksRepository`:
  - `mergeWorks(fromId: string, intoId: string): string` returns the live target id.
  - `detachEdition(bookId: string, at: string): string` returns the edition's work id afterwards.
  - `resolveWorkId(id: string): string | null`
  - `getWorkView(id: string): WorkView | undefined`
- Produces, a private helper inside the repository that Task 3 uses: `mergeInto(from: string, into: string): void`. It moves every edition, fills the target's empty title and author, sets `merged_into`, and repoints works merged into `from`.

- [ ] **Step 1: Write the failing tests**

At the top of `sqliteBooksRepository.test.ts`, after the `createSqliteBooksRepository` import, add:

```ts
const { WorkMergeError } = await import("../../domain/errors.js");
```

Append:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.parse(NOW) + days * DAY_MS).toISOString();

test("mergeWorks moves every edition into the target, leaves merged_into, and keeps chains one hop long", () => {
  const { db, repo } = freshRepo();
  const empty = repo.createBook({ title: "", author: "", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const portuguese = repo.createBook({ title: "Ensaio sobre a Cegueira", author: "José Saramago", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  const english = repo.createBook({ title: "Blindness", author: "José Saramago", isbn: "9780156007757", workKey: "OL1W" }, ["isbn:9780156007757"], NOW);

  assert.equal(repo.mergeWorks(portuguese.work_id!, empty.work_id!), empty.work_id);
  assert.deepEqual([workById(db, empty.work_id).title, workById(db, empty.work_id).author], ["Ensaio sobre a Cegueira", "José Saramago"]);
  assert.equal(repo.getBook(portuguese.id)!.work_id, empty.work_id);
  assert.equal(workById(db, portuguese.work_id).merged_into, empty.work_id);

  assert.equal(repo.mergeWorks(empty.work_id!, english.work_id!), english.work_id);
  assert.deepEqual([empty.id, portuguese.id, english.id].map((id) => repo.getBook(id)!.work_id), [english.work_id, english.work_id, english.work_id]);
  assert.deepEqual([empty.work_id, portuguese.work_id].map((id) => workById(db, id).merged_into), [english.work_id, english.work_id]);
  assert.deepEqual([empty.work_id, portuguese.work_id, english.work_id].map((id) => repo.resolveWorkId(id!)), [english.work_id, english.work_id, english.work_id]);
  assert.equal(workById(db, english.work_id).title, "Blindness");
  assert.equal(repo.getBook(portuguese.id)!.ol_work_key, null);
});

test("mergeWorks resolves a merged target first", () => {
  const { repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  const c = repo.createBook({ title: "C", author: "X", isbn: "9789720000003" }, ["isbn:9789720000003"], NOW);
  repo.mergeWorks(b.work_id!, a.work_id!);
  assert.equal(repo.mergeWorks(c.work_id!, b.work_id!), a.work_id);
  assert.equal(repo.getBook(c.id)!.work_id, a.work_id);
});

test("mergeWorks refuses an unknown, merged or keyed source, an unknown target and a merge into itself, and changes nothing", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  repo.mergeWorks(b.work_id!, a.work_id!);
  const snapshot = () => ({ works: db.prepare("SELECT * FROM works ORDER BY id").all(), books: db.prepare("SELECT id, work_id FROM books ORDER BY id").all() });
  const before = snapshot();
  assert.throws(() => repo.mergeWorks("no-such-work", a.work_id!), WorkMergeError);
  assert.throws(() => repo.mergeWorks(b.work_id!, keyed.work_id!), WorkMergeError);
  assert.throws(() => repo.mergeWorks(keyed.work_id!, a.work_id!), WorkMergeError);
  assert.throws(() => repo.mergeWorks(a.work_id!, "no-such-work"), WorkMergeError);
  assert.throws(() => repo.mergeWorks(a.work_id!, b.work_id!), WorkMergeError);
  assert.deepEqual(snapshot(), before);
});

test("resolveWorkId returns null for an unknown id and throws on a chain longer than one hop", () => {
  const { db, repo } = freshRepo();
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  const c = repo.createBook({ title: "C", author: "X", isbn: "9789720000003" }, ["isbn:9789720000003"], NOW);
  assert.equal(repo.resolveWorkId("no-such-work"), null);
  assert.equal(repo.resolveWorkId(a.work_id!), a.work_id);
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(b.work_id, a.work_id);
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(c.work_id, b.work_id);
  assert.throws(() => repo.resolveWorkId(a.work_id!), /one hop/);
});

test("an edition leaving a grouped work through setWorkKey repoints the works merged into it", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Os Maias", author: "Eça de Queirós", isbn: "9789725681367", workKey: "OL846513W" }, ["isbn:9789725681367"], NOW);
  const first = repo.createBook({ title: "Maias", author: "Eça de Queirós", isbn: "9789720000001" }, ["isbn:9789720000001"], NOW);
  const second = repo.createBook({ title: "Maias", author: "Eça de Queirós", isbn: "9789720000002" }, ["isbn:9789720000002"], NOW);
  repo.mergeWorks(second.work_id!, first.work_id!);
  repo.setWorkKey(first.id, "OL846513W");
  repo.setWorkKey(second.id, "OL846513W");
  assert.equal(workById(db, first.work_id).merged_into, keyed.work_id);
  assert.equal(workById(db, second.work_id).merged_into, keyed.work_id);
  assert.equal(repo.resolveWorkId(second.work_id!), keyed.work_id);
});

test("detachEdition gives a grouped edition a keyless work of its own and blocks it, and only blocks an edition already alone", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const joined = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322" }, ["isbn:9780593099322"], NOW);
  repo.mergeWorks(joined.work_id!, keyed.work_id!);

  const own = repo.detachEdition(joined.id, at(1));
  const detached = repo.getBook(joined.id)!;
  assert.equal(detached.work_id, own);
  assert.notEqual(own, keyed.work_id);
  assert.equal(detached.title_group_blocked_at, at(1));
  assert.deepEqual([workById(db, own).ol_work_key, workById(db, own).title, workById(db, own).created_at], [null, "Dune", at(1)]);
  assert.equal(repo.getBook(keyed.id)!.work_id, keyed.work_id);

  const alone = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], NOW);
  assert.equal(repo.detachEdition(alone.id, at(2)), alone.work_id);
  assert.equal(repo.getBook(alone.id)!.title_group_blocked_at, at(2));
});

test("detachEdition refuses an edition with its own Open Library key, an edition without a work and an unknown edition", () => {
  const { db, repo } = freshRepo();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], NOW);
  const legacy = repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], NOW);
  db.prepare("UPDATE books SET work_id = NULL WHERE id = ?").run(legacy.id);
  assert.throws(() => repo.detachEdition(keyed.id, at(1)), WorkMergeError);
  assert.throws(() => repo.detachEdition(legacy.id, at(1)), WorkMergeError);
  assert.throws(() => repo.detachEdition("no-such-book", at(1)), WorkMergeError);
  assert.equal(repo.getBook(keyed.id)!.title_group_blocked_at, null);
  assert.equal(repo.getBook(legacy.id)!.title_group_blocked_at, null);
});

test("getWorkView lists a work's editions oldest first", () => {
  const { repo } = freshRepo();
  const english = repo.createBook({ title: "Blindness", author: "José Saramago", isbn: "9780156007757", workKey: "OL1W" }, ["isbn:9780156007757"], NOW);
  const portuguese = repo.createBook({ title: "Ensaio sobre a Cegueira", author: "José Saramago", isbn: "9789720000002" }, ["isbn:9789720000002"], at(1));
  repo.mergeWorks(portuguese.work_id!, english.work_id!);
  assert.deepEqual(repo.getWorkView(english.work_id!), {
    id: english.work_id,
    olWorkKey: "OL1W",
    title: "Blindness",
    author: "José Saramago",
    editions: [
      { id: english.id, isbn: "9780156007757", title: "Blindness", author: "José Saramago", olWorkKey: "OL1W" },
      { id: portuguese.id, isbn: "9789720000002", title: "Ensaio sobre a Cegueira", author: "José Saramago", olWorkKey: null }
    ]
  });
  assert.equal(repo.getWorkView("no-such-work"), undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: FAIL. `WorkMergeError` is undefined and `repo.mergeWorks` is not a function.

- [ ] **Step 3: Add the error and the view type**

Append to `domain/errors.ts`:

```ts
export class WorkMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkMergeError";
  }
}
```

Append to `domain/types.ts`:

```ts
export interface WorkView {
  id: string;
  olWorkKey: string | null;
  title: string;
  author: string;
  editions: Array<{ id: string; isbn: string | null; title: string; author: string; olWorkKey: string | null }>;
}
```

In `ports.ts`, add `WorkView` to the `./types.js` import, and add to `BooksRepository` after `fillTitleKeys`:

```ts
  mergeWorks(fromId: string, intoId: string): string;
  detachEdition(bookId: string, at: string): string;
  resolveWorkId(id: string): string | null;
  getWorkView(id: string): WorkView | undefined;
```

- [ ] **Step 4: Implement in the repository**

In `sqliteBooksRepository.ts`:
- Add `import { WorkMergeError } from "../../domain/errors.js";`.
- Add `WorkView` to the `../../domain/types.js` import.

Add these statements after `mergeEmptyWorkStmt`:

```ts
  const workLinkStmt = db.prepare(`SELECT id, ol_work_key, merged_into FROM works WHERE id = ?`);
  const moveWorkEditionsStmt = db.prepare(`UPDATE books SET work_id = ? WHERE work_id = ?`);
  const fillWorkFromEditionsStmt = db.prepare(`
    UPDATE works
    SET title = CASE WHEN title = '' THEN COALESCE((SELECT title FROM books WHERE work_id = works.id AND title <> '' ORDER BY created_at, rowid LIMIT 1), '') ELSE title END,
        author = CASE WHEN author = '' THEN COALESCE((SELECT author FROM books WHERE work_id = works.id AND author <> '' ORDER BY created_at, rowid LIMIT 1), '') ELSE author END
    WHERE id = ? AND (title = '' OR author = '')
  `);
  const markMergedStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE id = ?`);
  const repointMergedStmt = db.prepare(`UPDATE works SET merged_into = ? WHERE merged_into = ?`);
  const blockTitleGroupStmt = db.prepare(`UPDATE books SET title_group_blocked_at = ? WHERE id = ?`);
  const editionCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM books WHERE work_id = ?`);
  const workStmt = db.prepare(`SELECT id, ol_work_key, title, author FROM works WHERE id = ?`);
  const workEditionsStmt = db.prepare(`SELECT id, isbn, title, author, ol_work_key FROM books WHERE work_id = ? ORDER BY created_at, rowid`);
```

Add these helpers after `insertWork`:

```ts
  type WorkLink = { id: string; ol_work_key: string | null; merged_into: string | null };

  function liveWorkId(id: string): string | null {
    const work = workLinkStmt.get(id) as WorkLink | undefined;
    if (!work) return null;
    if (!work.merged_into) return work.id;
    const target = workLinkStmt.get(work.merged_into) as WorkLink | undefined;
    if (!target || target.merged_into) throw new Error(`Work ${id} does not resolve in one hop.`);
    return target.id;
  }

  function mergeInto(from: string, into: string) {
    moveWorkEditionsStmt.run(into, from);
    fillWorkFromEditionsStmt.run(into);
    markMergedStmt.run(into, from);
    repointMergedStmt.run(into, from);
  }
```

In `setWorkKey`, replace the line `if (book.work_id) mergeEmptyWorkStmt.run(target, book.work_id);` with:

```ts
        if (book.work_id && mergeEmptyWorkStmt.run(target, book.work_id).changes === 1) repointMergedStmt.run(target, book.work_id);
```

Add these repository methods after `fillTitleKeys`:

```ts
    mergeWorks(fromId, intoId) {
      return inTransaction(() => {
        const from = workLinkStmt.get(fromId) as WorkLink | undefined;
        if (!from) throw new WorkMergeError("No such work.");
        if (from.merged_into) throw new WorkMergeError("That work was already merged.");
        if (from.ol_work_key) throw new WorkMergeError("A work with an Open Library key is never merged into another.");
        const into = liveWorkId(intoId);
        if (!into) throw new WorkMergeError("No such work.");
        if (into === from.id) throw new WorkMergeError("Those editions already share a work.");
        mergeInto(from.id, into);
        return into;
      });
    },

    detachEdition(bookId, at) {
      return inTransaction(() => {
        const book = byIdStmt.get(bookId) as BookRow | undefined;
        if (!book) throw new WorkMergeError("No such edition.");
        if (book.ol_work_key) throw new WorkMergeError("An edition with an Open Library key stays in that work.");
        if (!book.work_id) throw new WorkMergeError("That edition has no work yet.");
        blockTitleGroupStmt.run(at, bookId);
        if ((editionCountStmt.get(book.work_id) as { n: number }).n === 1) return book.work_id;
        const own = insertWork(null, book.title, book.author, at);
        moveBookStmt.run(own, bookId);
        return own;
      });
    },

    resolveWorkId: (id) => liveWorkId(id),

    getWorkView(id) {
      const work = workStmt.get(id) as { id: string; ol_work_key: string | null; title: string; author: string } | undefined;
      if (!work) return undefined;
      const editions = workEditionsStmt.all(id) as Array<{ id: string; isbn: string | null; title: string; author: string; ol_work_key: string | null }>;
      return {
        id: work.id,
        olWorkKey: work.ol_work_key,
        title: work.title,
        author: work.author,
        editions: editions.map((edition) => ({ id: edition.id, isbn: edition.isbn, title: edition.title, author: edition.author, olWorkKey: edition.ol_work_key }))
      } satisfies WorkView;
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: PASS, including every existing `setWorkKey` test.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck --workspace backend && git add backend/src/modules/books/domain/errors.ts backend/src/modules/books/domain/types.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts && git commit -m "Merge, detach and resolve works in the books repository

A merge repoints works already merged into its source, and setWorkKey now
does the same when it empties a work, so merged_into never chains past one
hop. Keyed works are never a merge source: Open Library stays the authority.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Group keyless works in the works tick

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/backfill.ts:44-72`
- Modify: `backend/src/modules/books/plugin.ts:95`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Test: `backend/src/modules/books/backfill.test.ts:130-167`

**Interfaces:**
- Consumes: `title_key` and `fillTitleKeys` (Task 1). `mergeInto`, `detachEdition` and `mergeWorks` (Task 2).
- Produces: `BooksRepository.groupKeylessWorks(limit: number): number`, the number of works merged in this batch.
- Produces: `startWorksBackfill(steps: WorksSteps, log: WorksLog, intervalMs?: number, timers?: Timers)`, with:

```ts
export interface WorksSteps {
  assignMissingWorks: (limit: number) => number;
  fillTitleKeys: (limit: number) => number;
  groupKeylessWorks: (limit: number) => number;
}
```

- [ ] **Step 1: Write the failing repository tests**

Append to `sqliteBooksRepository.test.ts`. It reuses `at` from Task 2:

```ts
const edition = (repo: ReturnType<typeof createSqliteBooksRepository>, isbn: string, title: string, author: string, workKey?: string, created = NOW) =>
  repo.createBook({ title, author, isbn, workKey }, [`isbn:${isbn}`], created);

test("a keyless work joins the single keyed work that shares its title key, and keeps no key of its own", () => {
  const { db, repo } = freshRepo();
  const keyed = edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL893415W");
  const keyless = edition(repo, "9780593099322", "Dune", "Frank Herbert");
  assert.equal(repo.groupKeylessWorks(250), 1);
  const moved = repo.getBook(keyless.id)!;
  assert.deepEqual([moved.work_id, moved.ol_work_key], [keyed.work_id, null]);
  assert.equal(workById(db, keyless.work_id).merged_into, keyed.work_id);
  assert.equal(repo.groupKeylessWorks(250), 0);
});

test("keyless works sharing a title key merge into the oldest of them", () => {
  const { db, repo } = freshRepo();
  const oldest = edition(repo, "9789720000001", "Ensaio sobre a Cegueira", "José Saramago", undefined, at(0));
  const middle = edition(repo, "9789720000002", "Ensaio Sobre a Cegueira", "Saramago, José", undefined, at(1));
  const newest = edition(repo, "9789720000003", "Ensaio sobre a cegueira", "José Saramago", undefined, at(2));
  assert.equal(repo.groupKeylessWorks(250), 1);
  assert.deepEqual([oldest, newest].map((book) => repo.getBook(book.id)!.work_id), [oldest.work_id, oldest.work_id]);
  assert.equal(repo.getBook(middle.id)!.work_id, middle.work_id);
  assert.equal(workById(db, oldest.work_id).merged_into, null);
});

test("grouping skips ambiguous title keys, authorless and unkeyed editions, mixed works and blocked editions", () => {
  const { db, repo } = freshRepo();
  edition(repo, "9780000000001", "Poems", "Emily Dickinson", "OL1W");
  edition(repo, "9780000000002", "Poems", "Emily Dickinson", "OL2W");
  edition(repo, "9780000000003", "Poems", "Emily Dickinson");
  edition(repo, "9780000000004", "Orlando", "");
  edition(repo, "9780000000005", "Orlando", "");
  const pending = edition(repo, "9780000000006", "Emma", "Jane Austen");
  edition(repo, "9780000000007", "Emma", "Jane Austen", "OL3W");
  db.prepare("UPDATE books SET title_key = NULL WHERE id = ?").run(pending.id);
  const english = edition(repo, "9780000000008", "Blindness", "José Saramago");
  const portuguese = edition(repo, "9780000000009", "Ensaio sobre a Cegueira", "José Saramago");
  repo.mergeWorks(portuguese.work_id!, english.work_id!);
  edition(repo, "9780000000010", "Blindness", "José Saramago", "OL4W");
  const blocked = edition(repo, "9780000000011", "Dune", "Frank Herbert");
  repo.detachEdition(blocked.id, at(1));
  edition(repo, "9780000000012", "Dune", "Frank Herbert", "OL5W");
  assert.equal(repo.groupKeylessWorks(250), 0);
  assert.equal(repo.getBook(blocked.id)!.work_id, blocked.work_id);
});

test("a keyed edition arriving later pulls a keyless group into its work, and every old id resolves there", () => {
  const { db, repo } = freshRepo();
  const first = edition(repo, "9789720000001", "Os Maias", "Eça de Queirós", undefined, at(0));
  const second = edition(repo, "9789720000002", "Os Maias", "Eça de Queirós", undefined, at(1));
  assert.equal(repo.groupKeylessWorks(250), 1);
  const keyed = edition(repo, "9789725681367", "Os Maias", "Eça de Queirós", "OL846513W", at(2));
  assert.equal(repo.groupKeylessWorks(250), 1);
  assert.deepEqual([first, second, keyed].map((book) => repo.getBook(book.id)!.work_id), [keyed.work_id, keyed.work_id, keyed.work_id]);
  assert.deepEqual([first.work_id, second.work_id].map((id) => workById(db, id).merged_into), [keyed.work_id, keyed.work_id]);
});

test("Open Library's key moves a title-grouped edition out to its own work, and grouping leaves it there", () => {
  const { repo } = freshRepo();
  const keyed = edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL1W");
  const grouped = edition(repo, "9780593099322", "Dune", "Frank Herbert");
  repo.groupKeylessWorks(250);
  repo.setWorkKey(grouped.id, "OL9W");
  const moved = repo.getBook(grouped.id)!;
  assert.notEqual(moved.work_id, keyed.work_id);
  assert.equal(repo.getWorkView(moved.work_id!)!.olWorkKey, "OL9W");
  assert.equal(repo.getBook(keyed.id)!.work_id, keyed.work_id);
  assert.equal(repo.groupKeylessWorks(250), 0);
});

test("groupKeylessWorks merges at most its limit per batch", () => {
  const { repo } = freshRepo();
  edition(repo, "9780441013593", "Dune", "Frank Herbert", "OL1W");
  edition(repo, "9780593099322", "Dune", "Frank Herbert");
  edition(repo, "9780141439587", "Emma", "Jane Austen", "OL2W");
  edition(repo, "9780141439588", "Emma", "Jane Austen");
  assert.equal(repo.groupKeylessWorks(1), 1);
  assert.equal(repo.groupKeylessWorks(1), 1);
  assert.equal(repo.groupKeylessWorks(1), 0);
});
```

- [ ] **Step 2: Update the works backfill tests**

In `backfill.test.ts`, every `startWorksBackfill(<fn>, log, …)` call becomes a `WorksSteps` object. Replace the call in the test ending at line 148 with:

```ts
  startWorksBackfill({ assignMissingWorks: (limit) => { limits.push(limit); return sizes.shift() ?? 0; }, fillTitleKeys: () => 0, groupKeylessWorks: () => 0 }, log, undefined, timers);
```

Change its expectation to:

```ts
  assert.deepEqual(info, [{ details: { assigned: 517, titleKeyed: 0, grouped: 0 }, message: "updated works for existing editions" }]);
```

In "the works backfill gives the event loop a turn before every batch", replace the call with:

```ts
  const step = () => { turnAtBatch.push(turns); return sizes.shift() ?? 0; };
  startWorksBackfill({ assignMissingWorks: step, fillTitleKeys: step, groupKeylessWorks: step }, log, undefined, timers);
```

and change `assert.equal(turnAtBatch.length, 5);` to `assert.equal(turnAtBatch.length, 7);`. Run any other `startWorksBackfill` call in the file (`rg -n startWorksBackfill backend/src/modules/books/backfill.test.ts`) through the same object conversion, with the existing function as `assignMissingWorks` and `() => 0` for the other two.

Append:

```ts
test("the works tick fills title keys and groups works after assigning them, draining each step in order", async () => {
  const { timers } = fakeTimers();
  const { log, info } = fakeLog();
  const calls: string[] = [];
  const sizes: Record<string, number[]> = { assign: [3], keys: [250, 10], group: [250, 250, 1] };
  const step = (name: string) => () => { calls.push(name); return sizes[name]!.shift() ?? 0; };
  startWorksBackfill({ assignMissingWorks: step("assign"), fillTitleKeys: step("keys"), groupKeylessWorks: step("group") }, log, undefined, timers);
  await until(() => info.length > 0);
  assert.deepEqual(calls, ["assign", "keys", "keys", "group", "group", "group"]);
  assert.deepEqual(info, [{ details: { assigned: 3, titleKeyed: 260, grouped: 501 }, message: "updated works for existing editions" }]);
});

test("a works tick that changes nothing logs nothing", async () => {
  const { timers } = fakeTimers();
  const { log, info } = fakeLog();
  let calls = 0;
  startWorksBackfill({ assignMissingWorks: () => { calls++; return 0; }, fillTitleKeys: () => { calls++; return 0; }, groupKeylessWorks: () => { calls++; return 0; } }, log, undefined, timers);
  await until(() => calls === 3);
  await new Promise(setImmediate);
  assert.deepEqual(info, []);
});
```

`fakeLog` and `until` are existing helpers in that file. Check their names with `rg -n "function (fakeLog|until)" backend/src/modules/books/backfill.test.ts`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/backfill.test.ts`
Expected: FAIL. `groupKeylessWorks` is not a function, and `startWorksBackfill` calls a function where it now receives an object.

- [ ] **Step 4: Implement `groupKeylessWorks`**

In `ports.ts`, add after `fillTitleKeys`:

```ts
  groupKeylessWorks(limit: number): number;
```

In `sqliteBooksRepository.ts`, add this statement after `workEditionsStmt`:

```ts
  const groupablePairsStmt = db.prepare(`
    WITH candidates AS (
      SELECT works.id AS work_id, MIN(books.title_key) AS title_key, works.created_at AS created_at
      FROM works JOIN books ON books.work_id = works.id
      WHERE works.ol_work_key IS NULL AND works.merged_into IS NULL
      GROUP BY works.id
      HAVING COUNT(books.title_key) = COUNT(*)
        AND COUNT(DISTINCT books.title_key) = 1
        AND MIN(books.title_key) <> ''
        AND COUNT(books.title_group_blocked_at) = 0
    ),
    keyed AS (
      SELECT books.title_key AS title_key, MIN(works.id) AS target, COUNT(DISTINCT works.id) AS works
      FROM books JOIN works ON works.id = books.work_id
      WHERE works.ol_work_key IS NOT NULL AND works.merged_into IS NULL
        AND books.title_group_blocked_at IS NULL
        AND books.title_key IN (SELECT title_key FROM candidates)
      GROUP BY books.title_key
    ),
    oldest AS (
      SELECT title_key, work_id AS target
      FROM (SELECT title_key, work_id, ROW_NUMBER() OVER (PARTITION BY title_key ORDER BY created_at, work_id) AS rank FROM candidates)
      WHERE rank = 1
    )
    SELECT candidates.work_id AS source, COALESCE(keyed.target, oldest.target) AS target
    FROM candidates
    JOIN oldest ON oldest.title_key = candidates.title_key
    LEFT JOIN keyed ON keyed.title_key = candidates.title_key
    WHERE keyed.works = 1 OR (keyed.title_key IS NULL AND candidates.work_id <> oldest.target)
    ORDER BY candidates.created_at, candidates.work_id
    LIMIT ?
  `);
```

Add this method after `getWorkView`:

```ts
    groupKeylessWorks(limit) {
      return inTransaction(() => {
        const pairs = groupablePairsStmt.all(limit) as Array<{ source: string; target: string }>;
        for (const pair of pairs) mergeInto(pair.source, pair.target);
        return pairs.length;
      });
    },
```

- [ ] **Step 5: Run the steps from the works tick**

In `backfill.ts`, replace `startWorksBackfill` (from `export function startWorksBackfill(` to the end of the file) with:

```ts
export interface WorksSteps {
  assignMissingWorks: (limit: number) => number;
  fillTitleKeys: (limit: number) => number;
  groupKeylessWorks: (limit: number) => number;
}

export function startWorksBackfill(
  steps: WorksSteps,
  log: WorksLog,
  intervalMs?: number,
  timers?: Timers
): () => void {
  return startDetailsBackfill(
    async (signal) => {
      const counts = { assigned: 0, titleKeyed: 0, grouped: 0 };
      const drain = async (step: (limit: number) => number, field: keyof typeof counts) => {
        for (;;) {
          await new Promise(setImmediate);
          if (signal.aborted) return;
          const batch = step(WORKS_BATCH_SIZE);
          counts[field] += batch;
          if (batch < WORKS_BATCH_SIZE) return;
        }
      };
      await drain(steps.assignMissingWorks, "assigned");
      await drain(steps.fillTitleKeys, "titleKeyed");
      await drain(steps.groupKeylessWorks, "grouped");
      if (counts.assigned + counts.titleKeyed + counts.grouped > 0) log.info(counts, "updated works for existing editions");
    },
    (error) => log.error({ err: error }, "works backfill failed"),
    intervalMs,
    timers
  );
}
```

In `plugin.ts`, change `startWorksBackfill(repo.assignMissingWorks, app.log)` to `startWorksBackfill(repo, app.log)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/backfill.test.ts`
Expected: PASS.

- [ ] **Step 7: Measure one grouping batch at production size (not committed)**

Create `/private/tmp/claude-501/-Users-andreribeiro-Documents-scripta/bb3d5ad5-9cb0-4bbd-9ac4-8dde09b2b2fc/scratchpad/measure-grouping.ts`. Use the scratchpad given in your environment if it differs.

```ts
import { DatabaseSync } from "node:sqlite";
const root = process.argv[2];
process.env.AUTH_DB_PATH = "/dev/null";
process.env.LIBRARY_DB_PATH = "/dev/null";
process.env.GALLERY_DB_PATH = "/dev/null";
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
const { applyBooksMigrations } = await import(`${root}/backend/src/modules/books/adapters/sqlite/connection.ts`);
const { createSqliteBooksRepository } = await import(`${root}/backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`);
const db = new DatabaseSync(":memory:");
applyBooksMigrations(db);
const repo = createSqliteBooksRepository(db);
const at = "2026-10-01T00:00:00.000Z";
for (let i = 0; i < 59000; i++) repo.createBook({ title: `Title ${i % 57000} x`, author: `Author ${i % 9000}`, isbn: String(9780000000000 + i), workKey: `OL${i}W` }, [`isbn:${9780000000000 + i}`], at);
for (let i = 0; i < 19000; i++) repo.createBook({ title: i < 17700 ? "" : `Title ${i} x`, author: i < 17700 ? "" : `Author ${i % 9000}`, isbn: String(9790000000000 + i) }, [`isbn:${9790000000000 + i}`], at);
for (let run = 0; run < 3; run++) {
  const start = performance.now();
  const merged = repo.groupKeylessWorks(250);
  console.log(`batch ${run}: ${merged} merged in ${(performance.now() - start).toFixed(1)} ms`);
}
```

Run: `npm exec --workspace backend -- tsx /private/tmp/claude-501/-Users-andreribeiro-Documents-scripta/bb3d5ad5-9cb0-4bbd-9ac4-8dde09b2b2fc/scratchpad/measure-grouping.ts "$PWD"` from the worktree root.
Expected: every batch under 250 ms. If one is slower, stop, report the timings and `EXPLAIN QUERY PLAN` for `groupablePairsStmt`, and don't optimise without a decision from the main session. Put the measured timings in the commit message.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck --workspace backend && git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/backfill.ts backend/src/modules/books/backfill.test.ts backend/src/modules/books/plugin.ts && git commit -m "Group keyless works by title key in the works tick

A keyless work joins the single keyed work sharing its title key, or the
oldest keyless one when no keyed work has it. Ambiguous keys (1.9% of title
groups in production span several Open Library works), mixed works and
detached editions are skipped. Measured on 78k synthetic editions: <timings>.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Replace `<timings>` with the Step 7 output before committing.

---

### Task 4: Look up Open Library work keys by ISBN

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts` (move `EditionRecord` here, add `EditionRecordSource`, add repository methods)
- Modify: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Test: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
- Test: `backend/src/modules/books/booksService.test.ts`
- Modify (harness only): `backend/src/modules/books/routes.test.ts`

**Interfaces:**
- Consumes: `setWorkKey` (existing, with Task 2's repointing).
- Produces, in `domain/ports.ts`:

```ts
export interface EditionRecord {
  title: string;
  workKey: string | null;
  languages: string[];
}

export interface EditionRecordSource {
  fetchEditionRecord(isbn: string): Promise<EditionRecord | null>;
}
```

- Produces: `createOpenLibraryCatalog(throttle, urgent?)` returns `BookCatalog & EditionRecordSource`.
- Produces, on `BooksRepository`:
  - `listWorkLookupIds(limit: number, recheckBefore: string): string[]`
  - `markWorkChecked(id: string, at: string): void`
  - `replaceLanguage(id: string, tag: string): void`
- Produces: `BooksServiceDeps.editionRecords: EditionRecordSource` and `BooksService.backfillWorkKeys(limit: number, signal?: AbortSignal): Promise<number | null>`.

- [ ] **Step 1: Write the failing adapter test**

Append to `openLibraryCatalog.test.ts`:

```ts
test("an edition record comes from /isbn/, and an ISBN Open Library doesn't know is null", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  const requests = respond([{ title: "Os Maias", works: [{ key: "/works/OL846513W" }], languages: [{ key: "/languages/por" }] }]);
  assert.deepEqual(await catalog.fetchEditionRecord("9789725681367"), { title: "Os Maias", workKey: "/works/OL846513W", languages: ["/languages/por"] });
  assert.deepEqual(requests, ["https://openlibrary.org/isbn/9789725681367.json"]);
  globalThis.fetch = (async () => new Response("<html>not found</html>", { status: 404 })) as typeof fetch;
  assert.equal(await catalog.fetchEditionRecord("9789722541701"), null);
});

test("a rate-limited edition record lookup is unavailable with its retry time", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  globalThis.fetch = (async () => new Response("slow down", { status: 429, headers: { "retry-after": "60" } })) as typeof fetch;
  await assert.rejects(catalog.fetchEditionRecord("9789725681367"), (error: unknown) => error instanceof SourceUnavailableError && error.status === 429 && typeof error.retryAt === "number");
});
```

- [ ] **Step 2: Write the failing service tests**

In `booksService.test.ts`:
- Add `editionRecords: { fetchEditionRecord: async () => { throw new Error("edition records not expected"); } },` to the `createBooksService({...})` call in `harness`, directly after `backgroundCatalog`.
- Make the harness `const DAY` available to the new tests. It's already defined at the top.

Append:

```ts
function lookupBooks(h: ReturnType<typeof harness>, specs: Array<{ isbn: string; createdBy?: "seed" | "publisher"; checked?: boolean }>) {
  return specs.map(({ isbn, createdBy, checked = true }, index) => {
    const book = h.repo.createBook({ title: `Book ${index}`, author: "Someone", isbn, createdBy }, [`isbn:${isbn}`], `2026-09-0${index + 1}T00:00:00.000Z`);
    if (checked) h.repo.markDetailsMissing(book.id, "2026-09-30T00:00:00.000Z");
    return book.id;
  });
}

function editionRecords(answer: (isbn: string) => Promise<{ title: string; workKey: string | null; languages: string[] } | null>, calls: string[] = []) {
  return { fetchEditionRecord: async (isbn: string) => { calls.push(isbn); return answer(isbn); } };
}

test("the work key lookup asks for user editions first, then seed ones, and never for publisher, keyed or unchecked editions", async () => {
  const calls: string[] = [];
  const h = harness({ editionRecords: editionRecords(async () => null, calls) });
  const [publisher, seed, user] = lookupBooks(h, [{ isbn: "9789720000001", createdBy: "publisher" }, { isbn: "9789720000002", createdBy: "seed" }, { isbn: "9789720000003" }]);
  lookupBooks(h, [{ isbn: "9789720000004", checked: false }]);
  h.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], "2026-09-01T00:00:00.000Z");
  h.repo.markDetailsMissing(h.bookId("isbn:9780441013593"), "2026-09-30T00:00:00.000Z");
  assert.equal(await h.service.backfillWorkKeys(50), null);
  assert.deepEqual(calls, ["9789720000003", "9789720000002"]);
  assert.deepEqual([publisher, seed, user].map((id) => h.repo.getBook(id!)!.work_checked_at), [null, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
});

test("a work key found by ISBN keys the edition, joins the keyed work and replaces its language", async () => {
  const h = harness({ editionRecords: editionRecords(async () => ({ title: "Os Maias", workKey: "/works/OL846513W", languages: ["/languages/por"] })) });
  const keyed = h.repo.createBook({ title: "The Maias", author: "Eça de Queirós", isbn: "9780141394459", workKey: "OL846513W" }, ["isbn:9780141394459"], "2026-09-01T00:00:00.000Z");
  const [id] = lookupBooks(h, [{ isbn: "9789725681367" }]);
  h.repo.setLanguage(id!, "en");
  await h.service.backfillWorkKeys(50);
  const book = h.repo.getBook(id!)!;
  assert.deepEqual([book.ol_work_key, book.work_id, book.language], ["OL846513W", keyed.work_id, "pt-PT"]);
});

test("a miss is stamped and asked again only after 30 days", async () => {
  const calls: string[] = [];
  const h = harness({ editionRecords: editionRecords(async () => null, calls) });
  lookupBooks(h, [{ isbn: "9789722541701" }]);
  await h.service.backfillWorkKeys(50);
  await h.service.backfillWorkKeys(50);
  assert.deepEqual(calls, ["9789722541701"]);
  h.advance(31 * DAY);
  await h.service.backfillWorkKeys(50);
  assert.deepEqual(calls, ["9789722541701", "9789722541701"]);
});

test("a record without a work changes nothing but the stamp", async () => {
  const h = harness({ editionRecords: editionRecords(async () => ({ title: "X", workKey: null, languages: ["/languages/por"] })) });
  const [id] = lookupBooks(h, [{ isbn: "9789722541701" }]);
  await h.service.backfillWorkKeys(50);
  const book = h.repo.getBook(id!)!;
  assert.deepEqual([book.ol_work_key, book.language, book.work_checked_at], [null, null, "2026-10-01T00:00:00.000Z"]);
});

test("a rate limit ends the batch unstamped and returns when to resume", async () => {
  const calls: string[] = [];
  const h = harness({ editionRecords: editionRecords(async () => { throw new SourceUnavailableError("openlibrary", "HTTP 429", { status: 429, retryAt: 123_456 }); }, calls) });
  const ids = lookupBooks(h, [{ isbn: "9789720000001" }, { isbn: "9789720000002" }]);
  assert.equal(await h.service.backfillWorkKeys(50), 123_456);
  assert.equal(calls.length, 1);
  assert.deepEqual(ids.map((id) => h.repo.getBook(id)!.work_checked_at), [null, null]);
});

test("an outage without a retry time is warned about, stamped, and does not stop the batch", async () => {
  const h = harness({
    editionRecords: editionRecords(async (isbn) => {
      if (isbn === "9789720000001") throw new SourceUnavailableError("openlibrary", "HTTP 503", { status: 503 });
      return null;
    })
  });
  const ids = lookupBooks(h, [{ isbn: "9789720000001" }, { isbn: "9789720000002" }]);
  assert.equal(await h.service.backfillWorkKeys(50), null);
  assert.deepEqual(ids.map((id) => h.repo.getBook(id)!.work_checked_at), ["2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
  assert.deepEqual(h.warnings, [{ details: { bookId: ids[0], source: "openlibrary", error: "openlibrary unavailable: HTTP 503" }, message: "work key source unavailable" }]);
});

test("a bug in a work key lookup propagates", async () => {
  const h = harness({ editionRecords: editionRecords(async () => { throw new TypeError("boom"); }) });
  lookupBooks(h, [{ isbn: "9789720000001" }]);
  await assert.rejects(h.service.backfillWorkKeys(50), TypeError);
});

test("an aborted work key lookup starts no further requests", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  const h = harness({ editionRecords: editionRecords(async () => { controller.abort(); return null; }, calls) });
  lookupBooks(h, [{ isbn: "9789720000001" }, { isbn: "9789720000002" }]);
  await h.service.backfillWorkKeys(50, controller.signal);
  assert.equal(calls.length, 1);
});
```

In `routes.test.ts`, add `editionRecords: { fetchEditionRecord: async () => null },` to the `createBooksService({...})` call in `makeService`, directly after `backgroundCatalog`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts src/modules/books/booksService.test.ts`
Expected: FAIL. `fetchEditionRecord` and `backfillWorkKeys` are not functions.

- [ ] **Step 4: Ports and adapter**

In `ports.ts`, add the `EditionRecord` and `EditionRecordSource` interfaces from **Interfaces** above, and add to `BooksRepository` after `groupKeylessWorks`:

```ts
  listWorkLookupIds(limit: number, recheckBefore: string): string[];
  markWorkChecked(id: string, at: string): void;
  replaceLanguage(id: string, tag: string): void;
```

In `openLibraryCatalog.ts`:
- Delete the local `EditionRecord` interface.
- Change the ports import to `import type { BookCatalog, EditionRecord, EditionRecordSource } from "../../domain/ports.js";`.
- Change the factory signature to `export function createOpenLibraryCatalog(throttle: Throttle, urgent = true): BookCatalog & EditionRecordSource {`.
- Add this method after `search`:

```ts
    async fetchEditionRecord(isbn) {
      const record = await get(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
      return record === null ? null : parseEditionRecord(record);
    }
```

- [ ] **Step 5: Repository**

In `sqliteBooksRepository.ts`, add these statements after `groupablePairsStmt`:

```ts
  const workLookupStmt = db.prepare(`
    SELECT id FROM books
    WHERE ol_work_key IS NULL AND isbn IS NOT NULL AND details_status IS NOT NULL
      AND (created_by IS NULL OR created_by <> 'publisher')
      AND (work_checked_at IS NULL OR work_checked_at < ?)
    ORDER BY work_checked_at IS NOT NULL, created_by IS NOT NULL, work_checked_at, created_at, rowid
    LIMIT ?
  `);
  const workCheckedStmt = db.prepare(`UPDATE books SET work_checked_at = ? WHERE id = ?`);
  const replaceLanguageStmt = db.prepare(`UPDATE books SET language = ? WHERE id = ?`);
```

Add these methods after `groupKeylessWorks`:

```ts
    listWorkLookupIds(limit, recheckBefore) {
      return (workLookupStmt.all(recheckBefore, limit) as Array<{ id: string }>).map((row) => row.id);
    },

    markWorkChecked(id, at) {
      workCheckedStmt.run(at, id);
    },

    replaceLanguage(id, tag) {
      replaceLanguageStmt.run(tag, id);
    },
```

- [ ] **Step 6: Service**

In `booksService.ts`:
- Add `editionLanguage` to the `./domain/normalize.js` import.
- Add `EditionRecordSource` to the `./domain/ports.js` type import.
- Add `editionRecords: EditionRecordSource;` to `BooksServiceDeps` after `backgroundCatalog`.
- Add `backfillWorkKeys(limit: number, signal?: AbortSignal): Promise<number | null>;` to `BooksService` after `backfillDetails`.
- Add `const WORK_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;` next to the module's other top-level constants.

Add this method after `backfillDetails`:

```ts
    async backfillWorkKeys(limit, signal) {
      const recheckBefore = new Date(now().getTime() - WORK_RECHECK_MS).toISOString();
      for (const id of deps.repo.listWorkLookupIds(limit, recheckBefore)) {
        if (signal?.aborted) return null;
        const book = deps.repo.getBook(id);
        if (!book?.isbn || book.ol_work_key) continue;
        try {
          const record = await deps.editionRecords.fetchEditionRecord(book.isbn);
          if (record?.workKey) {
            deps.repo.setWorkKey(id, record.workKey);
            const language = editionLanguage(record.languages, book.isbn);
            if (language) deps.repo.replaceLanguage(id, language);
          }
        } catch (error) {
          if (!(error instanceof SourceUnavailableError)) throw error;
          if (error.retryAt !== undefined) return error.retryAt;
          deps.warn({ bookId: id, source: error.source, error: error.message }, "work key source unavailable");
        }
        deps.repo.markWorkChecked(id, now().toISOString());
      }
      return null;
    },
```

- [ ] **Step 7: Wire it in the plugin**

In `plugin.ts`, inside `booksPlugin`, before `createBooksService`:

```ts
  const backgroundOpenLibrary = createOpenLibraryCatalog(openLibraryThrottle, false);
```

In the `createBooksService({...})` call:
- Replace `createOpenLibraryCatalog(openLibraryThrottle, false)` inside `backgroundCatalog` with `backgroundOpenLibrary`.
- Add `editionRecords: backgroundOpenLibrary,` after `backgroundCatalog`.

After `const stopWorksBackfill = …`:

```ts
  const stopWorkKeyBackfill = startDetailsBackfill(
    (signal) => service.backfillWorkKeys(DETAILS_BATCH_SIZE, signal),
    (error) => app.log.error({ err: error }, "work key backfill failed")
  );
```

and in the `onClose` hook, after `stopWorksBackfill();`, add `stopWorkKeyBackfill();`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts src/modules/books/booksService.test.ts src/modules/books/routes.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck --workspace backend && git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/booksService.ts backend/src/modules/books/booksService.test.ts backend/src/modules/books/routes.test.ts backend/src/modules/books/plugin.ts && git commit -m "Look up missing Open Library work keys by ISBN in the background

search.json?isbn= missed editions that /isbn/{isbn}.json knows: on
2026-10-04 it keyed 6 of 9 sampled user-lookup editions the details backfill
had already checked, and 0 of 31 publisher ones, so publisher rows are left
out. A 429 pauses the job; other outages stamp the edition so one failing
ISBN cannot hold the front of the queue.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Admin merge and detach routes, and the public work lookup

**Files:**
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/routes.ts`
- Modify: `backend/src/modules/books/publicCoverLookup.ts`
- Modify: `backend/src/modules/books/index.ts`
- Test: `backend/src/modules/books/routes.test.ts`
- Test: `backend/src/modules/books/publicCoverLookup.test.ts`

**Interfaces:**
- Consumes: `mergeWorks`, `detachEdition`, `resolveWorkId`, `getWorkView`, `WorkMergeError` and `WorkView` (Task 2).
- Produces, on `BooksService`:
  - `mergeWorks(from: BookLookup, into: BookLookup): WorkView`
  - `detachEdition(edition: BookLookup): WorkView`
- Produces, exported from `modules/books/index.ts`:
  - `peekWorkId(params: PeekCachedCoverParams): string | null`
  - `resolveWorkId(workId: string): string | null`
- Produces the routes `POST /books/works/merge` with body `{ from, into }`, and `POST /books/works/detach` with body `{ edition }`.

- [ ] **Step 1: Write the failing route tests**

In `routes.test.ts`:
- Change `makeService` so it keeps the repository: `const repo = createSqliteBooksRepository(db);`, pass `repo` to `createBooksService`, and `return { service, repo };`.

Append:

```ts
test("only a signed-in admin may merge or detach works", async () => {
  const { service } = makeService();
  const merge = { method: "POST" as const, url: "/books/works/merge", payload: { from: { isbn: "9789720000001" }, into: { isbn: "9789720000002" } } };
  const detach = { method: "POST" as const, url: "/books/works/detach", payload: { edition: { isbn: "9789720000001" } } };
  assert.equal((await call(service, merge)).statusCode, 401);
  assert.equal((await call(service, merge, "u1")).statusCode, 403);
  assert.equal((await call(service, detach, "u1")).statusCode, 403);
});

test("the admin merges one edition's work into another's and gets the resulting work", async () => {
  const { service, repo } = makeService();
  const english = repo.createBook({ title: "Blindness", author: "José Saramago", isbn: "9780156007757", workKey: "OL1W" }, ["isbn:9780156007757"], "2026-10-01T00:00:00.000Z");
  const portuguese = repo.createBook({ title: "Ensaio sobre a Cegueira", author: "José Saramago", isbn: "9789720000002" }, ["isbn:9789720000002"], "2026-10-02T00:00:00.000Z");
  const res = await call(service, { method: "POST", url: "/books/works/merge", payload: { from: { isbn: "978-972-0-00000-2" }, into: { isbn: "9780156007757" } } }, "admin");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    id: english.work_id,
    olWorkKey: "OL1W",
    title: "Blindness",
    author: "José Saramago",
    editions: [
      { id: english.id, isbn: "9780156007757", title: "Blindness", author: "José Saramago", olWorkKey: "OL1W" },
      { id: portuguese.id, isbn: "9789720000002", title: "Ensaio sobre a Cegueira", author: "José Saramago", olWorkKey: null }
    ]
  });
});

test("merging answers 400 for a bad body, 404 for an unknown edition and 409 for a refused merge", async () => {
  const { service, repo } = makeService();
  repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], "2026-10-01T00:00:00.000Z");
  repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], "2026-10-01T00:00:00.000Z");
  const merge = (payload: unknown) => call(service, { method: "POST", url: "/books/works/merge", payload: payload as object }, "admin");
  assert.equal((await merge({ from: { isbn: "9780441013593" } })).statusCode, 400);
  assert.equal((await merge({ from: {}, into: { isbn: "9780441013593" } })).statusCode, 400);
  assert.equal((await merge({ from: { isbn: "9789999999999" }, into: { isbn: "9780441013593" } })).statusCode, 404);
  const keyed = await merge({ from: { isbn: "9780441013593" }, into: { isbn: "9780141439587" } });
  assert.equal(keyed.statusCode, 409);
  assert.match(keyed.json().error, /Open Library/);
  assert.equal((await merge({ from: { isbn: "9780141439587" }, into: { isbn: "9780141439587" } })).statusCode, 409);
});

test("an admin lookup with an ISBN never falls back to another edition's title", async () => {
  const { service, repo } = makeService();
  repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593", "ta:dune|frank herbert|"], "2026-10-01T00:00:00.000Z");
  repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], "2026-10-01T00:00:00.000Z");
  const res = await call(service, { method: "POST", url: "/books/works/merge", payload: { from: { isbn: "9789999999999", title: "Dune", author: "Frank Herbert" }, into: { isbn: "9780141439587" } } }, "admin");
  assert.equal(res.statusCode, 404);
});

test("the admin detaches an edition from a grouped work, and a keyed edition is refused", async () => {
  const { service, repo } = makeService();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], "2026-10-01T00:00:00.000Z");
  const joined = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322" }, ["isbn:9780593099322"], "2026-10-01T00:00:00.000Z");
  repo.mergeWorks(joined.work_id!, keyed.work_id!);
  const res = await call(service, { method: "POST", url: "/books/works/detach", payload: { edition: { isbn: "9780593099322" } } }, "admin");
  assert.equal(res.statusCode, 200);
  assert.notEqual(res.json().id, keyed.work_id);
  assert.deepEqual(res.json().editions.map((e: { id: string }) => e.id), [joined.id]);
  assert.notEqual(repo.getBook(joined.id)!.title_group_blocked_at, null);
  assert.equal((await call(service, { method: "POST", url: "/books/works/detach", payload: { edition: { isbn: "9780441013593" } } }, "admin")).statusCode, 409);
  assert.equal((await call(service, { method: "POST", url: "/books/works/detach", payload: { edition: {} } }, "admin")).statusCode, 400);
  assert.equal((await call(service, { method: "POST", url: "/books/works/detach", payload: { edition: { isbn: "9789999999999" } } }, "admin")).statusCode, 404);
});
```

- [ ] **Step 2: Write the failing public lookup test**

Append to `publicCoverLookup.test.ts`. First add `peekWorkId` and `resolveWorkId` to its `./publicCoverLookup.js` import.

```ts
test("peekWorkId finds an edition's live work without creating anything, and resolveWorkId follows merged_into", () => {
  db.prepare(`INSERT INTO works (id, ol_work_key, title, author, merged_into, created_at) VALUES ('w-live', 'OL1W', 'Dune', 'Frank Herbert', NULL, '2026-01-01T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO works (id, ol_work_key, title, author, merged_into, created_at) VALUES ('w-merged', NULL, 'Dune', 'Frank Herbert', 'w-live', '2026-01-01T00:00:00.000Z')`).run();
  cacheBook("in-work", null, ["isbn:9787777777777"]);
  db.prepare("UPDATE books SET work_id = 'w-live' WHERE id = 'in-work'").run();
  const books = (db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n;
  assert.equal(peekWorkId({ isbn: "9787777777777" }), "w-live");
  assert.equal(peekWorkId({ isbn: "9784444444444" }), null);
  assert.equal(peekWorkId({ title: "Never Seen", author: "Nobody" }), null);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, books);
  assert.equal(resolveWorkId("w-merged"), "w-live");
  assert.equal(resolveWorkId("w-live"), "w-live");
  assert.equal(resolveWorkId("no-such-work"), null);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/routes.test.ts src/modules/books/publicCoverLookup.test.ts`
Expected: FAIL. The routes answer 404 because they aren't registered, and `peekWorkId` is not exported.

- [ ] **Step 4: Service**

In `booksService.ts`:
- Add `WorkMergeError` to the `./domain/errors.js` import.
- Add `WorkView` to the `./domain/types.js` type import.

Add to `BooksService` after `uploadCover`:

```ts
  mergeWorks(from: BookLookup, into: BookLookup): WorkView;
  detachEdition(edition: BookLookup): WorkView;
```

Add these helpers inside `createBooksService`, next to `lookupDetails`:

```ts
  function existingEdition(lookup: BookLookup): BookRow {
    const identity = lookupIdentity(lookup);
    const book = identity ? (identity.isbn ? deps.repo.findBookByKey(identity.key) : findByIdentity(deps.repo, identity)) : undefined;
    if (!book) throw new BookNotFoundError();
    return book;
  }

  function workView(workId: string): WorkView {
    const view = deps.repo.getWorkView(workId);
    if (!view) throw new Error(`Work ${workId} is missing.`);
    return view;
  }
```

Add these methods after `uploadCover`:

```ts
    mergeWorks(from, into) {
      const source = existingEdition(from);
      const target = existingEdition(into);
      if (!source.work_id || !target.work_id) throw new WorkMergeError("That edition has no work yet.");
      return workView(deps.repo.mergeWorks(source.work_id, target.work_id));
    },

    detachEdition(edition) {
      return workView(deps.repo.detachEdition(existingEdition(edition).id, now().toISOString()));
    },
```

- [ ] **Step 5: Routes**

In `routes.ts`:
- Add `WorkMergeError` to the `./domain/errors.js` import.
- Add these constants after `NOT_FOUND`:

```ts
const WORKS_FORBIDDEN = { error: "Only the admin can merge works." };
const mergeSchema = z.object({ from: lookupSchema, into: lookupSchema });
const detachSchema = z.object({ edition: lookupSchema });
```

Inside `adminRoutes`, after the `PUT /books/cover` route:

```ts
    app.post("/books/works/merge", { preHandler: authGuard }, async (request, reply) => {
      if (!service.isAdmin(request.user.id)) return reply.code(403).send(WORKS_FORBIDDEN);
      const parsed = mergeSchema.safeParse(request.body);
      if (!parsed.success || !isLookable(parsed.data.from) || !isLookable(parsed.data.into)) {
        return reply.code(400).send({ error: "Send from and into, each with an isbn or a title (author optional)." });
      }
      try {
        return reply.send(service.mergeWorks(parsed.data.from, parsed.data.into));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send(NOT_FOUND);
        if (error instanceof WorkMergeError) return reply.code(409).send({ error: error.message });
        throw error;
      }
    });

    app.post("/books/works/detach", { preHandler: authGuard }, async (request, reply) => {
      if (!service.isAdmin(request.user.id)) return reply.code(403).send(WORKS_FORBIDDEN);
      const parsed = detachSchema.safeParse(request.body);
      if (!parsed.success || !isLookable(parsed.data.edition)) {
        return reply.code(400).send({ error: "Send the edition with an isbn or a title (author optional)." });
      }
      try {
        return reply.send(service.detachEdition(parsed.data.edition));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send(NOT_FOUND);
        if (error instanceof WorkMergeError) return reply.code(409).send({ error: error.message });
        throw error;
      }
    });
```

- [ ] **Step 6: Public lookup**

Append to `publicCoverLookup.ts`:

```ts
export function peekWorkId(params: PeekCachedCoverParams): string | null {
  const identity = lookupIdentity(params);
  if (!identity) return null;
  const workId = findByIdentity(booksRepository(), identity)?.work_id;
  return workId ? booksRepository().resolveWorkId(workId) : null;
}

export function resolveWorkId(workId: string): string | null {
  return booksRepository().resolveWorkId(workId);
}
```

In `index.ts`, change the export line to:

```ts
export { peekCachedCoverUrl, peekCachedCoverUrls, peekWorkId, resolveWorkId } from "./publicCoverLookup.js";
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm exec --workspace backend -- tsx --test src/modules/books/routes.test.ts src/modules/books/publicCoverLookup.test.ts src/modules/books/booksService.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck --workspace backend && git add backend/src/modules/books/booksService.ts backend/src/modules/books/routes.ts backend/src/modules/books/routes.test.ts backend/src/modules/books/publicCoverLookup.ts backend/src/modules/books/publicCoverLookup.test.ts backend/src/modules/books/index.ts && git commit -m "Let the admin merge and detach works, and expose work ids to other modules

The routes take edition lookups because nothing shows work ids yet. A lookup
with an ISBN uses only the ISBN: falling back to the title alias could merge
an edition the admin never named.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Gap script counts, docs, and the full check

**Files:**
- Modify: `backend/scripts/work-gap.mjs`
- Modify: `backend/README.md:15-17` (books row of the module table) and `:135-137`
- Modify: `docs/superpowers/specs/2026-10-01-works-design.md` (Decision 3 and "Not in this phase")
- Modify: `docs/work-model-notes.md:15-17`

**Interfaces:**
- Consumes: the columns from Tasks 1 and 4 (`title_key`, `title_group_blocked_at`, `work_checked_at`).

- [ ] **Step 1: Add the post-deploy counts to the gap script**

In `backend/scripts/work-gap.mjs`, after the `workCounts` query, add:

```js
const after = covers.prepare(
  `SELECT
     SUM(books.ol_work_key IS NULL AND works.ol_work_key IS NOT NULL) AS keylessEditionsInKeyedWorks,
     SUM(books.title_group_blocked_at IS NOT NULL) AS blockedEditions,
     SUM(books.work_checked_at IS NOT NULL) AS lookedUp,
     SUM(books.work_checked_at IS NOT NULL AND books.ol_work_key IS NOT NULL) AS lookedUpAndKeyed,
     SUM(books.title_key IS NULL AND books.title <> '') AS titleKeysPending,
     (SELECT COUNT(*) FROM works AS w WHERE w.merged_into IN (SELECT id FROM works WHERE merged_into IS NOT NULL)) AS chainsLongerThanOneHop,
     (SELECT COUNT(*) FROM works AS w WHERE w.ol_work_key IS NULL AND w.merged_into IS NULL AND (SELECT COUNT(*) FROM books AS b WHERE b.work_id = w.id) > 1) AS keylessGroups
   FROM books JOIN works ON works.id = books.work_id`
).get();
```

and add `grouping: after,` to the `report` object after `works: workCounts,`.

Check it against copies of the dev databases, migrated by the new code. `<scratch>` below is your scratchpad directory. Build first:

```bash
npm run build --workspace @scripta/shared && npm run build --workspace backend
```

```bash
mkdir -p <scratch>/gap && sqlite3 -readonly /Users/andreribeiro/Documents/scripta/backend/data/dev/covers.sqlite ".backup <scratch>/gap/covers.sqlite" && sqlite3 -readonly /Users/andreribeiro/Documents/scripta/backend/data/dev/library.sqlite ".backup <scratch>/gap/library.sqlite"
```

Write `<scratch>/gap/migrate.mjs`:

```js
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const [dir, dist] = process.argv.slice(2);
const { applyBooksMigrations } = await import(`${dist}/modules/books/adapters/sqlite/connection.js`);
const { createSqliteBooksRepository } = await import(`${dist}/modules/books/adapters/sqlite/sqliteBooksRepository.js`);
const covers = new DatabaseSync(`${dir}/covers.sqlite`);
applyBooksMigrations(covers);
const repo = createSqliteBooksRepository(covers);
while (repo.assignMissingWorks(250) === 250);
while (repo.fillTitleKeys(250) === 250);
while (repo.groupKeylessWorks(250) === 250);
new DatabaseSync(`${dir}/library.sqlite`).exec(readFileSync(`${dist}/modules/library/adapters/sqlite/schema.sql`, "utf8"));
```

Run it, then the script:

```bash
AUTH_DB_PATH=/dev/null LIBRARY_DB_PATH=/dev/null GALLERY_DB_PATH=/dev/null JWT_ACCESS_SECRET=$(printf 'a%.0s' $(seq 64)) JWT_REFRESH_SECRET=$(printf 'b%.0s' $(seq 64)) node <scratch>/gap/migrate.mjs <scratch>/gap "$PWD/backend/dist"
```

```bash
COVERS_DB_PATH=<scratch>/gap/covers.sqlite LIBRARY_DB_PATH=<scratch>/gap/library.sqlite node backend/scripts/work-gap.mjs
```

Expected: the JSON includes `grouping` with numeric fields and `chainsLongerThanOneHop: 0`.

- [ ] **Step 2: Update the docs**

In `backend/README.md`:
- **Module table, `books` row:** append `` `POST /books/works/merge` ✓ admin; `POST /books/works/detach` ✓ admin `` to the routes cell.
- **Line 135 ("Works group editions"):** replace the sentence `Nothing reads \`work_id\` or \`merged_into\` yet.` with:

> Keyless works are grouped by `books.title_key` (`workTitleKey`: the `ta:` format, `''` when the title or author has no letters) in the works tick: a keyless work joins the single keyed work sharing its title key, or the oldest keyless work with it when no keyed work has it; a key shared by several keyed works, a work whose editions disagree on the key, and an edition the admin detached (`title_group_blocked_at`) are skipped. Merges (grouping, `setWorkKey`, and the admin's `POST /books/works/merge`) repoint anything already merged into the source, so `merged_into` is at most one hop; `resolveWorkId` and `peekWorkId` (the module's public API) follow it. Keyed works are never merged. `POST /books/works/detach` gives an edition a work of its own and blocks it from grouping; an edition with its own key can't be detached. Both routes take edition lookups (`{ from, into }` or `{ edition }`, each `{ isbn?, title?, author? }`; an ISBN is matched by ISBN only) and answer with the resulting work and its editions.

- **After line 137 (works backfill),** add a bullet:

> - **The work key lookup fills Open Library work keys by ISBN.** On boot and every 10 minutes, 50 at a time on the background Open Library lane, it asks `GET /isbn/{isbn}.json` for editions with an ISBN, no work key and checked details, user editions first, never publisher ones (none of a sample of 31 were known). A work key goes through `setWorkKey`, and the record's language replaces the edition's. `books.work_checked_at` records each attempt, and a miss is asked again after 30 days. A 429 pauses the job until its retry time; other outages are logged and stamped. `scripts/work-gap.mjs` counts what remains (read-only; run it over `railway ssh`).

In `docs/superpowers/specs/2026-10-01-works-design.md`:
- **Decision 3:** append a sentence: `Superseded on 2026-10-04 by \`2026-10-04-keyless-works-design.md\`: \`ta:\` aliases still never choose a work, but a stored title key groups keyless works.`
- **"Not in this phase":** replace the first bullet with `- **Grouping keyless editions by title plus author.** Built in \`2026-10-04-keyless-works-design.md\`.`

In `docs/work-model-notes.md`, replace the bullets at lines 15–17 ("Books Open Library doesn't know", "Backfill", "The title key") with:

```markdown
- **Books Open Library doesn't know** get works of our own, grouped by title key where it's safe and joined to a keyed work with the same title key (`2026-10-04-keyless-works-design.md`). Wikidata and PORBASE (the national library catalogue) have work-level ids for some Portuguese books; neither is used yet.
- **Backfill.** Built: user and seed editions without a key are looked up at `/isbn/{isbn}.json` in the background. Publisher editions are not, since Open Library knew none of a sample of 31.
- **The title key (`ta:`)** alias still never chooses a work, because edition titles differ by language and the alias caused the importer's English-title collision fixed on 2026-10-01. The stored `books.title_key` groups only keyless works, skips keys shared by several keyed works, and an admin detach blocks a wrong grouping.
```

- [ ] **Step 3: Run the full backend check**

```bash
npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend
```

Expected: typecheck clean, every test passing. Also run `npm run check:agents` from the worktree root, expecting a pass. The plan changes no `AGENTS.md`, so this is a guard.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/work-gap.mjs backend/README.md docs/superpowers/specs/2026-10-01-works-design.md docs/work-model-notes.md && git commit -m "Document keyless work grouping and the work key lookup, and count them

The gap script now reports title-grouped and blocked editions, looked-up
editions with and without a key, and merge chains longer than one hop, for
the post-deploy check.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Before merge (main session)**

- Run the `branch-reviewer` agent on the whole branch against the spec and this plan.
- Run the `security-review` skill. The branch adds admin write routes.
- After deploy, hand the user the `work-gap.mjs` command from the spec session, with `--sample 0`. Compare it with the 2026-10-04 numbers in the spec.
