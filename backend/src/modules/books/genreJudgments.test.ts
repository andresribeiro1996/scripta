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
const { SourceUnavailableError, UnusableAnswerError } = await import("./domain/errors.js");
const { jevBookOf, judgeWork, startGenreJobs, startGenreJobsIfConfigured } = await import("./genreJudgments.js");
const { TypesafeBudgetSpentError } = await import("./typesafe.js");

type Classify = Parameters<typeof judgeWork>[0]["classify"];
const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const flush = async () => {
  for (let tick = 0; tick < 10; tick++) await new Promise(setImmediate);
};

function seeded(titles: string[]) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const at = new Date(NOW).toISOString();
  const books = titles.map((title) => repo.createBook({ title, author: "A", isbn: null }, [`ta:${title.toLowerCase()}|a|`], at));
  for (const book of books) repo.markDetailsMissing(book.id, at);
  return { db, repo, workIds: books.map((book) => book.work_id!) };
}

function deps(repo: ReturnType<typeof seeded>["repo"], held: string[], classify: Classify, alerts: string[] = []) {
  return { repo, classify, heldWorkIds: () => held, now: () => NOW, alert: (subject: string) => { alerts.push(subject); } };
}

const answer = (genre: "History" | "Poetry" | null, confidence: number) => async () => ({ genre, confidence, model: "jev-1.13.0" });
const genresOf = (db: DatabaseSync, title: string) => (db.prepare("SELECT genres FROM books WHERE title = ?").get(title) as { genres: string }).genres;

test("a held work with no genres is asked once, stored, applied, and its strikes cleared", async () => {
  const { db, repo, workIds } = seeded(["Sure"]);
  repo.recordGenreRejection({ workId: workIds[0]!, status: 400, reason: "HTTP 400", at: new Date(NOW).toISOString() });
  assert.equal(await judgeWork(deps(repo, workIds, answer("History", 0.9)), workIds[0]!), null);
  assert.equal(genresOf(db, "Sure"), JSON.stringify(["History"]));
  assert.equal(repo.genreRejections(workIds).size, 0);
  assert.equal(await judgeWork(deps(repo, workIds, async () => { throw new Error("asked twice"); }), workIds[0]!), null);
});

test("a work no library holds is skipped without asking", async () => {
  const { repo, workIds } = seeded(["Catalog only"]);
  assert.equal(await judgeWork(deps(repo, [], async () => { throw new Error("asked"); }), workIds[0]!), null);
  assert.equal(repo.genreJudgments(workIds).size, 0);
});

test("a held alias id is judged as its canonical work", async () => {
  const { db, repo, workIds } = seeded(["Kept", "Merged"]);
  repo.mergeWorks(workIds[1]!, workIds[0]!);
  assert.equal(await judgeWork(deps(repo, [workIds[1]!], answer("Poetry", 0.95)), workIds[1]!), null);
  assert.deepEqual([...repo.genreJudgments([workIds[0]!]).keys()], [workIds[0]]);
  assert.equal(genresOf(db, "Kept"), JSON.stringify(["Poetry"]));
});

test("a book failure records a strike and lets the queue go on; three strikes stop asking", async () => {
  const { repo, workIds } = seeded(["Rejected"]);
  const rejected: Classify = async () => { throw new SourceUnavailableError("typesafe", "HTTP 400", { status: 400 }); };
  const unusable: Classify = async () => { throw new UnusableAnswerError("typesafe", "unexpected answer"); };
  assert.equal(await judgeWork(deps(repo, workIds, rejected), workIds[0]!), null);
  assert.equal(await judgeWork(deps(repo, workIds, unusable), workIds[0]!), null);
  assert.equal(await judgeWork(deps(repo, workIds, rejected), workIds[0]!), null);
  assert.deepEqual(repo.genreRejections(workIds).get(workIds[0]!), { status: 400, reason: "HTTP 400", attempts: 3, lastAt: new Date(NOW).toISOString() });
  assert.equal(await judgeWork(deps(repo, workIds, async () => { throw new Error("asked a fourth time"); }), workIds[0]!), null);
});

test("an unusable answer's strike keeps its detail as the reason", async () => {
  const { repo, workIds } = seeded(["Odd"]);
  await judgeWork(deps(repo, workIds, async () => { throw new UnusableAnswerError("typesafe", "unexpected answer"); }), workIds[0]!);
  assert.deepEqual(repo.genreRejections(workIds).get(workIds[0]!), { status: null, reason: "unexpected answer", attempts: 1, lastAt: new Date(NOW).toISOString() });
});

test("outages, a spent budget and a rejected key pause without storing or striking", async () => {
  const { repo, workIds } = seeded(["Paused"]);
  const alerts: string[] = [];
  const outage: Classify = async () => { throw new SourceUnavailableError("typesafe", "HTTP 529", { status: 529 }); };
  const spent: Classify = async () => { throw new TypesafeBudgetSpentError("genres"); };
  const key: Classify = async () => { throw new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }); };
  assert.equal(await judgeWork(deps(repo, workIds, outage, alerts), workIds[0]!), NOW + 10 * 60 * 1000);
  assert.deepEqual(alerts, []);
  assert.equal(await judgeWork(deps(repo, workIds, spent, alerts), workIds[0]!), Date.parse("2026-10-16T00:00:00.000Z"));
  assert.deepEqual(alerts, []);
  assert.equal(await judgeWork(deps(repo, workIds, key, alerts), workIds[0]!), NOW + 24 * 60 * 60 * 1000);
  assert.deepEqual(alerts, ["TypeSafe rejected the genre requests"]);
  assert.equal(repo.genreJudgments(workIds).size, 0);
  assert.equal(repo.genreRejections(workIds).size, 0);
});

