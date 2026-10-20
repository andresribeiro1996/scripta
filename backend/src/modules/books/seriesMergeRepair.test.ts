import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "series-merge-repair-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { WorkMergeError } = await import("./domain/errors.js");
const { listSeriesCollapses, undoReviewedMerges } = await import("./seriesMergeRepair.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;
type Edition = ReturnType<Repo["getBook"]> & object;
const AT = "2026-10-20T12:00:00.000Z";
const NOW = Date.parse("2026-10-21T09:00:00.000Z");
const UNDONE_AT = new Date(NOW).toISOString();
const POPPY = "Janey Louise Jones";

function freshRepo() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

function edition(repo: Repo, isbn: string, title: string, author: string, fields: { workKey?: string; language?: string; originalTitle?: string } = {}): Edition {
  const book = repo.createBook({ title, author, isbn, workKey: fields.workKey }, [`isbn:${isbn}`], AT);
  if (fields.language) repo.setLanguage(book.id, fields.language);
  if (fields.originalTitle) repo.fillOriginalTitle(book.id, fields.originalTitle);
  return repo.getBook(book.id)!;
}

function poppy(repo: Repo) {
  const series = edition(repo, "9781408300001", "Princess Poppy", POPPY, { workKey: "OL970W" });
  const volumes = ["A Princesa Poppy e o Piquenique", "A Princesa Poppy e a Festa", "Poppy no Baile"].map((title, n) => edition(repo, `978972000070${n}`, title, POPPY, { language: "pt-PT", originalTitle: "Princess Poppy" }));
  return { series, volumes };
}

function joinInto(repo: Repo, from: Edition, into: Edition, source: "code" | "jev" | "manual" = "code") {
  repo.mergeTranslation(from.work_id!, into.work_id!, source, null, AT);
}

function chain(repo: Repo) {
  const target = edition(repo, "9780261102217", "The Hobbit", "J. R. R. Tolkien", { workKey: "OL971W" });
  const middle = edition(repo, "9789720000710", "O Hobbit", "J. R. R. Tolkien", { language: "pt-PT" });
  const first = edition(repo, "9789720000711", "O Hobbit Ilustrado", "J. R. R. Tolkien", { language: "pt-PT" });
  joinInto(repo, first, middle);
  joinInto(repo, middle, target, "jev");
  return { target, middle, first };
}

const none = { model: "manual", intoWorkId: null, confidence: null, askedAt: UNDONE_AT };
const quietly = () => {};

test("three Portuguese volumes code-joined into a series-named work are listed as series-like", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  for (const volume of volumes) joinInto(repo, volume, series);
  const listed = listSeriesCollapses(repo);
  assert.equal(listed.length, 1);
  const [target] = listed;
  assert.equal(target!.intoWork, series.work_id);
  assert.equal(target!.title, "Princess Poppy");
  assert.equal(target!.author, POPPY);
  assert.deepEqual(target!.editions, [{ title: "Princess Poppy", language: null, isbn: series.isbn, originalTitle: null }]);
  assert.deepEqual(target!.joined.map((joined) => [joined.fromWork, joined.source, joined.why]), volumes.map((volume) => [volume.work_id, "code", "series-like"]));
  assert.deepEqual(target!.joined[0]!.editions, [{ title: volumes[0]!.title, isbn: volumes[0]!.isbn, originalTitle: "Princess Poppy" }]);
  assert.deepEqual(target!.downstream, []);
});

test("two Vol. N editions code-joined into one work are listed as volume", () => {
  const { repo } = freshRepo();
  const alix = edition(repo, "9782203000001", "Alix Senator", "Valérie Mangin", { workKey: "OL972W" });
  const volumes = ["Alix Senator, Vol. 1 – A Montanha dos Mortos", "Alix Senator, Vol. 2 – O Último Faraó"].map((title, n) => edition(repo, `978972000072${n}`, title, "Valérie Mangin", { language: "pt-PT", originalTitle: "Alix Senator" }));
  for (const volume of volumes) joinInto(repo, volume, alix);
  const listed = listSeriesCollapses(repo);
  assert.deepEqual(listed.map((target) => [target.intoWork, target.joined.map((joined) => joined.why)]), [[alix.work_id, ["volume", "volume"]]]);
});

test("a genuine two-title translation join is not listed", () => {
  const { repo } = freshRepo();
  const lighthouse = edition(repo, "9780156907501", "To the Lighthouse", "Virginia Woolf", { workKey: "OL973W" });
  for (const [n, title] of ["Passeio ao Farol", "Rumo ao Farol"].entries()) joinInto(repo, edition(repo, `978972000073${n}`, title, "Virginia Woolf", { language: "pt-PT", originalTitle: "To the Lighthouse" }), lighthouse);
  assert.deepEqual(listSeriesCollapses(repo), []);
});

