import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { NewBook } from "../domain/types.js";

const scratch = mkdtempSync(join(tmpdir(), "mojibake-repair-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { catalogTitleKey, workTitleKey } = await import("../domain/normalize.js");
const { applyMojibakeRepairs, mojibakeReport, planMojibakeRepairs } = await import("./mojibakeRepair.js");

const NOW = "2026-10-01T00:00:00.000Z";
const BROKEN_TITLE = "Entre a fÃ© e a crenÃ§a";
const BROKEN_AUTHOR = "JosÃ© Silva";
const TITLE = "Entre a fé e a crença";
const AUTHOR = "José Silva";
const TITLE_KEY = "ta:entre a fe e a crenca|jose silva|";

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const book = (title: string, author: string, isbn: string | null, extra: Partial<NewBook> = { createdBy: "seed" }) => {
    const keys = [isbn && `isbn:${isbn}`, catalogTitleKey(title, author)].filter((key): key is string => Boolean(key));
    return repo.createBook({ title, author, isbn, ...extra }, keys, NOW);
  };
  const stored = (id: string) => ({ ...(db.prepare("SELECT title, author, title_key FROM books WHERE id = ?").get(id) as { title: string; author: string; title_key: string | null }) });
  const searchText = (id: string) => ({ ...(db.prepare("SELECT title, author FROM books_fts WHERE book_id = ?").get(id) as { title: string; author: string }) });
  const keys = (id: string) => (db.prepare("SELECT key FROM book_keys WHERE book_id = ? ORDER BY key").all(id) as Array<{ key: string }>).map((row) => row.key);
  const dump = () => ["books", "works", "book_keys", "books_fts"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  return { db, repo, book, stored, searchText, keys, dump };
}

test("repairs a mis-decoded book and everything derived from it", () => {
  const h = setup();
  const created = h.book(BROKEN_TITLE, BROKEN_AUTHOR, "9780000000002");
  const brokenKey = catalogTitleKey(BROKEN_TITLE, BROKEN_AUTHOR)!;
  const plan = planMojibakeRepairs(h.db);
  const applied = applyMojibakeRepairs(h.db, plan);
  assert.deepEqual(applied, { books: 1, works: 1, skipped: 0 });
  assert.deepEqual(h.stored(created.id), { title: TITLE, author: AUTHOR, title_key: workTitleKey(TITLE, AUTHOR) });
  assert.equal(h.stored(created.id).title_key, TITLE_KEY);
  assert.equal(h.repo.findBookByKey(TITLE_KEY)?.id, created.id);
  assert.equal(h.repo.findBookByKey(brokenKey)?.id, created.id);
  assert.deepEqual(h.searchText(created.id), { title: TITLE, author: AUTHOR });
  assert.deepEqual({ ...(h.db.prepare("SELECT title, author FROM works WHERE id = ?").get(created.work_id) as object) }, { title: TITLE, author: AUTHOR });
  const report = mojibakeReport(plan, applied);
  assert.equal(report.dryRun, false);
  assert.deepEqual(report.applied, applied);
  assert.deepEqual(report.examples, [{ id: created.id, from: `${BROKEN_TITLE} — ${BROKEN_AUTHOR}`, to: `${TITLE} — ${AUTHOR}` }]);
  const rerun = planMojibakeRepairs(h.db);
  assert.deepEqual([rerun.books, rerun.works], [[], []]);
});

test("leaves correct and guarded text alone", () => {
  const h = setup();
  h.book("Coração", "Ana Lima", "9780000000026");
  h.book("NESCAFÉ® Receitas", "Rui Costa", "9780000000033");
  const before = h.dump();
  const plan = planMojibakeRepairs(h.db);
  assert.deepEqual([plan.books, plan.works, plan.stillBroken], [[], [], []]);
  assert.deepEqual(applyMojibakeRepairs(h.db, plan), { books: 0, works: 0, skipped: 0 });
  assert.deepEqual(h.dump(), before);
});

test("planning writes nothing", () => {
  const h = setup();
  h.book(BROKEN_TITLE, BROKEN_AUTHOR, "9780000000002");
  const before = h.dump();
  const plan = planMojibakeRepairs(h.db);
  assert.equal(plan.books.length, 1);
  assert.equal(plan.works.length, 1);
  assert.deepEqual(h.dump(), before);
});

test("a book edited after the scan is skipped and keeps the edit", () => {
  const h = setup();
  const created = h.book(BROKEN_TITLE, BROKEN_AUTHOR, "9780000000002");
  const plan = planMojibakeRepairs(h.db);
  h.db.prepare("UPDATE books SET title = 'Edited' WHERE id = ?").run(created.id);
  assert.deepEqual(applyMojibakeRepairs(h.db, plan), { books: 0, works: 1, skipped: 1 });
  assert.equal(h.stored(created.id).title, "Edited");
  assert.equal(h.repo.findBookByKey(TITLE_KEY), undefined);
  assert.deepEqual(h.searchText(created.id), { title: BROKEN_TITLE, author: BROKEN_AUTHOR });
});

test("a work edited after the scan is skipped and keeps the edit", () => {
  const h = setup();
  const created = h.book(BROKEN_TITLE, BROKEN_AUTHOR, "9780000000002");
  const plan = planMojibakeRepairs(h.db);
  h.db.prepare("UPDATE works SET title = 'Edited' WHERE id = ?").run(created.work_id);
  assert.deepEqual(applyMojibakeRepairs(h.db, plan), { books: 1, works: 0, skipped: 1 });
  assert.deepEqual({ ...(h.db.prepare("SELECT title, author FROM works WHERE id = ?").get(created.work_id) as object) }, { title: "Edited", author: BROKEN_AUTHOR });
});

test("stores the repaired text as returned, without trimming", () => {
  const h = setup();
  const created = h.book(" Livro da fÃ© ", "Ana Lima", null);
  applyMojibakeRepairs(h.db, planMojibakeRepairs(h.db));
  assert.equal(h.stored(created.id).title, " Livro da fé ");
});

test("a repaired title key held by another book stays with that book", () => {
  const h = setup();
  const holder = h.book(TITLE, AUTHOR, "9780000000019");
  const broken = h.book(BROKEN_TITLE, BROKEN_AUTHOR, "9780000000002");
  assert.deepEqual(applyMojibakeRepairs(h.db, planMojibakeRepairs(h.db)), { books: 1, works: 1, skipped: 0 });
  assert.equal(h.repo.findBookByKey(TITLE_KEY)?.id, holder.id);
  assert.deepEqual(h.stored(broken.id), { title: TITLE, author: AUTHOR, title_key: TITLE_KEY });
});

test("an ISBN-less book with a blank author is found under its corrected title key", () => {
  const h = setup();
  const created = h.book("Livro da fÃ©", "", null);
  assert.deepEqual(h.keys(created.id), ["ta:livro da fa||"]);
  applyMojibakeRepairs(h.db, planMojibakeRepairs(h.db));
  assert.equal(h.repo.findBookByKey("ta:livro da fe||")?.id, created.id);
  assert.equal(h.repo.findBookByKey("ta:livro da fa||")?.id, created.id);
});

test("an ISBN book with a blank author is given no title key", () => {
  const h = setup();
  const created = h.repo.createBook({ title: "Outro livro da fÃ©", author: "", isbn: "9780000000057", createdBy: "seed" }, ["isbn:9780000000057"], NOW);
  applyMojibakeRepairs(h.db, planMojibakeRepairs(h.db));
  assert.equal(h.stored(created.id).title, "Outro livro da fé");
  assert.deepEqual(h.keys(created.id), ["isbn:9780000000057"]);
});

test("search rows follow their own books, and a book that is not searchable gains none", () => {
  const h = setup();
  const first = h.book("Livro 1 da fÃ©", "Ana Lima", "9780000000002");
  const hidden = h.book("Livro 2 da fÃ©", "Ana Lima", "9780000000019", {});
  const last = h.book("Livro 3 da fÃ©", "Ana Lima", "9780000000026");
  assert.equal(h.repo.isSearchable(hidden.id), false);
  assert.deepEqual(applyMojibakeRepairs(h.db, planMojibakeRepairs(h.db)), { books: 3, works: 3, skipped: 0 });
  assert.deepEqual(h.searchText(first.id), { title: "Livro 1 da fé", author: "Ana Lima" });
  assert.deepEqual(h.searchText(last.id), { title: "Livro 3 da fé", author: "Ana Lima" });
  assert.deepEqual(h.searchText(hidden.id), {});
  assert.equal(h.stored(hidden.id).title, "Livro 2 da fé");
});

test("reports what it cannot repair", () => {
  const h = setup();
  const lossy = h.book("P©ssaro Azul", "Ana Lima", "9780000000040");
  const plan = planMojibakeRepairs(h.db);
  assert.deepEqual(plan.stillBroken, [{ id: lossy.id, title: "P©ssaro Azul", author: "Ana Lima" }]);
  assert.deepEqual(plan.books, []);
  assert.deepEqual(mojibakeReport(plan, null).stillBroken, { count: 1, examples: ["P©ssaro Azul — Ana Lima"] });
});

test("the report counts repairs, groups them by origin and caps the examples", () => {
  const h = setup();
  for (let n = 1; n <= 25; n++) h.book(n === 2 ? "Livro 2 da fé" : `Livro ${n} da fÃ©`, n <= 2 ? BROKEN_AUTHOR : "Ana Lima", null);
  for (let n = 1; n <= 11; n++) h.book(`P©ssaro ${n} Azul`, "Ana Lima", null);
  const plan = planMojibakeRepairs(h.db);
  const report = mojibakeReport(plan, null);
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.books, { scanned: 36, repaired: 25, titles: 24, authors: 2 });
  assert.deepEqual(report.works, { scanned: 36, repaired: 25 });
  assert.deepEqual(report.origins, { seed: 25 });
  assert.equal(report.examples.length, 20);
  assert.equal(report.stillBroken.count, 11);
  assert.equal(report.stillBroken.examples.length, 10);
  assert.equal(report.applied, null);
});

test("a book's origin is its creator, else its sources joined, else lookup", () => {
  const h = setup();
  h.book("Livro 1 da fÃ©", "Ana Lima", null, { createdBy: "publisher" });
  h.book("Livro 2 da fÃ©", "Ana Lima", null, { sources: ["openlibrary"] });
  h.book("Livro 3 da fÃ©", "Ana Lima", null, { sources: ["openlibrary", "isbndb"] });
  h.book("Livro 4 da fÃ©", "Ana Lima", null, {});
  assert.deepEqual(mojibakeReport(planMojibakeRepairs(h.db), null).origins, { publisher: 1, openlibrary: 1, "openlibrary+isbndb": 1, lookup: 1 });
});

test("a repairable book with unreadable sources fails the plan instead of being skipped", () => {
  const h = setup();
  const created = h.book("Livro da fÃ©", "Ana Lima", null, {});
  h.db.prepare("UPDATE books SET data_sources = 'not json' WHERE id = ?").run(created.id);
  assert.throws(() => planMojibakeRepairs(h.db), SyntaxError);
});
