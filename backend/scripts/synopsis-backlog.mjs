import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { max: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
const max = Number(values.max);
if (!Number.isInteger(max) || max <= 0) {
  console.error("Usage: node scripts/synopsis-backlog.mjs --max N [--dry-run]");
  process.exit(1);
}
for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");
const { applyRulePass, runSynopsisBacklog, synopsisBacklogReport, synopsisBacklogTexts, synopsisDryRun, SYNOPSIS_BACKLOG_SOURCE } = await import("../dist/modules/books/synopsisBacklog.js");

const repo = createSqliteBooksRepository(openBooksDb());
const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks().map((work) => work.workId);
const texts = synopsisBacklogTexts(repo, held);

if (values["dry-run"]) {
  console.log(JSON.stringify(synopsisDryRun(repo, texts, max), null, 2));
} else {
  const remaining = applyRulePass(repo, texts, new Date().toISOString());
  if (!process.env.TYPESAFE_API_KEY) {
    console.log(JSON.stringify(synopsisBacklogReport(repo, texts, "no-key", 0), null, 2));
    console.error("TYPESAFE_API_KEY is not set: the rule pass ran and the Jev pass was skipped.");
  } else {
    const { createJevSynopsisClassifier } = await import("../dist/modules/books/adapters/typesafe/jevSynopsis.js");
    const { runBudget } = await import("../dist/modules/books/typesafe.js");
    const budget = runBudget(repo, SYNOPSIS_BACKLOG_SOURCE, max, Date.now);
    const result = await runSynopsisBacklog(
      { repo, classify: createJevSynopsisClassifier(process.env.TYPESAFE_API_KEY, budget.spend), now: Date.now, alert: (subject, text) => console.error(`${subject}: ${text}`) },
      remaining.map((text) => text.hash)
    );
    console.log(JSON.stringify(synopsisBacklogReport(repo, texts, result.stoppedBy, budget.used()), null, 2));
  }
}
