import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    eng: { type: "string", default: "35000" },
    por: { type: "string", default: "5000" },
    status: { type: "boolean", default: false }
  }
});

const CHUNK = 500;
const log = (line) => console.log(line);

function printStatus() {
  if (!process.env.COVERS_DB_PATH) {
    console.error("Missing environment variable: COVERS_DB_PATH");
    process.exit(1);
  }
  const db = new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true });
  const rows = db.prepare("SELECT cover_status AS status, COUNT(*) AS n FROM books GROUP BY cover_status").all();
  const counts = Object.fromEntries(rows.map((row) => [row.status ?? "null", row.n]));
  const total = rows.reduce((sum, row) => sum + row.n, 0);
  const withImage = db.prepare("SELECT COUNT(*) AS n FROM books WHERE cover_image_id IS NOT NULL").get().n;
  const portugalRows = db.prepare("SELECT cover_status AS status, COUNT(*) AS n FROM books WHERE isbn LIKE '978972%' OR isbn LIKE '978989%' GROUP BY cover_status").all();
  const portugal = { total: portugalRows.reduce((sum, row) => sum + row.n, 0), good: 0, low_res: 0, missing: 0, manual: 0, null: 0, ...Object.fromEntries(portugalRows.map((row) => [row.status ?? "null", row.n])) };
  log(JSON.stringify({ total, null: 0, good: 0, low_res: 0, missing: 0, manual: 0, ...counts, withImage, portugal }));
  db.close();
}

async function seed() {
  const counts = { eng: Number(values.eng), por: Number(values.por) };
  for (const [flag, count] of Object.entries(counts)) {
    if (!Number.isFinite(count) || count < 0) {
      console.error(`--${flag} must be a non-negative number, got "${values[flag]}"`);
      process.exit(1);
    }
  }
  const { collectRanked } = await import("../dist/modules/books/seed/fetchRankedWorks.js");
  const { mergeSeedLists } = await import("../dist/modules/books/seed/seedList.js");
  const { seedCatalog } = await import("../dist/modules/books/seed/seedCatalog.js");
  const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
  const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");

  const merged = mergeSeedLists(await collectRanked("por", counts.por, log), await collectRanked("eng", counts.eng, log), counts);
  log(`list ready: ${merged.length} entries`);

  const repo = createSqliteBooksRepository(openBooksDb());
  const total = { created: 0, existing: 0, invalid: 0 };
  for (let start = 0; start < merged.length; start += CHUNK) {
    const result = seedCatalog(merged.slice(start, start + CHUNK), repo, () => new Date());
    for (const key of Object.keys(total)) total[key] += result[key];
    log(`${Math.min(start + CHUNK, merged.length)}/${merged.length} ${JSON.stringify(total)}`);
  }
  log(JSON.stringify(total));
}

if (values.status) printStatus();
else await seed();
