import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "original-arrivals-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { catalogTitleKey } = await import("./domain/normalize.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { joinArrivedOriginals, startOriginalArrivals } = await import("./originalArrivals.js");

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

const rethrow = (error: unknown): never => {
  throw error;
};

const drain = (repo: Repo, limit = 500) => joinArrivedOriginals({ repo, sharesArena: () => false, now: () => NOW }, limit, rethrow);

function drainReading(repo: Repo) {
  const read: string[] = [];
  const reading = { ...repo, translationEvidence: (workId: string) => (read.push(workId), repo.translationEvidence(workId)) };
  return { steps: joinArrivedOriginals({ repo: reading, sharesArena: () => false, now: () => NOW }, 500, rethrow), read };
}

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

test("an original with a part after a full stop is not joined by the title before it", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000803", "O Rei de Ferro", "Maurice Druon", "Les rois maudits. Le roi de fer");
  emptyQueue(repo);
  book(repo, "9782253000803", "Les rois maudits", "Maurice Druon", { workKey: "OL964W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
});

test("an original with a full stop joins when it arrives under its whole title", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000811", "O Senhor Mercedes", "Stephen King", "Mr. Mercedes");
  emptyQueue(repo);
  const en = book(repo, "9781501125607", "Mr. Mercedes", "Stephen King", { workKey: "OL17073965W" });
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 1, codeMerges: 1, codeBlocked: 0 });
  assert.equal(repo.canonicalWorkIds([pt.work_id!]).get(pt.work_id!), en.work_id);
  assert.deepEqual(repo.workMatchJudgments([pt.work_id!]).get(pt.work_id!), { model: "code", intoWorkId: en.work_id, confidence: null, askedAt: AT });
});

test("another original under the same full-stop stem is never read, and the two count as one shared original", () => {
  const repo = freshRepo();
  const mercedes = claimant(repo, "9789720000812", "O Senhor Mercedes", "Stephen King", "Mr. Mercedes");
  const harrigan = claimant(repo, "9789720000813", "O Telefone do Sr. Harrigan", "Stephen King", "Mr. Harrigan's Phone");
  emptyQueue(repo);
  book(repo, "9781501125607", "Mr. Mercedes", "Stephen King", { workKey: "OL17073965W" });
  const { steps, read } = drainReading(repo);
  assert.deepEqual(steps, { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.deepEqual(read, [mercedes.work_id]);
  assert.equal(repo.workMatchJudgments([mercedes.work_id!, harrigan.work_id!]).size, 0);
});

test("an original with a dash part is found when it arrives whole but stays skipped as a subtitle original", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000814", "A Profecia Sombria", "Rick Riordan", "The Trials of Apollo - The Dark Prophecy");
  emptyQueue(repo);
  book(repo, "9781484746424", "The Trials of Apollo - The Dark Prophecy", "Rick Riordan", { workKey: "OL19345722W" });
  const { steps, read } = drainReading(repo);
  assert.deepEqual(steps, { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.deepEqual(read, [pt.work_id]);
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
  const steps = joinArrivedOriginals({ repo, sharesArena: () => true, now: () => NOW }, 500, rethrow);
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

test("a key that fails rolls back whole and does not hold up the next one", () => {
  const repo = freshRepo();
  const first = claimant(repo, "9789720000501", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse", "OL91W");
  const second = claimant(repo, "9789720000502", "Passeio ao Farol", "Virginia Woolf", "To the Lighthouse", "OL92W");
  const duna = claimant(repo, "9789720000803", "Duna", "Frank Herbert", "Dune");
  const lighthouse = arriveLighthouse(repo);
  const dune = book(repo, "9780441172696", "Dune", "Frank Herbert", { workKey: "OL893415W" });
  const lighthouseKey = catalogTitleKey("To the Lighthouse", "Virginia Woolf");
  let toLighthouse = 0;
  const failing = {
    ...repo,
    mergeTranslation: (...args: Parameters<Repo["mergeTranslation"]>) => {
      if (args[1] === lighthouse.work_id && ++toLighthouse === 2) throw new Error("boom");
      return repo.mergeTranslation(...args);
    }
  };
  const failures: Array<{ error: unknown; titleKey: string }> = [];
  const steps = joinArrivedOriginals({ repo: failing, sharesArena: () => false, now: () => NOW }, 500, (error, titleKey) => failures.push({ error, titleKey }));
  assert.equal(failures.length, 1);
  assert.match((failures[0]!.error as Error).message, /boom/);
  assert.equal(failures[0]!.titleKey, lighthouseKey);
  assert.deepEqual(repo.originalArrivals(10), [lighthouseKey]);
  for (const work of [first.work_id!, second.work_id!]) {
    assert.equal(repo.canonicalWorkIds([work]).get(work), work);
    assert.equal(repo.workMatchJudgments([work]).size, 0);
  }
  assert.equal(steps.codeMerges, 1);
  assert.equal(repo.canonicalWorkIds([duna.work_id!]).get(duna.work_id!), dune.work_id);
});

test("only works whose author is the arriving author are planned", () => {
  const repo = freshRepo();
  const pt = claimant(repo, "9789720000501", "Passeio ao Farol", "Ana Silva", "To the Lighthouse");
  arriveLighthouse(repo);
  assert.deepEqual(drain(repo), { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 });
  assert.equal(repo.workMatchJudgments([pt.work_id!]).size, 0);
  assert.deepEqual(repo.originalArrivals(10), []);
});

test("a tick stops starting keys once its time is up and leaves the rest queued", () => {
  const repo = freshRepo();
  emptyQueue(repo);
  book(repo, "9780000000011", "First Book", "Anyone Else");
  book(repo, "9780000000012", "Second Book", "Anyone Else");
  book(repo, "9780000000013", "Third Book", "Anyone Else");
  let clock = NOW;
  const now = () => {
    clock += 150;
    return clock - 150;
  };
  assert.equal(joinArrivedOriginals({ repo, sharesArena: () => false, now }, 500, rethrow).arrivals, 1);
  assert.equal(repo.originalArrivals(10).length, 2);
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
