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

const databases = new WeakMap<Repo, DatabaseSync>();

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  databases.set(repo, db);
  return repo;
}

function book(repo: Repo, isbn: string, title: string, author: string, extra: { workKey?: string; language?: string; summary?: string } = {}) {
  const row = repo.createBook({ title, author, isbn, workKey: extra.workKey }, [`isbn:${isbn}`], AT);
  if (extra.language) repo.setLanguage(row.id, extra.language);
  if (extra.summary) databases.get(repo)!.prepare("UPDATE books SET summary = ? WHERE id = ?").run(extra.summary, row.id);
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
  assert.deepEqual(translationDryRun(repo, works, 10), { selected: 4, originalTitles: 2, originals: 1, noCandidates: 1, codeMerges: 1, wouldAsk: 1, seriesLike: 0, max: 10 });
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

function poppyVolumes(repo: Repo) {
  const series = book(repo, "9781408300001", "Princess Poppy", "Janey Louise Jones", { workKey: "OL962W" });
  const volumes = ["A Princesa Poppy e o Piquenique", "A Princesa Poppy e a Festa", "Poppy no Baile"].map((title, n) => book(repo, `978972000060${n}`, title, "Janey Louise Jones", { language: "pt-PT", summary: "Uma história de Poppy.\n\nTítulo original: Princess Poppy" }));
  return { series, volumes };
}

test("the dry run counts the works a series-named original blocks, among those with no candidates", () => {
  const repo = freshRepo();
  seedCatalog(repo);
  poppyVolumes(repo);
  const works = translationBacklogWorks(repo, [], null);
  assert.deepEqual(translationDryRun(repo, works, 10), { selected: 7, originalTitles: 5, originals: 1, noCandidates: 4, codeMerges: 1, wouldAsk: 1, seriesLike: 3, max: 10 });
});

test("the code steps join no volume of a series-named original, and still join a genuine translation", () => {
  const repo = freshRepo();
  const c = seedCatalog(repo);
  const { series, volumes } = poppyVolumes(repo);
  const steps = runCodeSteps(deps(repo, async () => ({ choice: null, confidence: 0, model: "x" })), translationBacklogWorks(repo, [], null));
  assert.deepEqual(steps, { originals: 1, noCandidates: 4, codeMerges: 1, codeBlocked: 0, ask: [c.ask.work_id] });
  assert.equal(repo.getBook(c.codePt.id)!.work_id, c.en.work_id);
  for (const volume of volumes) {
    assert.equal(repo.getBook(volume.id)!.work_id, volume.work_id);
    assert.deepEqual(repo.workMatchJudgments([volume.work_id!]).get(volume.work_id!), { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
  }
  assert.equal(repo.getBook(series.id)!.work_id, series.work_id);
});

test("the Jev step asks nothing about a work whose original is a series name", async () => {
  const repo = freshRepo();
  const { series, volumes } = poppyVolumes(repo);
  let asked = 0;
  const result = await runTranslationBacklog(deps(repo, async () => {
    asked += 1;
    return { choice: 0, confidence: 0.95, model: "jev-1.13.0" };
  }), volumes.map((volume) => volume.work_id!));
  assert.equal(result.stoppedBy, "done");
  assert.equal(asked, 0);
  for (const volume of volumes) assert.notEqual(repo.getBook(volume.id)!.work_id, series.work_id);
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

test("the code steps keep a join whose target heads a series for review", () => {
  const repo = freshRepo();
  const c = seedCatalog(repo);
  const sequel = book(repo, "9780156907599", "Mrs Dalloway", "Virginia Woolf", { workKey: "OL963W" });
  for (const row of [c.en, sequel]) repo.addWorkSeries(row.work_id!, [{ name: "To the Lighthouse", position: null }], "wikidata", AT);
  const steps = runCodeSteps(deps(repo, async () => ({ choice: null, confidence: 0, model: "x" })), translationBacklogWorks(repo, [], null));
  assert.equal(steps.codeBlocked, 1);
  assert.equal(steps.codeMerges, 0);
  assert.equal(repo.getBook(c.codePt.id)!.work_id, c.codePt.work_id);
  assert.deepEqual(repo.workMatchJudgments([c.codePt.work_id!]).get(c.codePt.work_id!), { model: "code", intoWorkId: c.en.work_id, confidence: null, askedAt: AT });
});

test("the code steps save no target for a join onto the whole of a split volume", () => {
  const repo = freshRepo();
  book(repo, "9780140444308", "Les Misérables", "Victor Hugo", { workKey: "OL5710W" });
  const pt = book(repo, "9789720000702", "Os Miseráveis I", "", { language: "pt-PT", summary: "Romance de Victor Hugo.\n\nTítulo original: Les Misérables" });
  const steps = runCodeSteps(deps(repo, async () => ({ choice: null, confidence: 0, model: "x" })), translationBacklogWorks(repo, [], null));
  assert.equal(steps.codeMerges, 0);
  assert.equal(steps.codeBlocked, 1);
  assert.deepEqual(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!), { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
  assert.equal(repo.getBook(pt.id)!.work_id, pt.work_id);
});
