# Genre Review and Jev Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jev runs when a held book's details lookup finds no genres, within a per-caller daily budget and three strikes per book. Books it rejected or doubted appear on an admin page where the owner labels them.

**Architecture:**
- **Budget:** a catalog table `typesafe_usage(day, source, requests)` counts every TypeSafe request per caller. The classifier calls a caller-supplied `spend()` before each request.
- **Queue:** a generic in-memory work queue (`workQueue.ts`) runs the genre judgment. The books service fires a details-checked hook that adds works to it, and a daily sweep refills it.
- **Strikes:** book failures go to `genre_rejections`.
- **Review:** a review list and three actions live in the books module, beside the genre pass, behind two admin-only routes. A web page at `/admin/genres` sits on top of them.

**Tech Stack:** TypeScript, `node:sqlite`, Fastify + zod, React + TanStack Query, `node:test` through tsx.

**Spec:** `docs/superpowers/specs/2026-10-15-genre-review-design.md`. The backfill plan (`2026-10-15-catalog-genre-backfill.md`) builds its Jev pass on this plan's budget, strikes and `classifyWork`.

## Global Constraints

- No comments in code (root `AGENTS.md`). The why goes in the commit message.
- Minimum code that works. Reuse `@scripta/shared` before writing a helper.
- Consumers read shared's `dist/`. Run `npm run build --workspace @scripta/shared` before any backend, frontend or mobile typecheck or test.
- A new backend `*.test.ts` file goes into the explicit list in `backend/package.json` `"test"`, or CI never runs it. Frontend `scripts/test-*.mts` files are globbed.
- Backend tests set the env preamble (DB paths and JWT secrets) before `await import(...)`, as every books test does.
- TypeSafe is never called without `TYPESAFE_API_KEY`. Tests stub `fetch`, never call the API, and never set a real key.
- The GitHub repo is public. No real reader names or library details in code, tests, fixtures or docs.
- Constants, verbatim from the spec:
  - source `genres` with `GENRE_DAILY_BUDGET = 1000` requests per UTC day, retries included;
  - `GENRE_REJECTION_LIMIT = 3`;
  - `GENRE_IN_FLIGHT = 4`;
  - pauses: until the next UTC midnight when the budget is spent; 10 minutes after an outage; 24 hours after a 401;
  - the sweep runs at boot and every 24 hours;
  - the review list holds at most 200 works (`GENRE_REVIEW_LIMIT`), synopses cut to 300 characters;
  - labels have 1 to 3 distinct genres from `BOOK_GENRES` (`GENRE_LABEL_MAX = 3`).
- Source-agnostic names, so the synopsis and translation work can reuse them: `TypesafeBudgetSpentError`, `dailySpend`, `failureKind`, `createWorkQueue`, and the service's `onDetailsChecked` hook.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage and commit in one command, because concurrent sessions share the git index.
- Verify commands:
  - shared: `npm test --workspace @scripta/shared`
  - backend: `npm run typecheck --workspace backend && npm test --workspace backend`
  - frontend: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`

## Review Focus

1. **A details lookup for a book nobody holds never reaches TypeSafe.** That covers the details backfill over seed and publisher books, and anyone browsing the catalog. Pinned in Task 5.
2. **The budget holds at its edge.** The 1,000th `genres` request of a UTC day goes out; the 1,001st is refused before any fetch. Pinned in Task 1.
3. **A merged (alias) work id resolves to its canonical work.** This applies whether it comes from `library_books` or from the review URL. Pinned in Tasks 5 and 7.
4. **Four workers hitting a rejected key at the same moment send one alert, not four.** Pinned in Task 5.
5. **Retry on a work that already shows Jev's possible genres replaces them with the new answer.** Pinned in Task 7.

---

### Task 1: Per-caller TypeSafe budget

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`. Add the `typesafe_usage` table after `genre_judgments`.
- Modify: `backend/src/modules/books/domain/ports.ts`. Add `spendTypesafe` and `typesafeUsage` after `editionGenres`.
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`. Two statements and two methods.
- Create: `backend/src/modules/books/typesafe.ts`
- Create: `backend/src/modules/books/typesafe.test.ts`. Add `src/modules/books/typesafe.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/genreJudgments.test.ts`.

**Interfaces:**
- Produces, repo:
  - `spendTypesafe(day: string, source: string, limit: number): boolean`. Atomic: true when the request may go out.
  - `typesafeUsage(day: string, source: string): number`.
- Produces, `typesafe.ts`:
  - `class TypesafeBudgetSpentError extends Error { readonly source: string }`
  - `type Spend = () => void`
  - `utcDay(at: number): string` (`YYYY-MM-DD`)
  - `nextUtcMidnight(at: number): number`
  - `dailySpend(repo: Pick<BooksRepository, "spendTypesafe">, source: string, limit: number, now: () => number): Spend`

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/typesafe.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-typesafe-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { dailySpend, nextUtcMidnight, TypesafeBudgetSpentError, utcDay } = await import("./typesafe.js");

function repoAt(path: string) {
  const db = new DatabaseSync(path);
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

test("the 1,000th request of a day goes out and the 1,001st is refused", () => {
  const { repo } = repoAt(":memory:");
  const at = Date.parse("2026-10-15T12:00:00.000Z");
  const spend = dailySpend(repo, "genres", 1000, () => at);
  for (let request = 0; request < 1000; request++) spend();
  assert.throws(spend, (error: unknown) => error instanceof TypesafeBudgetSpentError && error.source === "genres");
  assert.equal(repo.typesafeUsage("2026-10-15", "genres"), 1000);
});

test("each source has its own count, and a new UTC day starts at zero", () => {
  const { repo } = repoAt(":memory:");
  let at = Date.parse("2026-10-15T23:59:59.000Z");
  const genres = dailySpend(repo, "genres", 2, () => at);
  genres();
  genres();
  assert.throws(genres, TypesafeBudgetSpentError);
  dailySpend(repo, "synopses", 2, () => at)();
  assert.equal(repo.typesafeUsage("2026-10-15", "synopses"), 1);
  at = Date.parse("2026-10-16T00:00:00.000Z");
  genres();
  assert.equal(repo.typesafeUsage("2026-10-16", "genres"), 1);
  assert.equal(repo.typesafeUsage("2026-10-15", "genres"), 2);
});

test("the count survives a new repository on the same database", () => {
  const path = join(scratch, "usage.sqlite");
  const first = repoAt(path);
  dailySpend(first.repo, "genres", 5, () => Date.parse("2026-10-15T08:00:00.000Z"))();
  first.db.close();
  const second = repoAt(path);
  assert.equal(second.repo.typesafeUsage("2026-10-15", "genres"), 1);
  second.db.close();
});

test("UTC day and next UTC midnight", () => {
  assert.equal(utcDay(Date.parse("2026-10-15T23:30:00.000-03:00")), "2026-10-16");
  assert.equal(nextUtcMidnight(Date.parse("2026-10-15T12:34:56.000Z")), Date.parse("2026-10-16T00:00:00.000Z"));
  assert.equal(nextUtcMidnight(Date.parse("2026-12-31T23:59:59.000Z")), Date.parse("2027-01-01T00:00:00.000Z"));
});
```

Add `src/modules/books/typesafe.test.ts` to the `backend/package.json` `"test"` list.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend`
Expected: FAIL. `./typesafe.js`, `spendTypesafe` and `typesafeUsage` don't exist.

- [ ] **Step 3: Implement**

1. **Table.** `books.sql`, after the `genre_judgments` table:

```sql
CREATE TABLE IF NOT EXISTS typesafe_usage (
  day      TEXT NOT NULL,
  source   TEXT NOT NULL,
  requests INTEGER NOT NULL,
  PRIMARY KEY (day, source)
);
```

2. **Port.** `domain/ports.ts`, after `editionGenres(...)`:

```ts
  spendTypesafe(day: string, source: string, limit: number): boolean;
  typesafeUsage(day: string, source: string): number;
```

3. **Repository.** `sqliteBooksRepository.ts`, after `undoJudgmentsStmt`:

```ts
  const spendTypesafeStmt = db.prepare(`
    INSERT INTO typesafe_usage (day, source, requests) VALUES (?, ?, 1)
    ON CONFLICT (day, source) DO UPDATE SET requests = requests + 1 WHERE requests < ?
  `);
  const typesafeUsageStmt = db.prepare(`SELECT requests FROM typesafe_usage WHERE day = ? AND source = ?`);
```

   In the returned object, after `applyGenreJudgments`:

```ts
    spendTypesafe(day, source, limit) {
      return Number(spendTypesafeStmt.run(day, source, limit).changes) > 0;
    },
    typesafeUsage(day, source) {
      return (typesafeUsageStmt.get(day, source) as { requests: number } | undefined)?.requests ?? 0;
    },
```

4. **Module.** `backend/src/modules/books/typesafe.ts`:

```ts
import type { BooksRepository } from "./domain/ports.js";

export class TypesafeBudgetSpentError extends Error {
  constructor(readonly source: string) {
    super(`TypeSafe budget for ${source} is spent`);
    this.name = "TypesafeBudgetSpentError";
  }
}

export type Spend = () => void;

