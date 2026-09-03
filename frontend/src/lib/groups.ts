// "Series" and "Collections" are the same underlying concept — a named,
// user-editable group of books — with one difference: series are
// additionally auto-seeded from each book's own `Series` field (Kobo and
// Goodreads both carry one), while collections only ever come from the
// user explicitly creating one. Once a series exists as a Group, though,
// it's an ordinary resource: rename it, delete it, add or remove books by
// hand, same as a collection. See deriveSeriesGroups below for the
// auto-seed step, and DashboardPage/LibraryPage for where it's called.
//
// Lives entirely on the frontend, same reasoning as lib/merge.ts: the
// backend's `library` module treats the whole document as an opaque blob
// (hexagonal design, see backend/README.md) — `groups` is just another
// field on that blob, no backend change needed at all.

import type { PerCardStyle } from "./libraryStyle";
import { bookKey } from "./merge";

export type GroupType = "series" | "collection";

export interface Group {
  id: string;
  type: GroupType;
  name: string;
  /** References into books via bookKey() (see lib/merge.ts) rather than
   *  ContentID — a group has to keep meaning the same thing across a
   *  later re-import/merge, and ContentID isn't stable across sources. */
  bookKeys: string[];
  createdAt: string;
  updatedAt: string;
  /** A series' own card style, taking priority over the library-wide one
   *  for every book in it (see lib/libraryStyle.ts's effectiveCardStyle).
   *  `undefined` (the common case) means "no override, inherit the
   *  library style" — never a partial object; once a series customizes
   *  its style, ALL of PerCardStyle's fields are set together (seeded
   *  from the then-current effective style), not opted into one at a
   *  time. Only ever meaningful for `type: "series"` — collections don't
   *  get a style panel. */
  style?: PerCardStyle;
}

function newGroupId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `g_${Math.random().toString(36).slice(2)}`;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Builds a group WITHOUT appending it, so a caller that needs the new
 *  group's id can have it — createGroup() below only hands back the new
 *  array, and fishing the id back out of that (by diffing, or trusting
 *  the last element) would be guesswork. GroupsPage needs the id to drop
 *  the freshly-created group straight into inline rename, since it is
 *  created with a placeholder name that the user is expected to replace
 *  immediately. */
export function makeGroup(type: GroupType, name: string): Group {
  const now = new Date().toISOString();
  return { id: newGroupId(), type, name: name.trim(), bookKeys: [], createdAt: now, updatedAt: now };
}

export function createGroup(groups: Group[], type: GroupType, name: string): Group[] {
  return [...groups, makeGroup(type, name)];
}

export function renameGroup(groups: Group[], id: string, name: string): Group[] {
  const trimmed = name.trim();
  if (!trimmed) return groups;
  const now = new Date().toISOString();
  return groups.map((g) => (g.id === id ? { ...g, name: trimmed, updatedAt: now } : g));
}

export function deleteGroup(groups: Group[], id: string): Group[] {
  return groups.filter((g) => g.id !== id);
}

export function addBookToGroup(groups: Group[], id: string, book: Record<string, unknown>): Group[] {
  const key = bookKey(book);
  const now = new Date().toISOString();
  return groups.map((g) => (g.id === id && !g.bookKeys.includes(key) ? { ...g, bookKeys: [...g.bookKeys, key], updatedAt: now } : g));
}

export function removeBookFromGroup(groups: Group[], id: string, book: Record<string, unknown>): Group[] {
  const key = bookKey(book);
  const now = new Date().toISOString();
  return groups.map((g) => (g.id === id ? { ...g, bookKeys: g.bookKeys.filter((k) => k !== key), updatedAt: now } : g));
}

/** Sets (or clears, passing `undefined`) a series' own card style — see
 *  `Group.style`. Whole-object replace, not a partial merge: the caller
 *  (PerCardStylePanel) is responsible for seeding a full `PerCardStyle`
 *  when turning customization on. */
