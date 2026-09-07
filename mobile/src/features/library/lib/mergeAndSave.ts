// The shared tail of every path that brings books in — a file import
// (Kobo/Goodreads/StoryGraph preview, or an on-device library.json), a
// single manual "Add book". Mirrors frontend's LibraryPage.tsx
// `mergeAndSave`'s own pipeline exactly: merge against whatever's already
// saved (packages/shared's mergeLibraryData — book identity, newest-wins,
// keep-whichever-has-a-cover, highlight union), assign `_order` to
// genuinely new books, then additively auto-seed series groups from the
// merged result. Pure — the actual PUT is the caller's job (see
// hooks/useLibrary.ts's updateLibrary), so this is unit-testable with no
// network/query-client involved.

import { assignBookOrder, deriveSeriesGroups, mergeLibraryData, type LibraryData } from "@scripta/shared";

export function buildMergedLibrary(existing: LibraryData | undefined, incoming: LibraryData): LibraryData {
  const merged = existing ? mergeLibraryData(existing, incoming) : incoming;
  const ordered: LibraryData = { ...merged, books: assignBookOrder(merged.books) };
  return { ...ordered, groups: deriveSeriesGroups(ordered.books, ordered.groups ?? []) };
}
