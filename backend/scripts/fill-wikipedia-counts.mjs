import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const USAGE = "Usage: node scripts/fill-wikipedia-counts.mjs [--dry-run] [--out <file>]";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "dry-run": { type: "boolean", default: false }, out: { type: "string" } }
});
if (positionals.length > 0) fail(USAGE);
if (values.out === undefined && !process.env.COVERS_DB_PATH) fail("Missing environment variable: COVERS_DB_PATH");

const { wikipediaSitesFrom } = await import("../dist/modules/books/seed/wikipediaCounts.js");
const { WIKIDATA_PAGE_ROWS, queryAllPages } = await import("../dist/modules/books/adapters/wikidata/sparql.js");

const log = (line) => console.error(line);

const page = (offset) => `
SELECT ?work ?id ?n WHERE {
  ?work wdt:P648 ?id .
  ?work wikibase:sitelinks ?n .
  FILTER(REGEX(?id, "^OL[0-9]+W$"))
}
ORDER BY ?work
LIMIT ${WIKIDATA_PAGE_ROWS} OFFSET ${offset}`;

const bindings = await queryAllPages(page, {
  log,
  onPage: (offset, rows) => log(JSON.stringify({ offset, bindings: rows.length }))
});
const rows = wikipediaSitesFrom(bindings);

if (values.out !== undefined) {
  writeFileSync(values.out, JSON.stringify(Object.fromEntries(rows.map((row) => [row.olWorkKey, row.sites]))));
  console.log(JSON.stringify({ matched: rows.length, out: values.out }, null, 2));
} else {
  if (values["dry-run"]) {
    const db = new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true });
    const held = db.prepare("SELECT COUNT(*) AS n FROM works WHERE ol_work_key IN (SELECT value FROM json_each(?))").get(JSON.stringify(rows.map((row) => row.olWorkKey)));
    console.log(JSON.stringify({ dryRun: true, fetched: rows.length, matched: held.n }, null, 2));
  } else {
    const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
    const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
    const { waitForBnpLock } = await import("../dist/modules/books/seed/bnpImport.js");
    const repo = createSqliteBooksRepository(waitForBnpLock(openBooksDb()));
    console.log(JSON.stringify({ dryRun: false, fetched: rows.length, updated: repo.setWikipediaSites(rows) }, null, 2));
  }
}
