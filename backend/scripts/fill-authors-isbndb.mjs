import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, max: { type: "string" }, after: { type: "string", default: "" } } });
const max = Number(values.max);
if (!Number.isInteger(max) || max < 0) {
  console.error("Usage: node scripts/fill-authors-isbndb.mjs --max N [--after <book id>] [--dry-run]");
  process.exit(1);
}
const dryRun = values["dry-run"];

const ISBNDB_GAP_MS = 1100;

const { env, isbndbConfigured } = await import("../dist/config/env.js");
if (!isbndbConfigured) {
  console.error("ISBNDB_API_KEY is not set.");
  process.exit(1);
}
const { createThrottle } = await import("../dist/modules/books/adapters/http/http.js");
const { createIsbndbBudget, ISBNDB_DAILY_QUOTA, ISBNDB_SEARCH_RESERVE } = await import("../dist/modules/books/adapters/isbndb/isbndbBudget.js");
const { createIsbndbCatalog } = await import("../dist/modules/books/adapters/isbndb/isbndbCatalog.js");
const { createIsbndbGate } = await import("../dist/modules/books/adapters/isbndb/isbndbGate.js");
const { openSqlite } = await import("../dist/db/openSqlite.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { applyIsbndbAuthors, isbndbAuthorReport, planIsbndbAuthors } = await import("../dist/modules/books/seed/isbndbAuthors.js");

const gate = createIsbndbGate({ onPause: ({ reason, until }) => console.error(`ISBNdb paused (${reason}) until ${new Date(until).toISOString()}`) });
const db = dryRun ? new DatabaseSync(env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const repo = createSqliteBooksRepository(dryRun ? openSqlite(env.COVERS_DB_PATH) : db);
const spend = createIsbndbBudget(repo, ISBNDB_DAILY_QUOTA - ISBNDB_SEARCH_RESERVE, console.error);
const isbndb = createIsbndbCatalog(env.ISBNDB_API_KEY, createThrottle(ISBNDB_GAP_MS), gate, false, { details: spend, search: spend });
const plan = await planIsbndbAuthors(db, isbndb, { max, after: values.after });
const applied = dryRun ? null : applyIsbndbAuthors(repo, plan);
console.log(JSON.stringify(isbndbAuthorReport(plan, applied), null, 2));
