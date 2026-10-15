import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "translation-backlog-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { runBudget } = await import("./typesafe.js");
const { runCodeSteps, runTranslationBacklog, translationBacklogReport, translationBacklogWorks, translationDryRun, TRANSLATION_BACKLOG_SOURCE } = await import("./translationBacklog.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const AT = "2026-10-15T12:00:00.000Z";
const NOW = Date.parse(AT);

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function book(repo: Repo, isbn: string, title: string, author: string, extra: { workKey?: string; language?: string; summary?: string } = {}) {
  const row = repo.createBook({ title, author, isbn, workKey: extra.workKey }, [`isbn:${isbn}`], AT);
  if (extra.language) repo.setLanguage(row.id, extra.language);
  if (extra.summary) repo.mergeDetails(row.id, { summary: extra.summary, pages: null, year: null, publisher: null, translator: null }, "publisher");
  return repo.getBook(row.id)!;
}

function seedCatalog(repo: Repo) {
  const en = book(repo, "9780156907501", "To the Lighthouse", "Virginia Woolf", { workKey: "OL960W" });
  const codePt = book(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", { language: "pt-PT", summary: "Uma família na Escócia.\n\nTítulo original: To the Lighthouse" });
  const original = book(repo, "9789720000502", "Memorial do Convento", "José Saramago", { language: "pt-PT", summary: "Um convento e uma passarola.\n\nTítulo original: Memorial do Convento" });
  const lonely = book(repo, "9789720000503", "Sem Autor", "", { language: "pt-PT" });
  const idiotEn = book(repo, "9780000000504", "The Idiot", "Fyodor Dostoevsky", { workKey: "OL961W" });
  const ask = book(repo, "9789720000505", "O Idiota", "Fyodor Dostoevsky", { language: "pt-PT" });
  return { en, codePt, original, lonely, idiotEn, ask };
}

const deps = (repo: Repo, classify: () => Promise<{ choice: number | null; confidence: number; model: string }>) => ({ repo, classify, sharesArena: () => false, now: () => NOW, alert: () => {} });

test("the dry run counts every step and writes nothing", () => {
  const repo = freshRepo();
  const c = seedCatalog(repo);
  const works = translationBacklogWorks(repo, [c.ask.work_id!], null);
  assert.equal(works[0], c.ask.work_id);
  assert.deepEqual(translationDryRun(repo, works, 10), { selected: 4, originalTitles: 2, originals: 1, noCandidates: 1, codeMerges: 1, wouldAsk: 1, max: 10 });
  assert.equal(repo.getBook(c.codePt.id)!.original_title, null);
  assert.equal(repo.workMatchJudgments(works).size, 0);
});

test("the code steps fill original titles, record originals, merge clear matches and leave the rest for Jev", () => {
  const repo = freshRepo();
  const c = seedCatalog(repo);
  const works = translationBacklogWorks(repo, [], null);
  const steps = runCodeSteps(deps(repo, async () => ({ choice: null, confidence: 0, model: "x" })), works);
  assert.deepEqual({ ...steps, ask: steps.ask }, { originals: 1, noCandidates: 1, codeMerges: 1, codeBlocked: 0, ask: [c.ask.work_id] });
  assert.equal(repo.getBook(c.codePt.id)!.original_title, "To the Lighthouse");
  assert.equal(repo.getBook(c.codePt.id)!.work_id, c.en.work_id);
});

test("the Jev step stops at --max under its own source, and the report counts outcomes", async () => {
  const repo = freshRepo();
  const c = seedCatalog(repo);
  const second = book(repo, "9789720000506", "Crime e Castigo", "Fyodor Dostoevsky", { language: "pt-PT" });
  const steps = runCodeSteps(deps(repo, async () => ({ choice: null, confidence: 0, model: "x" })), translationBacklogWorks(repo, [], null));
  const budget = runBudget(repo, TRANSLATION_BACKLOG_SOURCE, 1, () => NOW);
  const result = await runTranslationBacklog(deps(repo, async () => {
    budget.spend();
    return { choice: 0, confidence: 0.95, model: "jev-1.13.0" };
  }), steps.ask);
  assert.equal(result.stoppedBy, "budget");
  assert.equal(result.asked.length, 1);
  assert.equal(repo.typesafeUsage("2026-10-15", TRANSLATION_BACKLOG_SOURCE), 1);
  const report = translationBacklogReport(repo, { steps, asked: result.asked, stoppedBy: result.stoppedBy, requests: budget.used(), originalTitles: 2 });
  assert.equal(report.jevMerges, 1);
  assert.equal(report.requests, 1);
  assert.ok([c.ask.work_id, second.work_id].includes(result.asked[0]!));
});