export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function nextUtcMidnight(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function dailySpend(repo: Pick<BooksRepository, "spendTypesafe">, source: string, limit: number, now: () => number): Spend {
  return () => {
    if (!repo.spendTypesafe(utcDay(now()), source, limit)) throw new TypesafeBudgetSpentError(source);
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/typesafe.ts backend/src/modules/books/typesafe.test.ts backend/package.json && git commit -m "$(cat <<'EOF'
Count TypeSafe requests per caller and UTC day

typesafe_usage(day, source, requests) is the one place every Jev caller
records its spend; dailySpend refuses a request once a source has used
its day's limit, with a single conditional upsert so concurrent workers
can't overspend. Sources are named by the caller, so the synopsis and
translation work can add their own limits to the same table.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 2: The classifier spends budget and marks unusable answers

**Files:**
- Modify: `backend/src/modules/books/domain/errors.ts`. Add `UnusableAnswerError`.
- Modify: `backend/src/modules/books/adapters/typesafe/jevGenres.ts`
- Modify: `backend/src/modules/books/adapters/typesafe/jevGenres.test.ts`
- Modify: `backend/src/modules/books/typesafe.ts`. Add `failureKind`.
- Modify: `backend/src/modules/books/typesafe.test.ts`
- Modify: `backend/src/modules/books/genreJudgments.ts`. Add `GENRE_SOURCE` and `GENRE_DAILY_BUDGET` only.
- Modify: `backend/src/modules/books/plugin.ts`. Pass a spend to the classifier.

**Interfaces:**
- Consumes: `Spend`, `dailySpend`, `TypesafeBudgetSpentError` (Task 1).
- Produces:
  - `class UnusableAnswerError extends SourceUnavailableError { readonly detail: string }`
  - `createJevGenreClassifier(apiKey: string, spend: Spend, sleep?: (ms: number) => Promise<void>): ClassifyGenre`
  - `type FailureKind = "budget" | "key" | "book" | "outage"`
  - `failureKind(error: unknown): FailureKind | null`. `null` means not a TypeSafe failure; the caller rethrows.
  - `GENRE_SOURCE = "genres"`, `GENRE_DAILY_BUDGET = 1000` (in `genreJudgments.ts`)

- [ ] **Step 1: Write the failing tests**

In `jevGenres.test.ts`:
- Add `import { TypesafeBudgetSpentError } from "../../typesafe.js";` and change the errors import to `import { SourceUnavailableError, UnusableAnswerError } from "../../domain/errors.js";`.
- Add `const noSpend = () => {};`. Change every `createJevGenreClassifier("key", noSleep)` to `createJevGenreClassifier("key", noSpend, noSleep)`.
- Replace the last test ("an option the adapter doesn't know…") with:

```ts
test("an option the adapter doesn't know, or a body that isn't JSON, is an unusable answer", async () => {
  stub([answer("novel")]);
  await assert.rejects(createJevGenreClassifier("key", noSpend, noSleep)(book), (error: unknown) => error instanceof UnusableAnswerError && error.detail === "unexpected answer");
  stub([() => new Response("not json", { status: 200 })]);
  await assert.rejects(createJevGenreClassifier("key", noSpend, noSleep)(book), (error: unknown) => error instanceof UnusableAnswerError && error.detail === "invalid JSON");
});

test("every request spends budget first, retries included, and a spent budget makes no request", async () => {
  const seen = stub([status(429), answer("poetry")]);
  let spent = 0;
  await createJevGenreClassifier("key", () => { spent += 1; }, noSleep)(book);
  assert.equal(spent, 2);
  assert.equal(seen.length, 2);
  const none = stub([answer("poetry")]);
  await assert.rejects(createJevGenreClassifier("key", () => { throw new TypesafeBudgetSpentError("genres"); }, noSleep)(book), TypesafeBudgetSpentError);
  assert.equal(none.length, 0);
});
```

Append to `typesafe.test.ts`, and add `UnusableAnswerError` and `SourceUnavailableError` to its imports through `const { SourceUnavailableError, UnusableAnswerError } = await import("./domain/errors.js");`. Add `failureKind` to the `./typesafe.js` import.

```ts
test("failures sort into budget, key, book and outage", () => {
  const status = (code: number) => new SourceUnavailableError("typesafe", `HTTP ${code}`, { status: code });
  assert.equal(failureKind(new TypesafeBudgetSpentError("genres")), "budget");
  assert.equal(failureKind(status(401)), "key");
  for (const code of [400, 403, 404, 413, 422]) assert.equal(failureKind(status(code)), "book", String(code));
  assert.equal(failureKind(new UnusableAnswerError("typesafe", "unexpected answer")), "book");
  for (const code of [429, 500, 529]) assert.equal(failureKind(status(code)), "outage", String(code));
  assert.equal(failureKind(new SourceUnavailableError("typesafe", "fetch failed")), "outage");
  assert.equal(failureKind(new TypeError("boom")), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `UnusableAnswerError` and `failureKind` don't exist, and `createJevGenreClassifier` takes no spend.

- [ ] **Step 3: Implement**

1. **Error.** `domain/errors.ts`, after `SourcePausedError`:

```ts
export class UnusableAnswerError extends SourceUnavailableError {
  constructor(source: string, readonly detail: string) {
    super(source, detail);
    this.name = "UnusableAnswerError";
  }
}
```

2. **Adapter.** `jevGenres.ts`:
   - Change the errors import to `import { SourceUnavailableError, UnusableAnswerError } from "../../domain/errors.js";`. Add `import type { Spend } from "../../typesafe.js";`.
   - In `judgmentOf`, throw `new UnusableAnswerError("typesafe", "unexpected answer")` instead of the `SourceUnavailableError`.
   - Replace `createJevGenreClassifier` with:

```ts
export function createJevGenreClassifier(apiKey: string, spend: Spend, sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): ClassifyGenre {
  return async (book) => {
    const body = JSON.stringify({ state: stateOf(book), model: JEV_MODEL, questions: { genre: { type: "choice", instructions: INSTRUCTIONS, criteria: CRITERIA } } });
    for (let attempt = 0; ; attempt++) {
      spend();
      const response = await readBody("typesafe", () => fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(TIMEOUT_MS) }));
      if ((response.status === 429 || response.status === 529) && attempt < RETRIES) {
        await response.body?.cancel();
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new SourceUnavailableError("typesafe", `HTTP ${response.status}`, { status: response.status });
      }
      let parsed: unknown;
      try {
        parsed = await readBody("typesafe", () => response.json());
      } catch (error) {
        if (error instanceof SyntaxError) throw new UnusableAnswerError("typesafe", "invalid JSON");
        throw error;
      }
      return judgmentOf(parsed);
    }
  };
}
```

3. **failureKind.** `typesafe.ts`: add `import { SourceUnavailableError, UnusableAnswerError } from "./domain/errors.js";` and append:

```ts
export type FailureKind = "budget" | "key" | "book" | "outage";

export function failureKind(error: unknown): FailureKind | null {
  if (error instanceof TypesafeBudgetSpentError) return "budget";
  if (error instanceof UnusableAnswerError) return "book";
  if (!(error instanceof SourceUnavailableError)) return null;
  if (error.status === 401) return "key";
  if (error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 429) return "book";
  return "outage";
}
```

4. **Constants.** `genreJudgments.ts`, after `GENRE_SAVE_LINE`:

```ts
export const GENRE_SOURCE = "genres";
export const GENRE_DAILY_BUDGET = 1000;
```

5. **Plugin.**
   - `plugin.ts`: add `import { dailySpend } from "./typesafe.js";` and add `GENRE_DAILY_BUDGET` and `GENRE_SOURCE` to the `./genreJudgments.js` import.
   - The classifier line becomes:

```ts
  const classify = typesafeConfigured ? createJevGenreClassifier(env.TYPESAFE_API_KEY, dailySpend(repo, GENRE_SOURCE, GENRE_DAILY_BUDGET, Date.now)) : null;
```

   - Leave the rest of the wiring for Task 5.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/errors.ts backend/src/modules/books/adapters/typesafe backend/src/modules/books/typesafe.ts backend/src/modules/books/typesafe.test.ts backend/src/modules/books/genreJudgments.ts backend/src/modules/books/plugin.ts && git commit -m "$(cat <<'EOF'
Spend genre budget before every Jev request and mark unusable answers

The classifier now calls its caller's spend() before each request,
retries included, so a spent budget makes no request at all. An answer
the adapter can't use is an UnusableAnswerError, so callers can tell a
book TypeSafe can't classify from an outage, whose network errors also
carry no status. failureKind sorts every failure into budget, key, book
or outage for any TypeSafe caller.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 3: Strikes, scoped apply and judgment models in the repository

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`. Add `genre_rejections` after `typesafe_usage`.
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/genreJudgments.ts`. Add `GENRE_REJECTION_LIMIT`, and pass it in `judgeGenres`.
- Modify: `backend/src/modules/books/genrePass.ts`. Map judgments to `{ genre, confidence }`.
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`, plus updates to `genrePass.test.ts` and `genreJudgments.test.ts`.

**Interfaces:**
- Produces, repo:
  - `worksNeedingGenreJudgment(workIds: string[], limit: number, rejectionLimit: number): string[]` (new third argument)
  - `genreJudgments(workIds: string[]): Map<string, { model: string; genre: string | null; confidence: number }>` (adds `model`)
  - `applyGenreJudgment(workId: string, saveLine: number): void` (one work)
  - `deleteGenreJudgment(workId: string): void` (keeps a `manual` judgment)
  - `recordGenreRejection(rejection: { workId: string; status: number | null; reason: string; at: string }): void`
  - `clearGenreRejection(workId: string): void`
  - `genreRejections(workIds: string[]): Map<string, { status: number | null; reason: string; attempts: number; lastAt: string }>`
- Produces: `GENRE_REJECTION_LIMIT = 3` (in `genreJudgments.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `sqliteBooksRepository.test.ts`. It already has `freshRepo`, `NOW`, `genreRow` and `titled`.

```ts
test("strikes count per work, keep the latest failure, and stop selection at the limit", () => {
  const { repo } = freshRepo();
  const book = titled(repo, "Struck");
  repo.markDetailsMissing(book.id, NOW);
  const work = book.work_id!;
  repo.recordGenreRejection({ workId: work, status: 400, reason: "HTTP 400", at: NOW });
  repo.recordGenreRejection({ workId: work, status: null, reason: "unexpected answer", at: "2026-10-02T00:00:00.000Z" });
  assert.deepEqual(repo.genreRejections([work]).get(work), { status: null, reason: "unexpected answer", attempts: 2, lastAt: "2026-10-02T00:00:00.000Z" });
  assert.deepEqual(repo.worksNeedingGenreJudgment([work], 10, 3), [work]);
  repo.recordGenreRejection({ workId: work, status: 422, reason: "HTTP 422", at: NOW });
  assert.deepEqual(repo.worksNeedingGenreJudgment([work], 10, 3), []);
  repo.clearGenreRejection(work);
  assert.deepEqual(repo.worksNeedingGenreJudgment([work], 10, 3), [work]);
  assert.equal(repo.genreRejections([work]).size, 0);
});

test("applying one work's judgment touches only that work and repeats as a no-op", () => {
  const { db, repo } = freshRepo();
  const [one, two] = ["One", "Two"].map((title) => titled(repo, title));
  for (const book of [one, two]) repo.saveGenreJudgment({ workId: book!.work_id!, model: "jev-1.13.0", genre: "History", confidence: 0.9, askedAt: NOW });
  repo.applyGenreJudgment(one!.work_id!, 0.5);
  assert.deepEqual(genreRow(db, one!.id), { genres: JSON.stringify(["History"]), genres_source: "jev", genres_confidence: 0.9 });
  assert.deepEqual(genreRow(db, two!.id), { genres: "[]", genres_source: null, genres_confidence: null });
  const changes = () => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  const before = changes();
  repo.applyGenreJudgment(one!.work_id!, 0.5);
  assert.equal(changes(), before);
  repo.saveGenreJudgment({ workId: one!.work_id!, model: "jev-1.13.0", genre: null, confidence: 0.9, askedAt: NOW });
  repo.applyGenreJudgment(one!.work_id!, 0.5);
  assert.deepEqual(genreRow(db, one!.id), { genres: "[]", genres_source: null, genres_confidence: null });
});

test("deleting a judgment removes Jev's answer and keeps the owner's", () => {
  const { repo } = freshRepo();
  const [jev, manual] = ["Jev", "Manual"].map((title) => titled(repo, title));
  repo.saveGenreJudgment({ workId: jev!.work_id!, model: "jev-1.13.0", genre: "Poetry", confidence: 0.3, askedAt: NOW });
  repo.saveGenreJudgment({ workId: manual!.work_id!, model: "manual", genre: null, confidence: 1, askedAt: NOW });
  repo.deleteGenreJudgment(jev!.work_id!);
  repo.deleteGenreJudgment(manual!.work_id!);
  const judgments = repo.genreJudgments([jev!.work_id!, manual!.work_id!]);
  assert.equal(judgments.has(jev!.work_id!), false);
  assert.deepEqual(judgments.get(manual!.work_id!), { model: "manual", genre: null, confidence: 1 });
});
```

Update the existing calls and assertions:
- In `sqliteBooksRepository.test.ts`, every `repo.worksNeedingGenreJudgment(x, n)` call becomes `repo.worksNeedingGenreJudgment(x, n, 3)`. They are at the lines `rg -n "worksNeedingGenreJudgment" backend/src` lists.
- In the same file, the expected map `{ genre: null, confidence: 0.9 }` becomes `{ model: "jev-1.13.0", genre: null, confidence: 0.9 }`.
- In `genrePass.test.ts`, the two `worksNeedingGenreJudgment([blank], 10)` calls become `worksNeedingGenreJudgment([blank], 10, 3)`.
- In `genreJudgments.test.ts`, the expected `{ genre: "Poetry", confidence: 0.3 }` becomes `{ model: "jev-1.13.0", genre: "Poetry", confidence: 0.3 }`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. The new repo methods and the third argument don't exist.

- [ ] **Step 3: Implement**

1. **Table.** `books.sql`, after `typesafe_usage`:

```sql
CREATE TABLE IF NOT EXISTS genre_rejections (
  work_id  TEXT PRIMARY KEY,
  status   INTEGER,
  reason   TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_at  TEXT NOT NULL
);
```

2. **Port.** `domain/ports.ts`:
   - The `worksNeedingGenreJudgment` line becomes `worksNeedingGenreJudgment(workIds: string[], limit: number, rejectionLimit: number): string[];`.
   - The `genreJudgments` line becomes `genreJudgments(workIds: string[]): Map<string, { model: string; genre: string | null; confidence: number }>;`.
   - After `applyGenreJudgments(...)`, add:

```ts
  applyGenreJudgment(workId: string, saveLine: number): void;
  deleteGenreJudgment(workId: string): void;
  recordGenreRejection(rejection: { workId: string; status: number | null; reason: string; at: string }): void;
  clearGenreRejection(workId: string): void;
  genreRejections(workIds: string[]): Map<string, { status: number | null; reason: string; attempts: number; lastAt: string }>;
```

3. **Repository statements.** `sqliteBooksRepository.ts`:
   - Replace `needingJudgmentStmt` with:

```ts
  const needingJudgmentStmt = db.prepare(`
    SELECT w.value AS id FROM json_each(?) AS w
    WHERE NOT EXISTS (SELECT 1 FROM genre_judgments j WHERE j.work_id = w.value)
      AND NOT EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.value AND b.genres <> '[]' AND b.genres_source IS NOT 'jev')
      AND EXISTS (SELECT 1 FROM books b WHERE b.work_id = w.value AND b.details_status IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM genre_rejections r WHERE r.work_id = w.value AND r.attempts >= ?)
    LIMIT ?
  `);
```

   - Replace `judgmentsStmt` with:

```ts
  const judgmentsStmt = db.prepare(`SELECT work_id, model, genre, confidence FROM genre_judgments WHERE work_id IN (SELECT value FROM json_each(?))`);
```

   - After `typesafeUsageStmt`, add:

```ts
  const applyJudgmentForWorkStmt = db.prepare(`
    UPDATE books SET genres = json_array(j.genre), genres_source = 'jev', genres_confidence = j.confidence
    FROM genre_judgments AS j
    WHERE books.work_id = ? AND j.work_id = books.work_id AND j.genre IS NOT NULL AND j.confidence >= ?
      AND (books.genres = '[]' OR books.genres_source = 'jev')
      AND NOT (books.genres = json_array(j.genre) AND books.genres_source = 'jev' AND books.genres_confidence IS j.confidence)
  `);
  const undoJudgmentForWorkStmt = db.prepare(`
    UPDATE books SET genres = '[]', genres_source = NULL, genres_confidence = NULL
    WHERE work_id = ? AND genres_source = 'jev'
      AND EXISTS (SELECT 1 FROM genre_judgments j WHERE j.work_id = books.work_id AND (j.genre IS NULL OR j.confidence < ?))
  `);
  const deleteJudgmentStmt = db.prepare(`DELETE FROM genre_judgments WHERE work_id = ? AND model <> 'manual'`);
  const recordRejectionStmt = db.prepare(`
    INSERT INTO genre_rejections (work_id, status, reason, attempts, last_at) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (work_id) DO UPDATE SET status = excluded.status, reason = excluded.reason, attempts = attempts + 1, last_at = excluded.last_at
  `);
  const clearRejectionStmt = db.prepare(`DELETE FROM genre_rejections WHERE work_id = ?`);
  const rejectionsStmt = db.prepare(`SELECT work_id, status, reason, attempts, last_at FROM genre_rejections WHERE work_id IN (SELECT value FROM json_each(?))`);
```

4. **Repository methods.**
   - `worksNeedingGenreJudgment` becomes:

```ts
    worksNeedingGenreJudgment(workIds, limit, rejectionLimit) {
      return (needingJudgmentStmt.all(JSON.stringify(workIds), rejectionLimit, limit) as Array<{ id: string }>).map((row) => row.id);
    },
```

   - `genreJudgments` becomes:

```ts
    genreJudgments(workIds) {
      const rows = judgmentsStmt.all(JSON.stringify(workIds)) as Array<{ work_id: string; model: string; genre: string | null; confidence: number }>;
      return new Map(rows.map((row) => [row.work_id, { model: row.model, genre: row.genre, confidence: row.confidence }]));
    },
```

   - After `typesafeUsage`, add:

```ts
    applyGenreJudgment(workId, saveLine) {
      inTransaction(() => {
        undoJudgmentForWorkStmt.run(workId, saveLine);
        applyJudgmentForWorkStmt.run(workId, saveLine);
      });
    },
    deleteGenreJudgment(workId) {
      deleteJudgmentStmt.run(workId);
    },
    recordGenreRejection(rejection) {
      recordRejectionStmt.run(rejection.workId, rejection.status, rejection.reason, rejection.at);
    },
    clearGenreRejection(workId) {
      clearRejectionStmt.run(workId);
    },
    genreRejections(workIds) {
      const rows = rejectionsStmt.all(JSON.stringify(workIds)) as Array<{ work_id: string; status: number | null; reason: string; attempts: number; last_at: string }>;
      return new Map(rows.map((row) => [row.work_id, { status: row.status, reason: row.reason, attempts: row.attempts, lastAt: row.last_at }]));
    },
```

5. **Callers.**
   - `genreJudgments.ts`: add `export const GENRE_REJECTION_LIMIT = 3;` after `GENRE_DAILY_BUDGET`. In `judgeGenres`, the call becomes `deps.repo.worksNeedingGenreJudgment(held, limit, GENRE_REJECTION_LIMIT)`.
   - `genrePass.ts`: in `genrePassWorksWith`, change `jev: judgments.get(workId) ?? null` to:

```ts
jev: judgments.has(workId) ? { genre: judgments.get(workId)!.genre, confidence: judgments.get(workId)!.confidence } : null
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books && git commit -m "$(cat <<'EOF'
Record genre strikes per work and apply one work's judgment at a time

genre_rejections counts the failures that belong to a book, and the
selection skips a work at the strike limit. applyGenreJudgment undoes
and applies a single work's Jev genres, so answering one book doesn't
scan the whole catalog; it skips rows that already hold the answer.
Judgments now carry their model, so callers can tell the owner's
"no genre" from Jev's, and deleteGenreJudgment keeps the owner's.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 4: A generic in-memory work queue

**Files:**
- Create: `backend/src/modules/books/workQueue.ts`
- Create: `backend/src/modules/books/workQueue.test.ts`. Add `src/modules/books/workQueue.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/typesafe.test.ts`.

**Interfaces:**
- Produces:
  - `type WorkQueue = { add(workId: string): void; size(): number; stop(): void }`
  - `type WorkQueueOptions = { concurrency: number; run: (workId: string) => Promise<number | null>; onError: (error: unknown, workId: string) => void; now?: () => number; setTimer?: (callback: () => void, ms: number) => () => void; schedule?: (callback: () => void) => void }`
  - `createWorkQueue(options: WorkQueueOptions): WorkQueue`
- **Behaviour:**
  - `run` resolves to `null` when the work is done, or to a timestamp to pause the queue until; that work goes back to the front.
  - `add` is constant-time and never runs work synchronously: work starts on `schedule` (default `setImmediate`).
  - Ids are de-duplicated while queued or running.

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/workQueue.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkQueue } from "./workQueue.js";

const flush = async () => {
  for (let tick = 0; tick < 5; tick++) await new Promise(setImmediate);
};

test("adding never runs work synchronously, and duplicates collapse", async () => {
  const ran: string[] = [];
  const queue = createWorkQueue({ concurrency: 4, run: async (id) => { ran.push(id); return null; }, onError: () => {} });
  queue.add("a");
  queue.add("a");
  assert.deepEqual(ran, []);
  assert.equal(queue.size(), 1);
  await flush();
  assert.deepEqual(ran, ["a"]);
  assert.equal(queue.size(), 0);
});

test("at most the concurrency runs at once", async () => {
  let running = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const queue = createWorkQueue({
    concurrency: 4,
    run: (id) => new Promise((resolve) => {
      running += 1;
      peak = Math.max(peak, running);
      releases.push(() => { running -= 1; resolve(null); });
    }),
    onError: () => {}
  });
  for (const id of ["a", "b", "c", "d", "e", "f"]) queue.add(id);
  await flush();
  assert.equal(running, 4);
  while (releases.length > 0) {
    releases.shift()!();
    await flush();
  }
  assert.equal(peak, 4);
  assert.equal(queue.size(), 0);
});

test("a pause keeps the work and resumes it at the given time", async () => {
  let now = 1_000;
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const calls: string[] = [];
  const queue = createWorkQueue({
    concurrency: 1,
    now: () => now,
    setTimer: (callback, ms) => { timers.push({ callback, ms }); return () => {}; },
    run: async (id) => {
      calls.push(id);
      return calls.length === 1 ? 61_000 : null;
    },
    onError: () => {}
  });
  queue.add("a");
  queue.add("b");
  await flush();
  assert.deepEqual(calls, ["a"]);
  assert.deepEqual(timers.map((timer) => timer.ms), [60_000]);
  assert.equal(queue.size(), 2);
  now = 61_000;
  timers[0]!.callback();
  await flush();
  assert.deepEqual(calls, ["a", "a", "b"]);
  assert.equal(queue.size(), 0);
});

test("an error drops that work, reports it, and the queue goes on", async () => {
  const errors: Array<[string, string]> = [];
  const ran: string[] = [];
  const queue = createWorkQueue({
    concurrency: 1,
    run: async (id) => {
      ran.push(id);
      if (id === "bad") throw new Error("boom");
      return null;
    },
    onError: (error, id) => { errors.push([id, (error as Error).message]); }
  });
  queue.add("bad");
  queue.add("good");
  await flush();
  assert.deepEqual(errors, [["bad", "boom"]]);
  assert.deepEqual(ran, ["bad", "good"]);
  assert.equal(queue.size(), 0);
});

test("stop drops queued work and ignores later adds", async () => {
  const ran: string[] = [];
  let cancelled = 0;
  const queue = createWorkQueue({
    concurrency: 1,
    setTimer: () => () => { cancelled += 1; },
    run: async (id) => { ran.push(id); return id === "a" ? Date.now() + 60_000 : null; },
    onError: () => {}
  });
  queue.add("a");
  await flush();
  queue.stop();
  queue.add("b");
  await flush();
  assert.deepEqual(ran, ["a"]);
  assert.equal(queue.size(), 0);
  assert.equal(cancelled, 1);
});
```

Add the file to `backend/package.json` `"test"`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL with "Cannot find module './workQueue.js'".

- [ ] **Step 3: Implement**

`backend/src/modules/books/workQueue.ts`:

```ts
export type WorkQueue = { add(workId: string): void; size(): number; stop(): void };

export type WorkQueueOptions = {
  concurrency: number;
  run: (workId: string) => Promise<number | null>;
  onError: (error: unknown, workId: string) => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => () => void;
  schedule?: (callback: () => void) => void;
};

function unrefTimer(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms);
  timer.unref();
  return () => clearTimeout(timer);
}

