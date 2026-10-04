import { DatabaseSync } from "node:sqlite";

const report = {};
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
const count = (db, sql) => db.prepare(sql).get().n;

function section(name, path, check) {
  if (!path) return void (report[name] = "no path");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    report[name] = check(db);
  } finally {
    db.close();
  }
}

section("covers", process.env.COVERS_DB_PATH, (db) => columns(db, "works").length > 0 ? {
  userVersion: db.prepare("PRAGMA user_version").get().user_version,
  works: count(db, "SELECT COUNT(*) AS n FROM works"),
  mergedWorks: count(db, "SELECT COUNT(*) AS n FROM works WHERE merged_into IS NOT NULL"),
  isbn10KeysWithoutIsbn13: count(db, "SELECT COUNT(*) AS n FROM book_keys AS k JOIN books AS b ON b.id = k.book_id WHERE k.key LIKE 'isbn:%' AND length(k.key) = 15 AND (b.isbn IS NULL OR length(b.isbn) = 10)")
} : "works not deployed");

section("library", process.env.LIBRARY_DB_PATH, (db) => columns(db, "library_books").includes("work_id") ? {
  rows: count(db, "SELECT COUNT(*) AS n FROM library_books"),
  nullWithIdentity: count(db, "SELECT COUNT(*) AS n FROM library_books WHERE work_id IS NULL AND (isbn IS NOT NULL OR title IS NOT NULL)"),
  nullWithoutIdentity: count(db, "SELECT COUNT(*) AS n FROM library_books WHERE work_id IS NULL AND isbn IS NULL AND title IS NULL")
} : "work_id not deployed");

section("arena", process.env.ARENA_DB_PATH, (db) => columns(db, "tournament_slots").includes("work_id") ? {
  slotsNull: count(db, "SELECT COUNT(*) AS n FROM tournament_slots WHERE work_id IS NULL AND book_key != ''"),
  duelSidesNull: count(db, "SELECT COUNT(*) AS n FROM duels WHERE book_a_work_id IS NULL OR book_b_work_id IS NULL"),
  winnersNull: count(db, "SELECT COUNT(*) AS n FROM duels WHERE winner_key IS NOT NULL AND winner_work_id IS NULL")
} : "not deployed");

for (const [name, envName, table, item, idColumn] of [
  ["tierlists", "TIERLISTS_DB_PATH", "tierlist_works", "tierlists", "tierlist_id"],
  ["quizzes", "QUIZZES_DB_PATH", "quiz_works", "quizzes", "quiz_id"],
  ["murals", "MURALS_DB_PATH", "mural_works", "murals", "mural_id"]
]) {
  section(name, process.env[envName], (db) => columns(db, table).length > 0 ? {
    itemsWithoutRows: count(db, `SELECT COUNT(*) AS n FROM ${item} WHERE NOT EXISTS (SELECT 1 FROM ${table} AS w WHERE w.${idColumn} = ${item}.id)`),
    rowsNull: count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE work_id IS NULL`),
    ...(name === "tierlists" ? { placementsNull: count(db, "SELECT COUNT(*) AS n FROM tierlist_ballot_placements WHERE work_id IS NULL") } : {})
  } : "not deployed");
}

console.log(JSON.stringify(report, null, 2));
