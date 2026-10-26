import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const USAGE = "Usage: node scripts/fill-characters.mjs [--dry-run] [--after <rowid>]";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let values;
try {
  ({ values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, after: { type: "string", default: "0" } } }));
} catch (error) {
  if (!error.code?.startsWith("ERR_PARSE_ARGS_")) throw error;
  fail(`${error.message}\n${USAGE}`);
}
const after = Number(values.after);
if (!Number.isInteger(after) || after < 0) fail(USAGE);
if (!process.env.COVERS_DB_PATH) fail("Missing environment variable: COVERS_DB_PATH");

const { createThrottle } = await import("../dist/modules/books/adapters/http/http.js");
const { fetchOpenLibrarySubjects } = await import("../dist/modules/books/adapters/openlibrary/openLibraryCatalog.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { waitForBnpLock } = await import("../dist/modules/books/seed/bnpImport.js");
const { fillCharacters } = await import("../dist/modules/books/seed/charactersFill.js");

const dryRun = values["dry-run"];
const log = (line) => console.error(line);
const throttle = createThrottle(1000);

const db = dryRun ? new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const repo = createSqliteBooksRepository(waitForBnpLock(db));
const progress = { lastRowid: after };

try {
  const report = await fillCharacters(repo, (works) => fetchOpenLibrarySubjects(throttle, works), new Date().toISOString(), { dryRun, log: (line) => { log(line); progress.lastRowid = JSON.parse(line).lastRowid ?? progress.lastRowid; }, after });
  console.log(JSON.stringify({ dryRun, ...report }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ error: error.message, lastRowid: progress.lastRowid }));
  process.exit(1);
}
