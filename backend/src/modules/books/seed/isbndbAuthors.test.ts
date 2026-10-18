import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { CatalogSearchHit } from "../domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "isbndb-authors-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { SourcePausedError, SourceUnavailableError } = await import("../domain/errors.js");
const { catalogTitleKey } = await import("../domain/normalize.js");
const { applyIsbndbAuthors, isbndbAuthorReport, planIsbndbAuthors } = await import("./isbndbAuthors.js");

const NOW = "2026-10-01T00:00:00.000Z";
const CUS = "9789722020527";
const ORIANA = "9789726610458";
const SARAGOCA = "9789723301977";

const hit = (title: string, authors: string[]): CatalogSearchHit => ({ result: { title, authors, year: null, isbn: null, publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source: "isbndb" });

function setup(answers: Record<string, () => Promise<CatalogSearchHit[]>>) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const asked: string[] = [];
  const isbndb = { search: async (query: { isbn: string } | { text: string }) => { const isbn = "isbn" in query ? query.isbn : ""; asked.push(isbn); return answers[isbn] ? answers[isbn]() : []; } };
  const book = (isbn: string | null, title: string, author = "") => repo.createBook({ title, author, isbn, createdBy: "seed" }, isbn ? [`isbn:${isbn}`] : [], NOW);
  return { db, repo, isbndb, asked, book };
}

test("a matching ISBNdb record fills the author and claims the title key", async () => {
  const h = setup({ [CUS]: async () => [hit("Os Cus De Judas", ["António Lobo Antunes"])] });
  const row = h.book(CUS, "Os Cus de Judas");

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });
  assert.equal(h.repo.getBook(row.id)!.author, "");
  const applied = applyIsbndbAuthors(h.repo, plan);

  assert.equal(applied, 1);
  assert.equal(h.repo.getBook(row.id)!.author, "António Lobo Antunes");
  assert.equal(h.repo.getBook(row.id)!.title, "Os Cus de Judas");
  assert.equal(h.repo.findBookByKey(catalogTitleKey("Os Cus de Judas", "António Lobo Antunes")!)?.id, row.id);
  assert.deepEqual(isbndbAuthorReport(plan, applied), { selected: 1, noRecord: 0, noAuthor: 0, titleMismatch: 0, placeholder: 0, commaName: 0, mismatches: [], next: row.id, isbndb: { max: 10, asked: 1, unavailable: 0, notAsked: 0, pausedUntil: null }, fills: [{ id: row.id, isbn: CUS, title: "Os Cus de Judas", author: "António Lobo Antunes" }], wouldFill: 1, applied: 1 });
});

test("a record for another title, a placeholder, no record and no authors fill nothing", async () => {
  const h = setup({
    [CUS]: async () => [hit("Memória de Elefante", ["António Lobo Antunes"])],
    [ORIANA]: async () => [hit("A Fada Oriana", ["VV. AA."])],
    [SARAGOCA]: async () => [hit("Manuscrito Encontrado em Saragoça", [])]
  });
  h.book(CUS, "Os Cus de Judas");
  h.book(ORIANA, "A Fada Oriana");
  h.book(SARAGOCA, "Manuscrito Encontrado em Saragoça");
  h.book("9789720701794", "Espreita como funcionam as coisas");

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

  assert.deepEqual([plan.titleMismatch, plan.placeholder, plan.noAuthor, plan.noRecord, plan.fills.length], [1, 1, 1, 1, 0]);
});

test("books with an author, without an ISBN or without a title are not selected", async () => {
  const h = setup({});
  h.book(CUS, "Os Cus de Judas", "António Lobo Antunes");
  h.book(null, "Sem ISBN");
  h.book(ORIANA, "");

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

  assert.equal(plan.selected, 0);
  assert.deepEqual(h.asked, []);
});

test("--max limits the asks, next is the last book answered, and --after resumes after it", async () => {
  const h = setup({});
  const ids = [h.book(CUS, "Um"), h.book(ORIANA, "Dois"), h.book(SARAGOCA, "Três")].map((row) => row.id).sort();

  const first = await planIsbndbAuthors(h.db, h.isbndb, { max: 2, after: "" });
  assert.deepEqual([first.isbndb.asked, first.isbndb.notAsked, first.next], [2, 1, ids[1]]);

  const second = await planIsbndbAuthors(h.db, h.isbndb, { max: 2, after: first.next! });
  assert.deepEqual([second.selected, second.isbndb.asked, second.next], [1, 1, ids[2]]);
  assert.equal(h.asked.length, 3);
});

