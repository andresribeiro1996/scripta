import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const OPEN_LIBRARY_GAP_MS = 1000;
const USAGE = "Usage: node scripts/fetch-originals.mjs [--dry-run]";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let values;
try {
  ({ values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } }));
} catch (error) {
  if (!String(error.code).startsWith("ERR_PARSE_ARGS_")) throw error;
  fail(USAGE);
}
for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH", "ARENA_DB_PATH"]) {
  if (!process.env[name]) fail(`Missing environment variable: ${name}`);
}

const { createThrottle } = await import("../dist/modules/books/adapters/http/http.js");
const { searchOpenLibraryWorks } = await import("../dist/modules/books/adapters/openlibrary/openLibraryCatalog.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { waitForBnpLock } = await import("../dist/modules/books/seed/bnpImport.js");
const { createSqliteArenaRepository } = await import("../dist/modules/arena/adapters/sqlite/sqliteArenaRepository.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");
const { arenaCheck } = await import("../dist/modules/books/translationJudgments.js");
const { fillOriginals } = await import("../dist/modules/books/seed/originalsFill.js");

const dryRun = values["dry-run"];
const db = dryRun ? new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const repo = createSqliteBooksRepository(waitForBnpLock(db));
const arena = createSqliteArenaRepository(new DatabaseSync(process.env.ARENA_DB_PATH, { readOnly: true }));
const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks().map((work) => work.workId);
const throttle = createThrottle(OPEN_LIBRARY_GAP_MS);

const report = await fillOriginals(
  {
    repo,
    classify: async () => {
      throw new Error("no Jev in the originals fill");
    },
    sharesArena: arenaCheck(repo, (a, b) => arena.worksShareATournament(a, b)),
    now: Date.now,
    alert: (subject, text) => console.error(`${subject}: ${text}`),
    search: (title, author) => searchOpenLibraryWorks(throttle, title, author),
    log: console.error
  },
  held,
  { dryRun }
);
console.log(JSON.stringify({ dryRun, ...report }, null, 2));
