import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const USAGE = "Usage: node scripts/import-award-books.mjs [--dry-run] [--max <n>]";
const OPEN_LIBRARY_GAP_MS = 1000;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let values;
try {
  ({ values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, max: { type: "string" } } }));
} catch (error) {
  if (!error.code?.startsWith("ERR_PARSE_ARGS_")) throw error;
  fail(`${error.message}\n${USAGE}`);
}
if (values.max !== undefined && !/^[1-9]\d*$/.test(values.max)) fail(`--max needs a positive integer\n${USAGE}`);
for (const name of ["COVERS_DB_PATH", "ARENA_DB_PATH"]) {
  if (!process.env[name]) fail(`Missing environment variable: ${name}`);
}

const { createThrottle } = await import("../dist/modules/books/adapters/http/http.js");
const { createOpenLibraryCatalog } = await import("../dist/modules/books/adapters/openlibrary/openLibraryCatalog.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { queryAllPages } = await import("../dist/modules/books/adapters/wikidata/sparql.js");
const { createSqliteArenaRepository } = await import("../dist/modules/arena/adapters/sqlite/sqliteArenaRepository.js");
const { awardQueries } = await import("../dist/modules/books/seed/awardsFill.js");
const { awardWorksOf, importAwardBooks, missingAwardWorks } = await import("../dist/modules/books/seed/awardBooksImport.js");
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
const missing = missingAwardWorks(repo, works);
log(JSON.stringify({ works: works.length, missing: missing.length }));

const report = await importAwardBooks(
  { repo, sharesArena: arenaCheck(repo, (a, b) => arena.worksShareATournament(a, b)), search: createOpenLibraryCatalog(createThrottle(OPEN_LIBRARY_GAP_MS), false).search, log },
  missing,
  at,
  { dryRun, max }
);
console.log(JSON.stringify({ dryRun, max, works: works.length, missing: missing.length, ...report }, null, 2));