test("a pause or an outage stops the pass and next stays at the last book answered", async () => {
  for (const failure of [new SourcePausedError("isbndb", "paused", { retryAt: Date.parse("2026-10-18T00:00:00.000Z") }), new SourceUnavailableError("isbndb", "HTTP 503")]) {
    const h = setup({});
    const rows = [h.book(CUS, "Um"), h.book(ORIANA, "Dois"), h.book(SARAGOCA, "Três")].sort((a, b) => (a.id < b.id ? -1 : 1));
    h.isbndb.search = async (query) => {
      const isbn = "isbn" in query ? query.isbn : "";
      h.asked.push(isbn);
      if (isbn === rows[1]!.isbn) throw failure;
      return [];
    };

    const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

    assert.equal(plan.next, rows[0]!.id);
    assert.equal(h.asked.length, 2);
    assert.equal(plan.isbndb.notAsked, 2);
    if (failure instanceof SourcePausedError) assert.equal(plan.isbndb.pausedUntil, "2026-10-18T00:00:00.000Z");
    else assert.equal(plan.isbndb.unavailable, 1);
  }
});

test("an author filled since the plan was made is not overwritten", async () => {
  const h = setup({ [CUS]: async () => [hit("Os Cus de Judas", ["António Lobo Antunes"])] });
  const row = h.book(CUS, "Os Cus de Judas");
  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });
  h.repo.fillIdentity(row.id, "Os Cus de Judas", "A. Lobo Antunes");

  assert.equal(applyIsbndbAuthors(h.repo, plan), 0);
  assert.equal(h.repo.getBook(row.id)!.author, "A. Lobo Antunes");
});

test("a pause on the first ask keeps next at --after, so the next night resumes there", async () => {
  const h = setup({});
  const rows = [h.book(CUS, "Um"), h.book(ORIANA, "Dois"), h.book(SARAGOCA, "Três")].sort((a, b) => (a.id < b.id ? -1 : 1));
  h.isbndb.search = async () => {
    throw new SourcePausedError("isbndb", "paused", { retryAt: Date.parse("2026-10-18T00:00:00.000Z") });
  };

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: rows[0]!.id });

  assert.equal(plan.next, rows[0]!.id);
  assert.equal(plan.isbndb.asked, 0);
  assert.equal(plan.isbndb.notAsked, 2);
});

test("a name still in Last, First form fills nothing, and the stored translator is not an author", async () => {
  const h = setup({
    [CUS]: async () => [hit("Os Cus de Judas", ["Lobo Antunes, António"])],
    [ORIANA]: async () => [hit("Amok", ["Tullio Forgiarini", "Maria Bochicchio"])]
  });
  const cus = h.book(CUS, "Os Cus de Judas");
  const amok = h.book(ORIANA, "Amok");
  h.db.prepare("UPDATE books SET translator = ? WHERE id = ?").run("Maria Bochicchio", amok.id);

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

  assert.equal(plan.commaName, 1);
  assert.deepEqual(plan.fills.map((fill) => [fill.id, fill.author]), [[amok.id, "Tullio Forgiarini"]]);
  assert.ok(!plan.fills.some((fill) => fill.id === cus.id));
});

test("a title mismatch is listed with ISBNdb's title", async () => {
  const h = setup({ [CUS]: async () => [hit("Memória de Elefante", ["António Lobo Antunes"])] });
  const row = h.book(CUS, "Os Cus de Judas");

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

  assert.deepEqual(plan.mismatches, [{ id: row.id, title: "Os Cus de Judas", isbndbTitle: "Memória de Elefante" }]);
});

test("a translator with a role mark is not an author, but another role mark is only cleaned", async () => {
  const h = setup({
    [CUS]: async () => [hit("Amok", ["Tullio Forgiarini", "Maria Bochicchio (Tradutora)"])],
    [ORIANA]: async () => [hit("Amok Dois", ["Tullio Forgiarini", "Ana Lima (Translator)"])],
    [SARAGOCA]: async () => [hit("Livro", ["Rui Zink (org.)"])]
  });
  const one = h.book(CUS, "Amok");
  h.book(ORIANA, "Amok Dois");
  h.book(SARAGOCA, "Livro");
  h.db.prepare("UPDATE books SET translator = ? WHERE id = ?").run("Maria Bochicchio", one.id);

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

  assert.deepEqual(plan.fills.map((fill) => fill.author).sort(), ["Rui Zink", "Tullio Forgiarini", "Tullio Forgiarini"]);
});

test("a selected book whose stored ISBN is invalid is not asked and counts as passed", async () => {
  const h = setup({});
  const bad = h.book("123", "Inválido");
  const good = h.book(CUS, "Válido");

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

  assert.deepEqual(h.asked, [CUS]);
  assert.deepEqual([plan.selected, plan.isbndb.asked, plan.isbndb.notAsked, plan.next], [2, 1, 0, [bad.id, good.id].sort()[1]]);
});
