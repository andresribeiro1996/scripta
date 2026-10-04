import { buildMergedLibrary } from "./addPipeline.js";
import { setRating, type FinishRating } from "./finish.js";
import { addKeyToGroup, isGroup, removeKeyFromGroup } from "./groups.js";
import { setReadStatus, type ReadStatus } from "./libraryView.js";
import { bookKey } from "./merge.js";
import type { LibraryData } from "./types.js";

export type LibraryChange =
  | { kind: "membership"; groupId: string; bookKey: string; member: boolean }
  | { kind: "book"; bookKey: string; readStatus?: ReadStatus; rating?: FinishRating; day?: string }
  | { kind: "add"; book: Record<string, unknown> };

export type ApplyLibraryChangeResult = { data: LibraryData; changed: boolean } | { error: "no-group" | "no-book" };

export function applyLibraryChange(data: LibraryData, change: LibraryChange): ApplyLibraryChangeResult {
  if (change.kind === "add") return { data: buildMergedLibrary(data, { books: [change.book] }), changed: true };

  if (change.kind === "membership") {
    const groups = data.groups ?? [];
    if (!groups.some((group) => isGroup(group) && group.id === change.groupId)) return { error: "no-group" };
    if (change.member && !data.books.some((book) => bookKey(book) === change.bookKey)) return { error: "no-book" };
    const next = change.member ? addKeyToGroup(groups, change.groupId, change.bookKey) : removeKeyFromGroup(groups, change.groupId, change.bookKey);
    return next === groups ? { data, changed: false } : { data: { ...data, groups: next }, changed: true };
  }

  let matched = false;
  let changed = false;
  const books = data.books.map((book) => {
    if (bookKey(book) !== change.bookKey) return book;
    matched = true;
    let next = book;
    if (change.readStatus !== undefined) next = setReadStatus(next, change.readStatus, change.day ?? "");
    if (change.rating !== undefined) next = setRating(next, change.rating);
    if (next !== book) changed = true;
    return next;
  });
  if (!matched) return { error: "no-book" };
  return changed ? { data: { ...data, books }, changed: true } : { data, changed: false };
}
