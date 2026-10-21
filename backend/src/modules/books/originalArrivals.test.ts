import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { OriginalClaim } from "./domain/translation.js";

const scratch = mkdtempSync(join(tmpdir(), "original-arrivals-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { joinArrivedOriginals, sharedOriginals, startOriginalArrivals } = await import("./originalArrivals.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
const AT = "2026-10-15T12:00:00.000Z";
const BEFORE = "2026-10-15T11:00:00.000Z";
const NOW = Date.parse(AT);

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function book(repo: Repo, isbn: string, title: string, author: string, extra: { workKey?: string; language?: string } = {}) {
  const row = repo.createBook({ title, author, isbn, workKey: extra.workKey }, [`isbn:${isbn}`], AT);
  if (extra.language) repo.setLanguage(row.id, extra.language);
  return repo.getBook(row.id)!;
}

function claimant(repo: Repo, isbn: string, title: string, author: string, original: string, workKey?: string) {
  const row = book(repo, isbn, title, author, { language: "pt-PT", workKey });
  repo.fillOriginalTitle(row.id, original);
  return repo.getBook(row.id)!;
}

function emptyQueue(repo: Repo) {
  for (const key of repo.originalArrivals(1000)) repo.dropOriginalArrival(key);
}

function arriveLighthouse(repo: Repo, workKey: string | null = "OL960W") {
  emptyQueue(repo);
  return book(repo, "9780156907501", "To the Lighthouse", "Virginia Woolf", { workKey: workKey ?? undefined });
}

const drain = (repo: Repo, limit = 500) => joinArrivedOriginals({ repo, sharesArena: () => false, now: () => NOW }, limit);

const claim = (title: string, originalTitle: string, author = "Virginia Woolf", language: string | null = "pt-PT"): OriginalClaim => ({ workId: null, title, author, language, originalTitle });

test("two Portuguese titles for one original make it shared", () => {
  const shared = sharedOriginals([claim("Passeio ao Farol", "To the Lighthouse"), claim("Rumo ao Farol", "To the Lighthouse")]);
  assert.equal(shared("To the Lighthouse", "Virginia Woolf"), true);
});

test("one Portuguese title claimed twice is not shared", () => {
  const shared = sharedOriginals([claim("Passeio ao Farol", "To the Lighthouse"), claim("Passeio ao Farol", "To the Lighthouse")]);
  assert.equal(shared("To the Lighthouse", "Virginia Woolf"), false);
});

test("two whole originals behind one original key make it shared", () => {
  const shared = sharedOriginals([claim("Crónicas", "Chronicles", "Ana Silva"), claim("Crónicas", "Chronicles: Dusk", "Ana Silva")]);
  assert.equal(shared("Chronicles", "Ana Silva"), true);
});

test("English claims and claims naming themselves do not count", () => {
  const english = sharedOriginals([claim("Passeio ao Farol", "To the Lighthouse"), claim("Rumo ao Farol", "To the Lighthouse", "Virginia Woolf", "en")]);
  assert.equal(english("To the Lighthouse", "Virginia Woolf"), false);
  const named = sharedOriginals([claim("Orlando", "Orlando"), claim("Orlando, Uma Vida", "Orlando")]);
  assert.equal(named("Orlando", "Virginia Woolf"), false);
});

test("another surname has its own bucket", () => {
  const shared = sharedOriginals([claim("Passeio ao Farol", "To the Lighthouse"), claim("Rumo ao Farol", "To the Lighthouse", "Rui Costa")]);
  assert.equal(shared("To the Lighthouse", "Virginia Woolf"), false);
  assert.equal(shared("To the Lighthouse", "Rui Costa"), false);
  assert.equal(shared("To the Lighthouse", "Ana Silva"), false);
});

test("an arriving original joins a work Jev answered none", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  repo.saveWorkMatchJudgment(pt.work_id!, { model: "jev-1", intoWorkId: null, confidence: 0.2, askedAt: BEFORE });
  const en = arriveLighthouse(repo);
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 1, codeBlocked: 0 });
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), en.work_id);
  assert.deepEqual(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!), { model: "code", intoWorkId: en.work_id, confidence: null, askedAt: AT });
  assert.deepEqual(repo.originalArrivals(10), []);
});

test("an arriving original joins an unjudged work", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const en = arriveLighthouse(repo);
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 1, codeBlocked: 0 });
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), en.work_id);
});

test("the owner's answer is final", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const manual = { model: "manual", intoWorkId: null, confidence: null, askedAt: BEFORE };
  repo.saveWorkMatchJudgment(pt.work_id!, manual);
  arriveLighthouse(repo);
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.deepEqual(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!), manual);
  assert.deepEqual(repo.originalArrivals(10), []);
});

test("an answer that names a work is left alone", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const other = book(repo, "9780000000002", "Orlando", "Virginia Woolf", { workKey: "OL1W" });
  const named = { model: "jev-1", intoWorkId: other.work_id!, confidence: 0.7, askedAt: BEFORE };
  repo.saveWorkMatchJudgment(pt.work_id!, named);
  arriveLighthouse(repo);
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.deepEqual(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!), named);
});

test("a series-named original joins none of its volumes", () => {
  const repo = freshRepo();
  const volumes = [
    claimant(repo, "9789720000601", "Poppy e o Pónei", "Janey Louise Jones", "Princess Poppy"),
    claimant(repo, "9789720000602", "Poppy no Mar", "Janey Louise Jones", "Princess Poppy"),
    claimant(repo, "9789720000603", "Poppy na Neve", "Janey Louise Jones", "Princess Poppy")
  ];
  emptyQueue(repo);
  const series = book(repo, "9781408300001", "Princess Poppy", "Janey Louise Jones", { workKey: "OL962W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  for (const volume of volumes) {
    assert.equal(repo.canonicalWorkIds([volume.work_id!]).get(volume.work_id!), volume.work_id);
    assert.equal(repo.workMatchJudgments([volume.work_id!]).size, 0);
  }
  assert.equal(repo.getBook(series.id)!.work_id, series.work_id);
});

test("a volume title never settles in code", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "O Farol, Vol. 1", "Virginia Woolf", "To the Lighthouse");
  arriveLighthouse(repo);
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
});

