import type { DatabaseSync } from "node:sqlite";
import { canonicalWorks, resolveWorks, type WorkLookup } from "../books/index.js";
import { openLibraryDb } from "./adapters/sqlite/connection.js";

export interface WorkEntry {
  key: string;
  title?: string | null;
  author?: string | null;
  isbn?: string | null;
}

export interface WorkRef {
  workId: string | null;
  title: string | null;
}

export class WorkResolutionError extends Error {
  constructor(cause: unknown) {
    super("The book catalog is unavailable. Try again in a moment.", { cause });
  }
}

export function canonicalWorkIds(ids: string[], canonical: (ids: string[]) => Map<string, string> = canonicalWorks): Map<string, string> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  try {
    return canonical(unique);
  } catch (error) {
    throw new WorkResolutionError(error);
  }
}

interface ResolverDeps {
  db: DatabaseSync;
  resolveWorks: (lookups: WorkLookup[]) => Array<string | null>;
  canonicalWorks: (ids: string[]) => Map<string, string>;
}

interface LibraryWorkRow {
  book_key: string;
  work_id: string | null;
  isbn: string | null;
  title: string | null;
  author: string | null;
}

export function createEntryWorksResolver(deps: ResolverDeps) {
  const rowsStmt = deps.db.prepare(`
    SELECT book_key, work_id, isbn, title, author FROM library_books
    WHERE user_id = ? AND book_key IN (SELECT value FROM json_each(?)) ORDER BY position
  `);
  return (ownerUserId: string, entries: WorkEntry[]): Map<string, WorkRef> => {
    const byKey = new Map<string, WorkEntry>();
    for (const entry of entries) if (entry.key !== "" && !byKey.has(entry.key)) byKey.set(entry.key, entry);
    const result = new Map<string, WorkRef>();
    if (byKey.size === 0) return result;
    const rows = new Map<string, LibraryWorkRow>();
    for (const row of rowsStmt.all(ownerUserId, JSON.stringify([...byKey.keys()])) as unknown as LibraryWorkRow[]) {
      if (!rows.has(row.book_key)) rows.set(row.book_key, row);
    }
    const stored: Array<[string, string]> = [];
    const pending: Array<{ key: string; lookup: WorkLookup }> = [];
    for (const [key, entry] of byKey) {
      const row = rows.get(key);
      result.set(key, { workId: null, title: row?.title ?? entry.title ?? null });
      if (row?.work_id) stored.push([key, row.work_id]);
      else if (row) pending.push({ key, lookup: { isbn: row.isbn, title: row.title, author: row.author } });
      else if (entry.title || entry.isbn) pending.push({ key, lookup: { isbn: entry.isbn ?? null, title: entry.title ?? null, author: entry.author ?? null } });
    }
    try {
      const canonical = stored.length > 0 ? deps.canonicalWorks(stored.map(([, id]) => id)) : new Map<string, string>();
      for (const [key, id] of stored) result.get(key)!.workId = canonical.get(id) ?? id;
      const ids = pending.length > 0 ? deps.resolveWorks(pending.map((item) => item.lookup)) : [];
      pending.forEach((item, index) => { result.get(item.key)!.workId = ids[index] ?? null; });
    } catch (error) {
      throw new WorkResolutionError(error);
    }
    return result;
  };
}

let resolver: ReturnType<typeof createEntryWorksResolver> | null = null;

export function resolveEntryWorks(ownerUserId: string, entries: WorkEntry[]): Map<string, WorkRef> {
  resolver ??= createEntryWorksResolver({ db: openLibraryDb(), resolveWorks, canonicalWorks });
  return resolver(ownerUserId, entries);
}

export function firstDuplicateWork(keys: string[], works: Map<string, WorkRef>): WorkRef | undefined {
  const seen = new Set<string>();
  for (const key of keys) {
    const ref = works.get(key);
    if (!ref?.workId) continue;
    if (seen.has(ref.workId)) return ref;
    seen.add(ref.workId);
  }
  return undefined;
}

export function keepFirstPerWork<T>(items: T[], keyOf: (item: T) => string, works: Map<string, WorkRef>): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const workId = works.get(keyOf(item))?.workId;
    if (!workId) return true;
    if (seen.has(workId)) return false;
    seen.add(workId);
    return true;
  });
}

export function workIdsByKey(keys: string[], works: Map<string, WorkRef>): Map<string, string | null> {
  return new Map(keys.filter((key) => key !== "").map((key) => [key, works.get(key)?.workId ?? null]));
}

export function duplicateWorkMessage(ref: WorkRef): string {
  return `${ref.title ?? "That book"} is already here as another edition.`;
}
