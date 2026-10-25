import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error("Usage: npx tsx backend/scripts/search-scorecard/bundle.ts <entry.ts> <out.mjs>");
  process.exit(1);
}
const scratch = mkdtempSync(join(tmpdir(), "scorecard-"));
Object.assign(process.env, {
  AUTH_DB_PATH: join(scratch, "auth.sqlite"),
  LIBRARY_DB_PATH: join(scratch, "library.sqlite"),
  GALLERY_DB_PATH: join(scratch, "gallery.sqlite"),
  COVERS_DB_PATH: join(scratch, "covers.sqlite"),
  JWT_ACCESS_SECRET: "a".repeat(64),
  JWT_REFRESH_SECRET: "b".repeat(64)
});
const { applyBooksMigrations } = await import("../../src/modules/books/adapters/sqlite/connection.js");
const reference = new DatabaseSync(":memory:");
applyBooksMigrations(reference);
const schema = (reference.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL ORDER BY rowid").all() as Array<{ name: string; sql: string }>).map(({ name, sql }) => ({
  name,
  sql,
  columns: (reference.prepare(`SELECT name FROM pragma_table_info('${name}')`).all() as Array<{ name: string }>).map((row) => row.name)
}));
await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", target: "node24", outfile, logLevel: "warning", define: { SCORECARD_SCHEMA: JSON.stringify(JSON.stringify(schema)) } });
console.error(`bundled ${outfile} (${schema.length} tables in the reference schema)`);
