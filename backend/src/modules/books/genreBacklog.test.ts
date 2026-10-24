import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-genre-backlog-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError } = await import("./domain/errors.js");
const { backlogReport, backlogWorkIds, GENRE_BACKLOG_SOURCE, runGenreBacklog } = await import("./genreBacklog.js");
const { runBudget } = await import("./typesafe.js");

const AT = "2026-10-15T00:00:00.000Z";
const NOW = () => Date.parse(AT);
const SYNOPSIS = "A long enough synopsis for Jev to read properly.";

function seeded(titles: string[], synopsis: string | null = SYNOPSIS) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const books = titles.map((title, index) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], `2026-10-0${index + 1}T00:00:00.000Z`));
  if (synopsis) db.prepare("UPDATE books SET summary = ?").run(synopsis);
  return { db, repo, work: (title: string) => books[titles.indexOf(title)]!.work_id! };
}

test("the backlog picks works with a synopsis, no genres, no judgment and under three strikes, held first then oldest", () => {
  const s = seeded(["Old", "Held", "Short", "Genred", "Judged", "Struck"]);
  s.db.prepare("UPDATE books SET summary = 'Too short.' WHERE work_id = ?").run(s.work("Short"));
  s.db.prepare("UPDATE books SET genres = ? WHERE work_id = ?").run(JSON.stringify(["Poetry"]), s.work("Genred"));
  s.repo.saveGenreJudgment({ workId: s.work("Judged"), model: "jev-1.13.0", genre: null, confidence: 0.9, askedAt: AT });
  for (let strike = 0; strike < 3; strike++) s.repo.recordGenreRejection({ workId: s.work("Struck"), status: 400, reason: "HTTP 400", at: AT });
  assert.deepEqual(backlogWorkIds(s.repo, [s.work("Held")], 10), [s.work("Held"), s.work("Old")]);
  assert.deepEqual(backlogWorkIds(s.repo, [], 1), [s.work("Old")]);
});

test("the run stops at exactly --max requests, retries included, and records them under its own source", async () => {
  const s = seeded(["W1", "W2", "W3", "W4", "W5", "W6"]);
  const budget = runBudget(s.repo, GENRE_BACKLOG_SOURCE, 5, NOW);
  let calls = 0;
  const classify = async () => {
    budget.spend();
    calls += 1;
    if (calls % 2 === 1) budget.spend();
    return { genre: "History" as const, confidence: 0.9, model: "jev-1.13.0" };
  };
  const result = await runGenreBacklog({ repo: s.repo, classify, now: NOW, alert: () => {} }, backlogWorkIds(s.repo, [], 10));
  assert.equal(budget.used(), 5);
  assert.equal(result.stoppedBy, "budget");
  assert.equal(s.repo.typesafeUsage("2026-10-15", GENRE_BACKLOG_SOURCE), 5);
  assert.equal(s.repo.typesafeUsage("2026-10-15", "genres"), 0);
});

test("an outage or a rejected key ends the run and stores nothing for the failed work", async () => {
  for (const [code, stop] of [[529, "outage"], [401, "key"]] as const) {
    const s = seeded(["Only"]);
    const alerts: string[] = [];
    const failing = async () => { throw new SourceUnavailableError("typesafe", `HTTP ${code}`, { status: code }); };
    const result = await runGenreBacklog({ repo: s.repo, classify: failing, now: NOW, alert: (subject) => { alerts.push(subject); } }, [s.work("Only")]);
    assert.equal(result.stoppedBy, stop);
    assert.deepEqual(result.asked, []);
    assert.equal(s.repo.genreJudgments([s.work("Only")]).size, 0);
    assert.equal(alerts.length, stop === "key" ? 1 : 0);
  }
});

test("the report bins the answers and counts strikes, requests and cost", async () => {
  const s = seeded(["Sure", "Maybe", "Unsure", "None", "Rejected"]);
  const answers: Record<string, { genre: "History" | null; confidence: number }> = { Sure: { genre: "History", confidence: 0.9 }, Maybe: { genre: "History", confidence: 0.6 }, Unsure: { genre: "History", confidence: 0.3 }, None: { genre: null, confidence: 0.95 } };
  const classify = async (book: { title: string }) => {
    if (book.title === "Rejected") throw new SourceUnavailableError("typesafe", "HTTP 400", { status: 400 });
    return { ...answers[book.title]!, model: "jev-1.13.0" };
  };
  const workIds = backlogWorkIds(s.repo, [], 10);
  const result = await runGenreBacklog({ repo: s.repo, classify, now: NOW, alert: () => {} }, workIds);
  assert.deepEqual(backlogReport(s.repo, workIds.length, result, 5), { selected: 5, asked: 5, confident: 1, possible: 1, unsure: 1, none: 1, strikes: 1, stoppedBy: "done", requests: 5, estimatedCostUsd: 0 });
});

