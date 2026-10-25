import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { PrizeKey } from "@scripta/shared";
import type { Binding } from "../adapters/wikidata/sparql.js";
import type { BooksRepository, CatalogSearchHit } from "../domain/ports.js";
import type { AwardWork } from "./awardBooksImport.js";

const scratch = mkdtempSync(join(tmpdir(), "award-books-import-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { PRIZE_ITEMS } = await import("../domain/awards.js");
const { SourceUnavailableError } = await import("../domain/errors.js");
const { saveCatalogHits } = await import("../saveHits.js");
const { awardWorksOf, importAwardBooks, missingAwardWorks, resolveAwardWork } = await import("./awardBooksImport.js");

const AT = "2026-10-25T12:00:00.000Z";
const EARLIER = "2026-01-01T00:00:00.000Z";
const LIVE = { dryRun: false, max: null };

type Query = { isbn: string } | { text: string };

const binding = (fields: Record<string, string>): Binding => Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, { value }]));
const item = (id: string) => `http://www.wikidata.org/entity/${id}`;
const entry = (workId: string, prize: PrizeKey, fields: Record<string, string> = {}): Binding =>
  binding({ work: item(workId), prize: item(PRIZE_ITEMS[prize]), won: "true", year: "2020", ...fields });
const work = (itemId: string, prizes: PrizeKey[], ids: { isbns?: string[]; olWorkIds?: string[] } = {}): AwardWork => ({
  item: itemId,
  prizes,
  isbns: ids.isbns ?? [],
  olWorkIds: ids.olWorkIds ?? []
});
const hit = (title: string, authors: string[], workKey: string | null, isbn: string | null = null): CatalogSearchHit => ({
  result: { title, authors, year: null, isbn, publisher: null, coverUrl: null, genres: [] },
  olCoverId: null,
  workKey: workKey && `/works/${workKey}`,
  source: "openlibrary"
});

function searching(answer: (query: Query) => CatalogSearchHit[]) {
  const asked: Query[] = [];
  return {
    asked,
    search: async (query: Query) => {
      asked.push(query);
      return answer(query);
    }
  };
}

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const sleeps: number[] = [];
  const logs: string[] = [];
  const deps = {
    repo,
    sharesArena: () => false,
    log: (line: string) => logs.push(line),
    sleep: async (ms: number) => {
      sleeps.push(ms);
    }
  };
  return { db, repo, deps, sleeps, logs };
}

const untouchable = new Proxy(
  {},
  {
    get(_target, name) {
      throw new Error(`repository.${String(name)} was touched`);
    }
  }
) as BooksRepository;

