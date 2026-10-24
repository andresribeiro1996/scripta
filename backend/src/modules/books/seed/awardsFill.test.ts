import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { PrizeKey } from "@scripta/shared";
import type { Binding } from "../adapters/wikidata/sparql.js";
import type { BooksRepository } from "../domain/ports.js";
import type { AwardRow, PrizeTally } from "./awardsFill.js";

const scratch = mkdtempSync(join(tmpdir(), "awards-fill-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.TZ = "America/Sao_Paulo";

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { WIKIDATA_PAGE_ROWS } = await import("../adapters/wikidata/sparql.js");
const { SourceUnavailableError } = await import("../domain/errors.js");
const { PRIZE_ITEMS } = await import("../domain/awards.js");
const { awardQueries, awardRowsOf, fillAwards, refreshAwards } = await import("./awardsFill.js");

const AT = "2026-10-24T12:00:00.000Z";
const LIVE = { dryRun: false };
const DRY = { dryRun: true };

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return { db, repo: createSqliteBooksRepository(db) };
}

function book(repo: BooksRepository, isbn: string | null, title: string, author: string, workKey?: string) {
  return repo.createBook({ title, author, isbn, workKey }, isbn ? [`isbn:${isbn}`] : [`ta:${title.toLowerCase()}|${author.toLowerCase()}|`], AT);
}

const binding = (fields: Record<string, string>): Binding => Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, { value }]));
const item = (id: string) => `http://www.wikidata.org/entity/${id}`;
const row = (prize: PrizeKey, year: number, won: boolean, ids: { isbns?: string[]; olWorkIds?: string[]; honoree?: string } = {}): AwardRow => ({
  isbns: ids.isbns ?? [],
  olWorkIds: ids.olWorkIds ?? [],
  prize,
  year,
  won,
  honoree: ids.honoree ?? null
});
const prizesWith = (own: Partial<Record<PrizeKey, PrizeTally>>) =>
  Object.fromEntries(Object.keys(PRIZE_ITEMS).map((key) => [key, own[key as PrizeKey] ?? { rows: 0, works: 0, won: 0, nominated: 0 }]));

const noWork = async () => null;
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

const storedAwards = (db: DatabaseSync) =>
  (db.prepare("SELECT work_id, prize, year, won, honoree, created_at FROM work_awards ORDER BY rowid").all() as Array<Record<string, unknown>>).map((stored) => ({ ...stored }));

test("awardRowsOf reads P166 as won and P1411 as nominated", () => {
  const { rows, noYear } = awardRowsOf([
    binding({ prize: item("Q160082"), won: "true", year: "2019", olIds: "OL1W|OL2W", work: item("Q1") }),
    binding({ prize: item("Q160082"), won: "false", year: "2018", isbns: "9780441013593| 9780141439587 |" }),
    binding({ prize: item("Q255032"), won: "true", year: "1966", isbns: "9780441013593" }),
    binding({ prize: item("Q266012"), year: "1967", isbns: "9780441013593" })
  ]);
  assert.deepEqual(rows, [
    { isbns: [], olWorkIds: ["OL1W", "OL2W"], prize: "booker", year: 2019, won: true, honoree: null },
    { isbns: ["9780441013593", "9780141439587"], olWorkIds: [], prize: "booker", year: 2018, won: false, honoree: null },
    { isbns: ["9780441013593"], olWorkIds: [], prize: "hugo-novel", year: 1966, won: true, honoree: null },
    { isbns: ["9780441013593"], olWorkIds: [], prize: "nebula-novel", year: 1967, won: false, honoree: null }
  ]);
  assert.deepEqual(noYear, {});
});

test("awardRowsOf counts statements with no year per prize and leaves them out", () => {
  const { rows, noYear } = awardRowsOf([
    binding({ prize: item("Q2052291"), won: "true", isbns: "9780000000002" }),
    binding({ prize: item("Q2052291"), won: "true", olIds: "OL3W" }),
    binding({ prize: item("Q160082"), won: "false", year: "", olIds: "OL4W" }),
    binding({ prize: item("Q255032"), won: "true", year: "1966", olIds: "OL5W" })
  ]);
  assert.deepEqual(rows.map((kept) => [kept.prize, kept.year]), [["hugo-novel", 1966]]);
  assert.deepEqual(noYear, { "international-booker": 2, booker: 1 });
});

test("awardRowsOf ignores an unlisted item", () => {
  const { rows, noYear } = awardRowsOf([
    binding({ prize: item("Q42"), won: "true", year: "2019", olIds: "OL1W" }),
    binding({ prize: item("Q42"), won: "true", olIds: "OL2W" }),
    binding({ won: "true", year: "2019", olIds: "OL3W" }),
    binding({ prize: item("Q1601"), won: "true", year: "2019", olIds: "OL4W" })
  ]);
  assert.deepEqual(rows, []);
  assert.deepEqual(noYear, {});
});

