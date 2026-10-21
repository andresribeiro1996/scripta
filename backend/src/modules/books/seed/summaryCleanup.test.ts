import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "summary-cleanup-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { summaryHashOf } = await import("../domain/synopsis.js");
const { originalKey } = await import("../domain/translation.js");
const { reportJson } = await import("./mojibakeRepair.js");
const { applySummaryCleanup, planSummaryCleanup, summaryCleanupReport } = await import("./summaryCleanup.js");

const NOW = "2026-10-01T00:00:00.000Z";
const LONG = "Uma história comprida sobre uma ilha esquecida e as pessoas que nela vivem, com segredos antigos e uma viagem inesperada.";
const LONG_B = "Outra história comprida sobre um farol distante e os marinheiros que o procuram, entre tempestades e velhas promessas.";
const TAIL = "\n\nDetalhes\n\nTítulo Original The Island\n\nCategoria Ficção\n\nSub-categoria Romance\n\nNº de Páginas 320\n\nCitações";
const SHORT = "Um livro curto.";
const SHORT_TAIL = `${SHORT}\n\nDetalhes\n\nCitações`;

type Judgment = { model: string; usable: number; kind: string; asked_at: string };

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  let n = 0;
  const book = (summary: string | null, source: string | null = "publisher", extra: { originalTitle?: string; url?: string } = {}) => {
    n++;
    const created = repo.createBook({ title: `Livro ${n}`, author: `Autor ${n}`, isbn: null }, [`k:${n}`], NOW);
    db.prepare("UPDATE books SET summary = ?, summary_hash = ?, summary_source = ?, original_title = ?, publisher_url = ? WHERE id = ?").run(summary, summaryHashOf(summary), summary === null ? null : source, extra.originalTitle ?? null, extra.url ?? null, created.id);
    return created;
  };
  const judge = (text: string, model: string, usable: number, kind = "synopsis", askedAt = "2026-10-02T00:00:00.000Z") =>
    db.prepare("INSERT OR REPLACE INTO synopsis_judgments (text_hash, model, usable, kind, asked_at) VALUES (?, ?, ?, ?, ?)").run(summaryHashOf(text)!, model, usable, kind, askedAt);
  const judgment = (text: string) => {
    const row = db.prepare("SELECT model, usable, kind, asked_at FROM synopsis_judgments WHERE text_hash = ?").get(summaryHashOf(text)!) as Judgment | undefined;
    return row ? { ...row } : undefined;
  };
  const stored = (id: string) => ({ ...(db.prepare("SELECT summary, summary_hash, summary_source, original_title FROM books WHERE id = ?").get(id) as Record<string, string | null>) });
  const dump = () => ["books", "works", "synopsis_judgments"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  return { db, repo, book, judge, judgment, stored, dump };
}

test("cleans changed books, skips clean ones and empties chrome-only ones", () => {
  const h = setup();
  const dirty = h.book(LONG + TAIL);
  const clean = h.book(LONG_B);
  const chrome = h.book("Adicionar aos Favoritos");
  const plan = planSummaryCleanup(h.db);
  assert.deepEqual(plan.scanned, { books: 3, works: 0 });
  assert.deepEqual(plan.changes.map((change) => change.id).sort(), [dirty.id, chrome.id].sort());
  const applied = applySummaryCleanup(h.db, plan);
  assert.deepEqual(applied, { books: 2, works: 0, emptied: 1, skipped: 0, originalTitles: 1, judgmentsWritten: 0 });
  assert.deepEqual(h.stored(dirty.id), { summary: LONG, summary_hash: summaryHashOf(LONG), summary_source: "publisher", original_title: "The Island" });
  assert.equal((h.db.prepare("SELECT original_key FROM books WHERE id = ?").get(dirty.id) as { original_key: string | null }).original_key, originalKey("The Island"));
  assert.equal(h.stored(clean.id).summary, LONG_B);
  assert.deepEqual(h.stored(chrome.id), { summary: null, summary_hash: null, summary_source: null, original_title: null });
});

