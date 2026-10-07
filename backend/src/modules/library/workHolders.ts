import type { DatabaseSync } from "node:sqlite";
import { openLibraryDb } from "./adapters/sqlite/connection.js";

export type HolderStatus = 0 | 1 | 2;
export type ViewerCopy = { bookKey: string; readStatus: HolderStatus; rating: number | null; highlightCount: number; isbn: string | null; coverUrl: string | null };

const statusOf = (value: unknown): HolderStatus => (value === 2 ? 2 : value === 1 ? 1 : 0);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function createWorkHolders(db: DatabaseSync) {
  const holdersStmt = db.prepare(`SELECT user_id, position, read_status FROM library_books WHERE work_id IN (SELECT value FROM json_each(?)) ORDER BY user_id, position`);
  const copyStmt = db.prepare(`SELECT position, book_key, read_status, isbn, cover_url FROM library_books WHERE user_id = ? AND work_id IN (SELECT value FROM json_each(?)) ORDER BY position LIMIT 1`);
  const documentStmt = db.prepare(`SELECT data FROM library_documents WHERE user_id = ?`);

  function holdersOfWorks(workIds: string[]): Array<{ userId: string; readStatus: HolderStatus }> {
    if (workIds.length === 0) return [];
    const seen = new Set<string>();
    const holders: Array<{ userId: string; readStatus: HolderStatus }> = [];
    for (const row of holdersStmt.all(JSON.stringify(workIds)) as Array<{ user_id: string; read_status: number | null }>) {
      if (seen.has(row.user_id)) continue;
      seen.add(row.user_id);
      holders.push({ userId: row.user_id, readStatus: statusOf(row.read_status) });
    }
    return holders;
  }

  function copyOfWork(userId: string, workIds: string[]): ViewerCopy | undefined {
    if (workIds.length === 0) return undefined;
    const row = copyStmt.get(userId, JSON.stringify(workIds)) as { position: number; book_key: string; read_status: number | null; isbn: string | null; cover_url: string | null } | undefined;
    if (!row) return undefined;
    const document = documentStmt.get(userId) as { data: string } | undefined;
    const parsed: unknown = document ? JSON.parse(document.data) : null;
    const book = isRecord(parsed) && Array.isArray(parsed.books) && isRecord(parsed.books[row.position]) ? parsed.books[row.position] as Record<string, unknown> : {};
    const rating = typeof book.Rating === "number" && Number.isInteger(book.Rating) && book.Rating >= 1 && book.Rating <= 5 ? book.Rating : null;
    const highlights = Array.isArray(book.highlights) ? book.highlights.filter((h) => isRecord(h) && h.Type !== "review").length : 0;
    return { bookKey: row.book_key, readStatus: statusOf(row.read_status), rating, highlightCount: highlights, isbn: row.isbn, coverUrl: row.cover_url };
  }

  return { holdersOfWorks, copyOfWork };
}

let holders: ReturnType<typeof createWorkHolders> | null = null;

export function holdersOfWorks(workIds: string[]) {
  holders ??= createWorkHolders(openLibraryDb());
  return holders.holdersOfWorks(workIds);
}

export function copyOfWork(userId: string, workIds: string[]) {
  holders ??= createWorkHolders(openLibraryDb());
  return holders.copyOfWork(userId, workIds);
}
