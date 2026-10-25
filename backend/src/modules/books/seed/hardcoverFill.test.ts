import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { HardcoverBook, HardcoverEdition, HardcoverLookup } from "../adapters/hardcover/hardcover.js";
import type { BooksRepository } from "../domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "hardcover-fill-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError } = await import("../domain/errors.js");
const { seriesNameKey } = await import("../domain/series.js");
const { editionLanguageOf, fillFromHardcover } = await import("./hardcoverFill.js");

const AT = "2026-10-25T12:00:00.000Z";
const ENGLISH = "The wizard travelled across the old kingdom with his friends and they wanted to find the lost sword that was hidden in the mountains for a very long time.";
const PORTUGUESE = "O mago viajou através do velho reino com os seus amigos e eles queriam encontrar a espada perdida que estava escondida nas montanhas há muito tempo para os que não sabem.";

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

function edition(repo: BooksRepository, isbn: string, title: string, workKey?: string) {
  return repo.createBook({ title, author: "Author", isbn, workKey }, [`isbn:${isbn}-${title}`], AT);
}

const hcBook = (id: number, fields: Partial<HardcoverBook> = {}): HardcoverBook => ({
  id,
  usable: true,
  description: null,
  genreTags: [],
  featured: null,
  series: [],
  ...fields
});
const series = (name: string, position: number | null = 1) => ({ name, position, compilation: false });
const FANTASY = [{ tag: "Fantasy", count: 5 }];

function fake(editions: Record<string, HardcoverBook | HardcoverBook[]>): HardcoverLookup & { asked: string[][] } {
  const asked: string[][] = [];
  const lookup = async (isbns: string[]): Promise<HardcoverEdition[]> => {
    asked.push(isbns);
    return isbns.flatMap((isbn) => [editions[isbn] ?? []].flat().map((book) => ({ isbn13: isbn, book })));
  };
  return Object.assign(lookup, { asked });
}

const options = (extra: Partial<Parameters<typeof fillFromHardcover>[1]> = {}) => ({ dryRun: false, skipNameKeys: new Set<string>(), after: 0, maxRequests: null, ...extra });
const run = (repo: BooksRepository, lookup: HardcoverLookup, extra: Partial<Parameters<typeof fillFromHardcover>[1]> = {}) =>
  fillFromHardcover({ repo, lookup, now: () => new Date(AT), log: () => {} }, options(extra));

const seriesOf = (db: DatabaseSync, workId: string) => db.prepare("SELECT name, position, source FROM work_series WHERE work_id = ? ORDER BY rowid").all(workId).map((row) => ({ ...row }));
const summaryOf = (db: DatabaseSync, id: string) => ({ ...(db.prepare("SELECT summary, summary_source, summary_hash FROM books WHERE id = ?").get(id) as Record<string, unknown>) });
const genresOf = (db: DatabaseSync, id: string) => (db.prepare("SELECT genres FROM books WHERE id = ?").get(id) as { genres: string }).genres;
const setLanguage = (db: DatabaseSync, id: string, language: string | null) => db.prepare("UPDATE books SET language = ? WHERE id = ?").run(language, id);

test("adds the featured series under hardcover", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { featured: series("Stormlight", 2) }) }));
  assert.deepEqual(seriesOf(db, a.work_id!), [{ name: "Stormlight", position: "2", source: "hardcover" }]);
  assert.equal(report.series.added, 1);
  assert.deepEqual(report.seriesNames, [{ name: "Stormlight", works: 1 }]);
});

test("skips a skip-list series name", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { featured: series("Bad Series") }) }), { skipNameKeys: new Set([seriesNameKey("Bad Series")!]) });
  assert.deepEqual(seriesOf(db, a.work_id!), []);
  assert.deepEqual(report.series, { added: 0, skipped: 1, works: 0 });
});

test("writes a description into an empty summary", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { description: ENGLISH }) }));
  const stored = summaryOf(db, a.id);
  assert.equal(stored.summary, ENGLISH);
  assert.equal(stored.summary_source, "hardcover");
  assert.ok(stored.summary_hash);
  assert.equal(report.descriptions.added, 1);
});

test("keeps an existing summary and fills a duplicate-ISBN sibling", async () => {
  const { db, repo } = setup();
  const a = repo.createBook({ title: "A", author: "Author", isbn: "9780000000001" }, ["k1"], AT);
  const b = repo.createBook({ title: "B", author: "Author", isbn: "9780000000001" }, ["k2"], AT);
  db.prepare("UPDATE books SET summary = 'Existing synopsis', summary_source = 'isbndb' WHERE id = ?").run(a.id);
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { description: ENGLISH }) }));
  assert.equal(summaryOf(db, a.id).summary, "Existing synopsis");
  assert.equal(summaryOf(db, b.id).summary, ENGLISH);
  assert.equal(report.descriptions.alreadyHadSummary, 1);
  assert.equal(report.descriptions.added, 1);
});

