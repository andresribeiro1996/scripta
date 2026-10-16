import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { max: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
const max = Number(values.max);
if (!Number.isInteger(max) || max <= 0) {
  console.error("Usage: node scripts/genre-backlog.mjs --max N [--dry-run]");
  process.exit(1);
}
for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}
if (!values["dry-run"] && !process.env.TYPESAFE_API_KEY) {
  console.error("TYPESAFE_API_KEY is not set.");
  process.exit(1);
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");
const { backlogReport, backlogWorkIds, GENRE_BACKLOG_SOURCE, runGenreBacklog } = await import("../dist/modules/books/genreBacklog.js");

const repo = createSqliteBooksRepository(openBooksDb());
const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks().map((work) => work.workId);

if (values["dry-run"]) {
  const qualifying = backlogWorkIds(repo, held, Number.MAX_SAFE_INTEGER).length;
  console.log(JSON.stringify({ qualifying, wouldAsk: Math.min(qualifying, max), max }, null, 2));
} else {
  const { createJevGenreClassifier } = await import("../dist/modules/books/adapters/typesafe/jevGenres.js");
  const { runBudget } = await import("../dist/modules/books/typesafe.js");
  const workIds = backlogWorkIds(repo, held, max);
  const budget = runBudget(repo, GENRE_BACKLOG_SOURCE, max, Date.now);
  const result = await runGenreBacklog(
    { repo, classify: createJevGenreClassifier(process.env.TYPESAFE_API_KEY, budget.spend), now: Date.now, alert: (subject, text) => console.error(`${subject}: ${text}`) },
    workIds
  );
  console.log(JSON.stringify(backlogReport(repo, workIds.length, result, budget.used()), null, 2));
}
