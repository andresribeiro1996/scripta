import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const MODES = ["wikidata", "originals", "bnp", "held"];
const USAGE = [
  "Usage: node scripts/fill-series.mjs wikidata|originals|bnp|held [--dry-run]",
  "       node scripts/fill-series.mjs wikidata [--dry-run] [--skip <names.json>]",
  "       node scripts/fill-series.mjs originals --list | --apply <approved.json>",
  "       node scripts/fill-series.mjs bnp [--from YYYY-MM-DD] [--until YYYY-MM-DD]"
].join("\n");
const WIKIDATA_URL = "https://query.wikidata.org/sparql";
const WIKIDATA_PAGE_ROWS = 3000;
const WIKIDATA_TIMEOUT_MS = 90_000;
const WIKIDATA_ATTEMPTS = 3;
const WIKIDATA_RETRY_MS = 60_000;
const WIKIDATA_GAP_MS = 5_000;
const OPEN_LIBRARY_GAP_MS = 1000;
const EDITION_CLASS = "wd:Q3331189";
const PUBLISHER_SERIES_CLASSES = "wd:Q20655472 wd:Q15695196 wd:Q1700470 wd:Q27785883";
const SERIES = `?work p:P179 ?statement . ?statement ps:P179 ?series . OPTIONAL { ?statement pq:P1545 ?position . } FILTER NOT EXISTS { ?series wdt:P31 ?seriesClass . VALUES ?seriesClass { ${PUBLISHER_SERIES_CLASSES} } }`;
const WIKIDATA_KINDS = [
  { ids: "olIds", where: `${SERIES} ?work wdt:P648 ?id . FILTER(REGEX(?id, "^OL[0-9]+W$"))` },
  { ids: "isbns", where: `?work (wdt:P212|wdt:P957) ?id . ${SERIES} FILTER NOT EXISTS { ?work wdt:P31 ${EDITION_CLASS} }` },
  { ids: "isbns", where: `${SERIES} ?edition wdt:P629 ?work . ?edition (wdt:P212|wdt:P957) ?id .` }
];

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    apply: { type: "string" },
    skip: { type: "string" },
    from: { type: "string", default: "2000-01-01" },
    until: { type: "string" }
  }
});
const mode = positionals[0];
if (positionals.length !== 1 || !MODES.includes(mode)) fail(USAGE);
if (values.skip !== undefined && mode !== "wikidata") fail(USAGE);
if (mode === "originals" ? values.list === (values.apply !== undefined) : values.list || values.apply !== undefined) fail(USAGE);
for (const name of mode === "held" ? ["COVERS_DB_PATH", "LIBRARY_DB_PATH"] : ["COVERS_DB_PATH"]) {
  if (!process.env[name]) fail(`Missing environment variable: ${name}`);
}

const { USER_AGENT, createThrottle } = await import("../dist/modules/books/adapters/http/http.js");
const { createOpenLibraryCatalog } = await import("../dist/modules/books/adapters/openlibrary/openLibraryCatalog.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { fetchBnpPage, monthWindows, utcDate, waitForBnpLock } = await import("../dist/modules/books/seed/bnpImport.js");
const { seriesNameKey } = await import("../dist/modules/books/domain/series.js");
const { fillBnpCollections, fillFromOriginalTitles, fillFromWikidata, fillHeldEditions, listOriginalTitleSeries, seriesCounts, wikidataRowOf, wikidataTally } = await import("../dist/modules/books/seed/seriesFill.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");

const dryRun = values["dry-run"];
const at = new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line) => console.error(line);

function namesIn(path, what) {
  const names = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) fail(`${path} must hold a JSON array of ${what}`);
  return names;
}

function bnpWindows() {
  const until = values.until ?? utcDate(new Date());
  for (const [name, value] of [["--from", values.from], ["--until", until]]) {
    const day = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(day.getTime()) || utcDate(day) !== value) fail(`${name} must be a date as YYYY-MM-DD, got "${value}"`);
  }
  if (values.from > until) fail(`--from ${values.from} is after --until ${until}`);
  return monthWindows(values.from, until);
}

const isRetryable = (error) => error instanceof TypeError || error instanceof SyntaxError || error.name === "TimeoutError";
const reasonOf = (error) => (error.cause ? `${error.message} (${error.cause.code ?? error.cause.message})` : error.message);

