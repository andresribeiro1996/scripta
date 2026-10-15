import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-typesafe-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError, UnusableAnswerError } = await import("./domain/errors.js");
const { dailySpend, failureKind, nextUtcMidnight, TypesafeBudgetSpentError, utcDay } = await import("./typesafe.js");

function repoAt(path: string) {
  const db = new DatabaseSync(path);
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

test("the 1,000th request of a day goes out and the 1,001st is refused", () => {
  const { repo } = repoAt(":memory:");
  const at = Date.parse("2026-10-15T12:00:00.000Z");
  const spend = dailySpend(repo, "genres", 1000, () => at);
  for (let request = 0; request < 1000; request++) spend();
  assert.throws(spend, (error: unknown) => error instanceof TypesafeBudgetSpentError && error.source === "genres");
  assert.equal(repo.typesafeUsage("2026-10-15", "genres"), 1000);
});

test("each source has its own count, and a new UTC day starts at zero", () => {
  const { repo } = repoAt(":memory:");
  let at = Date.parse("2026-10-15T23:59:59.000Z");
  const genres = dailySpend(repo, "genres", 2, () => at);
  genres();
  genres();
  assert.throws(genres, TypesafeBudgetSpentError);
  dailySpend(repo, "synopses", 2, () => at)();
  assert.equal(repo.typesafeUsage("2026-10-15", "synopses"), 1);
  at = Date.parse("2026-10-16T00:00:00.000Z");
  genres();
  assert.equal(repo.typesafeUsage("2026-10-16", "genres"), 1);
  assert.equal(repo.typesafeUsage("2026-10-15", "genres"), 2);
});

test("the count survives a new repository on the same database", () => {
  const path = join(scratch, "usage.sqlite");
  const first = repoAt(path);
  dailySpend(first.repo, "genres", 5, () => Date.parse("2026-10-15T08:00:00.000Z"))();
  first.db.close();
  const second = repoAt(path);
  assert.equal(second.repo.typesafeUsage("2026-10-15", "genres"), 1);
  second.db.close();
});

test("UTC day and next UTC midnight", () => {
  assert.equal(utcDay(Date.parse("2026-10-15T23:30:00.000-03:00")), "2026-10-16");
  assert.equal(nextUtcMidnight(Date.parse("2026-10-15T12:34:56.000Z")), Date.parse("2026-10-16T00:00:00.000Z"));
  assert.equal(nextUtcMidnight(Date.parse("2026-12-31T23:59:59.000Z")), Date.parse("2027-01-01T00:00:00.000Z"));
});

test("failures sort into budget, key, book and outage", () => {
  const status = (code: number) => new SourceUnavailableError("typesafe", `HTTP ${code}`, { status: code });
  assert.equal(failureKind(new TypesafeBudgetSpentError("genres")), "budget");
  assert.equal(failureKind(status(401)), "key");
  for (const code of [400, 403, 404, 413, 422]) assert.equal(failureKind(status(code)), "book", String(code));
  assert.equal(failureKind(new UnusableAnswerError("typesafe", "unexpected answer")), "book");
  for (const code of [429, 500, 529]) assert.equal(failureKind(status(code)), "outage", String(code));
  assert.equal(failureKind(new SourceUnavailableError("typesafe", "fetch failed")), "outage");
  assert.equal(failureKind(new TypeError("boom")), null);
});
