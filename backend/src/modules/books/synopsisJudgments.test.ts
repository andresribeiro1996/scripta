import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "synopsis-judgments-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError, UnusableAnswerError } = await import("./domain/errors.js");
const { TypesafeBudgetSpentError, utcDay } = await import("./typesafe.js");
const { judgeWorkSynopses, startSynopsisJobs, startSynopsisJobsIfConfigured } = await import("./synopsisJudgments.js");
const { JEV_REJECTION_LIMIT } = await import("./jevJobs.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
type Answer = { usable: number; kind: "synopsis" | "praise"; model: string };

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const SYNOPSIS = "A long description of what this book is about, its story and the people in it.";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const flush = async () => {
  for (let tick = 0; tick < 10; tick++) await new Promise(setImmediate);
};

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function seed(repo: Repo, isbn: string, summary: string) {
  const book = repo.createBook({ title: `Book ${isbn}`, author: "Author", isbn }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
  repo.mergeDetails(book.id, { summary, pages: null, year: null, publisher: null, translator: null }, "publisher");
  return repo.getBook(book.id)!;
}

function judging(repo: Repo, classify: (input: { text: string }) => Promise<Answer>, held: string[]) {
  const asked: string[] = [];
  const alerts: string[] = [];
  const deps = {
    repo,
    classify: async (input: { title: string; author: string; text: string }) => {
      asked.push(input.text);
      return classify(input);
    },
    now: () => NOW,
    alert: (subject: string) => { alerts.push(subject); },
    heldWorkIds: () => held
  };
  return { deps, asked, alerts };
}

const keep = async (): Promise<Answer> => ({ usable: 0.92, kind: "synopsis", model: "jev-1.13.0" });

test("a fragment is judged by the rule without asking Jev", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000041", "Text: Portugese");
  const { deps, asked } = judging(repo, keep, [book.work_id!]);
  assert.equal(await judgeWorkSynopses(deps, book.work_id!), null);
  assert.deepEqual(asked, []);
  assert.deepEqual(repo.synopsisJudgments([book.summary_hash!]).get(book.summary_hash!), { model: "rule", usable: 0, kind: "fragment", askedAt: "2026-10-15T12:00:00.000Z" });
});

test("every unjudged text of a held work is asked once, edition and work summaries alike", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000042", SYNOPSIS);
  repo.setWorkSummary(book.id, `${SYNOPSIS} From the work.`);
  const { deps, asked } = judging(repo, keep, [book.work_id!]);
  await judgeWorkSynopses(deps, book.work_id!);
  await judgeWorkSynopses(deps, book.work_id!);
  assert.equal(asked.length, 2);
  assert.equal(repo.synopsisJudgments([book.summary_hash!]).get(book.summary_hash!)?.usable, 0.92);
});

test("a work nobody holds is never asked about", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000043", SYNOPSIS);
  const { deps, asked } = judging(repo, keep, []);
  assert.equal(await judgeWorkSynopses(deps, book.work_id!), null);
  assert.deepEqual(asked, []);
});

test("a merged work id is judged as its canonical work", async () => {
  const repo = freshRepo();
  const alias = seed(repo, "9789720000044", SYNOPSIS);
  const target = seed(repo, "9789720000045", `${SYNOPSIS} Another.`);
  repo.mergeWorks(alias.work_id!, target.work_id!);
  const { deps, asked } = judging(repo, keep, [alias.work_id!]);
  await judgeWorkSynopses(deps, alias.work_id!);
  assert.equal(asked.length, 2);
});

test("an unusable answer is a strike, and three strikes stop the text being asked", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000046", SYNOPSIS);
  const { deps, asked } = judging(repo, async () => { throw new UnusableAnswerError("typesafe", "unexpected answer"); }, [book.work_id!]);
  for (let round = 0; round < JEV_REJECTION_LIMIT + 1; round++) assert.equal(await judgeWorkSynopses(deps, book.work_id!), null);
  assert.equal(asked.length, JEV_REJECTION_LIMIT);
  assert.deepEqual(repo.jevRejections("synopses", [book.summary_hash!]).get(book.summary_hash!), { status: null, reason: "unexpected answer", attempts: 3, lastAt: "2026-10-15T12:00:00.000Z" });
  assert.equal(repo.synopsisJudgments([book.summary_hash!]).size, 0);
});

