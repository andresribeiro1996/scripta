import { DatabaseSync } from "node:sqlite";
import { createSqliteBooksRepository } from "../../src/modules/books/adapters/sqlite/sqliteBooksRepository.js";

declare const SCORECARD_SCHEMA: string;

type Table = { name: string; sql: string; columns: string[] };

export function readonlyRepo() {
  const path = process.env.COVERS_DB_PATH;
  if (!path) throw new Error("Missing environment variable: COVERS_DB_PATH");
  const db = new DatabaseSync(path, { readOnly: true });
  const live = new Set((db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
  const shims: string[] = [];
  for (const table of JSON.parse(SCORECARD_SCHEMA) as Table[]) {
    if (!live.has(table.name)) {
      if (/_fts_/.test(table.name)) continue;
      db.exec(table.sql.replace(/^CREATE (VIRTUAL )?TABLE/, (_match, virtual: string | undefined) => `CREATE TEMP ${virtual ?? ""}TABLE`));
      shims.push(`table ${table.name}`);
      continue;
    }
    const have = new Set((db.prepare(`SELECT name FROM main.pragma_table_info('${table.name}')`).all() as Array<{ name: string }>).map((row) => row.name));
    const missing = table.columns.filter((column) => !have.has(column));
    if (missing.length === 0) continue;
    db.exec(`CREATE TEMP VIEW ${table.name} AS SELECT rowid AS rowid, *, ${missing.map((column) => `NULL AS ${column}`).join(", ")} FROM main.${table.name}`);
    for (const event of ["INSERT", "UPDATE", "DELETE"]) db.exec(`CREATE TEMP TRIGGER ${table.name}_readonly_${event.toLowerCase()} INSTEAD OF ${event} ON ${table.name} BEGIN SELECT RAISE(ABORT, 'read-only'); END`);
    shims.push(`columns ${table.name}.${missing.join(",")}`);
  }
  console.error(`schema shims: ${shims.join("; ") || "none"}`);
  return { db, repo: createSqliteBooksRepository(db) };
}