test("drops an English description on a Portuguese-ISBN edition with no language", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9789720000000", "A", "OL1W");
  const report = await run(repo, fake({ "9789720000000": hcBook(1, { description: ENGLISH }) }));
  assert.equal(summaryOf(db, a.id).summary, null);
  assert.equal(report.descriptions.descriptionWrongLanguage, 1);
  assert.equal(report.descriptions.added, 0);
});

test("writes a Portuguese description to a Portuguese-ISBN edition", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9789720000000", "A", "OL1W");
  await run(repo, fake({ "9789720000000": hcBook(1, { description: PORTUGUESE }) }));
  assert.equal(summaryOf(db, a.id).summary, PORTUGUESE);
});

test("writes no English description to a French or a 978-3 null-language edition", async () => {
  const { db, repo } = setup();
  const french = edition(repo, "9780000000001", "French", "OL1W");
  setLanguage(db, french.id, "fr");
  const german = edition(repo, "9783000000002", "German", "OL2W");
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { description: ENGLISH }), "9783000000002": hcBook(2, { description: ENGLISH }) }));
  assert.equal(summaryOf(db, french.id).summary, null);
  assert.equal(summaryOf(db, german.id).summary, null);
  assert.equal(report.descriptions.descriptionWrongLanguage, 2);
});

test("leaves an edition whose work shows an Open Library summary", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  db.prepare("UPDATE works SET summary = 'Open Library synopsis' WHERE id = ?").run(a.work_id);
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { description: ENGLISH }) }));
  assert.equal(summaryOf(db, a.id).summary, null);
  assert.equal(report.descriptions.alreadyHadSummary, 1);
  assert.equal(report.descriptions.added, 0);
});

test("re-reads the page after the lookup and leaves an edition whose work gained a summary meanwhile", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A");
  const inner = fake({ "9780000000001": hcBook(1, { description: ENGLISH }) });
  const lookup: HardcoverLookup = async (isbns) => {
    db.prepare("UPDATE works SET summary = 'Open Library synopsis', ol_work_key = 'OL9W' WHERE id = ?").run(a.work_id);
    return inner(isbns);
  };
  const report = await run(repo, lookup);
  assert.equal(summaryOf(db, a.id).summary, null);
  assert.equal(report.descriptions.alreadyHadSummary, 1);
  assert.equal(report.descriptions.added, 0);
});

test("fills genres only on empty editions", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  const b = edition(repo, "9780000000002", "B", "OL1W");
  const c = edition(repo, "9780000000003", "C", "OL1W");
  db.prepare("UPDATE books SET genres = '[\"Fantasy\"]' WHERE id = ?").run(a.id);
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { genreTags: [{ tag: "Mystery", count: 9 }] }), "9780000000002": hcBook(2, { genreTags: [{ tag: "Mystery", count: 9 }] }) }));
  assert.equal(genresOf(db, a.id), '["Fantasy"]');
  assert.equal(genresOf(db, b.id), '["Mystery"]');
  assert.equal(genresOf(db, c.id), '["Mystery"]');
  assert.deepEqual(report.genres, { works: 1, editions: 2, noMappedGenre: 0 });
});

test("genres come from a later sibling when the first maps to nothing", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  const b = edition(repo, "9780000000002", "B", "OL1W");
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { genreTags: [{ tag: "Nonsense", count: 9 }] }), "9780000000002": hcBook(2, { genreTags: FANTASY }) }));
  assert.equal(genresOf(db, a.id), '["Fantasy"]');
  assert.equal(genresOf(db, b.id), '["Fantasy"]');
  assert.equal(report.genres.noMappedGenre, 1);
  assert.equal(report.genres.works, 1);
});

test("takes the series from the first matched edition of a work", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  edition(repo, "9780000000002", "B", "OL1W");
  await run(repo, fake({ "9780000000001": hcBook(1, { featured: series("First") }), "9780000000002": hcBook(2, { featured: series("Second") }) }));
  assert.deepEqual(seriesOf(db, a.work_id!).map((row) => row.name), ["First"]);
});

test("takes the series from a sibling edition when the first matched edition has none", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  edition(repo, "9780000000002", "B", "OL1W");
  edition(repo, "9780000000003", "C", "OL1W");
  const report = await run(repo, fake({ "9780000000001": hcBook(1), "9780000000002": hcBook(2, { featured: series("Second") }), "9780000000003": hcBook(3, { featured: series("Third") }) }));
  assert.deepEqual(seriesOf(db, a.work_id!).map((row) => row.name), ["Second"]);
  assert.equal(report.series.added, 1);
});

