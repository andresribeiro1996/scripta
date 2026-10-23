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
const { arenaCheck } = await import("./translationJudgments.js");

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

const counts = { seriesName: 0, crowded: 0, undone: 0, arena: 0, gone: 0 };

function twoDuplicates(repo: Repo, title: string, firstKey: string, secondKey: string) {
  const small = edition(repo, title, firstKey, 2);
  const large = edition(repo, title, secondKey, 1);
  edition(repo, title, secondKey, 1);
  return { small, large, key: repo.getBook(small.id)!.title_key! };
}

const work = (repo: Repo, book: { id: string }) => repo.getBook(book.id)!.work_id;

test("merges a duplicate keyed pair for the given keys and leaves the other key's pair", () => {
  const repo = freshRepo();
  const survivor = edition(repo, "Fourth Wing", "OL2W", 1);
  edition(repo, "Fourth Wing", "OL2W", 1);
  const first = edition(repo, "Fourth Wing", "OL1W", 2);
  const other = twoDuplicates(repo, "Iron Flame", "OL4W", "OL5W");
  const key = repo.getBook(survivor.id)!.title_key!;

  const report = mergeDuplicateWorks(deps(repo), [key]);

  assert.deepEqual(report, { merges: [{ titleKey: key, from: first.work_id, into: survivor.work_id }], ...counts });
  assert.equal(work(repo, first), survivor.work_id);
  assert.notEqual(work(repo, other.small), work(repo, other.large));
  assert.deepEqual(repo.activeMerges("ol-duplicate").map((merge) => [merge.fromWork, merge.intoWork]), [[first.work_id, survivor.work_id]]);
});

test("keeps a pair apart when its full title is a series name, from work_series or book_collections", async () => {
  const repo = freshRepo();
  const nate = twoDuplicates(repo, "Big Nate", "OL1W", "OL2W");
  const diaries = twoDuplicates(repo, "Dork Diaries", "OL3W", "OL4W");
  const flame = twoDuplicates(repo, "Iron Flame", "OL5W", "OL6W");
  repo.addWorkSeries(nate.small.work_id!, [{ name: "Big Nate", position: null }], "ol-subject", at(3));
  repo.addBookCollection(diaries.large.id, { name: "Dork Diaries", position: null }, "bnp", at(3));
  const keys = [nate.key, diaries.key, flame.key];

  assert.deepEqual(mergeDuplicateWorks(deps(repo), keys, true), {
    merges: [{ titleKey: flame.key, from: flame.small.work_id, into: flame.large.work_id }],
    ...counts,
    seriesName: 2
  });
  assert.deepEqual(await walkDuplicateWorks(deps(repo), { dryRun: false, pageSize: 1 }), {
    merges: [{ titleKey: flame.key, from: flame.small.work_id, into: flame.large.work_id }],
    ...counts,
    seriesName: 2
  });
  assert.notEqual(work(repo, nate.small), work(repo, nate.large));
  assert.notEqual(work(repo, diaries.small), work(repo, diaries.large));
  assert.equal(work(repo, flame.small), flame.large.work_id);
  assert.deepEqual(repo.activeMerges("ol-duplicate").map((merge) => merge.fromWork), [flame.small.work_id]);
});

test("keeps a survivor and two others apart as crowded, at save and in the walk", async () => {
  const repo = freshRepo();
  const a = edition(repo, "Fourth Wing", "OL1W", 1);
  const b = edition(repo, "Fourth Wing", "OL2W", 2);
  const c = edition(repo, "Fourth Wing", "OL3W", 3);
  const key = repo.getBook(a.id)!.title_key!;

  assert.deepEqual(mergeDuplicateWorks(deps(repo), [key]), { merges: [], ...counts, crowded: 2 });
  assert.deepEqual(await walkDuplicateWorks(deps(repo), { dryRun: false }), { merges: [], ...counts, crowded: 2 });
  assert.deepEqual([a, b, c].map((book) => work(repo, book)), [a.work_id, b.work_id, c.work_id]);
  assert.deepEqual(repo.activeMerges("ol-duplicate"), []);
});

