import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-genre-judgments-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError } = await import("./domain/errors.js");
const { jevBookOf, judgeGenres } = await import("./genreJudgments.js");

type Classify = Parameters<typeof judgeGenres>[0]["classify"];
const NOW = Date.parse("2026-10-14T12:00:00.000Z");

function seeded(titles: string[]) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const at = new Date(NOW).toISOString();
  const books = titles.map((title) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], at));
  for (const book of books) repo.markDetailsMissing(book.id, at);
  return { db, repo, workIds: books.map((book) => book.work_id!) };
}

function deps(repo: ReturnType<typeof seeded>["repo"], workIds: string[], classify: Classify, alerts: string[] = []) {
  return { repo, classify, heldWorkIds: () => workIds, now: () => NOW, alert: (subject: string) => { alerts.push(subject); } };
}

test("judges held works, stores every answer, saves the ones at or above the save line and never asks twice", async () => {
  const { db, repo, workIds } = seeded(["Sure", "Unsure"]);
  const answers = new Map([["Sure", { genre: "History" as const, confidence: 0.9, model: "jev-1.13.0" }], ["Unsure", { genre: "Poetry" as const, confidence: 0.3, model: "jev-1.13.0" }]]);
  const asked: string[] = [];
  assert.equal(await judgeGenres(deps(repo, workIds, async (book) => { asked.push(book.title); return answers.get(book.title)!; }), 50, new AbortController().signal), null);
  assert.deepEqual(asked.sort(), ["Sure", "Unsure"]);
  const genres = (title: string) => (db.prepare("SELECT genres FROM books WHERE title = ?").get(title) as { genres: string }).genres;
  assert.equal(genres("Sure"), JSON.stringify(["History"]));
  assert.equal(genres("Unsure"), "[]");
  assert.deepEqual(repo.genreJudgments(workIds).get(workIds[1]!), { genre: "Poetry", confidence: 0.3 });
  assert.equal(await judgeGenres(deps(repo, workIds, async () => { throw new Error("asked twice"); }), 50, new AbortController().signal), null);
});

test("a failed request stores nothing, stops the run and is rethrown", async () => {
  const { repo, workIds } = seeded(["A1", "A2", "A3", "A4", "A5", "A6"]);
  let calls = 0;
  const busy: Classify = async () => {
    calls += 1;
    throw new SourceUnavailableError("typesafe", "HTTP 529", { status: 529 });
  };
  await assert.rejects(judgeGenres(deps(repo, workIds, busy), 50, new AbortController().signal), SourceUnavailableError);
  assert.equal(calls, 4);
  assert.equal(repo.genreJudgments(workIds).size, 0);
});

test("a rejected key alerts and pauses the job for a day", async () => {
  const { repo, workIds } = seeded(["A"]);
  const alerts: string[] = [];
  const rejected: Classify = async () => { throw new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }); };
  assert.equal(await judgeGenres(deps(repo, workIds, rejected, alerts), 50, new AbortController().signal), NOW + 24 * 60 * 60 * 1000);
  assert.deepEqual(alerts, ["TypeSafe rejected the genre requests"]);
});

test("Jev reads the work's title, author, edition languages, publishers and longest synopsis", () => {
  assert.deepEqual(jevBookOf({ work: { id: "w", title: "Os Anões", author: "Harold Pinter", summary: null }, editions: [
    { title: "Os Anões", language: "pt-PT", isbn: null, publisher: "Relógio", year: null, summary: "Curto." },
    { title: "The Dwarfs", language: "en", isbn: null, publisher: null, year: 1990, summary: "x".repeat(1500) },
    { title: "Os Anões", language: "pt-PT", isbn: null, publisher: "Relógio", year: null, summary: null }
  ] }), { title: "Os Anões", author: "Harold Pinter", editionLanguages: ["pt-PT", "en"], publishers: ["Relógio"], synopsis: "x".repeat(1200) });
});
