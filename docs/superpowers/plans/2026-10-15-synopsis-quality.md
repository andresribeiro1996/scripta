# Synopsis Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catalog summaries that aren't synopses stop reaching readers. A code rule and Jev judge each distinct summary text once, and the doubtful ones go to an admin review page.

**Architecture:**
- **Hashes:** every `books.summary` and `works.summary` carries a `summary_hash`, a SHA-1 of the normalised text. Judgments live in `synopsis_judgments`, keyed by that hash. A text reused on several editions is judged once, and a changed text is judged again.
- **Hiding:** the server hides a summary whose judgment says so wherever it picks one (book details and the work page). Nothing is deleted.
- **New books:** a work queue, fed by the genre review's `onDetailsChecked` hook, plus a daily sweep. Budget source `synopses`.
- **The backlog:** an owner-run script with `--max`. Budget source `synopses-backlog`.
- **Review and calibration:**
  - Doubts land on `/admin/synopses`.
  - Claude calibrates the thresholds through an export script and a score script.

**Tech Stack:** TypeScript, `node:sqlite`, Fastify + zod, React + TanStack Query, `node:test` through tsx.

**Spec:** `docs/superpowers/specs/2026-10-15-synopsis-quality-and-translations-design.md`: part A, plus the synopsis halves of C and D.
- Translation grouping (part B) is the separate plan `2026-10-15-translation-grouping.md`. It builds on this one.
- This plan builds on the genre review plan (`2026-10-15-genre-review.md`) and the catalog genre backfill plan (`2026-10-15-catalog-genre-backfill.md`).

## Before you start

1. **Both genre plans must be merged to `main`.** That means the genre review, plus both phases of the backfill, because `runBudget` comes from backfill Task 6. From the repo root of a fresh worktree off `origin/main`, run:

   ```bash
   rg -n "export class TypesafeBudgetSpentError|export class UnusableAnswerError|export function (dailySpend|runBudget|failureKind|nextUtcMidnight|createWorkQueue|startGenreJobsIfConfigured|buildGenreReviewRoutes|AdminLinks)|onDetailsChecked\?" backend/src frontend/src
   ```

   - Expected: at least one hit for each name.
   - If any name is missing, stop. This plan can't start yet.
   - If a name exists with another signature, use the real one, and say so in that task's commit message.
2. **Install dependencies.** The worktree's lockfile may differ from the main checkout's, so `npm run dev:link-deps` can fall back to a full install. Run `npm install`, then `npm run build --workspace @scripta/shared`.

## Global Constraints

- **Code style:**
  - No comments in code (root `AGENTS.md`). The why goes in the commit message.
  - Minimum code that works. Reuse what the genre plans built (`typesafe.ts`, `workQueue.ts`, `startDetailsBackfill`, `HeldWork`) instead of copying it.
- **Running and adding tests:**
  - Consumers read shared's `dist/`. Run `npm run build --workspace @scripta/shared` before any backend or frontend typecheck or test.
  - A new backend `*.test.ts` file goes into the explicit list in `backend/package.json` `"test"`, or CI never runs it. Frontend `scripts/test-*.mts` files and shared `src/**/*.test.ts` files are globbed.
  - A backend test that imports `connection.js`, `config/env` or anything that reaches them sets the env preamble before `await import(...)`, as `sqliteBooksRepository.test.ts` lines 8-19 do.
- **TypeSafe and privacy:**
  - TypeSafe is never called without `TYPESAFE_API_KEY`. Tests stub `fetch` and never use a real key.
  - The GitHub repo is public. No real reader names or library details in code, tests, fixtures or docs.
- **Constants, verbatim from the spec:**
  - `SYNOPSIS_HIDE_BELOW = 0.3`, `SYNOPSIS_REVIEW_BELOW = 0.5`.
  - The fragment rule: fewer than 40 letters (`\p{L}`), `SYNOPSIS_MIN_LETTERS = 40`.
  - The hash: the SHA-1 hex of the text, trimmed, with every run of whitespace collapsed to one space. Blank text has no hash.
  - The text sent to Jev is cut to 2,500 characters.
  - Budget sources: `synopses` at 1,000 a day (`SYNOPSIS_DAILY_BUDGET`), and `synopses-backlog` limited by the run's `--max`.
  - `JEV_REJECTION_LIMIT = 3`, with 4 requests in flight.
  - Pauses: until the next UTC midnight when the budget is spent; 10 minutes after an outage; 24 hours after a 401.
  - The sweep runs at boot and every 24 hours.
  - The review list holds at most 200 items, with texts cut to 600 characters.
  - The question wording is the spec's Appendix A, verbatim.
- **Commits:** messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage and commit in one command, because concurrent sessions share the git index.
- **Verify commands:**
  - shared: `npm test --workspace @scripta/shared`
  - backend: `npm run typecheck --workspace backend && npm test --workspace backend`
  - frontend: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`

## Review Focus

1. **Hiding never shows the wrong language.** When an edition's own summary is hidden, the work's Open Library summary takes its place only if it passes the existing language check. A Portuguese edition never falls back to an English description. Pinned in Task 3.
2. **A changed summary is shown until it's judged again.** A re-imported publisher text gets a new hash and no judgment, so the old judgment can't hide it. Pinned in Tasks 1 and 3.
3. **Blank summaries never reach Jev or the review page.** Whitespace-only text has no hash. Pinned in Task 1.
4. **The details request never waits on Jev.** `onDetailsChecked` only adds a work id to a queue. Pinned in Task 5.
5. **Synopsis checks never spend the genre budget.** Their usage lands under `synopses`, not `genres`. Pinned in Task 5.

---

### Task 1: Summary hashes

**Files:**
- Create: `backend/src/modules/books/domain/synopsis.ts`
- Create: `backend/src/modules/books/domain/synopsis.test.ts`. Add `src/modules/books/domain/synopsis.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/domain/images.test.ts`.
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/domain/types.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces, `domain/synopsis.ts`:
  - `SYNOPSIS_HIDE_BELOW = 0.3`, `SYNOPSIS_REVIEW_BELOW = 0.5`, `SYNOPSIS_MIN_LETTERS = 40`
  - `SYNOPSIS_KINDS` (8 kinds), `type SynopsisKind`
  - `type SynopsisJudgment = { model: string; usable: number; kind: SynopsisKind; askedAt: string }`
  - `summaryHashOf(text: string | null): string | null`
  - `isFragment(text: string): boolean`
  - `isHiddenSynopsis(judgment: Pick<SynopsisJudgment, "model" | "usable"> | undefined): boolean`
- Produces, data:
  - columns `books.summary_hash` and `works.summary_hash`, indexed;
  - `BookRow.summary_hash: string | null`;
  - every write of a summary also writes its hash.

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/domain/synopsis.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { isFragment, isHiddenSynopsis, summaryHashOf } from "./synopsis.js";

test("summaryHashOf ignores surrounding and repeated whitespace and is null for blank text", () => {
  assert.equal(summaryHashOf("  A story\n\nabout   a boy. "), summaryHashOf("A story about a boy."));
  assert.notEqual(summaryHashOf("A story about a boy."), summaryHashOf("A story about a girl."));
  assert.match(summaryHashOf("x")!, /^[0-9a-f]{40}$/);
  assert.equal(summaryHashOf(" \n\t "), null);
  assert.equal(summaryHashOf(null), null);
});

test("isFragment counts letters, not characters, and the line is 40", () => {
  assert.equal(isFragment("Text: Portugese"), true);
  assert.equal(isFragment(`${"a".repeat(39)} 1234567890 !!! ??? ...`), true);
  assert.equal(isFragment("a".repeat(40)), false);
  assert.equal(isFragment("é".repeat(40)), false);
});

test("isHiddenSynopsis follows the rule, manual decisions and the Jev line", () => {
  assert.equal(isHiddenSynopsis(undefined), false);
  assert.equal(isHiddenSynopsis({ model: "rule", usable: 0 }), true);
  assert.equal(isHiddenSynopsis({ model: "manual", usable: 0 }), true);
  assert.equal(isHiddenSynopsis({ model: "manual", usable: 1 }), false);
  assert.equal(isHiddenSynopsis({ model: "jev-1.13.0", usable: 0.29 }), true);
  assert.equal(isHiddenSynopsis({ model: "jev-1.13.0", usable: 0.3 }), false);
  assert.equal(isHiddenSynopsis({ model: "jev-1.13.0", usable: 0.45 }), false);
});
```

In `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`, add this to the dynamic imports at the top, after the `WorkMergeError` import:

```ts
const { summaryHashOf } = await import("../../domain/synopsis.js");
```

Then append:

```ts
test("summary hashes are written with every summary and follow a merge", () => {
  const { db, repo } = freshRepo();
  const details = (summary: string | null) => ({ summary, pages: null, year: null, publisher: null, translator: null });
  const hashOf = (table: string, id: string | null) => (db.prepare(`SELECT summary_hash FROM ${table} WHERE id = ?`).get(id) as { summary_hash: string | null }).summary_hash;
  const a = repo.createBook({ title: "A", author: "X", isbn: "9789720000021" }, ["isbn:9789720000021"], NOW);
  repo.mergeDetails(a.id, details("  A long publisher\n\nsynopsis. "), "publisher");
  assert.equal(hashOf("books", a.id), summaryHashOf("A long publisher synopsis."));
  repo.mergeDetails(a.id, details("An ISBNdb text."), "isbndb");
  assert.equal(hashOf("books", a.id), summaryHashOf("A long publisher synopsis."));
  repo.mergeDetails(a.id, details("A newer publisher text."), "publisher");
  assert.equal(hashOf("books", a.id), summaryHashOf("A newer publisher text."));
  repo.setWorkSummary(a.id, "Work text.");
  assert.equal(hashOf("works", a.work_id), summaryHashOf("Work text."));
  const b = repo.createBook({ title: "B", author: "X", isbn: "9789720000022" }, ["isbn:9789720000022"], NOW);
  repo.mergeWorks(a.work_id!, b.work_id!);
  assert.equal(hashOf("works", b.work_id), summaryHashOf("Work text."));
  const c = repo.createBook({ title: "C", author: "X", isbn: "9789720000023" }, ["isbn:9789720000023"], NOW);
  repo.mergeDetails(c.id, details("   "), "publisher");
  assert.equal(hashOf("books", c.id), null);
});

test("the summary hash migration hashes stored summaries once", () => {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  db.exec("DROP INDEX idx_books_summary_hash; ALTER TABLE books DROP COLUMN summary_hash; DROP INDEX idx_works_summary_hash; ALTER TABLE works DROP COLUMN summary_hash");
  db.prepare("INSERT INTO works (id, title, author, created_at, summary) VALUES ('w1', 'T', 'A', ?, ' Work  text. ')").run(NOW);
  db.prepare("INSERT INTO books (id, title, author, work_id, summary, created_at) VALUES ('b1', 'T', 'A', 'w1', 'Edition text.', ?), ('b2', 'T', 'A', 'w1', NULL, ?), ('b3', 'T', 'A', 'w1', '  ', ?)").run(NOW, NOW, NOW);

  applyBooksMigrations(db);
  applyBooksMigrations(db);

  const hash = (sql: string) => (db.prepare(sql).get() as { h: string | null }).h;
  assert.equal(hash("SELECT summary_hash AS h FROM works WHERE id = 'w1'"), summaryHashOf("Work text."));
  assert.equal(hash("SELECT summary_hash AS h FROM books WHERE id = 'b1'"), summaryHashOf("Edition text."));
  assert.equal(hash("SELECT summary_hash AS h FROM books WHERE id = 'b2'"), null);
  assert.equal(hash("SELECT summary_hash AS h FROM books WHERE id = 'b3'"), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend`
Expected: FAIL. `./synopsis.js` doesn't exist.

- [ ] **Step 3: Implement**

Create `backend/src/modules/books/domain/synopsis.ts`:

```ts
import { createHash } from "node:crypto";

export const SYNOPSIS_HIDE_BELOW = 0.3;
export const SYNOPSIS_REVIEW_BELOW = 0.5;
export const SYNOPSIS_MIN_LETTERS = 40;
export const SYNOPSIS_KINDS = ["synopsis", "author_bio", "praise", "collection", "product", "contents", "other_book", "fragment"] as const;

export type SynopsisKind = (typeof SYNOPSIS_KINDS)[number];
export type SynopsisJudgment = { model: string; usable: number; kind: SynopsisKind; askedAt: string };

export function summaryHashOf(text: string | null): string | null {
  const normalized = (text ?? "").trim().replace(/\s+/g, " ");
  return normalized === "" ? null : createHash("sha1").update(normalized).digest("hex");
}

export function isFragment(text: string): boolean {
  return (text.match(/\p{L}/gu)?.length ?? 0) < SYNOPSIS_MIN_LETTERS;
}

export function isHiddenSynopsis(judgment: Pick<SynopsisJudgment, "model" | "usable"> | undefined): boolean {
  if (!judgment) return false;
  if (judgment.model === "rule") return true;
  if (judgment.model === "manual") return judgment.usable === 0;
  return judgment.usable < SYNOPSIS_HIDE_BELOW;
}
```

In `books.sql`:
- In `works`, change `summary      TEXT` to `summary      TEXT,` and add `summary_hash TEXT` after it.
- In `books`, add `summary_hash        TEXT,` right before `created_at          TEXT NOT NULL`.

In `connection.ts`:
- Add `import { summaryHashOf } from "../../domain/synopsis.js";`.
- Add this function after `moveOpenLibrarySummariesToWorks`:

```ts
function addSummaryHashes(db: DatabaseSync): void {
  for (const table of ["books", "works"]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "summary_hash")) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN summary_hash TEXT`);
      const update = db.prepare(`UPDATE ${table} SET summary_hash = ? WHERE id = ?`);
      for (const row of db.prepare(`SELECT id, summary FROM ${table} WHERE summary IS NOT NULL`).all() as Array<{ id: string; summary: string }>) {
        update.run(summaryHashOf(row.summary), row.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
}
```

- In `applyBooksMigrations`, call `addSummaryHashes(db);` right after `moveOpenLibrarySummariesToWorks(db);`.
- After the existing `CREATE INDEX` lines, add:

```ts
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_summary_hash ON books(summary_hash)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_works_summary_hash ON works(summary_hash)");
```

In `sqliteBooksRepository.ts`:
- Add `import { summaryHashOf } from "../../domain/synopsis.js";`.
- In `mergeDetailsStmt`, add this line right after the `summary = CASE …` line:

```sql
        summary_hash = CASE WHEN ${takesSummary} THEN $summary_hash ELSE summary_hash END,
```

- In the `mergeDetails` function, add `$summary_hash: summaryHashOf(details.summary),` to the `mergeDetailsStmt.run({ … })` object.
- Replace `setWorkSummaryStmt` and `carryWorkSummaryStmt` with:

```ts
  const setWorkSummaryStmt = db.prepare(`UPDATE works SET summary = ?, summary_hash = ? WHERE id = ? AND summary IS NULL`);
  const carryWorkSummaryStmt = db.prepare(`UPDATE works SET (summary, summary_hash) = (SELECT summary, summary_hash FROM works WHERE id = ?) WHERE id = ? AND summary IS NULL`);
```

- In `setWorkSummary`, change `setWorkSummaryStmt.run(summary, workId)` to `setWorkSummaryStmt.run(summary, summaryHashOf(summary), workId)`.

In `domain/types.ts`, add `summary_hash: string | null;` to `BookRow`, right after `summary: string | null;`. If typecheck then flags a hand-built `BookRow` literal in a test, add `summary_hash: null` to that literal.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/synopsis.ts backend/src/modules/books/domain/synopsis.test.ts backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/domain/types.ts backend/package.json && git commit -m "$(cat <<'EOF'
Hash every stored summary so judgments can follow the text

A synopsis judgment belongs to the text, not the book: a publisher blurb
reused on five editions is judged once, and a re-imported text gets a
new hash, so an old judgment can't hide it. The hash is written with the
summary in mergeDetails, setWorkSummary and the merge carry-over, and
existing rows are hashed once at boot, guarded by the column's absence.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Judgment and strike storage

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes: `SynopsisJudgment` (Task 1).
- Produces, `domain/types.ts`:
  - `type JevTask = "synopses" | "works"`
  - `type JevRejection = { status: number | null; reason: string; attempts: number; lastAt: string }`
- Produces, repo:
  - `synopsisJudgments(hashes: string[]): Map<string, SynopsisJudgment>`
  - `saveSynopsisJudgment(hash: string, judgment: SynopsisJudgment): void`. It replaces any earlier judgment.
  - `jevRejections(task: JevTask, subjects: string[]): Map<string, JevRejection>`
  - `recordJevRejection(rejection: { task: JevTask; subject: string; status: number | null; reason: string; at: string }): void`
  - `clearJevRejection(task: JevTask, subject: string): void`

- [ ] **Step 1: Write the failing tests**

Append to `sqliteBooksRepository.test.ts`:

```ts
test("synopsis judgments are stored by text hash, replaced and read back", () => {
  const { repo } = freshRepo();
  repo.saveSynopsisJudgment("h1", { model: "rule", usable: 0, kind: "fragment", askedAt: NOW });
  repo.saveSynopsisJudgment("h2", { model: "jev-1.13.0", usable: 0.12, kind: "praise", askedAt: NOW });
  repo.saveSynopsisJudgment("h2", { model: "manual", usable: 1, kind: "praise", askedAt: "2026-10-02T00:00:00.000Z" });
  const judgments = repo.synopsisJudgments(["h1", "h2", "h3"]);
  assert.equal(judgments.size, 2);
  assert.deepEqual(judgments.get("h1"), { model: "rule", usable: 0, kind: "fragment", askedAt: NOW });
  assert.deepEqual(judgments.get("h2"), { model: "manual", usable: 1, kind: "praise", askedAt: "2026-10-02T00:00:00.000Z" });
});

test("Jev rejections count attempts per task and subject, and clear one task only", () => {
  const { repo } = freshRepo();
  repo.recordJevRejection({ task: "synopses", subject: "h1", status: 400, reason: "HTTP 400", at: NOW });
  repo.recordJevRejection({ task: "synopses", subject: "h1", status: null, reason: "unexpected answer", at: "2026-10-02T00:00:00.000Z" });
  repo.recordJevRejection({ task: "works", subject: "h1", status: 422, reason: "HTTP 422", at: NOW });
  assert.deepEqual(repo.jevRejections("synopses", ["h1", "h2"]).get("h1"), { status: null, reason: "unexpected answer", attempts: 2, lastAt: "2026-10-02T00:00:00.000Z" });
  assert.equal(repo.jevRejections("works", ["h1"]).get("h1")?.attempts, 1);
  repo.clearJevRejection("synopses", "h1");
  assert.equal(repo.jevRejections("synopses", ["h1"]).size, 0);
  assert.equal(repo.jevRejections("works", ["h1"]).size, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `saveSynopsisJudgment`, `synopsisJudgments`, `recordJevRejection`, `jevRejections` and `clearJevRejection` don't exist on the repository.

- [ ] **Step 3: Implement**

Append to `books.sql`:

```sql
CREATE TABLE IF NOT EXISTS synopsis_judgments (
  text_hash TEXT PRIMARY KEY,
  model     TEXT NOT NULL,
  usable    REAL NOT NULL,
  kind      TEXT NOT NULL,
  asked_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jev_rejections (
  task     TEXT NOT NULL,
  subject  TEXT NOT NULL,
  status   INTEGER,
  reason   TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_at  TEXT NOT NULL,
  PRIMARY KEY (task, subject)
);
```

In `domain/types.ts`, add:

```ts
export type JevTask = "synopses" | "works";
export type JevRejection = { status: number | null; reason: string; attempts: number; lastAt: string };
```

In `domain/ports.ts`:
- Add `import type { SynopsisJudgment } from "./synopsis.js";`.
- Add `JevRejection` and `JevTask` to the `./types.js` import.
- Add these lines to `BooksRepository`, after `typesafeUsage(...)`:

```ts
  synopsisJudgments(hashes: string[]): Map<string, SynopsisJudgment>;
  saveSynopsisJudgment(hash: string, judgment: SynopsisJudgment): void;
  jevRejections(task: JevTask, subjects: string[]): Map<string, JevRejection>;
  recordJevRejection(rejection: { task: JevTask; subject: string; status: number | null; reason: string; at: string }): void;
  clearJevRejection(task: JevTask, subject: string): void;
```

In `sqliteBooksRepository.ts`:
- Import `SynopsisKind` alongside `summaryHashOf`: `import { summaryHashOf, type SynopsisKind } from "../../domain/synopsis.js";`.
- Add these statements after `typesafeUsageStmt`:

```ts
  const synopsisJudgmentsStmt = db.prepare(`SELECT text_hash, model, usable, kind, asked_at FROM synopsis_judgments WHERE text_hash IN (SELECT value FROM json_each(?))`);
  const saveSynopsisJudgmentStmt = db.prepare(`INSERT OR REPLACE INTO synopsis_judgments (text_hash, model, usable, kind, asked_at) VALUES (?, ?, ?, ?, ?)`);
  const jevRejectionsStmt = db.prepare(`SELECT subject, status, reason, attempts, last_at FROM jev_rejections WHERE task = ? AND subject IN (SELECT value FROM json_each(?))`);
  const recordJevRejectionStmt = db.prepare(`
    INSERT INTO jev_rejections (task, subject, status, reason, attempts, last_at) VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT (task, subject) DO UPDATE SET status = excluded.status, reason = excluded.reason, attempts = attempts + 1, last_at = excluded.last_at
  `);
  const clearJevRejectionStmt = db.prepare(`DELETE FROM jev_rejections WHERE task = ? AND subject = ?`);
```

- Add these methods after `typesafeUsage`:

```ts
    synopsisJudgments(hashes) {
      const rows = synopsisJudgmentsStmt.all(JSON.stringify(hashes)) as Array<{ text_hash: string; model: string; usable: number; kind: SynopsisKind; asked_at: string }>;
      return new Map(rows.map((row) => [row.text_hash, { model: row.model, usable: row.usable, kind: row.kind, askedAt: row.asked_at }]));
    },
    saveSynopsisJudgment(hash, judgment) {
      saveSynopsisJudgmentStmt.run(hash, judgment.model, judgment.usable, judgment.kind, judgment.askedAt);
    },
    jevRejections(task, subjects) {
      const rows = jevRejectionsStmt.all(task, JSON.stringify(subjects)) as Array<{ subject: string; status: number | null; reason: string; attempts: number; last_at: string }>;
      return new Map(rows.map((row) => [row.subject, { status: row.status, reason: row.reason, attempts: row.attempts, lastAt: row.last_at }]));
    },
    recordJevRejection(rejection) {
      recordJevRejectionStmt.run(rejection.task, rejection.subject, rejection.status, rejection.reason, rejection.at);
    },
    clearJevRejection(task, subject) {
      clearJevRejectionStmt.run(task, subject);
    },
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/domain/types.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts && git commit -m "$(cat <<'EOF'
Store synopsis judgments by text hash, and Jev strikes per task

synopsis_judgments holds one answer per distinct text: the rule, a Jev
version, or the owner's manual call. jev_rejections counts book-level
TypeSafe failures for the synopsis and translation work, keyed by task
and subject, so genre_rejections stays the genre work's own.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: What readers see

**Files:**
- Modify: `backend/src/modules/books/domain/synopsis.ts`
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/works.ts`
- Modify: `backend/src/modules/works/service.ts`
- Test: `backend/src/modules/books/booksService.test.ts`, `backend/src/modules/books/works.test.ts`, `backend/src/modules/works/service.test.ts`, `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes: `summaryHashOf`, `isHiddenSynopsis`, `SynopsisJudgment` (Task 1); `synopsisJudgments`, `saveSynopsisJudgment` (Task 2).
- Produces:
  - `hiddenSynopsisHashes(source: { synopsisJudgments(hashes: string[]): Map<string, SynopsisJudgment> }, hashes: Array<string | null>): Set<string>`
  - repo `getWorkSummary(bookId)` returns `{ summary: string | null; olWorkKey: string | null; summaryHash: string | null } | undefined`
  - `WorkPageRows.work.summary_hash` and `WorkPageRows.editions[].summary_hash`, both `string | null`
  - the work page picks the summary in this order: the viewer's own edition, then the work summary, then the first edition with one.

- [ ] **Step 1: Write the failing tests**

In `sqliteBooksRepository.test.ts`, the `setWorkSummary` test compares `getWorkSummary` with an exact object, so update its two assertions:

```ts
  assert.deepEqual({ ...repo.getWorkSummary(a.id) }, { summary: "First.", olWorkKey: null, summaryHash: summaryHashOf("First.") });
```

```ts
  assert.deepEqual({ ...repo.getWorkSummary(a.id) }, { summary: "First.", olWorkKey: "OL2W", summaryHash: summaryHashOf("First.") });
```

In `booksService.test.ts`, add this to the dynamic imports: `const { summaryHashOf } = await import("./domain/synopsis.js");`. Then append:

```ts
test("a hidden edition summary gives way to the work's summary, never to a hidden or wrong-language one", async () => {
  const h = harness();
  const meta = (summary: string) => ({ summary, rating: null, ratingCount: 0, sourceUrl: "", genres: [], pages: null, publisher: null, year: null, translator: null });
  const englishWork = "The whole story of a family across three generations, told with the help of letters and the memories of the people who were there.";
  const seeded = (isbn: string, workKey: string, summary: string) => {
    const book = h.repo.createBook({ title: `Book ${isbn}`, author: "Author", isbn, workKey }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
    h.repo.saveDetails(book.id, meta(summary), ["isbndb"], "isbndb", "2026-10-01T00:00:00.000Z");
    h.repo.setWorkSummary(book.id, englishWork);
    return { isbn, title: `Book ${isbn}`, author: "Author" };
  };
  const hide = (text: string) => h.repo.saveSynopsisJudgment(summaryHashOf(text)!, { model: "jev-1.13.0", usable: 0.1, kind: "praise", askedAt: "2026-10-02T00:00:00.000Z" });

  const english = seeded("9780441013593", "OL1W", "Praise for the book, in quotes.");
  assert.equal((await h.service.getDetails(english))?.summary, "Praise for the book, in quotes.");
  hide("Praise for the book, in quotes.");
  const fallback = await h.service.getDetails(english);
  assert.equal(fallback?.summary, englishWork);
  assert.equal(fallback?.summarySource, "openlibrary");

  const portuguese = seeded("9789720000031", "OL31W", "Elogios ao livro, entre aspas.");
  hide("Elogios ao livro, entre aspas.");
  const none = await h.service.getDetails(portuguese);
  assert.equal(none?.summary, null);
  assert.equal(none?.summarySource, null);

  hide(englishWork);
  assert.equal((await h.service.getDetails(english))?.summary, null);
});

test("a changed summary is shown until it is judged again", async () => {
  const h = harness();
  const book = h.repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, ["isbn:9780141184272"], "2026-10-01T00:00:00.000Z");
  h.repo.saveDetails(book.id, { summary: "Old praise.", rating: null, ratingCount: 0, sourceUrl: "", genres: [], pages: null, publisher: null, year: null, translator: null }, ["isbndb"], "isbndb", "2026-10-01T00:00:00.000Z");
  h.repo.saveSynopsisJudgment(summaryHashOf("Old praise.")!, { model: "manual", usable: 0, kind: "praise", askedAt: "2026-10-02T00:00:00.000Z" });
  h.repo.mergeDetails(book.id, { summary: "A new publisher synopsis.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  assert.equal((await h.service.getDetails(orlando))?.summary, "A new publisher synopsis.");
});
```

In `backend/src/modules/books/works.test.ts`, add this to the dynamic imports: `const { summaryHashOf } = await import("./domain/synopsis.js");`. Then append:

```ts
test("getWorkPage leaves out hidden summaries and keeps the rest", () => {
  const { repo } = freshRepo();
  const at = "2026-10-01T00:00:00.000Z";
  const book = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], at);
  repo.mergeDetails(book.id, { summary: "Praise, praise, praise.", pages: null, year: null, publisher: null, translator: null }, "publisher");
  repo.setWorkSummary(book.id, "Spice must flow.");
  const judge = (text: string, usable: number) => repo.saveSynopsisJudgment(summaryHashOf(text)!, { model: "jev-1.13.0", usable, kind: "praise", askedAt: at });
  judge("Praise, praise, praise.", 0.1);
  judge("Spice must flow.", 0.9);
  const page = getWorkPageWith(repo, (id) => id, book.work_id!)!;
  assert.equal(page.summary, "Spice must flow.");
  assert.equal(page.editions[0]!.summary, null);
  judge("Spice must flow.", 0.2);
  assert.equal(getWorkPageWith(repo, (id) => id, book.work_id!)!.summary, null);
});
```

In `backend/src/modules/works/service.test.ts`, append:

```ts
test("your own edition's summary comes before the work summary", () => {
  const work = {
    id: "w", title: "Dune", author: "Frank Herbert", summary: "Work text.", aliasIds: ["w"],
    editions: [{ bookId: "e2", title: "Duna", language: "pt-BR", year: 2017, isbn: "9788576573135", summary: "Especiaria.", coverUrl: null, coverColor: null, genres: [], rating: null, ratingCount: 0, pages: null }]
  };
  const own = { bookKey: "isbn:9788576573135", readStatus: 2 as const, rating: null, highlightCount: 0, isbn: "9788576573135", coverUrl: null };
  assert.equal(createWorksService(deps({ getWorkPage: () => work, copyOfWork: () => own })).getPage("w", "viewer")!.work.summary, "Especiaria.");
  assert.equal(createWorksService(deps({ getWorkPage: () => work })).getPage("w", null)!.work.summary, "Work text.");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: FAIL.
- The `getWorkSummary` assertions fail, because `summaryHash` is missing.
- The book details still serve hidden text.
- The work page shows the hidden edition summary.
- The work summary still wins over the viewer's own edition.

- [ ] **Step 3: Implement**

Add to `domain/synopsis.ts`:

```ts
export function hiddenSynopsisHashes(source: { synopsisJudgments(hashes: string[]): Map<string, SynopsisJudgment> }, hashes: Array<string | null>): Set<string> {
  const wanted = [...new Set(hashes.filter((hash): hash is string => hash !== null))];
  if (wanted.length === 0) return new Set();
  const judgments = source.synopsisJudgments(wanted);
  return new Set(wanted.filter((hash) => isHiddenSynopsis(judgments.get(hash))));
}
```

In `domain/types.ts`, in `WorkPageRows`:
- `work` becomes `{ id: string; title: string; author: string; summary: string | null; summary_hash: string | null }`;
- add `summary_hash: string | null;` to the edition element type, after `summary: string | null;`.

In `domain/ports.ts`, change the `getWorkSummary` line to:

```ts
  getWorkSummary(bookId: string): { summary: string | null; olWorkKey: string | null; summaryHash: string | null } | undefined;
```

In `sqliteBooksRepository.ts`:
- **`workSummaryStmt`:** select `target.summary_hash AS summaryHash` as well. The `SELECT` line becomes `SELECT target.summary AS summary, target.ol_work_key AS olWorkKey, target.summary_hash AS summaryHash`.
- **`getWorkSummary`:** its cast becomes `{ summary: string | null; olWorkKey: string | null; summaryHash: string | null } | undefined`.
- **`workStmt`:** becomes `SELECT id, ol_work_key, title, author, summary, summary_hash FROM works WHERE id = ?`.
- **`pageEditionsStmt`:** add `books.summary_hash` right after `books.summary` in its column list.
- **`workPageRows`:**
  - The `work` cast gains `summary_hash: string | null`.
  - The returned work becomes `work: { id: work.id, title: work.title, author: work.author, summary: work.summary, summary_hash: work.summary_hash }`.
  - `genreEvidence` also reads `workStmt`, but it builds its own object and needs no change.

In `booksService.ts`, add `import { hiddenSynopsisHashes } from "./domain/synopsis.js";` and replace `workSummaryOf` and `detailsOf` with:

```ts
  function workSummaryOf(book: BookRow): { summary: string; sourceUrl: string } | null {
    const work = deps.repo.getWorkSummary(book.id);
    if (!work?.summary || !work.olWorkKey) return null;
    if (hiddenSynopsisHashes(deps.repo, [work.summaryHash]).size > 0) return null;
    if (!summaryMatchesLanguage(work.summary, book.language ?? (isPortugueseIsbn(book.isbn) ? "pt" : null))) return null;
    return { summary: work.summary, sourceUrl: `https://openlibrary.org/works/${work.olWorkKey}` };
  }

  function detailsOf(book: BookRow): BookMetadata {
    const own = book.summary && hiddenSynopsisHashes(deps.repo, [book.summary_hash]).size === 0 ? book.summary : null;
    const fromWork = own ? null : workSummaryOf(book);
    return {
      summary: fromWork?.summary ?? own,
      rating: book.rating,
      ratingCount: book.rating_count,
      sourceUrl: fromWork?.sourceUrl ?? summaryLink(book),
      genres: JSON.parse(book.genres) as BookGenre[],
      pages: book.pages,
      publisher: book.publisher,
      year: book.year,
      translator: book.translator,
      summarySource: fromWork ? "openlibrary" : own ? book.summary_source : null
    };
  }
```

In `backend/src/modules/books/works.ts`, add `import { hiddenSynopsisHashes } from "./domain/synopsis.js";` and replace `getWorkPageWith` with:

```ts
export function getWorkPageWith(books: BooksRepository, coverUrl: (imageId: string) => string, id: string): CatalogWorkPage | undefined {
  const rows = books.workPageRows(id);
  if (!rows) return undefined;
  const hidden = hiddenSynopsisHashes(books, [rows.work.summary_hash, ...rows.editions.map((edition) => edition.summary_hash)]);
  const shown = (text: string | null, hash: string | null) => (text?.trim() && !(hash !== null && hidden.has(hash)) ? text : null);
  return {
    id: rows.work.id,
    title: rows.work.title,
    author: rows.work.author,
    summary: shown(rows.work.summary, rows.work.summary_hash),
    aliasIds: rows.aliasIds,
    editions: rows.editions.map((edition) => ({
      bookId: edition.id,
      title: edition.title,
      language: edition.language,
      year: edition.year,
      isbn: edition.isbn,
      summary: shown(edition.summary, edition.summary_hash),
      coverUrl: edition.cover_image_id ? coverUrl(edition.cover_image_id) : null,
      coverColor: edition.cover_color || null,
      genres: normalizeBookGenres(JSON.parse(edition.genres)),
      rating: edition.rating,
      ratingCount: edition.rating_count,
      pages: edition.pages,
      possible: isPossibleGenre(edition.genres_source, edition.genres_confidence)
    }))
  };
}
```

In `backend/src/modules/works/service.ts`, change the summary line in `getPage` to:

```ts
      const summary = mineEdition?.summary ?? work.summary ?? work.editions.find((edition) => edition.summary)?.summary ?? null;
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/synopsis.ts backend/src/modules/books/domain/types.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/booksService.ts backend/src/modules/books/booksService.test.ts backend/src/modules/books/works.ts backend/src/modules/books/works.test.ts backend/src/modules/works/service.ts backend/src/modules/works/service.test.ts && git commit -m "$(cat <<'EOF'
Hide summaries judged not to be synopses, and show your own edition's first

Book details and the work page skip a summary whose judgment says it
isn't a synopsis (the rule, a manual hide, or Jev below 0.3). A hidden
edition summary gives way to the work's Open Library text only under the
existing language check, so a Portuguese book never gets an English
description in its place. The work page now prefers the reader's own
edition over the work summary, which translation grouping needs: after a
Portuguese work merges into its original, Portuguese readers keep their
own synopsis.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: One Jev request helper, and the synopsis adapter

**Files:**
- Create: `backend/src/modules/books/adapters/typesafe/jevRequest.ts`
- Modify: `backend/src/modules/books/adapters/typesafe/jevGenres.ts`
- Create: `backend/src/modules/books/adapters/typesafe/jevSynopsis.ts`
- Create: `backend/src/modules/books/adapters/typesafe/jevSynopsis.test.ts`. Add `src/modules/books/adapters/typesafe/jevSynopsis.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/adapters/typesafe/jevGenres.test.ts`.

**Interfaces:**
- Consumes:
  - `Spend` from `typesafe.ts`; `UnusableAnswerError` and `SourceUnavailableError` from `domain/errors.ts` (genre review plan);
  - `SYNOPSIS_KINDS` and `SynopsisKind` (Task 1).
- Produces, `jevRequest.ts`:
  - `JEV_MODEL = "jev-1.13.0"`
  - `type Sleep = (ms: number) => Promise<void>`, `realSleep: Sleep`
  - `askJev(apiKey: string, spend: Spend, sleep: Sleep, state: unknown, questions: Record<string, unknown>): Promise<unknown>`, the genre classifier's request loop, unchanged.
- Produces, `jevSynopsis.ts`:
  - `SYNOPSIS_TEXT_LIMIT = 2500`
  - `type SynopsisInput = { title: string; author: string; text: string }`
  - `type SynopsisAnswer = { usable: number; kind: SynopsisKind; model: string }`
  - `type ClassifySynopsis = (input: SynopsisInput) => Promise<SynopsisAnswer>`
  - `createJevSynopsisClassifier(apiKey: string, spend: Spend, sleep?: Sleep): ClassifySynopsis`
- `jevGenres.ts` keeps its exports, `JEV_MODEL` included (now re-exported), and its behaviour.

- [ ] **Step 1: Write the failing test**

`backend/src/modules/books/adapters/typesafe/jevSynopsis.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { UnusableAnswerError } from "../../domain/errors.js";
import { createJevSynopsisClassifier, SYNOPSIS_TEXT_LIMIT } from "./jevSynopsis.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Seen = { url: string; init?: RequestInit };
function stub(responses: Array<() => Response>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return responses[Math.min(seen.length, responses.length) - 1]!();
  }) as typeof fetch;
  return seen;
}

const answer = (usable: number, kind: string) => () => Response.json({ model: "jev-1.13.0", answers: { usable: { type: "noul", noul: usable }, kind: { type: "choice", choice: kind, confidence: 0.9, probabilities: {} } }, usage: { input_tokens: 400, output_tokens: 20 } });
const noSleep = async () => {};
const noSpend = () => {};
const input = { title: "Os Anões", author: "Harold Pinter", text: "Uma peça sobre três amigos em Londres." };

test("asks one yes/no and one kind choice about the stored text", async () => {
  const seen = stub([answer(0.12, "praise")]);
  assert.deepEqual(await createJevSynopsisClassifier("key", noSpend, noSleep)(input), { usable: 0.12, kind: "praise", model: "jev-1.13.0" });
  assert.equal(seen[0]!.url, "https://api.typesafe.ai/v1/systemone");
  const body = JSON.parse(String(seen[0]!.init?.body));
  assert.equal(body.model, "jev-1.13.0");
  assert.deepEqual(body.state, { book: { title: "Os Anões", author: "Harold Pinter" }, text: "Uma peça sobre três amigos em Londres." });
  assert.deepEqual(Object.keys(body.questions), ["usable", "kind"]);
  assert.equal(body.questions.usable.type, "noul");
  assert.deepEqual(Object.keys(body.questions.usable.criteria), ["true", "false"]);
  assert.equal(body.questions.kind.type, "choice");
  assert.deepEqual(Object.keys(body.questions.kind.criteria), ["synopsis", "author_bio", "praise", "collection", "product", "contents", "other_book", "fragment"]);
});

test("the text is cut to 2,500 characters", async () => {
  const seen = stub([answer(0.9, "synopsis")]);
  await createJevSynopsisClassifier("key", noSpend, noSleep)({ ...input, text: "x".repeat(3000) });
  assert.equal(JSON.parse(String(seen[0]!.init?.body)).state.text.length, SYNOPSIS_TEXT_LIMIT);
});

test("an unknown kind or a missing probability is an unusable answer", async () => {
  stub([() => Response.json({ model: "jev-1.13.0", answers: { usable: { noul: 0.4 }, kind: { choice: "novel" } } })]);
  await assert.rejects(createJevSynopsisClassifier("key", noSpend, noSleep)(input), UnusableAnswerError);
  stub([() => Response.json({ model: "jev-1.13.0", answers: { kind: { choice: "praise" } } })]);
  await assert.rejects(createJevSynopsisClassifier("key", noSpend, noSleep)(input), UnusableAnswerError);
});

test("every request, retries included, spends budget first", async () => {
  let spent = 0;
  stub([() => new Response("{}", { status: 429 }), answer(0.8, "synopsis")]);
  await createJevSynopsisClassifier("key", () => { spent += 1; }, noSleep)(input);
  assert.equal(spent, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `./jevSynopsis.js` doesn't exist.

- [ ] **Step 3: Implement**

Create `jevRequest.ts`. Its loop is the genre classifier's, moved:

```ts
import { SourceUnavailableError, UnusableAnswerError } from "../../domain/errors.js";
import type { Spend } from "../../typesafe.js";
import { readBody } from "../http/http.js";

export const JEV_MODEL = "jev-1.13.0";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 10_000;
const RETRIES = 4;

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function askJev(apiKey: string, spend: Spend, sleep: Sleep, state: unknown, questions: Record<string, unknown>): Promise<unknown> {
  const body = JSON.stringify({ state, model: JEV_MODEL, questions });
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
    try {
      return await readBody("typesafe", () => response.json());
    } catch (error) {
      if (error instanceof SyntaxError) throw new UnusableAnswerError("typesafe", "invalid JSON");
      throw error;
    }
  }
}
```

In `jevGenres.ts`:
- Remove `ENDPOINT`, `TIMEOUT_MS` and `RETRIES`, and the `readBody` and `SourceUnavailableError` imports. Keep `UnusableAnswerError`, which `judgmentOf` throws.
- Replace `export const JEV_MODEL = "jev-1.13.0";` with `export { JEV_MODEL } from "./jevRequest.js";`.
- Add `import { askJev, realSleep, type Sleep } from "./jevRequest.js";`.
- Replace `createJevGenreClassifier` with:

```ts
export function createJevGenreClassifier(apiKey: string, spend: Spend, sleep: Sleep = realSleep): ClassifyGenre {
  return async (book) => judgmentOf(await askJev(apiKey, spend, sleep, stateOf(book), { genre: { type: "choice", instructions: INSTRUCTIONS, criteria: CRITERIA } }));
}
```

Create `jevSynopsis.ts`. Its instructions and criteria are the spec's Appendix A, verbatim:

```ts
import { UnusableAnswerError } from "../../domain/errors.js";
import { SYNOPSIS_KINDS, type SynopsisKind } from "../../domain/synopsis.js";
import type { Spend } from "../../typesafe.js";
import { askJev, realSleep, type Sleep } from "./jevRequest.js";

export const SYNOPSIS_TEXT_LIMIT = 2500;

export type SynopsisInput = { title: string; author: string; text: string };
export type SynopsisAnswer = { usable: number; kind: SynopsisKind; model: string };
export type ClassifySynopsis = (input: SynopsisInput) => Promise<SynopsisAnswer>;

const QUESTIONS = {
  usable: {
    type: "noul",
    instructions: "Is `text` a description of the content of the book in `book`: what the book is about (its story, subject or argument)? Answer yes when the text describes this book's content, even if it also mentions the author or awards. Answer no when the text is mainly something else.",
    criteria: {
      true: "The text describes what this book is about, so it can serve as the book's synopsis.",
      false: "The text is mainly an author biography, praise quotes or reviews, a description of a series, collection or publisher, product or shop information, a table of contents, a description of a different book, or too short or fragmentary to say what the book is about."
    }
  },
  kind: {
    type: "choice",
    instructions: "What is `text` mainly? `text` was stored as the description of the book in `book`.",
    criteria: {
      synopsis: "A description of what this book is about: story, subject or argument",
      author_bio: "Mainly a biography of the author",
      praise: "Mainly praise, review quotes, awards or sales claims",
      collection: "Mainly about a series, a collection or the publisher rather than this book",
      product: "Product or shop information: format, materials, a non-book item, prices or shipping",
      contents: "A table of contents or list of included pieces",
      other_book: "A description of a different book",
      fragment: "Too short or fragmentary to tell what the book is about"
    }
  }
};

const KINDS = new Set<string>(SYNOPSIS_KINDS);

function answerOf(body: unknown): SynopsisAnswer {
  const answers = (body as { answers?: { usable?: { noul?: unknown }; kind?: { choice?: unknown } } } | null)?.answers;
  const model = (body as { model?: unknown } | null)?.model;
  const usable = answers?.usable?.noul;
  const kind = answers?.kind?.choice;
  if (typeof usable !== "number" || typeof kind !== "string" || !KINDS.has(kind) || typeof model !== "string") throw new UnusableAnswerError("typesafe", "unexpected answer");
  return { usable, kind: kind as SynopsisKind, model };
}

export function createJevSynopsisClassifier(apiKey: string, spend: Spend, sleep: Sleep = realSleep): ClassifySynopsis {
  return async (input) => answerOf(await askJev(apiKey, spend, sleep, { book: { title: input.title, author: input.author }, text: input.text.slice(0, SYNOPSIS_TEXT_LIMIT) }, QUESTIONS));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS, with `jevGenres.test.ts` unchanged and still green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/adapters/typesafe/jevRequest.ts backend/src/modules/books/adapters/typesafe/jevGenres.ts backend/src/modules/books/adapters/typesafe/jevSynopsis.ts backend/src/modules/books/adapters/typesafe/jevSynopsis.test.ts backend/package.json && git commit -m "$(cat <<'EOF'
Ask Jev whether a stored summary is a synopsis

The genre classifier's request loop (spend before every attempt, back off
on 429 and 529, classify failures) moves to askJev so the synopsis and
translation adapters share it instead of copying it. The synopsis
question is the spec's wording, measured on 2026-10-14/15: a yes/no on
whether the text describes the book, plus what the text mainly is.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Judging, the queue, the sweep and the details hook

**Files:**
- Modify: `backend/src/modules/books/typesafe.ts`
- Modify: `backend/src/modules/books/genreJudgments.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Create: `backend/src/modules/books/synopsisJudgments.ts`
- Create: `backend/src/modules/books/synopsisJudgments.test.ts`. Add `src/modules/books/synopsisJudgments.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/genreJudgments.test.ts`.
- Modify: `backend/src/modules/books/plugin.ts`

**Interfaces:**
- Consumes:
  - Tasks 1, 2 and 4;
  - `failureKind`, `nextUtcMidnight`, `dailySpend`, `TypesafeBudgetSpentError`, `utcDay`;
  - `createWorkQueue`, `startDetailsBackfill`, `onDetailsChecked`, and the plugin's `heldWorks` and `genreJobs`.
- Produces, `typesafe.ts`: `strikeReason(error: unknown): { status: number | null; reason: string }`, moved out of `genreJudgments.ts` and exported.
- Produces, repo:
  - `synopsesNeedingJudgment(workIds: string[], limit: number, rejectionLimit: number): string[]`: distinct hashes on those works' editions and work rows, with no judgment and fewer than `rejectionLimit` strikes.
  - `worksNeedingSynopsisJudgment(workIds: string[], limit: number, rejectionLimit: number): string[]`
  - `synopsisText(hash: string): { text: string; title: string; author: string } | undefined`: the oldest edition carrying the text, else the work.
- Produces, `synopsisJudgments.ts`:
  - `SYNOPSIS_SOURCE = "synopses"`, `SYNOPSIS_DAILY_BUDGET = 1000`, `JEV_REJECTION_LIMIT = 3`, `SYNOPSIS_IN_FLIGHT = 4`
  - `type SynopsisJudgmentDeps = { repo: BooksRepository; classify: ClassifySynopsis; now: () => number; alert: (subject: string, text: string) => void }`
  - `applySynopsisRule(repo, hash: string, at: string): boolean`
  - `classifyText(deps: SynopsisJudgmentDeps, hash: string): Promise<number | null>`
  - `judgeWorkSynopses(deps: SynopsisJudgmentDeps & { heldWorkIds: () => string[] }, workId: string): Promise<number | null>`
  - `startSynopsisJobs(deps: SynopsisJudgmentDeps & { heldWorkIds: () => string[]; onError: (error: unknown, workId?: string) => void }): SynopsisJobs`, where `SynopsisJobs = { add(workId: string): void; stop(): void }`
  - `startSynopsisJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startSynopsisJobs>[0], "classify">): SynopsisJobs | null`

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/synopsisJudgments.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "synopsis-judgments-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError, UnusableAnswerError } = await import("./domain/errors.js");
const { TypesafeBudgetSpentError, utcDay } = await import("./typesafe.js");
const { judgeWorkSynopses, startSynopsisJobs, startSynopsisJobsIfConfigured, JEV_REJECTION_LIMIT } = await import("./synopsisJudgments.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
type Answer = { usable: number; kind: "synopsis" | "praise"; model: string };

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const SYNOPSIS = "A long description of what this book is about, its story and the people in it.";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function seed(repo: Repo, isbn: string, summary: string) {
  const book = repo.createBook({ title: `Book ${isbn}`, author: "Author", isbn }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
  repo.mergeDetails(book.id, { summary, pages: null, year: null, publisher: null, translator: null }, "publisher");
  return repo.getBook(book.id)!;
}

function judging(repo: Repo, classify: (input: { text: string }) => Promise<Answer>, held: string[]) {
  const asked: string[] = [];
  const alerts: string[] = [];
  const deps = {
    repo,
    classify: async (input: { title: string; author: string; text: string }) => {
      asked.push(input.text);
      return classify(input);
    },
    now: () => NOW,
    alert: (subject: string) => { alerts.push(subject); },
    heldWorkIds: () => held
  };
  return { deps, asked, alerts };
}

const keep = async (): Promise<Answer> => ({ usable: 0.92, kind: "synopsis", model: "jev-1.13.0" });

test("a fragment is judged by the rule without asking Jev", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000041", "Text: Portugese");
  const { deps, asked } = judging(repo, keep, [book.work_id!]);
  assert.equal(await judgeWorkSynopses(deps, book.work_id!), null);
  assert.deepEqual(asked, []);
  assert.deepEqual(repo.synopsisJudgments([book.summary_hash!]).get(book.summary_hash!), { model: "rule", usable: 0, kind: "fragment", askedAt: "2026-10-15T12:00:00.000Z" });
});

test("every unjudged text of a held work is asked once, edition and work summaries alike", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000042", SYNOPSIS);
  repo.setWorkSummary(book.id, `${SYNOPSIS} From the work.`);
  const { deps, asked } = judging(repo, keep, [book.work_id!]);
  await judgeWorkSynopses(deps, book.work_id!);
  await judgeWorkSynopses(deps, book.work_id!);
  assert.equal(asked.length, 2);
  assert.equal(repo.synopsisJudgments([book.summary_hash!]).get(book.summary_hash!)?.usable, 0.92);
});

test("a work nobody holds is never asked about", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000043", SYNOPSIS);
  const { deps, asked } = judging(repo, keep, []);
  assert.equal(await judgeWorkSynopses(deps, book.work_id!), null);
  assert.deepEqual(asked, []);
});

test("a merged work id is judged as its canonical work", async () => {
  const repo = freshRepo();
  const alias = seed(repo, "9789720000044", SYNOPSIS);
  const target = seed(repo, "9789720000045", `${SYNOPSIS} Another.`);
  repo.mergeWorks(alias.work_id!, target.work_id!);
  const { deps, asked } = judging(repo, keep, [alias.work_id!]);
  await judgeWorkSynopses(deps, alias.work_id!);
  assert.equal(asked.length, 2);
});

test("an unusable answer is a strike, and three strikes stop the text being asked", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000046", SYNOPSIS);
  const { deps, asked } = judging(repo, async () => { throw new UnusableAnswerError("typesafe", "unexpected answer"); }, [book.work_id!]);
  for (let round = 0; round < JEV_REJECTION_LIMIT + 1; round++) assert.equal(await judgeWorkSynopses(deps, book.work_id!), null);
  assert.equal(asked.length, JEV_REJECTION_LIMIT);
  assert.deepEqual(repo.jevRejections("synopses", [book.summary_hash!]).get(book.summary_hash!), { status: null, reason: "unexpected answer", attempts: 3, lastAt: "2026-10-15T12:00:00.000Z" });
  assert.equal(repo.synopsisJudgments([book.summary_hash!]).size, 0);
});

test("a spent budget, an outage and a 401 pause and store nothing", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000047", SYNOPSIS);
  const failing = (error: unknown) => judging(repo, async () => { throw error; }, [book.work_id!]);
  assert.equal(await judgeWorkSynopses(failing(new TypesafeBudgetSpentError("synopses")).deps, book.work_id!), Date.parse("2026-10-16T00:00:00.000Z"));
  assert.equal(await judgeWorkSynopses(failing(new SourceUnavailableError("typesafe", "HTTP 503", { status: 503 })).deps, book.work_id!), NOW + 10 * 60 * 1000);
  const key = failing(new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }));
  assert.equal(await judgeWorkSynopses(key.deps, book.work_id!), NOW + 24 * 60 * 60 * 1000);
  assert.deepEqual(key.alerts, ["TypeSafe rejected the synopsis requests"]);
  assert.equal(repo.synopsisJudgments([book.summary_hash!]).size, 0);
  assert.equal(repo.jevRejections("synopses", [book.summary_hash!]).size, 0);
});

test("adding a work only queues it; judging happens after the caller returns", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000048", SYNOPSIS);
  const { deps, asked } = judging(repo, keep, [book.work_id!]);
  const jobs = startSynopsisJobs({ ...deps, onError: (error) => { throw error; } });
  jobs.add(book.work_id!);
  assert.deepEqual(asked, []);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(asked.length, 1);
  jobs.stop();
});

test("synopsis requests are counted under the synopses source, not genres", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000049", SYNOPSIS);
  globalThis.fetch = (async () => Response.json({ model: "jev-1.13.0", answers: { usable: { noul: 0.9 }, kind: { choice: "synopsis" } } })) as typeof fetch;
  const jobs = startSynopsisJobsIfConfigured("key", { repo, heldWorkIds: () => [book.work_id!], now: () => NOW, alert: () => {}, onError: (error) => { throw error; } })!;
  jobs.add(book.work_id!);
  await new Promise((resolve) => setTimeout(resolve, 20));
  jobs.stop();
  assert.equal(repo.typesafeUsage(utcDay(NOW), "synopses"), 1);
  assert.equal(repo.typesafeUsage(utcDay(NOW), "genres"), 0);
  assert.equal(startSynopsisJobsIfConfigured("", { repo, heldWorkIds: () => [], now: () => NOW, alert: () => {}, onError: () => {} }), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `./synopsisJudgments.js` doesn't exist.

- [ ] **Step 3: Implement**

In `typesafe.ts`, add this export, moved from `genreJudgments.ts`:

```ts
export function strikeReason(error: unknown): { status: number | null; reason: string } {
  if (error instanceof UnusableAnswerError) return { status: null, reason: error.detail };
  const status = (error as SourceUnavailableError).status ?? null;
  return { status, reason: `HTTP ${status}` };
}
```

In `genreJudgments.ts`:
- Delete the local `strikeReason`.
- Add `strikeReason` to its `./typesafe.js` import.
- Drop `SourceUnavailableError` and `UnusableAnswerError` from its `./domain/errors.js` import if nothing else in the file uses them.

In `domain/ports.ts`, add after `clearJevRejection(...)`:

```ts
  synopsesNeedingJudgment(workIds: string[], limit: number, rejectionLimit: number): string[];
  worksNeedingSynopsisJudgment(workIds: string[], limit: number, rejectionLimit: number): string[];
  synopsisText(hash: string): { text: string; title: string; author: string } | undefined;
```

In `sqliteBooksRepository.ts`, add these statements after `clearJevRejectionStmt`:

```ts
  const synopsesNeedingJudgmentStmt = db.prepare(`
    SELECT hash FROM (
      SELECT summary_hash AS hash FROM books WHERE work_id IN (SELECT value FROM json_each(?)) AND summary_hash IS NOT NULL
      UNION
      SELECT summary_hash FROM works WHERE id IN (SELECT value FROM json_each(?)) AND summary_hash IS NOT NULL
    ) AS t
    WHERE NOT EXISTS (SELECT 1 FROM synopsis_judgments j WHERE j.text_hash = t.hash)
      AND NOT EXISTS (SELECT 1 FROM jev_rejections r WHERE r.task = 'synopses' AND r.subject = t.hash AND r.attempts >= ?)
    LIMIT ?
  `);
  const worksNeedingSynopsisJudgmentStmt = db.prepare(`
    SELECT w.value AS id FROM json_each(?) AS w
    WHERE EXISTS (
        SELECT 1 FROM books b WHERE b.work_id = w.value AND b.summary_hash IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM synopsis_judgments j WHERE j.text_hash = b.summary_hash)
          AND NOT EXISTS (SELECT 1 FROM jev_rejections r WHERE r.task = 'synopses' AND r.subject = b.summary_hash AND r.attempts >= ?)
      )
      OR EXISTS (
        SELECT 1 FROM works x WHERE x.id = w.value AND x.summary_hash IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM synopsis_judgments j WHERE j.text_hash = x.summary_hash)
          AND NOT EXISTS (SELECT 1 FROM jev_rejections r WHERE r.task = 'synopses' AND r.subject = x.summary_hash AND r.attempts >= ?)
      )
    LIMIT ?
  `);
  const synopsisBookCarrierStmt = db.prepare(`SELECT summary AS text, title, author FROM books WHERE summary_hash = ? ORDER BY created_at, rowid LIMIT 1`);
  const synopsisWorkCarrierStmt = db.prepare(`SELECT summary AS text, title, author FROM works WHERE summary_hash = ? ORDER BY created_at, rowid LIMIT 1`);
```

And these methods after `clearJevRejection`:

```ts
    synopsesNeedingJudgment(workIds, limit, rejectionLimit) {
      const ids = JSON.stringify(workIds);
      return (synopsesNeedingJudgmentStmt.all(ids, ids, rejectionLimit, limit) as Array<{ hash: string }>).map((row) => row.hash);
    },
    worksNeedingSynopsisJudgment(workIds, limit, rejectionLimit) {
      return (worksNeedingSynopsisJudgmentStmt.all(JSON.stringify(workIds), rejectionLimit, rejectionLimit, limit) as Array<{ id: string }>).map((row) => row.id);
    },
    synopsisText(hash) {
      const row = (synopsisBookCarrierStmt.get(hash) ?? synopsisWorkCarrierStmt.get(hash)) as { text: string; title: string; author: string } | undefined;
      return row ? { text: row.text, title: row.title, author: row.author } : undefined;
    },
```

Create `backend/src/modules/books/synopsisJudgments.ts`:

```ts
import { createJevSynopsisClassifier, type ClassifySynopsis } from "./adapters/typesafe/jevSynopsis.js";
import { startDetailsBackfill } from "./backfill.js";
import type { BooksRepository } from "./domain/ports.js";
import { isFragment } from "./domain/synopsis.js";
import { dailySpend, failureKind, nextUtcMidnight, strikeReason } from "./typesafe.js";
import { createWorkQueue } from "./workQueue.js";

export const SYNOPSIS_SOURCE = "synopses";
export const SYNOPSIS_DAILY_BUDGET = 1000;
export const JEV_REJECTION_LIMIT = 3;
export const SYNOPSIS_IN_FLIGHT = 4;
const WORK_TEXT_LIMIT = 50;
const SWEEP_LIMIT = 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const OUTAGE_PAUSE_MS = 10 * 60 * 1000;
const KEY_PAUSE_MS = 24 * 60 * 60 * 1000;

export type SynopsisJudgmentDeps = {
  repo: BooksRepository;
  classify: ClassifySynopsis;
  now: () => number;
  alert: (subject: string, text: string) => void;
};
type HeldDeps = SynopsisJudgmentDeps & { heldWorkIds: () => string[] };
export type SynopsisJobs = { add(workId: string): void; stop(): void };

export function applySynopsisRule(repo: Pick<BooksRepository, "synopsisText" | "saveSynopsisJudgment">, hash: string, at: string): boolean {
  const carrier = repo.synopsisText(hash);
  if (!carrier || !isFragment(carrier.text)) return false;
  repo.saveSynopsisJudgment(hash, { model: "rule", usable: 0, kind: "fragment", askedAt: at });
  return true;
}

export async function classifyText(deps: SynopsisJudgmentDeps, hash: string): Promise<number | null> {
  const at = () => new Date(deps.now()).toISOString();
  if (applySynopsisRule(deps.repo, hash, at())) return null;
  const carrier = deps.repo.synopsisText(hash);
  if (!carrier) return null;
  try {
    const answer = await deps.classify(carrier);
    deps.repo.transaction(() => {
      deps.repo.saveSynopsisJudgment(hash, { model: answer.model, usable: answer.usable, kind: answer.kind, askedAt: at() });
      deps.repo.clearJevRejection("synopses", hash);
    });
    return null;
  } catch (error) {
    const kind = failureKind(error);
    if (kind === "book") {
      deps.repo.recordJevRejection({ task: "synopses", subject: hash, ...strikeReason(error), at: at() });
      return null;
    }
    if (kind === "budget") return nextUtcMidnight(deps.now());
    if (kind === "outage") return deps.now() + OUTAGE_PAUSE_MS;
    if (kind === "key") {
      deps.alert("TypeSafe rejected the synopsis requests", "TypeSafe answered 401, so synopsis checks are paused for a day. Check TYPESAFE_API_KEY.");
      return deps.now() + KEY_PAUSE_MS;
    }
    throw error;
  }
}

function heldCanonical(deps: HeldDeps): Set<string> {
  return new Set(deps.repo.canonicalWorkIds(deps.heldWorkIds()).values());
}

export async function judgeWorkSynopses(deps: HeldDeps, workId: string): Promise<number | null> {
  const canonical = deps.repo.canonicalWorkIds([workId]).get(workId);
  if (!canonical || !heldCanonical(deps).has(canonical)) return null;
  for (const hash of deps.repo.synopsesNeedingJudgment([canonical], WORK_TEXT_LIMIT, JEV_REJECTION_LIMIT)) {
    const pause = await classifyText(deps, hash);
    if (pause !== null) return pause;
  }
  return null;
}

export function startSynopsisJobs(deps: HeldDeps & { onError: (error: unknown, workId?: string) => void }): SynopsisJobs {
  let quietUntil = 0;
  const alert = (subject: string, text: string) => {
    if (deps.now() < quietUntil) return;
    quietUntil = deps.now() + KEY_PAUSE_MS;
    deps.alert(subject, text);
  };
  const judged = { ...deps, alert };
  const queue = createWorkQueue({ concurrency: SYNOPSIS_IN_FLIGHT, now: deps.now, run: (workId) => judgeWorkSynopses(judged, workId), onError: deps.onError });
  const stopSweep = startDetailsBackfill(
    async () => {
      for (const workId of deps.repo.worksNeedingSynopsisJudgment([...heldCanonical(deps)], SWEEP_LIMIT, JEV_REJECTION_LIMIT)) queue.add(workId);
      return null;
    },
    (error) => deps.onError(error),
    SWEEP_INTERVAL_MS
  );
  return {
    add: (workId) => queue.add(workId),
    stop: () => {
      stopSweep();
      queue.stop();
    }
  };
}

export function startSynopsisJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startSynopsisJobs>[0], "classify">): SynopsisJobs | null {
  if (apiKey === "") return null;
  return startSynopsisJobs({ ...deps, classify: createJevSynopsisClassifier(apiKey, dailySpend(deps.repo, SYNOPSIS_SOURCE, SYNOPSIS_DAILY_BUDGET, deps.now)) });
}
```

In `plugin.ts`:
- Add `import { startSynopsisJobsIfConfigured } from "./synopsisJudgments.js";`.
- Right before `const genreJobs = …`, add the shared alert:

```ts
  const alertTypesafe = (subject: string, text: string) => {
    app.log.warn({ subject }, text);
    options.alert?.(subject, text).catch((error: unknown) => app.log.error({ err: error }, "TypeSafe key alert failed"));
  };
```

- Replace the inline `alert: (subject, text) => { … }` in the `genreJobs` deps with `alert: alertTypesafe,`.
- After `genreJobs`, add:

```ts
  const synopsisJobs = heldWorks
    ? startSynopsisJobsIfConfigured(env.TYPESAFE_API_KEY, {
        repo,
        heldWorkIds: () => heldWorks().map((work) => work.workId),
        now: Date.now,
        alert: alertTypesafe,
        onError: (error, workId) => app.log.error({ err: error, workId }, "synopsis judgment failed")
      })
    : null;
```

- Replace the `onDetailsChecked` line in the `createBooksService({ … })` deps with:

```ts
    onDetailsChecked: (book) => {
      if (!book.work_id) return;
      genreJobs?.add(book.work_id);
      synopsisJobs?.add(book.work_id);
    },
```

- In `onClose`, add `synopsisJobs?.stop();` after `genreJobs?.stop();`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS, including `genreJudgments.test.ts` unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/typesafe.ts backend/src/modules/books/genreJudgments.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/synopsisJudgments.ts backend/src/modules/books/synopsisJudgments.test.ts backend/src/modules/books/plugin.ts backend/package.json && git commit -m "$(cat <<'EOF'
Judge the synopses of held books in the background

A finished details lookup adds the book's work to a synopsis queue, the
same hook the genre queue uses, and a daily sweep catches what the
queue missed. Each unjudged text goes through the 40-letter rule first;
only text that passes it spends from the synopses budget, 1,000 a day.
Failures follow the genre work's rules: a strike per unusable answer,
three strikes and the text is left alone, pauses for outages, the
budget and a rejected key. strikeReason moves to typesafe.ts so both
jobs share it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The synopsis backlog script

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Create: `backend/src/modules/books/synopsisBacklog.ts`
- Create: `backend/src/modules/books/synopsisBacklog.test.ts`. Add `src/modules/books/synopsisBacklog.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/synopsisJudgments.test.ts`.
- Create: `backend/scripts/synopsis-backlog.mjs`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes:
  - `applySynopsisRule`, `classifyText`, `JEV_REJECTION_LIMIT` and `SynopsisJudgmentDeps` (Task 5);
  - `runBudget`, `failureKind` and `FailureKind` (genre plans).
- Produces, repo: `synopsisBacklog(rejectionLimit: number): Array<{ hash: string; workId: string | null; source: string | null; createdAt: string }>`. It returns one row per carrier (edition or work) of every text with no judgment and fewer than `rejectionLimit` strikes, oldest first. Work rows report source `openlibrary`.
- Produces, `synopsisBacklog.ts`:
  - `SYNOPSIS_BACKLOG_SOURCE = "synopses-backlog"`
  - `type BacklogText = { hash: string; source: string }`
  - `synopsisBacklogTexts(repo, heldWorkIds: string[]): BacklogText[]`: held texts first, then oldest.
  - `synopsisDryRun(repo, texts: BacklogText[], max: number)`
  - `applyRulePass(repo, texts: BacklogText[], at: string): BacklogText[]`: returns the texts the rule didn't settle.
  - `runSynopsisBacklog(deps: SynopsisJudgmentDeps, hashes: string[]): Promise<{ asked: string[]; stoppedBy: "done" | "budget" | "outage" | "key" }>`
  - `synopsisBacklogReport(repo, texts: BacklogText[], stoppedBy, requests: number)`

- [ ] **Step 1: Write the failing tests**

`backend/src/modules/books/synopsisBacklog.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "synopsis-backlog-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { runBudget } = await import("./typesafe.js");
const { applyRulePass, runSynopsisBacklog, synopsisBacklogReport, synopsisBacklogTexts, synopsisDryRun, SYNOPSIS_BACKLOG_SOURCE } = await import("./synopsisBacklog.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const LONG = (n: number) => `Synopsis number ${n}: a long description of what the book is about and its people.`;

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function seed(repo: Repo, isbn: string, summary: string, source: "publisher" | "isbndb", createdAt: string) {
  const book = repo.createBook({ title: `Book ${isbn}`, author: "Author", isbn }, [`isbn:${isbn}`], createdAt);
  repo.mergeDetails(book.id, { summary, pages: null, year: null, publisher: null, translator: null }, source);
  return repo.getBook(book.id)!;
}

test("texts held by a library come first, then oldest, each text once", () => {
  const repo = freshRepo();
  const old = seed(repo, "9789720000051", LONG(1), "publisher", "2026-01-01T00:00:00.000Z");
  const held = seed(repo, "9789720000052", LONG(2), "isbndb", "2026-05-01T00:00:00.000Z");
  seed(repo, "9789720000053", LONG(1), "publisher", "2026-06-01T00:00:00.000Z");
  repo.saveSynopsisJudgment(seed(repo, "9789720000054", LONG(4), "publisher", "2026-02-01T00:00:00.000Z").summary_hash!, { model: "manual", usable: 1, kind: "synopsis", askedAt: "2026-10-01T00:00:00.000Z" });
  assert.deepEqual(synopsisBacklogTexts(repo, [held.work_id!]), [
    { hash: held.summary_hash!, source: "isbndb" },
    { hash: old.summary_hash!, source: "publisher" }
  ]);
});

test("the dry run counts what the rule would catch and writes nothing", () => {
  const repo = freshRepo();
  const fragment = seed(repo, "9789720000055", "Text: Portugese", "isbndb", "2026-01-01T00:00:00.000Z");
  seed(repo, "9789720000056", LONG(6), "publisher", "2026-01-02T00:00:00.000Z");
  const texts = synopsisBacklogTexts(repo, []);
  assert.deepEqual(synopsisDryRun(repo, texts, 10), { selected: 2, byRule: 1, wouldAsk: 1, max: 10, bySource: { isbndb: { texts: 1, rule: 1 }, publisher: { texts: 1, rule: 0 } } });
  assert.equal(repo.synopsisJudgments([fragment.summary_hash!]).size, 0);
});

test("the rule pass settles fragments without TypeSafe and hands back the rest", () => {
  const repo = freshRepo();
  const fragment = seed(repo, "9789720000057", "Text: Portugese", "isbndb", "2026-01-01T00:00:00.000Z");
  const long = seed(repo, "9789720000058", LONG(8), "publisher", "2026-01-02T00:00:00.000Z");
  const remaining = applyRulePass(repo, synopsisBacklogTexts(repo, []), "2026-10-15T12:00:00.000Z");
  assert.deepEqual(remaining.map((text) => text.hash), [long.summary_hash]);
  assert.equal(repo.synopsisJudgments([fragment.summary_hash!]).get(fragment.summary_hash!)?.model, "rule");
});

test("the Jev pass stops at --max, records usage under its own source, and the report counts by source", async () => {
  const repo = freshRepo();
  const books = [1, 2, 3].map((n) => seed(repo, `978972000006${n}`, LONG(n), "publisher", `2026-01-0${n}T00:00:00.000Z`));
  const texts = synopsisBacklogTexts(repo, []);
  const budget = runBudget(repo, SYNOPSIS_BACKLOG_SOURCE, 2, () => NOW);
  const answers = [0.1, 0.4];
  const result = await runSynopsisBacklog(
    {
      repo,
      classify: async () => {
        budget.spend();
        return { usable: answers.shift()!, kind: "praise", model: "jev-1.13.0" };
      },
      now: () => NOW,
      alert: () => {}
    },
    texts.map((text) => text.hash)
  );
  assert.equal(result.stoppedBy, "budget");
  assert.equal(result.asked.length, 2);
  assert.equal(budget.used(), 2);
  assert.equal(repo.typesafeUsage("2026-10-15", SYNOPSIS_BACKLOG_SOURCE), 2);
  const report = synopsisBacklogReport(repo, texts, result.stoppedBy, budget.used());
  assert.deepEqual(report.bySource, { publisher: { texts: 3, rule: 0, hidden: 1, doubtful: 1, shown: 0 } });
  assert.equal(report.requests, 2);
  assert.equal(repo.synopsisJudgments([books[2]!.summary_hash!]).size, 0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `./synopsisBacklog.js` doesn't exist.

- [ ] **Step 3: Implement**

In `domain/ports.ts`, add after `synopsisText(...)`:

```ts
  synopsisBacklog(rejectionLimit: number): Array<{ hash: string; workId: string | null; source: string | null; createdAt: string }>;
```

In `sqliteBooksRepository.ts`, add after `synopsisWorkCarrierStmt`:

```ts
  const synopsisBacklogStmt = db.prepare(`
    SELECT t.hash AS hash, COALESCE(w.merged_into, w.id) AS work_id, t.source AS source, t.created_at AS created_at
    FROM (
      SELECT summary_hash AS hash, work_id, summary_source AS source, created_at, rowid AS ord FROM books WHERE summary_hash IS NOT NULL
      UNION ALL
      SELECT summary_hash, id, 'openlibrary', created_at, rowid FROM works WHERE summary_hash IS NOT NULL
    ) AS t
    LEFT JOIN works w ON w.id = t.work_id
    WHERE NOT EXISTS (SELECT 1 FROM synopsis_judgments j WHERE j.text_hash = t.hash)
      AND NOT EXISTS (SELECT 1 FROM jev_rejections r WHERE r.task = 'synopses' AND r.subject = t.hash AND r.attempts >= ?)
    ORDER BY t.created_at, t.ord
  `);
```

And after `synopsisText`:

```ts
    synopsisBacklog(rejectionLimit) {
      return (synopsisBacklogStmt.all(rejectionLimit) as Array<{ hash: string; work_id: string | null; source: string | null; created_at: string }>).map((row) => ({ hash: row.hash, workId: row.work_id, source: row.source, createdAt: row.created_at }));
    },
```

Create `backend/src/modules/books/synopsisBacklog.ts`:

```ts
import type { ClassifySynopsis } from "./adapters/typesafe/jevSynopsis.js";
import type { BooksRepository } from "./domain/ports.js";
import { isFragment, isHiddenSynopsis, SYNOPSIS_REVIEW_BELOW } from "./domain/synopsis.js";
import { applySynopsisRule, classifyText, JEV_REJECTION_LIMIT, type SynopsisJudgmentDeps } from "./synopsisJudgments.js";
import { failureKind, type FailureKind } from "./typesafe.js";

export const SYNOPSIS_BACKLOG_SOURCE = "synopses-backlog";
const IN_FLIGHT = 4;
const COST_PER_REQUEST_USD = 0.00012;

export type BacklogText = { hash: string; source: string };
export type SynopsisBacklogStop = "done" | "budget" | "outage" | "key";
export type SourceCounts = { texts: number; rule: number; hidden: number; doubtful: number; shown: number };
export type SynopsisBacklogReport = { selected: number; bySource: Record<string, SourceCounts>; strikes: number; stoppedBy: SynopsisBacklogStop | "no-key"; requests: number; estimatedCostUsd: number };

export function synopsisBacklogTexts(repo: Pick<BooksRepository, "canonicalWorkIds" | "synopsisBacklog">, heldWorkIds: string[]): BacklogText[] {
  const held = new Set(repo.canonicalWorkIds(heldWorkIds).values());
  const texts = new Map<string, { source: string; held: boolean }>();
  for (const row of repo.synopsisBacklog(JEV_REJECTION_LIMIT)) {
    const isHeld = row.workId !== null && held.has(row.workId);
    const seen = texts.get(row.hash);
    if (seen) seen.held ||= isHeld;
    else texts.set(row.hash, { source: row.source ?? "unknown", held: isHeld });
  }
  const all = [...texts].map(([hash, text]) => ({ hash, source: text.source, held: text.held }));
  return [...all.filter((text) => text.held), ...all.filter((text) => !text.held)].map(({ hash, source }) => ({ hash, source }));
}

export function synopsisDryRun(repo: Pick<BooksRepository, "synopsisText">, texts: BacklogText[], max: number) {
  const bySource: Record<string, { texts: number; rule: number }> = {};
  let byRule = 0;
  for (const text of texts) {
    const counts = (bySource[text.source] ??= { texts: 0, rule: 0 });
    counts.texts += 1;
    const carrier = repo.synopsisText(text.hash);
    if (carrier && isFragment(carrier.text)) {
      counts.rule += 1;
      byRule += 1;
    }
  }
  return { selected: texts.length, byRule, wouldAsk: Math.min(texts.length - byRule, max), max, bySource };
}

export function applyRulePass(repo: Pick<BooksRepository, "synopsisText" | "saveSynopsisJudgment">, texts: BacklogText[], at: string): BacklogText[] {
  return texts.filter((text) => !applySynopsisRule(repo, text.hash, at));
}

export async function runSynopsisBacklog(deps: SynopsisJudgmentDeps, hashes: string[]): Promise<{ asked: string[]; stoppedBy: SynopsisBacklogStop }> {
  let lastFailure: FailureKind | null = null;
  const classify: ClassifySynopsis = async (input) => {
    try {
      return await deps.classify(input);
    } catch (error) {
      lastFailure = failureKind(error);
      throw error;
    }
  };
  const asked: string[] = [];
  let stoppedBy: SynopsisBacklogStop = "done";
  let next = 0;
  const worker = async () => {
    while (stoppedBy === "done" && next < hashes.length) {
      const hash = hashes[next++]!;
      const pause = await classifyText({ ...deps, classify }, hash);
      if (pause === null) asked.push(hash);
      else if (stoppedBy === "done") stoppedBy = lastFailure === "budget" || lastFailure === "key" ? lastFailure : "outage";
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  return { asked, stoppedBy };
}

export function synopsisBacklogReport(repo: Pick<BooksRepository, "synopsisJudgments" | "jevRejections">, texts: BacklogText[], stoppedBy: SynopsisBacklogStop | "no-key", requests: number): SynopsisBacklogReport {
  const hashes = texts.map((text) => text.hash);
  const judgments = repo.synopsisJudgments(hashes);
  const bySource: Record<string, SourceCounts> = {};
  for (const text of texts) {
    const counts = (bySource[text.source] ??= { texts: 0, rule: 0, hidden: 0, doubtful: 0, shown: 0 });
    counts.texts += 1;
    const judgment = judgments.get(text.hash);
    if (!judgment) continue;
    if (judgment.model === "rule") counts.rule += 1;
    else if (isHiddenSynopsis(judgment)) counts.hidden += 1;
    else if (judgment.usable < SYNOPSIS_REVIEW_BELOW) counts.doubtful += 1;
    else counts.shown += 1;
  }
  return { selected: texts.length, bySource, strikes: repo.jevRejections("synopses", hashes).size, stoppedBy, requests, estimatedCostUsd: Number((requests * COST_PER_REQUEST_USD).toFixed(2)) };
}
```

Create `backend/scripts/synopsis-backlog.mjs`:

```js
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { max: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
const max = Number(values.max);
if (!Number.isInteger(max) || max <= 0) {
  console.error("Usage: node scripts/synopsis-backlog.mjs --max N [--dry-run]");
  process.exit(1);
}
for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");
const { applyRulePass, runSynopsisBacklog, synopsisBacklogReport, synopsisBacklogTexts, synopsisDryRun, SYNOPSIS_BACKLOG_SOURCE } = await import("../dist/modules/books/synopsisBacklog.js");

const repo = createSqliteBooksRepository(openBooksDb());
const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks().map((work) => work.workId);
const texts = synopsisBacklogTexts(repo, held);

if (values["dry-run"]) {
  console.log(JSON.stringify(synopsisDryRun(repo, texts, max), null, 2));
} else {
  const remaining = applyRulePass(repo, texts, new Date().toISOString());
  if (!process.env.TYPESAFE_API_KEY) {
    console.log(JSON.stringify(synopsisBacklogReport(repo, texts, "no-key", 0), null, 2));
    console.error("TYPESAFE_API_KEY is not set: the rule pass ran and the Jev pass was skipped.");
  } else {
    const { createJevSynopsisClassifier } = await import("../dist/modules/books/adapters/typesafe/jevSynopsis.js");
    const { runBudget } = await import("../dist/modules/books/typesafe.js");
    const budget = runBudget(repo, SYNOPSIS_BACKLOG_SOURCE, max, Date.now);
    const result = await runSynopsisBacklog(
      { repo, classify: createJevSynopsisClassifier(process.env.TYPESAFE_API_KEY, budget.spend), now: Date.now, alert: (subject, text) => console.error(`${subject}: ${text}`) },
      remaining.map((text) => text.hash)
    );
    console.log(JSON.stringify(synopsisBacklogReport(repo, texts, result.stoppedBy, budget.used()), null, 2));
  }
}
```

In `backend/README.md`, add a "Synopsis backlog" section right after the genre backlog section. It covers:
- The command, run in the production container (`/app/backend`) over `railway ssh`, like the genre backlog: dry run first, `node scripts/synopsis-backlog.mjs --max N --dry-run`, then the same command without `--dry-run`, with `--max` at the dry run's `wouldAsk`.
- Before running:
  - check the volume's free space (`railway volume list --json`);
  - hold merges to main, because a deploy kills `railway ssh` jobs.
- Without `TYPESAFE_API_KEY`, only the rule pass runs.
- The report's fields.

- [ ] **Step 4: Run to verify they pass, then smoke-test the script**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

Run this dry-run smoke test. It makes no TypeSafe call and needs no key:

```bash
npm run build --workspace backend && (cd backend && D=$(mktemp -d) && COVERS_DB_PATH=$D/covers.sqlite AUTH_DB_PATH=$D/auth.sqlite LIBRARY_DB_PATH=$D/library.sqlite GALLERY_DB_PATH=$D/gallery.sqlite JWT_ACCESS_SECRET=$(printf 'a%.0s' {1..64}) JWT_REFRESH_SECRET=$(printf 'b%.0s' {1..64}) node scripts/synopsis-backlog.mjs --max 10 --dry-run)
```

- Expected: `{ "selected": 0, "byRule": 0, "wouldAsk": 0, "max": 10, "bySource": {} }`.
- If opening the library database read-only fails because it doesn't exist yet, create it first the way the genre backlog's smoke run did, and report what you did.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/synopsisBacklog.ts backend/src/modules/books/synopsisBacklog.test.ts backend/scripts/synopsis-backlog.mjs backend/README.md backend/package.json && git commit -m "$(cat <<'EOF'
Add the owner-run synopsis backlog script

The catalog's ~20,000 existing summaries are checked once, held books
first: the 40-letter rule runs over all of them with no TypeSafe call,
then Jev judges the rest, 4 in flight, until --max requests under the
synopses-backlog source. Without a key only the rule pass runs. The dry
run counts texts and rule hits per summary source and writes nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The review list and its endpoints

**Files:**
- Create: `packages/shared/src/works/synopsisReview.ts`
- Create: `packages/shared/src/works/synopsisReview.test.ts`
- Modify: `packages/shared/src/works/index.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Create: `backend/src/modules/books/synopsisReview.ts`
- Create: `backend/src/modules/books/synopsisReview.test.ts`. Add `src/modules/books/synopsisReview.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/genreReview.test.ts`.
- Modify: `backend/src/modules/books/routes.ts`
- Test: `backend/src/modules/books/routes.test.ts`
- Modify: `backend/src/modules/books/plugin.ts`

**Interfaces:**
- Consumes:
  - `isHiddenSynopsis`, `SYNOPSIS_REVIEW_BELOW` (Task 1); `synopsisJudgments`, `saveSynopsisJudgment` (Task 2); `synopsisText` (Task 5);
  - `HeldWork` (`genrePass.ts`), `BookNotFoundError`, `coverUrlFor(imageId, "thumb")`;
  - the genre review routes' 300-a-minute scope in `plugin.ts`.
- Produces, shared:
  - `type SynopsisReviewGroup = "hidden" | "doubtful"`
  - `SYNOPSIS_REVIEW_GROUPS`, `SYNOPSIS_REVIEW_HEADINGS`
  - `type SynopsisReviewItem`, `type SynopsisReview = { items: SynopsisReviewItem[]; total: number }`, `type SynopsisDecision = "keep" | "hide"`
  - `synopsisEvidenceLabel(item: Pick<SynopsisReviewItem, "model" | "kind" | "usable">): string`
  - `withoutSynopsis(review: SynopsisReview, hash: string): SynopsisReview`
- Produces, repo:
  - `flaggedSynopses(reviewBelow: number): Array<{ hash: string; model: string; usable: number; kind: SynopsisKind }>`
  - `synopsisCarriers(hashes: string[]): Array<{ hash: string; workId: string | null; title: string; author: string; coverImageId: string | null; source: string | null; text: string; isEdition: boolean }>`, oldest first.
- Produces, backend:
  - `SYNOPSIS_REVIEW_LIMIT = 200`
  - `synopsisReviewWith(books: BooksRepository, held: HeldWork[], coverUrl: (imageId: string) => string): SynopsisReview`
  - `reviewSynopsisWith(books: BooksRepository, hash: string, decision: SynopsisDecision, now: () => number): { hash: string }`
  - `buildSynopsisReviewRoutes(deps: { isAdmin: (userId: string) => boolean; review: () => SynopsisReview; decide: (hash: string, decision: SynopsisDecision) => { hash: string } })`
- Routes:
  - `GET /books/synopsis-review` returns `{ items, total }`.
  - `POST /books/synopsis-review/:hash` takes `{ decision: "keep" | "hide" }`. It answers 200 with `{ hash }`, 400, 403 or 404.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/works/synopsisReview.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { synopsisEvidenceLabel, withoutSynopsis, type SynopsisReview } from "./synopsisReview.js";

test("the evidence names the rule, or Jev's kind and probability", () => {
  assert.equal(synopsisEvidenceLabel({ model: "rule", kind: "fragment", usable: 0 }), "Rule: under 40 letters");
  assert.equal(synopsisEvidenceLabel({ model: "jev-1.13.0", kind: "praise", usable: 0.123 }), "Jev: praise (0.12)");
  assert.equal(synopsisEvidenceLabel({ model: "jev-1.13.0", kind: "author_bio", usable: 0.41 }), "Jev: author bio (0.41)");
});

test("withoutSynopsis drops one item and the total, and leaves an unknown hash alone", () => {
  const item = (hash: string) => ({ hash, title: "T", author: "A", coverUrl: null, editions: 1, works: 1, source: "publisher", text: "x", holders: 0, finished: false, group: "hidden" as const, model: "rule", kind: "fragment", usable: 0 });
  const review: SynopsisReview = { items: [item("a"), item("b")], total: 5 };
  assert.deepEqual(withoutSynopsis(review, "a"), { items: [item("b")], total: 4 });
  assert.equal(withoutSynopsis(review, "z"), review);
});
```

`backend/src/modules/books/synopsisReview.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "synopsis-review-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { BookNotFoundError } = await import("./domain/errors.js");
const { reviewSynopsisWith, synopsisReviewWith, SYNOPSIS_REVIEW_LIMIT } = await import("./synopsisReview.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const AT = "2026-10-15T12:00:00.000Z";

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function seed(repo: Repo, isbn: string, title: string, summary: string) {
  const book = repo.createBook({ title, author: "Author", isbn }, [`isbn:${isbn}`], AT);
  repo.mergeDetails(book.id, { summary, pages: null, year: null, publisher: null, translator: null }, "publisher");
  return repo.getBook(book.id)!;
}

const judge = (repo: Repo, hash: string, model: string, usable: number, kind: "praise" | "fragment" | "synopsis" = "praise") =>
  repo.saveSynopsisJudgment(hash, { model, usable, kind, askedAt: AT });

test("hidden and doubtful texts are listed, finished and most-held first; kept, shown and manual ones are not", () => {
  const repo = freshRepo();
  const hidden = seed(repo, "9789720000071", "Zeta", "Praise for the author, in quotes, again and again and again.");
  const rule = seed(repo, "9789720000072", "Alpha", "Text: Portugese");
  const doubtful = seed(repo, "9789720000073", "Beta", "Mostly the author's life story, with a line about the book.");
  const shown = seed(repo, "9789720000074", "Gamma", "A long description of what the book is about, its story and people.");
  const manual = seed(repo, "9789720000075", "Delta", "Praise that the owner chose to keep, again and again and again.");
  judge(repo, hidden.summary_hash!, "jev-1.13.0", 0.12);
  judge(repo, rule.summary_hash!, "rule", 0, "fragment");
  judge(repo, doubtful.summary_hash!, "jev-1.13.0", 0.41);
  judge(repo, shown.summary_hash!, "jev-1.13.0", 0.8, "synopsis");
  judge(repo, manual.summary_hash!, "manual", 1);
  const review = synopsisReviewWith(repo, [{ workId: hidden.work_id!, holders: 1, finished: true }, { workId: doubtful.work_id!, holders: 3, finished: false }], (id) => `thumb:${id}`);
  assert.equal(review.total, 3);
  assert.deepEqual(review.items.map((item) => [item.title, item.group, item.holders, item.finished]), [
    ["Zeta", "hidden", 1, true],
    ["Beta", "doubtful", 3, false],
    ["Alpha", "hidden", 0, false]
  ]);
  assert.equal(review.items[0]!.source, "publisher");
  assert.equal(review.items[0]!.editions, 1);
});

test("a text on several editions is one item, and the list keeps at most 200 with the full total", () => {
  const repo = freshRepo();
  const text = "Praise for the author, in quotes, again and again and again.";
  const a = seed(repo, "9789720000076", "Shared", text);
  seed(repo, "9789720000077", "Shared again", text);
  judge(repo, a.summary_hash!, "jev-1.13.0", 0.1);
  assert.deepEqual(synopsisReviewWith(repo, [], (id) => id).items.map((item) => [item.title, item.editions]), [["Shared", 2]]);
  for (let n = 0; n < SYNOPSIS_REVIEW_LIMIT; n++) judge(repo, seed(repo, `978973${String(n).padStart(7, "0")}`, `Book ${n}`, `${text} ${n}`).summary_hash!, "jev-1.13.0", 0.1);
  const big = synopsisReviewWith(repo, [], (id) => id);
  assert.equal(big.items.length, SYNOPSIS_REVIEW_LIMIT);
  assert.equal(big.total, SYNOPSIS_REVIEW_LIMIT + 1);
});

test("keep and hide store a manual judgment; an unknown hash is not found", () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000078", "Kept", "Praise for the author, in quotes, again and again and again.");
  judge(repo, book.summary_hash!, "jev-1.13.0", 0.1);
  assert.deepEqual(reviewSynopsisWith(repo, book.summary_hash!, "keep", () => Date.parse(AT)), { hash: book.summary_hash });
  assert.deepEqual(repo.synopsisJudgments([book.summary_hash!]).get(book.summary_hash!), { model: "manual", usable: 1, kind: "praise", askedAt: AT });
  assert.equal(synopsisReviewWith(repo, [], (id) => id).total, 0);
  reviewSynopsisWith(repo, book.summary_hash!, "hide", () => Date.parse(AT));
  assert.equal(repo.synopsisJudgments([book.summary_hash!]).get(book.summary_hash!)?.usable, 0);
  assert.throws(() => reviewSynopsisWith(repo, "f".repeat(40), "keep", () => Date.parse(AT)), BookNotFoundError);
});
```

In `routes.test.ts`:
- Add `buildSynopsisReviewRoutes` to the `./routes.js` import.
- Add `const { BookNotFoundError } = await import("./domain/errors.js");` if it isn't imported yet.
- Append:

```ts
async function callSynopsisReview(options: InjectOptions, signedInAs?: string, decide: (hash: string, decision: "keep" | "hide") => { hash: string } = (hash) => ({ hash })) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null));
  await app.register(buildSynopsisReviewRoutes({ isAdmin: (userId) => userId === "admin", review: () => ({ items: [], total: 0 }), decide }));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return res;
}

test("the synopsis review is the admin's only", async () => {
  const hash = "a".repeat(40);
  assert.equal((await callSynopsisReview({ method: "GET", url: "/books/synopsis-review" })).statusCode, 401);
  assert.equal((await callSynopsisReview({ method: "GET", url: "/books/synopsis-review" }, "reader")).statusCode, 403);
  assert.equal((await callSynopsisReview({ method: "POST", url: `/books/synopsis-review/${hash}`, payload: { decision: "keep" } }, "reader")).statusCode, 403);
  const listed = await callSynopsisReview({ method: "GET", url: "/books/synopsis-review" }, "admin");
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), { items: [], total: 0 });
});

test("a synopsis decision needs a hash and keep or hide, and maps not found", async () => {
  const hash = "a".repeat(40);
  for (const [url, payload] of [[`/books/synopsis-review/${hash}`, { decision: "maybe" }], [`/books/synopsis-review/${hash}`, {}], [`/books/synopsis-review/${hash}`, { decision: "keep", extra: true }], ["/books/synopsis-review/not-a-hash", { decision: "keep" }]] as const) {
    assert.equal((await callSynopsisReview({ method: "POST", url, payload }, "admin")).statusCode, 400, `${url} ${JSON.stringify(payload)}`);
  }
  const saved = await callSynopsisReview({ method: "POST", url: `/books/synopsis-review/${hash}`, payload: { decision: "hide" } }, "admin");
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json(), { hash });
  const missing = await callSynopsisReview({ method: "POST", url: `/books/synopsis-review/${hash}`, payload: { decision: "keep" } }, "admin", () => { throw new BookNotFoundError(); });
  assert.equal(missing.statusCode, 404);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace @scripta/shared && npm run typecheck --workspace backend`
Expected: FAIL. `./synopsisReview.js` doesn't exist, in shared or in backend.

- [ ] **Step 3: Implement**

Create `packages/shared/src/works/synopsisReview.ts`:

```ts
export type SynopsisReviewGroup = "hidden" | "doubtful";

export const SYNOPSIS_REVIEW_GROUPS: SynopsisReviewGroup[] = ["hidden", "doubtful"];

export const SYNOPSIS_REVIEW_HEADINGS: Record<SynopsisReviewGroup, string> = {
  hidden: "Hidden from readers",
  doubtful: "Shown, but doubtful"
};

export type SynopsisReviewItem = {
  hash: string;
  title: string;
  author: string;
  coverUrl: string | null;
  editions: number;
  works: number;
  source: string | null;
  text: string;
  holders: number;
  finished: boolean;
  group: SynopsisReviewGroup;
  model: string;
  kind: string;
  usable: number;
};

export type SynopsisReview = { items: SynopsisReviewItem[]; total: number };

export type SynopsisDecision = "keep" | "hide";

const KIND_LABELS: Record<string, string> = {
  synopsis: "synopsis",
  author_bio: "author bio",
  praise: "praise",
  collection: "collection",
  product: "product",
  contents: "contents",
  other_book: "other book",
  fragment: "fragment"
};

export function synopsisEvidenceLabel(item: Pick<SynopsisReviewItem, "model" | "kind" | "usable">): string {
  if (item.model === "rule") return "Rule: under 40 letters";
  return `Jev: ${KIND_LABELS[item.kind] ?? item.kind} (${item.usable.toFixed(2)})`;
}

export function withoutSynopsis(review: SynopsisReview, hash: string): SynopsisReview {
  const items = review.items.filter((item) => item.hash !== hash);
  return items.length === review.items.length ? review : { items, total: review.total - 1 };
}
```

In `packages/shared/src/works/index.ts`, add `export * from "./synopsisReview.js";`.

In `domain/ports.ts`, add after `synopsisBacklog(...)`:

```ts
  flaggedSynopses(reviewBelow: number): Array<{ hash: string; model: string; usable: number; kind: SynopsisKind }>;
  synopsisCarriers(hashes: string[]): Array<{ hash: string; workId: string | null; title: string; author: string; coverImageId: string | null; source: string | null; text: string; isEdition: boolean }>;
```

Import `SynopsisKind` there with `SynopsisJudgment`: `import type { SynopsisJudgment, SynopsisKind } from "./synopsis.js";`.

In `sqliteBooksRepository.ts`, add after `synopsisBacklogStmt`:

```ts
  const flaggedSynopsesStmt = db.prepare(`SELECT text_hash, model, usable, kind FROM synopsis_judgments WHERE model = 'rule' OR (model <> 'manual' AND usable < ?)`);
  const synopsisCarriersStmt = db.prepare(`
    SELECT b.summary_hash AS hash, COALESCE(w.merged_into, w.id) AS work_id, b.title AS title, b.author AS author, b.cover_image_id AS cover_image_id, b.summary_source AS source, b.summary AS text, 1 AS is_edition, b.created_at AS created_at, b.rowid AS ord
    FROM books b LEFT JOIN works w ON w.id = b.work_id
    WHERE b.summary_hash IN (SELECT value FROM json_each(?))
    UNION ALL
    SELECT w.summary_hash, COALESCE(w.merged_into, w.id), w.title, w.author, NULL, 'openlibrary', w.summary, 0, w.created_at, w.rowid
    FROM works w
    WHERE w.summary_hash IN (SELECT value FROM json_each(?))
    ORDER BY created_at, ord
  `);
```

And after `synopsisBacklog`:

```ts
    flaggedSynopses(reviewBelow) {
      return (flaggedSynopsesStmt.all(reviewBelow) as Array<{ text_hash: string; model: string; usable: number; kind: SynopsisKind }>).map((row) => ({ hash: row.text_hash, model: row.model, usable: row.usable, kind: row.kind }));
    },
    synopsisCarriers(hashes) {
      const ids = JSON.stringify(hashes);
      return (synopsisCarriersStmt.all(ids, ids) as Array<{ hash: string; work_id: string | null; title: string; author: string; cover_image_id: string | null; source: string | null; text: string; is_edition: number }>).map((row) => ({
        hash: row.hash,
        workId: row.work_id,
        title: row.title,
        author: row.author,
        coverImageId: row.cover_image_id,
        source: row.source,
        text: row.text,
        isEdition: row.is_edition === 1
      }));
    },
```

Create `backend/src/modules/books/synopsisReview.ts`:

```ts
import type { SynopsisDecision, SynopsisReview, SynopsisReviewItem } from "@scripta/shared";
import { BookNotFoundError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { isHiddenSynopsis, SYNOPSIS_REVIEW_BELOW } from "./domain/synopsis.js";
import type { HeldWork } from "./genrePass.js";

export const SYNOPSIS_REVIEW_LIMIT = 200;
const TEXT_LIMIT = 600;

type Carrier = ReturnType<BooksRepository["synopsisCarriers"]>[number];

export function synopsisReviewWith(books: BooksRepository, held: HeldWork[], coverUrl: (imageId: string) => string): SynopsisReview {
  const flagged = books.flaggedSynopses(SYNOPSIS_REVIEW_BELOW);
  const carriers = new Map<string, Carrier[]>();
  for (const carrier of books.synopsisCarriers(flagged.map((judgment) => judgment.hash))) carriers.set(carrier.hash, [...(carriers.get(carrier.hash) ?? []), carrier]);
  const canonical = books.canonicalWorkIds(held.map((work) => work.workId));
  const holding = new Map<string, { holders: number; finished: boolean }>();
  for (const work of held) {
    const id = canonical.get(work.workId) ?? work.workId;
    const seen = holding.get(id);
    holding.set(id, { holders: (seen?.holders ?? 0) + work.holders, finished: (seen?.finished ?? false) || work.finished });
  }
  const listed = flagged.flatMap((judgment): SynopsisReviewItem[] => {
    const own = carriers.get(judgment.hash) ?? [];
    const first = own[0];
    if (!first) return [];
    const works = [...new Set(own.flatMap((carrier) => (carrier.workId ? [carrier.workId] : [])))];
    const cover = own.find((carrier) => carrier.coverImageId)?.coverImageId ?? null;
    return [{
      hash: judgment.hash,
      title: first.title,
      author: first.author,
      coverUrl: cover ? coverUrl(cover) : null,
      editions: own.filter((carrier) => carrier.isEdition).length,
      works: works.length,
      source: first.source,
      text: first.text.slice(0, TEXT_LIMIT),
      holders: works.reduce((sum, id) => sum + (holding.get(id)?.holders ?? 0), 0),
      finished: works.some((id) => holding.get(id)?.finished ?? false),
      group: isHiddenSynopsis(judgment) ? "hidden" : "doubtful",
      model: judgment.model,
      kind: judgment.kind,
      usable: judgment.usable
    }];
  });
  listed.sort((a, b) => Number(b.finished) - Number(a.finished) || b.holders - a.holders || a.title.localeCompare(b.title));
  return { items: listed.slice(0, SYNOPSIS_REVIEW_LIMIT), total: listed.length };
}

export function reviewSynopsisWith(books: BooksRepository, hash: string, decision: SynopsisDecision, now: () => number): { hash: string } {
  if (!books.synopsisText(hash)) throw new BookNotFoundError();
  const previous = books.synopsisJudgments([hash]).get(hash);
  books.saveSynopsisJudgment(hash, { model: "manual", usable: decision === "keep" ? 1 : 0, kind: previous?.kind ?? (decision === "keep" ? "synopsis" : "fragment"), askedAt: new Date(now()).toISOString() });
  return { hash };
}
```

In `routes.ts`:
- Add `SynopsisDecision` and `SynopsisReview` to the `@scripta/shared` type import.
- Add these after the genre review schemas:

```ts
const SYNOPSES_FORBIDDEN = { error: "Only the admin can review synopses." };
const synopsisParamsSchema = z.object({ hash: z.string().regex(/^[0-9a-f]{40}$/) });
const synopsisDecisionSchema = z.object({ decision: z.enum(["keep", "hide"]) }).strict();
```

- Add this after `buildGenreReviewRoutes`:

```ts
export function buildSynopsisReviewRoutes(deps: {
  isAdmin: (userId: string) => boolean;
  review: () => SynopsisReview;
  decide: (hash: string, decision: SynopsisDecision) => { hash: string };
}) {
  return async function synopsisReviewRoutes(app: FastifyInstance) {
    app.get("/books/synopsis-review", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(SYNOPSES_FORBIDDEN);
      return reply.send(deps.review());
    });

    app.post("/books/synopsis-review/:hash", { preHandler: authGuard }, async (request, reply) => {
      if (!deps.isAdmin(request.user.id)) return reply.code(403).send(SYNOPSES_FORBIDDEN);
      const params = synopsisParamsSchema.safeParse(request.params);
      const body = synopsisDecisionSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "Send { decision: \"keep\" } or { decision: \"hide\" } for a synopsis hash." });
      try {
        return reply.send(deps.decide(params.data.hash, body.data.decision));
      } catch (error) {
        if (error instanceof BookNotFoundError) return reply.code(404).send({ error: "No such synopsis." });
        throw error;
      }
    });
  };
}
```

In `plugin.ts`:
- Add `buildSynopsisReviewRoutes` to the `./routes.js` import.
- Add `import { reviewSynopsisWith, synopsisReviewWith } from "./synopsisReview.js";`.
- Inside the `if (heldWorks) { … }` block, after `await scoped.register(buildGenreReviewRoutes({ … }));`, add:

```ts
      await scoped.register(buildSynopsisReviewRoutes({
        isAdmin: (userId) => service.isAdmin(userId),
        review: () => synopsisReviewWith(repo, heldWorks(), (imageId) => coverUrlFor(imageId, "thumb")),
        decide: (hash, decision) => reviewSynopsisWith(repo, hash, decision, Date.now)
      }));
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/works/synopsisReview.ts packages/shared/src/works/synopsisReview.test.ts packages/shared/src/works/index.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/synopsisReview.ts backend/src/modules/books/synopsisReview.test.ts backend/src/modules/books/routes.ts backend/src/modules/books/routes.test.ts backend/src/modules/books/plugin.ts backend/package.json && git commit -m "$(cat <<'EOF'
List hidden and doubtful synopses for the admin to keep or hide

GET /books/synopsis-review lists texts the rule or Jev hid (to restore
mistakes) and texts Jev doubted but still shows (to decide), one item
per text however many editions carry it, finished and most-held books
first, 200 at most with the full total. POST stores the owner's keep or
hide as a manual judgment, which nothing later overrides. Both routes
are admin-only and share the genre review's 300-a-minute scope.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The admin page

**Files:**
- Modify: `frontend/src/api/books.ts`
- Create: `frontend/src/components/SynopsisReviewList.tsx`
- Create: `frontend/src/pages/AdminSynopsesPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AdminLinks.tsx`
- Create: `frontend/scripts/test-admin-synopses.mts`

**Interfaces:**
- Consumes: the shared types and helpers from Task 7; `fetchIsAdmin`; the `["books-admin"]` query key; `NotFoundPage`.
- Produces:
  - `fetchSynopsisReview(): Promise<SynopsisReview>`
  - `reviewSynopsis(hash: string, decision: SynopsisDecision): Promise<{ hash: string }>`
  - `<SynopsisReviewList review onDecide />`, where `onDecide(hash, decision): Promise<void>` rejects with an `Error` whose message is shown on the row.
  - `AdminLinks` renders a link per admin page: Genre review, then Synopsis review.

- [ ] **Step 1: Write the failing test**

`frontend/scripts/test-admin-synopses.mts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { SynopsisReview } from "@scripta/shared";
import { AdminLinks } from "../src/components/AdminLinks";
import { SynopsisReviewList } from "../src/components/SynopsisReviewList";

const item = (hash: string, group: "hidden" | "doubtful", model: string, kind: string, usable: number) => ({ hash, title: `Title ${hash}`, author: "Author", coverUrl: null, editions: 2, works: 1, source: "publisher", text: "Praise for the author.", holders: 1, finished: true, group, model, kind, usable });
const review: SynopsisReview = {
  items: [item("r", "hidden", "rule", "fragment", 0), item("j", "hidden", "jev-1.13.0", "praise", 0.12), item("d", "doubtful", "jev-1.13.0", "author_bio", 0.41)],
  total: 3
};

const render = () => renderToString(createElement(SynopsisReviewList, { review, onDecide: async () => {} }));

test("each group shows its heading, count and evidence", () => {
  const html = render();
  for (const text of ["Hidden from readers (2)", "Shown, but doubtful (1)", "Rule: under 40 letters", "Jev: praise (0.12)", "Jev: author bio (0.41)", "2 editions", "Praise for the author."]) {
    assert.ok(html.includes(text), text);
  }
});

test("every row offers Keep and Hide", () => {
  const html = render();
  assert.equal(html.split(">Keep<").length - 1, 3);
  assert.equal(html.split(">Hide<").length - 1, 3);
});

test("the admin sees both review links, and nobody else sees any", () => {
  const links = (isAdmin: boolean) => renderToString(createElement(MemoryRouter, null, createElement(AdminLinks, { isAdmin })));
  assert.ok(links(true).includes('href="/admin/genres"'));
  assert.ok(links(true).includes('href="/admin/synopses"'));
  assert.equal(links(false), "");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build --workspace @scripta/shared && npm test --workspace frontend`
Expected: FAIL. `SynopsisReviewList` doesn't exist.

- [ ] **Step 3: Implement**

In `frontend/src/api/books.ts`, add `SynopsisDecision` and `SynopsisReview` to the `@scripta/shared` type import, and append:

```ts
export async function fetchSynopsisReview(): Promise<SynopsisReview> {
  return (await apiFetch("/books/synopsis-review")) as SynopsisReview;
}

export async function reviewSynopsis(hash: string, decision: SynopsisDecision): Promise<{ hash: string }> {
  return (await apiFetch(`/books/synopsis-review/${encodeURIComponent(hash)}`, { method: "POST", body: JSON.stringify({ decision }) })) as { hash: string };
}
```

Create `frontend/src/components/SynopsisReviewList.tsx`:

```tsx
import { useState } from "react";
import { SYNOPSIS_REVIEW_GROUPS, SYNOPSIS_REVIEW_HEADINGS, synopsisEvidenceLabel, type SynopsisDecision, type SynopsisReview, type SynopsisReviewItem } from "@scripta/shared";

function SynopsisReviewRow({ item, onDecide }: { item: SynopsisReviewItem; onDecide: (hash: string, decision: SynopsisDecision) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = (decision: SynopsisDecision) => {
    setBusy(true);
    setError(null);
    onDecide(item.hash, decision).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "That didn't save.");
      setBusy(false);
    });
  };
  const carriers = `${item.editions} ${item.editions === 1 ? "edition" : "editions"}${item.works > 1 ? ` · ${item.works} works` : ""}`;
  return (
    <li className="flex gap-3 border-b border-(--color-border) py-4">
      {item.coverUrl ? <img src={item.coverUrl} alt="" className="h-24 w-16 shrink-0 rounded object-cover" /> : <div className="h-24 w-16 shrink-0 rounded bg-(--color-surface-hover)" />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{item.title}</p>
        <p className="text-sm text-(--color-text-dim)">{item.author}</p>
        <p className="mt-1 text-xs text-(--color-text-dim)">{`${synopsisEvidenceLabel(item)} · ${item.source ?? "unknown source"} · ${carriers} · ${item.holders} ${item.holders === 1 ? "library" : "libraries"}${item.finished ? " · finished" : ""}`}</p>
        <p className="mt-2 whitespace-pre-line text-sm">{item.text}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => decide("keep")} className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-semibold text-(--color-on-accent) disabled:opacity-50">
            Keep
          </button>
          <button type="button" disabled={busy} onClick={() => decide("hide")} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm">
            Hide
          </button>
        </div>
        {error ? <p role="alert" className="mt-1 text-sm text-(--color-danger)">{error}</p> : null}
      </div>
    </li>
  );
}

export function SynopsisReviewList({ review, onDecide }: { review: SynopsisReview; onDecide: (hash: string, decision: SynopsisDecision) => Promise<void> }) {
  return (
    <div>
      <p className="text-sm text-(--color-text-dim)">{`${review.total} to review${review.total > review.items.length ? `, showing ${review.items.length}` : ""}`}</p>
      {SYNOPSIS_REVIEW_GROUPS.map((group) => {
        const items = review.items.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} className="mt-6">
            <h2 className="text-lg font-bold">{`${SYNOPSIS_REVIEW_HEADINGS[group]} (${items.length})`}</h2>
            <ul>
              {items.map((item) => (
                <SynopsisReviewRow key={item.hash} item={item} onDecide={onDecide} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
```

Create `frontend/src/pages/AdminSynopsesPage.tsx`:

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { withoutSynopsis, type SynopsisDecision, type SynopsisReview } from "@scripta/shared";
import { fetchIsAdmin, fetchSynopsisReview, reviewSynopsis } from "../api/books";
import { SynopsisReviewList } from "../components/SynopsisReviewList";
import { NotFoundPage } from "./NotFoundPage";

export function AdminSynopsesPage() {
  const client = useQueryClient();
  const { data: isAdmin, isPending } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity });
  const review = useQuery({ queryKey: ["synopsis-review"], queryFn: fetchSynopsisReview, enabled: isAdmin === true });
  if (isPending) return null;
  if (!isAdmin) return <NotFoundPage />;
  const decide = async (hash: string, decision: SynopsisDecision) => {
    await reviewSynopsis(hash, decision);
    client.setQueryData<SynopsisReview>(["synopsis-review"], (current) => (current ? withoutSynopsis(current, hash) : current));
  };
  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <h1 className="text-xl font-bold">Synopsis review</h1>
      {review.data ? <SynopsisReviewList review={review.data} onDecide={decide} /> : review.isError ? <p role="alert" className="mt-4 text-sm text-(--color-danger)">The review list didn't load.</p> : null}
    </div>
  );
}
```

In `frontend/src/App.tsx`, add `import { AdminSynopsesPage } from "./pages/AdminSynopsesPage";`. Then add `<Route path="/admin/synopses" element={<AdminSynopsesPage />} />` right after the `/admin/genres` route.

Replace `frontend/src/components/AdminLinks.tsx` with:

```tsx
import { Link } from "react-router-dom";

const LINKS = [
  { to: "/admin/genres", label: "Genre review" },
  { to: "/admin/synopses", label: "Synopsis review" }
];

export function AdminLinks({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  if (!isAdmin) return null;
  return (
    <>
      {LINKS.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          onClick={onNavigate}
          className="mb-2 block rounded-lg px-3 py-2 text-sm text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS, with `test-admin-genres.mts` still green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/books.ts frontend/src/components/SynopsisReviewList.tsx frontend/src/pages/AdminSynopsesPage.tsx frontend/src/App.tsx frontend/src/components/AdminLinks.tsx frontend/scripts/test-admin-synopses.mts && git commit -m "$(cat <<'EOF'
Add the synopsis review page at /admin/synopses

The page lists hidden texts (to restore one the rule or Jev got wrong)
and doubtful ones (to decide), with the evidence, the source, how many
editions carry the text and who holds it. Keep and Hide save the
owner's call and drop the row. AdminLinks now renders one link per
admin page, so the translation review can join without another
component.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Calibration export and score

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Create: `backend/src/modules/books/calibration.ts`
- Create: `backend/src/modules/books/calibration.test.ts`. Add `src/modules/books/calibration.test.ts` to `backend/package.json` `"test"`, after `src/modules/books/synopsisReview.test.ts`.
- Create: `backend/scripts/jev-calibration-export.mjs`
- Create: `backend/scripts/jev-calibration-score.mjs`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `synopsisJudgments` (Task 2); `createJevSynopsisClassifier` (Task 4); `SYNOPSIS_HIDE_BELOW` and `SYNOPSIS_REVIEW_BELOW` (Task 1).
- Produces, repo: `synopsisTexts(): Array<{ hash: string; source: string; title: string; author: string; text: string }>`. It returns the oldest carrier of every distinct text, with work rows as source `openlibrary`.
- Produces, `calibration.ts`:
  - `type SynopsisSampleItem = { hash: string; stratum: string; title: string; author: string; text: string; judgment: { model: string; usable: number; kind: string } | null }`
  - `type SynopsisLabel = { hash: string; usable: boolean; kind: string }`
  - `type SynopsisAnswerRow = { hash: string; usable: number; kind: string }`
  - `synopsisSample(repo, n: number, random?: () => number): SynopsisSampleItem[]`: stratified by summary source, with texts the rule hid as their own stratum `rule`.
  - `scoreSynopses(sample: SynopsisSampleItem[], labels: SynopsisLabel[], answers: SynopsisAnswerRow[]): Array<{ decision: string; items: number; notUsable: number }>`. Its rows are `rule`, `jev below 0.3`, `jev 0.3 to 0.5` and `jev 0.5 and above`.
  - `TASKS = ["synopses"] as const`. The translation plan adds `"translations"`.

- [ ] **Step 1: Write the failing test**

`backend/src/modules/books/calibration.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "calibration-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { scoreSynopses, synopsisSample } = await import("./calibration.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function seed(repo: Repo, isbn: string, summary: string, source: "publisher" | "isbndb") {
  const book = repo.createBook({ title: `Book ${isbn}`, author: "Author", isbn }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
  repo.mergeDetails(book.id, { summary, pages: null, year: null, publisher: null, translator: null }, source);
  return repo.getBook(book.id)!;
}

test("the sample is spread across summary sources, with the rule's texts as their own stratum", () => {
  const repo = freshRepo();
  for (let n = 0; n < 6; n++) seed(repo, `97897200008${n}0`, `A publisher synopsis number ${n}, long enough to read.`, "publisher");
  for (let n = 0; n < 6; n++) seed(repo, `97897200009${n}0`, `An ISBNdb description number ${n}, long enough to read.`, "isbndb");
  const fragment = seed(repo, "9789720000999", "Text: Portugese", "isbndb");
  repo.saveSynopsisJudgment(fragment.summary_hash!, { model: "rule", usable: 0, kind: "fragment", askedAt: "2026-10-15T00:00:00.000Z" });
  const sample = synopsisSample(repo, 6, () => 0.5);
  const count = (stratum: string) => sample.filter((item) => item.stratum === stratum).length;
  assert.deepEqual([count("publisher"), count("isbndb"), count("rule")], [2, 2, 1]);
  assert.equal(sample.find((item) => item.stratum === "rule")?.judgment?.model, "rule");
  assert.equal(new Set(sample.map((item) => item.hash)).size, sample.length);
});

test("the score counts labelled not-usable texts per decision band", () => {
  const sample = ["r", "a", "b", "c", "d"].map((hash) => ({ hash, stratum: hash === "r" ? "rule" : "publisher", title: "T", author: "A", text: "x", judgment: hash === "r" ? { model: "rule", usable: 0, kind: "fragment" } : null }));
  const labels = [{ hash: "r", usable: false, kind: "fragment" }, { hash: "a", usable: false, kind: "praise" }, { hash: "b", usable: true, kind: "synopsis" }, { hash: "c", usable: false, kind: "author_bio" }, { hash: "d", usable: true, kind: "synopsis" }];
  const answers = [{ hash: "a", usable: 0.1, kind: "praise" }, { hash: "b", usable: 0.2, kind: "synopsis" }, { hash: "c", usable: 0.4, kind: "author_bio" }, { hash: "d", usable: 0.9, kind: "synopsis" }];
  assert.deepEqual(scoreSynopses(sample, labels, answers), [
    { decision: "rule", items: 1, notUsable: 1 },
    { decision: "jev below 0.3", items: 2, notUsable: 1 },
    { decision: "jev 0.3 to 0.5", items: 1, notUsable: 1 },
    { decision: "jev 0.5 and above", items: 1, notUsable: 0 }
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run typecheck --workspace backend`
Expected: FAIL. `./calibration.js` doesn't exist.

- [ ] **Step 3: Implement**

In `domain/ports.ts`, add after `synopsisCarriers(...)`:

```ts
  synopsisTexts(): Array<{ hash: string; source: string; title: string; author: string; text: string }>;
```

In `sqliteBooksRepository.ts`, add after `synopsisCarriersStmt`:

```ts
  const synopsisTextsStmt = db.prepare(`
    SELECT summary_hash AS hash, COALESCE(summary_source, 'unknown') AS source, title, author, summary AS text, created_at, rowid AS ord FROM books WHERE summary_hash IS NOT NULL
    UNION ALL
    SELECT summary_hash, 'openlibrary', title, author, summary, created_at, rowid FROM works WHERE summary_hash IS NOT NULL
    ORDER BY created_at, ord
  `);
```

And after `synopsisCarriers`:

```ts
    synopsisTexts() {
      const seen = new Map<string, { hash: string; source: string; title: string; author: string; text: string }>();
      for (const row of synopsisTextsStmt.all() as Array<{ hash: string; source: string; title: string; author: string; text: string }>) {
        if (!seen.has(row.hash)) seen.set(row.hash, { hash: row.hash, source: row.source, title: row.title, author: row.author, text: row.text });
      }
      return [...seen.values()];
    },
```

Create `backend/src/modules/books/calibration.ts`:

```ts
import type { BooksRepository } from "./domain/ports.js";
import { SYNOPSIS_HIDE_BELOW, SYNOPSIS_REVIEW_BELOW } from "./domain/synopsis.js";

export const TASKS = ["synopses"] as const;

export type SynopsisSampleItem = { hash: string; stratum: string; title: string; author: string; text: string; judgment: { model: string; usable: number; kind: string } | null };
export type SynopsisLabel = { hash: string; usable: boolean; kind: string };
export type SynopsisAnswerRow = { hash: string; usable: number; kind: string };

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function synopsisSample(repo: Pick<BooksRepository, "synopsisTexts" | "synopsisJudgments">, n: number, random: () => number = Math.random): SynopsisSampleItem[] {
  const texts = repo.synopsisTexts();
  const judgments = repo.synopsisJudgments(texts.map((text) => text.hash));
  const strata = new Map<string, SynopsisSampleItem[]>();
  for (const text of texts) {
    const judgment = judgments.get(text.hash) ?? null;
    const stratum = judgment?.model === "rule" ? "rule" : text.source;
    strata.set(stratum, [...(strata.get(stratum) ?? []), { hash: text.hash, stratum, title: text.title, author: text.author, text: text.text, judgment: judgment && { model: judgment.model, usable: judgment.usable, kind: judgment.kind } }]);
  }
  const quota = Math.ceil(n / Math.max(strata.size, 1));
  return [...strata.values()].flatMap((items) => shuffled(items, random).slice(0, quota));
}

export function scoreSynopses(sample: SynopsisSampleItem[], labels: SynopsisLabel[], answers: SynopsisAnswerRow[]): Array<{ decision: string; items: number; notUsable: number }> {
  const label = new Map(labels.map((entry) => [entry.hash, entry]));
  const answer = new Map(answers.map((entry) => [entry.hash, entry]));
  const labelled = sample.filter((item) => label.has(item.hash));
  const row = (decision: string, items: SynopsisSampleItem[]) => ({ decision, items: items.length, notUsable: items.filter((item) => label.get(item.hash)!.usable === false).length });
  const asked = labelled.filter((item) => item.judgment?.model !== "rule" && answer.has(item.hash));
  const usable = (item: SynopsisSampleItem) => answer.get(item.hash)!.usable;
  return [
    row("rule", labelled.filter((item) => item.judgment?.model === "rule")),
    row(`jev below ${SYNOPSIS_HIDE_BELOW}`, asked.filter((item) => usable(item) < SYNOPSIS_HIDE_BELOW)),
    row(`jev ${SYNOPSIS_HIDE_BELOW} to ${SYNOPSIS_REVIEW_BELOW}`, asked.filter((item) => usable(item) >= SYNOPSIS_HIDE_BELOW && usable(item) < SYNOPSIS_REVIEW_BELOW)),
    row(`jev ${SYNOPSIS_REVIEW_BELOW} and above`, asked.filter((item) => usable(item) >= SYNOPSIS_REVIEW_BELOW))
  ];
}
```

Create `backend/scripts/jev-calibration-export.mjs`:

```js
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { task: { type: "string" }, n: { type: "string", default: "200" } } });
const { TASKS, synopsisSample } = await import("../dist/modules/books/calibration.js");
const n = Number(values.n);
if (!TASKS.includes(values.task) || !Number.isInteger(n) || n <= 0) {
  console.error(`Usage: node scripts/jev-calibration-export.mjs --task ${TASKS.join("|")} [--n 200]`);
  process.exit(1);
}
if (!process.env.COVERS_DB_PATH) {
  console.error("Missing environment variable: COVERS_DB_PATH");
  process.exit(1);
}

const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const books = createSqliteBooksRepository(new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }));
console.log("---BEGIN---");
console.log(JSON.stringify(synopsisSample(books, n)));
console.log("---END---");
```

Create `backend/scripts/jev-calibration-score.mjs`:

```js
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({ options: { task: { type: "string" } }, allowPositionals: true });
const { TASKS, scoreSynopses } = await import("../dist/modules/books/calibration.js");
const [samplePath, labelsPath] = positionals;
if (!TASKS.includes(values.task) || !samplePath || !labelsPath) {
  console.error(`Usage: node scripts/jev-calibration-score.mjs --task ${TASKS.join("|")} <sample.json> <labels.json>`);
  process.exit(1);
}
if (!process.env.TYPESAFE_API_KEY) {
  console.error("TYPESAFE_API_KEY is not set.");
  process.exit(1);
}

const { createJevSynopsisClassifier } = await import("../dist/modules/books/adapters/typesafe/jevSynopsis.js");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));
const labels = JSON.parse(readFileSync(labelsPath, "utf8"));
const classify = createJevSynopsisClassifier(process.env.TYPESAFE_API_KEY, () => {});
const asked = sample.filter((item) => item.judgment?.model !== "rule");
const answers = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < asked.length) {
    const item = asked[next++];
    const answer = await classify({ title: item.title, author: item.author, text: item.text });
    answers.push({ hash: item.hash, usable: answer.usable, kind: answer.kind });
  }
}));
console.log(JSON.stringify(scoreSynopses(sample, labels, answers), null, 2));
```

In `backend/README.md`, add a "Calibrating Jev" section after the synopsis backlog section, covering four steps:
1. **Export.** The owner runs the export in the production container over `railway ssh`: `node scripts/jev-calibration-export.mjs --task synopses --n 200`. It's read-only and catalog fields only, and the JSON comes out between `---BEGIN---` and `---END---`.
2. **Label.** Claude Sonnet subagents label the sample: at most 25 items each, without seeing Jev's answers, using the question wording in `adapters/typesafe/jevSynopsis.ts`. Never Haiku. A batch whose answers are all, or nearly all, the same is redone. Labels are `[{ "hash": "…", "usable": true|false, "kind": "…" }]`.
3. **Score.** `TYPESAFE_API_KEY=… node scripts/jev-calibration-score.mjs --task synopses sample.json labels.json`, run where the key lives. It prints the not-usable count per decision band and stores nothing.
4. **Decide.**
   - Thresholds change only through a PR with the score table in its description.
   - The bar for hiding is at least 95% right. A band that misses gets a stricter threshold. A code rule that misses is removed.
   - The sample and label files are never committed.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck --workspace backend && npm test --workspace backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/calibration.ts backend/src/modules/books/calibration.test.ts backend/scripts/jev-calibration-export.mjs backend/scripts/jev-calibration-score.mjs backend/README.md backend/package.json && git commit -m "$(cat <<'EOF'
Add the Claude calibration export and score for synopsis thresholds

The owner exports a production sample spread over summary sources,
with the rule's texts as their own stratum. Claude labels it blind, and
the score script asks Jev about the same texts and prints how many
labelled not-usable texts fall in each band. Thresholds change only by
PR with that table, never loosened without a new sample.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Wrap-up

- [ ] Run every verify command in Global Constraints. All must pass.
- [ ] Web pass on the dev fixture, with no emulator needed:
  - sign in as the admin account (`ADMIN_USER_ID` in the worktree's `backend/.env` set to the dev account's id);
  - open `/admin/synopses`: the page loads, empty or with fixture items;
  - the account footer shows both review links;
  - a non-admin account gets the not-found page;
  - take a screenshot.
- [ ] Dispatch `branch-reviewer` with this plan and the spec.
- [ ] This branch adds admin-only routes ("who can see what"). Run the `security-review` skill before merge.
- [ ] Ship with the `ship` skill: push, PR, `--auto`.
- [ ] Rollout is the owner's call:
  1. deploy;
  2. calibrate on production (Task 9's runbook);
  3. run the backlog's dry run, then the backlog with the dry run's `--max`;
  4. work through `/admin/synopses`.
