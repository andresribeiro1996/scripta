import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

const { env } = await import("../dist/config/env.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { reportJson } = await import("../dist/modules/books/seed/mojibakeRepair.js");
const { applySummaryCleanup, planSummaryCleanup, summaryCleanupReport } = await import("../dist/modules/books/seed/summaryCleanup.js");

const db = dryRun ? new DatabaseSync(env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const plan = planSummaryCleanup(db);
let applied = null;
try {
  if (!dryRun) applied = applySummaryCleanup(db, plan);
} finally {
  console.log(reportJson(summaryCleanupReport(plan, applied, dryRun)));
}
