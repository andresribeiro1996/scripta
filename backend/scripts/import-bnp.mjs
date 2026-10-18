import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import sharp from "sharp";

sharp.cache(false);
sharp.concurrency(1);

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, from: { type: "string", default: "2000-01-01" }, until: { type: "string" } } });

const { env } = await import("../dist/config/env.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { fetchBnpScan, importBnp, utcDate } = await import("../dist/modules/books/seed/bnpImport.js");
const { fetchText } = await import("../dist/modules/books/seed/siteFetch.js");
const { createObjectStore } = await import("../dist/storage/createObjectStore.js");

const dryRun = values["dry-run"];
const from = values.from;
const until = values.until ?? utcDate(new Date());

for (const [name, value] of [["--from", from], ["--until", until]]) {
  const at = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(at.getTime()) || utcDate(at) !== value) {
    console.error(`${name} must be a date as YYYY-MM-DD, got "${value}"`);
    process.exit(1);
  }
}
if (from > until) {
  console.error(`--from ${from} is after --until ${until}`);
  process.exit(1);
}

const store = createObjectStore();
const report = await importBnp(
  {
    repo: createSqliteBooksRepository(dryRun ? new DatabaseSync(env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb()),
    blobs: dryRun
      ? {
          save: () => {
            throw new Error("dry run");
          }
        }
      : { save: (id, extension, bytes) => store.put(`covers/${id}.${extension}`, bytes, "image/webp") },
    fetchScan: fetchBnpScan,
    fetchText,
    now: () => new Date(),
    log: (line) => console.log(line, `rss=${Math.round(process.memoryUsage().rss / 1e6)}MB`)
  },
  { from, until, dryRun, cursorOnSuccess: values.until === undefined }
);
console.log(JSON.stringify(report));
