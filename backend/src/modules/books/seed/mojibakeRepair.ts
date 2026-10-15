import type { DatabaseSync } from "node:sqlite";
import { hasMojibake, repairMojibake } from "@scripta/shared";
import { workTitleKey } from "../domain/normalize.js";

export interface RowRepair {
  id: string;
  title: string;
  author: string;
  repairedTitle: string;
  repairedAuthor: string;
}

export interface BookRepair extends RowRepair {
  origin: string;
}

export interface MojibakePlan {
  scanned: { books: number; works: number };
  books: BookRepair[];
  works: RowRepair[];
  stillBroken: Array<{ id: string; title: string; author: string }>;
}

export interface MojibakeApplied {
  books: number;
  works: number;
  skipped: number;
}

interface WorkScan {
  id: string;
  title: string;
  author: string;
}

interface BookScan extends WorkScan {
  created_by: string | null;
  data_sources: string;
}

const repairRow = ({ id, title, author }: WorkScan): RowRepair => ({ id, title, author, repairedTitle: repairMojibake(title), repairedAuthor: repairMojibake(author) });
const isChanged = (row: RowRepair) => row.repairedTitle !== row.title || row.repairedAuthor !== row.author;
const originOf = (row: BookScan) => row.created_by ?? ((JSON.parse(row.data_sources) as string[]).join("+") || "lookup");

export function planMojibakeRepairs(db: DatabaseSync): MojibakePlan {
  const plan: MojibakePlan = { scanned: { books: 0, works: 0 }, books: [], works: [], stillBroken: [] };
  for (const row of db.prepare("SELECT id, title, author, created_by, data_sources FROM books").iterate() as Iterable<BookScan>) {
    plan.scanned.books++;
    const repair = repairRow(row);
    if (isChanged(repair)) plan.books.push({ ...repair, origin: originOf(row) });
    if (hasMojibake(repair.repairedTitle) || hasMojibake(repair.repairedAuthor)) plan.stillBroken.push({ id: row.id, title: repair.repairedTitle, author: repair.repairedAuthor });
  }
  for (const row of db.prepare("SELECT id, title, author FROM works").iterate() as Iterable<WorkScan>) {
    plan.scanned.works++;
    const repair = repairRow(row);
    if (isChanged(repair)) plan.works.push(repair);
  }
  return plan;
}

export function applyMojibakeRepairs(db: DatabaseSync, plan: MojibakePlan): MojibakeApplied {
  const applied: MojibakeApplied = { books: 0, works: 0, skipped: 0 };
  const updateBook = db.prepare("UPDATE books SET title = ?, author = ?, title_key = ? WHERE id = ? AND title = ? AND author = ?");
  const addKey = db.prepare("INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)");
  const refreshSearch = db.prepare("UPDATE books_fts SET title = ?, author = ? WHERE book_id = ?");
  const updateWork = db.prepare("UPDATE works SET title = ?, author = ? WHERE id = ? AND title = ? AND author = ?");
  for (const book of plan.books) {
    const titleKey = workTitleKey(book.repairedTitle, book.repairedAuthor);
    let changed: number | bigint;
    db.exec("BEGIN IMMEDIATE");
    try {
      changed = updateBook.run(book.repairedTitle, book.repairedAuthor, book.repairedTitle ? titleKey : null, book.id, book.title, book.author).changes;
      if (changed !== 0) {
        if (titleKey) addKey.run(titleKey, book.id);
        refreshSearch.run(book.repairedTitle, book.repairedAuthor, book.id);
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

export function mojibakeReport(plan: MojibakePlan, applied: MojibakeApplied | null) {
  const origins: Record<string, number> = {};
  for (const { origin } of plan.books) origins[origin] = (origins[origin] ?? 0) + 1;
  return {
    dryRun: applied === null,
    books: {
      scanned: plan.scanned.books,
      repaired: plan.books.length,
      titles: plan.books.filter((book) => book.repairedTitle !== book.title).length,
      authors: plan.books.filter((book) => book.repairedAuthor !== book.author).length
    },
    works: { scanned: plan.scanned.works, repaired: plan.works.length },
    origins,
    examples: plan.books.slice(0, 20).map((book) => ({ id: book.id, from: `${book.title} — ${book.author}`, to: `${book.repairedTitle} — ${book.repairedAuthor}` })),
    stillBroken: { count: plan.stillBroken.length, examples: plan.stillBroken.slice(0, 10).map((book) => `${book.title} — ${book.author}`) },
    applied
  };
}