test("a spent budget, an outage and a 401 pause and store nothing", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000047", SYNOPSIS);
  const failing = (error: unknown) => judging(repo, async () => { throw error; }, [book.work_id!]);
  assert.equal(await judgeWorkSynopses(failing(new TypesafeBudgetSpentError("synopses")).deps, book.work_id!), Date.parse("2026-10-16T00:00:00.000Z"));
  assert.equal(await judgeWorkSynopses(failing(new SourceUnavailableError("typesafe", "HTTP 503", { status: 503 })).deps, book.work_id!), NOW + 10 * 60 * 1000);
  const key = failing(new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }));
  assert.equal(await judgeWorkSynopses(key.deps, book.work_id!), NOW + 24 * 60 * 60 * 1000);
  assert.deepEqual(key.alerts, ["TypeSafe rejected the synopsis requests"]);
  assert.equal(repo.synopsisJudgments([book.summary_hash!]).size, 0);
  assert.equal(repo.jevRejections("synopses", [book.summary_hash!]).size, 0);
});

test("adding a work only queues it; judging happens after the caller returns", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000048", SYNOPSIS);
  const { deps, asked } = judging(repo, keep, [book.work_id!]);
  const jobs = startSynopsisJobs({ ...deps, info: () => {}, onError: (error) => { throw error; } });
  jobs.add(book.work_id!);
  assert.deepEqual(asked, []);
  await flush();
  assert.equal(asked.length, 1);
  jobs.stop();
});

test("the sweep waits for its initial delay before its first pass", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const repo = freshRepo();
  const { deps } = judging(repo, keep, []);
  let reads = 0;
  const jobs = startSynopsisJobs({ ...deps, heldWorkIds: () => { reads += 1; return []; }, info: () => {}, onError: (error) => { throw error; }, initialDelayMs: 75_000 });
  await flush();
  t.mock.timers.tick(74_999);
  await flush();
  assert.equal(reads, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(reads, 1);
  jobs.stop();
});

test("synopsis requests are counted under the synopses source, not genres", async () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000049", SYNOPSIS);
  globalThis.fetch = (async () => Response.json({ model: "jev-1.13.0", answers: { usable: { noul: 0.9 }, kind: { choice: "synopsis" } } })) as typeof fetch;
  const jobs = startSynopsisJobsIfConfigured("key", { repo, heldWorkIds: () => [book.work_id!], now: () => NOW, alert: () => {}, info: () => {}, onError: (error) => { throw error; } })!;
  jobs.add(book.work_id!);
  await flush();
  jobs.stop();
  assert.equal(repo.typesafeUsage(utcDay(NOW), "synopses"), 1);
  assert.equal(repo.typesafeUsage(utcDay(NOW), "genres"), 0);
  assert.equal(startSynopsisJobsIfConfigured("", { repo, heldWorkIds: () => [], now: () => NOW, alert: () => {}, info: () => {}, onError: () => {} }), null);
});

test("four works hitting a rejected key at once send one alert", async () => {
  const repo = freshRepo();
  const books = ["9789720000061", "9789720000062", "9789720000063", "9789720000064"].map((isbn, n) => seed(repo, isbn, `${SYNOPSIS} Volume ${n}.`));
  const key = judging(repo, async () => { throw new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 }); }, books.map((book) => book.work_id!));
  const jobs = startSynopsisJobs({ ...key.deps, info: () => {}, onError: (error) => { throw error; } });
  for (const book of books) jobs.add(book.work_id!);
  await flush();
  jobs.stop();
  assert.deepEqual(key.alerts, ["TypeSafe rejected the synopsis requests"]);
});
