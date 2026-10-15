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