test("cleans a work with CRLF and an Also contained in tail", () => {
  const h = setup();
  const work = h.book(null);
  const raw = `${LONG}\r\n\r\n----------\r\nAlso contained in:\r\n - [Novels][1]\r\n\r\n  [1]: https://openlibrary.org/works/OL1W`;
  const workId = (h.db.prepare("SELECT work_id FROM books WHERE id = ?").get(work.id) as { work_id: string }).work_id;
  h.db.prepare("UPDATE works SET summary = ?, summary_hash = ? WHERE id = ?").run(raw, summaryHashOf(raw), workId);
  const plan = planSummaryCleanup(h.db);
  assert.equal(applySummaryCleanup(h.db, plan).works, 1);
  assert.deepEqual({ ...(h.db.prepare("SELECT summary, summary_hash FROM works WHERE id = ?").get(workId) as object) }, { summary: LONG, summary_hash: summaryHashOf(LONG) });
});

test("a Jev keep is copied to the new hash and the old row stays", () => {
  const h = setup();
  const raw = LONG + TAIL;
  h.book(raw);
  h.judge(raw, "jev", 0.9);
  const plan = planSummaryCleanup(h.db);
  assert.deepEqual(plan.judgments.map((judgment) => judgment.outcome), ["carried"]);
  applySummaryCleanup(h.db, plan);
  assert.deepEqual(h.judgment(LONG), { model: "jev", usable: 0.9, kind: "synopsis", asked_at: "2026-10-02T00:00:00.000Z" });
  assert.equal(h.judgment(raw)?.model, "jev");
});

test("manual and rule hides are carried", () => {
  const h = setup();
  const manual = LONG + TAIL;
  const rule = LONG_B + TAIL;
  h.book(manual);
  h.book(rule);
  h.judge(manual, "manual", 0);
  h.judge(rule, "rule", 0, "fragment");
  const plan = planSummaryCleanup(h.db);
  assert.deepEqual(plan.judgments.map((judgment) => judgment.outcome), ["carried", "carried"]);
  applySummaryCleanup(h.db, plan);
  assert.equal(h.judgment(LONG)?.model, "manual");
  assert.equal(h.judgment(LONG)?.usable, 0);
  assert.equal(h.judgment(LONG_B)?.model, "rule");
});

test("a Jev hide on changed text is dropped", () => {
  const h = setup();
  const raw = LONG + TAIL;
  h.book(raw);
  h.judge(raw, "jev", 0.1, "product");
  const plan = planSummaryCleanup(h.db);
  assert.deepEqual(plan.judgments.map((judgment) => judgment.outcome), ["jev-hide-dropped"]);
  applySummaryCleanup(h.db, plan);
  assert.equal(h.judgment(LONG), undefined);
});

test("a changed fragment gets a rule hide unless a manual judgment exists", () => {
  const h = setup();
  const jev = SHORT_TAIL;
  const manual = `${SHORT} Outro.\n\nDetalhes\n\nCitações`;
  const unjudged = `Mais um curto.\n\nDetalhes\n\nCitações`;
  h.book(jev);
  h.book(manual);
  h.book(unjudged);
  h.judge(jev, "jev", 0.9);
  h.judge(manual, "manual", 1);
  const plan = planSummaryCleanup(h.db);
  const outcomes = Object.fromEntries(plan.judgments.map((judgment) => [judgment.hash, judgment.outcome]));
  assert.equal(outcomes[summaryHashOf(SHORT)!], "rule");
  assert.equal(outcomes[summaryHashOf(`${SHORT} Outro.`)!], "carried");
  assert.equal(outcomes[summaryHashOf("Mais um curto.")!], "rule");
  applySummaryCleanup(h.db, plan);
  const rule = h.judgment(SHORT)!;
  assert.deepEqual({ model: rule.model, usable: rule.usable, kind: rule.kind }, { model: "rule", usable: 0, kind: "fragment" });
  assert.equal(typeof rule.asked_at, "string");
  assert.equal(h.judgment(`${SHORT} Outro.`)?.model, "manual");
  assert.equal(h.judgment("Mais um curto.")?.model, "rule");
});

