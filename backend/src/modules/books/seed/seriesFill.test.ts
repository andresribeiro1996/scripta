import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { BooksRepository, EditionRecord } from "../domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "series-fill-test-"));
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
const { fillBnpCollections, fillFromOriginalTitles, fillFromWikidata, fillHeldEditions, listOriginalTitleSeries, seriesCounts, wikidataRowOf, wikidataTally } = await import("./seriesFill.js");

const AT = "2026-10-20T12:00:00.000Z";
const LIVE = { dryRun: false };
const DRY = { dryRun: true };

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

function book(repo: BooksRepository, isbn: string | null, title: string, author = "Author", extra: { workKey?: string; language?: string; original?: string } = {}) {
  const row = repo.createBook({ title, author, isbn, workKey: extra.workKey }, isbn ? [`isbn:${isbn}`] : [`ta:${title.toLowerCase()}|${author.toLowerCase()}|`], AT);
  if (extra.language) repo.setLanguage(row.id, extra.language);
  if (extra.original) repo.fillOriginalTitle(row.id, extra.original);
  return row;
}

const rowsOf = (db: DatabaseSync, table: "work_series" | "book_collections") => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row })) as Array<Record<string, unknown>>;

function countingTransactions(repo: BooksRepository, events: string[] = []) {
  return { ...repo, transaction: <T>(write: () => T): T => { events.push("tx"); return repo.transaction(write); } } as BooksRepository;
}

const noWork = async () => null;

const wikidata = (series: string, position: string | null, ids: { isbns?: string[]; olWorkIds?: string[] }) => ({ isbns: ids.isbns ?? [], olWorkIds: ids.olWorkIds ?? [], series, position });

test("Wikidata rows match a work by any ISBN form or by Open Library ID, and a title alone matches nothing", async () => {
  const { db, repo } = setup();
  const dune = book(repo, "9780441013593", "Dune", "Frank Herbert");
  const emma = book(repo, "9780141439587", "Emma", "Jane Austen", { workKey: "OL66554W" });
  const other = book(repo, "9780575081406", "Gardens of the Moon", "Steven Erikson");
  const report = await fillFromWikidata(repo, noWork, [
    wikidata("Dune Chronicles", "1", { isbns: ["0-441-01359-7"] }),
    wikidata("Highbury", null, { olWorkIds: ["OL66554W"] }),
    wikidata("Malazan Book of the Fallen", "1", { isbns: ["978-0-575-08140-6", "9780000000002"], olWorkIds: ["OL1W"] }),
    wikidata("Title only", "1", {}),
    wikidata("Nobody has these", null, { isbns: ["9780000000002"], olWorkIds: ["OL2W", "OL3M"] })
  ], AT, LIVE);
  assert.deepEqual(report, { matched: 3, added: 3, redirected: 0, failedKeys: [] });
  assert.deepEqual(repo.bestSeriesOf([dune.work_id!, emma.work_id!, other.work_id!]), new Map([
    [dune.work_id!, { name: "Dune Chronicles", position: "1" }],
    [emma.work_id!, { name: "Highbury", position: null }],
    [other.work_id!, { name: "Malazan Book of the Fallen", position: "1" }]
  ]));
  assert.deepEqual(rowsOf(db, "work_series").map((row) => row.source), ["wikidata", "wikidata", "wikidata"]);
  assert.equal(rowsOf(db, "book_collections").length, 0);
});

