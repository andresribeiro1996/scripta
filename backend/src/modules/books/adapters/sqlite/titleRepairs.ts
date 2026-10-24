import type { DatabaseSync } from "node:sqlite";
import { catalogTitleKey, workTitleKey } from "../../domain/normalize.js";
import type { MojibakeApplied, RowRepair } from "../../domain/types.js";

export function applyMojibakeRepairs(db: DatabaseSync, plan: { books: RowRepair[]; works: RowRepair[] }): MojibakeApplied {
  const applied: MojibakeApplied = { books: 0, works: 0, skipped: 0 };
  const searchRows = db.prepare("SELECT book_id, rowid FROM books_fts WHERE book_id IN (SELECT value FROM json_each(?))").all(JSON.stringify(plan.books.map((book) => book.id))) as Array<{ book_id: string; rowid: number }>;
  const searchRowids = new Map(searchRows.map((row) => [row.book_id, row.rowid]));
  const updateBook = db.prepare("UPDATE books SET title = ?, author = ?, title_key = ? WHERE id = ? AND title = ? AND author = ?");
  const holdsKey = db.prepare("SELECT 1 FROM book_keys WHERE key = ? AND book_id = ?");
  const addKey = db.prepare("INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)");
  const refreshSearch = db.prepare("UPDATE books_fts SET title = ?, author = ? WHERE rowid = ? AND book_id = ?");
  const updateWork = db.prepare("UPDATE works SET title = ?, author = ? WHERE id = ? AND title = ? AND author = ?");
  for (const book of plan.books) {
    const titleKey = book.repairedTitle ? workTitleKey(book.repairedTitle, book.repairedAuthor) : null;
    const oldKey = catalogTitleKey(book.title, book.author);
    const newKey = catalogTitleKey(book.repairedTitle, book.repairedAuthor);
    const searchRowid = searchRowids.get(book.id);
    let changed: number | bigint;
    db.exec("BEGIN IMMEDIATE");
    try {
      changed = updateBook.run(book.repairedTitle, book.repairedAuthor, titleKey, book.id, book.title, book.author).changes;
      if (changed !== 0) {
        if (oldKey && newKey && holdsKey.get(oldKey, book.id)) addKey.run(newKey, book.id);
        if (searchRowid !== undefined) refreshSearch.run(book.repairedTitle, book.repairedAuthor, searchRowid, book.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
    if (changed === 0) applied.skipped++;
    else applied.books++;
  }
  for (const work of plan.works) {
    if (updateWork.run(work.repairedTitle, work.repairedAuthor, work.id, work.title, work.author).changes === 0) applied.skipped++;
    else applied.works++;
  }
  return applied;
}
