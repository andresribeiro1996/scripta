# Event-loop Stalls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name every background or startup stall over 200 ms, and stop the books background jobs from doing unbounded work on the main thread.

**Architecture:** Three timing helpers in `backend/src/stallLog.ts` (`timeSync`, `timeStep`, `timedMethods`), wired around the books repository, the cover enqueue, the works sweep, the arena sweep and the startup steps. Then four partial indexes and a keyset cursor make the books backfill queries cheap. Keyless-works grouping moves to a daily job with an admin trigger. One `openSqlite` helper opens every database with `synchronous = NORMAL`.

**Tech Stack:** Node 26, TypeScript, Fastify, `node:sqlite` (`DatabaseSync`), `node:test` run through `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-06-event-loop-stalls-design.md`

## Global Constraints

- All work is in `backend/`. Run every command from `backend/` (`cd backend` once; the worktree root is `/Users/andreribeiro/Documents/scripta/.claude/worktrees/practical-shamir-caa362`).
- Run one test file: `npx tsx --test src/path/to/file.test.ts`. Whole suite: `npm test`. Types: `npm run typecheck`.
- `backend/package.json`'s `test` script lists every test file explicitly. A new `*.test.ts` file must be added to that list, or it never runs.
- Backend test files that import anything reaching `config/env.ts` set the env preamble first (`AUTH_DB_PATH`, `LIBRARY_DB_PATH`, `GALLERY_DB_PATH`, `COVERS_DB_PATH`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) and use dynamic `await import(...)`. Copy the preamble from the top of the file you're extending.
- No comments in code. When a change makes an existing comment false, fix or delete that comment.
- Log strings, exactly: `"job blocked the event loop"` with `{ job, blockedMs }`; `"startup step"` with `{ step, ms }`; `"startup finished"` with `{ ms }`.
- `STALL_MS` stays 200. `COVER_ENQUEUE_BATCH = 500`. Grouping interval: 24 h. Grouping batch: 250, as today.
- Index names, exactly: `idx_books_cover_unchecked`, `idx_books_cover_upgrade`, `idx_books_details_unchecked`, `idx_books_work_lookup`.
- New route: `POST /books/works/group`, admin only, answers `{ grouped: number }`, or 409 `{ error: "Grouping is already running." }`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage and commit in one command (another session can sweep staged files).

## Review Focus

1. **Seeded books share a `created_at`.** Paging must not skip or repeat a book when many rows have the same timestamp. The cursor is `(created_at, rowid)`, and Task 3 has a tie test.
2. **A book leaves the unchecked set between two pages.** The worker checks it while the cursor sits after it. The next page must still start right after the cursor and skip nothing. Task 3 tests this.
3. **The admin triggers grouping while the daily run is going.** Expect 409 and no second run at the same time. Task 5 tests the job and the route.
4. **A repository method throws through `timedMethods`.** Routes check `instanceof WorkMergeError` and `BookNotFoundError`, so the wrapper must rethrow the very same error object. Task 1 tests identity.
5. **A grouping run throws.** It is logged, and the job is not left stuck as "running", so the next manual or daily run still works. Task 5 tests this.

---

### Task 1: Timing helpers

**Files:**
- Modify: `src/stallLog.ts`
- Test: `src/stallLog.test.ts`

**Interfaces:**
- Produces, all exported from `src/stallLog.ts`:
  - `type WarnLog = Pick<FastifyBaseLogger, "warn">`
  - `type StepLog = Pick<FastifyBaseLogger, "warn" | "info">`
  - `function timeSync<T>(log: WarnLog, job: string, fn: () => T): T`
  - `function timeStep<T>(log: StepLog, step: string, fn: () => T): T`
  - `function timedMethods<T extends object>(target: T, log: WarnLog, prefix: string): T`

- [ ] **Step 1: Write the failing tests.** Append to `src/stallLog.test.ts`, and extend its import line to `import { STALL_MS, checkEventLoop, registerStallLog, timeStep, timeSync, timedMethods } from "./stallLog.js";`

```ts
test("timeSync returns the function's result and logs nothing when it is fast", () => {
  const warn = mock.fn();

  assert.equal(timeSync({ warn }, "fast-job", () => 42), 42);

  assert.equal(warn.mock.callCount(), 0);
});

test("timeSync logs a slow job by name, in whole milliseconds", () => {
  const warn = mock.fn();

  timeSync({ warn }, "slow-job", () => busyWait(250));

  assert.equal(warn.mock.callCount(), 1);
  const [details, message] = warn.mock.calls[0]!.arguments as [{ job: string; blockedMs: number }, string];
  assert.equal(message, "job blocked the event loop");
  assert.equal(details.job, "slow-job");
  assert.ok(details.blockedMs >= STALL_MS);
  assert.equal(details.blockedMs, Math.round(details.blockedMs));
});

test("timeSync rethrows the very error the function threw, and still logs a slow one", () => {
  const warn = mock.fn();
  const boom = new Error("boom");

  assert.throws(() => timeSync({ warn }, "boom-job", () => { busyWait(250); throw boom; }), (error) => error === boom);

  assert.equal(warn.mock.callCount(), 1);
});

test("timeStep logs a fast startup step at info with its duration", () => {
  const info = mock.fn();
  const warn = mock.fn();

  assert.equal(timeStep({ info, warn }, "startup:fast", () => "done"), "done");

  assert.equal(warn.mock.callCount(), 0);
  const [details, message] = info.mock.calls[0]!.arguments as [{ step: string; ms: number }, string];
  assert.equal(message, "startup step");
  assert.equal(details.step, "startup:fast");
  assert.equal(details.ms, Math.round(details.ms));
});

test("timeStep logs a slow startup step as a blocked job instead", () => {
  const info = mock.fn();
  const warn = mock.fn();

  timeStep({ info, warn }, "startup:slow", () => busyWait(250));

  assert.equal(info.mock.callCount(), 0);
  const [details, message] = warn.mock.calls[0]!.arguments as [{ job: string; blockedMs: number }, string];
  assert.equal(message, "job blocked the event loop");
  assert.equal(details.job, "startup:slow");
  assert.ok(details.blockedMs >= STALL_MS);
});

test("timedMethods times each method under prefix:name and keeps results, errors and plain values", () => {
  const warn = mock.fn();
  const nope = new Error("nope");
  const target = {
    size: 3,
    fast: (n: number) => n + 1,
    slow: () => { busyWait(250); return "done"; },
    fail: (): never => { throw nope; }
  };

  const timed = timedMethods(target, { warn }, "books");

  assert.equal(timed.size, 3);
  assert.equal(timed.fast(1), 2);
  assert.equal(timed.slow(), "done");
  assert.throws(() => timed.fail(), (error) => error === nope);
  assert.deepEqual(warn.mock.calls.map((call) => (call.arguments[0] as { job: string }).job), ["books:slow"]);
});
```

