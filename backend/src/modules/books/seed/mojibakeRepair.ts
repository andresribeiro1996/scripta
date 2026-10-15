import type { DatabaseSync } from "node:sqlite";
import { cleanCatalogText, hasMojibake, repairMojibake } from "@scripta/shared";
import { catalogTitleKey, givenNameFirst, workTitleKey } from "../domain/normalize.js";

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
  work_id: string | null;
  created_by: string | null;
  data_sources: string;
}

const repairRow = ({ id, title, author }: WorkScan): RowRepair => ({ id, title, author, repairedTitle: cleanCatalogText(title), repairedAuthor: cleanCatalogText(author) });
const isChanged = (row: RowRepair) => row.repairedTitle !== row.title || row.repairedAuthor !== row.author;
const originOf = (row: BookScan) => row.created_by ?? ((JSON.parse(row.data_sources) as string[]).join("+") || "lookup");
const createdByIsbndbSearch = (row: BookScan) => row.created_by === null && (JSON.parse(row.data_sources) as string[])[0] === "isbndb";
const strippedMarkers = (text: string) => cleanCatalogText(text) !== repairMojibake(text);

export function planMojibakeRepairs(db: DatabaseSync): MojibakePlan {
  const plan: MojibakePlan = { scanned: { books: 0, works: 0 }, books: [], works: [], stillBroken: [] };
  const turnedAuthors = new Map<string, string[]>();
  for (const row of db.prepare("SELECT id, title, author, work_id, created_by, data_sources FROM books").iterate() as Iterable<BookScan>) {
    plan.scanned.books++;
    const repair = repairRow(row);
    const turned = givenNameFirst(repair.repairedAuthor);
    if (turned !== repair.repairedAuthor && createdByIsbndbSearch(row)) {
      if (row.work_id) turnedAuthors.set(row.work_id, [...(turnedAuthors.get(row.work_id) ?? []), repair.repairedAuthor]);
      repair.repairedAuthor = turned;
    }
    if (isChanged(repair)) plan.books.push({ ...repair, origin: originOf(row) });
    if (hasMojibake(repair.repairedTitle) || hasMojibake(repair.repairedAuthor)) plan.stillBroken.push({ id: row.id, title: repair.repairedTitle, author: repair.repairedAuthor });
  }
  for (const row of db.prepare("SELECT id, title, author FROM works").iterate() as Iterable<WorkScan>) {
    plan.scanned.works++;
    const repair = repairRow(row);
    if (turnedAuthors.get(row.id)?.includes(repair.repairedAuthor)) repair.repairedAuthor = givenNameFirst(repair.repairedAuthor);
    if (isChanged(repair)) plan.works.push(repair);
  }
  return plan;
}

export function applyMojibakeRepairs(db: DatabaseSync, plan: MojibakePlan): MojibakeApplied {
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

export function mojibakeReport(plan: MojibakePlan, applied: MojibakeApplied | null) {
  const origins: Record<string, number> = {};
  for (const { origin } of plan.books) origins[origin] = (origins[origin] ?? 0) + 1;
  return {
    dryRun: applied === null,
    books: {
      scanned: plan.scanned.books,
      repaired: plan.books.length,
      titles: plan.books.filter((book) => book.repairedTitle !== book.title).length,
      authors: plan.books.filter((book) => book.repairedAuthor !== book.author).length,
      names: plan.books.filter((book) => book.repairedAuthor !== cleanCatalogText(book.author)).length,
      markers: plan.books.filter((book) => strippedMarkers(book.title) || strippedMarkers(book.author)).length
    },
    works: { scanned: plan.scanned.works, repaired: plan.works.length },
    origins,
    repairs: plan.books.map((book) => ({ id: book.id, from: `${book.title} — ${book.author}`, to: `${book.repairedTitle} — ${book.repairedAuthor}` })),
    stillBroken: { count: plan.stillBroken.length, examples: plan.stillBroken.slice(0, 10).map((book) => `${book.title} — ${book.author}`) },
    applied
  };
}

export const reportJson = (report: object) => JSON.stringify(report, null, 2).replace(/[\u0080-\u009f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
