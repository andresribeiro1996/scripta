import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

const PATHS = { library: "LIBRARY_DB_PATH", tierlists: "TIERLISTS_DB_PATH", arena: "ARENA_DB_PATH", quizzes: "QUIZZES_DB_PATH", murals: "MURALS_DB_PATH" };
for (const name of ["COVERS_DB_PATH", ...Object.values(PATHS)]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { waitForBnpLock } = await import("../dist/modules/books/seed/bnpImport.js");
const { planBnpRemoval, readRemovalHolds, removeBnpBooks } = await import("../dist/modules/books/seed/bnpRemoval.js");
const { createObjectStore } = await import("../dist/storage/createObjectStore.js");

const readOnly = (name) => new DatabaseSync(process.env[name], { readOnly: true });
const holds = readRemovalHolds(readOnly(PATHS.library), {
  tierlists: readOnly(PATHS.tierlists),
  arena: readOnly(PATHS.arena),
  quizzes: readOnly(PATHS.quizzes),
  murals: readOnly(PATHS.murals)
});
const repo = createSqliteBooksRepository(dryRun ? new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }) : waitForBnpLock(openBooksDb()));
const plan = planBnpRemoval(repo, holds);
const { removable, ...summary } = plan;

if (dryRun) {
  console.log(JSON.stringify({ ...summary, removable: removable.length }, null, 2));
} else {
  const store = createObjectStore();
  const result = await removeBnpBooks({ repo, deleteObject: (key) => store.delete(key), pause: (ms) => sleep(ms), log: (line) => console.error(line) }, removable);
  console.log(JSON.stringify({ selected: plan.selected, kept: plan.kept, ...result }, null, 2));
}