- [ ] **Step 2: Run them and watch them fail.**

Run: `npx tsx --test src/stallLog.test.ts`
Expected: FAIL. `timeSync`, `timeStep` and `timedMethods` are not exported.

- [ ] **Step 3: Implement.** In `src/stallLog.ts`, below `CHECK_EVERY_MS`, add:

```ts
export type WarnLog = Pick<FastifyBaseLogger, "warn">;
export type StepLog = Pick<FastifyBaseLogger, "warn" | "info">;

export function timeSync<T>(log: WarnLog, job: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const blockedMs = performance.now() - start;
    if (blockedMs > STALL_MS) log.warn({ job, blockedMs: Math.round(blockedMs) }, "job blocked the event loop");
  }
}

export function timeStep<T>(log: StepLog, step: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const ms = performance.now() - start;
    if (ms > STALL_MS) log.warn({ job: step, blockedMs: Math.round(ms) }, "job blocked the event loop");
    else log.info({ step, ms: Math.round(ms) }, "startup step");
  }
}

export function timedMethods<T extends object>(target: T, log: WarnLog, prefix: string): T {
  const timed: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(target)) {
    timed[name] = typeof value === "function"
      ? (...args: unknown[]) => timeSync(log, `${prefix}:${name}`, () => value.apply(target, args))
      : value;
  }
  return timed as T;
}
```

- [ ] **Step 4: Run them and watch them pass.**

Run: `npx tsx --test src/stallLog.test.ts`
Expected: PASS, every test including the existing ones.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck && git add src/stallLog.ts src/stallLog.test.ts && git commit -m "Add timing helpers that name what blocks the event loop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Name the background jobs and startup steps

**Files:**
- Modify: `src/modules/books/plugin.ts` (repository creation, the first `enqueueUnchecked`, the `startBackfill` callback)
- Modify: `src/modules/arena/plugin.ts` (the sweep interval callback)
- Modify: `src/app.ts` (the order of `runStartupMigrations` and `Fastify(...)`, the `startWorksSweep` call, a new `onReady` hook)
- Modify: `src/migrations/runStartupMigrations.ts`

**Interfaces:**
- Consumes `timeSync`, `timeStep`, `timedMethods` and `StepLog` from Task 1.
- Produces `runStartupMigrations(log: StepLog): void`. Its only caller is `app.ts`.

This task is wiring. Its tests are the existing suite, the typecheck and one local boot.

- [ ] **Step 1: Books plugin.** In `src/modules/books/plugin.ts`, add `import { timeStep, timeSync, timedMethods } from "../../stallLog.js";`. Replace

```ts
  const repo = createSqliteBooksRepository(openBooksDb());
```

with

```ts
  const repo = timedMethods(createSqliteBooksRepository(timeStep(app.log, "startup:books-open", openBooksDb)), app.log, "books");
```

and replace

```ts
  service.enqueueUnchecked();
  const stopBackfill = startBackfill(() => service.enqueueUnchecked());
```

with

```ts
  timeStep(app.log, "startup:cover-enqueue", () => service.enqueueUnchecked());
  const stopBackfill = startBackfill(() => timeSync(app.log, "cover-enqueue", () => service.enqueueUnchecked()));
```

- [ ] **Step 2: Arena sweep.** In `src/modules/arena/plugin.ts`, add `import { timeSync } from "../../stallLog.js";` and change the body of the `try` in the sweep interval from `service.runScheduledSweep();` to:

```ts
      timeSync(app.log, "arena-sweep", () => service.runScheduledSweep());
```

- [ ] **Step 3: Startup steps.** Replace the body of `src/migrations/runStartupMigrations.ts`'s function, keeping the file's imports, and add the `StepLog` and `timeStep` import:

