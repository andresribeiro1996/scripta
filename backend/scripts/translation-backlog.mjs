import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { max: { type: "string" }, "dry-run": { type: "boolean", default: false }, "recheck-none": { type: "boolean", default: false } } });
const max = Number(values.max);
if (!Number.isInteger(max) || max <= 0) {
  console.error("Usage: node scripts/translation-backlog.mjs --max N [--dry-run] [--recheck-none]");
  process.exit(1);
}
for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH", "ARENA_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { createSqliteArenaRepository } = await import("../dist/modules/arena/adapters/sqlite/sqliteArenaRepository.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");
const { RECHECK_AFTER_MS, runCodeSteps, runTranslationBacklog, translationBacklogReport, translationBacklogWorks, translationDryRun, TRANSLATION_BACKLOG_SOURCE } = await import("../dist/modules/books/translationBacklog.js");

const repo = createSqliteBooksRepository(openBooksDb());
const arena = createSqliteArenaRepository(new DatabaseSync(process.env.ARENA_DB_PATH, { readOnly: true }));
const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks().map((work) => work.workId);
const recheckBefore = values["recheck-none"] ? new Date(Date.now() - RECHECK_AFTER_MS).toISOString() : null;
const works = translationBacklogWorks(repo, held, recheckBefore);
const { arenaCheck } = await import("../dist/modules/books/translationJudgments.js");
const sharesArena = arenaCheck(repo, (a, b) => arena.worksShareATournament(a, b));

if (values["dry-run"]) {
  console.log(JSON.stringify(translationDryRun(repo, works, max), null, 2));
} else {
  const alert = (subject, text) => console.error(`${subject}: ${text}`);
  const originalTitles = translationDryRun(repo, works, max).originalTitles;
  const steps = runCodeSteps({ repo, classify: async () => { throw new Error("no Jev in the code steps"); }, sharesArena, now: Date.now, alert }, works);
  if (!process.env.TYPESAFE_API_KEY) {
    console.log(JSON.stringify(translationBacklogReport(repo, { steps, asked: [], stoppedBy: "no-key", requests: 0, originalTitles }), null, 2));
    console.error("TYPESAFE_API_KEY is not set: the code steps ran and the Jev step was skipped.");
  } else {
    const { createJevMatchClassifier } = await import("../dist/modules/books/adapters/typesafe/jevWorkMatch.js");
    const { runBudget } = await import("../dist/modules/books/typesafe.js");
    const budget = runBudget(repo, TRANSLATION_BACKLOG_SOURCE, max, Date.now);
    const result = await runTranslationBacklog({ repo, classify: createJevMatchClassifier(process.env.TYPESAFE_API_KEY, budget.spend), sharesArena, now: Date.now, alert }, steps.ask);
    console.log(JSON.stringify(translationBacklogReport(repo, { steps, asked: result.asked, stoppedBy: result.stoppedBy, requests: budget.used(), originalTitles }), null, 2));
  }
}