test("a resumed run adds no second hardcover series", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  for (let index = 0; index < 49; index += 1) edition(repo, `97800001${String(index).padStart(5, "0")}`, `F${index}`);
  edition(repo, "9780000000002", "B", "OL1W");
  const lookup = fake({ "9780000000001": hcBook(1, { featured: series("First") }), "9780000000002": hcBook(2, { featured: series("Second") }) });
  const first = await run(repo, lookup, { maxRequests: 1 });
  assert.equal(first.stoppedBy, "max-requests");
  const resumed = await run(repo, lookup, { after: first.lastRowid });
  assert.equal(resumed.matched, 1);
  assert.equal(resumed.series.added, 0);
  assert.deepEqual(seriesOf(db, a.work_id!).map((row) => row.name), ["First"]);
});

test("an edition with no work gets only its description", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A");
  db.prepare("UPDATE books SET work_id = NULL WHERE id = ?").run(a.id);
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { description: ENGLISH, featured: series("S"), genreTags: FANTASY }) }));
  assert.equal(summaryOf(db, a.id).summary, ENGLISH);
  assert.equal(report.series.added, 0);
  assert.equal(report.genres.works, 0);
  assert.equal(genresOf(db, a.id), "[]");
});

test("editionLanguageOf", () => {
  assert.equal(editionLanguageOf({ language: "pt-PT", isbn: "9780000000001" }), "pt");
  assert.equal(editionLanguageOf({ language: null, isbn: "9789720000000" }), "pt");
  assert.equal(editionLanguageOf({ language: null, isbn: "9780000000001" }), "en");
  assert.equal(editionLanguageOf({ language: null, isbn: "9783000000002" }), null);
});

test("skips deleted or deduped Hardcover books", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { usable: false, description: ENGLISH, featured: series("S") }) }));
  assert.equal(summaryOf(db, a.id).summary, null);
  assert.deepEqual(seriesOf(db, a.work_id!), []);
  assert.equal(report.skippedBooks, 1);
  assert.equal(report.matched, 0);
});

test("counts a second usable Hardcover edition of an ISBN as a duplicate", async () => {
  const { db, repo } = setup();
  const a = edition(repo, "9780000000001", "A", "OL1W");
  const report = await run(repo, fake({ "9780000000001": [hcBook(1, { featured: series("First") }), hcBook(2, { featured: series("Second") })] }));
  assert.deepEqual(seriesOf(db, a.work_id!).map((row) => row.name), ["First"]);
  assert.equal(report.duplicateIsbns, 1);
});

test("dry run writes nothing and reports the same counts as a real run", async () => {
  const build = () => {
    const { db, repo } = setup();
    edition(repo, "9780000000001", "A", "OL1W");
    edition(repo, "9780000000002", "B", "OL1W");
    edition(repo, "9789720000000", "C", "OL3W");
    const lookup = fake({
      "9780000000001": hcBook(1, { description: ENGLISH, featured: series("Saga"), genreTags: FANTASY }),
      "9780000000002": hcBook(2, { featured: series("Other") }),
      "9789720000000": hcBook(3, { description: ENGLISH })
    });
    return { db, repo, lookup };
  };
  const live = build();
  const dry = build();
  const before = JSON.stringify(dry.db.prepare("SELECT * FROM books ORDER BY rowid").all());
  const dryReport = await run(dry.repo, dry.lookup, { dryRun: true });
  const liveReport = await run(live.repo, live.lookup);
  assert.equal(JSON.stringify(dry.db.prepare("SELECT * FROM books ORDER BY rowid").all()), before);
  assert.equal(dry.db.prepare("SELECT COUNT(*) AS n FROM work_series").get()!.n, 0);
  assert.equal(live.db.prepare("SELECT COUNT(*) AS n FROM work_series").get()!.n, 1);
  const strip = ({ dryRun, genreSamples, ...rest }: typeof dryReport) => rest;
  assert.deepEqual(strip(dryReport), strip(liveReport));
  assert.equal(dryReport.dryRun, true);
  assert.equal(dryReport.genreSamples?.length, 1);
});

test("dry run samples matched books whose genre tags map to no genre", async () => {
  const { repo } = setup();
  edition(repo, "9780000000001", "A", "OL1W");
  edition(repo, "9780000000002", "B", "OL2W");
  edition(repo, "9780000000003", "C", "OL3W");
  const report = await run(repo, fake({ "9780000000001": hcBook(1, { genreTags: [{ tag: "Nonsense", count: 9 }] }), "9780000000002": hcBook(2, { genreTags: FANTASY }), "9780000000003": hcBook(3) }), { dryRun: true });
  assert.deepEqual(report.genreSamples, [
    { tags: ["Nonsense"], genres: [] },
    { tags: ["Fantasy"], genres: ["Fantasy"] }
  ]);
});

