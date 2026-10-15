import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-genre-review-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { BookNotFoundError } = await import("./domain/errors.js");
const { classifyWork } = await import("./genreJudgments.js");
const { GENRE_REVIEW_LIMIT, genreReviewWith, reviewGenreWith } = await import("./genreReview.js");

const AT = "2026-10-15T00:00:00.000Z";
const NOW = () => Date.parse(AT);
const cover = (imageId: string) => `https://images.test/${imageId}`;

function seeded(titles: string[]) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const books = titles.map((title) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], AT));
  const work = (title: string) => books[titles.indexOf(title)]!.work_id!;
  const held = (...names: string[]) => names.map((name) => ({ workId: work(name), holders: 1, finished: false }));
  const jev = (title: string, genre: string | null, confidence: number) => {
    repo.saveGenreJudgment({ workId: work(title), model: "jev-1.13.0", genre, confidence, askedAt: AT });
    repo.applyGenreJudgment(work(title), 0.5);
  };
  return { db, repo, work, held, jev };
}

test("the review lists rejected, none, unsure and possible works with their evidence", () => {
  const s = seeded(["Rejected", "Twice", "None", "Unsure", "Possible", "Confident", "Owner", "Sourced"]);
  for (let strike = 0; strike < 3; strike++) s.repo.recordGenreRejection({ workId: s.work("Rejected"), status: 400, reason: "HTTP 400", at: AT });
  for (let strike = 0; strike < 2; strike++) s.repo.recordGenreRejection({ workId: s.work("Twice"), status: 400, reason: "HTTP 400", at: AT });
  s.jev("None", null, 0.91);
  s.jev("Unsure", "Poetry", 0.34);
  s.jev("Possible", "History", 0.62);
  s.jev("Confident", "History", 0.9);
  s.repo.saveGenreJudgment({ workId: s.work("Owner"), model: "manual", genre: null, confidence: 1, askedAt: AT });
  s.db.prepare("UPDATE books SET genres = ? WHERE work_id = ?").run(JSON.stringify(["Fantasy"]), s.work("Sourced"));
  const review = genreReviewWith(s.repo, s.held("Rejected", "Twice", "None", "Unsure", "Possible", "Confident", "Owner", "Sourced"), cover);
  assert.equal(review.total, 4);
  assert.deepEqual(review.items.map((item) => [item.title, item.evidence]), [
    ["None", { group: "none", confidence: 0.91 }],
    ["Possible", { group: "possible", genre: "History", confidence: 0.62 }],
    ["Rejected", { group: "rejected", status: 400, reason: "HTTP 400", attempts: 3, lastAt: AT }],
    ["Unsure", { group: "unsure", genre: "Poetry", confidence: 0.34 }]
  ]);
});

test("items carry the cover, a 300-character synopsis and the holders, and no user ids", () => {
  const s = seeded(["Long"]);
  s.db.prepare("UPDATE books SET summary = ? WHERE work_id = ?").run("x".repeat(500), s.work("Long"));
  s.jev("Long", null, 0.8);
  s.db.prepare("INSERT INTO cover_images (id, book_id, source, source_url, width, height, byte_size, created_at) SELECT 'img1', id, 'apple', NULL, 600, 900, 1, ? FROM books WHERE work_id = ?").run(AT, s.work("Long"));
  s.db.prepare("UPDATE books SET cover_image_id = 'img1' WHERE work_id = ?").run(s.work("Long"));
  const [item] = genreReviewWith(s.repo, [{ workId: s.work("Long"), holders: 2, finished: true }], cover).items;
  assert.deepEqual(Object.keys(item!).sort(), ["author", "coverUrl", "evidence", "finished", "holders", "synopsis", "title", "workId"]);
  assert.equal(item!.coverUrl, "https://images.test/img1");
  assert.equal(item!.synopsis, "x".repeat(300));
  assert.deepEqual([item!.holders, item!.finished], [2, true]);
});

