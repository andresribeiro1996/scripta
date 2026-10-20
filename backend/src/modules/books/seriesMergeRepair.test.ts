import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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

const none = { model: "code", intoWorkId: null, confidence: null, askedAt: UNDONE_AT };

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

test("a listed target shows its jev and manual joins too, and a target with only a jev join is not listed", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  for (const volume of volumes) joinInto(repo, volume, series);
  const natal = edition(repo, "9789720000740", "A Princesa Poppy e o Natal", POPPY, { language: "pt-PT", originalTitle: "Princess Poppy" });
  const colouring = edition(repo, "9789720000741", "Livro de Colorir", POPPY, { language: "pt-PT" });
  joinInto(repo, natal, series, "jev");
  joinInto(repo, colouring, series, "manual");
  const alix = edition(repo, "9782203000002", "Alix Senator", "Valérie Mangin", { workKey: "OL974W" });
  joinInto(repo, edition(repo, "9789720000742", "Alix Senator, Vol. 3 – A Cidade", "Valérie Mangin", { language: "pt-PT" }), alix, "jev");
  const listed = listSeriesCollapses(repo);
  assert.deepEqual(listed.map((target) => target.intoWork), [series.work_id]);
  assert.deepEqual(listed[0]!.joined.slice(3).map((joined) => [joined.fromWork, joined.source, joined.why]), [[natal.work_id, "jev", "series-like"], [colouring.work_id, "manual", null]]);
  assert.deepEqual(listed[0]!.editions.map((own) => own.title), ["Princess Poppy"]);
});

test("a target merged on since still shows the joined editions", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  for (const volume of volumes) joinInto(repo, volume, series);
  const poppys = edition(repo, "9781408300002", "Princess Poppy Collection", POPPY, { workKey: "OL975W" });
  joinInto(repo, series, poppys, "jev");
  const [target] = listSeriesCollapses(repo);
  assert.equal(target!.intoWork, series.work_id);
  assert.equal(target!.title, "Princess Poppy Collection");
  assert.deepEqual(target!.joined.map((joined) => joined.editions.map((own) => own.title)), volumes.map((volume) => [volume.title]));
});

test("listing leaves the merges, the books and the works as they were", () => {
  const { db, repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  for (const volume of volumes) joinInto(repo, volume, series);
  const snapshot = () => ({
    merges: db.prepare("SELECT * FROM work_merges ORDER BY id").all(),
    books: db.prepare("SELECT id, work_id FROM books ORDER BY id").all(),
    works: db.prepare("SELECT id, merged_into FROM works ORDER BY id").all(),
    judgments: db.prepare("SELECT * FROM work_match_judgments ORDER BY work_id").all()
  });
  const before = snapshot();
  assert.equal(listSeriesCollapses(repo).length, 1);
  assert.deepEqual(snapshot(), before);
});

test("undoing two of three volumes restores exactly those two with a code answer of none", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  for (const volume of volumes) joinInto(repo, volume, series);
  const [first, second, third] = volumes as [Edition, Edition, Edition];
  assert.deepEqual(undoReviewedMerges(repo, [first.work_id!, third.work_id!], () => NOW), { undone: 2, failures: [] });
  for (const volume of [first, third]) {
    assert.equal(repo.getBook(volume.id)!.work_id, volume.work_id);
    assert.deepEqual(repo.workMatchJudgments([volume.work_id!]).get(volume.work_id!), none);
  }
  assert.equal(repo.getBook(second.id)!.work_id, series.work_id);
  assert.equal(repo.workMatchJudgments([second.work_id!]).size, 0);
});

test("a jev join is undone too and a manual join is left alone", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  const [coded, judged, manual] = volumes as [Edition, Edition, Edition];
  joinInto(repo, coded, series);
  joinInto(repo, judged, series, "jev");
  joinInto(repo, manual, series, "manual");
  assert.deepEqual(undoReviewedMerges(repo, volumes.map((volume) => volume.work_id!), () => NOW), { undone: 2, failures: [] });
  assert.equal(repo.getBook(coded.id)!.work_id, coded.work_id);
  assert.equal(repo.getBook(judged.id)!.work_id, judged.work_id);
  assert.equal(repo.getBook(manual.id)!.work_id, series.work_id);
  assert.equal(repo.workMatchJudgments([manual.work_id!]).size, 0);
});

test("a chain X to A to T given as X and A undoes the newest join first", () => {
  const { repo } = freshRepo();
  const { target, middle, first } = chain(repo);
  assert.deepEqual(undoReviewedMerges(repo, [first.work_id!, middle.work_id!], () => NOW), { undone: 2, failures: [] });
  assert.equal(repo.getBook(first.id)!.work_id, first.work_id);
  assert.equal(repo.getBook(middle.id)!.work_id, middle.work_id);
  assert.equal(repo.getBook(target.id)!.work_id, target.work_id);
});

test("a join that can no longer be undone lands in failures and writes nothing", () => {
  const { repo } = freshRepo();
  const { target, first } = chain(repo);
  assert.deepEqual(undoReviewedMerges(repo, [first.work_id!], () => NOW), { undone: 0, failures: [{ fromWork: first.work_id!, reason: "That merge can no longer be undone." }] });
  assert.equal(repo.getBook(first.id)!.work_id, target.work_id);
  assert.equal(repo.workMatchJudgments([first.work_id!]).size, 0);
});

test("an error other than a failed undo propagates", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  joinInto(repo, volumes[0]!, series);
  const broken = { ...repo, undoMerge: () => { throw new Error("disk full"); } };
  assert.throws(() => undoReviewedMerges(broken, [volumes[0]!.work_id!], () => NOW), /disk full/);
});
