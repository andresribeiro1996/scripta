import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "duplicate-works-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { WorkMergeError } = await import("./domain/errors.js");
const { mergeDuplicateWorks, walkDuplicateWorks } = await import("./duplicateWorks.js");
const { undoReviewedMerges } = await import("./seriesMergeRepair.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const NOW = Date.parse("2026-10-21T09:00:00.000Z");
const DAY_MS = 86_400_000;
const at = (days: number) => new Date(NOW + days * DAY_MS).toISOString();
const AUTHOR = "Rebecca Yarros";

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

let next = 0;
function edition(repo: Repo, title: string, workKey: string, created: number, author = AUTHOR) {
  const isbn = `97800000${String(++next).padStart(5, "0")}`;
  return repo.createBook({ title, author, isbn, workKey }, [`isbn:${isbn}`], at(created));
}

function deps(repo: Repo, sharesArena: (from: string, into: string) => boolean = () => false) {
  return { repo, sharesArena, now: () => NOW };
}

function twoDuplicates(repo: Repo, title: string, firstKey: string, secondKey: string) {
  const small = edition(repo, title, firstKey, 2);
  const large = edition(repo, title, secondKey, 1);
  edition(repo, title, secondKey, 1);
  return { small, large, key: repo.getBook(small.id)!.title_key! };
}

const work = (repo: Repo, book: { id: string }) => repo.getBook(book.id)!.work_id;

test("merges duplicate keyed works for the given keys", () => {
  const repo = freshRepo();
  const survivor = edition(repo, "Fourth Wing", "OL2W", 1);
  edition(repo, "Fourth Wing", "OL2W", 1);
  const first = edition(repo, "Fourth Wing", "OL1W", 2);
  const second = edition(repo, "Fourth Wing", "OL3W", 3);
  const other = twoDuplicates(repo, "Iron Flame", "OL4W", "OL5W");
  const key = repo.getBook(survivor.id)!.title_key!;

  const report = mergeDuplicateWorks(deps(repo), [key]);

  assert.deepEqual(report, {
    merges: [
      { titleKey: key, from: first.work_id, into: survivor.work_id },
      { titleKey: key, from: second.work_id, into: survivor.work_id }
    ],
    undone: 0,
    arena: 0,
    gone: 0
  });
  for (const book of [first, second]) assert.equal(work(repo, book), survivor.work_id);
  assert.notEqual(work(repo, other.small), work(repo, other.large));
  assert.deepEqual(repo.activeMerges("ol-duplicate").map((merge) => merge.fromWork).sort(), [first.work_id, second.work_id].sort());
  assert.ok(repo.activeMerges("ol-duplicate").every((merge) => merge.intoWork === survivor.work_id));
});

test("dry run reports the merge and changes nothing", () => {
  const repo = freshRepo();
  const { small, large, key } = twoDuplicates(repo, "Fourth Wing", "OL1W", "OL2W");

  const report = mergeDuplicateWorks(deps(repo), [key], true);

  assert.deepEqual(report, { merges: [{ titleKey: key, from: small.work_id, into: large.work_id }], undone: 0, arena: 0, gone: 0 });
  assert.equal(work(repo, small), small.work_id);
  assert.deepEqual(repo.activeMerges("ol-duplicate"), []);
});

test("a work that vanished between planning and merging counts as gone, and other errors propagate", () => {
  const repo = freshRepo();
  const { small, large, key } = twoDuplicates(repo, "Fourth Wing", "OL1W", "OL2W");
  const refusing = { ...repo, mergeDuplicateWork: () => { throw new WorkMergeError("That work was already merged."); } };
  assert.deepEqual(mergeDuplicateWorks(deps(refusing), [key]), { merges: [], undone: 0, arena: 0, gone: 1 });
  assert.equal(work(repo, small), small.work_id);
  const broken = { ...repo, mergeDuplicateWork: () => { throw new Error("disk full"); } };
  assert.throws(() => mergeDuplicateWorks(deps(broken), [key]), /disk full/);
  assert.equal(work(repo, large), large.work_id);
});

test("an undone duplicate merge stays undone", async () => {
  const repo = freshRepo();
  const a = edition(repo, "Fourth Wing", "OL1W", 1);
  const b = edition(repo, "Fourth Wing", "OL2W", 2);
  edition(repo, "Fourth Wing", "OL2W", 2);
  const key = repo.getBook(a.id)!.title_key!;
  repo.mergeDuplicateWork(a.work_id!, b.work_id!, at(3));
  assert.deepEqual(undoReviewedMerges(repo, [a.work_id!], () => NOW, () => {}), { undone: [a.work_id], failures: [] });
  assert.equal(work(repo, a), a.work_id);
  assert.equal(work(repo, b), b.work_id);

  const c = edition(repo, "Fourth Wing", "OL3W", 4);
  edition(repo, "Fourth Wing", "OL3W", 4);
  edition(repo, "Fourth Wing", "OL3W", 4);

  assert.deepEqual(mergeDuplicateWorks(deps(repo), [key]), { merges: [], undone: 1, arena: 0, gone: 0 });
  assert.deepEqual(await walkDuplicateWorks(deps(repo), { dryRun: false }), { merges: [], undone: 1, arena: 0, gone: 0 });
  assert.deepEqual([a, b, c].map((book) => work(repo, book)), [a.work_id, b.work_id, c.work_id]);
  assert.deepEqual(repo.activeMerges("ol-duplicate"), []);
});

test("skips works sharing an arena, at save and in the walk", async () => {
  const repo = freshRepo();
  const { small, large, key } = twoDuplicates(repo, "Fourth Wing", "OL1W", "OL2W");
  const sharing = deps(repo, () => true);

  assert.deepEqual(mergeDuplicateWorks(sharing, [key]), { merges: [], undone: 0, arena: 1, gone: 0 });
  assert.deepEqual(await walkDuplicateWorks(sharing, { dryRun: false }), { merges: [], undone: 0, arena: 1, gone: 0 });
  assert.equal(work(repo, small), small.work_id);
  assert.equal(work(repo, large), large.work_id);
  assert.deepEqual(repo.activeMerges("ol-duplicate"), []);
});

test("walk covers keys across pages", async () => {
  const repo = freshRepo();
  const wing = twoDuplicates(repo, "Fourth Wing", "OL1W", "OL2W");
  const flame = twoDuplicates(repo, "Iron Flame", "OL3W", "OL4W");
  edition(repo, "Onyx Storm", "OL5W", 1);
  const pages: string[][] = [];
  const spying = { ...repo, groupableTitleKeys: (after: string, limit: number) => { const keys = repo.groupableTitleKeys(after, limit); pages.push(keys); return keys; } };

  const report = await walkDuplicateWorks(deps(spying), { dryRun: false, pageSize: 1 });

  assert.deepEqual(report.merges.map((merge) => [merge.titleKey, merge.from, merge.into]).sort(), [
    [wing.key, wing.small.work_id, wing.large.work_id],
    [flame.key, flame.small.work_id, flame.large.work_id]
  ].sort());
  assert.deepEqual([report.undone, report.arena, report.gone], [0, 0, 0]);
  assert.equal(work(repo, wing.small), wing.large.work_id);
  assert.equal(work(repo, flame.small), flame.large.work_id);
  assert.deepEqual(pages.map((keys) => keys.length), [1, 1, 0]);
});

test("walk stops when the signal is aborted", async () => {
  const repo = freshRepo();
  const wing = twoDuplicates(repo, "Fourth Wing", "OL1W", "OL2W");
  const flame = twoDuplicates(repo, "Iron Flame", "OL3W", "OL4W");

  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await walkDuplicateWorks(deps(repo), { dryRun: false, signal: aborted.signal }), { merges: [], undone: 0, arena: 0, gone: 0 });
  assert.deepEqual(repo.activeMerges("ol-duplicate"), []);

  const controller = new AbortController();
  const stopping = deps(repo, () => { controller.abort(); return false; });
  const report = await walkDuplicateWorks(stopping, { dryRun: false, signal: controller.signal, pageSize: 1 });
  assert.equal(report.merges.length, 1);
  const done = [wing, flame].filter((pair) => work(repo, pair.small) === pair.large.work_id);
  assert.equal(done.length, 1);
});

test("walk pauses between pages when pauseMs is set", async (t) => {
  const repo = freshRepo();
  twoDuplicates(repo, "Fourth Wing", "OL1W", "OL2W");
  twoDuplicates(repo, "Iron Flame", "OL3W", "OL4W");
  const delays: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((callback: () => void, delay?: number) => {
    delays.push(delay ?? 0);
    return realSetTimeout(callback, 0);
  }) as typeof setTimeout);

  await walkDuplicateWorks(deps(repo), { dryRun: true, pageSize: 1 });
  assert.deepEqual(delays, []);

  await walkDuplicateWorks(deps(repo), { dryRun: true, pageSize: 1, pauseMs: 7919 });
  assert.ok(delays.length >= 1);
  assert.ok(delays.every((delay) => delay === 7919));
});