test("a listed target shows its jev, manual and admin joins too, and a target with only a jev join is not listed", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  for (const volume of volumes) joinInto(repo, volume, series);
  const natal = edition(repo, "9789720000740", "A Princesa Poppy e o Natal", POPPY, { language: "pt-PT", originalTitle: "Princess Poppy" });
  const colouring = edition(repo, "9789720000741", "Livro de Colorir", POPPY, { language: "pt-PT" });
  joinInto(repo, natal, series, "jev");
  joinInto(repo, colouring, series, "manual");
  const poster = edition(repo, "9789720000743", "Poster de Poppy", POPPY, { language: "pt-PT" });
  repo.mergeWorks(poster.work_id!, series.work_id!, AT);
  const alix = edition(repo, "9782203000002", "Alix Senator", "Valérie Mangin", { workKey: "OL974W" });
  joinInto(repo, edition(repo, "9789720000742", "Alix Senator, Vol. 3 – A Cidade", "Valérie Mangin", { language: "pt-PT" }), alix, "jev");
  const listed = listSeriesCollapses(repo);
  assert.deepEqual(listed.map((target) => target.intoWork), [series.work_id]);
  assert.deepEqual(listed[0]!.joined.slice(3).map((joined) => [joined.fromWork, joined.source, joined.why]), [[natal.work_id, "jev", "series-like"], [colouring.work_id, "manual", null], [poster.work_id, "admin", null]]);
  assert.deepEqual(listed[0]!.editions.map((own) => own.title), ["Princess Poppy"]);
});

test("a target joined onward since still shows the joined editions and the join that took it onward", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  for (const volume of volumes) joinInto(repo, volume, series);
  const poppys = edition(repo, "9781408300002", "Princess Poppy Collection", POPPY, { workKey: "OL975W" });
  joinInto(repo, series, poppys, "jev");
  const [target] = listSeriesCollapses(repo);
  assert.equal(target!.intoWork, series.work_id);
  assert.equal(target!.title, "Princess Poppy Collection");
  assert.deepEqual(target!.downstream, [{ mergeId: 4, fromWork: series.work_id, intoWork: poppys.work_id, source: "jev" }]);
  assert.deepEqual(target!.joined.map((joined) => joined.editions.map((own) => own.title)), volumes.map((volume) => [volume.title]));
});

test("listing works on a read-only file handle and leaves the file byte for byte as it was", () => {
  const path = join(scratch, "read-only.sqlite");
  const writable = new DatabaseSync(path);
  applyBooksMigrations(writable);
  const repo = createSqliteBooksRepository(writable);
  const { series, volumes } = poppy(repo);
  for (const volume of volumes) joinInto(repo, volume, series);
  writable.close();
  const before = readFileSync(path);
  const db = new DatabaseSync(path, { readOnly: true });
  assert.throws(() => db.exec("DELETE FROM work_merges"), /readonly/);
  const listed = listSeriesCollapses(createSqliteBooksRepository(db));
  db.close();
  assert.deepEqual(listed.map((target) => [target.intoWork, target.joined.length]), [[series.work_id, 3]]);
  assert.ok(readFileSync(path).equals(before));
});

test("undoing two of three volumes restores exactly those two, newest first, with a manual answer of none", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  for (const volume of volumes) joinInto(repo, volume, series);
  const [first, second, third] = volumes as [Edition, Edition, Edition];
  const progress: string[] = [];
  assert.deepEqual(undoReviewedMerges(repo, [first.work_id!, third.work_id!], () => NOW, (fromWork) => progress.push(fromWork)), { undone: [third.work_id, first.work_id], failures: [] });
  assert.deepEqual(progress, [third.work_id, first.work_id]);
  for (const volume of [first, third]) {
    assert.equal(repo.getBook(volume.id)!.work_id, volume.work_id);
    assert.deepEqual(repo.workMatchJudgments([volume.work_id!]).get(volume.work_id!), none);
  }
  assert.equal(repo.getBook(second.id)!.work_id, series.work_id);
  assert.equal(repo.workMatchJudgments([second.work_id!]).size, 0);
});

test("a jev join is undone too, and a manual join is reported and left alone", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  const [coded, judged, manual] = volumes as [Edition, Edition, Edition];
  joinInto(repo, coded, series);
  joinInto(repo, judged, series, "jev");
  joinInto(repo, manual, series, "manual");
  assert.deepEqual(undoReviewedMerges(repo, volumes.map((volume) => volume.work_id!), () => NOW, quietly), { undone: [judged.work_id, coded.work_id], failures: [{ fromWork: manual.work_id, reason: "no active code or jev join" }] });
  assert.equal(repo.getBook(coded.id)!.work_id, coded.work_id);
  assert.equal(repo.getBook(judged.id)!.work_id, judged.work_id);
  assert.equal(repo.getBook(manual.id)!.work_id, series.work_id);
  assert.equal(repo.workMatchJudgments([manual.work_id!]).size, 0);
});

