import { catalogHits } from "../../src/modules/books/catalogSearch.js";
import { searchTokens } from "../../src/modules/books/domain/normalize.js";
import { readonlyRepo } from "./readonlyRepo.js";

const queries = process.argv.slice(2);
if (queries.length === 0) {
  console.error("Usage: orders.mjs <query> [query…]");
  process.exit(1);
}
const { repo } = readonlyRepo();
for (const q of queries) {
  for (const byWork of [true, false]) {
    console.log(`## ${q} (${byWork ? "by work" : "by edition"})`);
    catalogHits(repo, searchTokens(q), byWork).forEach(({ row, workId }, index) => console.log(`${index + 1}. ${row.title} — ${row.author} [${row.isbn ?? "no isbn"}] ${workId ?? ""}`));
  }
}
