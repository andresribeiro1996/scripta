import { deriveSeriesGroups } from "./groups.js";
import { assignBookOrder } from "./libraryOrder.js";
import { mergeLibraryData } from "./merge.js";
import type { LibraryData } from "./types.js";

export function buildMergedLibrary(existing: LibraryData, incoming: LibraryData): LibraryData {
  const merged = mergeLibraryData(existing, incoming);
  const ordered: LibraryData = { ...merged, books: assignBookOrder(merged.books) };
  return { ...ordered, groups: deriveSeriesGroups(ordered.books, ordered.groups ?? []) };
}
