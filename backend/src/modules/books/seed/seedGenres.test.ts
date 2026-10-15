import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "seed-genres-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { fillSeedGenres } = await import("./seedGenres.js");

const AT = "2026-10-15T00:00:00.000Z";
const entry = (isbn: string, workKey: string, subjects: string[]) => ({ isbn, title: "T", author: "A", lang: "eng" as const, workKey, readers: 1, subjects, languages: [] });

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const book = (title: string, isbn: string, workKey?: string) => repo.createBook({ title, author: "A", isbn, workKey, createdBy: "seed" }, [`isbn:${isbn}`], AT);
  const genres = (id: string) => ({ ...(db.prepare("SELECT genres, genres_source FROM books WHERE id = ?").get(id) as { genres: string; genres_source: string | null }) });
  return { db, repo, book, genres };
}

test("seed subjects label works found by work key or ISBN, once each", () => {
  const s = setup();
  const keyed = s.book("Dune", "9780441013593", "OL1W");
  const byIsbn = s.book("Emma", "9780141439587");
  const report = fillSeedGenres([
    entry("9780441013593", "/works/OL1W", ["Science fiction", "Large type books"]),
    entry("9780441013593", "/works/OL1W", ["Fantasy"]),
    entry("9780141439587", "/works/OL999W", ["Fiction, romance, general"]),
    entry("9780000000002", "/works/OL404W", ["Poetry"]),
    entry("9780441172696", "/works/OL404W", [])
  ], s.repo, { dryRun: false });
  assert.deepEqual(report, { fetched: 5, matched: 2, labelled: 2, editions: 2, noGenre: 0, unmatched: 2 });
  assert.deepEqual(s.genres(keyed.id), { genres: JSON.stringify(["Science Fiction"]), genres_source: null });
  assert.deepEqual(s.genres(byIsbn.id), { genres: JSON.stringify(["Romance"]), genres_source: null });
});

test("subjects that map to nothing are counted, and genres already present stay", () => {
  const s = setup();
  const bare = s.book("Notes", "9780000000019", "OL2W");
  const owned = s.book("Owned", "9780000000026", "OL3W");
  s.db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.6 WHERE id = ?").run(JSON.stringify(["History"]), owned.id);
  const report = fillSeedGenres([entry("9780000000019", "/works/OL2W", ["Large type books"]), entry("9780000000026", "/works/OL3W", ["Poetry"])], s.repo, { dryRun: false });
  assert.deepEqual(report, { fetched: 2, matched: 2, labelled: 0, editions: 0, noGenre: 1, unmatched: 0 });
  assert.equal(s.genres(bare.id).genres, "[]");
  assert.deepEqual(s.genres(owned.id), { genres: JSON.stringify(["History"]), genres_source: "jev" });
});

test("a dry run writes nothing but counts what it would label, and a repeat labels nothing", () => {
  const s = setup();
  const dune = s.book("Dune", "9780441013593", "OL1W");
  const entries = [entry("9780441013593", "/works/OL1W", ["Science fiction"])];
  assert.deepEqual(fillSeedGenres(entries, s.repo, { dryRun: true }), { fetched: 1, matched: 1, labelled: 1, editions: 0, noGenre: 0, unmatched: 0 });
  assert.equal(s.genres(dune.id).genres, "[]");
  fillSeedGenres(entries, s.repo, { dryRun: false });
  assert.deepEqual(fillSeedGenres(entries, s.repo, { dryRun: false }), { fetched: 1, matched: 1, labelled: 0, editions: 0, noGenre: 0, unmatched: 0 });
});