test("an original two Portuguese titles share is not joined", () => {
  const repo = freshRepo();
  const first = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const second = claimant(repo, "9789720000502", "Rumo ao Farol", "Virginia Woolf", "To the Lighthouse");
  arriveLighthouse(repo);
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([first.work_id!, second.work_id!]).size, 0);
});

test("a series name recorded as the original joins no volume", () => {
  const repo = freshRepo();
  const first = claimant(repo, "9789720000701", "Capitão Grisam", "Elisabetta Gnone", "Fairy Oak");
  const second = claimant(repo, "9789720000702", "O Segredo das Gémeas", "Elisabetta Gnone", "Fairy Oak: Il segreto delle gemelle");
  emptyQueue(repo);
  book(repo, "9788884510001", "Fairy Oak", "Elisabetta Gnone", { workKey: "OL963W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([first.work_id!, second.work_id!]).size, 0);
  assert.equal(repo.canonicalWorkIds([first.work_id!]).get(first.work_id!), first.work_id);
});

test("an original with a subtitle part is not joined by its main title", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000801", "O Messias de Dune", "Frank Herbert", "Dune: Messiah");
  emptyQueue(repo);
  book(repo, "9780441172696", "Dune: Messiah", "Frank Herbert", { workKey: "OL893415W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
});

test("a work whose whole title differs from the original is not joined", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000802", "Duna", "Frank Herbert", "Dune");
  emptyQueue(repo);
  book(repo, "9780441172696", "Dune: Messiah", "Frank Herbert", { workKey: "OL893415W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), pt.work_id);
});

test("an arena that holds both works blocks the merge but records the answer", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const en = arriveLighthouse(repo);
  const steps = joinArrivedOriginals({ repo, sharesArena: () => true, now: () => NOW }, 500);
  assert.deepEqual(steps, { arrivals: 1, claimants: 1, codeMerges: 0, codeBlocked: 1 });
  assert.deepEqual(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!), { model: "code", intoWorkId: en.work_id, confidence: null, askedAt: AT });
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), pt.work_id);
});

test("a work whose first edition names another original is not planned", () => {
  const repo = freshRepo();
  const first = claimant(repo, "9789720000901", "Um Orlando", "Virginia Woolf", "Orlando", "OL77W");
  const second = claimant(repo, "9789720000902", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse", "OL77W");
  assert.equal(first.work_id, second.work_id);
  arriveLighthouse(repo);
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([first.work_id!]).size, 0);
});

test("two works for the original leave the question to Jev", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  book(repo, "9780156907502", "To the Lighthouse", "Virginia Woolf", { workKey: "OL1W" });
  emptyQueue(repo);
  book(repo, "9780156907501", "To the Lighthouse", "Virginia Woolf", { workKey: "OL2W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), pt.work_id);
});

test("a title nobody claims is dropped from the queue", () => {
  const repo = freshRepo();
  emptyQueue(repo);
  book(repo, "9780000000010", "Some Other Book", "Anyone Else");
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.deepEqual(repo.originalArrivals(10), []);
});

test("the limit caps the keys drained", () => {
  const repo = freshRepo();
  emptyQueue(repo);
  book(repo, "9780000000011", "First Book", "Anyone Else");
  book(repo, "9780000000012", "Second Book", "Anyone Else");
  book(repo, "9780000000013", "Third Book", "Anyone Else");
  assert.equal(drain(repo, 2).arrivals, 2);
  assert.equal(repo.originalArrivals(10).length, 1);
});

test("a blank author filled in queues the title and joins its claimants", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  emptyQueue(repo);
  const en = book(repo, "9780156907501", "To the Lighthouse", "", { workKey: "OL960W" });
  assert.deepEqual(repo.originalArrivals(10), []);
  repo.fillIdentity(en.id, "To the Lighthouse", "Virginia Woolf");
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 1, codeBlocked: 0 });
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), en.work_id);
});

test("an original without a work key waits for it", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  const en = arriveLighthouse(repo, null);
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 0, codeBlocked: 0 });
  assert.deepEqual(repo.originalArrivals(10), []);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
  repo.setWorkKey(en.id, "OL960W");
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 1, codeBlocked: 0 });
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), repo.getBook(en.id)!.work_id);
});

test("a failed join rolls back and leaves the key queued", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  arriveLighthouse(repo);
  const failing = { ...repo, mergeTranslation: () => { throw new Error("boom"); } };
  assert.throws(() => joinArrivedOriginals({ repo: failing, sharesArena: () => false, now: () => NOW }, 500), /boom/);
  assert.equal(repo.originalArrivals(10).length, 1);
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
});

test("the job joins on its first tick and logs what it did", async () => {
  const repo = freshRepo();
  claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse");
  arriveLighthouse(repo);
  const logged: Array<{ details: Record<string, unknown>; message: string }> = [];
  const errors: unknown[] = [];
  const stop = startOriginalArrivals({
    repo,
    sharesArena: () => false,
    now: () => NOW,
    info: (details, message) => logged.push({ details, message }),
    onError: (error) => errors.push(error)
  });
  await new Promise(setImmediate);
  stop();
  assert.deepEqual(errors, []);
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.message, "original arrivals joined");
  assert.equal(logged[0]!.details.codeMerges, 1);
});
