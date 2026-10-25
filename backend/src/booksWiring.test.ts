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
  R2_IMAGES_BUCKET: "",
  TYPESAFE_API_KEY: "test-typesafe-key",
  ISBNDB_API_KEY: "test-isbndb-key"
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

test("every books job arms its first run with its own delay and calls nothing before it fires", async (t) => {
  const delays: number[] = [];
  const requests: unknown[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const realFetch = globalThis.fetch;
  globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => {
    delays.push(delay ?? 0);
    return realSetTimeout(callback, delay, ...args);
  }) as typeof setTimeout;
  globalThis.fetch = ((input: unknown) => {
    requests.push(input);
    return Promise.reject(new Error("no network before a first run fires"));
  }) as typeof fetch;
  t.after(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.fetch = realFetch;
  });
  const app = buildApp();
  await app.ready();
  await app.close();
  const arenaSweep = 30_000;
  const expected = {
    detailsBackfill: 30_000,
    workKeyBackfill: 40_000,
    worksBackfill: 45_000,
    colorBackfill: 50_000,
    retitleJob: 55_000,
    genreSweep: 60_000,
    synopsisSweep: 75_000,
    translationSweep: 90_000,
    worksGrouping: 120_000,
    bnpSync: 150_000,
    koboCovers: 165_000
  };
  const wanted = new Map<number, number>([[arenaSweep, 1]]);
  for (const delay of Object.values(expected)) wanted.set(delay, (wanted.get(delay) ?? 0) + 1);
  for (const [delay, count] of wanted) {
    assert.ok(delays.filter((armed) => armed === delay).length >= count, `expected ${count} first runs armed at ${delay} ms`);
  }
  assert.deepEqual(requests.map(String).filter((url) => /typesafe|isbndb|bnportugal|porbase|openlibrary|cdn\.kobo\.com/.test(url)), []);
});
