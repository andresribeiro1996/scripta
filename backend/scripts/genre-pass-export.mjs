import { DatabaseSync } from "node:sqlite";

for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { genrePassWorksWith } = await import("../dist/modules/books/genrePass.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");

const books = createSqliteBooksRepository(new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }));
const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks();
console.log("---BEGIN---");
console.log(JSON.stringify(genrePassWorksWith(books, held)));
console.log("---END---");