```ts
import { timeStep, type StepLog } from "../stallLog.js";

export function runStartupMigrations(log: StepLog): void {
  const homes = timeStep(log, "startup:mural-homes", () => listHomeDesignations());
  if (homes.length > 0) timeStep(log, "startup:home-murals", () => applyHomeMuralMigration(homes));
  timeStep(log, "startup:drop-mural-homes", () => dropMuralHomes());
  timeStep(log, "startup:preset-block-styles", () => resetPresetBlockStyles());

  const extracted = timeStep(log, "startup:embedded-murals", () => readEmbeddedMurals());
  if (extracted.length > 0) {
    timeStep(log, "startup:move-embedded-murals", () => {
      insertMigratedMurals(extracted);
      clearEmbeddedMuralsField([...new Set(extracted.map((r) => r.userId))]);
    });
  }

  timeStep(log, "startup:library-derived", () => backfillLibraryDerived());

  timeStep(log, "startup:mural-themes", () => backfillMuralThemes(getUserTheme));
}
```

Use arrow functions, not bare references. Several of these take a default database argument, and the arrow keeps that default.

- [ ] **Step 4: `app.ts`.**
  1. Make `const bootStart = performance.now();` the first line of `buildApp`.
  2. Move the `runStartupMigrations();` call from before the `Fastify(...)` construction to right after it, as `runStartupMigrations(app.log);`, still before `registerStallLog(app)`. In the comment above the old call, change "Deliberately before Fastify/app.register" to "Deliberately before app.register". The rest of that comment stays true.
  3. Add `import { registerStallLog, timeSync } from "./stallLog.js";` in place of the current `registerStallLog` import.
  4. Replace the `startWorksSweep` line with:

```ts
  const sweepSteps = { library: sweepLibraryWorks, arena: sweepArenaWorks, tierlists: sweepTierlistsWorks, quizzes: sweepQuizzesWorks, murals: sweepMuralsWorks };
  const stopWorksSweep = startWorksSweep(
    Object.entries(sweepSteps).map(([name, step]) => (after: number, limit: number) => timeSync(app.log, `works-sweep:${name}`, () => step(after, limit))),
    app.log
  );
```

  5. Just before `return app;`, add:

```ts
  app.addHook("onReady", async () => {
    app.log.info({ ms: Math.round(performance.now() - bootStart) }, "startup finished");
  });
```

- [ ] **Step 5: Typecheck and run the whole suite.**

Run: `npm run typecheck && npm test`
Expected: both pass. Any test that stubs the books repository is unaffected, because `timedMethods` is applied only in the plugin.

- [ ] **Step 6: Boot once locally and read the startup lines.** Follow `docs/dev-workflow.md` to claim a port slot and start the backend only. In its log, confirm that each `startup:*` name appears once as `"startup step"` (or as `"job blocked the event loop"` if it is slow), and that one `"startup finished"` line follows. Stop the server and release the slot as that document says.

- [ ] **Step 7: Commit.**

```bash
git add src/modules/books/plugin.ts src/modules/arena/plugin.ts src/app.ts src/migrations/runStartupMigrations.ts && git commit -m "Log which background job or startup step blocked the event loop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Page the cover enqueue

**Files:**
- Modify: `src/modules/books/domain/ports.ts`
- Modify: `src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` (`uncheckedStmt`, `upgradeWantedStmt` and their two methods)
- Modify: `src/modules/books/booksService.ts` (`enqueueUnchecked`)
- Test: `src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`, `src/modules/books/booksService.test.ts`, `src/modules/books/seed/seedCatalog.test.ts`

**Interfaces:**
- Produces, in `ports.ts`:

```ts
export interface PageCursor { at: string; row: number }
export interface IdPage { ids: string[]; next: PageCursor | null }
```

  and changes two `BooksRepository` methods to `listUncheckedCoverIds(after: PageCursor | null, limit: number): IdPage` and `listUpgradeWantedIds(after: PageCursor | null, limit: number): IdPage`. `next` is `null` when the page came back shorter than `limit`.
- Produces, exported from `sqliteBooksRepository.ts`: `UNCHECKED_COVERS_SQL` and `UPGRADE_WANTED_SQL`. Task 4 tests their plans.
- Produces, exported from `booksService.ts`: `COVER_ENQUEUE_BATCH = 500`.

- [ ] **Step 1: Update the existing repository tests to the new signature and add paging tests.** In `sqliteBooksRepository.test.ts`:
  - `repo.listUncheckedCoverIds()` becomes `repo.listUncheckedCoverIds(null, 100).ids`.
  - `repo.listUpgradeWantedIds()` becomes `repo.listUpgradeWantedIds(null, 100).ids`.

  Then add:

```ts
test("listUncheckedCoverIds pages by created_at then insert order, and a short page ends the cycle", () => {
  const { repo } = freshRepo();
  const ids = ["a", "b", "c"].map((t) => repo.createBook({ title: t, author: "X", isbn: null }, [`ta:${t}|x|`], NOW).id);
  const first = repo.listUncheckedCoverIds(null, 2);
  assert.deepEqual(first.ids, ids.slice(0, 2));
  assert.ok(first.next);
  assert.deepEqual(repo.listUncheckedCoverIds(first.next, 2), { ids: [ids[2]], next: null });
});

test("a book checked between two pages does not make the next page skip anything", () => {
  const { repo } = freshRepo();
  const ids = ["a", "b", "c", "d"].map((t) => repo.createBook({ title: t, author: "X", isbn: null }, [`ta:${t}|x|`], NOW).id);
  const first = repo.listUncheckedCoverIds(null, 2);
  repo.setCover(ids[1]!, { imageId: null, status: "missing", checkedAt: NOW });
  assert.deepEqual(repo.listUncheckedCoverIds(first.next, 2).ids, ids.slice(2));
});