test("a row naming one work by ISBN and by Open Library ID counts it once, and one naming two works gives both the series", async () => {
  const { db, repo } = setup();
  const first = book(repo, "9780441013593", "Dune", "Frank Herbert", { workKey: "OL893415W" });
  const second = book(repo, "9780575081406", "Gardens of the Moon", "Steven Erikson");
  const report = await fillFromWikidata(repo, noWork, [
    wikidata("Dune Chronicles", "1", { isbns: ["9780441013593"], olWorkIds: ["OL893415W"] }),
    wikidata("Shared", null, { isbns: ["9780441013593", "9780575081406"] })
  ], AT, LIVE);
  assert.deepEqual(report, { matched: 3, added: 3, redirected: 0, failedKeys: [] });
  const namesOf = (workId: string) => (db.prepare("SELECT name FROM work_series WHERE work_id = ? ORDER BY name").all(workId) as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(namesOf(first.work_id!), ["Dune Chronicles", "Shared"]);
  assert.deepEqual(namesOf(second.work_id!), ["Shared"]);
});

test("a Wikidata fill can run again: it adds nothing the second time and fills a position that was missing", async () => {
  const { db, repo } = setup();
  const dune = book(repo, "9780441013593", "Dune", "Frank Herbert");
  await fillFromWikidata(repo, noWork, [wikidata("Dune Chronicles", null, { isbns: ["9780441013593"] })], AT, LIVE);
  const again = await fillFromWikidata(repo, noWork, [wikidata("Dune Chronicles", "1", { isbns: ["9780441013593"] })], AT, LIVE);
  assert.deepEqual(again, { matched: 1, added: 0, redirected: 0, failedKeys: [] });
  assert.equal(rowsOf(db, "work_series").length, 1);
  assert.deepEqual(repo.bestSeriesOf([dune.work_id!]).get(dune.work_id!), { name: "Dune Chronicles", position: "1" });
});

test("a Wikidata dry run counts the matches and writes nothing", async () => {
  const { db, repo } = setup();
  book(repo, "9780441013593", "Dune", "Frank Herbert");
  const events: string[] = [];
  const report = await fillFromWikidata(countingTransactions(repo, events), noWork, [wikidata("Dune Chronicles", "1", { isbns: ["9780441013593"] }), wikidata("Title only", null, {})], AT, DRY);
  assert.deepEqual(report, { matched: 1, added: 0, redirected: 0, failedKeys: [] });
  assert.equal(rowsOf(db, "work_series").length, 0);
  assert.deepEqual(events, []);
});

test("a Wikidata fill counts the works it matched per series across pages, most works first, in a dry run as well", async () => {
  for (const options of [LIVE, DRY]) {
    const { db, repo } = setup();
    book(repo, "9780441013593", "Dune", "Frank Herbert");
    book(repo, "9780141439587", "Emma", "Jane Austen", { workKey: "OL66554W" });
    book(repo, "9780575081406", "Gardens of the Moon", "Steven Erikson");
    const tally = wikidataTally();
    await fillFromWikidata(repo, noWork, [
      wikidata("Dune Chronicles", "1", { isbns: ["9780441013593"] }),
      wikidata("Piccola Biblioteca", null, { isbns: ["9780441013593", "9780575081406"] }),
      wikidata("Title only", null, {})
    ], AT, { ...options, tally });
    await fillFromWikidata(repo, noWork, [
      wikidata("piccola biblioteca", "2", { olWorkIds: ["OL66554W"] }),
      wikidata("Piccola Biblioteca", null, { isbns: ["9780575081406"] }),
      wikidata("Nobody has these", null, { isbns: ["9780000000002"] })
    ], AT, { ...options, tally });
    assert.deepEqual(seriesCounts(tally), [{ name: "Piccola Biblioteca", works: 3 }, { name: "Dune Chronicles", works: 1 }]);
    assert.equal(rowsOf(db, "work_series").length, options.dryRun ? 0 : 4);
  }
});

test("series with equally many works are listed by name, and a fill without a tally still works", async () => {
  const { repo } = setup();
  book(repo, "9780441013593", "Dune", "Frank Herbert");
  const tally = wikidataTally();
  await fillFromWikidata(repo, noWork, [wikidata("Zeta", null, { isbns: ["9780441013593"] }), wikidata("Alpha", null, { isbns: ["9780441013593"] })], AT, { ...DRY, tally });
  assert.deepEqual(seriesCounts(tally), [{ name: "Alpha", works: 1 }, { name: "Zeta", works: 1 }]);
  assert.deepEqual(await fillFromWikidata(repo, noWork, [wikidata("Zeta", null, { isbns: ["9780441013593"] })], AT, DRY), { matched: 1, added: 0, redirected: 0, failedKeys: [] });
});

test("skipped series are neither written nor counted, matched by name key, in a dry run as well", async () => {
  for (const options of [LIVE, DRY]) {
    const { db, repo } = setup();
    book(repo, "9780441013593", "Dune", "Frank Herbert");
    book(repo, "9780575081406", "Gardens of the Moon", "Steven Erikson");
    const skip = new Set(["piccola biblioteca adelphi", "decouvertes gallimard"].map((name) => seriesNameKey(name)!));
    const tally = wikidataTally();
    const report = await fillFromWikidata(repo, noWork, [
      wikidata("Piccola Biblioteca Adelphi", "12", { isbns: ["9780441013593", "9780575081406"] }),
      wikidata("Découvertes Gallimard", null, { isbns: ["9780441013593"] }),
      wikidata("Dune Chronicles", "1", { isbns: ["9780441013593"] }),
      wikidata("Piccola Biblioteca Adelphi", null, { olWorkIds: ["OL1W"] })
    ], AT, { ...options, skip, tally });
    assert.deepEqual(report, { matched: 1, added: options.dryRun ? 0 : 1, redirected: 0, failedKeys: [] });
    assert.deepEqual(seriesCounts(tally), [{ name: "Dune Chronicles", works: 1 }]);
    assert.deepEqual([...tally.skipped].sort(), [...skip].sort());
    assert.deepEqual(rowsOf(db, "work_series").map((row) => row.name), options.dryRun ? [] : ["Dune Chronicles"]);
  }
});

test("a skip name that no row carried is absent from the tally's skipped set", async () => {
  const { repo } = setup();
  book(repo, "9780441013593", "Dune", "Frank Herbert");
  const tally = wikidataTally();
  await fillFromWikidata(repo, noWork, [wikidata("Piccola Biblioteca Adelphi", null, { isbns: ["9780441013593"] })], AT, { ...DRY, skip: new Set([seriesNameKey("Piccola Biblioteca Adelphi")!, seriesNameKey("Piccola Bibliotheca Adelphi")!]), tally });
  assert.deepEqual([...tally.skipped], [seriesNameKey("Piccola Biblioteca Adelphi")]);
});

test("Wikidata writes go in batches of a few hundred rows, with the event loop free between them", async () => {
  const { db, repo } = setup();
  const rows = Array.from({ length: 650 }, (_, index) => {
    book(repo, String(9781000000000 + index), `Book ${index}`, "Author", { workKey: `OL${1000 + index}W` });
    return wikidata("Long Series", String(index + 1), { olWorkIds: [`OL${1000 + index}W`] });
  });
  const events: string[] = [];
  setTimeout(() => events.push("tick"), 20);
  const report = await fillFromWikidata(countingTransactions(repo, events), noWork, rows, AT, LIVE);
  assert.deepEqual(report, { matched: 650, added: 650, redirected: 0, failedKeys: [] });
  assert.equal(rowsOf(db, "work_series").length, 650);
  assert.deepEqual(events, ["tx", "tick", "tx", "tx"]);
});

const redirect = (from: string, to: string) => ({ key: `/works/${from}`, type: { key: "/type/redirect" }, location: `/works/${to}` });

function openLibraryWorks(bodies: Record<string, unknown>) {
  const asked: string[] = [];
  return {
    asked,
    fetchWork: async (key: string) => {
      asked.push(key);
      const body = bodies[key] ?? null;
      if (body instanceof Error) throw body;
      return body;
    }
  };
}

test("an Open Library ID that Open Library merged into another work matches the catalog's work, and the redirect is counted", async () => {
  const { repo } = setup();
  const memories = book(repo, null, "Memories of Ice", "Steven Erikson", { workKey: "OL5734773W" });
  const { asked, fetchWork } = openLibraryWorks({ OL17731722W: redirect("OL17731722W", "OL5734773W") });
  const report = await fillFromWikidata(repo, fetchWork, [wikidata("Malazan Book of the Fallen", "3", { olWorkIds: ["OL17731722W"] })], AT, LIVE);
  assert.deepEqual(report, { matched: 1, added: 1, redirected: 1, failedKeys: [] });
  assert.deepEqual(asked, ["OL17731722W"]);
  assert.deepEqual(repo.bestSeriesOf([memories.work_id!]).get(memories.work_id!), { name: "Malazan Book of the Fallen", position: "3" });
});

test("a redirect is followed for at most two requests: two hops reach the catalog, three do not", async () => {
  const { db, repo } = setup();
  const reached = book(repo, null, "Two hops", "Author", { workKey: "OL3W" });
  book(repo, null, "Three hops", "Author", { workKey: "OL7W" });
  const near = openLibraryWorks({ OL1W: redirect("OL1W", "OL2W"), OL2W: redirect("OL2W", "OL3W") });
  assert.deepEqual(await fillFromWikidata(repo, near.fetchWork, [wikidata("Near", "1", { olWorkIds: ["OL1W"] })], AT, LIVE), { matched: 1, added: 1, redirected: 1, failedKeys: [] });
  assert.deepEqual(near.asked, ["OL1W", "OL2W"]);
  const far = openLibraryWorks({ OL4W: redirect("OL4W", "OL5W"), OL5W: redirect("OL5W", "OL6W"), OL6W: redirect("OL6W", "OL7W") });
  assert.deepEqual(await fillFromWikidata(repo, far.fetchWork, [wikidata("Far", "1", { olWorkIds: ["OL4W"] })], AT, LIVE), { matched: 0, added: 0, redirected: 0, failedKeys: [] });
  assert.deepEqual(far.asked, ["OL4W", "OL5W"]);
  assert.deepEqual(rowsOf(db, "work_series").map((row) => [row.name, row.work_id]), [["Near", reached.work_id]]);
});

test("an Open Library answer that is not a redirect to a work leaves the row unmatched without being a failure", async () => {
  const { db, repo } = setup();
  book(repo, null, "Catalog work", "Author", { workKey: "OL9W" });
  const { asked, fetchWork } = openLibraryWorks({
    OL1W: { key: "/works/OL1W", type: { key: "/type/work" }, title: "Plain" },
    OL3W: { key: "/works/OL3W", type: { key: "/type/delete" } },
    OL4W: { key: "/works/OL4W", type: { key: "/type/redirect" }, location: "/authors/OL1A" },
    OL5W: "not a record",
    OL6W: { key: "/works/OL6W", type: { key: "/type/work" }, location: "/works/OL9W" }
  });
  const report = await fillFromWikidata(repo, fetchWork, [wikidata("Nothing", "1", { olWorkIds: ["OL1W", "OL2W", "OL3W", "OL4W", "OL5W", "OL6W"] })], AT, LIVE);
  assert.deepEqual(report, { matched: 0, added: 0, redirected: 0, failedKeys: [] });
  assert.deepEqual(asked, ["OL1W", "OL2W", "OL3W", "OL4W", "OL5W", "OL6W"]);
  assert.equal(rowsOf(db, "work_series").length, 0);
});

test("Open Library is asked only for IDs no catalog work has, in rows that could be written, once each, in a dry run as well", async () => {
  for (const options of [LIVE, DRY]) {
    const { db, repo } = setup();
    const held = book(repo, null, "Held", "Author", { workKey: "OL10W" });
    const merged = book(repo, null, "Merged", "Author", { workKey: "OL20W" });
    const { asked, fetchWork } = openLibraryWorks({ OL21W: redirect("OL21W", "OL20W") });
    const report = await fillFromWikidata(repo, fetchWork, [
      wikidata("Series A", "1", { olWorkIds: ["OL10W", "OL11W"] }),
      wikidata("Piccola Biblioteca Adelphi", null, { olWorkIds: ["OL12W"] }),
      wikidata("!!!", null, { olWorkIds: ["OL13W"] }),
      wikidata("Series B", "1", { olWorkIds: ["OL21W"] }),
      wikidata("Series C", "2", { olWorkIds: ["OL21W"] })
    ], AT, { ...options, skip: new Set([seriesNameKey("Piccola Biblioteca Adelphi")!]) });
    assert.deepEqual(asked, ["OL11W", "OL21W"]);
    assert.deepEqual(report, { matched: 3, added: options.dryRun ? 0 : 3, redirected: 1, failedKeys: [] });
    assert.deepEqual(
      rowsOf(db, "work_series").map((row) => [row.name, row.work_id]),
      options.dryRun ? [] : [["Series A", held.work_id], ["Series B", merged.work_id], ["Series C", merged.work_id]]
    );
  }
});

test("an Open Library outage for one ID is reported and the other rows are still written, but a rate limit or any other error stops the fill", async () => {
  const { db, repo } = setup();
  const target = book(repo, null, "Target", "Author", { workKey: "OL30W" });
  const { fetchWork } = openLibraryWorks({
    OL31W: new SourceUnavailableError("openlibrary", "HTTP 503", { status: 503 }),
    OL32W: new SourceUnavailableError("openlibrary", "timeout"),
    OL33W: redirect("OL33W", "OL30W"),
    OL41W: redirect("OL41W", "OL42W"),
    OL42W: new SourceUnavailableError("openlibrary", "HTTP 502", { status: 502 })
  });
  const rows = ["OL31W", "OL32W", "OL33W", "OL41W"].map((key, index) => wikidata(`Series ${index}`, "1", { olWorkIds: [key] }));
  const report = await fillFromWikidata(repo, fetchWork, rows, AT, LIVE);
  assert.deepEqual(report, { matched: 1, added: 1, redirected: 1, failedKeys: ["OL31W", "OL32W", "OL41W"] });
  assert.deepEqual(rowsOf(db, "work_series").map((row) => [row.name, row.work_id]), [["Series 2", target.work_id]]);
  const limited = openLibraryWorks({ OL31W: new SourceUnavailableError("openlibrary", "HTTP 429", { status: 429 }) });
  await assert.rejects(fillFromWikidata(repo, limited.fetchWork, rows, AT, LIVE), (error: unknown) => error instanceof SourceUnavailableError && error.status === 429);
  const broken = openLibraryWorks({ OL31W: new TypeError("boom") });
  await assert.rejects(fillFromWikidata(repo, broken.fetchWork, rows, AT, LIVE), TypeError);
  assert.equal(rowsOf(db, "work_series").length, 1);
});

test("a Wikidata binding becomes a row with the English label, else the Portuguese one, else any label, and only Open Library work IDs", () => {
  const value = (text: string) => ({ value: text });
  assert.deepEqual(
    wikidataRowOf({ en: value("Malazan Book of the Fallen"), any: value("Malazan"), position: value(" 3 "), isbns: value("978-0-575-08140-6|0575081406"), olIds: value("OL1W|OL2M|OL3A|OL4W|") }),
    { isbns: ["978-0-575-08140-6", "0575081406"], olWorkIds: ["OL1W", "OL4W"], series: "Malazan Book of the Fallen", position: "3" }
  );
  assert.deepEqual(wikidataRowOf({ pt: value("Malazã"), any: value("Malazan"), isbns: value("") }), { isbns: [], olWorkIds: [], series: "Malazã", position: null });
  assert.deepEqual(wikidataRowOf({ en: value("  "), pt: value("Malazã"), any: value("Malazan") })?.series, "Malazã");
  assert.deepEqual(wikidataRowOf({ any: value("Fantômas"), isbns: value("") }), { isbns: [], olWorkIds: [], series: "Fantômas", position: null });
  assert.equal(wikidataRowOf({ any: value("  ") }), null);
  assert.equal(wikidataRowOf({}), null);
});

function poppies(repo: BooksRepository, count = 3, original = "Princess Poppy", author = "Janey Louise Jones", offset = 0) {
  return Array.from({ length: count }, (_, index) => book(repo, String(9789720000000 + offset + index), `${original} em Português ${index + 1}`, author, { language: "pt-PT", original }));
}

test("three Portuguese editions claiming one original list it as a candidate series, and two do not", () => {
  const { repo } = setup();
  const poppy = poppies(repo);
  poppies(repo, 2, "Another Original", "Someone Else", 10);
  const candidates = listOriginalTitleSeries(repo);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.name, "Princess Poppy");
  assert.deepEqual([...candidates[0]!.workIds].sort(), poppy.map((row) => row.work_id!).sort());
  assert.deepEqual([...candidates[0]!.titles].sort(), poppy.map((row) => row.title).sort());
});

