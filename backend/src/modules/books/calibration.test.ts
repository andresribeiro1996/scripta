import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "calibration-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { answerEach, scoreSynopses, scoreTranslations, synopsisSample, translationSample } = await import("./calibration.js");
const { SourceUnavailableError, UnusableAnswerError } = await import("./domain/errors.js");

type Repo = ReturnType<typeof createSqliteBooksRepository>;

function freshRepo(): Repo {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function seed(repo: Repo, isbn: string, summary: string, source: "publisher" | "isbndb") {
  const book = repo.createBook({ title: `Book ${isbn}`, author: "Author", isbn }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
  repo.mergeDetails(book.id, { summary, pages: null, year: null, publisher: null, translator: null }, source);
  return repo.getBook(book.id)!;
}

test("the sample is spread across summary sources, with the texts the rule would hide as their own stratum, before any judgment exists", () => {
  const repo = freshRepo();
  for (let n = 0; n < 6; n++) seed(repo, `97897200008${n}0`, `A publisher synopsis number ${n}, long enough to read.`, "publisher");
  for (let n = 0; n < 6; n++) seed(repo, `97897200009${n}0`, `An ISBNdb description number ${n}, long enough to read.`, "isbndb");
  seed(repo, "9789720000999", "Text: Portugese", "isbndb");
  const sample = synopsisSample(repo, 6, () => 0.5);
  const count = (stratum: string) => sample.filter((item) => item.stratum === stratum).length;
  assert.deepEqual([count("publisher"), count("isbndb"), count("rule")], [2, 2, 1]);
  assert.equal(sample.find((item) => item.stratum === "rule")?.text, "Text: Portugese");
  assert.equal(new Set(sample.map((item) => item.hash)).size, sample.length);
});

test("the sample never carries a stored judgment, so the labellers stay blind", () => {
  const repo = freshRepo();
  const book = seed(repo, "9789720000998", "A publisher synopsis that Jev has already judged, long enough.", "publisher");
  repo.saveSynopsisJudgment(book.summary_hash!, { model: "jev-1.13.0", usable: 0.12, kind: "praise", askedAt: "2026-10-15T00:00:00.000Z" });
  const [item] = synopsisSample(repo, 10, () => 0.5);
  assert.deepEqual(Object.keys(item!).sort(), ["author", "hash", "stratum", "text", "title"]);
});

test("the score counts labelled not-usable texts per decision band", () => {
  const sample = ["r", "a", "b", "c", "d"].map((hash) => ({ hash, stratum: hash === "r" ? "rule" : "publisher", title: "T", author: "A", text: "x" }));
  const labels = [{ hash: "r", usable: false, kind: "fragment" }, { hash: "a", usable: false, kind: "praise" }, { hash: "b", usable: true, kind: "synopsis" }, { hash: "c", usable: false, kind: "author_bio" }, { hash: "d", usable: true, kind: "synopsis" }];
  const answers = [{ hash: "a", usable: 0.1, kind: "praise" }, { hash: "b", usable: 0.2, kind: "synopsis" }, { hash: "c", usable: 0.4, kind: "author_bio" }, { hash: "d", usable: 0.9, kind: "synopsis" }];
  assert.deepEqual(scoreSynopses(sample, labels, answers), [
    { decision: "rule", items: 1, notUsable: 1 },
    { decision: "jev below 0.15", items: 1, notUsable: 1 },
    { decision: "jev 0.15 to 0.5", items: 2, notUsable: 1 },
    { decision: "jev 0.5 and above", items: 1, notUsable: 0 }
  ]);
});

test("a text Jev can't answer is left out of the score instead of ending the run, and an outage still ends it", async () => {
  const ask = async (n: number) => {
    if (n === 2) throw new UnusableAnswerError("typesafe", "unexpected answer");
    if (n === 3) throw new SourceUnavailableError("typesafe", "HTTP 422", { status: 422 });
    return n * 10;
  };
  const { answers, skipped } = await answerEach([1, 2, 3, 4], ask);
  assert.deepEqual([...answers].sort((a, b) => a - b), [10, 40]);
  assert.equal(skipped, 2);
  await assert.rejects(answerEach([1], async () => { throw new SourceUnavailableError("typesafe", "HTTP 503", { status: 503 }); }), SourceUnavailableError);
});

test("the translation sample mixes code matches and Jev questions, each with its candidates", () => {
  const repo = freshRepo();
  const add = (isbn: string, title: string, author: string, extra: { workKey?: string; language?: string; originalTitle?: string } = {}) => {
    const row = repo.createBook({ title, author, isbn, workKey: extra.workKey }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
    if (extra.language) repo.setLanguage(row.id, extra.language);
    if (extra.originalTitle) repo.fillOriginalTitle(row.id, extra.originalTitle);
    return repo.getBook(row.id)!;
  };
  const en = add("9780156907601", "To the Lighthouse", "Virginia Woolf", { workKey: "OL980W" });
  add("9780000000602", "The Idiot", "Fyodor Dostoevsky", { workKey: "OL981W" });
  const code = add("9789720000601", "Passeio ao Farol", "Virginia Woolf", { language: "pt-PT", originalTitle: "To the Lighthouse" });
  add("9789720000602", "O Idiota", "Fyodor Dostoevsky", { language: "pt-PT" });
  add("9789720000603", "Sem Autor", "", { language: "pt-PT" });
  const sample = translationSample(repo, 4, () => 0.5);
  assert.deepEqual(sample.map((item) => item.stratum).sort(), ["ask", "code"]);
  assert.equal(sample.find((item) => item.stratum === "code")?.codePick, en.work_id);
  assert.equal(sample.find((item) => item.stratum === "code")?.workId, code.work_id);
  assert.equal(sample.find((item) => item.stratum === "ask")?.candidates[0]?.title, "The Idiot");
  assert.equal(repo.workMatchJudgments(sample.map((item) => item.workId)).size, 0);
});

test("the translation sample never offers a work whose original is a series name as a code match", () => {
  const repo = freshRepo();
  const add = (isbn: string, title: string, author: string, extra: { workKey?: string; language?: string; originalTitle?: string } = {}) => {
    const row = repo.createBook({ title, author, isbn, workKey: extra.workKey }, [`isbn:${isbn}`], "2026-10-01T00:00:00.000Z");
    if (extra.language) repo.setLanguage(row.id, extra.language);
    if (extra.originalTitle) repo.fillOriginalTitle(row.id, extra.originalTitle);
    return repo.getBook(row.id)!;
  };
  add("9781408300001", "Princess Poppy", "Janey Louise Jones", { workKey: "OL986W" });
  for (const [n, title] of ["A Princesa Poppy e o Piquenique", "A Princesa Poppy e a Festa", "Poppy no Baile"].entries()) add(`978972000062${n}`, title, "Janey Louise Jones", { language: "pt-PT", originalTitle: "Princess Poppy" });
  assert.deepEqual(translationSample(repo, 4, () => 0.5), []);
});

test("the translation score counts right picks per decision band", () => {
  const item = (workId: string, stratum: "code" | "ask", codePick: string | null) => ({ workId, stratum, edition: { title: "T", author: "A", originalTitle: null, publisher: null, description: null }, candidates: [{ id: "x", title: "X", author: "A", year: null }], codePick });
  const sample = [item("c", "code", "x"), item("h", "ask", null), item("m", "ask", null), item("l", "ask", null)];
  const labels = [{ workId: "c", match: "x" }, { workId: "h", match: "x" }, { workId: "m", match: null }, { workId: "l", match: null }];
  const answers = [{ workId: "h", pick: "x", confidence: 0.95 }, { workId: "m", pick: "x", confidence: 0.7 }, { workId: "l", pick: null, confidence: 0.3 }];
  assert.deepEqual(scoreTranslations(sample, labels, answers), [
    { decision: "code", items: 1, correct: 1 },
    { decision: "jev 0.9 and above", items: 1, correct: 1 },
    { decision: "jev 0.5 to 0.9", items: 1, correct: 0 },
    { decision: "jev below 0.5", items: 1, correct: 1 }
  ]);
});

test("a code match in the translation sample carries the evidence code decided on, original titles read from summaries included", () => {
  const repo = freshRepo();
  repo.createBook({ title: "To the Lighthouse", author: "Virginia Woolf", isbn: "9780156907611", workKey: "OL985W" }, ["isbn:9780156907611"], "2026-10-01T00:00:00.000Z");
  const pt = repo.createBook({ title: "Passeio ao Farol", author: "Virginia Woolf", isbn: "9789720000611" }, ["isbn:9789720000611"], "2026-10-01T00:00:00.000Z");
  repo.setLanguage(pt.id, "pt-PT");
  repo.mergeDetails(pt.id, { summary: "Uma família numa casa de férias.\n\nTítulo original: To the Lighthouse", pages: null, year: null, publisher: null, translator: null }, "publisher");
  const [item] = translationSample(repo, 2, () => 0.5);
  assert.equal(item?.stratum, "code");
  assert.equal(item?.edition.originalTitle, "To the Lighthouse");
});
