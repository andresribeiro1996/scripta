import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-genre-pass-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { resolveWorksWith } = await import("./works.js");
const { GenreLabelsError, genrePassWorksWith, importGenreLabelsWith, longestSynopsis } = await import("./genrePass.js");

function seeded() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const [blank, tagged, other] = resolveWorksWith(repo, [
    { isbn: "9789722031240", title: "Os Anões", author: "Harold Pinter" },
    { isbn: null, title: "Dune", author: "Frank Herbert" },
    { isbn: null, title: "Orlando", author: "Virginia Woolf" }
  ]);
  db.prepare("UPDATE books SET summary = 'Um romance.', language = 'pt-PT', publisher = 'Relógio' WHERE work_id = ?").run(blank!);
  db.prepare("UPDATE books SET genres = ? WHERE work_id = ?").run(JSON.stringify(["Science Fiction"]), tagged!);
  return { db, repo, blank: blank!, tagged: tagged!, other: other! };
}

const row = (db: DatabaseSync, workId: string) => ({ ...db.prepare("SELECT genres, genres_source, genres_confidence FROM books WHERE work_id = ?").get(workId) });

test("the export lists held works with no genres, finished ones first", () => {
  const { repo, blank, tagged, other } = seeded();
  const rows = genrePassWorksWith(repo, [
    { workId: other, holders: 1, finished: false },
    { workId: blank, holders: 2, finished: true },
    { workId: tagged, holders: 1, finished: true }
  ]);
  assert.deepEqual(rows.map((entry) => entry.workId), [blank, other]);
  assert.deepEqual(rows[0], { workId: blank, title: "Os Anões", author: "Harold Pinter", editions: [{ title: "Os Anões", language: "pt-PT", isbn: "9789722031240", publisher: "Relógio", year: null }], synopsis: "Um romance.", finished: true, holders: 2, jev: null });
});

test("the export merges the holders of works merged into one", () => {
  const { repo, blank, other } = seeded();
  repo.mergeWorks(other, blank);
  const rows = genrePassWorksWith(repo, [{ workId: blank, holders: 1, finished: false }, { workId: other, holders: 2, finished: true }]);
  assert.deepEqual(rows.map((entry) => [entry.workId, entry.holders, entry.finished]), [[blank, 3, true]]);
});

test("the longest synopsis is cut at the limit", () => {
  const evidence = { work: { id: "w", title: "T", author: "A", summary: "short" }, editions: [{ title: "T", language: null, isbn: null, publisher: null, year: null, summary: "x".repeat(1500) }] };
  assert.equal(longestSynopsis(evidence), "x".repeat(1200));
  assert.equal(longestSynopsis({ ...evidence, work: { ...evidence.work, summary: null }, editions: [] }), null);
});

test("an import rejects unknown genres, unknown works and bad files without writing", () => {
  const { db, repo, blank } = seeded();
  assert.throws(() => importGenreLabelsWith(repo, [{ workId: blank, genres: ["Poetry"] }, { workId: blank, genres: ["Novel"] }]), GenreLabelsError);
  assert.throws(() => importGenreLabelsWith(repo, [{ workId: "missing", genres: ["Poetry"] }]), GenreLabelsError);
  assert.throws(() => importGenreLabelsWith(repo, { workId: blank }), GenreLabelsError);
  assert.equal(row(db, blank).genres, "[]");
});

test("an import fills empty, Jev and earlier manual editions, never source genres, and repeats as a no-op", () => {
  const { db, repo, blank, tagged, other } = seeded();
  db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.6 WHERE work_id = ?").run(JSON.stringify(["Biography & Memoir"]), other);
  const labels = [{ workId: blank, genres: ["Literary Fiction"] }, { workId: tagged, genres: ["Poetry"] }, { workId: other, genres: ["Historical Fiction", "Classics"] }];
  assert.deepEqual(importGenreLabelsWith(repo, labels), { works: 2, editions: 2, skipped: [tagged] });
  assert.deepEqual(row(db, other), { genres: JSON.stringify(["Historical Fiction", "Classics"]), genres_source: "manual", genres_confidence: null });
  assert.deepEqual(row(db, tagged), { genres: JSON.stringify(["Science Fiction"]), genres_source: null, genres_confidence: null });
  assert.deepEqual(importGenreLabelsWith(repo, labels), { works: 0, editions: 0, skipped: [blank, tagged, other] });
  assert.deepEqual(importGenreLabelsWith(repo, [{ workId: other, genres: ["History"] }, { workId: blank, genres: [] }]), { works: 1, editions: 1, skipped: [blank] });
});

test("the export also lists works whose only genres are Jev's possible ones, with Jev's answer", () => {
  const { db, repo, blank, tagged } = seeded();
  repo.saveGenreJudgment({ workId: blank, model: "jev-1.13.0", genre: "Biography & Memoir", confidence: 0.6, askedAt: "2026-10-14T00:00:00.000Z" });
  repo.applyGenreJudgments(0.5);
  db.prepare("UPDATE books SET genres = ?, genres_source = 'jev', genres_confidence = 0.95 WHERE work_id = ?").run(JSON.stringify(["Science Fiction"]), tagged);
  const rows = genrePassWorksWith(repo, [{ workId: blank, holders: 1, finished: true }, { workId: tagged, holders: 1, finished: true }]);
  assert.deepEqual(rows.map((entry) => [entry.workId, entry.jev]), [[blank, { genre: "Biography & Memoir", confidence: 0.6 }]]);
});

test("an empty label records a manual none judgment so Jev is not asked, and repeats as a no-op", () => {
  const { db, repo, blank } = seeded();
  db.prepare("UPDATE books SET details_status = 'missing' WHERE work_id = ?").run(blank);
  assert.deepEqual(repo.worksNeedingGenreJudgment([blank], 10), [blank]);
  assert.deepEqual(importGenreLabelsWith(repo, [{ workId: blank, genres: [] }]), { works: 0, editions: 0, skipped: [blank] });
  assert.equal(repo.genreJudgments([blank]).get(blank)?.genre, null);
  assert.equal(repo.genreJudgments([blank]).get(blank)?.confidence, 1);
  assert.deepEqual(repo.worksNeedingGenreJudgment([blank], 10), []);
  assert.deepEqual(importGenreLabelsWith(repo, [{ workId: blank, genres: [] }]), { works: 0, editions: 0, skipped: [blank] });
  assert.equal(row(db, blank).genres, "[]");
});