test("only the approved original titles are written, as position-less original-title series on their works", async () => {
  const { db, repo } = setup();
  const poppy = poppies(repo);
  const isadora = poppies(repo, 3, "Isadora Moon", "Harriet Muncaster", 20);
  const report = await fillFromOriginalTitles(repo, ["Princess Poppy"], AT, LIVE);
  assert.deepEqual(report, { names: 1, works: 3, added: 3 });
  const workIds = poppy.map((row) => row.work_id!);
  assert.deepEqual(repo.bestSeriesOf(workIds), new Map(workIds.map((id) => [id, { name: "Princess Poppy", position: null }])));
  assert.deepEqual(repo.bestSeriesOf(isadora.map((row) => row.work_id!)), new Map());
  assert.deepEqual(rowsOf(db, "work_series").map((row) => [row.source, row.position]), [["original-title", null], ["original-title", null], ["original-title", null]]);
  assert.deepEqual(await fillFromOriginalTitles(repo, ["Princess Poppy"], AT, LIVE), { names: 1, works: 3, added: 0 });
});

test("an approved name that is not a candidate stops the fill before anything is written", async () => {
  const { db, repo } = setup();
  poppies(repo);
  await assert.rejects(fillFromOriginalTitles(repo, ["Princess Poppy", "Princess Poppi"], AT, LIVE), /Princess Poppi/);
  assert.equal(rowsOf(db, "work_series").length, 0);
});