test("an existing judgment on the new hash is kept unless a manual one replaces it", () => {
  const h = setup();
  const keptRaw = LONG + TAIL;
  const replacedRaw = LONG_B + TAIL;
  h.book(keptRaw);
  h.book(replacedRaw);
  h.judge(keptRaw, "jev", 0.9, "synopsis", "2026-10-02T00:00:00.000Z");
  h.judge(LONG, "jev", 0.4, "other", "2026-10-03T00:00:00.000Z");
  h.judge(replacedRaw, "manual", 0);
  h.judge(LONG_B, "jev", 0.9);
  const plan = planSummaryCleanup(h.db);
  const outcomes = Object.fromEntries(plan.judgments.map((judgment) => [judgment.hash, judgment.outcome]));
  assert.equal(outcomes[summaryHashOf(LONG)!], "kept");
  assert.equal(outcomes[summaryHashOf(LONG_B)!], "manual-replaced");
  applySummaryCleanup(h.db, plan);
  assert.deepEqual(h.judgment(LONG), { model: "jev", usable: 0.4, kind: "other", asked_at: "2026-10-03T00:00:00.000Z" });
  assert.equal(h.judgment(LONG_B)?.model, "manual");
});

test("a judgment written after the scan is not overwritten", () => {
  const h = setup();
  const raw = LONG + TAIL;
  h.book(raw);
  h.judge(raw, "jev", 0.9);
  const plan = planSummaryCleanup(h.db);
  h.judge(LONG, "manual", 0, "product", "2026-10-05T00:00:00.000Z");
  const applied = applySummaryCleanup(h.db, plan);
  assert.equal(applied.judgmentsWritten, 0);
  assert.deepEqual(h.judgment(LONG), { model: "manual", usable: 0, kind: "product", asked_at: "2026-10-05T00:00:00.000Z" });
});

test("two old texts cleaning to the same text: the manual hide wins", () => {
  const h = setup();
  const a = LONG + TAIL;
  const b = `${LONG}\n\nAdicionar aos Favoritos`;
  h.book(a);
  h.book(b);
  h.judge(a, "manual", 0);
  h.judge(b, "jev", 0.9);
  const plan = planSummaryCleanup(h.db);
  assert.deepEqual(plan.judgments.map((judgment) => judgment.outcome), ["carried"]);
  applySummaryCleanup(h.db, plan);
  assert.equal(h.judgment(LONG)?.model, "manual");
  assert.equal(h.judgment(LONG)?.usable, 0);
});

test("changed text with no judgment is unjudged", () => {
  const h = setup();
  h.book(LONG + TAIL);
  const plan = planSummaryCleanup(h.db);
  assert.deepEqual(plan.judgments.map((judgment) => judgment.outcome), ["unjudged"]);
  assert.equal(applySummaryCleanup(h.db, plan).judgmentsWritten, 0);
});

test("a whitespace-only change keeps the hash and leaves a Jev hide alone", () => {
  const h = setup();
  const raw = `${LONG}\r\n\r\n${LONG_B}`;
  const book = h.book(raw);
  h.judge(raw, "jev", 0.05, "product");
  const plan = planSummaryCleanup(h.db);
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.judgments, []);
  applySummaryCleanup(h.db, plan);
  assert.equal(h.stored(book.id).summary, `${LONG}\n\n${LONG_B}`);
  assert.equal(h.stored(book.id).summary_hash, summaryHashOf(raw));
  assert.deepEqual(h.judgment(raw), { model: "jev", usable: 0.05, kind: "product", asked_at: "2026-10-02T00:00:00.000Z" });
});

test("an existing original title is kept", () => {
  const h = setup();
  const book = h.book(LONG + TAIL, "publisher", { originalTitle: "Já Tinha" });
  applySummaryCleanup(h.db, planSummaryCleanup(h.db));
  assert.equal(h.stored(book.id).original_title, "Já Tinha");
});