export function createWorkQueue(options: WorkQueueOptions): WorkQueue {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? unrefTimer;
  const schedule = options.schedule ?? ((callback: () => void) => { setImmediate(callback); });
  const waiting: string[] = [];
  const known = new Set<string>();
  let running = 0;
  let pausedUntil = 0;
  let cancelResume: (() => void) | null = null;
  let stopped = false;

  function pauseUntil(at: number) {
    if (at <= pausedUntil) return;
    pausedUntil = at;
    cancelResume?.();
    cancelResume = setTimer(() => {
      cancelResume = null;
      pump();
    }, Math.max(0, at - now()));
  }

  function pump() {
    while (!stopped && now() >= pausedUntil && running < options.concurrency && waiting.length > 0) {
      const workId = waiting.shift()!;
      running += 1;
      options
        .run(workId)
        .then((resumeAt) => {
          if (resumeAt === null || stopped) {
            known.delete(workId);
            return;
          }
          waiting.unshift(workId);
          pauseUntil(resumeAt);
        })
        .catch((error: unknown) => {
          known.delete(workId);
          options.onError(error, workId);
        })
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  }

  return {
    add(workId) {
      if (stopped || known.has(workId)) return;
      known.add(workId);
      waiting.push(workId);
      schedule(pump);
    },
    size: () => known.size,
    stop() {
      stopped = true;
      cancelResume?.();
      cancelResume = null;
      waiting.length = 0;
      known.clear();
    }
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/workQueue.ts backend/src/modules/books/workQueue.test.ts backend/package.json && git commit -m "$(cat <<'EOF'
Add a small in-memory work queue for background TypeSafe calls

De-duplicated by work id, bounded concurrency, and work starts on the
next macrotask so adding from a request handler never runs it inline.
A run that answers with a timestamp pauses the queue until then and
keeps its work at the front. It knows nothing about genres, so the
synopsis and translation checks can queue through it too.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 5: Jev on details lookups, a daily sweep, and the wiring

**Files:**
- Modify: `backend/src/modules/books/genreJudgments.ts` (rewrite below)
- Modify: `backend/src/modules/books/genreJudgments.test.ts` (rewrite below)
- Modify: `backend/src/modules/books/booksService.ts`. Add the `onDetailsChecked` dep and fire it after a finished lookup.
- Modify: `backend/src/modules/books/booksService.test.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/src/app.ts`. Pass `heldWorks` instead of `heldWorkIds`.
- Modify: `backend/README.md`. Replace the "Genre judgments (Jev)" bullet.

**Interfaces:**
- Consumes: Tasks 1–4. `HeldWork` (`{ workId; holders; finished }`) from `./genrePass.js`.
- Produces:
  - `type GenreJudgmentDeps = { repo: BooksRepository; classify: ClassifyGenre; now: () => number; alert: (subject: string, text: string) => void }`
  - `classifyWork(deps: GenreJudgmentDeps, workId: string): Promise<number | null>`. It classifies one canonical work with no eligibility check: stores the answer, applies it, clears strikes, or records a strike or returns a pause. The backfill plan's backlog pass reuses it.
  - `judgeWork(deps: GenreJudgmentDeps & { heldWorkIds: () => string[] }, workId: string): Promise<number | null>`. Eligibility (canonical, held, needs a judgment) plus `classifyWork`.
  - `startGenreJobs(deps: GenreJudgmentDeps & { heldWorkIds: () => string[]; onError: (error: unknown, workId?: string) => void }): GenreJobs`, where `GenreJobs = { add(workId: string): void; stop(): void }`.
  - `startGenreJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startGenreJobs>[0], "classify">): GenreJobs | null`
  - `jevBookOf` unchanged.
  - `BooksServiceDeps.onDetailsChecked?: (book: BookRow) => void`
  - `BooksPluginOptions.heldWorks?: () => HeldWork[]`, replacing `heldWorkIds`.

- [ ] **Step 1: Write the failing tests**

Replace `backend/src/modules/books/genreJudgments.test.ts` with:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-genre-judgments-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError, UnusableAnswerError } = await import("./domain/errors.js");
const { jevBookOf, judgeWork, startGenreJobs, startGenreJobsIfConfigured } = await import("./genreJudgments.js");
const { TypesafeBudgetSpentError } = await import("./typesafe.js");

type Classify = Parameters<typeof judgeWork>[0]["classify"];
const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const flush = async () => {
  for (let tick = 0; tick < 10; tick++) await new Promise(setImmediate);
};

function seeded(titles: string[]) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const at = new Date(NOW).toISOString();
  const books = titles.map((title) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], at));
  for (const book of books) repo.markDetailsMissing(book.id, at);
  return { db, repo, workIds: books.map((book) => book.work_id!) };
}

