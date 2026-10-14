import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/genre-pass-import.mjs <labels.json>");
  process.exit(1);
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { importGenreLabelsWith } = await import("../dist/modules/books/genrePass.js");

const report = importGenreLabelsWith(createSqliteBooksRepository(openBooksDb()), JSON.parse(readFileSync(file, "utf8")));
console.log(JSON.stringify(report, null, 2));