const bookCount = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n;
const bookIds = (db: DatabaseSync) => (db.prepare("SELECT id FROM books ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);

function plainBook(repo: BooksRepository, isbn: string | null, title: string, author: string, workKey?: string) {
  return repo.createBook({ title, author, isbn, workKey }, isbn ? [`isbn:${isbn}`] : [`ta:${title.toLowerCase()}|${author.toLowerCase()}|`], EARLIER);
}

test("awardWorksOf groups a work's bindings across identifier kinds and prizes", () => {
  const works = awardWorksOf([
    { kind: "on-work/openlibrary", bindings: [entry("Q1", "booker", { olIds: "OL1W" })] },
    { kind: "on-prize/isbn", bindings: [entry("Q1", "hugo-novel", { isbns: "0441013597|9780441013593" }), entry("Q2", "leya", { isbns: "9780000000002" })] },
    { kind: "on-author/edition-isbn", bindings: [entry("Q1", "booker", { year: "2021", isbns: "9780000000019" })] },
    { kind: "on-work/openlibrary", bindings: [entry("Q1", "nebula-novel", { olIds: "OL1W|OL2W" })] }
  ]);
  assert.deepEqual(works, [
    { item: "Q1", prizes: ["booker", "hugo-novel", "nebula-novel"], isbns: ["9780441013593", "9780000000019"], olWorkIds: ["OL1W", "OL2W"] },
    { item: "Q2", prizes: ["leya"], isbns: ["9780000000002"], olWorkIds: [] }
  ]);
});

test("awardWorksOf drops author prizes, unlisted items and undated statements", () => {
  const undated = binding({ work: item("Q3"), prize: item(PRIZE_ITEMS.booker), won: "true", olIds: "OL3W" });
  const works = awardWorksOf([
    {
      kind: "on-work/openlibrary",
      bindings: [
        entry("Q1", "nobel-literature", { olIds: "OL1W" }),
        entry("Q1", "camoes", { olIds: "OL1W" }),
        binding({ work: item("Q4"), prize: item("Q999"), won: "true", year: "2020", olIds: "OL4W" }),
        undated,
        entry("Q2", "saramago", { olIds: "OL2W" })
      ]
    }
  ]);
  assert.deepEqual(works, [{ item: "Q2", prizes: ["saramago"], isbns: [], olWorkIds: ["OL2W"] }]);
});

test("awardWorksOf puts a work's own ISBNs before its editions' ISBNs", () => {
  const works = awardWorksOf([
    { kind: "on-work/edition-isbn", bindings: [entry("Q1", "booker", { isbns: "9780000000019" })] },
    { kind: "on-work/isbn", bindings: [entry("Q1", "booker", { isbns: "9780000000002" })] }
  ]);
  assert.deepEqual(works[0]?.isbns, ["9780000000002", "9780000000019"]);
});

test("missingAwardWorks keeps only works the catalog has by neither ISBN nor Open Library ID", () => {
  const { repo } = setup();
  plainBook(repo, "9780441013593", "Dune", "Frank Herbert");
  plainBook(repo, null, "Wolf Hall", "Hilary Mantel", "OL2W");
  const byIsbn = work("Q1", ["hugo-novel"], { isbns: ["9780000000002", "9780441013593"] });
  const byOpenLibrary = work("Q2", ["booker"], { isbns: ["9780000000019"], olWorkIds: ["OL9W", "OL2W"] });
  const neither = work("Q3", ["leya"], { isbns: ["9780000000026"], olWorkIds: ["OL3W"] });
  const noIds = work("Q4", ["saramago"]);
  assert.deepEqual(missingAwardWorks(repo, [byIsbn, byOpenLibrary, neither, noIds]), [neither, noIds]);
});

test("resolveAwardWork takes the Open Library hit whose work key matches and rejects another work", async () => {
  const other = hit("Wolf Hall", ["Hilary Mantel"], "OL9W", "9781111111111");
  const wanted = hit("Wolf Hall", ["Hilary Mantel"], "OL2W", "9782222222222");
  const found = searching(() => [other, wanted]);
  const resolved = await resolveAwardWork(found.search, work("Q1", ["booker"], { olWorkIds: ["OL2W"] }));
  assert.deepEqual(found.asked, [{ text: "key:/works/OL2W" }]);
  assert.deepEqual(resolved, { ...wanted, result: { ...wanted.result, isbn: null } });

  const wrong = searching(() => [other]);
  assert.equal(await resolveAwardWork(wrong.search, work("Q1", ["booker"], { olWorkIds: ["OL2W"] })), null);
});

test("resolveAwardWork falls back to the ISBNs and saves the searched ISBN", async () => {
  const found = searching((query) => ("isbn" in query && query.isbn === "9780000000019" ? [hit("Wolf Hall", ["Hilary Mantel"], "OL2W", "9782222222222")] : []));
  const resolved = await resolveAwardWork(found.search, work("Q1", ["booker"], { olWorkIds: ["OL2W"], isbns: ["9780000000002", "9780000000019"] }));
  assert.deepEqual(found.asked, [{ text: "key:/works/OL2W" }, { isbn: "9780000000002" }, { isbn: "9780000000019" }]);
  assert.equal(resolved?.result.isbn, "9780000000019");
  assert.equal(resolved?.workKey, "/works/OL2W");
});

test("resolveAwardWork skips a hit with no title, no author, a punctuation-only title or a blank first author, and returns null when nothing fits", async () => {
  const good = hit("Wolf Hall", ["Hilary Mantel"], "OL2W");
  const found = searching(() => [hit("", ["Hilary Mantel"], "OL2W"), hit("Wolf Hall", [], "OL2W"), hit("!!!", ["Hilary Mantel"], "OL2W"), hit("Wolf Hall", ["", "Hilary Mantel"], "OL2W"), good]);
  const resolved = await resolveAwardWork(found.search, work("Q1", ["booker"], { olWorkIds: ["OL2W"] }));
  assert.equal(resolved?.result.title, "Wolf Hall");
  assert.deepEqual(resolved?.result.authors, ["Hilary Mantel"]);

  const unusable = searching(() => [
    hit("", ["Hilary Mantel"], "OL2W", "9782222222222"),
    hit("Wolf Hall", [], "OL2W", "9782222222222"),
    hit("!!!", ["Hilary Mantel"], "OL2W", "9782222222222"),
    hit("Wolf Hall", ["", "Hilary Mantel"], "OL2W", "9782222222222")
  ]);
  assert.equal(await resolveAwardWork(unusable.search, work("Q1", ["booker"], { olWorkIds: ["OL2W"], isbns: ["9780000000002"] })), null);
  assert.equal(await resolveAwardWork(unusable.search, work("Q2", ["booker"])), null);
});

test("resolveAwardWork saves a work-ID hit without an ISBN", async () => {
  const { db, repo, deps } = setup();
  const resolved = await resolveAwardWork(searching(() => [hit("Wolf Hall", ["Hilary Mantel"], "OL2W", "9782222222222")]).search, work("Q1", ["booker"], { olWorkIds: ["OL2W"] }));
  assert.ok(resolved);
  const [saved] = saveCatalogHits(deps, [resolved], AT);
  assert.equal(bookCount(db), 1);
  assert.equal(saved?.isbn, null);
  assert.equal(saved?.ol_work_key, "OL2W");
  assert.equal(saved?.title_key, "ta:wolf hall|hilary mantel|");
  assert.equal(repo.findBookByKey("isbn:9782222222222"), undefined);
});

test("importAwardBooks creates the resolved books, counts each under every prize it is listed for, and lists the unresolved", async () => {
  const { db, deps, logs } = setup();
  const found = searching((query) => {
    if ("text" in query && query.text === "key:/works/OL1W") return [hit("Wolf Hall", ["Hilary Mantel"], "OL1W", "9782222222222")];
    if ("isbn" in query && query.isbn === "9780000000019") return [hit("Dune", ["Frank Herbert"], "OL3W", "9783333333333")];
    return [];
  });
  const report = await importAwardBooks(
    { ...deps, search: found.search },
    [
      work("Q1", ["booker", "hugo-novel"], { olWorkIds: ["OL1W"] }),
      work("Q2", ["booker"], { isbns: ["9780000000019"] }),
      work("Q3", ["leya"], { isbns: ["9780000000026"], olWorkIds: ["OL4W"] })
    ],
    AT,
    LIVE
  );
  const ids = bookIds(db);
  assert.equal(ids.length, 2);
  assert.deepEqual([...report.createdBookIds].sort(), ids);
  assert.deepEqual(report.prizes, {
    booker: { candidates: 2, resolved: 2, created: 2, unresolved: 0 },
    "international-booker": { candidates: 0, resolved: 0, created: 0, unresolved: 0 },
    "hugo-novel": { candidates: 1, resolved: 1, created: 1, unresolved: 0 },
    "nebula-novel": { candidates: 0, resolved: 0, created: 0, unresolved: 0 },
    "pulitzer-fiction": { candidates: 0, resolved: 0, created: 0, unresolved: 0 },
    leya: { candidates: 1, resolved: 0, created: 0, unresolved: 1 },
    saramago: { candidates: 0, resolved: 0, created: 0, unresolved: 0 },
    "ape-novel": { candidates: 0, resolved: 0, created: 0, unresolved: 0 }
  });
  assert.equal(report.at, AT);
  assert.equal(report.requests, 4);
  assert.equal(found.asked.length, 4);
  assert.deepEqual(report.unresolved, ["Q3"]);
  assert.deepEqual(report.failedKeys, []);
  assert.deepEqual(logs, []);
});

test("importAwardBooks logs resolved, unresolved and failed every 100 works", async () => {
  const { deps, logs } = setup();
  const works = Array.from({ length: 205 }, (_, index) => work(`Q${index}`, ["booker"], { olWorkIds: [`OL${index}W`] }));
  const found = searching((query) => {
    if ("text" in query && query.text === "key:/works/OL3W") return [hit("Wolf Hall", ["Hilary Mantel"], "OL3W")];
    if ("text" in query && query.text === "key:/works/OL150W") throw new SourceUnavailableError("openlibrary", "boom", { status: 503 });
    return [];
  });
  await importAwardBooks({ ...deps, search: found.search }, works, AT, { dryRun: true, max: null });
  assert.deepEqual(logs.map((line) => JSON.parse(line)), [
    { resolved: 1, unresolved: 99, failed: 0 },
    { resolved: 1, unresolved: 198, failed: 1 }
  ]);
});

test("two works resolving to one Open Library work create one book", async () => {
  const { db, deps } = setup();
  const found = searching((query) =>
    "text" in query || query.isbn === "9780000000019" ? [hit("Wolf Hall", ["Hilary Mantel"], "OL2W", "9782222222222")] : []
  );
  const report = await importAwardBooks(
    { ...deps, search: found.search },
    [work("Q1", ["booker"], { olWorkIds: ["OL2W"] }), work("Q2", ["hugo-novel"], { isbns: ["9780000000019"] })],
    AT,
    LIVE
  );
  assert.equal(bookCount(db), 1);
  assert.equal(report.createdBookIds.length, 1);
  assert.equal(report.prizes.booker?.created, 1);
  assert.equal(report.prizes["hugo-novel"]?.created, 1);
  assert.equal(report.prizes.booker?.resolved, 1);
});

test("a work-ID hit whose title and author the catalog already has is found, not created", async () => {
  const { db, repo, deps } = setup();
  const existing = plainBook(repo, null, "Wolf Hall", "Hilary Mantel");
  const found = searching(() => [hit("Wolf Hall", ["Hilary Mantel"], "OL2W", "9782222222222")]);
  const report = await importAwardBooks({ ...deps, search: found.search }, [work("Q1", ["booker"], { olWorkIds: ["OL2W"] })], AT, LIVE);
  assert.equal(bookCount(db), 1);
  assert.equal(repo.getBook(existing.id)?.ol_work_key, "OL2W");
  assert.deepEqual(report.createdBookIds, []);
  assert.deepEqual(report.prizes.booker, { candidates: 1, resolved: 1, created: 0, unresolved: 0 });
});

test("a dry run makes the same searches and writes nothing", async () => {
  const works = [
    work("Q1", ["booker"], { olWorkIds: ["OL1W"] }),
    work("Q2", ["hugo-novel"], { isbns: ["9780000000019", "9780000000026"] }),
    work("Q3", ["leya"], { olWorkIds: ["OL4W"] })
  ];
  const answer = (query: Query) => {
    if ("text" in query && query.text === "key:/works/OL1W") return [hit("Wolf Hall", ["Hilary Mantel"], "OL1W")];
    if ("isbn" in query && query.isbn === "9780000000026") return [hit("Dune", ["Frank Herbert"], "OL3W")];
    return [];
  };
  const { deps } = setup();
  const live = searching(answer);
  const liveReport = await importAwardBooks({ ...deps, search: live.search }, works, AT, LIVE);

  const dry = searching(answer);
  const dryReport = await importAwardBooks({ ...deps, repo: untouchable, search: dry.search }, works, AT, { dryRun: true, max: null });
  assert.deepEqual(dry.asked, live.asked);
  assert.equal(dryReport.requests, liveReport.requests);
  assert.deepEqual(dryReport.createdBookIds, []);
  assert.deepEqual(dryReport.unresolved, ["Q3"]);
  assert.deepEqual(dryReport.prizes.booker, { candidates: 1, resolved: 1, created: 0, unresolved: 0 });
  assert.deepEqual(dryReport.prizes["hugo-novel"], { candidates: 1, resolved: 1, created: 0, unresolved: 0 });
  assert.equal(liveReport.createdBookIds.length, 2);
});

test("max stops saving after that many works", async () => {
  const { db, deps } = setup();
  const found = searching((query) => ("text" in query ? [hit(`Title ${query.text.slice(-3, -1)}`, ["Some Author"], query.text.slice(11))] : []));
  const report = await importAwardBooks(
    { ...deps, search: found.search },
    [work("Q1", ["booker"], { olWorkIds: ["OL1W"] }), work("Q2", ["booker"], { olWorkIds: ["OL2W"] }), work("Q3", ["leya"], { olWorkIds: ["OL3W"] })],
    AT,
    { dryRun: false, max: 2 }
  );
  assert.equal(bookCount(db), 2);
  assert.equal(report.requests, 3);
  assert.equal(report.createdBookIds.length, 2);
  assert.deepEqual(report.prizes.booker, { candidates: 2, resolved: 2, created: 2, unresolved: 0 });
  assert.deepEqual(report.prizes.leya, { candidates: 1, resolved: 1, created: 0, unresolved: 0 });
});

test("an Open Library 429 ends the run before any write; another source failure goes to failedKeys", async () => {
  const { db, deps } = setup();
  const ok = (id: string) => hit(`Title ${id.toLowerCase()}`, ["Some Author"], id);
  const limited = searching((query) => {
    if ("text" in query && query.text === "key:/works/OL2W") throw new SourceUnavailableError("openlibrary", "rate limited", { status: 429 });
    return [ok("OL1W")];
  });
  await assert.rejects(
    importAwardBooks({ ...deps, search: limited.search }, [work("Q1", ["booker"], { olWorkIds: ["OL1W"] }), work("Q2", ["booker"], { olWorkIds: ["OL2W"] })], AT, LIVE),
    (error) => error instanceof SourceUnavailableError && error.status === 429
  );
  assert.equal(bookCount(db), 0);

  const flaky = searching((query) => {
    if ("text" in query && query.text === "key:/works/OL1W") throw new SourceUnavailableError("openlibrary", "bad gateway", { status: 502 });
    return [ok("OL2W")];
  });
  const report = await importAwardBooks({ ...deps, search: flaky.search }, [work("Q1", ["booker"], { olWorkIds: ["OL1W"] }), work("Q2", ["booker"], { olWorkIds: ["OL2W"] })], AT, LIVE);
  assert.deepEqual(report.failedKeys, ["Q1"]);
  assert.deepEqual(report.unresolved, []);
  assert.equal(bookCount(db), 1);
  assert.deepEqual(report.prizes.booker, { candidates: 2, resolved: 1, created: 1, unresolved: 0 });
});

test("an error that is not a source failure propagates", async () => {
  const { deps } = setup();
  const broken = searching(() => {
    throw new TypeError("unexpected");
  });
  await assert.rejects(importAwardBooks({ ...deps, search: broken.search }, [work("Q1", ["booker"], { olWorkIds: ["OL1W"] })], AT, LIVE), TypeError);
});

test("importAwardBooks saves in chunks of 25 with a 250 ms pause between them", async () => {
  const { db, deps, sleeps } = setup();
  const found = searching((query) => ("text" in query ? [hit(`Title ${query.text.slice(11, -1)}`, ["Some Author"], query.text.slice(11))] : []));
  const works = (count: number) => Array.from({ length: count }, (_, index) => work(`Q${index}`, ["booker"], { olWorkIds: [`OL${index + 1}W`] }));
  await importAwardBooks({ ...deps, search: found.search }, works(25), AT, LIVE);
  assert.deepEqual(sleeps, []);
  assert.equal(bookCount(db), 25);

  const second = setup();
  await importAwardBooks({ ...second.deps, search: found.search }, works(51), AT, LIVE);
  assert.deepEqual(second.sleeps, [250, 250]);
  assert.equal(bookCount(second.db), 51);
});
