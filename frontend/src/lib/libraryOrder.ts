// Display order for the main Library grid (LibraryPage.tsx) — NOT for the
// underlying `books` array in storage, which stays in plain merge/import
// order (see lib/merge.ts); this is purely a render-time derivation.
//
// Rules:
//   1. Books belonging to the same SERIES are clustered together (kept as
//      close to each other as possible), ahead of any standalone book.
//      Collections deliberately do NOT participate — they're an
//      organizational tool (see GroupsPage.tsx), not a layout one, so a
//      book being in a collection has zero effect on where it renders
//      here.
//   2. Every other book keeps a manually-tracked `_order` number — set by
//      assignBookOrder() on import, and from then on only changed by the
//      user dragging a card onto another (reorderOnDrop()).

import { orderedGroupBooks, type Group } from "./groups";
import { bookKey } from "./merge";

/** The book's manually-tracked position (see assignBookOrder). A book
 *  that predates this feature — or hasn't been through an import/merge
 *  since — has none yet and sorts after everything that does. */
function orderOf(book: Record<string, unknown>): number {
  return typeof book._order === "number" ? book._order : Number.POSITIVE_INFINITY;
}

/** Assigns `_order` to any book that doesn't already have one — call this
 *  after every merge/first-import (see LibraryPage.tsx's handleFileChosen),
 *  before saving. New books are appended after the current maximum, in
 *  their incoming order; a book that already has one keeps it untouched
 *  (including through a merge — see mergeBookPair in lib/merge.ts, fixed
 *  to preserve app-managed fields like this one across a re-import). */
export function assignBookOrder(books: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  let nextOrder = 1 + books.reduce((max, b) => (typeof b._order === "number" ? Math.max(max, b._order) : max), -1);
  return books.map((b) => (typeof b._order === "number" ? b : { ...b, _order: nextOrder++ }));
}

/** One movable/renderable slot in the Library grid's top-level ordering:
 *  either a whole series (every one of its resolvable member books,
 *  always kept together) or a single standalone book. Both
 *  orderLibraryBooks() and reorderOnDrop() are built on this same
 *  breakdown so dragging always acts on exactly what's on screen. `group`
 *  is set only for a series unit — carried along so style resolution
 *  (see seriesGroupByBookKey()) uses the exact same cluster-priority
 *  logic as ordering does, rather than risking a second, possibly
 *  inconsistent resolution of "which series does this book belong to." */
interface Unit {
  books: Array<Record<string, unknown>>;
  group?: Group;
}

function buildUnits(books: Array<Record<string, unknown>>, groups: Group[]): Unit[] {
  const seriesGroups = groups.filter((g) => g.type === "series");

  const clusters = seriesGroups
    .map((group) => {
      const members = orderedGroupBooks(group, books);
      if (members.length === 0) return null;
      const minOrder = Math.min(...members.map(orderOf));
      return { group, members, minOrder };
    })
    .filter((c): c is { group: Group; members: Array<Record<string, unknown>>; minOrder: number } => c !== null)
    .sort((a, b) => a.minOrder - b.minOrder || a.group.name.localeCompare(b.group.name));

  const placed = new Set<string>();
  const units: Unit[] = [];
  for (const cluster of clusters) {
    // A book could technically be seeded into more than one series by
    // hand (GroupsPage's "Manage books" picker doesn't prevent it) — keep
    // it in whichever cluster sorted earliest, not repeated in later ones.
    const members = cluster.members.filter((b) => {
      const key = bookKey(b);
      if (placed.has(key)) return false;
      placed.add(key);
      return true;
    });
    if (members.length > 0) units.push({ books: members, group: cluster.group });
  }

  const standalone = books.filter((b) => !placed.has(bookKey(b))).sort((a, b) => orderOf(a) - orderOf(b));
  for (const b of standalone) units.push({ books: [b] });

  return units;
}

/** Which series (if any) each book is actually clustered under, for style
 *  priority (see lib/libraryStyle.ts's effectiveCardStyle) — built from
 *  the exact same units orderLibraryBooks() renders, so "which series is
 *  this card visually part of" and "whose style override applies to it"
 *  can never disagree. A book with no entry has no series (its style is
 *  purely the library-wide one). */
export function seriesGroupByBookKey(books: Array<Record<string, unknown>>, groups: Group[]): Map<string, Group> {
  const map = new Map<string, Group>();
  for (const unit of buildUnits(books, groups)) {
    if (!unit.group) continue;
    for (const b of unit.books) map.set(bookKey(b), unit.group);
  }
  return map;
}

/** Series cluster together, ahead of every standalone book; collections
 *  are ignored entirely (see file header). Ordered among themselves by
 *  their earliest member's `_order`. */
export function orderLibraryBooks(
  books: Array<Record<string, unknown>>,
  groups: Group[]
): Array<Record<string, unknown>> {
  return buildUnits(books, groups).flatMap((u) => u.books);
}

/** Recomputes `_order` for every book after dragging one card onto
 *  another, in terms of the same top-level units orderLibraryBooks()
 *  renders — so dropping a card always moves exactly the block it's
 *  visually part of:
 *   - A standalone book moves just itself.
 *   - A book that's in a series moves the WHOLE series as one block —
 *     the series "takes over" wherever the drop landed, same as the rest
 *     of that series' own reasoning (kept together, never split).
 *  The dragged unit is inserted immediately ahead of the target's unit.
 *  Dropping a card onto another card in the same unit (e.g. two books in
 *  the same series) is a no-op — this reorders top-level position, not
 *  order within a series (that already follows SeriesNumber). Returns the
 *  full `books` array (same membership, same non-order fields) with just
 *  `_order` updated to match the new arrangement — the array's own
 *  iteration order is irrelevant, since display order is always derived
 *  fresh via orderLibraryBooks(). */
export function reorderOnDrop(
  books: Array<Record<string, unknown>>,
  groups: Group[],
  draggedKey: string,
  targetKey: string
): Array<Record<string, unknown>> {
  if (draggedKey === targetKey) return books;

  const units = buildUnits(books, groups);
  const draggedIdx = units.findIndex((u) => u.books.some((b) => bookKey(b) === draggedKey));
  const targetIdx = units.findIndex((u) => u.books.some((b) => bookKey(b) === targetKey));
  if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) return books;

  const draggedUnit = units[draggedIdx];
  const targetUnit = units[targetIdx];
  const remaining = units.filter((_, i) => i !== draggedIdx);
  const insertAt = remaining.indexOf(targetUnit);
  remaining.splice(insertAt, 0, draggedUnit);

  const orderIndex = new Map(remaining.flatMap((u) => u.books).map((b, i) => [bookKey(b), i] as const));
  return books.map((b) => {
    const idx = orderIndex.get(bookKey(b));
    return idx === undefined ? b : { ...b, _order: idx };
  });
}
