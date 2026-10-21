import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "books-wiring-"));
Object.assign(process.env, {
  JWT_ACCESS_SECRET: "a".repeat(64),
  JWT_REFRESH_SECRET: "b".repeat(64),
  AUTH_DB_PATH: join(dir, "auth.sqlite"),
  LIBRARY_DB_PATH: join(dir, "library.sqlite"),
  GALLERY_DB_PATH: join(dir, "gallery.sqlite"),
  COVERS_DB_PATH: join(dir, "covers.sqlite"),
  MURALS_DB_PATH: join(dir, "murals.sqlite"),
  SOCIALS_DB_PATH: join(dir, "socials.sqlite"),
  ARENA_DB_PATH: join(dir, "arena.sqlite"),
  TIERLISTS_DB_PATH: join(dir, "tierlists.sqlite"),
  QUIZZES_DB_PATH: join(dir, "quizzes.sqlite"),
  COMMUNITY_DB_PATH: join(dir, "community.sqlite"),
  WAITLIST_DB_PATH: join(dir, "waitlist.sqlite"),
  FILES_STORAGE_PATH: join(dir, "files"),
  R2_IMAGES_BUCKET: ""
});

const { buildApp } = await import("./app.js");
const { applyBooksMigrations } = await import("./modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { booksRepository } = await import("./modules/books/publicCoverLookup.js");

test("the app serves the books public reads from the plugin's repository, not a second connection", async (t) => {
  const lazy = booksRepository();
  const app = buildApp();
  t.after(() => app.close());
  await app.ready();
  assert.notEqual(booksRepository(), lazy);
  assert.throws(() => lazy.getBook("missing"));
  assert.equal(booksRepository().getBook("missing"), undefined);
});

test("the app joins a work to its original that was already queued when it started", async (t) => {
  const db = new DatabaseSync(process.env.COVERS_DB_PATH!);
  applyBooksMigrations(db);
  const seed = createSqliteBooksRepository(db);
  const at = new Date().toISOString();
  const pt = seed.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000501" }, ["isbn:9789720000501"], at);
  seed.setLanguage(pt.id, "pt-PT");
  seed.fillOriginalTitle(pt.id, "To the Lighthouse");
  const en = seed.createBook({ title: "To the Lighthouse", author: "Virginia Woolf", isbn: "9780156907501", workKey: "OL960W" }, ["isbn:9780156907501"], at);
  const ptWorkId = seed.getBook(pt.id)!.work_id!;
  const enWorkId = seed.getBook(en.id)!.work_id!;
  db.close();
  const app = buildApp();
  t.after(() => app.close());
  await app.ready();
  assert.equal(booksRepository().canonicalWorkIds([ptWorkId]).get(ptWorkId), enWorkId);
});