async function queryWikidata(query) {
  for (let attempt = 1; ; attempt++) {
    let failure;
    try {
      const response = await fetch(WIKIDATA_URL, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(WIKIDATA_TIMEOUT_MS)
      });
      if (response.ok) return (await response.json()).results.bindings;
      if (response.status !== 429 && response.status < 500) throw new Error(`Wikidata query failed: HTTP ${response.status}`);
      failure = new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (!isRetryable(error)) throw error;
      failure = error;
    }
    if (attempt === WIKIDATA_ATTEMPTS) throw new Error(`Wikidata query failed after ${attempt} attempts: ${reasonOf(failure)}`, { cause: failure });
    log(`wikidata attempt ${attempt} failed (${reasonOf(failure)}), retrying`);
    await sleep(WIKIDATA_RETRY_MS);
  }
}

const wikidataPage = ({ ids, where }, offset) => `
SELECT ?position ?${ids} (SAMPLE(?enLabel) AS ?en) (SAMPLE(?ptLabel) AS ?pt) (SAMPLE(?anyLabel) AS ?any) WHERE {
  {
    SELECT ?work ?series ?position (GROUP_CONCAT(DISTINCT ?id; separator="|") AS ?${ids}) WHERE { ${where} }
    GROUP BY ?work ?series ?position
    ORDER BY ?work ?series ?position
    LIMIT ${WIKIDATA_PAGE_ROWS} OFFSET ${offset}
  }
  OPTIONAL { ?series rdfs:label ?enLabel . FILTER(LANG(?enLabel) = "en") }
  OPTIONAL { ?series rdfs:label ?ptLabel . FILTER(LANGMATCHES(LANG(?ptLabel), "pt")) }
  OPTIONAL { ?series rdfs:label ?anyLabel . }
}
GROUP BY ?work ?series ?position ?${ids}`;

async function runWikidata(repo) {
  const report = { pages: 0, rows: 0, matched: 0, added: 0 };
  const tally = wikidataTally();
  for (const [kind, spec] of WIKIDATA_KINDS.entries()) {
    for (let offset = 0, last = false; !last; offset += WIKIDATA_PAGE_ROWS) {
      if (report.pages > 0) await sleep(WIKIDATA_GAP_MS);
      const bindings = await queryWikidata(wikidataPage(spec, offset));
      const rows = bindings.flatMap((binding) => wikidataRowOf(binding) ?? []);
      const { matched, added } = await fillFromWikidata(repo, rows, at, { dryRun, skip, tally });
      report.pages++;
      report.rows += rows.length;
      report.matched += matched;
      report.added += added;
      log(JSON.stringify({ kind, offset, bindings: bindings.length, rows: rows.length, matched, added }));
      last = bindings.length < WIKIDATA_PAGE_ROWS;
    }
  }
  return { ...report, unmatchedSkips: skipNames.filter((name) => !tally.skipped.has(seriesNameKey(name))), series: seriesCounts(tally) };
}

async function run(repo) {
  if (mode === "wikidata") return runWikidata(repo);
  if (mode === "originals") return fillFromOriginalTitles(repo, approved, at, { dryRun });
  if (mode === "bnp") return fillBnpCollections({ repo, fetchText: fetchBnpPage, now: () => new Date(), log }, windows, { dryRun });
  const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks().map((work) => work.workId);
  const catalog = createOpenLibraryCatalog(createThrottle(OPEN_LIBRARY_GAP_MS));
  return fillHeldEditions(repo, catalog, held, at, { dryRun, log });
}

const approved = values.apply === undefined ? null : namesIn(values.apply, "approved names");
const skipNames = values.skip === undefined ? [] : namesIn(values.skip, "series names to skip");
const skip = new Set(skipNames.flatMap((name) => seriesNameKey(name) ?? []));
const windows = mode === "bnp" ? bnpWindows() : null;
const db = dryRun || values.list ? new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const repo = createSqliteBooksRepository(waitForBnpLock(db));
if (values.list) console.log(JSON.stringify(listOriginalTitleSeries(repo), null, 2));
else console.log(JSON.stringify({ mode, dryRun, ...(await run(repo)) }, null, 2));