test("an error that isn't a TypeSafe failure is rethrown", async () => {
  const { repo, workIds } = seeded(["Bug"]);
  await assert.rejects(judgeWork(deps(repo, workIds, async () => { throw new TypeError("bug"); }), workIds[0]!), TypeError);
});

test("the boot sweep queues held works and judges them", async () => {
  const { db, repo, workIds } = seeded(["One", "Two", "Not held"]);
  const jobs = startGenreJobs({ ...deps(repo, workIds.slice(0, 2), answer("History", 0.9)), onError: (error) => { throw error; }, info: () => {} });
  await flush();
  jobs.stop();
  assert.equal(genresOf(db, "One"), JSON.stringify(["History"]));
  assert.equal(genresOf(db, "Two"), JSON.stringify(["History"]));
  assert.equal(genresOf(db, "Not held"), "[]");
});

test("four workers hitting a rejected key at once send one alert", async () => {
  const { repo, workIds } = seeded(["K1", "K2", "K3", "K4"]);
  const alerts: string[] = [];
  const key: Classify = async () => { throw new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }); };
  const jobs = startGenreJobs({ ...deps(repo, workIds, key, alerts), onError: (error) => { throw error; }, info: () => {} });
  await flush();
  jobs.stop();
  assert.deepEqual(alerts, ["TypeSafe rejected the genre requests"]);
});

test("a spent budget is logged once at info level and alerts nobody, however many workers hit it", async () => {
  const { repo, workIds } = seeded(["B1", "B2", "B3", "B4"]);
  const alerts: string[] = [];
  const infos: Array<{ details: object; message: string }> = [];
  const spent: Classify = async () => { throw new TypesafeBudgetSpentError("genres"); };
  const jobs = startGenreJobs({ ...deps(repo, workIds, spent, alerts), onError: (error) => { throw error; }, info: (details, message) => { infos.push({ details, message }); } });
  await flush();
  jobs.stop();
  assert.equal(infos.length, 1);
  assert.deepEqual(infos[0]!.details, { until: "2026-10-16T00:00:00.000Z" });
  assert.deepEqual(alerts, []);
  assert.equal(repo.genreRejections(workIds).size, 0);
});

test("the sweep runs at boot and again after 24 hours", async () => {
  const { db, repo, workIds } = seeded(["Early"]);
  const held = [...workIds];
  const ticks: Array<{ callback: () => void; delay: number }> = [];
  const cleared: unknown[] = [];
  const timers = {
    setInterval: (callback: () => void, delay: number) => {
      const timer = { unref() { return timer; } };
      ticks.push({ callback, delay });
      return timer as unknown as NodeJS.Timeout;
    },
    clearInterval: (timer: NodeJS.Timeout) => { cleared.push(timer); }
  };
  const jobs = startGenreJobs({ ...deps(repo, held, answer("History", 0.9)), onError: (error) => { throw error; }, info: () => {}, timers });
  await flush();
  assert.equal(genresOf(db, "Early"), JSON.stringify(["History"]));
  assert.deepEqual(ticks.map((tick) => tick.delay), [24 * 60 * 60 * 1000]);
  const late = repo.createBook({ title: "Late", author: "A", isbn: null }, ["ta:late|a|"], new Date(NOW).toISOString());
  repo.markDetailsMissing(late.id, new Date(NOW).toISOString());
  held.push(late.work_id!);
  await flush();
  assert.equal(genresOf(db, "Late"), "[]");
  ticks[0]!.callback();
  await flush();
  assert.equal(genresOf(db, "Late"), JSON.stringify(["History"]));
  jobs.stop();
  assert.equal(cleared.length, 1);
});

test("without a key nothing starts", () => {
  const { repo } = seeded([]);
  assert.equal(startGenreJobsIfConfigured("", { repo, heldWorkIds: () => [], now: () => NOW, alert: () => {}, onError: () => {}, info: () => {} }), null);
});

test("Jev reads the work's title, author, edition languages, publishers and longest synopsis", () => {
  assert.deepEqual(jevBookOf({ work: { id: "w", title: "Os Anões", author: "Harold Pinter", summary: null }, editions: [
    { title: "Os Anões", language: "pt-PT", isbn: null, publisher: "Relógio", year: null, summary: "Curto." },
    { title: "The Dwarfs", language: "en", isbn: null, publisher: null, year: 1990, summary: "x".repeat(1500) },
    { title: "Os Anões", language: "pt-PT", isbn: null, publisher: "Relógio", year: null, summary: null }
  ] }), { title: "Os Anões", author: "Harold Pinter", editionLanguages: ["pt-PT", "en"], publishers: ["Relógio"], synopsis: "x".repeat(1200) });
});
