import { DatabaseSync } from "node:sqlite";

const dist = `${process.cwd()}/dist/modules`;
const { createThrottle } = await import(`${dist}/books/adapters/http/http.js`);
const { createOpenLibraryCatalog } = await import(`${dist}/books/adapters/openlibrary/openLibraryCatalog.js`);
const { openBooksDb } = await import(`${dist}/books/adapters/sqlite/connection.js`);
const { createSqliteBooksRepository } = await import(`${dist}/books/adapters/sqlite/sqliteBooksRepository.js`);
const { normalizeWorkKey } = await import(`${dist}/books/domain/normalize.js`);
const { createSqliteArenaRepository } = await import(`${dist}/arena/adapters/sqlite/sqliteArenaRepository.js`);
const { saveCatalogHits } = await import(`${dist}/books/saveHits.js`);
const { waitForBnpLock } = await import(`${dist}/books/seed/bnpImport.js`);
const { arenaCheck } = await import(`${dist}/books/translationJudgments.js`);

const REPAIRS = [
  { translation: "OL22485051W", original: "OL5732125W", title: "Picoverse" },
  { translation: "OL31595819W", original: "OL1984734W", title: "Flaubert's Parrot" }
];
const dryRun = process.argv.includes("--dry-run");

const db = dryRun ? new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const repo = createSqliteBooksRepository(waitForBnpLock(db));
const arena = createSqliteArenaRepository(new DatabaseSync(process.env.ARENA_DB_PATH, { readOnly: true }));
const sharesArena = arenaCheck(repo, (a, b) => arena.worksShareATournament(a, b));
const search = createOpenLibraryCatalog(createThrottle(1000), false).search;
const at = new Date().toISOString();

const workOf = (key) => repo.workIdsByWorkKeys([key]).get(key) ?? null;
const report = [];
for (const { translation, original, title } of REPAIRS) {
  const from = workOf(translation);
  if (!from) throw new Error(`no work holds ${translation}`);
  let into = workOf(original);
  let created = null;
  if (!into) {
    const hit = (await search({ text: `key:/works/${original}` })).find((found) => normalizeWorkKey(found.workKey) === original);
    if (!hit) throw new Error(`Open Library has no ${original}`);
    if (hit.result.title !== title) throw new Error(`${original} is "${hit.result.title}", expected "${title}"`);
    if (!dryRun) {
      const [book] = saveCatalogHits({ repo, sharesArena }, [{ ...hit, result: { ...hit.result, isbn: null, publisher: null } }], at);
      if (!book) throw new Error(`saving ${original} returned nothing`);
      created = book.id;
      into = repo.getBook(book.id)?.work_id ?? null;
      if (!into) throw new Error(`saved ${original} has no work`);
    }
  }
  if (from === into) throw new Error(`${translation} and ${original} are already one work`);
  report.push({ translation, original, from, into, created, merged: dryRun ? null : repo.mergeDuplicateWork(from, into, at) });
}
console.log(JSON.stringify({ dryRun, report }, null, 2));
