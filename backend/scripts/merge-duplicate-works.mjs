import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, apply: { type: "boolean", default: false } } });
if (values["dry-run"] === values.apply) {
  console.error("Usage: node scripts/merge-duplicate-works.mjs --dry-run | --apply");
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
const { walkDuplicateWorks } = await import("../dist/modules/books/duplicateWorks.js");
const { arenaCheck } = await import("../dist/modules/books/translationJudgments.js");

const dryRun = values["dry-run"];
const db = dryRun ? new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
if (!dryRun) db.exec("PRAGMA busy_timeout = 120000");
const repo = createSqliteBooksRepository(db);
const arena = createSqliteArenaRepository(new DatabaseSync(process.env.ARENA_DB_PATH, { readOnly: true }));
const heldIds = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks().map((work) => work.workId);
const liveIds = repo.canonicalWorkIds(heldIds);
const held = new Set(heldIds.map((id) => liveIds.get(id) ?? id));

const describe = (from, into) => {
  const works = new Map(repo.matchCandidates([from, into]).map((work) => [work.id, work]));
  return { held: held.has(from) || held.has(into), from: works.get(from), into: works.get(into) };
};

const before = new Map();
const recording = {
  ...repo,
  mergeDuplicateWork: (from, into, at) => {
    before.set(from, describe(from, into));
    return repo.mergeDuplicateWork(from, into, at);
  }
};
const report = await walkDuplicateWorks(
  { repo: recording, sharesArena: arenaCheck(repo, (a, b) => arena.worksShareATournament(a, b)), now: Date.now },
  dryRun ? { dryRun } : { dryRun, pageSize: 100, pauseMs: 250 }
);

console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "apply", merges: report.merges.length, undone: report.undone, arena: report.arena, gone: report.gone }));
console.log(JSON.stringify(report.merges.map(({ titleKey, from, into }) => ({ titleKey, ...(before.get(from) ?? describe(from, into)) })), null, 2));
