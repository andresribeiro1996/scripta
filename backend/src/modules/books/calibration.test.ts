import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "calibration-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { scoreSynopses, synopsisSample } = await import("./calibration.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function seed(repo: Repo, isbn: string, summary: string, source: "publisher" | "isbndb") {
  const book = repo.createBook({ title: `Book ${isbn}`, author: "Author", isbn }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
  repo.mergeDetails(book.id, { summary, pages: null, year: null, publisher: null, translator: null }, source);
  return repo.getBook(book.id)!;
}

test("the sample is spread across summary sources, with the texts the rule would hide as their own stratum, before any judgment exists", () => {
  const repo = freshRepo();
  for (let n = 0; n < 6; n++) seed(repo, `97897200008${n}0`, `A publisher synopsis number ${n}, long enough to read.`, "publisher");
  for (let n = 0; n < 6; n++) seed(repo, `97897200009${n}0`, `An ISBNdb description number ${n}, long enough to read.`, "isbndb");
  seed(repo, "9789720000999", "Text: Portugese", "isbndb");
  const sample = synopsisSample(repo, 6, () => 0.5);
  const count = (stratum: string) => sample.filter((item) => item.stratum === stratum).length;
  assert.deepEqual([count("publisher"), count("isbndb"), count("rule")], [2, 2, 1]);
  assert.equal(sample.find((item) => item.stratum === "rule")?.text, "Text: Portugese");
  assert.equal(new Set(sample.map((item) => item.hash)).size, sample.length);
});

test("the sample never carries a stored judgment, so the labellers stay blind", () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000998", "A publisher synopsis that Jev has already judged, long enough.", "publisher");
  repo.saveSynopsisJudgment(book.summary_hash!, { model: "jev-1.13.0", usable: 0.12, kind: "praise", askedAt: "2026-10-15T00:00:00.000Z" });
  const [item] = synopsisSample(repo, 10, () => 0.5);
  assert.deepEqual(Object.keys(item!).sort(), ["author", "hash", "stratum", "text", "title"]);
});

test("the score counts labelled not-usable texts per decision band", () => {
  const sample = ["r", "a", "b", "c", "d"].map((hash) => ({ hash, stratum: hash === "r" ? "rule" : "publisher", title: "T", author: "A", text: "x" }));
  const labels = [{ hash: "r", usable: false, kind: "fragment" }, { hash: "a", usable: false, kind: "praise" }, { hash: "b", usable: true, kind: "synopsis" }, { hash: "c", usable: false, kind: "author_bio" }, { hash: "d", usable: true, kind: "synopsis" }];
  const answers = [{ hash: "a", usable: 0.1, kind: "praise" }, { hash: "b", usable: 0.2, kind: "synopsis" }, { hash: "c", usable: 0.4, kind: "author_bio" }, { hash: "d", usable: 0.9, kind: "synopsis" }];
  assert.deepEqual(scoreSynopses(sample, labels, answers), [
    { decision: "rule", items: 1, notUsable: 1 },
    { decision: "jev below 0.3", items: 2, notUsable: 1 },
    { decision: "jev 0.3 to 0.5", items: 1, notUsable: 1 },
    { decision: "jev 0.5 and above", items: 1, notUsable: 0 }
  ]);
});
