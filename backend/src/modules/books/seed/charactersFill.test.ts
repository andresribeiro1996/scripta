import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { BooksRepository } from "../domain/ports.js";
import type { CleanedSubjects } from "../domain/workSubjects.js";

const scratch = mkdtempSync(join(tmpdir(), "characters-fill-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.TZ = "America/Sao_Paulo";

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { fillCharacters } = await import("./charactersFill.js");

const AT = "2026-10-25T12:00:00.000Z";
const quiet = () => {};

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

function book(repo: BooksRepository, title: string, workKey: string) {
  return repo.createBook({ title, author: "Author", isbn: null, workKey }, [`ta:${title.toLowerCase()}|author|`], AT);
}

const cleaned = (person: string[], gatedOut = false): CleanedSubjects => ({ subjects: { person, place: [], time: [] }, gatedOut });
const count = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) AS n FROM work_subjects").get() as { n: number }).n;

test("dry run writes nothing and counts", async () => {
  const { db, repo } = setup();
  book(repo, "One", "OL1W");
  book(repo, "Two", "OL2W");
  book(repo, "Three", "OL3W");
  const report = await fillCharacters(repo, async () => new Map([["OL1W", cleaned(["A", "B", "C"])], ["OL2W", cleaned([], true)]]), AT, { dryRun: true, log: quiet });
  assert.deepEqual(report, {
    works: 3,
    returned: 2,
    withPeople: 1,
    quizReady: 1,
    gatedOut: 1,
    rows: { person: 3, place: 0, time: 0 },
    sample: [{ key: "OL1W", people: ["A", "B", "C"] }]
  });
  assert.equal(count(db), 0);
});

test("apply replaces returned works and keeps missing ones", async () => {
  const { db, repo } = setup();
  book(repo, "One", "OL1W");
  book(repo, "Two", "OL2W");
  const [returned, missing] = repo.worksWithOpenLibraryKey().map((work) => work.id) as [string, string];
  repo.replaceWorkSubjects(returned, { person: ["Old"], place: [], time: [] }, AT);
  repo.replaceWorkSubjects(missing, { person: ["Kept"], place: [], time: [] }, AT);
  await fillCharacters(repo, async () => new Map([["OL1W", cleaned(["New", "Newer"])]]), AT, { dryRun: false, log: quiet });
  const names = (id: string) => (db.prepare("SELECT name FROM work_subjects WHERE work_id = ? ORDER BY position").all(id) as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(names(returned), ["New", "Newer"]);
  assert.deepEqual(names(missing), ["Kept"]);
});

test("each fetched work carries its Scripta author", async () => {
  const { repo } = setup();
  book(repo, "One", "OL1W");
  let seen: Array<{ key: string; author: string }> = [];
  await fillCharacters(repo, async (works) => ((seen = works), new Map()), AT, { dryRun: true, log: quiet });
  assert.deepEqual(seen, [{ key: "OL1W", author: "Author" }]);
});

test("batches are 100 keys", async () => {
  const { repo } = setup();
  for (let i = 1; i <= 250; i++) book(repo, `Book ${i}`, `OL${i}W`);
  const sizes: number[] = [];
  await fillCharacters(repo, async (works) => (sizes.push(works.length), new Map()), AT, { dryRun: true, log: quiet });
  assert.deepEqual(sizes, [100, 100, 50]);
});

test("a failing batch rejects after earlier batches are written", async () => {
  const { db, repo } = setup();
  for (let i = 1; i <= 150; i++) book(repo, `Book ${i}`, `OL${i}W`);
  let calls = 0;
  await assert.rejects(
    fillCharacters(
      repo,
      async (works) => {
        if (++calls === 2) throw new Error("boom");
        return new Map(works.map(({ key }) => [key, cleaned(["Someone"])]));
      },
      AT,
      { dryRun: false, log: quiet }
    ),
    /boom/
  );
  assert.equal(count(db), 100);
});
