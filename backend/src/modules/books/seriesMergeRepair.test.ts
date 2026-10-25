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
const { listSeriesCollapses, undoReviewedMerges, listGuardedMerges, dropSeriesRows, addSeriesRows } = await import("./seriesMergeRepair.js");
const { groupKeylessWorks } = await import("./duplicateWorks.js");

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

test("a title-key join is undone without a manual answer of none, while a code join undone with it still gets one", () => {
  const { db, repo } = freshRepo();
  const lupin = ["Arsène Lupin: A Agulha Oca", "Arsène Lupin: Gentleman Ladrão"].map((title, n) => edition(repo, `978972000075${n}`, title, "Maurice Leblanc"));
  repo.mergeWorks(lupin[1]!.work_id!, lupin[0]!.work_id!, AT);
  db.prepare("UPDATE work_merges SET source = 'title-key' WHERE from_work = ?").run(lupin[1]!.work_id);
  const [grouped] = repo.activeMerges("title-key");
  const restored = lupin.find((book) => book.work_id === grouped!.fromWork)!;
  const { series, volumes } = poppy(repo);
  joinInto(repo, volumes[0]!, series);

  assert.deepEqual(undoReviewedMerges(repo, [restored.work_id!, volumes[0]!.work_id!], () => NOW, quietly), { undone: [volumes[0]!.work_id, restored.work_id], failures: [] });
  assert.equal(repo.getBook(restored.id)!.work_id, restored.work_id);
  assert.equal(repo.workMatchJudgments([restored.work_id!]).size, 0);
  assert.deepEqual(repo.workMatchJudgments([volumes[0]!.work_id!]).get(volumes[0]!.work_id!), none);
});

test("a jev join is undone too, and a manual join is reported and left alone", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  const [coded, judged, manual] = volumes as [Edition, Edition, Edition];
  joinInto(repo, coded, series);
  joinInto(repo, judged, series, "jev");
  joinInto(repo, manual, series, "manual");
  assert.deepEqual(undoReviewedMerges(repo, volumes.map((volume) => volume.work_id!), () => NOW, quietly), { undone: [], failures: [{ fromWork: manual.work_id, reason: "no active code, jev, ol-duplicate or title-key merge" }] });
  assert.equal(repo.getBook(coded.id)!.work_id, series.work_id);
  assert.equal(repo.getBook(judged.id)!.work_id, series.work_id);
  assert.deepEqual(undoReviewedMerges(repo, [coded.work_id!, judged.work_id!], () => NOW, quietly), { undone: [judged.work_id, coded.work_id], failures: [] });
  assert.equal(repo.getBook(coded.id)!.work_id, coded.work_id);
  assert.equal(repo.getBook(judged.id)!.work_id, judged.work_id);
  assert.equal(repo.getBook(manual.id)!.work_id, series.work_id);
  assert.equal(repo.workMatchJudgments([manual.work_id!]).size, 0);
});

test("a manual join is undone only when named in the explicit manual list", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  const manual = volumes[0]!;
  joinInto(repo, manual, series, "manual");
  const reason = "no active code, jev, ol-duplicate or title-key merge";
  assert.deepEqual(undoReviewedMerges(repo, [manual.work_id!], () => NOW, quietly), { undone: [], failures: [{ fromWork: manual.work_id, reason }] });
  assert.equal(repo.getBook(manual.id)!.work_id, series.work_id);
  assert.deepEqual(undoReviewedMerges(repo, [], () => NOW, quietly, [manual.work_id!]), { undone: [manual.work_id], failures: [] });
  assert.equal(repo.getBook(manual.id)!.work_id, manual.work_id);
  assert.deepEqual(repo.workMatchJudgments([manual.work_id!]).get(manual.work_id!), { model: "manual", intoWorkId: null, confidence: null, askedAt: UNDONE_AT });
});