test("awardRowsOf takes the honoree's English label, else Portuguese, else any", () => {
  const { rows } = awardRowsOf([
    binding({ prize: item("Q37922"), won: "true", year: "1998", olIds: "OL1W", en: "José Saramago", pt: "José de Sousa Saramago", any: "Saramago" }),
    binding({ prize: item("Q37922"), won: "true", year: "1998", olIds: "OL2W", pt: "José de Sousa Saramago", any: "Saramago" }),
    binding({ prize: item("Q37922"), won: "true", year: "1998", olIds: "OL3W", en: "  ", pt: "José de Sousa Saramago" }),
    binding({ prize: item("Q37922"), won: "true", year: "1998", olIds: "OL4W", any: "Saramago" }),
    binding({ prize: item("Q37922"), won: "true", year: "1998", olIds: "OL5W" })
  ]);
  assert.deepEqual(rows.map((kept) => kept.honoree), ["José Saramago", "José de Sousa Saramago", "José de Sousa Saramago", "Saramago", null]);
});

test("awardQueries makes P585 optional without minYear and filters on it with one", () => {
  const optional = "OPTIONAL { ?statement pq:P585 ?when . } BIND(YEAR(?when) AS ?year)";
  const required = "?statement pq:P585 ?when . BIND(YEAR(?when) AS ?year) FILTER(?year >= 2025)";
  assert.equal(awardQueries().length, 12);
  for (const { kind, page } of awardQueries()) {
    assert.ok(page(0).includes(optional), kind);
    assert.ok(!page(0).includes("FILTER(?year"), kind);
  }
  for (const { kind, page } of awardQueries(2025)) {
    assert.ok(page(0).includes(required), kind);
    assert.ok(!page(0).includes("OPTIONAL { ?statement pq:P585"), kind);
  }
  const { page } = awardQueries()[0]!;
  assert.ok(page(0).includes(`LIMIT ${WIKIDATA_PAGE_ROWS} OFFSET 0`));
  assert.ok(page(6000).includes(`LIMIT ${WIKIDATA_PAGE_ROWS} OFFSET 6000`));
});

test("awardQueries covers each identifier kind for every shape Task 1 recorded", () => {
  const queries = awardQueries();
  const queryOf = (kind: string) => queries.find((query) => query.kind === kind)!.page(0);
  assert.deepEqual(
    queries.map((query) => query.kind),
    ["on-work", "on-author", "on-prize", "author-prize"].flatMap((shape) => ["openlibrary", "isbn", "edition-isbn"].map((identifiers) => `${shape}/${identifiers}`))
  );
  const bookPrizes = "VALUES ?prize { wd:Q160082 wd:Q2052291 wd:Q255032 wd:Q266012 wd:Q833633 wd:Q6335592 wd:Q2115410 wd:Q10291073 }";
  const authorPrizes = "VALUES ?prize { wd:Q37922 wd:Q752134 }";
  const pairs = "VALUES (?p ?ps ?won) { (p:P166 ps:P166 true) (p:P1411 ps:P1411 false) }";
  const shapes: Record<string, { present: string[]; absent: string[] }> = {
    "on-work": { present: [pairs, "?work ?p ?statement . ?statement ?ps ?prize .", bookPrizes], absent: ["P1686", "P1346", "P50", authorPrizes] },
    "on-author": { present: [pairs, "?person ?p ?statement . ?statement ?ps ?prize ; pq:P1686 ?work .", bookPrizes], absent: ["P1346", "P50", authorPrizes] },
    "on-prize": { present: ["?prize p:P1346 ?statement . ?statement pq:P1686 ?work . BIND(true AS ?won)", bookPrizes], absent: [pairs, "P50", authorPrizes] },
    "author-prize": {
      present: ["?person p:P166 ?statement . ?statement ps:P166 ?prize . ?work wdt:P50 ?person . BIND(true AS ?won)", authorPrizes, "(SAMPLE(?enLabel) AS ?en)", "(SAMPLE(?ptLabel) AS ?pt)", "(SAMPLE(?anyLabel) AS ?any)"],
      absent: [pairs, "P1346", "P1686", bookPrizes]
    }
  };
  const identifiers: Record<string, { present: string[]; absent: string[] }> = {
    openlibrary: { present: ['?work wdt:P648 ?id . FILTER(REGEX(?id, "^OL[0-9]+W$"))', "AS ?olIds)"], absent: ["P212", "P629", "AS ?isbns)"] },
    isbn: { present: ["?work (wdt:P212|wdt:P957) ?id . FILTER NOT EXISTS { ?work wdt:P31 wd:Q3331189 }", "AS ?isbns)"], absent: ["P648", "P629", "AS ?olIds)"] },
    "edition-isbn": { present: ["?edition wdt:P629 ?work . ?edition (wdt:P212|wdt:P957) ?id .", "AS ?isbns)"], absent: ["P648", "FILTER NOT EXISTS", "AS ?olIds)"] }
  };
  for (const [shape, expectedShape] of Object.entries(shapes)) {
    for (const [kind, expectedKind] of Object.entries(identifiers)) {
      const text = queryOf(`${shape}/${kind}`);
      for (const needle of [...expectedShape.present, ...expectedKind.present]) assert.ok(text.includes(needle), `${shape}/${kind} lacks ${needle}`);
      for (const needle of [...expectedShape.absent, ...expectedKind.absent]) assert.ok(!text.includes(needle), `${shape}/${kind} has ${needle}`);
    }
  }
});