test("resumes after a rowid and stops at maxRequests", async () => {
  const { repo } = setup();
  const ids = Array.from({ length: 120 }, (_, index) => edition(repo, `97800000${String(index).padStart(5, "0")}`, `B${index}`));
  const lookup = fake({});
  const first = await run(repo, lookup, { maxRequests: 2 });
  assert.equal(first.stoppedBy, "max-requests");
  assert.equal(first.requests, 2);
  assert.equal(first.editions, 100);
  assert.equal(lookup.asked.length, 2);
  assert.equal(lookup.asked[0]!.length, 50);
  const rest = await run(repo, lookup, { after: first.lastRowid });
  assert.equal(rest.stoppedBy, "done");
  assert.equal(rest.editions, 20);
  assert.ok(ids.length === 120);
});

test("stops on daily quota with lastRowid of the last committed page", async () => {
  const { db, repo } = setup();
  const books = Array.from({ length: 60 }, (_, index) => edition(repo, `97800000${String(index).padStart(5, "0")}`, `B${index}`, `OL${index}W`));
  let calls = 0;
  const lookup: HardcoverLookup = async (isbns) => {
    calls += 1;
    if (calls === 2) throw new SourceUnavailableError("hardcover", "daily limit", { status: 429, quota: true });
    return isbns.map((isbn) => ({ isbn13: isbn, book: hcBook(Number(isbn.slice(-5)), { description: ENGLISH }) }));
  };
  const report = await run(repo, lookup);
  assert.equal(report.stoppedBy, "daily-quota");
  assert.match(report.error!, /daily limit/);
  const lastOfFirst = (db.prepare("SELECT rowid FROM books ORDER BY rowid LIMIT 1 OFFSET 49").get() as { rowid: number }).rowid;
  assert.equal(report.lastRowid, lastOfFirst);
  assert.equal(report.requests, 1);
  assert.equal(report.descriptions.added, 50);
  assert.equal(summaryOf(db, books[49]!.id).summary, ENGLISH);
  assert.equal(summaryOf(db, books[50]!.id).summary, null);
});

test("an error status ends the run as error and other errors propagate", async () => {
  const { repo } = setup();
  edition(repo, "9780000000001", "A", "OL1W");
  const report = await run(repo, async () => {
    throw new SourceUnavailableError("hardcover", "unexpected response", { status: 500 });
  });
  assert.equal(report.stoppedBy, "error");
  await assert.rejects(
    run(repo, async () => {
      throw new TypeError("boom");
    }),
    TypeError
  );
});

test("a page with no match still advances the cursor", async () => {
  const { repo } = setup();
  edition(repo, "9780000000001", "A", "OL1W");
  const report = await run(repo, fake({}));
  assert.equal(report.matched, 0);
  assert.equal(report.editions, 1);
  assert.ok(report.lastRowid > 0);
});

test("drops editions without a usable ISBN and makes no request for a page that has none", async () => {
  const { db, repo } = setup();
  const bad = edition(repo, "9780000000001", "Bad", "OL1W");
  db.prepare("UPDATE books SET isbn = 'n/a' WHERE id = ?").run(bad.id);
  const good = edition(repo, "9780000000002", "Good", "OL2W");
  const lookup = fake({ "9780000000002": hcBook(2, { description: ENGLISH }) });
  const report = await run(repo, lookup);
  assert.deepEqual(lookup.asked, [["9780000000002"]]);
  assert.equal(report.requests, 1);
  assert.equal(report.editions, 2);
  assert.equal(summaryOf(db, good.id).summary, ENGLISH);

  const second = setup();
  for (let index = 0; index < 50; index += 1) {
    const unusable = edition(second.repo, `97800001${String(index).padStart(5, "0")}`, `Bad${index}`);
    second.db.prepare("UPDATE books SET isbn = 'n/a' WHERE id = ?").run(unusable.id);
  }
  const last = edition(second.repo, "9780000000002", "Good", "OL2W");
  const next = fake({});
  const skipped = await run(second.repo, next, { maxRequests: 1 });
  assert.deepEqual(next.asked, [["9780000000002"]]);
  assert.equal(skipped.requests, 1);
  assert.equal(skipped.editions, 51);
  assert.equal(skipped.stoppedBy, "done");
  assert.equal(skipped.lastRowid, (second.db.prepare("SELECT rowid FROM books WHERE id = ?").get(last.id) as { rowid: number }).rowid);
});