test("every requested id is reported: a typo, a manual join and a join already undone are failures", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  const [coded, manual, gone] = volumes as [Edition, Edition, Edition];
  joinInto(repo, coded, series);
  joinInto(repo, manual, series, "manual");
  joinInto(repo, gone, series);
  repo.undoMerge(gone.work_id!, AT);
  const reason = "no active code or jev join";
  assert.deepEqual(undoReviewedMerges(repo, [coded.work_id!, manual.work_id!, gone.work_id!, "no-such-work"], () => NOW, quietly), {
    undone: [coded.work_id],
    failures: [{ fromWork: manual.work_id, reason }, { fromWork: gone.work_id, reason }, { fromWork: "no-such-work", reason }]
  });
});

test("a chain X to A to T given as X and A undoes the newest join first", () => {
  const { repo } = freshRepo();
  const { target, middle, first } = chain(repo);
  assert.deepEqual(undoReviewedMerges(repo, [first.work_id!, middle.work_id!], () => NOW, quietly), { undone: [middle.work_id, first.work_id], failures: [] });
  assert.equal(repo.getBook(first.id)!.work_id, first.work_id);
  assert.equal(repo.getBook(middle.id)!.work_id, middle.work_id);
  assert.equal(repo.getBook(target.id)!.work_id, target.work_id);
});

test("list, review and undo on a target that was joined onward twice: the onward joins come off first, newest first", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  for (const volume of volumes) joinInto(repo, volume, series);
  const collection = edition(repo, "9781408300002", "Princess Poppy Collection", POPPY, { workKey: "OL975W" });
  const omnibus = edition(repo, "9781408300003", "Princess Poppy Omnibus", POPPY, { workKey: "OL976W" });
  joinInto(repo, series, collection, "jev");
  joinInto(repo, collection, omnibus, "jev");
  const [target] = listSeriesCollapses(repo);
  assert.deepEqual(target!.downstream, [
    { mergeId: 4, fromWork: series.work_id, intoWork: collection.work_id, source: "jev" },
    { mergeId: 5, fromWork: collection.work_id, intoWork: omnibus.work_id, source: "jev" }
  ]);
  const [first, second, third] = volumes as [Edition, Edition, Edition];
  const review = [...target!.downstream.map((step) => step.fromWork), first.work_id!, third.work_id!];
  const progress: string[] = [];
  assert.deepEqual(undoReviewedMerges(repo, review, () => NOW, (fromWork) => progress.push(fromWork)), { undone: [collection.work_id, series.work_id, third.work_id, first.work_id], failures: [] });
  assert.deepEqual(progress, [collection.work_id, series.work_id, third.work_id, first.work_id]);
  assert.equal(repo.getBook(series.id)!.work_id, series.work_id);
  assert.equal(repo.getBook(collection.id)!.work_id, collection.work_id);
  assert.equal(repo.getBook(omnibus.id)!.work_id, omnibus.work_id);
  assert.equal(repo.getBook(first.id)!.work_id, first.work_id);
  assert.equal(repo.getBook(third.id)!.work_id, third.work_id);
  assert.equal(repo.getBook(second.id)!.work_id, series.work_id);
});

test("a volume whose target was joined onward by a join that is not being undone is reported with that join", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  const collection = edition(repo, "9781408300002", "Princess Poppy Collection", POPPY, { workKey: "OL975W" });
  joinInto(repo, volumes[0]!, series);
  joinInto(repo, series, collection, "manual");
  const result = undoReviewedMerges(repo, [volumes[0]!.work_id!], () => NOW, quietly);
  assert.deepEqual(result.undone, []);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]!.fromWork, volumes[0]!.work_id);
  assert.match(result.failures[0]!.reason, new RegExp(`manual join \\(${series.work_id} to ${collection.work_id}\\)`));
  assert.equal(repo.getBook(volumes[0]!.id)!.work_id, collection.work_id);
  assert.equal(repo.workMatchJudgments([volumes[0]!.work_id!]).size, 0);
});

test("an undo the repository refuses lands in failures and writes nothing", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  joinInto(repo, volumes[0]!, series);
  const refusing = { ...repo, undoMerge: () => { throw new WorkMergeError("That merge can no longer be undone."); } };
  assert.deepEqual(undoReviewedMerges(refusing, [volumes[0]!.work_id!], () => NOW, quietly), { undone: [], failures: [{ fromWork: volumes[0]!.work_id, reason: "That merge can no longer be undone." }] });
  assert.equal(repo.getBook(volumes[0]!.id)!.work_id, series.work_id);
});

test("an error other than a refused undo propagates and rolls the undo back", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  joinInto(repo, volumes[0]!, series);
  const broken = { ...repo, saveWorkMatchJudgment: () => { throw new Error("disk full"); } };
  assert.throws(() => undoReviewedMerges(broken, [volumes[0]!.work_id!], () => NOW, quietly), /disk full/);
  assert.equal(repo.getBook(volumes[0]!.id)!.work_id, series.work_id);
  assert.deepEqual(repo.activeMerges("code").map((merge) => merge.fromWork), [volumes[0]!.work_id]);
});