test("a crash after the judgments loses none and a rerun finishes", () => {
  const h = setup();
  const raw = LONG + TAIL;
  const failing = h.book(raw);
  h.book(LONG_B + TAIL);
  h.judge(raw, "manual", 0);
  h.db.exec(`CREATE TRIGGER fail BEFORE UPDATE ON books WHEN NEW.id = '${failing.id}' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
  assert.throws(() => applySummaryCleanup(h.db, planSummaryCleanup(h.db)), /boom/);
  assert.equal(h.judgment(LONG)?.model, "manual");
  assert.equal(h.stored(failing.id).summary, raw);
  h.db.exec("DROP TRIGGER fail");
  const before = h.judgment(LONG);
  const applied = applySummaryCleanup(h.db, planSummaryCleanup(h.db));
  assert.equal(applied.books, 2);
  assert.deepEqual(h.judgment(LONG), before);
  assert.equal(h.stored(failing.id).summary, LONG);
});

test("a row edited after the scan is skipped and left as edited", () => {
  const h = setup();
  const book = h.book(LONG + TAIL);
  const plan = planSummaryCleanup(h.db);
  h.db.prepare("UPDATE books SET summary = ? WHERE id = ?").run("Editado entretanto.", book.id);
  const applied = applySummaryCleanup(h.db, plan);
  assert.equal(applied.skipped, 1);
  assert.equal(applied.books, 0);
  assert.equal(h.stored(book.id).summary, "Editado entretanto.");
});

test("a plan writes nothing and a rerun finds nothing", () => {
  const h = setup();
  h.book(LONG + TAIL);
  h.book("Adicionar aos Favoritos");
  const before = h.dump();
  const plan = planSummaryCleanup(h.db);
  assert.deepEqual(h.dump(), before);
  applySummaryCleanup(h.db, plan);
  assert.deepEqual(planSummaryCleanup(h.db).changes, []);
});

test("the report counts and samples, and keeps originals on a real run but not a dry run", () => {
  const h = setup();
  const long = "x".repeat(400);
  for (let i = 0; i < 4; i++) h.book(`${LONG} ${i}${TAIL}${long}`, "publisher", { url: "https://shop.example/p/1" });
  h.book("Adicionar aos Favoritos", "isbndb");
  const plan = planSummaryCleanup(h.db);
  const dry = summaryCleanupReport(plan, null, true) as Record<string, any>;
  assert.equal(dry.applied, null);
  assert.equal(dry.originals, undefined);
  assert.deepEqual(dry.books, { scanned: 5, changed: plan.changes.length, emptied: 1 });
  assert.deepEqual(dry.works, { scanned: 0, changed: 0, emptied: 0 });
  assert.equal(dry.bySource.publisher, 4);
  assert.equal(dry.byHost["shop.example"], 4);
  assert.equal(dry.samples["shop.example"].length, 3);
  assert.ok(dry.samples["shop.example"].every((sample: { from: string }) => sample.from.length <= 300));
  assert.equal(typeof dry.judgments, "object");
  const applied = applySummaryCleanup(h.db, plan);
  const real = summaryCleanupReport(plan, applied, false) as Record<string, any>;
  assert.deepEqual(real.applied, applied);
  assert.equal(real.originals.length, plan.changes.length);
  assert.deepEqual(Object.keys(real.originals[0]), ["table", "id", "summary"]);
  assert.equal(typeof reportJson(real), "string");
});

test("a real run that failed part-way still reports every original", () => {
  const h = setup();
  h.book(LONG + TAIL);
  const plan = planSummaryCleanup(h.db);
  const failed = summaryCleanupReport(plan, null, false) as Record<string, any>;
  assert.equal(failed.dryRun, false);
  assert.equal(failed.applied, null);
  assert.deepEqual(failed.originals, plan.changes.map((change) => ({ table: change.table, id: change.id, summary: change.from })));
});

test("a manual judgment written after the scan is not replaced by manual-replaced", () => {
  const h = setup();
  const raw = LONG_B + TAIL;
  h.book(raw);
  h.judge(raw, "manual", 0);
  h.judge(LONG_B, "jev", 0.9);
  const plan = planSummaryCleanup(h.db);
  assert.equal(plan.judgments.find((judgment) => judgment.hash === summaryHashOf(LONG_B))?.outcome, "manual-replaced");
  h.judge(LONG_B, "manual", 1, "synopsis", "2026-10-05T00:00:00.000Z");
  const applied = applySummaryCleanup(h.db, plan);
  assert.equal(applied.judgmentsWritten, 0);
  assert.deepEqual(h.judgment(LONG_B), { model: "manual", usable: 1, kind: "synopsis", asked_at: "2026-10-05T00:00:00.000Z" });
});
