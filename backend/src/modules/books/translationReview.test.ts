import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "translation-review-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { BookNotFoundError, WorkMergeError } = await import("./domain/errors.js");
const { matchWork } = await import("./translationJudgments.js");
const { reviewTranslationWith, translationReviewWith } = await import("./translationReview.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const AT = "2026-10-15T12:00:00.000Z";
const now = () => Date.parse(AT);

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function pair(repo: Repo, n: number) {
  const pt = repo.createBook({ title: `Livro ${n}`, author: "Autor", isbn: `978972000060${n}`, workKey: `OL97${n}0W` }, [`isbn:978972000060${n}`], AT);
  const en = repo.createBook({ title: `Book ${n}`, author: "Author", isbn: `978000000060${n}`, workKey: `OL97${n}1W` }, [`isbn:978000000060${n}`], AT);
  repo.setLanguage(pt.id, "pt-PT");
  return { pt: repo.getBook(pt.id)!, en: repo.getBook(en.id)! };
}

test("possible, blocked and merged pairs are listed with both sides; manual and undone ones are not", () => {
  const repo = freshRepo();
  const possible = pair(repo, 1);
  const blocked = pair(repo, 2);
  const merged = pair(repo, 3);
  const rejected = pair(repo, 4);
  repo.saveWorkMatchJudgment(possible.pt.work_id!, { model: "jev-1.13.0", intoWorkId: possible.en.work_id, confidence: 0.74, askedAt: AT });
  repo.saveWorkMatchJudgment(blocked.pt.work_id!, { model: "code", intoWorkId: blocked.en.work_id, confidence: null, askedAt: AT });
  repo.saveWorkMatchJudgment(merged.pt.work_id!, { model: "jev-1.13.0", intoWorkId: merged.en.work_id, confidence: 0.95, askedAt: AT });
  repo.mergeTranslation(merged.pt.work_id!, merged.en.work_id!, "jev", 0.95, AT);
  repo.saveWorkMatchJudgment(rejected.pt.work_id!, { model: "manual", intoWorkId: null, confidence: null, askedAt: AT });
  const review = translationReviewWith(repo, [{ workId: blocked.pt.work_id!, holders: 2, finished: true }], (id) => `thumb:${id}`);
  assert.equal(review.total, 3);
  assert.deepEqual(review.items.map((item) => [item.title, item.group, item.proposed.title]), [["Livro 2", "blocked", "Book 2"], ["Livro 1", "possible", "Book 1"], ["Livro 3", "merged", "Book 3"]]);
  assert.equal(review.items[0]!.holders, 2);
  assert.equal(review.items[2]!.mergedAt, AT);
});

test("merge, reject and undo store the owner's call; an arena or a stale undo is a merge error", () => {
  const repo = freshRepo();
  const a = pair(repo, 5);
  const deps = { repo, sharesArena: () => false, now };
  assert.deepEqual(reviewTranslationWith(deps, a.pt.work_id!, { merge: a.en.work_id! }), { workId: a.pt.work_id });
  assert.equal(repo.getBook(a.pt.id)!.work_id, a.en.work_id);
  assert.equal(repo.workMatchJudgments([a.pt.work_id!]).get(a.pt.work_id!)?.model, "manual");
  reviewTranslationWith(deps, a.pt.work_id!, { undo: true });
  assert.equal(repo.getBook(a.pt.id)!.work_id, a.pt.work_id);
  assert.deepEqual(repo.workMatchJudgments([a.pt.work_id!]).get(a.pt.work_id!), { model: "manual", intoWorkId: null, confidence: null, askedAt: AT });
  assert.throws(() => reviewTranslationWith(deps, a.pt.work_id!, { undo: true }), WorkMergeError);

  const b = pair(repo, 6);
  assert.throws(() => reviewTranslationWith({ ...deps, sharesArena: () => true }, b.pt.work_id!, { merge: b.en.work_id! }), WorkMergeError);
  assert.equal(repo.getBook(b.pt.id)!.work_id, b.pt.work_id);
  reviewTranslationWith(deps, b.pt.work_id!, { reject: true });
  assert.equal(repo.workMatchJudgments([b.pt.work_id!]).get(b.pt.work_id!)?.intoWorkId, null);
  assert.throws(() => reviewTranslationWith(deps, "missing", { reject: true }), BookNotFoundError);
});

test("automatic merges are listed newest first", () => {
  const repo = freshRepo();
  const older = pair(repo, 7);
  const newer = pair(repo, 8);
  repo.mergeTranslation(older.pt.work_id!, older.en.work_id!, "jev", 0.95, "2026-10-14T00:00:00.000Z");
  repo.mergeTranslation(newer.pt.work_id!, newer.en.work_id!, "code", null, "2026-10-15T00:00:00.000Z");
  assert.deepEqual(translationReviewWith(repo, [], (id) => id).items.map((item) => item.title), ["Livro 8", "Livro 7"]);
});

test("a doubt whose proposed original has since been folded into another work is listed against that work", () => {
  const repo = freshRepo();
  const pt = repo.createBook({ title: "O Passeio", author: "Robert Walser", isbn: "9789720000611" }, ["isbn:9789720000611"], AT);
  repo.setLanguage(pt.id, "pt-PT");
  const loose = repo.createBook({ title: "The Walk", author: "Robert Walser", isbn: "9780000000611" }, ["isbn:9780000000611"], AT);
  const keyed = repo.createBook({ title: "The Walk", author: "Robert Walser", isbn: "9780000000612", workKey: "OL990W" }, ["isbn:9780000000612"], AT);
  repo.saveWorkMatchJudgment(pt.work_id!, { model: "jev-1.13.0", intoWorkId: loose.work_id, confidence: 0.74, askedAt: AT });
  repo.mergeWorks(loose.work_id!, keyed.work_id!, AT);
  const review = translationReviewWith(repo, [], (id) => id);
  assert.deepEqual(review.items.map((item) => [item.title, item.group, item.proposed.workId]), [["O Passeio", "possible", keyed.work_id]]);
});

test("a guarded Jev answer is listed as blocked with its proposed target", async () => {
  const repo = freshRepo();
  const lotr = repo.createBook({ title: "The Lord of the Rings", author: "J. R. R. Tolkien", isbn: "9780261103252", workKey: "OL27448W" }, ["isbn:9780261103252"], AT);
  const king = repo.createBook({ title: "The Return of the King", author: "J. R. R. Tolkien", isbn: "9780261102378", workKey: "OL27455W" }, ["isbn:9780261102378"], AT);
  for (const row of [lotr, king]) repo.addWorkSeries(row.work_id!, [{ name: "The Lord of the Rings", position: null }], "wikidata", AT);
  const pt = repo.createBook({ title: "A Irmandade do Anel", author: "", isbn: "9789720000701" }, ["isbn:9789720000701"], AT);
  repo.setLanguage(pt.id, "pt-PT");
  repo.fillOriginalTitle(pt.id, "The lord of the rings");
  const answer = async (input: { candidates: Array<{ title: string }> }) => ({ choice: input.candidates.findIndex((candidate) => candidate.title === "The Lord of the Rings"), confidence: 0.99, model: "jev-1.13.0" });
  await matchWork({ repo, classify: answer, sharesArena: () => false, now, alert: () => {} }, pt.work_id!, () => false);
  const review = translationReviewWith(repo, [], (id) => id);
  assert.deepEqual(review.items.map((item) => [item.title, item.group, item.proposed.title]), [["A Irmandade do Anel", "blocked", "The Lord of the Rings"]]);
});

test("a merge whose original was later folded into another work is no longer listed as merged", () => {
  const repo = freshRepo();
  const { pt, en } = pair(repo, 9);
  const later = repo.createBook({ title: "Book 9", author: "Author", isbn: "9780000006092", workKey: "OL9792W" }, ["isbn:9780000006092"], AT);
  repo.mergeTranslation(pt.work_id!, en.work_id!, "jev", 0.95, AT);
  assert.deepEqual(translationReviewWith(repo, [], (id) => id).items.map((item) => [item.title, item.group, item.proposed.workId]), [["Livro 9", "merged", en.work_id]]);

  repo.mergeDuplicateWork(en.work_id!, later.work_id!, AT);
  assert.deepEqual(translationReviewWith(repo, [], (id) => id), { items: [], total: 0 });
});