test("fillAwards writes an author prize on every matched work of its honoree", async () => {
  const { db, repo } = setup();
  const blindness = book(repo, "9780156007757", "Blindness", "José Saramago");
  const gospel = book(repo, null, "The Gospel According to Jesus Christ", "José Saramago", "OL1W");
  const dune = book(repo, "9780441013593", "Dune", "Frank Herbert");
  const honoree = "José Saramago";
  const report = await fillAwards(repo, noWork, [
    row("nobel-literature", 1998, true, { isbns: ["9780156007757"], honoree }),
    row("nobel-literature", 1998, true, { olWorkIds: ["OL1W"], honoree }),
    row("nobel-literature", 1998, true, { isbns: ["9780000000002"], honoree })
  ], AT, LIVE);
  assert.equal(report.matched, 2);
  assert.equal(report.added, 2);
  assert.deepEqual(repo.awardsOf([blindness.work_id!, gospel.work_id!, dune.work_id!]), new Map([
    [blindness.work_id!, [{ prize: "nobel-literature", year: 1998, won: true }]],
    [gospel.work_id!, [{ prize: "nobel-literature", year: 1998, won: true }]]
  ]));
  assert.deepEqual(storedAwards(db).map((stored) => [stored.honoree, stored.created_at]), [[honoree, AT], [honoree, AT]]);
});

test("a dry run makes the same lookups and writes nothing", async () => {
  const rows = [row("booker", 2019, true, { olWorkIds: ["OL21W"] }), row("booker", 2019, false, { olWorkIds: ["OL11W"] }), row("hugo-novel", 1966, true, { isbns: ["9780441013593"] })];
  const runs = [];
  for (const options of [LIVE, DRY]) {
    const { db, repo } = setup();
    book(repo, "9780441013593", "Dune", "Frank Herbert");
    book(repo, null, "Merged", "Author", "OL20W");
    const { asked, fetchWork } = openLibraryWorks({ OL21W: redirect("OL21W", "OL20W") });
    const events: string[] = [];
    const counting = { ...repo, transaction: <T>(write: () => T): T => { events.push("tx"); return repo.transaction(write); } } as BooksRepository;
    runs.push({ report: await fillAwards(counting, fetchWork, rows, AT, options), asked, events, stored: storedAwards(db).length });
  }
  const [live, dry] = runs;
  assert.equal(live!.report.matched, 2);
  assert.equal(live!.report.redirected, 1);
  assert.equal(live!.report.added, 2);
  assert.equal(live!.stored, 2);
  assert.deepEqual(dry!.report, { ...live!.report, added: 0 });
  assert.deepEqual(dry!.asked, live!.asked);
  assert.deepEqual(dry!.asked, ["OL21W", "OL11W"]);
  assert.equal(dry!.stored, 0);
  assert.deepEqual(dry!.events, []);
});

test("fillAwards reports per prize rows, works, won and nominated", async () => {
  const { repo } = setup();
  book(repo, "9780441013593", "Dune", "Frank Herbert");
  book(repo, "9780141439587", "Emma", "Jane Austen", "OL66554W");
  const dune = { isbns: ["9780441013593"] };
  const emma = { olWorkIds: ["OL66554W"] };
  const report = await fillAwards(repo, noWork, [
    row("booker", 2019, false, dune),
    row("booker", 2019, true, { ...dune, olWorkIds: ["OL1W"] }),
    row("booker", 2018, false, emma),
    row("booker", 2017, true, { isbns: ["9780000000002"] }),
    row("hugo-novel", 1966, true, dune),
    row("hugo-novel", 1967, false, emma),
    row("hugo-novel", 1967, false, { isbns: ["9780141439587"] })
  ], AT, LIVE);
  assert.deepEqual(report, {
    matched: 4,
    added: 4,
    redirected: 0,
    failedKeys: [],
    prizes: prizesWith({
      booker: { rows: 4, works: 2, won: 1, nominated: 1 },
      "hugo-novel": { rows: 3, works: 2, won: 1, nominated: 1 }
    })
  });
});

