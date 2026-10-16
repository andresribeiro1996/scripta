import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { scope: { type: "string", default: "held" } } });
if (values.scope !== "held" && values.scope !== "catalog") {
  console.error(`Unknown --scope: ${values.scope} (use held or catalog)`);
  process.exit(1);
}

for (const name of ["COVERS_DB_PATH", "LIBRARY_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { catalogDoubtsWith, genrePassWorksWith } = await import("../dist/modules/books/genrePass.js");
const { createWorkHolders } = await import("../dist/modules/library/workHolders.js");

const books = createSqliteBooksRepository(new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true }));
const held = createWorkHolders(new DatabaseSync(process.env.LIBRARY_DB_PATH, { readOnly: true })).heldWorks();
console.log("---BEGIN---");
console.log(JSON.stringify(values.scope === "catalog" ? catalogDoubtsWith(books, held) : genrePassWorksWith(books, held)));
console.log("---END---");
