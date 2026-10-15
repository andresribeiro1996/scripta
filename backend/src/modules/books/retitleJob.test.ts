import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { CatalogSearchHit } from "./domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "retitle-job-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { SourcePausedError, SourceUnavailableError } = await import("./domain/errors.js");
const { catalogTitleKey } = await import("./domain/normalize.js");
const { applyMojibakeRepairs } = await import("./seed/mojibakeRepair.js");
const { RETITLE_BATCH_SIZE, retitleWanted } = await import("./retitleJob.js");

const NOW = "2026-10-01T00:00:00.000Z";
const at = (days: number) => new Date(Date.parse(NOW) + days * 24 * 60 * 60 * 1000).toISOString();

const hit = (title: string, authors: string[]): CatalogSearchHit => ({
  result: { title, authors, year: null, isbn: null, publisher: null, coverUrl: null, genres: [] },
  olCoverId: null,
  source: "isbndb"
});

function setup(answer: (isbn: string) => Promise<CatalogSearchHit[]> = async () => []) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const asked: string[] = [];
  const infos: Array<[object, string]> = [];
  const warns: Array<[object, string]> = [];
  const deps = {
    repo,
    isbndb: {
      search: async (query: { isbn: string } | { text: string }) => {
        const isbn = "isbn" in query ? query.isbn : "";
        asked.push(isbn);
        return answer(isbn);
      }
    },
    write: (plan: Parameters<typeof applyMojibakeRepairs>[1]) => applyMojibakeRepairs(db, plan),
    info: (details: object, message: string) => {
      infos.push([details, message]);
    },
    warn: (details: object, message: string) => {
      warns.push([details, message]);
    }
  };
  const book = (title: string, author: string, isbn: string, createdAt = NOW) =>
    repo.createBook({ title, author, isbn, createdBy: "publisher" }, [`isbn:${isbn}`, catalogTitleKey(title, author)!], createdAt);
  const marked = () => repo.listRetitleWanted(100).map((row) => row.id);
  const run = (limit = RETITLE_BATCH_SIZE) => retitleWanted(deps, limit);
  return { db, repo, asked, infos, warns, book, marked, run };
}

test("a marked book is re-titled from ISBNdb, its work too, and its mark is cleared", async () => {
  const h = setup(async () => [hit("Pássaro Azul", ["Inês Duarte"])]);
  const created = h.book("P©ssaro Azul", "In©s Duarte", "9789890000109");
  assert.equal(await h.run(), null);
  assert.equal(h.repo.getBook(created.id)!.title, "Pássaro Azul");
  assert.equal(h.repo.getBook(created.id)!.author, "Inês Duarte");
  assert.deepEqual({ ...(h.db.prepare("SELECT title, author FROM works WHERE id = ?").get(created.work_id) as object) }, { title: "Pássaro Azul", author: "Inês Duarte" });
  assert.deepEqual(h.marked(), []);
  assert.deepEqual(h.infos, [[{ bookId: created.id, from: "P©ssaro Azul — In©s Duarte", to: "Pássaro Azul — Inês Duarte" }, "lossy book re-titled"]]);
});

test("a book ISBNdb doesn't know, or spells differently, is left as it is and unmarked", async () => {
  const h = setup(async (isbn) => (isbn === "9789890000116" ? [hit("Outro Livro", ["Ana Lima"])] : []));
  const unknown = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  const different = h.book("P©ssaro Verde", "Ana Lima", "9789890000116");
  await h.run();
  assert.equal(h.repo.getBook(unknown.id)!.title, "P©ssaro Azul");
  assert.equal(h.repo.getBook(different.id)!.title, "P©ssaro Verde");
  assert.deepEqual(h.marked(), []);
  assert.deepEqual(h.infos.map(([, message]) => message), ["lossy book left", "lossy book left"]);
});

test("a marked book that is no longer lossy is unmarked without a request", async () => {
  const h = setup();
  const created = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  h.db.prepare("UPDATE books SET title = 'Pássaro Azul' WHERE id = ?").run(created.id);
  await h.run();
  assert.deepEqual(h.asked, []);
  assert.deepEqual(h.marked(), []);
});

test("an outage keeps the mark and the run goes on to the next book", async () => {
  const h = setup(async (isbn) => {
    if (isbn === "9789890000109") throw new SourceUnavailableError("isbndb", "HTTP 503", { status: 503 });
    return [hit("Pássaro Verde", ["Ana Lima"])];
  });
  const failing = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  const next = h.book("P©ssaro Verde", "Ana Lima", "9789890000116", at(1));
  assert.equal(await h.run(), null);
  assert.deepEqual(h.marked(), [failing.id]);
  assert.equal(h.repo.getBook(next.id)!.title, "Pássaro Verde");
  assert.equal(h.warns.length, 1);
});

test("a pause returns its retry time and keeps every mark", async () => {
  const retryAt = Date.parse("2026-10-02T00:00:00.000Z");
  const h = setup(async () => {
    throw new SourcePausedError("isbndb", "paused", { retryAt });
  });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  h.book("P©ssaro Verde", "Ana Lima", "9789890000116", at(1));
  assert.equal(await h.run(), retryAt);
  assert.equal(h.asked.length, 1);
  assert.equal(h.marked().length, 2);
});

test("the oldest marks go first, up to the limit", async () => {
  const h = setup();
  h.book("P©ssaro 2", "Ana Lima", "9789890000116", at(2));
  h.book("P©ssaro 1", "Ana Lima", "9789890000109", at(1));
  h.book("P©ssaro 3", "Ana Lima", "9789720000101", at(3));
  await h.run(2);
  assert.deepEqual(h.asked, ["9789890000109", "9789890000116"]);
  assert.equal(h.marked().length, 1);
});

test("a lossy book without a mark is never asked about", async () => {
  const h = setup(async () => [hit("Pássaro Azul", ["Ana Lima"])]);
  const backlog = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  h.db.prepare("UPDATE books SET retitle_wanted_at = NULL WHERE id = ?").run(backlog.id);
  await h.run();
  assert.deepEqual(h.asked, []);
  assert.equal(h.repo.getBook(backlog.id)!.title, "P©ssaro Azul");
});

test("a book stored with an ISBN-10 is asked about by its ISBN-13", async () => {
  const h = setup();
  h.book("P©ssaro Azul", "Ana Lima", "972000000X");
  await h.run();
  assert.deepEqual(h.asked, ["9789720000002"]);
});

test("a book edited while ISBNdb answers keeps the edit, logs no change and is unmarked", async () => {
  let edit: () => unknown = () => undefined;
  const h = setup(async () => {
    edit();
    return [hit("Pássaro Azul", ["Ana Lima"])];
  });
  const created = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  edit = () => h.db.prepare("UPDATE books SET author = 'Rui Costa' WHERE id = ?").run(created.id);
  await h.run();
  assert.equal(h.repo.getBook(created.id)!.title, "P©ssaro Azul");
  assert.equal(h.repo.getBook(created.id)!.author, "Rui Costa");
  assert.deepEqual(h.infos.map(([, message]) => message), ["lossy book left"]);
  assert.deepEqual(h.marked(), []);
});