test("listUpgradeWantedIds pages by wanted time then insert order", () => {
  const { repo } = freshRepo();
  const ids = ["a", "b", "c"].map((t) => repo.createBook({ title: t, author: "X", isbn: null }, [`ta:${t}|x|`], NOW).id);
  for (const id of ids) repo.setUpgradeWanted(id, NOW);
  const first = repo.listUpgradeWantedIds(null, 2);
  assert.deepEqual(first.ids, ids.slice(0, 2));
  assert.deepEqual(repo.listUpgradeWantedIds(first.next, 2), { ids: [ids[2]], next: null });
});
```

`deepEqual` on `{ ids, next }` works because the method builds a plain object. Don't return the raw `node:sqlite` row objects; they have a null prototype.

- [ ] **Step 2: Update the other callers' tests.**
  - `booksService.test.ts` (around lines 308 and 319): `h.repo.listUncheckedCoverIds()` becomes `h.repo.listUncheckedCoverIds(null, 100).ids`.
  - `seed/seedCatalog.test.ts` (lines 37–57): `repo.listUncheckedCoverIds().length` becomes `repo.listUncheckedCoverIds(null, 100).ids.length`.
  - Add `COVER_ENQUEUE_BATCH` to the destructured `await import("./booksService.js")` in `booksService.test.ts`, then add:

```ts
test("enqueueUnchecked queues one batch per call, continues where it stopped, and wraps after a short page", () => {
  const h = harness();
  const at = "2026-09-01T00:00:00.000Z";
  const ids = Array.from({ length: COVER_ENQUEUE_BATCH + 1 }, (_, i) => h.repo.createBook({ title: `Book ${i}`, author: "Author", isbn: null }, [`ta:book ${i}|author|`], at).id);
  const queued = () => h.enqueued.splice(0).filter((entry) => entry.priority === "background").map((entry) => entry.bookId);

  h.service.enqueueUnchecked();
  assert.deepEqual(queued(), ids.slice(0, COVER_ENQUEUE_BATCH));

  h.service.enqueueUnchecked();
  assert.deepEqual(queued(), [ids[COVER_ENQUEUE_BATCH]]);

  h.service.enqueueUnchecked();
  assert.deepEqual(queued(), ids.slice(0, COVER_ENQUEUE_BATCH));
});
```

The second call is the starvation guard. The first 500 books are still unchecked, because nothing processed them, yet book 501 is queued.

- [ ] **Step 3: Run them and watch them fail.**

Run: `npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/booksService.test.ts src/modules/books/seed/seedCatalog.test.ts`
Expected: FAIL, on type and argument errors and on the new tests.

- [ ] **Step 4: Implement.**
  1. In `ports.ts`, add `PageCursor` and `IdPage` as above, and change the two method signatures.
  2. In `sqliteBooksRepository.ts`, add `import type { StatementSync } from "node:sqlite";` (merge it with the existing `DatabaseSync` type import), import `IdPage` and `PageCursor` from `../../domain/ports.js`, and add at module level:

```ts
export const UNCHECKED_COVERS_SQL = `
  SELECT id, created_at AS at, rowid AS row FROM books
  WHERE cover_checked_at IS NULL AND (cover_status IS NULL OR cover_status = 'low_res') AND (created_at, rowid) > (?, ?)
  ORDER BY created_at, rowid LIMIT ?
`;
export const UPGRADE_WANTED_SQL = `
  SELECT id, cover_upgrade_wanted_at AS at, rowid AS row FROM books
  WHERE cover_upgrade_wanted_at IS NOT NULL AND (cover_upgrade_wanted_at, rowid) > (?, ?)
  ORDER BY cover_upgrade_wanted_at, rowid LIMIT ?
`;

function idPage(stmt: StatementSync, after: PageCursor | null, limit: number): IdPage {
  const rows = stmt.all(after?.at ?? "", after?.row ?? 0, limit) as Array<{ id: string; at: string; row: number }>;
  const last = rows[rows.length - 1];
  return { ids: rows.map((row) => row.id), next: rows.length === limit && last ? { at: last.at, row: last.row } : null };
}
```

  Change the two statements to `db.prepare(UNCHECKED_COVERS_SQL)` and `db.prepare(UPGRADE_WANTED_SQL)`. Change the methods to:

```ts
    listUncheckedCoverIds(after, limit) {
      return idPage(uncheckedStmt, after, limit);
    },
```

```ts
    listUpgradeWantedIds(after, limit) {
      return idPage(upgradeWantedStmt, after, limit);
    }
```

  3. In `booksService.ts`, add `export const COVER_ENQUEUE_BATCH = 500;` near the file's other constants, and import `PageCursor` with the other `./domain/ports.js` types. Inside `createBooksService`, next to `backoffUntil`, add `let uncheckedCursor: PageCursor | null = null;` and `let upgradeCursor: PageCursor | null = null;`. Replace `enqueueUnchecked` with:

```ts
    enqueueUnchecked() {
      const unchecked = deps.repo.listUncheckedCoverIds(uncheckedCursor, COVER_ENQUEUE_BATCH);
      for (const id of unchecked.ids) schedule(id, "background");
      uncheckedCursor = unchecked.next;
      const upgrades = deps.repo.listUpgradeWantedIds(upgradeCursor, COVER_ENQUEUE_BATCH);
      for (const id of upgrades.ids) schedule(id, "upgrade");
      upgradeCursor = upgrades.next;
    },
