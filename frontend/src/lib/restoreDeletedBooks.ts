import type { LibraryData } from "../api/library";
import { bookKey } from "./merge";

function restoreKeys(current: string[], snapshot: string[], keys: ReadonlySet<string>): string[] {
  const restored = [...current];
  for (const key of snapshot) {
    if (!keys.has(key) || restored.includes(key)) continue;
    const index = snapshot.indexOf(key);
    const next = snapshot.slice(index + 1).find((candidate) => restored.includes(candidate));
    if (next) restored.splice(restored.indexOf(next), 0, key);
    else {
      const previous = snapshot.slice(0, index).reverse().find((candidate) => restored.includes(candidate));
      if (previous) restored.splice(restored.indexOf(previous) + 1, 0, key);
      else restored.push(key);
    }
  }
  return restored;
}

function tagOccurrences(keys: string[]): string[] {
  const counts = new Map<string, number>();
  return keys.map((key) => {
    const occurrence = (counts.get(key) ?? 0) + 1;
    counts.set(key, occurrence);
    return JSON.stringify([key, occurrence]);
  });
}

export function restoreDeletedBooks(current: LibraryData, snapshot: LibraryData, keys: ReadonlySet<string>): LibraryData {
  const currentBookKeys = current.books.map(bookKey);
  const snapshotBookKeys = snapshot.books.map(bookKey);
  const currentTags = tagOccurrences(currentBookKeys);
  const snapshotTags = tagOccurrences(snapshotBookKeys);
  const selectedTags = new Set(snapshotTags.filter((_, index) => keys.has(snapshotBookKeys[index]!)));
  const booksByTag = new Map(snapshotTags.map((tag, index) => [tag, snapshot.books[index]!]));
  currentTags.forEach((tag, index) => booksByTag.set(tag, current.books[index]!));
  const books = restoreKeys(currentTags, snapshotTags, selectedTags).map((tag) => booksByTag.get(tag)!);
  const snapshotGroups = new Map((snapshot.groups ?? []).map((group) => [group.id, group]));
  const groups = (current.groups ?? []).map((group) => {
    const snapshotGroup = snapshotGroups.get(group.id);
    if (!snapshotGroup) return group;
    const restoredBookKeys = restoreKeys(group.bookKeys, snapshotGroup.bookKeys, keys);
    return restoredBookKeys.length !== group.bookKeys.length ? { ...group, bookKeys: restoredBookKeys, updatedAt: new Date().toISOString() } : group;
  });
  return { ...current, books, book_count: books.length, groups };
}