test("an original-titles dry run counts the works and writes nothing", async () => {
  const { db, repo } = setup();
  poppies(repo);
  assert.deepEqual(await fillFromOriginalTitles(countingTransactions(repo), ["Princess Poppy"], AT, DRY), { names: 1, works: 3, added: 0 });
  assert.equal(rowsOf(db, "work_series").length, 0);
});

const OAI = "https://oai.bnportugal.gov.pt/servlet/OAIHandler";
const windowUrl = (from: string, until: string) => `${OAI}?verb=ListRecords&metadataPrefix=marcxchange&set=bibliografianacional&from=${from}&until=${until}`;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/bnp/${name}`, import.meta.url), "utf8");
const ALLENDE_RECORD = /<record\b[\s\S]*<\/record>/.exec(fixture("urn-9789720044457.xml"))![0];
const ENVELOPE = '<?xml version="1.0" encoding="UTF-8" ?><OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><responseDate>2026-10-18T12:00:00Z</responseDate>';
const oaiPage = (records: string[]) => `${ENVELOPE}<ListRecords>${records.join("")}</ListRecords></OAI-PMH>`;
const DELETED = '<record><header status="deleted"><identifier>oai:oai.bn.pt:bibliografianacional/1</identifier><datestamp>2026-10-16</datestamp></header></record>';
const PORTUGUESE = "9789720044457";

function isbnN(n: number): string {
  const body = `9789720${String(n).padStart(5, "0")}`;
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

const recordOf = (isbn: string, collection?: [string, string]) => {
  const record = ALLENDE_RECORD.replace("978-972-0-04445-7", isbn);
  return collection ? record.replace('<datafield ind1=" " ind2=" " tag="675">', `<datafield ind1="2" ind2=" " tag="225"><subfield code="a">${collection[0]}</subfield><subfield code="v">${collection[1]}</subfield></datafield><datafield ind1=" " ind2=" " tag="675">`) : record;
};

function bnpDeps(repo: BooksRepository, script: Record<string, string | Error>) {
  const logs: string[] = [];
  const asked: string[] = [];
  return {
    logs,
    asked,
    deps: {
      repo,
      now: () => new Date(AT),
      log: (line: string) => logs.push(line),
      fetchText: async (url: string) => {
        asked.push(url);
        const reply = script[url] ?? new Error(`unscripted ${url}`);
        if (reply instanceof Error) throw reply;
        return { status: 200, text: reply };
      }
    }
  };
}

test("the national library fill gives a matching catalog book its collection and creates no book", async () => {
  const { db, repo } = setup();
  const matched = book(repo, PORTUGUESE, "A casa dos espíritos", "Isabel Allende");
  const plain = book(repo, isbnN(3), "Sem coleção", "Alguém");
  const { deps, logs } = bnpDeps(repo, { [windowUrl("2026-10-16", "2026-10-17")]: oaiPage([recordOf(PORTUGUESE, ["Bang!", "248"]), recordOf(isbnN(2), ["Bang!", "249"]), recordOf(isbnN(3)), DELETED]) });
  const report = await fillBnpCollections(deps, [{ from: "2026-10-16", until: "2026-10-17" }], LIVE);
  assert.deepEqual(report, { windows: 1, records: 4, matched: 1, added: 1, failedWindows: [] });
  assert.deepEqual(repo.collectionsOf([matched.id, plain.id]), new Map([[matched.id, { name: "Bang!", position: "248" }]]));
  assert.deepEqual(rowsOf(db, "book_collections").map((row) => [row.name, row.position, row.source]), [["Bang!", "248", "bnp"]]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n, 2);
  assert.equal(repo.findBookByKey(`isbn:${isbnN(2)}`), undefined);
  assert.equal(logs.length, 1);
  assert.deepEqual(await fillBnpCollections(deps, [{ from: "2026-10-16", until: "2026-10-17" }], LIVE), { windows: 1, records: 4, matched: 1, added: 0, failedWindows: [] });
});

test("a national library window that cannot be read is reported and the other windows still run", async () => {
  const { repo } = setup();
  const matched = book(repo, PORTUGUESE, "A casa dos espíritos", "Isabel Allende");
  const { deps } = bnpDeps(repo, {
    [windowUrl("2026-09-15", "2026-09-30")]: new SourceUnavailableError("oai.bnportugal.gov.pt", "HTTP 503"),
    [windowUrl("2026-10-01", "2026-10-02")]: oaiPage([recordOf(PORTUGUESE, ["Bang!", "248"])])
  });
  const report = await fillBnpCollections(deps, [{ from: "2026-09-15", until: "2026-09-30" }, { from: "2026-10-01", until: "2026-10-02" }], LIVE);
  assert.deepEqual(report, { windows: 2, records: 1, matched: 1, added: 1, failedWindows: ["2026-09-15..2026-09-30"] });
  assert.equal(repo.collectionsOf([matched.id]).get(matched.id)?.name, "Bang!");
});

test("a national library dry run reads the windows, counts the matches and writes nothing", async () => {
  const { db, repo } = setup();
  book(repo, PORTUGUESE, "A casa dos espíritos", "Isabel Allende");
  const { deps } = bnpDeps(repo, { [windowUrl("2026-10-16", "2026-10-17")]: oaiPage([recordOf(PORTUGUESE, ["Bang!", "248"])]) });
  const events: string[] = [];
  const report = await fillBnpCollections({ ...deps, repo: countingTransactions(repo, events) }, [{ from: "2026-10-16", until: "2026-10-17" }], DRY);
  assert.deepEqual(report, { windows: 1, records: 1, matched: 1, added: 0, failedWindows: [] });
  assert.equal(rowsOf(db, "book_collections").length, 0);
  assert.deepEqual(events, []);
});

test("national library collections are written in batches too", async () => {
  const { db, repo } = setup();
  const isbns = Array.from({ length: 650 }, (_, index) => isbnN(100 + index));
  for (const [index, isbn] of isbns.entries()) book(repo, isbn, `Livro ${index}`, "Alguém");
  const { deps } = bnpDeps(repo, { [windowUrl("2026-10-16", "2026-10-17")]: oaiPage(isbns.map((isbn, index) => recordOf(isbn, ["Clássicos", String(index + 1)]))) });
  const events: string[] = [];
  const report = await fillBnpCollections({ ...deps, repo: countingTransactions(repo, events) }, [{ from: "2026-10-16", until: "2026-10-17" }], LIVE);
  assert.deepEqual(report, { windows: 1, records: 650, matched: 650, added: 650, failedWindows: [] });
  assert.equal(rowsOf(db, "book_collections").length, 650);
  assert.deepEqual(events, ["tx", "tx", "tx"]);
});

const held = (options = LIVE, logs: string[] = []) => ({ ...options, log: (line: string) => logs.push(line) });

function heldSetup() {
  const { db, repo } = setup();
  const english = book(repo, "9780141439587", "Emma", "Jane Austen", { workKey: "OL66554W" });
  const portuguese = book(repo, "9789720000999", "Emma", "Jane Austen", { workKey: "OL66554W" });
  book(repo, null, "Emma sem ISBN", "Jane Austen", { workKey: "OL66554W" });
  const unheld = book(repo, "9780575081406", "Gardens of the Moon", "Steven Erikson");
  const asked: string[] = [];
  const record = (series: EditionRecord["series"]): EditionRecord => ({ title: "", workKey: null, languages: [], ...(series ? { series } : {}) });
  return { db, repo, english, portuguese, unheld, asked, record };
}

test("held works' editions are asked of Open Library and given their edition series as ol-edition collections", async () => {
  const h = heldSetup();
  const catalog = {
    fetchEditionRecord: async (isbn: string) => {
      h.asked.push(isbn);
      return isbn === "9780141439587" ? h.record([{ name: "Penguin Classics", position: null }]) : isbn === "9789720000999" ? h.record([{ name: "Clássicos", position: "7" }]) : null;
    }
  };
  const report = await fillHeldEditions(h.repo, catalog, [h.english.work_id!], AT, held());
  assert.deepEqual(report, { asked: 2, added: 2, failedIsbns: [] });
  assert.deepEqual(h.asked.sort(), ["9780141439587", "9789720000999"]);
  assert.deepEqual(h.repo.collectionsOf([h.english.id, h.portuguese.id, h.unheld.id]), new Map([[h.english.id, { name: "Penguin Classics", position: null }], [h.portuguese.id, { name: "Clássicos", position: "7" }]]));
  assert.deepEqual(rowsOf(h.db, "book_collections").map((row) => row.source), ["ol-edition", "ol-edition"]);
  assert.equal(rowsOf(h.db, "work_series").length, 0);
  assert.deepEqual(await fillHeldEditions(h.repo, catalog, [h.english.work_id!], AT, held()), { asked: 2, added: 0, failedIsbns: [] });
});

test("a held id that was joined into another work asks for the editions of the work it became", async () => {
  const { repo } = setup();
  const portuguese = book(repo, "9789720000999", "Orgulho e Preconceito", "Jane Austen", { language: "pt-PT" });
  const english = book(repo, "9780141439518", "Pride and Prejudice", "Jane Austen", { workKey: "OL66554W" });
  repo.mergeTranslation(portuguese.work_id!, english.work_id!, "manual", null, AT);
  const asked: string[] = [];
  const report = await fillHeldEditions(repo, { fetchEditionRecord: async (isbn) => { asked.push(isbn); return null; } }, [portuguese.work_id!], AT, held());
  assert.deepEqual(report, { asked: 2, added: 0, failedIsbns: [] });
  assert.deepEqual(asked.sort(), ["9780141439518", "9789720000999"]);
});

test("a held dry run counts the editions it would ask and asks none", async () => {
  const h = heldSetup();
  const catalog = { fetchEditionRecord: async (isbn: string) => { h.asked.push(isbn); return h.record([{ name: "Penguin Classics", position: null }]); } };
  const logs: string[] = [];
  const report = await fillHeldEditions(h.repo, catalog, [h.english.work_id!], AT, held(DRY, logs));
  assert.deepEqual(report, { asked: 2, added: 0, failedIsbns: [] });
  assert.deepEqual(logs, []);
  assert.deepEqual(h.asked, []);
  assert.equal(rowsOf(h.db, "book_collections").length, 0);
});

test("an Open Library failure for one edition is counted and the rest go on, but a rate limit stops the fill", async () => {
  const h = heldSetup();
  const flaky = {
    fetchEditionRecord: async (isbn: string) => {
      if (isbn === "9780141439587") throw new SourceUnavailableError("openlibrary", "HTTP 503", { status: 503 });
      return h.record([{ name: "Clássicos", position: null }]);
    }
  };
  assert.deepEqual(await fillHeldEditions(h.repo, flaky, [h.english.work_id!], AT, held()), { asked: 2, added: 1, failedIsbns: ["9780141439587"] });
  const limited = { fetchEditionRecord: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 429", { status: 429 }); } };
  await assert.rejects(fillHeldEditions(h.repo, limited, [h.english.work_id!], AT, held()), (error: unknown) => error instanceof SourceUnavailableError && error.status === 429);
  const broken = { fetchEditionRecord: async () => { throw new TypeError("boom"); } };
  await assert.rejects(fillHeldEditions(h.repo, broken, [h.english.work_id!], AT, held()), TypeError);
});

test("held progress is logged every 25 editions with what was asked, added and failed so far, and the report lists the ISBNs that failed", async () => {
  const { repo } = setup();
  const isbns = Array.from({ length: 60 }, (_, index) => isbnN(300 + index));
  const first = book(repo, isbns[0]!, "Edição 0", "Alguém", { workKey: "OL7W" });
  for (const [index, isbn] of isbns.entries()) if (index > 0) book(repo, isbn, `Edição ${index}`, "Alguém", { workKey: "OL7W" });
  const failing = new Set([isbns[3], isbns[40]]);
  const catalog = {
    fetchEditionRecord: async (isbn: string) => {
      if (failing.has(isbn)) throw new SourceUnavailableError("openlibrary", "HTTP 503", { status: 503 });
      return { title: "", workKey: null, languages: [], series: [{ name: "Clássicos", position: isbn.slice(-3) }] } as EditionRecord;
    }
  };
  const logs: string[] = [];
  const report = await fillHeldEditions(repo, catalog, [first.work_id!], AT, held(LIVE, logs));
  assert.deepEqual(report, { asked: 60, added: 58, failedIsbns: [isbns[3], isbns[40]] });
  assert.deepEqual(logs.map((line) => JSON.parse(line)), [
    { asked: 25, of: 60, added: 24, failed: 1 },
    { asked: 50, of: 60, added: 48, failed: 2 }
  ]);
});