```

- [ ] **Step 5: Find any caller left on the old signature.**

Run: `rg -n "listUncheckedCoverIds\(|listUpgradeWantedIds\(" src scripts`
Expected: every hit passes two arguments. `scripts/*.mjs` uses the built `dist`. Fix any script that calls these methods the same way.

- [ ] **Step 6: Run the tests, typecheck and commit.**

```bash
npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/booksService.test.ts src/modules/books/seed/seedCatalog.test.ts && npm run typecheck && git add src/modules/books scripts && git commit -m "Enqueue unchecked covers in bounded pages that resume across ticks

A plain LIMIT would let books in backoff, which stay unchecked, fill every
page and starve the rest; a (created_at, rowid) cursor moves past them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Index the backfill queries

**Files:**
- Modify: `src/modules/books/adapters/sqlite/connection.ts` (`applyBooksMigrations`, next to the existing `CREATE INDEX IF NOT EXISTS` lines)
- Modify: `src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` (`uncheckedDetailsStmt`, `workLookupStmt`)
- Test: `src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes `UNCHECKED_COVERS_SQL` and `UPGRADE_WANTED_SQL` from Task 3.
- Produces `UNCHECKED_DETAILS_SQL` and `WORK_LOOKUP_SQL`, exported from `sqliteBooksRepository.ts`.

- [ ] **Step 1: Write the failing test.** Extend the repository import in `sqliteBooksRepository.test.ts` to `const { createSqliteBooksRepository, UNCHECKED_COVERS_SQL, UPGRADE_WANTED_SQL, UNCHECKED_DETAILS_SQL, WORK_LOOKUP_SQL } = await import("./sqliteBooksRepository.js");`, then add:

```ts
test("every backfill query reads through its own partial index, with no temp sort", () => {
  const { db } = freshRepo();
  const cases: Array<[string, Array<string | number>, string]> = [
    [UNCHECKED_COVERS_SQL, ["", 0, 500], "idx_books_cover_unchecked"],
    [UPGRADE_WANTED_SQL, ["", 0, 500], "idx_books_cover_upgrade"],
    [UNCHECKED_DETAILS_SQL, [50], "idx_books_details_unchecked"],
    [WORK_LOOKUP_SQL, [NOW, 50], "idx_books_work_lookup"]
  ];
  for (const [sql, params, index] of cases) {
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail).join(" | ");
    assert.match(plan, new RegExp(`USING INDEX ${index}\\b`), plan);
    assert.doesNotMatch(plan, /TEMP B-TREE/, plan);
  }
});
```

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: FAIL. `UNCHECKED_DETAILS_SQL` is undefined, and the plans show `SCAN books | USE TEMP B-TREE FOR ORDER BY`.

- [ ] **Step 3: Implement.**
  1. In `sqliteBooksRepository.ts`, add these module-level constants. The SQL text matches today's statements, apart from whitespace.

```ts
export const UNCHECKED_DETAILS_SQL = `
  SELECT id FROM books WHERE details_status IS NULL
  ORDER BY details_checked_at IS NOT NULL, created_by IS NOT NULL, details_checked_at, created_at, rowid LIMIT ?
`;
export const WORK_LOOKUP_SQL = `
  SELECT id FROM books
  WHERE ol_work_key IS NULL AND isbn IS NOT NULL AND details_status IS NOT NULL
    AND (created_by IS NULL OR created_by <> 'publisher')
    AND (work_checked_at IS NULL OR work_checked_at < ?)
  ORDER BY work_checked_at IS NOT NULL, created_by IS NOT NULL, work_checked_at, created_at, rowid
  LIMIT ?
`;
```

  Then make `uncheckedDetailsStmt = db.prepare(UNCHECKED_DETAILS_SQL)` and `workLookupStmt = db.prepare(WORK_LOOKUP_SQL)`.

  2. In `connection.ts`'s `applyBooksMigrations`, right after `idx_works_merged_into`, add:

```ts
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_cover_unchecked ON books(created_at) WHERE cover_checked_at IS NULL AND (cover_status IS NULL OR cover_status = 'low_res')");
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_cover_upgrade ON books(cover_upgrade_wanted_at) WHERE cover_upgrade_wanted_at IS NOT NULL");
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_details_unchecked ON books(details_checked_at IS NOT NULL, created_by IS NOT NULL, details_checked_at, created_at) WHERE details_status IS NULL");
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_work_lookup ON books(work_checked_at IS NOT NULL, created_by IS NOT NULL, work_checked_at, created_at) WHERE ol_work_key IS NULL AND isbn IS NOT NULL AND details_status IS NOT NULL");
```

  The `WHERE` of each partial index must stay a literal subset of its query's `WHERE`, or SQLite won't use it. The test catches drift.

- [ ] **Step 4: Run the books tests and watch them pass.**

Run: `npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/booksService.test.ts src/modules/books/backfill.test.ts`
Expected: PASS. The ordering tests for details and work lookups ("books users brought in come before the seed…", "failing user books fall behind…") pass unchanged, which shows the indexes didn't change any order.

- [ ] **Step 5: Typecheck and commit.**

```bash
npm run typecheck && git add src/modules/books/adapters/sqlite && git commit -m "Index the four books backfill queries with partial indexes

On a 73 MB, 78k-book copy the unindexed queries took 17-43 ms each on a
Mac (full scan plus sort, every 10 minutes); indexed they take under 1 ms.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Group keyless works daily, or when the admin asks

**Files:**
- Modify: `src/modules/books/backfill.ts`
- Modify: `src/modules/books/plugin.ts` (start the grouping job, pass it to the admin routes, stop it on close)
- Modify: `src/modules/books/routes.ts` (`buildAdminRoutes`)
- Modify: `backend/README.md` (the `books` route list on line 16, and the "Works group editions" paragraph that says grouping runs "in the works tick")
- Test: `src/modules/books/backfill.test.ts`, `src/modules/books/routes.test.ts`

**Interfaces:**
- Changes `WorksSteps` to `{ assignMissingWorks(limit: number): number; fillTitleKeys(limit: number): number }`. `startWorksBackfill`'s info log becomes `{ assigned, titleKeyed }`.
- Produces in `backfill.ts`:

```ts
export const GROUPING_INTERVAL_MS = 24 * 60 * 60 * 1000;
export interface WorksGrouping { runNow(): Promise<number | null>; stop(): void }
export function startWorksGrouping(groupKeylessWorks: (limit: number) => number, log: WorksLog, intervalMs?: number, timers?: Timers): WorksGrouping
```

  `runNow()` resolves to the number grouped, or to `null` without doing anything if a run is already going. It rejects if a batch throws.
- Changes `buildAdminRoutes(service: BooksService, groupWorks: () => Promise<number | null>)`.

- [ ] **Step 1: Update the works-backfill tests for the two-step backfill.** In `backfill.test.ts`:
  - Remove `groupKeylessWorks: ...` from every `startWorksBackfill({...})` object.
  - Change the expected log details from `{ assigned: N, titleKeyed: M, grouped: 0 }` to `{ assigned: N, titleKeyed: M }`.
  - In "the works backfill gives the event loop a turn before every batch", pass `{ assignMissingWorks: step, fillTitleKeys: step }` and keep `sizes = [250, 250, 250, 250, 3]`. Assign takes 250, 250, 250, 250, 3, then title keys take 0, so `turnAtBatch.length` becomes 6.
  - Replace "the works tick fills title keys and groups works after assigning them, draining each step in order" with:

```ts
test("the works tick fills title keys after assigning works, draining each step in order", async () => {
  const { timers } = fakeTimers();
  const { log, info } = fakeLog();
  const calls: string[] = [];
  const sizes: Record<string, number[]> = { assign: [3], keys: [250, 10] };
  const step = (name: string) => () => { calls.push(name); return sizes[name]!.shift() ?? 0; };
  startWorksBackfill({ assignMissingWorks: step("assign"), fillTitleKeys: step("keys") }, log, undefined, timers);
  await until(() => info.length > 0);
  assert.deepEqual(calls, ["assign", "keys", "keys"]);
  assert.deepEqual(info, [{ details: { assigned: 3, titleKeyed: 260 }, message: "updated works for existing editions" }]);
});
```

  - In "a works tick that changes nothing logs nothing", drop the grouping step and wait for `calls === 2`.

- [ ] **Step 2: Add the grouping tests.** Add `startWorksGrouping` and `GROUPING_INTERVAL_MS` to the import from `./backfill.js`, then append:

```ts
test("works grouping drains at start on a daily unref'd timer, and logs what it grouped", async () => {
  const { state, timers } = fakeTimers();
  const { log, info } = fakeLog();
  const sizes = [250, 7];
  const limits: number[] = [];
  startWorksGrouping((limit) => { limits.push(limit); return sizes.shift() ?? 0; }, log, undefined, timers);
  assert.equal(state.delay, GROUPING_INTERVAL_MS);
  assert.equal(state.unrefs, 1);
  await until(() => info.length > 0);
  assert.deepEqual(limits, [250, 250]);
  assert.deepEqual(info, [{ details: { grouped: 257 }, message: "grouped keyless works by title" }]);
  sizes.push(1);
  state.callback!();
  await until(() => info.length > 1);
  assert.deepEqual(info[1], { details: { grouped: 1 }, message: "grouped keyless works by title" });
});

test("runNow while a grouping run is going returns null and starts nothing", async () => {
  const { timers } = fakeTimers();
  const { log } = fakeLog();
  let calls = 0;
  const grouping = startWorksGrouping(() => { calls++; return calls < 3 ? 250 : 0; }, log, undefined, timers);
  assert.equal(await grouping.runNow(), null);
  await until(() => calls === 3);
  assert.equal(await grouping.runNow(), 0);
  assert.equal(calls, 4);
});

test("a failed grouping run is logged and the next run still works", async () => {
  const { state, timers } = fakeTimers();
  const { log, info, error } = fakeLog();
  const outcomes: Array<Error | number> = [new Error("database is locked"), 2];
  startWorksGrouping(() => {
    const outcome = outcomes.shift() ?? 0;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }, log, undefined, timers);
  await until(() => error.length === 1);
  assert.equal(error[0]!.message, "works grouping failed");
  state.callback!();
  await until(() => info.length === 1);
  assert.deepEqual(info[0]!.details, { grouped: 2 });
});

test("stopping works grouping ends a run at the next batch boundary and clears the timer", async () => {
  const { state, handle, timers } = fakeTimers();
  const { log } = fakeLog();
  let batches = 0;
  let grouping: { stop(): void } | null = null;
  grouping = startWorksGrouping(() => { batches++; grouping?.stop(); return 250; }, log, undefined, timers);
  await until(() => batches > 1);
  assert.equal(batches, 1);
  assert.deepEqual(state.cleared, [handle]);
});
```

- [ ] **Step 3: Add the route tests.** In `routes.test.ts`, give `call` a fourth parameter `groupWorks: () => Promise<number | null> = async () => 0` and register `buildAdminRoutes(service, groupWorks)`. Then add:

```ts
test("only a signed-in admin may run works grouping", async () => {
  const { service } = makeService();
  const group = { method: "POST" as const, url: "/books/works/group" };
  assert.equal((await call(service, group)).statusCode, 401);
  assert.equal((await call(service, group, "u1")).statusCode, 403);
});

test("the admin runs works grouping and gets the count, or 409 while a run is going", async () => {
  const { service } = makeService();
  const group = { method: "POST" as const, url: "/books/works/group" };
  const done = await call(service, group, "admin", async () => 12);
  assert.equal(done.statusCode, 200);
  assert.deepEqual(done.json(), { grouped: 12 });
  const busy = await call(service, group, "admin", async () => null);
  assert.equal(busy.statusCode, 409);
  assert.deepEqual(busy.json(), { error: "Grouping is already running." });
});
```

- [ ] **Step 4: Run them and watch them fail.**

Run: `npx tsx --test src/modules/books/backfill.test.ts src/modules/books/routes.test.ts`
Expected: FAIL. `startWorksGrouping` doesn't exist, and the route returns 404.

- [ ] **Step 5: Implement `backfill.ts`.** Replace everything from `export interface WorksSteps` to the end of the file with:

```ts
export const GROUPING_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface WorksSteps {
  assignMissingWorks: (limit: number) => number;
  fillTitleKeys: (limit: number) => number;
}

async function drainBatches(step: (limit: number) => number, signal: AbortSignal): Promise<number> {
  let total = 0;
  for (;;) {
    await new Promise(setImmediate);
    if (signal.aborted) return total;
    const batch = step(WORKS_BATCH_SIZE);
    total += batch;
    if (batch < WORKS_BATCH_SIZE) return total;
  }
}

export function startWorksBackfill(
  steps: WorksSteps,
  log: WorksLog,
  intervalMs?: number,
  timers?: Timers
): () => void {
  return startDetailsBackfill(
    async (signal) => {
      const assigned = await drainBatches(steps.assignMissingWorks, signal);
      const titleKeyed = await drainBatches(steps.fillTitleKeys, signal);
      if (assigned + titleKeyed > 0) log.info({ assigned, titleKeyed }, "updated works for existing editions");
    },
    (error) => log.error({ err: error }, "works backfill failed"),
    intervalMs,
    timers
  );
}

export interface WorksGrouping {
  runNow(): Promise<number | null>;
  stop(): void;
}

export function startWorksGrouping(
  groupKeylessWorks: (limit: number) => number,
  log: WorksLog,
  intervalMs: number = GROUPING_INTERVAL_MS,
  timers?: Timers
): WorksGrouping {
  const controller = new AbortController();
  let running = false;
  async function runNow(): Promise<number | null> {
    if (running) return null;
    running = true;
    try {
      const grouped = await drainBatches(groupKeylessWorks, controller.signal);
      if (grouped > 0) log.info({ grouped }, "grouped keyless works by title");
      return grouped;
    } finally {
      running = false;
    }
  }
  const tick = () => {
    runNow().catch((error: unknown) => log.error({ err: error }, "works grouping failed"));
  };
  tick();
  const stopTimer = startBackfill(tick, intervalMs, timers);
  return {
    runNow,
    stop: () => {
      controller.abort();
      stopTimer();
    }
  };
}
```

Keep `WorksLog` as it is. The second drain still runs after an abort of the first, but `drainBatches` checks the signal before every batch, so it returns at once.

- [ ] **Step 6: Implement the route.** In `routes.ts`, change the signature to `export function buildAdminRoutes(service: BooksService, groupWorks: () => Promise<number | null>)` and add, after the `/books/works/merge` route:

```ts
    app.post("/books/works/group", { preHandler: authGuard }, async (request, reply) => {
      if (!service.isAdmin(request.user.id)) return reply.code(403).send(WORKS_FORBIDDEN);
      const grouped = await groupWorks();
      if (grouped === null) return reply.code(409).send({ error: "Grouping is already running." });
      return reply.send({ grouped });
    });
```

- [ ] **Step 7: Wire the plugin.** In `plugin.ts`, import `startWorksGrouping` from `./backfill.js`. After `const stopWorksBackfill = startWorksBackfill(repo, app.log);`, add `const grouping = startWorksGrouping((limit) => repo.groupKeylessWorks(limit), app.log);`. In the `onClose` hook, add `grouping.stop();` after `stopWorksBackfill();`. Change `buildAdminRoutes(service)` to `buildAdminRoutes(service, () => grouping.runNow())`.

  `repo` is the `timedMethods` wrapper from Task 2, so each grouping batch is timed as `books:groupKeylessWorks`.

- [ ] **Step 8: Update the README.** In `backend/README.md`:
  - On line 16, add `` `POST /books/works/group` ✓ admin`` after the `merge` route.
  - In the "Works group editions" paragraph, change "Keyless works are grouped by `books.title_key` … in the works tick" so it says grouping runs at boot, then once a day, and on demand through `POST /books/works/group`, which answers `{ grouped }`, or 409 while a run is going.

- [ ] **Step 9: Run the tests, typecheck and commit.**

```bash
npx tsx --test src/modules/books/backfill.test.ts src/modules/books/routes.test.ts && npm run typecheck && npm test && git add src/modules/books README.md && git commit -m "Group keyless works once a day, with an admin route to run it now

groupablePairsStmt re-aggregates all ~19k keyless works per call
(123-133 ms on a Mac with a 78k-book copy), and it ran every 10 minutes.
Daily is enough for this use case; an incremental version isn't worth it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: One way to open a database, with `synchronous = NORMAL`

**Files:**
- Create: `src/db/openSqlite.ts`
- Create test: `src/db/openSqlite.test.ts`
- Modify: `package.json` (add the new test file to the `test` script)
- Modify the `open*Db()` function in each of these 11 files: `src/modules/{auth,books,murals,library,gallery,socials,waitlist,quizzes,community,arena,tierlists}/adapters/sqlite/connection.ts`

**Interfaces:**
- Produces `openSqlite(path: string): DatabaseSync`.

- [ ] **Step 1: Write the failing test** in `src/db/openSqlite.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openSqlite } from "./openSqlite.js";

test("openSqlite creates the folder and opens in WAL with synchronous NORMAL and a 5 s busy timeout", () => {
  const path = join(mkdtempSync(join(tmpdir(), "open-sqlite-")), "nested", "x.sqlite");
  const db = openSqlite(path);
  const pragma = (name: string) => ({ ...(db.prepare(`PRAGMA ${name}`).get() as object) });
  assert.deepEqual(pragma("journal_mode"), { journal_mode: "wal" });
  assert.deepEqual(pragma("synchronous"), { synchronous: 1 });
  assert.deepEqual(pragma("busy_timeout"), { timeout: 5000 });
  db.close();
});
```

  Add `src/db/openSqlite.test.ts` to the `tsx --test` file list in `package.json`'s `test` script.

- [ ] **Step 2: Run it and watch it fail.**

Run: `npx tsx --test src/db/openSqlite.test.ts`
Expected: FAIL, because the module can't be found.

- [ ] **Step 3: Implement** `src/db/openSqlite.ts`:

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openSqlite(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
```

- [ ] **Step 4: Run it and watch it pass.**

Run: `npx tsx --test src/db/openSqlite.test.ts`
Expected: PASS.

- [ ] **Step 5: Switch the 11 modules over.** In each `open*Db()`, replace the `mkdirSync(dirname(env.X_DB_PATH), …)`, `new DatabaseSync(env.X_DB_PATH)`, `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000` lines with `const db = openSqlite(env.X_DB_PATH);`. Import `openSqlite` from the right relative path: `../../../../db/openSqlite.js` from `src/modules/<m>/adapters/sqlite/`.
  - Keep `PRAGMA foreign_keys = ON` in auth and community, right after the open.
  - Keep everything that follows: the schema, migrations and backfills.
  - Remove imports that are now unused (`mkdirSync`, `dirname`, `DatabaseSync` as a value), but keep `import type { DatabaseSync }` where a signature still needs the type. Keep `dirname` and `fileURLToPath` where `adapterDir` uses them.
  - Delete any comment between those lines that described what was removed.
  - Books `connection.ts`'s header says it "mirrors modules/gallery/adapters/sqlite/connection.ts exactly". That isn't true, so delete the header.

  Gallery before:

```ts
export function openGalleryDb(): DatabaseSync {
  mkdirSync(dirname(env.GALLERY_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.GALLERY_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  return db;
}
```

  Gallery after:

```ts
export function openGalleryDb(): DatabaseSync {
  const db = openSqlite(env.GALLERY_DB_PATH);

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);

  return db;
}
```

- [ ] **Step 6: Check that nothing opens a database the old way.**

Run: `rg -n "new DatabaseSync\(" src --glob '!*.test.ts'`
Expected: exactly two hits. One is `src/db/openSqlite.ts`. The other is `src/modules/library/import/importChild.ts`, the read-only open the spec leaves as it is.

- [ ] **Step 7: Typecheck, run the whole suite and commit.**

```bash
npm run typecheck && npm test && git add package.json src/db src/modules && git commit -m "Open every database through openSqlite, with synchronous=NORMAL

FULL made each WAL commit wait for a disk flush on the main thread; NORMAL
flushes at checkpoints. A process crash loses nothing, and Litestream's
~1 s WAL shipping is already the recovery point for power loss.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Measure after, for the PR description

**Files:** none committed. Use the session scratchpad directory, not the repo.

- [ ] **Step 1: Build the synthetic catalog and time it.** Write a scratch `.ts` file that:
  - sets the same env preamble the test files use;
  - imports `applyBooksMigrations` and `createSqliteBooksRepository` from `backend/src`;
  - opens a file database in the scratchpad and inserts 78,000 rows into `books`. Include 59,000 with an `ol_work_key` and a matching `works` row, and 19,000 keyless rows, each with its own keyless work. Give about 40% a 1,200-character `summary`, and leave about half with `cover_checked_at` NULL and about 70% with `details_status` NULL.
  
  Then time, averaged over 3 runs after one warm-up:
  - `repo.listUncheckedCoverIds(null, 500)`
  - `repo.listUpgradeWantedIds(null, 500)`
  - `repo.listUncheckedDetailIds(50)`
  - `repo.listWorkLookupIds(50, new Date().toISOString())`
  - `repo.groupKeylessWorks(250)` inside a transaction you roll back
  
  Run it with `npx tsx <file>` from `backend/`.

- [ ] **Step 2: Report.** Put the five timings next to the "before" column of the spec's "Measured while planning" table in the PR description. The four indexed queries should each be under 1 ms. `groupKeylessWorks` is unchanged at about 125 ms, and is now daily. If an indexed query is over 50 ms, stop and report it rather than opening the PR.
