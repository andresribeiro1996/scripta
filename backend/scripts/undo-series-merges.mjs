import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { list: { type: "boolean", default: false }, guarded: { type: "boolean", default: false }, undo: { type: "string" } } });
if (Number(values.list) + Number(values.guarded) + Number(values.undo !== undefined) !== 1) {
  console.error("Usage: node scripts/undo-series-merges.mjs --list | --guarded | --undo <file.json>");
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
} else if (values.guarded) {
  const { listGuardedMerges } = await import("../dist/modules/books/seriesMergeRepair.js");
  const repo = createSqliteBooksRepository(new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }));
  const result = listGuardedMerges(repo);
  console.error(`checked ${result.checked}, skipped ${result.skipped.length}, flagged ${result.flagged.length}`);
  console.log(JSON.stringify(result));
} else {
  const file = JSON.parse(readFileSync(values.undo, "utf8"));
  const { undo, undoManual = [], dropSeries = [], addSeries = [] } = file ?? {};
  const { SERIES_SOURCES } = await import("../dist/modules/books/domain/series.js");
  const rowOf = (row, fields) => row !== null && typeof row === "object" && typeof row.workId === "string" && typeof row.name === "string" && SERIES_SOURCES.includes(row.source) && fields.every((field) => row[field] === null || typeof row[field] === "string");
  if (!Array.isArray(undo) || !undo.every((fromWork) => typeof fromWork === "string") || !Array.isArray(undoManual) || !undoManual.every((fromWork) => typeof fromWork === "string") || !Array.isArray(dropSeries) || !dropSeries.every((row) => rowOf(row, [])) || !Array.isArray(addSeries) || !addSeries.every((row) => rowOf(row, ["position"]) && "position" in row)) {
    console.error('The file must be {"undo": ["<fromWork>", ...], "undoManual": ["<fromWork>", ...] (optional), "dropSeries": [{"workId", "name", "source"}], "addSeries": [{"workId", "name", "position", "source"}]}.');
    process.exit(1);
  }
  const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
  const { undoReviewedMerges, dropSeriesRows, addSeriesRows } = await import("../dist/modules/books/seriesMergeRepair.js");
  const repo = createSqliteBooksRepository(openBooksDb());
  const result = undoReviewedMerges(repo, undo, Date.now, (fromWork) => console.error(`undone ${fromWork}`), undoManual);
  if (result.failures.length > 0) {
    console.error("Series edits were skipped because some undos failed.");
    console.log(JSON.stringify({ ...result, dropped: 0, added: 0 }, null, 2));
    process.exit(1);
  }
  const dropped = dropSeriesRows(repo, dropSeries);
  const added = addSeriesRows(repo, addSeries, new Date().toISOString());
  console.log(JSON.stringify({ ...result, dropped, added }, null, 2));
}
