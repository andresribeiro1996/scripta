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
const { SourceUnavailableError } = await import("../domain/errors.js");

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
    lastRowid: report.lastRowid,
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

function failing(errors: Error[], waits: number[] = []) {
  let calls = 0;
  return {
    waits,
    sleep: async (ms: number) => void waits.push(ms),
    fetch: async (works: Array<{ key: string; author: string }>) => {
      const error = errors[calls++];
      if (error) throw error;
      return new Map(works.map(({ key }) => [key, cleaned(["Someone"])]));
    },
    calls: () => calls
  };
}

test("timeouts and 5xx are retried after 30 s and the batch is written", async () => {
  const { db, repo } = setup();
  book(repo, "One", "OL1W");
  const stub = failing([new SourceUnavailableError("openlibrary", "timeout"), new SourceUnavailableError("openlibrary", "bad", { status: 503 })]);
  const lines: string[] = [];
  await fillCharacters(repo, stub.fetch, AT, { dryRun: false, log: (line) => lines.push(line), sleep: stub.sleep });
  assert.deepEqual(stub.waits, [30_000, 30_000]);
  assert.equal(stub.calls(), 3);
  assert.equal(count(db), 1);
  assert.equal(lines.filter((line) => line.includes('"retry"')).length, 2);
});

test("a 429 waits for retryAt when set, else 60 s", async () => {
  const { repo } = setup();
  book(repo, "One", "OL1W");
  const stub = failing([new SourceUnavailableError("openlibrary", "slow", { status: 429 }), new SourceUnavailableError("openlibrary", "slow", { status: 429, retryAt: Date.now() + 5_000 })]);
  await fillCharacters(repo, stub.fetch, AT, { dryRun: true, log: quiet, sleep: stub.sleep });
  assert.equal(stub.waits[0], 60_000);
  assert.ok(stub.waits[1]! > 0 && stub.waits[1]! <= 5_000);
});

test("the fourth consecutive failure propagates after earlier batches are written", async () => {
  const { db, repo } = setup();
  for (let i = 1; i <= 150; i++) book(repo, `Book ${i}`, `OL${i}W`);
  const timeout = () => new SourceUnavailableError("openlibrary", "timeout");
  const stub = failing([]);
  let calls = 0;
  await assert.rejects(
    fillCharacters(repo, async (works) => (++calls === 1 ? stub.fetch(works) : Promise.reject(timeout())), AT, { dryRun: false, log: quiet, sleep: stub.sleep }),
    /timeout/
  );
  assert.equal(calls, 5);
  assert.deepEqual(stub.waits, [30_000, 30_000, 30_000]);
  assert.equal(count(db), 100);
});

test("non-retryable errors propagate immediately", async () => {
  for (const error of [new SourceUnavailableError("openlibrary", "gone", { status: 404 }), new Error("boom")]) {
    const { repo } = setup();
    book(repo, "One", "OL1W");
    const stub = failing([error]);
    await assert.rejects(fillCharacters(repo, stub.fetch, AT, { dryRun: true, log: quiet, sleep: stub.sleep }));
    assert.equal(stub.calls(), 1);
    assert.deepEqual(stub.waits, []);
  }
});

test("after skips works at or below it and lastRowid tracks finished batches", async () => {
  const { repo } = setup();
  for (let i = 1; i <= 150; i++) book(repo, `Book ${i}`, `OL${i}W`);
  const all = repo.worksWithOpenLibraryKey();
  const lines: string[] = [];
  const seen: string[] = [];
  const report = await fillCharacters(repo, async (works) => (seen.push(...works.map(({ key }) => key)), new Map()), AT, { dryRun: true, log: (line) => lines.push(line), after: all[49]!.rowid });
  assert.equal(report.works, 100);
  assert.equal(seen[0], "OL51W");
  assert.equal(report.lastRowid, all[149]!.rowid);
  assert.equal(JSON.parse(lines[0]!).lastRowid, all[149]!.rowid);
});

test("lastRowid stays at the last finished batch when a later one fails", async () => {
  const { repo } = setup();
  for (let i = 1; i <= 150; i++) book(repo, `Book ${i}`, `OL${i}W`);
  const all = repo.worksWithOpenLibraryKey();
  const lines: string[] = [];
  let calls = 0;
  await assert.rejects(fillCharacters(repo, async () => (++calls === 2 ? Promise.reject(new Error("boom")) : new Map()), AT, { dryRun: true, log: (line) => lines.push(line) }));
  assert.equal(JSON.parse(lines.at(-1)!).lastRowid, all[99]!.rowid);
});
