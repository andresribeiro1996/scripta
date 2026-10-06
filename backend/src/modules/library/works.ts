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

export class UnknownWorkError extends Error {
  constructor() {
    super("That book isn't in the catalog.");
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

export function knownWorkIds(ids: string[], canonical: (ids: string[]) => Map<string, string> = canonicalWorks): string[] {
  const found = canonicalWorkIds(ids, canonical);
  return ids.map((id) => {
    const work = found.get(id);
    if (!work) throw new UnknownWorkError();
    return work;
  });
}

export function canonicalByKey(stored: Map<string, string | null>, canonical: (ids: string[]) => Map<string, string> = canonicalWorks): Map<string, string> {
  const found = canonicalWorkIds([...stored.values()].filter((id): id is string => id !== null), canonical);
  const result = new Map<string, string>();
  for (const [key, id] of stored) if (id) result.set(key, found.get(id) ?? id);
  return result;
}

export function firstKeyPerWork(keys: string[], works: Map<string, string>): Map<string, string> {
  const result = new Map<string, string>();
  for (const key of keys) {
    const work = works.get(key);
    if (work && !result.has(work)) result.set(work, key);
  }
  return result;
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
    const bare: string[] = [];
    for (const [key, entry] of byKey) {
      const row = rows.get(key);
      result.set(key, { workId: null, title: row?.title ?? entry.title ?? null });
      if (row?.work_id) stored.push([key, row.work_id]);
      else if (row) pending.push({ key, lookup: { isbn: row.isbn, title: row.title, author: row.author } });
      else if (entry.title || entry.isbn) pending.push({ key, lookup: { isbn: entry.isbn ?? null, title: entry.title ?? null, author: entry.author ?? null } });
      else bare.push(key);
    }
    try {
      const canonical = stored.length > 0 ? deps.canonicalWorks(stored.map(([, id]) => id)) : new Map<string, string>();
      for (const [key, id] of stored) result.get(key)!.workId = canonical.get(id) ?? id;
      const ids = pending.length > 0 ? deps.resolveWorks(pending.map((item) => item.lookup)) : [];
      pending.forEach((item, index) => { result.get(item.key)!.workId = ids[index] ?? null; });
      const known = bare.length > 0 ? deps.canonicalWorks(bare) : new Map<string, string>();
      for (const key of bare) result.get(key)!.workId = known.get(key) ?? null;
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

export function createCopyKeysResolver(deps: { db: DatabaseSync; canonicalWorks: (ids: string[]) => Map<string, string> }) {
  const rowsStmt = deps.db.prepare(`SELECT book_key, work_id FROM library_books WHERE user_id = ? AND work_id IS NOT NULL ORDER BY position`);
  return (ownerUserId: string, workIds: string[]): Map<string, string> => {
    const wanted = new Set(workIds);
    const result = new Map<string, string>();
    if (wanted.size === 0) return result;
    const rows = rowsStmt.all(ownerUserId) as unknown as Array<{ book_key: string; work_id: string }>;
    const found = canonicalWorkIds(rows.map((row) => row.work_id), deps.canonicalWorks);
    for (const row of rows) {
      const work = found.get(row.work_id) ?? row.work_id;
      if (wanted.has(work) && !result.has(work)) result.set(work, row.book_key);
    }
    return result;
  };
}

let copyKeysResolver: ReturnType<typeof createCopyKeysResolver> | null = null;

export function copyKeysForWorks(ownerUserId: string, workIds: string[]): Map<string, string> {
  copyKeysResolver ??= createCopyKeysResolver({ db: openLibraryDb(), canonicalWorks });
  return copyKeysResolver(ownerUserId, workIds);
}

export function keysForWorks(ownerUserId: string, workIds: string[], existing: Map<string, string>, copyKeys: (ownerUserId: string, workIds: string[]) => Map<string, string> = copyKeysForWorks): Map<string, string> {
  const unique = [...new Set(workIds)];
  const copies = copyKeys(ownerUserId, unique.filter((id) => !existing.has(id)));
  const used = new Set(existing.values());
  const result = new Map<string, string>();
  for (const id of unique) {
    let key = existing.get(id);
    if (key === undefined) {
      const copy = copies.get(id);
      key = copy !== undefined && !used.has(copy) ? copy : id;
      used.add(key);
    }
    result.set(id, key);
  }
  return result;
}

export function resolveTitleWorks(books: Array<{ title: string; author: string }>, resolve: (lookups: WorkLookup[]) => Array<string | null> = resolveWorks): Array<string | null> {
  if (books.length === 0) return [];
  try {
    return resolve(books.map((book) => ({ isbn: null, title: book.title, author: book.author })));
  } catch (error) {
    throw new WorkResolutionError(error);
  }
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
