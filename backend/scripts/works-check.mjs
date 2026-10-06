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

const has = (db, table, column) => columns(db, table).includes(column);
const sharedWork = (table, idColumn) => `SELECT COUNT(*) AS n FROM (SELECT ${idColumn} FROM ${table} WHERE work_id IS NOT NULL GROUP BY ${idColumn}, work_id HAVING COUNT(*) > 1)`;
const e2 = {};

for (const [name, envName, check] of [
  ["arena", "ARENA_DB_PATH", (db) => has(db, "tournament_slots", "book_key") ? {
    foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
    slotsWithoutWork: count(db, "SELECT COUNT(*) AS n FROM tournament_slots WHERE work_id IS NULL AND book_key != ''"),
    emptyKeySlots: count(db, "SELECT COUNT(*) AS n FROM tournament_slots WHERE book_key = ''"),
    duelSidesWithoutWork: count(db, "SELECT COUNT(*) AS n FROM duels WHERE book_a_work_id IS NULL OR book_b_work_id IS NULL"),
    tournamentsSharingWork: count(db, sharedWork("tournament_slots", "tournament_id")),
    duelsSharingWork: count(db, "SELECT COUNT(*) AS n FROM duels WHERE book_a_work_id = book_b_work_id"),
    votesOnNeitherSide: count(db, "SELECT COUNT(*) AS n FROM votes AS v JOIN duels AS d ON d.id = v.duel_id WHERE v.book_key NOT IN (d.book_a_key, d.book_b_key)"),
    winnersOnNeitherSide: count(db, "SELECT COUNT(*) AS n FROM duels WHERE winner_key IS NOT NULL AND winner_key NOT IN (book_a_key, book_b_key)")
  } : "migrated"],
  ["tierlists", "TIERLISTS_DB_PATH", (db) => has(db, "tierlist_works", "key") ? {
    foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
    entriesWithoutWork: count(db, `SELECT COUNT(*) AS n FROM (
      SELECT t.id, p.value AS key FROM tierlists AS t, json_each(t.data, '$.pool') AS p
      UNION ALL
      SELECT t.id, k.value FROM tierlists AS t, json_each(t.data, '$.tiers') AS tr, json_each(tr.value, '$.bookKeys') AS k
    ) AS e WHERE NOT EXISTS (SELECT 1 FROM tierlist_works AS w WHERE w.tierlist_id = e.id AND w.key = e.key AND w.work_id IS NOT NULL)`),
    placementsWithoutWork: count(db, "SELECT COUNT(*) AS n FROM tierlist_ballot_placements WHERE work_id IS NULL"),
    listsSharingWork: count(db, sharedWork("tierlist_works", "tierlist_id")),
    snapshotMismatches: count(db, "SELECT COUNT(*) AS n FROM tierlists WHERE public_books IS NOT NULL AND json_array_length(public_books) != json_array_length(data, '$.pool')")
  } : "migrated"],
  ["quizzes", "QUIZZES_DB_PATH", (db) => has(db, "quiz_works", "key") ? {
    foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
    booksWithoutWork: count(db, `SELECT COUNT(*) AS n FROM quizzes AS q, json_each(q.data, '$.books') AS b
      WHERE NOT EXISTS (SELECT 1 FROM quiz_works AS w WHERE w.quiz_id = q.id AND w.key = json_extract(b.value, '$.key') AND w.work_id IS NOT NULL)`),
    quizzesSharingWork: count(db, sharedWork("quiz_works", "quiz_id"))
  } : "migrated"]
]) {
  const path = process.env[envName];
  if (!path) {
    e2[name] = "no path";
    continue;
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    e2[name] = check(db);
  } finally {
    db.close();
  }
}
report.e2 = e2;

console.log(JSON.stringify(report, null, 2));
