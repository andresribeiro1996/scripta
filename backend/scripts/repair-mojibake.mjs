import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

const { env } = await import("../dist/config/env.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { applyMojibakeRepairs, mojibakeReport, planMojibakeRepairs } = await import("../dist/modules/books/seed/mojibakeRepair.js");

const db = dryRun ? new DatabaseSync(env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const plan = planMojibakeRepairs(db);
console.log(JSON.stringify(mojibakeReport(plan, dryRun ? null : applyMojibakeRepairs(db, plan)), null, 2));