test("fillAwards stores one row per work, prize and year, a win beats a nomination in either order, and a second run adds nothing", async () => {
  for (const won of [[false, true], [true, false]]) {
    const { db, repo } = setup();
    const dune = book(repo, "9780441013593", "Dune", "Frank Herbert");
    const rows = [row("hugo-novel", 1966, won[0]!, { isbns: ["9780441013593"] }), row("hugo-novel", 1966, won[1]!, { isbns: ["9780441013593"] })];
    const first = await fillAwards(repo, noWork, rows, AT, LIVE);
    assert.deepEqual([first.matched, first.added], [1, 1]);
    assert.deepEqual(storedAwards(db), [{ work_id: dune.work_id, prize: "hugo-novel", year: 1966, won: 1, honoree: null, created_at: AT }]);
    const again = await fillAwards(repo, noWork, rows, "2026-10-25T12:00:00.000Z", LIVE);
    assert.deepEqual([again.matched, again.added], [1, 0]);
    assert.equal(storedAwards(db)[0]!.created_at, AT);
  }
});

function refreshDeps(overrides: Record<string, unknown> = {}) {
  const { db, repo } = setup();
  const lines: Array<[object, string]> = [];
  const asked: string[] = [];
  const deps = {
    repo,
    query: async (text: string) => {
      asked.push(text);
      return [] as Binding[];
    },
    fetchWork: noWork,
    now: () => Date.UTC(2027, 0, 1, 1, 0, 0),
    info: (fields: object, message: string) => void lines.push([fields, message]),
    sleep: async () => {},
    ...overrides
  };
  return { db, repo, lines, asked, deps };
}

test("refreshAwards queries from last year, pages until a short page and logs one summary line", async () => {
  const { db, repo, lines, asked, deps } = refreshDeps();
  book(repo, "9780441013593", "Dune", "Frank Herbert");
  const full = Array.from({ length: WIKIDATA_PAGE_ROWS }, (_, index) => binding({ prize: item("Q160082"), won: "false", year: "2026", isbns: `97810000${String(index).padStart(5, "0")}` }));
  const matching = binding({ prize: item("Q255032"), won: "true", year: "2026", isbns: "9780441013593" });
  await refreshAwards({ ...deps, query: async (text: string) => {
    asked.push(text);
    return [full, [matching]][asked.length - 1] ?? [];
  } }, new AbortController().signal);
  assert.equal(asked.length, 13);
  assert.ok(asked[0]!.includes("OFFSET 0"));
  assert.ok(asked[1]!.includes("OFFSET 3000"));
  assert.equal(asked[1]!.replace("OFFSET 3000", "OFFSET 0"), asked[0]);
  assert.ok(asked[2]!.includes("OFFSET 0") && asked[2] !== asked[0]);
  for (const text of asked) assert.ok(text.includes("FILTER(?year >= 2026)"), text);
  assert.deepEqual(lines, [[{ rows: 3001, matched: 1, added: 1, redirected: 0, failedKeys: 0 }, "awards refresh"]]);
  assert.deepEqual(storedAwards(db).map((stored) => [stored.prize, stored.year, stored.created_at]), [["hugo-novel", 2026, "2027-01-01T01:00:00.000Z"]]);
});

test("refreshAwards lets a Wikidata failure, an Open Library 429 and an abort propagate, and logs nothing", async () => {
  const failing = refreshDeps({ query: async () => { throw new Error("Wikidata query failed after 3 attempts: HTTP 503"); } });
  await assert.rejects(refreshAwards(failing.deps, new AbortController().signal), /Wikidata query failed after 3 attempts/);

  const asked: string[] = [];
  const limited = openLibraryWorks({ OL1W: new SourceUnavailableError("openlibrary", "HTTP 429", { status: 429 }) });
  const throttled = refreshDeps({
    fetchWork: limited.fetchWork,
    query: async (text: string) => {
      asked.push(text);
      return asked.length === 1 ? [binding({ prize: item("Q160082"), won: "true", year: "2026", olIds: "OL1W" })] : [];
    }
  });
  await assert.rejects(refreshAwards(throttled.deps, new AbortController().signal), (error: unknown) => error instanceof SourceUnavailableError && error.status === 429);
  assert.equal(asked.length, 12);

  const aborted = new AbortController();
  aborted.abort();
  const stopped = refreshDeps();
  await assert.rejects(refreshAwards(stopped.deps, aborted.signal), { name: "AbortError" });
  assert.deepEqual(stopped.asked, []);

  assert.deepEqual([failing.lines, throttled.lines, stopped.lines], [[], [], []]);
});
