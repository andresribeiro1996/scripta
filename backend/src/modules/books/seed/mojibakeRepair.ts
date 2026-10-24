import type { DatabaseSync } from "node:sqlite";
import { cleanCatalogText, hasMojibake, repairMojibake } from "@scripta/shared";
import { workTitleKey } from "../domain/normalize.js";
import type { MojibakeApplied, RowRepair } from "../domain/types.js";

export interface BookRepair extends RowRepair {
  origin: string;
}

export interface MojibakePlan {
  scanned: { books: number; works: number };
  books: BookRepair[];
  works: RowRepair[];
  stillBroken: Array<{ id: string; title: string; author: string }>;
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

const repairRow = ({ id, title, author }: WorkScan): RowRepair => ({ id, title, author, repairedTitle: cleanCatalogText(title), repairedAuthor: cleanCatalogText(author) });
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
      markers: plan.books.filter((book) => book.repairedTitle !== repairMojibake(book.title) || book.repairedAuthor !== repairMojibake(book.author)).length
    },
    works: { scanned: plan.scanned.works, repaired: plan.works.length },
    origins,
    repairs: plan.books.map((book) => ({ id: book.id, from: `${book.title} — ${book.author}`, to: `${book.repairedTitle} — ${book.repairedAuthor}` })),
    stillBroken: { count: plan.stillBroken.length, examples: plan.stillBroken.slice(0, 10).map((book) => `${book.title} — ${book.author}`) },
    applied
  };
}

export const reportJson = (report: object) => JSON.stringify(report, null, 2).replace(/[\u0080-\u009f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