test("one unknown id fails the whole request: a typo, a manual join and a join already undone undo nothing", () => {
  const { repo } = freshRepo();
  const { series, volumes } = poppy(repo);
  const [coded, manual, gone] = volumes as [Edition, Edition, Edition];
  joinInto(repo, coded, series);
  joinInto(repo, manual, series, "manual");
  joinInto(repo, gone, series);
  repo.undoMerge(gone.work_id!, AT);
  const reason = "no active code, jev, ol-duplicate or title-key merge";
  assert.deepEqual(undoReviewedMerges(repo, [coded.work_id!, manual.work_id!, gone.work_id!, "no-such-work"], () => NOW, quietly), {
    undone: [],
    failures: [{ fromWork: manual.work_id, reason }, { fromWork: gone.work_id, reason }, { fromWork: "no-such-work", reason }]
  });
  assert.equal(repo.getBook(coded.id)!.work_id, series.work_id);
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

const LOTR = "The Lord of the Rings";
const TOLKIEN = "J. R. R. Tolkien";

function tolkien(repo: Repo) {
  const omnibus = edition(repo, "9780261103252", LOTR, TOLKIEN, { workKey: "OL27448W" });
  const king = edition(repo, "9780261102378", "The Return of the King", TOLKIEN, { workKey: "OL27479W" });
  repo.addWorkSeries(omnibus.work_id!, [{ name: LOTR, position: null }], "wikidata", AT);
  repo.addWorkSeries(king.work_id!, [{ name: LOTR, position: "3" }], "wikidata", AT);
  const fellowship = edition(repo, "9789722000001", "A Irmandade do Anel", TOLKIEN, { language: "pt-PT", originalTitle: "The lord of the rings" });
  repo.mergeTranslation(fellowship.work_id!, omnibus.work_id!, "jev", 0.99, AT);
  return { omnibus, king, fellowship };
}

test("listGuardedMerges flags a join the guard would now stop and lists what joined the target later", async () => {
  const { repo } = freshRepo();
  const { omnibus, fellowship } = tolkien(repo);
  const keyless = edition(repo, "9789722000002", "A irmandade do anel", TOLKIEN);
  repo.setLanguage(keyless.id, "pt-PT");
  await groupKeylessWorks(repo, 250, { at: AT });
  const lighthouse = edition(repo, "9780156907392", "To the Lighthouse", "Virginia Woolf", { workKey: "OL468431W" });
  const farol = edition(repo, "9789722000003", "Passeio ao Farol", "Virginia Woolf", { language: "pt-PT", originalTitle: "To the Lighthouse" });
  repo.mergeTranslation(farol.work_id!, lighthouse.work_id!, "code", null, AT);
  const result = listGuardedMerges(repo);
  assert.equal(result.checked, 2);
  assert.equal(result.flagged.length, 1);
  const [flag] = result.flagged;
  assert.equal(flag!.fromWork, fellowship.work_id);
  assert.equal(flag!.intoWork, omnibus.work_id);
  assert.equal(flag!.source, "jev");
  assert.equal(flag!.confidence, 0.99);
  assert.equal(flag!.verdict, "review");
  assert.equal(flag!.intoTitle, LOTR);
  assert.deepEqual(flag!.editions.map((row) => [row.title, row.isbn, row.originalTitle]), [["A Irmandade do Anel", "9789722000001", "The lord of the rings"]]);
  assert.deepEqual(flag!.later.map((row) => [row.source, row.editions.map((item) => item.title)]), [["title-key", ["A irmandade do anel"]]]);
});

test("listGuardedMerges reports nothing when no join is flagged", () => {
  const { repo } = freshRepo();
  assert.deepEqual(listGuardedMerges(repo), { checked: 0, skipped: [], flagged: [] });
});

test("dropSeriesRows removes only the named row", () => {
  const { repo } = freshRepo();
  const { omnibus, king } = tolkien(repo);
  assert.equal(repo.bestSeriesOf([omnibus.work_id!]).get(omnibus.work_id!)?.name, LOTR);
  assert.equal(dropSeriesRows(repo, [{ workId: omnibus.work_id!, name: LOTR, source: "wikidata" }]), 1);
  assert.equal(repo.bestSeriesOf([omnibus.work_id!]).has(omnibus.work_id!), false);
  assert.equal(repo.bestSeriesOf([king.work_id!]).get(king.work_id!)?.name, LOTR);
  assert.equal(dropSeriesRows(repo, [{ workId: omnibus.work_id!, name: LOTR, source: "wikidata" }]), 0);
});

test("addSeriesRows adds a row bestSeriesOf returns with its position", () => {
  const { repo } = freshRepo();
  const { omnibus } = tolkien(repo);
  dropSeriesRows(repo, [{ workId: omnibus.work_id!, name: LOTR, source: "wikidata" }]);
  assert.equal(addSeriesRows(repo, [{ workId: omnibus.work_id!, name: LOTR, position: "1-3", source: "wikidata" }], AT), 1);
  assert.deepEqual(repo.bestSeriesOf([omnibus.work_id!]).get(omnibus.work_id!), { name: LOTR, position: "1-3" });
});

test("listGuardedMerges flags a volume number the target lacks as never", () => {
  const { repo } = freshRepo();
  const hugo = edition(repo, "9780140444308", "Les Misérables", "Victor Hugo", { workKey: "OL1W" });
  const roman = edition(repo, "9789722000010", "Os Miseráveis I", "Victor Hugo", { language: "pt-PT", originalTitle: "Les Misérables" });
  repo.mergeTranslation(roman.work_id!, hugo.work_id!, "jev", 0.97, AT);
  const result = listGuardedMerges(repo);
  assert.equal(result.checked, 1);
  assert.deepEqual(result.flagged.map((row) => [row.fromWork, row.verdict]), [[roman.work_id, "never"]]);
});

test("listGuardedMerges reports a merge it could not evaluate as skipped", () => {
  const { repo } = freshRepo();
  const { fellowship } = tolkien(repo);
  const book = repo.getBook(fellowship.id)!;
  repo.detachEdition(book.id, AT);
  const result = listGuardedMerges(repo);
  assert.equal(result.checked, 0);
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(result.flagged, []);
});
