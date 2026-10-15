import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { task: { type: "string" }, n: { type: "string", default: "200" } } });
const { TASKS, synopsisSample } = await import("../dist/modules/books/calibration.js");
const n = Number(values.n);
if (!TASKS.includes(values.task) || !Number.isInteger(n) || n <= 0) {
  console.error(`Usage: node scripts/jev-calibration-export.mjs --task ${TASKS.join("|")} [--n 200]`);
  process.exit(1);
}
if (!process.env.COVERS_DB_PATH) {
  console.error("Missing environment variable: COVERS_DB_PATH");
  process.exit(1);
}

const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const books = createSqliteBooksRepository(new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }));
console.log("---BEGIN---");
console.log(JSON.stringify(synopsisSample(books, n)));
console.log("---END---");