test("finished works come first, then the most held, then by title; the list stops at 200 with the full total", () => {
  const titles = Array.from({ length: GENRE_REVIEW_LIMIT + 1 }, (_, index) => `T${String(index).padStart(3, "0")}`);
  const s = seeded(titles);
  for (const title of titles) s.jev(title, null, 0.9);
  const held = titles.map((title, index) => ({ workId: s.work(title), holders: index === 5 ? 3 : 1, finished: index === 9 }));
  const review = genreReviewWith(s.repo, held, cover);
  assert.equal(review.total, GENRE_REVIEW_LIMIT + 1);
  assert.equal(review.items.length, GENRE_REVIEW_LIMIT);
  assert.deepEqual(review.items.slice(0, 3).map((item) => item.title), ["T009", "T005", "T000"]);
});

test("a held alias is listed as its canonical work", () => {
  const s = seeded(["Kept", "Merged"]);
  s.repo.mergeWorks(s.work("Merged"), s.work("Kept"));
  s.jev("Kept", null, 0.9);
  assert.deepEqual(genreReviewWith(s.repo, [{ workId: s.work("Merged"), holders: 1, finished: false }], cover).items.map((item) => item.workId), [s.work("Kept")]);
});

test("setting genres labels the work; no genre records the owner's choice; repeats change nothing", () => {
  const s = seeded(["Labelled", "Nothing"]);
  s.jev("Labelled", "Poetry", 0.3);
  assert.deepEqual(reviewGenreWith(s.repo, s.work("Labelled"), { genres: ["History"] }, NOW, () => {}), { workId: s.work("Labelled"), editions: 1 });
  assert.deepEqual(reviewGenreWith(s.repo, s.work("Labelled"), { genres: ["History"] }, NOW, () => {}), { workId: s.work("Labelled"), editions: 0 });
  assert.deepEqual(reviewGenreWith(s.repo, s.work("Nothing"), { genres: [] }, NOW, () => {}), { workId: s.work("Nothing"), editions: 0 });
  assert.equal(s.repo.genreJudgments([s.work("Nothing")]).get(s.work("Nothing"))?.model, "manual");
  assert.equal(genreReviewWith(s.repo, s.held("Labelled", "Nothing"), cover).total, 0);
});

test("retry clears the strikes and Jev's answer, keeps the owner's, and queues the canonical work", () => {
  const s = seeded(["Struck", "Merged", "Owner"]);
  s.repo.mergeWorks(s.work("Merged"), s.work("Struck"));
  for (let strike = 0; strike < 3; strike++) s.repo.recordGenreRejection({ workId: s.work("Struck"), status: 400, reason: "HTTP 400", at: AT });
  s.repo.saveGenreJudgment({ workId: s.work("Owner"), model: "manual", genre: null, confidence: 1, askedAt: AT });
  const queued: string[] = [];
  assert.deepEqual(reviewGenreWith(s.repo, s.work("Merged"), { retry: true }, NOW, (id) => queued.push(id)), { workId: s.work("Struck"), editions: 0 });
  reviewGenreWith(s.repo, s.work("Owner"), { retry: true }, NOW, (id) => queued.push(id));
  assert.deepEqual(queued, [s.work("Struck"), s.work("Owner")]);
  assert.equal(s.repo.genreRejections([s.work("Struck")]).size, 0);
  assert.equal(s.repo.genreJudgments([s.work("Owner")]).get(s.work("Owner"))?.model, "manual");
});

test("retry on a work showing Jev's possible genres replaces them with the new answer", async () => {
  const s = seeded(["Possible"]);
  s.jev("Possible", "Biography & Memoir", 0.6);
  reviewGenreWith(s.repo, s.work("Possible"), { retry: true }, NOW, () => {});
  await classifyWork({ repo: s.repo, classify: async () => ({ genre: "History", confidence: 0.9, model: "jev-1.13.0" }), now: NOW, alert: () => {} }, s.work("Possible"));
  assert.equal((s.db.prepare("SELECT genres FROM books WHERE work_id = ?").get(s.work("Possible")) as { genres: string }).genres, JSON.stringify(["History"]));
});

test("an unknown work is not found", () => {
  const s = seeded([]);
  assert.throws(() => reviewGenreWith(s.repo, "missing", { genres: ["History"] }, NOW, () => {}), BookNotFoundError);
});
