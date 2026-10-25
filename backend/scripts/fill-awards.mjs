import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const USAGE = "Usage: node scripts/fill-awards.mjs [--dry-run]";

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let values;
try {
  ({ values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } }));
} catch (error) {
  if (!error.code?.startsWith("ERR_PARSE_ARGS_")) throw error;
  fail(`${error.message}\n${USAGE}`);
}
if (!process.env.COVERS_DB_PATH) fail("Missing environment variable: COVERS_DB_PATH");

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { queryAllPages, queryWikidata } = await import("../dist/modules/books/adapters/wikidata/sparql.js");
const { PRIZE_ITEMS } = await import("../dist/modules/books/domain/awards.js");
const { awardQueries, awardRowsOf, fillAwards, honoreeLabels, itemOf } = await import("../dist/modules/books/seed/awardsFill.js");
const { waitForBnpLock } = await import("../dist/modules/books/seed/bnpImport.js");
const { createWorkFetcher } = await import("../dist/modules/books/seed/wikidataMatch.js");

const dryRun = values["dry-run"];
const at = new Date().toISOString();
const log = (line) => console.error(line);

async function prizeLabels() {
  const items = Object.values(PRIZE_ITEMS).map((id) => `wd:${id}`).join(" ");
  const bindings = await queryWikidata(`SELECT ?item ?label WHERE { VALUES ?item { ${items} } ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }`, { log });
  return new Map(bindings.map((binding) => [itemOf(binding.item.value), binding.label.value]));
}

const db = dryRun ? new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const repo = createSqliteBooksRepository(waitForBnpLock(db));

const labels = await prizeLabels();
const bindings = [];
let pages = 0;
for (const { kind, page } of awardQueries()) {
  bindings.push(
    ...(await queryAllPages(page, {
      log,
      onPage: (offset, found) => {
        pages++;
        log(JSON.stringify({ kind, offset, bindings: found.length }));
      }
    }))
  );
}
const { rows, noYear } = awardRowsOf(bindings, await honoreeLabels((text) => queryWikidata(text, { log }), bindings));
const { matched, added, redirected, failedKeys, prizes } = await fillAwards(repo, createWorkFetcher({ log }), rows, at, { dryRun });
console.log(
  JSON.stringify(
    {
      dryRun,
      prizes: Object.entries(prizes).map(([key, tally]) => ({ key, item: PRIZE_ITEMS[key], label: labels.get(PRIZE_ITEMS[key]) ?? null, ...tally })),
      noYear,
      pages,
      rows: rows.length,
      matched,
      added,
      redirected,
      failedKeys
    },
    null,
    2
  )
);