function deps(repo: ReturnType<typeof seeded>["repo"], held: string[], classify: Classify, alerts: string[] = []) {
  return { repo, classify, heldWorkIds: () => held, now: () => NOW, alert: (subject: string) => { alerts.push(subject); } };
}

const answer = (genre: "History" | "Poetry" | null, confidence: number) => async () => ({ genre, confidence, model: "jev-1.13.0" });
const genresOf = (db: DatabaseSync, title: string) => (db.prepare("SELECT genres FROM books WHERE title = ?").get(title) as { genres: string }).genres;

test("a held work with no genres is asked once, stored, applied, and its strikes cleared", async () => {
  const { db, repo, workIds } = seeded(["Sure"]);
  repo.recordGenreRejection({ workId: workIds[0]!, status: 400, reason: "HTTP 400", at: new Date(NOW).toISOString() });
  assert.equal(await judgeWork(deps(repo, workIds, answer("History", 0.9)), workIds[0]!), null);
  assert.equal(genresOf(db, "Sure"), JSON.stringify(["History"]));
  assert.equal(repo.genreRejections(workIds).size, 0);
  assert.equal(await judgeWork(deps(repo, workIds, async () => { throw new Error("asked twice"); }), workIds[0]!), null);
});

test("a work no library holds is skipped without asking", async () => {
  const { repo, workIds } = seeded(["Catalog only"]);
  assert.equal(await judgeWork(deps(repo, [], async () => { throw new Error("asked"); }), workIds[0]!), null);
  assert.equal(repo.genreJudgments(workIds).size, 0);
});

test("a held alias id is judged as its canonical work", async () => {
  const { db, repo, workIds } = seeded(["Kept", "Merged"]);
  repo.mergeWorks(workIds[1]!, workIds[0]!);
  assert.equal(await judgeWork(deps(repo, [workIds[1]!], answer("Poetry", 0.95)), workIds[1]!), null);
  assert.deepEqual([...repo.genreJudgments([workIds[0]!]).keys()], [workIds[0]]);
  assert.equal(genresOf(db, "Kept"), JSON.stringify(["Poetry"]));
});

test("a book failure records a strike and lets the queue go on; three strikes stop asking", async () => {
  const { repo, workIds } = seeded(["Rejected"]);
  const rejected: Classify = async () => { throw new SourceUnavailableError("typesafe", "HTTP 400", { status: 400 }); };
  const unusable: Classify = async () => { throw new UnusableAnswerError("typesafe", "unexpected answer"); };
  assert.equal(await judgeWork(deps(repo, workIds, rejected), workIds[0]!), null);
  assert.equal(await judgeWork(deps(repo, workIds, unusable), workIds[0]!), null);
  assert.equal(await judgeWork(deps(repo, workIds, rejected), workIds[0]!), null);
  assert.deepEqual(repo.genreRejections(workIds).get(workIds[0]!), { status: 400, reason: "HTTP 400", attempts: 3, lastAt: new Date(NOW).toISOString() });
  assert.equal(await judgeWork(deps(repo, workIds, async () => { throw new Error("asked a fourth time"); }), workIds[0]!), null);
});

test("an unusable answer's strike keeps its detail as the reason", async () => {
  const { repo, workIds } = seeded(["Odd"]);
  await judgeWork(deps(repo, workIds, async () => { throw new UnusableAnswerError("typesafe", "unexpected answer"); }), workIds[0]!);
  assert.deepEqual(repo.genreRejections(workIds).get(workIds[0]!), { status: null, reason: "unexpected answer", attempts: 1, lastAt: new Date(NOW).toISOString() });
});

test("outages, a spent budget and a rejected key pause without storing or striking", async () => {
  const { repo, workIds } = seeded(["Paused"]);
  const alerts: string[] = [];
  const outage: Classify = async () => { throw new SourceUnavailableError("typesafe", "HTTP 529", { status: 529 }); };
  const spent: Classify = async () => { throw new TypesafeBudgetSpentError("genres"); };
  const key: Classify = async () => { throw new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }); };
  assert.equal(await judgeWork(deps(repo, workIds, outage), workIds[0]!), NOW + 10 * 60 * 1000);
  assert.equal(await judgeWork(deps(repo, workIds, spent), workIds[0]!), Date.parse("2026-10-16T00:00:00.000Z"));
  assert.equal(await judgeWork(deps(repo, workIds, key, alerts), workIds[0]!), NOW + 24 * 60 * 60 * 1000);
  assert.deepEqual(alerts, ["TypeSafe rejected the genre requests"]);
  assert.equal(repo.genreJudgments(workIds).size, 0);
  assert.equal(repo.genreRejections(workIds).size, 0);
});

test("an error that isn't a TypeSafe failure is rethrown", async () => {
  const { repo, workIds } = seeded(["Bug"]);
  await assert.rejects(judgeWork(deps(repo, workIds, async () => { throw new TypeError("bug"); }), workIds[0]!), TypeError);
});

test("the boot sweep queues held works and judges them", async () => {
  const { db, repo, workIds } = seeded(["One", "Two", "Not held"]);
  const jobs = startGenreJobs({ ...deps(repo, workIds.slice(0, 2), answer("History", 0.9)), onError: (error) => { throw error; } });
  await flush();
  jobs.stop();
  assert.equal(genresOf(db, "One"), JSON.stringify(["History"]));
  assert.equal(genresOf(db, "Two"), JSON.stringify(["History"]));
  assert.equal(genresOf(db, "Not held"), "[]");
});

test("four workers hitting a rejected key at once send one alert", async () => {
  const { repo, workIds } = seeded(["K1", "K2", "K3", "K4"]);
  const alerts: string[] = [];
  const key: Classify = async () => { throw new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }); };
  const jobs = startGenreJobs({ ...deps(repo, workIds, key, alerts), onError: (error) => { throw error; } });
  await flush();
  jobs.stop();
  assert.deepEqual(alerts, ["TypeSafe rejected the genre requests"]);
});

test("without a key nothing starts", () => {
  const { repo } = seeded([]);
  assert.equal(startGenreJobsIfConfigured("", { repo, heldWorkIds: () => [], now: () => NOW, alert: () => {}, onError: () => {} }), null);
});

