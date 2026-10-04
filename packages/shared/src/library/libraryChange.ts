import { buildMergedLibrary } from "./addPipeline.js";
import { setRating, type FinishRating } from "./finish.js";
import { addKeyToGroup, isGroup, removeKeyFromGroup } from "./groups.js";
import { setReadStatus } from "./libraryView.js";
import { bookKey } from "./merge.js";
import type { LibraryData } from "./types.js";

export type LibraryChange =
  | { kind: "membership"; groupId: string; bookKey: string; member: boolean }
  | { kind: "book"; bookKey: string; rating?: FinishRating; readStatus: 2; day: string }
  | { kind: "book"; bookKey: string; rating?: FinishRating; readStatus?: 0 | 1; day?: string }
  | { kind: "add"; book: Record<string, unknown> };

export type ApplyLibraryChangeResult = { data: LibraryData; changed: boolean } | { error: "no-group" | "no-book" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function addBook(data: LibraryData, book: Record<string, unknown>): LibraryData {
  const books = data.books.filter(isRecord);
  const groupsValid = data.groups === undefined || Array.isArray(data.groups);
  if (books.length === data.books.length && groupsValid) return buildMergedLibrary(data, { books: [book] });
  const built = buildMergedLibrary({ ...data, books, groups: groupsValid ? data.groups : undefined }, { books: [book] });
  const merged = { ...built, books: [...built.books, ...data.books.filter((entry) => !isRecord(entry))] };
  return { ...merged, book_count: merged.books.length, groups: groupsValid ? built.groups : data.groups } as LibraryData;
}

export function applyLibraryChange(data: LibraryData, change: LibraryChange): ApplyLibraryChangeResult {
  if (change.kind === "add") return { data: addBook(data, change.book), changed: true };

  if (change.kind === "membership") {
    const groups = Array.isArray(data.groups) ? data.groups : [];
    if (!groups.some((group) => isGroup(group) && group.id === change.groupId)) return { error: "no-group" };
    if (change.member && !data.books.some((book) => isRecord(book) && bookKey(book) === change.bookKey)) return { error: "no-book" };
    const next = change.member ? addKeyToGroup(groups, change.groupId, change.bookKey) : removeKeyFromGroup(groups, change.groupId, change.bookKey);
    return next === groups ? { data, changed: false } : { data: { ...data, groups: next }, changed: true };
  }

  let matched = false;
  let changed = false;
  const books = data.books.map((book) => {
    if (!isRecord(book) || bookKey(book) !== change.bookKey) return book;
    matched = true;
    let next = book;
    if (change.readStatus === 2) next = setReadStatus(next, 2, change.day);
    else if (change.readStatus !== undefined) next = setReadStatus(next, change.readStatus, "");
    if (change.rating !== undefined) next = setRating(next, change.rating);
    if (next !== book) changed = true;
    return next;
  });
  if (!matched) return { error: "no-book" };
  return changed ? { data: { ...data, books }, changed: true } : { data, changed: false };
}
