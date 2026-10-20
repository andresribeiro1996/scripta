import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { list: { type: "boolean", default: false }, undo: { type: "string" } } });
if (values.list === (values.undo !== undefined)) {
  console.error("Usage: node scripts/undo-series-merges.mjs --list | --undo <file.json>");
  process.exit(1);
}
if (!process.env.COVERS_DB_PATH) {
  console.error("Missing environment variable: COVERS_DB_PATH");
  process.exit(1);
}

const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");

if (values.list) {
  const { listSeriesCollapses } = await import("../dist/modules/books/seriesMergeRepair.js");
  const repo = createSqliteBooksRepository(new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }));
  console.log(JSON.stringify(listSeriesCollapses(repo), null, 2));
} else {
  const undo = JSON.parse(readFileSync(values.undo, "utf8"))?.undo;
  if (!Array.isArray(undo) || !undo.every((fromWork) => typeof fromWork === "string")) {
    console.error('The file must be {"undo": ["<fromWork>", ...]}.');
    process.exit(1);
  }
  const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
  const { undoReviewedMerges } = await import("../dist/modules/books/seriesMergeRepair.js");
  console.log(JSON.stringify(undoReviewedMerges(createSqliteBooksRepository(openBooksDb()), undo, Date.now), null, 2));
}
