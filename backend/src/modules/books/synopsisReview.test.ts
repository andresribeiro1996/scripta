import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "synopsis-review-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { BookNotFoundError } = await import("./domain/errors.js");
const { reviewSynopsisWith, synopsisReviewWith, SYNOPSIS_REVIEW_LIMIT } = await import("./synopsisReview.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const AT = "2026-10-15T12:00:00.000Z";

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function seed(repo: Repo, isbn: string, title: string, summary: string) {
  const book = repo.createBook({ title, author: "Author", isbn }, [`isbn:${isbn}`], AT);
  repo.mergeDetails(book.id, { summary, pages: null, year: null, publisher: null, translator: null }, "publisher");
  return repo.getBook(book.id)!;
}

const judge = (repo: Repo, hash: string, model: string, usable: number, kind: "praise" | "fragment" | "synopsis" = "praise") =>
  repo.saveSynopsisJudgment(hash, { model, usable, kind, askedAt: AT });

test("hidden and doubtful texts are listed, finished and most-held first; kept, shown and manual ones are not", () => {
  const repo = freshRepo();
  const hidden = seed(repo, "9789720000071", "Zeta", "Praise for the author, in quotes, again and again and again.");
  const rule = seed(repo, "9789720000072", "Alpha", "Text: Portugese");
  const doubtful = seed(repo, "9789720000073", "Beta", "Mostly the author's life story, with a line about the book.");
  const shown = seed(repo, "9789720000074", "Gamma", "A long description of what the book is about, its story and people.");
  const manual = seed(repo, "9789720000075", "Delta", "Praise that the owner chose to keep, again and again and again.");
  judge(repo, hidden.summary_hash!, "jev-1.13.0", 0.12);
  judge(repo, rule.summary_hash!, "rule", 0, "fragment");
  judge(repo, doubtful.summary_hash!, "jev-1.13.0", 0.41);
  judge(repo, shown.summary_hash!, "jev-1.13.0", 0.8, "synopsis");
  judge(repo, manual.summary_hash!, "manual", 1);
  const review = synopsisReviewWith(repo, [{ workId: hidden.work_id!, holders: 1, finished: true }, { workId: doubtful.work_id!, holders: 3, finished: false }], (id) => `thumb:${id}`);
  assert.equal(review.total, 3);
  assert.deepEqual(review.items.map((item) => [item.title, item.group, item.holders, item.finished]), [
    ["Zeta", "hidden", 1, true],
    ["Beta", "doubtful", 3, false],
    ["Alpha", "hidden", 0, false]
  ]);
  assert.equal(review.items[0]!.source, "publisher");
  assert.equal(review.items[0]!.editions, 1);
});

test("a text on several editions is one item, and the list keeps at most 200 with the full total", () => {
  const repo = freshRepo();
  const text = "Praise for the author, in quotes, again and again and again.";
  const a = seed(repo, "9789720000076", "Shared", text);
  seed(repo, "9789720000077", "Shared again", text);
  judge(repo, a.summary_hash!, "jev-1.13.0", 0.1);
  assert.deepEqual(synopsisReviewWith(repo, [], (id) => id).items.map((item) => [item.title, item.editions]), [["Shared", 2]]);
  for (let n = 0; n < SYNOPSIS_REVIEW_LIMIT; n++) judge(repo, seed(repo, `978973${String(n).padStart(7, "0")}`, `Book ${n}`, `${text} ${n}`).summary_hash!, "jev-1.13.0", 0.1);
  const big = synopsisReviewWith(repo, [], (id) => id);
  assert.equal(big.items.length, SYNOPSIS_REVIEW_LIMIT);
  assert.equal(big.total, SYNOPSIS_REVIEW_LIMIT + 1);
});

test("keep and hide store a manual judgment; an unknown hash is not found", () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000078", "Kept", "Praise for the author, in quotes, again and again and again.");
  judge(repo, book.summary_hash!, "jev-1.13.0", 0.1);
  assert.deepEqual(reviewSynopsisWith(repo, book.summary_hash!, "keep", () => Date.parse(AT)), { hash: book.summary_hash });
  assert.deepEqual(repo.synopsisJudgments([book.summary_hash!]).get(book.summary_hash!), { model: "manual", usable: 1, kind: "praise", askedAt: AT });
  assert.equal(synopsisReviewWith(repo, [], (id) => id).total, 0);
  reviewSynopsisWith(repo, book.summary_hash!, "hide", () => Date.parse(AT));
  assert.equal(repo.synopsisJudgments([book.summary_hash!]).get(book.summary_hash!)?.usable, 0);
  assert.throws(() => reviewSynopsisWith(repo, "f".repeat(40), "keep", () => Date.parse(AT)), BookNotFoundError);
});