test("a series' volumes do not collapse one pair at a time, at save and in the walk", async () => {
  const repo = freshRepo();
  const first = edition(repo, "Bone", "OL1W", 1, "Jeff Smith");
  const second = edition(repo, "Bone", "OL2W", 1, "Jeff Smith");
  edition(repo, "Bone", "OL2W", 1, "Jeff Smith");
  const key = repo.getBook(first.id)!.title_key!;
  assert.deepEqual(mergeDuplicateWorks(deps(repo), [key]), { merges: [{ titleKey: key, from: first.work_id, into: second.work_id }], ...counts });
  const third = edition(repo, "Bone", "OL3W", 3, "Jeff Smith");

  assert.deepEqual(mergeDuplicateWorks(deps(repo), [key]), { merges: [], ...counts, crowded: 1 });
  assert.deepEqual(await walkDuplicateWorks(deps(repo), { dryRun: false }), { merges: [], ...counts, crowded: 1 });
  assert.equal(work(repo, third), third.work_id);
  assert.deepEqual(repo.activeMerges("ol-duplicate").map((merge) => [merge.fromWork, merge.intoWork]), [[first.work_id, second.work_id]]);
});

test("dry run reports the merge and changes nothing", () => {
  const repo = freshRepo();
  const { small, large, key } = twoDuplicates(repo, "Fourth Wing", "OL1W", "OL2W");

  const report = mergeDuplicateWorks(deps(repo), [key], true);

  assert.deepEqual(report, { merges: [{ titleKey: key, from: small.work_id, into: large.work_id }], ...counts });
  assert.equal(work(repo, small), small.work_id);
  assert.deepEqual(repo.activeMerges("ol-duplicate"), []);
});

test("a work that vanished between planning and merging counts as gone, and other errors propagate", () => {
  const repo = freshRepo();
  const { small, large, key } = twoDuplicates(repo, "Fourth Wing", "OL1W", "OL2W");
  const refusing = { ...repo, mergeDuplicateWork: () => { throw new WorkMergeError("That work was already merged."); } };
  assert.deepEqual(mergeDuplicateWorks(deps(refusing), [key]), { merges: [], ...counts, gone: 1 });
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

  assert.deepEqual(mergeDuplicateWorks(deps(repo), [key]), { merges: [], ...counts, undone: 1 });
  assert.deepEqual(await walkDuplicateWorks(deps(repo), { dryRun: false }), { merges: [], ...counts, undone: 1 });
  assert.deepEqual([a, b].map((book) => work(repo, book)), [a.work_id, b.work_id]);
  assert.deepEqual(repo.activeMerges("ol-duplicate"), []);

  const c = edition(repo, "Fourth Wing", "OL3W", 4);

  assert.deepEqual(mergeDuplicateWorks(deps(repo), [key]), { merges: [], ...counts, crowded: 2 });
  assert.deepEqual(await walkDuplicateWorks(deps(repo), { dryRun: false }), { merges: [], ...counts, crowded: 2 });
  assert.deepEqual([a, b, c].map((book) => work(repo, book)), [a.work_id, b.work_id, c.work_id]);
  assert.deepEqual(repo.activeMerges("ol-duplicate"), []);
});

test("skips works sharing an arena, at save and in the walk", async () => {
  const repo = freshRepo();
  const { small, large, key } = twoDuplicates(repo, "Fourth Wing", "OL1W", "OL2W");
  const sharing = deps(repo, () => true);

  assert.deepEqual(mergeDuplicateWorks(sharing, [key]), { merges: [], ...counts, arena: 1 });
  assert.deepEqual(await walkDuplicateWorks(sharing, { dryRun: false }), { merges: [], ...counts, arena: 1 });
  assert.equal(work(repo, small), small.work_id);
  assert.equal(work(repo, large), large.work_id);
  assert.deepEqual(repo.activeMerges("ol-duplicate"), []);
});

test("a work that shares an arena with one already merged into the survivor is skipped, by live aliases", () => {
  const repo = freshRepo();
  const survivor = edition(repo, "Fourth Wing", "OL1W", 1);
  edition(repo, "Fourth Wing", "OL1W", 1);
  const a = edition(repo, "Quarta Asa", "OL2W", 2);
  repo.mergeTranslation(a.work_id!, survivor.work_id!, "code", null, at(3));
  const b = edition(repo, "Fourth Wing", "OL3W", 3);
  const key = repo.getBook(survivor.id)!.title_key!;
  const tournament = new Set([a.work_id, b.work_id]);
  const worksShareAnArena = (left: string[], right: string[]) => left.some((id) => tournament.has(id)) && right.some((id) => tournament.has(id));

  const report = mergeDuplicateWorks(deps(repo, arenaCheck(repo, worksShareAnArena)), [key]);

  assert.deepEqual(report, { merges: [], ...counts, arena: 1 });
  assert.equal(work(repo, a), survivor.work_id);
  assert.equal(work(repo, b), b.work_id);
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
  assert.deepEqual([report.seriesName, report.crowded, report.undone, report.arena, report.gone], [0, 0, 0, 0, 0]);
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
  assert.deepEqual(await walkDuplicateWorks(deps(repo), { dryRun: false, signal: aborted.signal }), { merges: [], ...counts });
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