test("Jev reads the work's title, author, edition languages, publishers and longest synopsis", () => {
  assert.deepEqual(jevBookOf({ work: { id: "w", title: "Os Anões", author: "Harold Pinter", summary: null }, editions: [
    { title: "Os Anões", language: "pt-PT", isbn: null, publisher: "Relógio", year: null, summary: "Curto." },
    { title: "The Dwarfs", language: "en", isbn: null, publisher: null, year: 1990, summary: "x".repeat(1500) },
    { title: "Os Anões", language: "pt-PT", isbn: null, publisher: "Relógio", year: null, summary: null }
  ] }), { title: "Os Anões", author: "Harold Pinter", editionLanguages: ["pt-PT", "en"], publishers: ["Relógio"], synopsis: "x".repeat(1200) });
});
```

Append to `booksService.test.ts`:

```ts
test("a finished details lookup reports the edition, from a request and from the backfill", async () => {
  const checked: Array<{ id: string; status: string | null }> = [];
  const quiet = { fetchDetails: async () => null, search: async () => [] };
  const h = harness({ catalog: quiet, backgroundCatalog: quiet, onDetailsChecked: (book) => { checked.push({ id: book.id, status: book.details_status }); } });
  await h.service.getDetails({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  assert.deepEqual(checked, [{ id: h.bookId("isbn:9780441013593"), status: "missing" }]);
  await h.service.getDetails({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" });
  assert.equal(checked.length, 1);
  const emma = h.repo.createBook({ title: "Emma", author: "Jane Austen", isbn: null }, ["ta:emma|jane austen|"], "2026-10-01T00:00:00.000Z");
  await h.service.backfillDetails(50);
  assert.deepEqual(checked[1], { id: emma.id, status: "missing" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `judgeWork`, `startGenreJobs`, `startGenreJobsIfConfigured` and `onDetailsChecked` don't exist.

- [ ] **Step 3: Implement**

1. **Genre jobs.** Replace `backend/src/modules/books/genreJudgments.ts` with:

```ts
import { createJevGenreClassifier, type ClassifyGenre, type JevBook } from "./adapters/typesafe/jevGenres.js";
import { startDetailsBackfill } from "./backfill.js";
import { SourceUnavailableError, UnusableAnswerError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import type { GenreEvidence } from "./domain/types.js";
import { longestSynopsis } from "./genrePass.js";
import { dailySpend, failureKind, nextUtcMidnight } from "./typesafe.js";
import { createWorkQueue } from "./workQueue.js";

export const GENRE_SAVE_LINE = 0.5;
export const GENRE_SOURCE = "genres";
export const GENRE_DAILY_BUDGET = 1000;
export const GENRE_REJECTION_LIMIT = 3;
export const GENRE_IN_FLIGHT = 4;
const GENRE_SWEEP_LIMIT = 1000;
const GENRE_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const OUTAGE_PAUSE_MS = 10 * 60 * 1000;
const KEY_PAUSE_MS = 24 * 60 * 60 * 1000;

export type GenreJudgmentDeps = {
  repo: BooksRepository;
  classify: ClassifyGenre;
  now: () => number;
  alert: (subject: string, text: string) => void;
};
type HeldDeps = GenreJudgmentDeps & { heldWorkIds: () => string[] };
export type GenreJobs = { add(workId: string): void; stop(): void };

const distinct = (values: Array<string | null>) => [...new Set(values.filter((value): value is string => Boolean(value)))];

export function jevBookOf(evidence: GenreEvidence): JevBook {
  return {
    title: evidence.work.title,
    author: evidence.work.author,
    editionLanguages: distinct(evidence.editions.map((edition) => edition.language)),
    publishers: distinct(evidence.editions.map((edition) => edition.publisher)),
    synopsis: longestSynopsis(evidence)
  };
}

function strikeReason(error: unknown): { status: number | null; reason: string } {
  if (error instanceof UnusableAnswerError) return { status: null, reason: error.detail };
  const status = (error as SourceUnavailableError).status ?? null;
  return { status, reason: `HTTP ${status}` };
}

export async function classifyWork(deps: GenreJudgmentDeps, workId: string): Promise<number | null> {
  const evidence = deps.repo.genreEvidence(workId);
  if (!evidence) return null;
  const at = () => new Date(deps.now()).toISOString();
  try {
    const judgment = await deps.classify(jevBookOf(evidence));
    deps.repo.transaction(() => {
      deps.repo.saveGenreJudgment({ workId, model: judgment.model, genre: judgment.genre, confidence: judgment.confidence, askedAt: at() });
      deps.repo.clearGenreRejection(workId);
      deps.repo.applyGenreJudgment(workId, GENRE_SAVE_LINE);
    });
    return null;
  } catch (error) {
    const kind = failureKind(error);
    if (kind === "book") {
      deps.repo.recordGenreRejection({ workId, ...strikeReason(error), at: at() });
      return null;
    }
    if (kind === "budget") return nextUtcMidnight(deps.now());
    if (kind === "outage") return deps.now() + OUTAGE_PAUSE_MS;
    if (kind === "key") {
      deps.alert("TypeSafe rejected the genre requests", "TypeSafe answered 401, so genre judgments are paused for a day. Check TYPESAFE_API_KEY.");
      return deps.now() + KEY_PAUSE_MS;
    }
    throw error;
  }
}

function heldCanonical(deps: HeldDeps): Set<string> {
  return new Set(deps.repo.canonicalWorkIds(deps.heldWorkIds()).values());
}

export async function judgeWork(deps: HeldDeps, workId: string): Promise<number | null> {
  const canonical = deps.repo.canonicalWorkIds([workId]).get(workId);
  if (!canonical || !heldCanonical(deps).has(canonical)) return null;
  if (deps.repo.worksNeedingGenreJudgment([canonical], 1, GENRE_REJECTION_LIMIT).length === 0) return null;
  return classifyWork(deps, canonical);
}

export function startGenreJobs(deps: HeldDeps & { onError: (error: unknown, workId?: string) => void }): GenreJobs {
  let quietUntil = 0;
  const alert = (subject: string, text: string) => {
    if (deps.now() < quietUntil) return;
    quietUntil = deps.now() + KEY_PAUSE_MS;
    deps.alert(subject, text);
  };
  const judged = { ...deps, alert };
  const queue = createWorkQueue({ concurrency: GENRE_IN_FLIGHT, now: deps.now, run: (workId) => judgeWork(judged, workId), onError: deps.onError });
  const stopSweep = startDetailsBackfill(
    async () => {
      deps.repo.applyGenreJudgments(GENRE_SAVE_LINE);
      const held = [...heldCanonical(deps)];
      for (const workId of deps.repo.worksNeedingGenreJudgment(held, GENRE_SWEEP_LIMIT, GENRE_REJECTION_LIMIT)) queue.add(workId);
      return null;
    },
    (error) => deps.onError(error),
    GENRE_SWEEP_INTERVAL_MS
  );
  return {
    add: (workId) => queue.add(workId),
    stop: () => {
      stopSweep();
      queue.stop();
    }
  };
}

export function startGenreJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startGenreJobs>[0], "classify">): GenreJobs | null {
  if (apiKey === "") return null;
  return startGenreJobs({ ...deps, classify: createJevGenreClassifier(apiKey, dailySpend(deps.repo, GENRE_SOURCE, GENRE_DAILY_BUDGET, deps.now)) });
}
```

2. **Service hook.** `booksService.ts`:
   - Add `onDetailsChecked?: (book: BookRow) => void;` to `BooksServiceDeps`, after `warn`.
   - In `getDetails`, right after `const latest = deps.repo.getBook(book.id) ?? book;`, add `deps.onDetailsChecked?.(latest);`.
   - In `backfillDetails`, right after `await lookupDetails(book, deps.backgroundCatalog);` inside the `try`, add:

```ts
          const latest = deps.repo.getBook(id);
          if (latest) deps.onDetailsChecked?.(latest);
```

3. **Plugin.** `plugin.ts`:
   - Imports:
     - `env, isbndbConfigured, typesafeConfigured` becomes `env, isbndbConfigured`.
     - Remove the `createJevGenreClassifier` and `dailySpend` imports.
     - The genre import becomes `import { startGenreJobsIfConfigured } from "./genreJudgments.js";`.
     - Add `import type { HeldWork } from "./genrePass.js";`.
   - `BooksPluginOptions` becomes:

```ts
export interface BooksPluginOptions {
  alert?: (subject: string, text: string) => Promise<void>;
  heldWorks?: () => HeldWork[];
}
```

   - Right after the `const repo = ...` line, add:

```ts
  const heldWorks = options.heldWorks;
  const genreJobs = heldWorks
    ? startGenreJobsIfConfigured(env.TYPESAFE_API_KEY, {
        repo,
        heldWorkIds: () => heldWorks().map((work) => work.workId),
        now: Date.now,
        alert: (subject, text) => {
          app.log.warn({ subject }, text);
          options.alert?.(subject, text).catch((error: unknown) => app.log.error({ err: error }, "TypeSafe key alert failed"));
        },
        onError: (error, workId) => app.log.error({ err: error, workId }, "genre judgment failed")
      })
    : null;
```

   - In the `createBooksService({...})` deps, add `onDetailsChecked: (book) => { if (book.work_id) genreJobs?.add(book.work_id); },`.
   - Delete the old genre block: the `heldWorkIds`, `classify` and `stopGenreJudgments` constants.
   - In `onClose`, replace `stopGenreJudgments();` with `genreJobs?.stop();`.

4. **App.** `app.ts`: in the `registerBooksModule` options, replace `heldWorkIds: () => heldWorks().map((work) => work.workId),` with `heldWorks,`. Then run `rg -n "heldWorkIds" backend/src`. The only hits left should be inside `genreJudgments.ts`, `genreJudgments.test.ts` and `plugin.ts`.

5. **README.** `backend/README.md`, `books` section: replace the "**Genre judgments (Jev):**" bullet with:

   > **Genre judgments (Jev):**
   > - When a details lookup, from a request or the details backfill, leaves a held work with no genres, its work joins an in-memory queue, 4 requests at a time. The request that triggered it never waits.
   > - A sweep at boot and every 24 hours re-queues held works with no genres, a finished lookup, no judgment and fewer than 3 strikes, and re-applies every judgment at 0.5.
   > - Every answer is stored in `genre_judgments`. Answers at 0.5 or above are written as `genres_source = 'jev'`; below 0.8 they show as possible genres.
   > - Requests count against the `genres` source in `typesafe_usage`, 1,000 per UTC day.
   > - A failure that belongs to the book (a 4xx other than 401/429, or an answer the adapter can't use) adds a strike in `genre_rejections`. At 3 strikes the book isn't asked again.
   > - An outage pauses the queue for 10 minutes, a spent budget until UTC midnight, and a 401 for a day with one alert.
   > - Delete a judgment to ask again.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS, including `booksWiring.test.ts`, which boots the whole app without `TYPESAFE_API_KEY`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books backend/src/app.ts backend/README.md && git commit -m "$(cat <<'EOF'
Ask Jev when a held book's details lookup finds no genres

The 10-minute timer re-ran the whole selection whether or not anything
new had arrived. A finished details lookup now queues the book's work,
and a daily sweep catches what a restart or an outage lost. Only works a
library holds are asked; a book failure is a strike that doesn't stop
the queue, an outage pauses ten minutes, a spent budget pauses until UTC
midnight, and a rejected key alerts once and pauses a day.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 6: One label function for the import and the page

**Files:**
- Modify: `backend/src/modules/books/genrePass.ts`
- Modify: `backend/src/modules/books/genrePass.test.ts`

**Interfaces:**
- Produces:
  - `GENRE_LABEL_MAX = 3`
  - `labelProblem(genres: unknown[]): string | null`. It returns a sentence fragment such as `"has unknown genres: Novel"`, `"repeats a genre"` or `"has more than 3 genres"`, or `null`.
  - `labelWork(books: BooksRepository, workId: string, genres: string[], at: string): number`. It returns the editions changed. An empty `genres` stores the manual "none" judgment and returns 0.
- The export (`genrePassWorksWith`) skips works the owner labelled "no genre" (a `manual` judgment).

- [ ] **Step 1: Write the failing tests**

Append to `genrePass.test.ts`, and add `labelProblem` and `labelWork` to the `./genrePass.js` import:

```ts
test("a label is up to three distinct known genres", () => {
  assert.equal(labelProblem(["History", "Poetry", "Classics"]), null);
  assert.equal(labelProblem([]), null);
  assert.equal(labelProblem(["Novel"]), "has unknown genres: Novel");
  assert.equal(labelProblem(["History", "History"]), "repeats a genre");
  assert.equal(labelProblem(["History", "Poetry", "Classics", "Religion"]), "has more than 3 genres");
});

test("an import rejects a repeated genre or a fourth one without writing", () => {
  const { db, repo, blank } = seeded();
  assert.throws(() => importGenreLabelsWith(repo, [{ workId: blank, genres: ["Poetry", "Poetry"] }]), GenreLabelsError);
  assert.throws(() => importGenreLabelsWith(repo, [{ workId: blank, genres: ["Poetry", "History", "Classics", "Religion"] }]), GenreLabelsError);
  assert.equal(row(db, blank).genres, "[]");
});

test("labelling writes manual genres, and an empty label records the owner's no-genre", () => {
  const { db, repo, blank, other } = seeded();
  assert.equal(labelWork(repo, blank, ["Poetry"], "2026-10-15T00:00:00.000Z"), 1);
  assert.deepEqual(row(db, blank), { genres: JSON.stringify(["Poetry"]), genres_source: "manual", genres_confidence: null });
  assert.equal(labelWork(repo, other, [], "2026-10-15T00:00:00.000Z"), 0);
  assert.deepEqual(repo.genreJudgments([other]).get(other), { model: "manual", genre: null, confidence: 1 });
});

test("the export leaves out works the owner labelled no genre", () => {
  const { repo, blank, other } = seeded();
  labelWork(repo, other, [], "2026-10-15T00:00:00.000Z");
  const rows = genrePassWorksWith(repo, [{ workId: blank, holders: 1, finished: false }, { workId: other, holders: 1, finished: false }]);
  assert.deepEqual(rows.map((entry) => entry.workId), [blank]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `labelProblem` and `labelWork` don't exist.

- [ ] **Step 3: Implement**

In `genrePass.ts`:
- After `const KNOWN_GENRES = …`, add:

```ts
export const GENRE_LABEL_MAX = 3;

export function labelProblem(genres: unknown[]): string | null {
  const unknown = genres.filter((genre) => typeof genre !== "string" || !KNOWN_GENRES.has(genre));
  if (unknown.length > 0) return `has unknown genres: ${unknown.join(", ")}`;
  if (new Set(genres).size !== genres.length) return "repeats a genre";
  if (genres.length > GENRE_LABEL_MAX) return `has more than ${GENRE_LABEL_MAX} genres`;
  return null;
}

export function labelWork(books: BooksRepository, workId: string, genres: string[], at: string): number {
  if (genres.length === 0) {
    books.saveGenreJudgment({ workId, model: "manual", genre: null, confidence: 1, askedAt: at });
    return 0;
  }
  return books.setManualGenres(workId, genres);
}
```

- In `labelsOf`, replace the two lines that compute `unknown` and push its problem with:

```ts
    const problem = labelProblem(genres);
    if (problem) problems.push(`Label ${index} (${workId}) ${problem}`);
```

- In `importGenreLabelsWith`, replace the two lines inside the loop (the `saveGenreJudgment` line and the `changed` line) with:

```ts
      const changed = labelWork(books, workId, label.genres, new Date().toISOString());
```

- In `genrePassWorksWith`, replace the `flatMap` callback's first two lines with:

```ts
      const judgment = judgments.get(workId);
      if (judgment?.model === "manual") return [];
      const evidence = (genres.get(workId)?.genres.length ?? 0) > 0 ? undefined : books.genreEvidence(workId);
      if (!evidence) return [];
```

  and its `jev:` field (from Task 3) with `jev: judgment ? { genre: judgment.genre, confidence: judgment.confidence } : null`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS. The existing import tests still pass, including "rejects unknown genres, unknown works and bad files without writing" and the repeat-as-no-op test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/genrePass.ts backend/src/modules/books/genrePass.test.ts && git commit -m "$(cat <<'EOF'
Share label validation and writing between the genre import and the page

labelWork is the one path that writes the owner's genres or records
their "no genre", and labelProblem the one set of rules (known, distinct,
at most three), so the CLI import and the review page can't drift; the
import now also rejects repeated genres and a fourth genre. The export
skips works the owner already labelled "no genre", which it used to list
again on every pass.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 7: The review list and its admin routes

**Files:**
- Create: `packages/shared/src/works/genreReview.ts`
- Create: `packages/shared/src/works/genreReview.test.ts`
- Modify: `packages/shared/src/works/index.ts`. Add `export * from "./genreReview.js";`.
- Modify: `backend/src/modules/books/domain/ports.ts` and `adapters/sqlite/sqliteBooksRepository.ts`. Add `workCoverImageIds`.
- Create: `backend/src/modules/books/genreReview.ts`
- Create: `backend/src/modules/books/genreReview.test.ts`. Add `src/modules/books/genreReview.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/genrePass.test.ts`.
- Modify: `backend/src/modules/books/routes.ts`. Add `buildGenreReviewRoutes`.
- Modify: `backend/src/modules/books/routes.test.ts`
- Modify: `backend/src/modules/books/plugin.ts`. Register the routes in their own rate-limit scope.
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `labelWork`, `labelProblem`, `genrePassWorksWith`, `HeldWork` (Task 6). `GENRE_REJECTION_LIMIT`, `GENRE_SAVE_LINE`, and the jobs' `add` (Task 5). `coverUrlFor(imageId, "thumb")` from `publicCoverLookup.ts`.
- Produces, shared:
  - `GenreReviewGroup`, `GENRE_REVIEW_GROUPS`, `GENRE_REVIEW_HEADINGS`
  - `GenreReviewEvidence`, `GenreReviewItem`, `GenreReview`, `GenreReviewAction`
  - `genreEvidenceLabel(evidence): string`
  - `withoutWork(review, workId): GenreReview`
- Produces, backend:
  - repo `workCoverImageIds(workIds: string[]): Map<string, string>`
  - `GENRE_REVIEW_LIMIT = 200`
  - `genreReviewWith(books, held: HeldWork[], coverUrl: (imageId: string) => string): GenreReview`
  - `reviewGenreWith(books, workId: string, action: GenreReviewAction, now: () => number, requeue: (workId: string) => void): { workId: string; editions: number }`
  - `buildGenreReviewRoutes(deps: { isAdmin: (userId: string) => boolean; review: () => GenreReview; decide: (workId: string, action: GenreReviewAction) => { workId: string; editions: number } })`
- Routes:
  - `GET /books/genre-review` returns `{ items, total }`.
  - `POST /books/genre-review/:workId` takes `{ genres: string[] }` or `{ retry: true }`. It returns 200 `{ workId, editions }`, or 400, 403 or 404.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/works/genreReview.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { genreEvidenceLabel, withoutWork } from "./genreReview.js";

test("each group's evidence reads as the review page shows it", () => {
  assert.equal(genreEvidenceLabel({ group: "rejected", status: 400, reason: "HTTP 400", attempts: 3, lastAt: "2026-10-15T00:00:00.000Z" }), "Rejected 3× · HTTP 400");
  assert.equal(genreEvidenceLabel({ group: "rejected", status: null, reason: "unexpected answer", attempts: 3, lastAt: "2026-10-15T00:00:00.000Z" }), "Rejected 3× · unexpected answer");
  assert.equal(genreEvidenceLabel({ group: "none", confidence: 0.91 }), "Jev: none (0.91)");
  assert.equal(genreEvidenceLabel({ group: "unsure", genre: "Poetry", confidence: 0.34 }), "Jev: Poetry? (0.34)");
  assert.equal(genreEvidenceLabel({ group: "possible", genre: "History", confidence: 0.62 }), "Possibly History (0.62)");
});

test("a resolved work leaves the review and the total", () => {
  const item = (workId: string) => ({ workId, title: workId, author: "A", coverUrl: null, synopsis: null, holders: 1, finished: false, evidence: { group: "none" as const, confidence: 0.9 } });
  const review = { items: [item("a"), item("b")], total: 7 };
  assert.deepEqual(withoutWork(review, "a"), { items: [item("b")], total: 6 });
  assert.equal(withoutWork(review, "missing"), review);
});
```

`backend/src/modules/books/genreReview.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-genre-review-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { BookNotFoundError } = await import("./domain/errors.js");
const { classifyWork } = await import("./genreJudgments.js");
const { GENRE_REVIEW_LIMIT, genreReviewWith, reviewGenreWith } = await import("./genreReview.js");

const AT = "2026-10-15T00:00:00.000Z";
const NOW = () => Date.parse(AT);
const cover = (imageId: string) => `https://images.test/${imageId}`;

function seeded(titles: string[]) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const books = titles.map((title) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], AT));
  const work = (title: string) => books[titles.indexOf(title)]!.work_id!;
  const held = (...names: string[]) => names.map((name) => ({ workId: work(name), holders: 1, finished: false }));
  const jev = (title: string, genre: string | null, confidence: number) => {
    repo.saveGenreJudgment({ workId: work(title), model: "jev-1.13.0", genre, confidence, askedAt: AT });
    repo.applyGenreJudgment(work(title), 0.5);
  };
  return { db, repo, work, held, jev };
}

test("the review lists rejected, none, unsure and possible works with their evidence", () => {
  const s = seeded(["Rejected", "Twice", "None", "Unsure", "Possible", "Confident", "Owner", "Sourced"]);
  for (let strike = 0; strike < 3; strike++) s.repo.recordGenreRejection({ workId: s.work("Rejected"), status: 400, reason: "HTTP 400", at: AT });
  for (let strike = 0; strike < 2; strike++) s.repo.recordGenreRejection({ workId: s.work("Twice"), status: 400, reason: "HTTP 400", at: AT });
  s.jev("None", null, 0.91);
  s.jev("Unsure", "Poetry", 0.34);
  s.jev("Possible", "History", 0.62);
  s.jev("Confident", "History", 0.9);
  s.repo.saveGenreJudgment({ workId: s.work("Owner"), model: "manual", genre: null, confidence: 1, askedAt: AT });
  s.db.prepare("UPDATE books SET genres = ? WHERE work_id = ?").run(JSON.stringify(["Fantasy"]), s.work("Sourced"));
  const review = genreReviewWith(s.repo, s.held("Rejected", "Twice", "None", "Unsure", "Possible", "Confident", "Owner", "Sourced"), cover);
  assert.equal(review.total, 4);
  assert.deepEqual(review.items.map((item) => [item.title, item.evidence]), [
    ["None", { group: "none", confidence: 0.91 }],
    ["Possible", { group: "possible", genre: "History", confidence: 0.62 }],
    ["Rejected", { group: "rejected", status: 400, reason: "HTTP 400", attempts: 3, lastAt: AT }],
    ["Unsure", { group: "unsure", genre: "Poetry", confidence: 0.34 }]
  ]);
});

test("items carry the cover, a 300-character synopsis and the holders, and no user ids", () => {
  const s = seeded(["Long"]);
  s.db.prepare("UPDATE books SET summary = ? WHERE work_id = ?").run("x".repeat(500), s.work("Long"));
  s.jev("Long", null, 0.8);
  s.db.prepare("INSERT INTO cover_images (id, book_id, source, source_url, width, height, byte_size, created_at) SELECT 'img1', id, 'apple', NULL, 600, 900, 1, ? FROM books WHERE work_id = ?").run(AT, s.work("Long"));
  s.db.prepare("UPDATE books SET cover_image_id = 'img1' WHERE work_id = ?").run(s.work("Long"));
  const [item] = genreReviewWith(s.repo, [{ workId: s.work("Long"), holders: 2, finished: true }], cover).items;
  assert.deepEqual(Object.keys(item!).sort(), ["author", "coverUrl", "evidence", "finished", "holders", "synopsis", "title", "workId"]);
  assert.equal(item!.coverUrl, "https://images.test/img1");
  assert.equal(item!.synopsis, "x".repeat(300));
  assert.deepEqual([item!.holders, item!.finished], [2, true]);
});

test("finished works come first, then the most held, then by title; the list stops at 200 with the full total", () => {
  const titles = Array.from({ length: GENRE_REVIEW_LIMIT + 1 }, (_, index) => `T${String(index).padStart(3, "0")}`);
  const s = seeded(titles);
  for (const title of titles) s.jev(title, null, 0.9);
  const held = titles.map((title, index) => ({ workId: s.work(title), holders: index === 5 ? 3 : 1, finished: index === 9 }));
  const review = genreReviewWith(s.repo, held, cover);
  assert.equal(review.total, GENRE_REVIEW_LIMIT + 1);
  assert.equal(review.items.length, GENRE_REVIEW_LIMIT);
  assert.deepEqual(review.items.slice(0, 3).map((item) => item.title), ["T009", "T005", "T000"]);
});

test("a held alias is listed as its canonical work", () => {
  const s = seeded(["Kept", "Merged"]);
  s.repo.mergeWorks(s.work("Merged"), s.work("Kept"));
  s.jev("Kept", null, 0.9);
  assert.deepEqual(genreReviewWith(s.repo, [{ workId: s.work("Merged"), holders: 1, finished: false }], cover).items.map((item) => item.workId), [s.work("Kept")]);
});

test("setting genres labels the work; no genre records the owner's choice; repeats change nothing", () => {
  const s = seeded(["Labelled", "Nothing"]);
  s.jev("Labelled", "Poetry", 0.3);
  assert.deepEqual(reviewGenreWith(s.repo, s.work("Labelled"), { genres: ["History"] }, NOW, () => {}), { workId: s.work("Labelled"), editions: 1 });
  assert.deepEqual(reviewGenreWith(s.repo, s.work("Labelled"), { genres: ["History"] }, NOW, () => {}), { workId: s.work("Labelled"), editions: 0 });
  assert.deepEqual(reviewGenreWith(s.repo, s.work("Nothing"), { genres: [] }, NOW, () => {}), { workId: s.work("Nothing"), editions: 0 });
  assert.equal(s.repo.genreJudgments([s.work("Nothing")]).get(s.work("Nothing"))?.model, "manual");
  assert.equal(genreReviewWith(s.repo, s.held("Labelled", "Nothing"), cover).total, 0);
});

test("retry clears the strikes and Jev's answer, keeps the owner's, and queues the canonical work", () => {
  const s = seeded(["Struck", "Merged", "Owner"]);
  s.repo.mergeWorks(s.work("Merged"), s.work("Struck"));
  for (let strike = 0; strike < 3; strike++) s.repo.recordGenreRejection({ workId: s.work("Struck"), status: 400, reason: "HTTP 400", at: AT });
  s.repo.saveGenreJudgment({ workId: s.work("Owner"), model: "manual", genre: null, confidence: 1, askedAt: AT });
  const queued: string[] = [];
  assert.deepEqual(reviewGenreWith(s.repo, s.work("Merged"), { retry: true }, NOW, (id) => queued.push(id)), { workId: s.work("Struck"), editions: 0 });
  reviewGenreWith(s.repo, s.work("Owner"), { retry: true }, NOW, (id) => queued.push(id));
  assert.deepEqual(queued, [s.work("Struck"), s.work("Owner")]);
  assert.equal(s.repo.genreRejections([s.work("Struck")]).size, 0);
  assert.equal(s.repo.genreJudgments([s.work("Owner")]).get(s.work("Owner"))?.model, "manual");
});

test("retry on a work showing Jev's possible genres replaces them with the new answer", async () => {
  const s = seeded(["Possible"]);
  s.jev("Possible", "Biography & Memoir", 0.6);
  reviewGenreWith(s.repo, s.work("Possible"), { retry: true }, NOW, () => {});
  await classifyWork({ repo: s.repo, classify: async () => ({ genre: "History", confidence: 0.9, model: "jev-1.13.0" }), now: NOW, alert: () => {} }, s.work("Possible"));
  assert.equal((s.db.prepare("SELECT genres FROM books WHERE work_id = ?").get(s.work("Possible")) as { genres: string }).genres, JSON.stringify(["History"]));
});

test("an unknown work is not found", () => {
  const s = seeded([]);
  assert.throws(() => reviewGenreWith(s.repo, "missing", { genres: ["History"] }, NOW, () => {}), BookNotFoundError);
});
```

Append to `routes.test.ts`. Add `buildGenreReviewRoutes` to the `./routes.js` import, and `BookNotFoundError` to the `./domain/errors.js` import:

```ts
async function callReview(options: InjectOptions, signedInAs?: string, decided: Array<[string, unknown]> = []) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null));
  await app.register(buildGenreReviewRoutes({
    isAdmin: (userId) => userId === "admin",
    review: () => ({ items: [], total: 0 }),
    decide: (workId, action) => {
      if (workId === "missing") throw new BookNotFoundError();
      decided.push([workId, action]);
      return { workId, editions: 1 };
    }
  }));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return res;
}

test("only the signed-in admin may list or decide genre reviews", async () => {
  assert.equal((await callReview({ method: "GET", url: "/books/genre-review" })).statusCode, 401);
  assert.equal((await callReview({ method: "GET", url: "/books/genre-review" }, "u1")).statusCode, 403);
  assert.equal((await callReview({ method: "POST", url: "/books/genre-review/w1", payload: { genres: ["History"] } }, "u1")).statusCode, 403);
  assert.deepEqual((await callReview({ method: "GET", url: "/books/genre-review" }, "admin")).json(), { items: [], total: 0 });
});

test("a genre review decision is validated before it is applied", async () => {
  const decided: Array<[string, unknown]> = [];
  const post = (payload: unknown, workId = "w1") => callReview({ method: "POST", url: `/books/genre-review/${workId}`, payload: payload as object }, "admin", decided);
  assert.equal((await post({ genres: ["History", "Poetry"] })).statusCode, 200);
  assert.equal((await post({ genres: [] })).statusCode, 200);
  assert.equal((await post({ retry: true })).statusCode, 200);
  for (const bad of [{ genres: ["Novel"] }, { genres: ["History", "History"] }, { genres: ["History", "Poetry", "Classics", "Religion"] }, { retry: false }, { genres: ["History"], retry: true }, {}]) {
    assert.equal((await post(bad)).statusCode, 400, JSON.stringify(bad));
  }
  assert.equal((await post({ genres: ["History"] }, "missing")).statusCode, 404);
  assert.deepEqual(decided, [["w1", { genres: ["History", "Poetry"] }], ["w1", { genres: [] }], ["w1", { retry: true }]]);
});
```

The cover test inserts a `cover_images` row directly. If that table has NOT NULL columns beyond the ones listed (check `books.sql`), fill them the way `insertImage` in `sqliteBooksRepository.ts` does. Don't drop the cover assertion.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace @scripta/shared && npm run typecheck --workspace backend`
Expected: FAIL. `./genreReview.js` (shared and backend), `workCoverImageIds` and `buildGenreReviewRoutes` don't exist.

- [ ] **Step 3: Implement**

1. **Shared.** `packages/shared/src/works/genreReview.ts`:

```ts
export type GenreReviewGroup = "rejected" | "none" | "unsure" | "possible";

export const GENRE_REVIEW_GROUPS: GenreReviewGroup[] = ["rejected", "none", "unsure", "possible"];

export const GENRE_REVIEW_HEADINGS: Record<GenreReviewGroup, string> = {
  rejected: "Rejected by TypeSafe",
  none: "Jev found no genre",
  unsure: "Jev was unsure",
  possible: "Possible genres"
};

export type GenreReviewEvidence =
  | { group: "rejected"; status: number | null; reason: string; attempts: number; lastAt: string }
  | { group: "none"; confidence: number }
  | { group: "unsure" | "possible"; genre: string; confidence: number };

export type GenreReviewItem = {
  workId: string;
  title: string;
  author: string;
  coverUrl: string | null;
  synopsis: string | null;
  holders: number;
  finished: boolean;
  evidence: GenreReviewEvidence;
};

export type GenreReview = { items: GenreReviewItem[]; total: number };

export type GenreReviewAction = { genres: string[] } | { retry: true };

export function genreEvidenceLabel(evidence: GenreReviewEvidence): string {
  const score = (confidence: number) => confidence.toFixed(2);
  if (evidence.group === "rejected") return `Rejected ${evidence.attempts}× · ${evidence.reason}`;
  if (evidence.group === "none") return `Jev: none (${score(evidence.confidence)})`;
  if (evidence.group === "unsure") return `Jev: ${evidence.genre}? (${score(evidence.confidence)})`;
  return `Possibly ${evidence.genre} (${score(evidence.confidence)})`;
}

export function withoutWork(review: GenreReview, workId: string): GenreReview {
  const items = review.items.filter((item) => item.workId !== workId);
  return items.length === review.items.length ? review : { items, total: review.total - 1 };
}
```

   Add `export * from "./genreReview.js";` to `packages/shared/src/works/index.ts`. Run `npm run build --workspace @scripta/shared`.

2. **Repo covers.**
   - `domain/ports.ts`, after `genreRejections(...)`: `workCoverImageIds(workIds: string[]): Map<string, string>;`.
   - `sqliteBooksRepository.ts`, after `rejectionsStmt`:

```ts
  const workCoversStmt = db.prepare(`SELECT work_id, cover_image_id FROM books WHERE work_id IN (SELECT value FROM json_each(?)) AND cover_image_id IS NOT NULL ORDER BY created_at, rowid`);
```

   - The method, after `genreRejections`:

```ts
    workCoverImageIds(workIds) {
      const covers = new Map<string, string>();
      for (const row of workCoversStmt.all(JSON.stringify(workIds)) as Array<{ work_id: string; cover_image_id: string }>) {
        if (!covers.has(row.work_id)) covers.set(row.work_id, row.cover_image_id);
      }
      return covers;
    },
```

3. **Backend module.** `backend/src/modules/books/genreReview.ts`:

```ts
import type { GenreReview, GenreReviewAction, GenreReviewEvidence } from "@scripta/shared";
import { BookNotFoundError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { GENRE_REJECTION_LIMIT, GENRE_SAVE_LINE } from "./genreJudgments.js";
import { genrePassWorksWith, labelWork, type HeldWork } from "./genrePass.js";
import { catalogGenresWith } from "./works.js";

export const GENRE_REVIEW_LIMIT = 200;
const EXCERPT_LIMIT = 300;

type Rejection = { status: number | null; reason: string; attempts: number; lastAt: string };
type Judgment = { model: string; genre: string | null; confidence: number };

function evidenceOf(rejection: Rejection | undefined, judgment: Judgment | undefined, possibleOnly: boolean): GenreReviewEvidence | null {
  if (rejection && rejection.attempts >= GENRE_REJECTION_LIMIT) return { group: "rejected", ...rejection };
  if (!judgment || judgment.model === "manual") return null;
  if (judgment.genre === null) return { group: "none", confidence: judgment.confidence };
  if (judgment.confidence < GENRE_SAVE_LINE) return { group: "unsure", genre: judgment.genre, confidence: judgment.confidence };
  return possibleOnly ? { group: "possible", genre: judgment.genre, confidence: judgment.confidence } : null;
}

export function genreReviewWith(books: BooksRepository, held: HeldWork[], coverUrl: (imageId: string) => string): GenreReview {
  const works = genrePassWorksWith(books, held);
  const ids = works.map((work) => work.workId);
  const rejections = books.genreRejections(ids);
  const judgments = books.genreJudgments(ids);
  const genres = catalogGenresWith(books, ids);
  const covers = books.workCoverImageIds(ids);
  const listed = works.flatMap((work) => {
    const evidence = evidenceOf(rejections.get(work.workId), judgments.get(work.workId), (genres.get(work.workId)?.possibleGenres.length ?? 0) > 0);
    if (!evidence) return [];
    const cover = covers.get(work.workId);
    return [{ workId: work.workId, title: work.title, author: work.author, coverUrl: cover ? coverUrl(cover) : null, synopsis: work.synopsis?.slice(0, EXCERPT_LIMIT) ?? null, holders: work.holders, finished: work.finished, evidence }];
  });
  return { items: listed.slice(0, GENRE_REVIEW_LIMIT), total: listed.length };
}

export function reviewGenreWith(books: BooksRepository, workId: string, action: GenreReviewAction, now: () => number, requeue: (workId: string) => void): { workId: string; editions: number } {
  const canonical = books.canonicalWorkIds([workId]).get(workId);
  if (!canonical) throw new BookNotFoundError();
  if ("retry" in action) {
    books.transaction(() => {
      books.clearGenreRejection(canonical);
      books.deleteGenreJudgment(canonical);
    });
    requeue(canonical);
    return { workId: canonical, editions: 0 };
  }
  const editions = books.transaction(() => labelWork(books, canonical, action.genres, new Date(now()).toISOString()));
  return { workId: canonical, editions };
}
```

4. **Routes.** `routes.ts`:
   - Imports: add `import type { GenreReview, GenreReviewAction } from "@scripta/shared";` and `import { labelProblem } from "./genrePass.js";`.
   - After `detachSchema`, add:

```ts
const GENRES_FORBIDDEN = { error: "Only the admin can review genres." };
const reviewParamsSchema = z.object({ workId: z.string().min(1).max(64) });
const reviewActionSchema = z.union([z.object({ genres: z.array(z.string().max(64)).max(10) }).strict(), z.object({ retry: z.literal(true) }).strict()]);
```

   - After `buildAdminRoutes`, add:

```ts
export function buildGenreReviewRoutes(deps: {
  isAdmin: (userId: string) => boolean;
  review: () => GenreReview;
  decide: (workId: string, action: GenreReviewAction) => { workId: string; editions: number };
}) {
  return async function genreReviewRoutes(app: FastifyInstance) {
    app.get("/books/genre-review", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(GENRES_FORBIDDEN);
      return reply.send(deps.review());
    });

    app.post("/books/genre-review/:workId", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(GENRES_FORBIDDEN);
      const params = reviewParamsSchema.safeParse(request.params);
      const body = reviewActionSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "Send { genres: [...] } with up to three genres, or { retry: true }." });
      const problem = "genres" in body.data ? labelProblem(body.data.genres) : null;
      if (problem) return reply.code(400).send({ error: `This label ${problem}.` });
      try {
        return reply.send(deps.decide(params.data.workId, body.data));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send({ error: "No such work." });
        throw error;
      }
    });
  };
}
```

5. **Plugin.** `plugin.ts`:
   - Imports: add `import { genreReviewWith, reviewGenreWith } from "./genreReview.js";` and add `buildGenreReviewRoutes` to the `./routes.js` import.
   - After the admin-routes `app.register(...)` block, add:

```ts
  if (heldWorks) {
    await app.register(async (scoped) => {
      await scoped.register(fastifyRateLimit, { max: 300, timeWindow: "1 minute" });
      await scoped.register(buildGenreReviewRoutes({
        isAdmin: (userId) => service.isAdmin(userId),
        review: () => genreReviewWith(repo, heldWorks(), (imageId) => coverUrlFor(imageId, "thumb")),
        decide: (workId, action) => reviewGenreWith(repo, workId, action, Date.now, (id) => genreJobs?.add(id))
      }));
    });
  }
```

6. **README.** `backend/README.md`, `books` section, after the genre judgments bullet:

   > **Genre review (admin):**
   > - `GET /books/genre-review` lists up to 200 held works for the admin (`ADMIN_USER_ID`), with the full `total`, in four groups: rejected (3 strikes), Jev found none, Jev below 0.5, and only possible genres.
   > - Finished works come first, then the most held.
   > - `POST /books/genre-review/:workId` takes `{ genres }` (1–3 genres written as manual labels), `{ genres: [] }` (the owner's "no genre"), or `{ retry: true }` (clears strikes and Jev's answer, then re-queues the work).
   > - Both routes answer 403 to anyone else, and are rate-limited at 300 a minute.
   > - The web page is `/admin/genres`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/works backend/src/modules/books backend/package.json backend/README.md && git commit -m "$(cat <<'EOF'
Add the admin genre review list and its decisions

The books Jev rejected three times, answered "none", answered below 0.5,
or left only possible genres are listed for the admin, finished and
most-held first, capped at 200 with the full total. A decision labels
the work through the same function as the genre-pass import, records the
owner's "no genre", or clears the strikes and Jev's answer and re-queues
the work. The routes get their own rate limit so labelling a list isn't
throttled at the cover routes' 30 a minute.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 8: The `/admin/genres` web page

**Files:**
- Modify: `frontend/src/api/books.ts`. Add `fetchGenreReview` and `reviewGenre`.
- Create: `frontend/src/components/AdminLinks.tsx`
- Create: `frontend/src/components/GenreReviewList.tsx`
- Create: `frontend/src/pages/AdminGenresPage.tsx`
- Modify: `frontend/src/App.tsx`. Add the route inside the `DashboardLayout` routes.
- Modify: `frontend/src/layouts/DashboardLayout.tsx`. Add the admin link in both footers.
- Create: `frontend/scripts/test-admin-genres.mts`

**Interfaces:**
- Consumes: the shared `GenreReview`, `GenreReviewItem`, `GenreReviewAction`, `GENRE_REVIEW_GROUPS`, `GENRE_REVIEW_HEADINGS`, `genreEvidenceLabel`, `withoutWork` and `BOOK_GENRES`; `fetchIsAdmin`.
- Produces:
  - `fetchGenreReview(): Promise<GenreReview>`
  - `reviewGenre(workId: string, action: GenreReviewAction): Promise<{ workId: string; editions: number }>`
  - `<AdminLinks isAdmin onNavigate? />`
  - `<GenreReviewList review onDecide />`, where `onDecide(workId, action): Promise<void>` rejects with an `Error` whose message is shown on the row.

- [ ] **Step 1: Write the failing test**

`frontend/scripts/test-admin-genres.mts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { GenreReview } from "@scripta/shared";
import { AdminLinks } from "../src/components/AdminLinks";
import { GenreReviewList } from "../src/components/GenreReviewList";

const item = (workId: string, evidence: GenreReview["items"][number]["evidence"]) => ({ workId, title: `Title ${workId}`, author: "Author", coverUrl: null, synopsis: "A synopsis.", holders: 2, finished: true, evidence });
const review: GenreReview = {
  items: [
    item("r", { group: "rejected", status: 400, reason: "HTTP 400", attempts: 3, lastAt: "2026-10-15T00:00:00.000Z" }),
    item("n", { group: "none", confidence: 0.91 }),
    item("u", { group: "unsure", genre: "Poetry", confidence: 0.34 }),
    item("p", { group: "possible", genre: "History", confidence: 0.62 })
  ],
  total: 4
};

const render = () => renderToString(createElement(GenreReviewList, { review, onDecide: async () => {} }));

test("each group shows its heading, count and evidence", () => {
  const html = render();
  for (const text of ["Rejected by TypeSafe (1)", "Jev found no genre (1)", "Jev was unsure (1)", "Possible genres (1)", "Rejected 3× · HTTP 400", "Jev: none (0.91)", "Jev: Poetry? (0.34)", "Possibly History (0.62)"]) {
    assert.ok(html.includes(text), text);
  }
});

test("Retry is offered on rejected rows only, and Jev's guess is preselected", () => {
  const html = render();
  assert.equal(html.split(">Retry<").length - 1, 1);
  assert.equal(html.split(">No genre<").length - 1, 4);
  assert.match(html, /aria-pressed="true"[^>]*>Poetry</);
  assert.match(html, /aria-pressed="true"[^>]*>History</);
});

test("the genre review link shows only for the admin", () => {
  const link = (isAdmin: boolean) => renderToString(createElement(MemoryRouter, null, createElement(AdminLinks, { isAdmin })));
  assert.ok(link(true).includes('href="/admin/genres"'));
  assert.equal(link(false), "");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build --workspace @scripta/shared && npm test --workspace frontend`
Expected: FAIL. `AdminLinks` and `GenreReviewList` don't exist.

- [ ] **Step 3: Implement**

1. **API.** `frontend/src/api/books.ts`: add `import type { GenreReview, GenreReviewAction } from "@scripta/shared";` and append:

```ts
export async function fetchGenreReview(): Promise<GenreReview> {
  return (await apiFetch("/books/genre-review")) as GenreReview;
}

export async function reviewGenre(workId: string, action: GenreReviewAction): Promise<{ workId: string; editions: number }> {
  return (await apiFetch(`/books/genre-review/${encodeURIComponent(workId)}`, { method: "POST", body: JSON.stringify(action) })) as { workId: string; editions: number };
}
```

2. **Admin link.** `frontend/src/components/AdminLinks.tsx`:

```tsx
import { Link } from "react-router-dom";

export function AdminLinks({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  if (!isAdmin) return null;
  return (
    <Link
      to="/admin/genres"
      onClick={onNavigate}
      className="mb-2 block rounded-lg px-3 py-2 text-sm text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
    >
      Genre review
    </Link>
  );
}
```

3. **List.** `frontend/src/components/GenreReviewList.tsx`:

```tsx
import { useState } from "react";
import { BOOK_GENRES, GENRE_REVIEW_GROUPS, GENRE_REVIEW_HEADINGS, genreEvidenceLabel, type GenreReview, type GenreReviewAction, type GenreReviewItem } from "@scripta/shared";

const MAX_GENRES = 3;

function preselected(item: GenreReviewItem): string[] {
  return item.evidence.group === "unsure" || item.evidence.group === "possible" ? [item.evidence.genre] : [];
}

function GenreReviewRow({ item, onDecide }: { item: GenreReviewItem; onDecide: (workId: string, action: GenreReviewAction) => Promise<void> }) {
  const [picked, setPicked] = useState<string[]>(() => preselected(item));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = (action: GenreReviewAction) => {
    setBusy(true);
    setError(null);
    onDecide(item.workId, action).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "That didn't save.");
      setBusy(false);
    });
  };
  const toggle = (genre: string) =>
    setPicked((current) => (current.includes(genre) ? current.filter((value) => value !== genre) : current.length < MAX_GENRES ? [...current, genre] : current));
  return (
    <li className="flex gap-3 border-b border-(--color-border) py-4">
      {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-24 w-16 shrink-0 rounded object-cover" /> : <div className="h-24 w-16 shrink-0 rounded bg-(--color-surface-hover)" />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{item.title}</p>
        <p className="text-sm text-(--color-text-dim)">{item.author}</p>
        <p className="mt-1 text-xs text-(--color-text-dim)">{`${genreEvidenceLabel(item.evidence)} · ${item.holders} ${item.holders === 1 ? "library" : "libraries"}${item.finished ? " · finished" : ""}`}</p>
        {item.synopsis ? <p className="mt-1 line-clamp-3 text-sm">{item.synopsis}</p> : null}
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {BOOK_GENRES.map((genre) => (
            <li key={genre}>
              <button
                type="button"
                aria-pressed={picked.includes(genre)}
                onClick={() => toggle(genre)}
                className={`rounded-full border px-2 text-xs ${picked.includes(genre) ? "border-(--color-accent) text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim)"}`}
              >
                {genre}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy || picked.length === 0} onClick={() => decide({ genres: picked })} className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-semibold text-(--color-on-accent) disabled:opacity-50">
            Save
          </button>
          <button type="button" disabled={busy} onClick={() => decide({ genres: [] })} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm">
            No genre
          </button>
          {item.evidence.group === "rejected" ? (
            <button type="button" disabled={busy} onClick={() => decide({ retry: true })} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm">
              Retry
            </button>
          ) : null}
        </div>
        {error ? <p role="alert" className="mt-1 text-sm text-(--color-danger)">{error}</p> : null}
      </div>
    </li>
  );
}

export function GenreReviewList({ review, onDecide }: { review: GenreReview; onDecide: (workId: string, action: GenreReviewAction) => Promise<void> }) {
  return (
    <div>
      <p className="text-sm text-(--color-text-dim)">{`${review.total} to review${review.total > review.items.length ? `, showing ${review.items.length}` : ""}`}</p>
      {GENRE_REVIEW_GROUPS.map((group) => {
        const items = review.items.filter((item) => item.evidence.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="mt-6">
            <h2 className="text-lg font-bold">{`${GENRE_REVIEW_HEADINGS[group]} (${items.length})`}</h2>
            <ul>
              {items.map((item) => (
                <GenreReviewRow key={item.workId} item={item} onDecide={onDecide} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
```

4. **Page.** `frontend/src/pages/AdminGenresPage.tsx`:

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { withoutWork, type GenreReview, type GenreReviewAction } from "@scripta/shared";
import { fetchGenreReview, fetchIsAdmin, reviewGenre } from "../api/books";
import { GenreReviewList } from "../components/GenreReviewList";
import { NotFoundPage } from "./NotFoundPage";

export function AdminGenresPage() {
  const client = useQueryClient();
  const { data: isAdmin, isPending } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity });
  const review = useQuery({ queryKey: ["genre-review"], queryFn: fetchGenreReview, enabled: isAdmin === true });
  if (isPending) return null;
  if (!isAdmin) return <NotFoundPage />;
  const decide = async (workId: string, action: GenreReviewAction) => {
    await reviewGenre(workId, action);
    client.setQueryData<GenreReview>(["genre-review"], (current) => (current ? withoutWork(current, workId) : current));
  };
  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <h1 className="text-xl font-bold">Genre review</h1>
      {review.data ? <GenreReviewList review={review.data} onDecide={decide} /> : review.isError ? <p role="alert" className="mt-4 text-sm text-(--color-danger)">The review list didn't load.</p> : null}
    </div>
  );
}
```

5. **Route.** `App.tsx`: import `AdminGenresPage` from `./pages/AdminGenresPage`. Inside the `<Route element={<DashboardLayout />}>` block, after the `/dashboard/reader-card` route, add `<Route path="/admin/genres" element={<AdminGenresPage />} />`.

6. **Links.** `DashboardLayout.tsx`:
   - Add `import { useQuery } from "@tanstack/react-query";`, `import { fetchIsAdmin } from "../api/books";` and `import { AdminLinks } from "../components/AdminLinks";`.
   - In the component, after `useAccountAppearanceSync();`, add `const { data: isAdmin = false } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity, enabled: Boolean(session) });`.
   - In the desktop footer, add `<AdminLinks isAdmin={isAdmin} />` right before the Log out `<button>`.
   - In the mobile drawer footer, add `<AdminLinks isAdmin={isAdmin} onNavigate={() => setDrawerOpen(false)} />` right before its Log out `<button>`.

- [ ] **Step 4: Run to verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/books.ts frontend/src/components/AdminLinks.tsx frontend/src/components/GenreReviewList.tsx frontend/src/pages/AdminGenresPage.tsx frontend/src/App.tsx frontend/src/layouts/DashboardLayout.tsx frontend/scripts/test-admin-genres.mts && git commit -m "$(cat <<'EOF'
Add the /admin/genres page for labelling books Jev couldn't

The admin sees the review grouped as rejected, none, unsure and
possible, picks up to three genres (Jev's guess preselected), marks no
genre, or retries a rejected book; a decided row leaves the list and a
failed one keeps its error. The link sits in the account footer and
shows only for the admin; anyone else at the URL gets the not-found
page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

### Wrap-up

- [ ] Run every verify command in Global Constraints. All must pass.
- [ ] Web pass on the dev fixture, with no emulator needed:
  - sign in as the admin account (set `ADMIN_USER_ID` in the worktree's `backend/.env` to the dev account's id);
  - open `/admin/genres`: the page loads, empty or with fixture doubts;
  - a non-admin account gets the not-found page;
  - take a screenshot.
- [ ] Dispatch `branch-reviewer` with this plan and the spec.
- [ ] This branch adds admin-only routes ("who can see what"). Run the `security-review` skill before merge.
- [ ] Ship with the `ship` skill: push, PR, `--auto`.
