import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const USAGE = "Usage: node scripts/import-award-books.mjs [--dry-run] [--max <n>] [--skip <items.json>]";
const OPEN_LIBRARY_GAP_MS = 1000;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let values;
try {
  ({ values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, max: { type: "string" }, skip: { type: "string" } } }));
} catch (error) {
  if (!error.code?.startsWith("ERR_PARSE_ARGS_")) throw error;
  fail(`${error.message}\n${USAGE}`);
}
if (values.max !== undefined && !/^[1-9]\d*$/.test(values.max)) fail(`--max needs a positive integer\n${USAGE}`);
let skip = new Set();
if (values.skip !== undefined) {
  let items;
  try {
    items = JSON.parse(readFileSync(values.skip, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR" && error.code !== "EACCES" && !(error instanceof SyntaxError)) throw error;
    fail(`--skip needs a readable JSON file: ${error.message}\n${USAGE}`);
  }
  if (!Array.isArray(items) || !items.every((id) => typeof id === "string" && /^Q\d+$/.test(id))) {
    fail(`--skip needs a JSON array of Wikidata item IDs like "Q378786"\n${USAGE}`);
  }
  skip = new Set(items);
}
for (const name of ["COVERS_DB_PATH", "ARENA_DB_PATH"]) {
  if (!process.env[name]) fail(`Missing environment variable: ${name}`);
}

const { createThrottle } = await import("../dist/modules/books/adapters/http/http.js");
const { createOpenLibraryCatalog } = await import("../dist/modules/books/adapters/openlibrary/openLibraryCatalog.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { queryAllPages, queryWikidata } = await import("../dist/modules/books/adapters/wikidata/sparql.js");
const { createSqliteArenaRepository } = await import("../dist/modules/arena/adapters/sqlite/sqliteArenaRepository.js");
const { awardQueries } = await import("../dist/modules/books/seed/awardsFill.js");
const { awardWorksOf, importAwardBooks, missingAwardWorks, withWikidataNames } = await import("../dist/modules/books/seed/awardBooksImport.js");
const { waitForBnpLock } = await import("../dist/modules/books/seed/bnpImport.js");
const { arenaCheck } = await import("../dist/modules/books/translationJudgments.js");

const dryRun = values["dry-run"];
const max = values.max === undefined ? null : Number(values.max);
const at = new Date().toISOString();
const log = (line) => console.error(line);

log(JSON.stringify({ at }));

const db = dryRun ? new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const repo = createSqliteBooksRepository(waitForBnpLock(db));
const arena = createSqliteArenaRepository(new DatabaseSync(process.env.ARENA_DB_PATH, { readOnly: true }));

const pages = [];
for (const { kind, page } of awardQueries()) {
  if (kind.startsWith("author-prize/")) continue;
  pages.push({
    kind,
    bindings: await queryAllPages(page, { log, onPage: (offset, found) => log(JSON.stringify({ kind, offset, bindings: found.length })) })
  });
}
const works = awardWorksOf(pages);
const missing = await withWikidataNames((text) => queryWikidata(text, { log }), missingAwardWorks(repo, works));
log(JSON.stringify({ works: works.length, missing: missing.length }));

const report = await importAwardBooks(
  { repo, sharesArena: arenaCheck(repo, (a, b) => arena.worksShareATournament(a, b)), search: createOpenLibraryCatalog(createThrottle(OPEN_LIBRARY_GAP_MS), false).search, log },
  missing,
  at,
  { dryRun, max, skip }
);
console.log(JSON.stringify({ dryRun, max, works: works.length, missing: missing.length, ...report }, null, 2));