export function setGroupStyle(groups: Group[], id: string, style: PerCardStyle | undefined): Group[] {
  const now = new Date().toISOString();
  return groups.map((g) => (g.id === id ? { ...g, style, updatedAt: now } : g));
}

/** Scrubs one or more books' keys out of every group's `bookKeys` in one
 *  pass — call this alongside actually removing the book(s) from `books`
 *  (see lib/merge.ts's bookKey and the delete handlers in
 *  LibraryPage.tsx/GroupsPage.tsx, including bulk delete via select mode)
 *  so a deleted book doesn't linger as a dangling reference forever. Not
 *  strictly required for correctness on its own — `booksInGroup()`
 *  already silently drops a key with no matching book — but leaving it in
 *  `bookKeys` means it'd quietly reappear if a *different* book ever
 *  produced the same key (title+author collision) down the line, and it
 *  just clutters the saved data for no reason. */
export function removeBooksFromAllGroups(groups: Group[], keys: Iterable<string>): Group[] {
  const keySet = keys instanceof Set ? keys : new Set(keys);
  if (keySet.size === 0) return groups;
  const now = new Date().toISOString();
  return groups.map((g) => {
    if (!g.bookKeys.some((k) => keySet.has(k))) return g;
    return { ...g, bookKeys: g.bookKeys.filter((k) => !keySet.has(k)), updatedAt: now };
  });
}

/** Resolves a group's stored bookKeys back to the actual book objects
 *  currently in the library. A key with no matching book (the book was
 *  removed from the library entirely) is silently dropped rather than
 *  left as a dangling reference. */
export function booksInGroup(group: Group, books: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  const resolved: Array<Record<string, unknown>> = [];
  for (const key of group.bookKeys) {
    const book = byKey.get(key);
    if (book) resolved.push(book);
  }
  return resolved;
}

/** A series' reading order falls out of each book's own SeriesNumber
 *  (Kobo/Goodreads convention) rather than anything stored on the group —
 *  books without one sort last. Collections have no inherent order, so
 *  they're returned in whatever order they were added. */
export function orderedGroupBooks(group: Group, books: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const resolved = booksInGroup(group, books);
  if (group.type !== "series") return resolved;
  return [...resolved].sort((a, b) => {
    const an = typeof a.SeriesNumber === "number" ? a.SeriesNumber : Number.POSITIVE_INFINITY;
    const bn = typeof b.SeriesNumber === "number" ? b.SeriesNumber : Number.POSITIVE_INFINITY;
    return an - bn;
  });
}

/** Additive-only auto-seed: for every book with a non-empty `Series`
 *  field, makes sure a series-type group with that name exists (matched
 *  case/whitespace-insensitively against existing group names, so
 *  re-running this on every import doesn't create near-duplicate series)
 *  and that the book is a member of it. Never renames, deletes, or removes
 *  a book from a group — once seeded, a series is the user's to edit, and
 *  a later import shouldn't silently fight a rename or an intentional
 *  removal. Call this after merging a new import into the library, before
 *  saving. */
export function deriveSeriesGroups(books: Array<Record<string, unknown>>, groups: Group[]): Group[] {
  const result = [...groups];
  for (const book of books) {
    const seriesName = typeof book.Series === "string" ? book.Series.trim() : "";
    if (!seriesName) continue;
    const key = bookKey(book);
    const idx = result.findIndex((g) => g.type === "series" && normalizeName(g.name) === normalizeName(seriesName));
    if (idx === -1) {
      const now = new Date().toISOString();
      result.push({ id: newGroupId(), type: "series", name: seriesName, bookKeys: [key], createdAt: now, updatedAt: now });
    } else if (!result[idx].bookKeys.includes(key)) {
      result[idx] = { ...result[idx], bookKeys: [...result[idx].bookKeys, key], updatedAt: new Date().toISOString() };
    }
  }
  return result;
}
