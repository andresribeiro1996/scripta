// A "mural" is a named, freeform dashboard the user builds out of blocks —
// a book spotlight, a hand-picked "Top 5" shelf, a featured quote, a
// gallery image, etc. — dragged/resized on a snap-to-grid canvas (see
// components/murals/MuralCanvas.tsx, which wraps react-grid-layout).
//
// Lives entirely on the frontend, same reasoning as lib/groups.ts: the
// backend's `library` module treats the whole document as an opaque blob
// — `murals` is just another field on it, no backend change needed.
//
// Every block references its content by key (bookKey(), a highlight's
// BookmarkID, a gallery image id) rather than embedding a copy of it, same
// as lib/groups.ts's `bookKeys` — so a block always reflects the CURRENT
// book/highlight/image, and so it can be scrubbed cleanly when the thing
// it points at is deleted (see scrubBooksFromMurals/scrubImageFromMurals
// below, called alongside the book-delete and gallery-image-delete flows
// in LibraryPage.tsx/GroupsPage.tsx/useDeleteGalleryImage.ts).

import type { BlockStyle } from "./libraryStyle";
import { bookKey } from "./merge";

export type BlockLayout = { x: number; y: number; w: number; h: number };

export type StatMetric = "totalBooks" | "booksFinished" | "booksFinishedThisYear" | "booksInProgress" | "totalHighlights";

export const ALL_STAT_METRICS: StatMetric[] = ["totalBooks", "booksFinished", "booksFinishedThisYear", "booksInProgress", "totalHighlights"];

export const STAT_METRIC_LABELS: Record<StatMetric, string> = {
  totalBooks: "Books in your library",
  booksFinished: "Books finished",
  booksFinishedThisYear: "Finished this year",
  booksInProgress: "Currently reading",
  totalHighlights: "Highlights saved"
};

interface QuoteRef {
  bookKey: string;
  highlightId: string;
}

/** One rung of a tier list — a label ("S", "Favorites", whatever the user
 *  wants), a color used as that row's own accent (view mode), and the
 *  books placed on it, in order. A book only ever sits in ONE place at a
 *  time across the whole list — either one tier's `bookKeys`, or the
 *  list's own `pool` (api/tierlists.ts's TierlistData) if it's been
 *  picked for evaluation but not ranked yet — never both, and
 *  TierListEditorPage.tsx's `moveBook` helper is the one place that
 *  invariant is enforced (it always strips a book out of wherever it
 *  currently sits before adding it to its destination). Lives here, with
 *  api/tierlists.ts re-exporting it, same lib-owns-the-type split
 *  api/murals.ts already follows for Mural/MuralBlock. */
export interface TierDefinition {
  id: string;
  label: string;
  color: string;
  bookKeys: string[];
}

/** Builds one fresh, empty tier — TierListEditorPage.tsx's "+ Add tier"
 *  button's only source, so id generation for a tier happens in this one
 *  place. */
export function createTier(label: string, color: string): TierDefinition {
  return { id: newId(), label, color, bookKeys: [] };
}

/** Fields every block type carries, intersected into each variant below
 *  rather than repeated per-variant. `style` is optional — `undefined`
 *  means "use DEFAULT_BLOCK_STYLE" (lib/libraryStyle.ts's
 *  resolveBlockStyle handles this the same way a book's `_style` being
 *  absent means "no override" — every real reader goes through
 *  resolveBlockStyle rather than trusting this field directly), same
 *  reasoning as everywhere else in this app that a style override is
 *  optional-until-touched. */
interface MuralBlockBase {
  id: string;
  layout: BlockLayout;
  style?: BlockStyle;
}

/** Discriminated union, one variant per block type. `layout`/`style` are
 *  always present via MuralBlockBase above — everything else is that
 *  type's own content config, filled in by its picker (see
 *  components/murals/BlockConfigPanel.tsx and its per-type editors). The
 *  three auto-computed/content-free types (`currentlyReading`, `stats`
 *  aside, which still pick which numbers to show; `empty` genuinely has
 *  nothing) need no content reference at all — `empty` is purely a
 *  styled rectangle (background/border/radius/etc. via its own `style`,
 *  same BlockStyle every other block already carries), useful as a
 *  spacer, a colored divider, or a plain decorative panel with no
 *  content of its own to configure. */
export type MuralBlock =
  | (MuralBlockBase & { type: "spotlight"; bookKey: string; caption?: string })
  | (MuralBlockBase & { type: "shelf"; title: string; bookKeys: string[] })
  | (MuralBlockBase & { type: "quote"; bookKey: string; highlightId: string })
  | (MuralBlockBase & { type: "quoteCollection"; title: string; quotes: QuoteRef[] })
  | (MuralBlockBase & { type: "image"; imageId: string; caption?: string })
  | (MuralBlockBase & { type: "text"; heading?: string; body?: string })
  | (MuralBlockBase & { type: "currentlyReading" })
  | (MuralBlockBase & { type: "stats"; metrics: StatMetric[] })
  | (MuralBlockBase & { type: "empty" })
  | (MuralBlockBase & { type: "tierlist"; tierlistId: string });

export type BlockType = MuralBlock["type"];

/** Human-readable name per block type — the single source AddBlockMenu.tsx's
 *  "+ Add block" choices draw their labels from, so a type's display name
 *  only ever needs changing in one place. */
export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  spotlight: "Book spotlight",
  shelf: "Shelf",
  quote: "Quote spotlight",
  quoteCollection: "Quote collection",
  image: "Image",
  text: "Text",
  currentlyReading: "Currently reading",
  stats: "Stats",
  empty: "Empty block",
  tierlist: "Tier list"
};

export function muralBlockTitle(block: MuralBlock, books: Array<Record<string, unknown>>, tierlistName?: string) {
  if (block.type === "text") return block.heading || "Note";
  if (block.type === "shelf" || block.type === "quoteCollection") return block.title || BLOCK_TYPE_LABELS[block.type];
  if (block.type === "spotlight") return String(books.find((book) => bookKey(book) === block.bookKey)?.Title ?? "Book spotlight");
  if (block.type === "image") return block.caption || "Image";
  if (block.type === "tierlist") return tierlistName || "Tier list";
  return BLOCK_TYPE_LABELS[block.type];
}

export interface Mural {
  id: string;
  name: string;
  blocks: MuralBlock[];
  createdAt: string;
  updatedAt: string;
  /** A cover image for the mural itself (shown on its card in
   *  MuralsListPage.tsx), assigned from the account's gallery pool via
   *  CoverPickerModal.tsx — same mechanism BookCard.tsx's own "Cover"
   *  button uses (see setMuralCover/clearMuralCover below, direct
   *  counterparts to lib/bookCovers.ts's setBookCover/clearBookCover).
   *  Both optional and either present or absent together — never one
   *  without the other. `coverImageId` is bookkeeping so a later gallery-
   *  image deletion (scrubImageFromMurals below) knows which murals it's
   *  actually responsible for; `coverImageUrl` is what's actually
   *  rendered, so the card doesn't need a separate fetch to resolve it. */
  coverImageId?: string;
  coverImageUrl?: string;
  /** Public share link state — same idempotent-share/plain-unshare shape
   *  as the library document's own shareToken/shareUrl (api/library.ts's
   *  LibraryDocument). null until shared; see hooks/useMurals.ts's
   *  share()/unshare(). */
  shareToken: string | null;
  shareUrl: string | null;
  folderId: string | null;
}

/** Assigns one of the account's uploaded gallery images as this mural's
 *  cover. A mural has no auto-detected fallback the way a book does
 *  (there's no Kobo CDN/Open Library equivalent to fall back to) — clearing
 *  just means "no cover," a plain card. */
export function setMuralCover(murals: Mural[], muralId: string, imageId: string, url: string): Mural[] {
  return murals.map((m) => (m.id === muralId ? { ...m, coverImageId: imageId, coverImageUrl: url } : m));
}

export function clearMuralCover(murals: Mural[], muralId: string): Mural[] {
  return murals.map((m) => {
    if (m.id !== muralId) return m;
    const { coverImageId: _droppedImageId, coverImageUrl: _droppedUrl, ...rest } = m;
    return rest;
  });
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m_${Math.random().toString(36).slice(2)}`;
}

// Canvas is GRID_COLUMNS wide; every block type gets a sensible starting
// footprint so "Add block" drops something reasonably-shaped rather than
// a 1x1 sliver the user has to resize before it's even legible.
export const GRID_COLUMNS = 12;
const DEFAULT_SIZE_BY_TYPE: Record<BlockType, { w: number; h: number }> = {
  spotlight: { w: 3, h: 4 },
  shelf: { w: 8, h: 4 },
  quote: { w: 4, h: 3 },
  quoteCollection: { w: 6, h: 4 },
  image: { w: 4, h: 3 },
  text: { w: 4, h: 2 },
  currentlyReading: { w: 4, h: 4 },
  stats: { w: 6, h: 2 },
  empty: { w: 3, h: 2 },
  // Five stacked tier rows each need enough height to read as a row, not
  // a sliver — noticeably taller than every other type's default.
  tierlist: { w: 10, h: 8 }
};

export function ensureBookBlockHeights(blocks: MuralBlock[]): MuralBlock[] {
  const boundaries = new Map<number, number>();
  for (const block of blocks) {
    const minimum = block.type === "shelf" || block.type === "currentlyReading" ? 4 : block.type === "tierlist" ? 8 : 0;
    const increase = Math.max(0, minimum - block.layout.h);
    if (increase > 0) {
      const boundary = block.layout.y + block.layout.h;
      boundaries.set(boundary, Math.max(boundaries.get(boundary) ?? 0, increase));
    }
  }
  if (boundaries.size === 0) return blocks;
  return blocks.map((block) => {
    const minimum = block.type === "shelf" || block.type === "currentlyReading" ? 4 : block.type === "tierlist" ? 8 : 0;
    const shift = [...boundaries].reduce((total, [boundary, amount]) => total + (block.layout.y >= boundary ? amount : 0), 0);
    return { ...block, layout: { ...block.layout, y: block.layout.y + shift, h: Math.max(block.layout.h, minimum) } };
  });
}

/** Where the next new footprint of size `w`×`h` lands: below everything
 *  already on the canvas, left-aligned — never overlapping existing
 *  blocks, so dropping something new is always safe without checking the
 *  canvas first. The user is free to drag it wherever they actually want
 *  afterward. Shared by both addBlock (a type's own default size) and
 *  duplicateBlock (the ORIGINAL block's actual current size, which may
 *  have been resized away from that default). */
function nextLayoutBelow(existing: MuralBlock[], w: number, h: number): BlockLayout {
  const y = existing.reduce((max, b) => Math.max(max, b.layout.y + b.layout.h), 0);
  return { x: 0, y, w, h };
}

function nextBlockLayout(existing: MuralBlock[], type: BlockType): BlockLayout {
  const { w, h } = DEFAULT_SIZE_BY_TYPE[type];
  return nextLayoutBelow(existing, w, h);
}

export function layoutsOverlap(a: BlockLayout, b: BlockLayout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function isValidBlockLayout(layout: BlockLayout, blocks: MuralBlock[], ignoreBlockId?: string): boolean {
  if (layout.x < 0 || layout.y < 0 || layout.w < 1 || layout.h < 1 || layout.x + layout.w > GRID_COLUMNS) return false;
  return !blocks.some((block) => block.id !== ignoreBlockId && layoutsOverlap(layout, block.layout));
}

export function findAvailableLayout(blocks: MuralBlock[], w: number, h: number, startY = 0): BlockLayout {
  const lastRow = blocks.reduce((max, block) => Math.max(max, block.layout.y + block.layout.h), startY);
  for (let y = Math.max(0, startY); y <= lastRow; y++) {
    for (let x = 0; x <= GRID_COLUMNS - w; x++) {
      const layout = { x, y, w, h };
      if (isValidBlockLayout(layout, blocks)) return layout;
    }
  }
  return { x: 0, y: lastRow, w, h };
}

export function screenPointToGrid(x: number, y: number, canvasWidth = 1200, margin = 10, padding = 10): { x: number; y: number } {
  const columnWidth = (canvasWidth - padding * 2 - margin * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  return {
    x: Math.max(0, Math.min(GRID_COLUMNS - 1, Math.round((x - padding) / (columnWidth + margin)))),
    y: Math.max(0, Math.round((y - padding) / (28 + margin)))
  };
}

/** Adds a new block of `type` (with default config for that type — the
 *  caller/picker fills in the real content right after via updateBlock,
 *  same "add then configure" flow as the rest of the app) at the next
 *  free spot on the canvas. Returns the new block's id alongside the
 *  updated murals list, since the caller (AddBlockMenu.tsx) needs it to
 *  immediately open that block's config panel. */
export function addBlock(murals: Mural[], muralId: string, type: BlockType): { murals: Mural[]; blockId: string } {
  const blockId = newId();
  const now = new Date().toISOString();
  const updated = murals.map((m) => {
    if (m.id !== muralId) return m;
    const layout = nextBlockLayout(m.blocks, type);
    const block = defaultBlockForType(blockId, type, layout);
    return { ...m, blocks: [...m.blocks, block], updatedAt: now };
  });
  return { murals: updated, blockId };
}

/** Copies a block — same type, same content, same style, a fresh id —
 *  landing below everything already on the canvas at the ORIGINAL
 *  block's own current size (`nextLayoutBelow`, not `nextBlockLayout`'s
 *  type-default size: a duplicate should match what you actually
 *  resized it to, not reset to a fresh block's starting footprint). No
 *  "configure this" step afterward, unlike addBlock — the whole point of
 *  duplicating is that it's already fully set up; you're free to drag it
 *  somewhere else or tweak it from there. Returns the SAME `murals`
 *  array reference if `blockId` doesn't resolve to a real block (the
 *  mural itself not found, or already deleted by the time this runs),
 *  same no-op convention as removeBlock/the scrub helpers. */
export function duplicateBlock(murals: Mural[], muralId: string, blockId: string): Mural[] {
  const now = new Date().toISOString();
  let changed = false;
  const result = murals.map((m) => {
    if (m.id !== muralId) return m;
    const original = m.blocks.find((b) => b.id === blockId);
    if (!original) return m;
    changed = true;
    const layout = nextLayoutBelow(m.blocks, original.layout.w, original.layout.h);
    const duplicate: MuralBlock = { ...original, id: newId(), layout };
    return { ...m, blocks: [...m.blocks, duplicate], updatedAt: now };
  });
  return changed ? result : murals;
}

function defaultBlockForType(id: string, type: BlockType, layout: BlockLayout): MuralBlock {
  switch (type) {
    case "spotlight":
      return { id, type, layout, bookKey: "" };
    case "shelf":
      return { id, type, layout, title: "", bookKeys: [] };
    case "quote":
      return { id, type, layout, bookKey: "", highlightId: "" };
    case "quoteCollection":
      return { id, type, layout, title: "", quotes: [] };
    case "image":
      return { id, type, layout, imageId: "" };
    case "text":
      return { id, type, layout, heading: "", body: "" };
    case "currentlyReading":
      return { id, type, layout };
    case "stats":
      return { id, type, layout, metrics: ["totalBooks", "booksFinished", "totalHighlights"] };
    case "empty":
      return { id, type, layout };
    case "tierlist":
      return { id, type, layout, tierlistId: "" };
  }
}

export function createBlockCandidate(type: BlockType, blocks: MuralBlock[]): MuralBlock {
  const { w, h } = DEFAULT_SIZE_BY_TYPE[type];
  return defaultBlockForType(newId(), type, findAvailableLayout(blocks, w, h));
}

export function createDuplicateCandidate(block: MuralBlock, blocks: MuralBlock[]): MuralBlock {
  return { ...block, id: newId(), layout: findAvailableLayout(blocks, block.layout.w, block.layout.h) };
}

/** Whole-object patch (like lib/groups.ts's setGroupStyle) — the caller
 *  (each block's config editor) is responsible for handing back a
 *  complete, correctly-typed block. Used for both "save this block's
 *  configured content" and "the canvas moved/resized this block"
 *  (MuralCanvas.tsx passes just `{...block, layout: newLayout}`). */
export function updateBlock(murals: Mural[], muralId: string, block: MuralBlock): Mural[] {
  const now = new Date().toISOString();
  return murals.map((m) => (m.id === muralId ? { ...m, blocks: m.blocks.map((b) => (b.id === block.id ? block : b)), updatedAt: now } : m));
}

export function removeBlock(murals: Mural[], muralId: string, blockId: string): Mural[] {
  const now = new Date().toISOString();
  let changed = false;
  const result = murals.map((m) => {
    if (m.id !== muralId) return m;
    const blocks = m.blocks.filter((b) => b.id !== blockId);
    if (blocks.length === m.blocks.length) return m;
    changed = true;
    return { ...m, blocks, updatedAt: now };
  });
  return changed ? result : murals;
}

/** Scrubs one or more deleted books' keys out of every mural that
 *  referenced them, across every affected block type — called alongside
 *  actually deleting the book(s) (see LibraryPage.tsx/GroupsPage.tsx's
 *  handleDeleteSelected, same call site lib/groups.ts's
 *  removeBooksFromAllGroups is used from). A block that has nothing left
 *  to show once its reference is gone (spotlight/quote pointing straight
 *  at the deleted book, or a shelf/quoteCollection left with zero
 *  members) is removed entirely rather than left empty — same reasoning
 *  as lib/bookCovers.ts falling back to auto-resolution rather than
 *  leaving a dangling cover URL. Returns the SAME `murals` array
 *  reference when nothing was actually affected, matching
 *  removeBooksFromAllGroups/scrubImageFromBooks's no-op convention. */
export function scrubBooksFromMurals(murals: Mural[], keys: Iterable<string>): Mural[] {
  const keySet = keys instanceof Set ? keys : new Set(keys);
  if (keySet.size === 0) return murals;

  let changed = false;
  const result = murals.map((m) => {
    const blocks = m.blocks
      .map((b): MuralBlock | null => {
        if (b.type === "spotlight" || b.type === "quote") {
          return keySet.has(b.bookKey) ? null : b;
        }
        if (b.type === "shelf") {
          const bookKeys = b.bookKeys.filter((k) => !keySet.has(k));
          if (bookKeys.length === b.bookKeys.length) return b;
          return bookKeys.length === 0 ? null : { ...b, bookKeys };
        }
        if (b.type === "quoteCollection") {
          const quotes = b.quotes.filter((q) => !keySet.has(q.bookKey));
          if (quotes.length === b.quotes.length) return b;
          return quotes.length === 0 ? null : { ...b, quotes };
        }
        return b;
      })
      .filter((b): b is MuralBlock => b !== null);

    if (blocks.length === m.blocks.length && blocks.every((b, i) => b === m.blocks[i])) return m;
    changed = true;
    return { ...m, blocks, updatedAt: new Date().toISOString() };
  });

  return changed ? result : murals;
}

/** Same idea as scrubBooksFromMurals, for a deleted gallery image —
 *  called alongside hooks/useDeleteGalleryImage.ts. Two separate things
 *  can reference a gallery image on a mural: an `image` BLOCK (removed
 *  outright — an image block IS the image, so unlike a book cover
 *  there's no sensible fallback to render) and the mural's OWN cover
 *  (cleared via clearMuralCover, same "falls back to a plain card"
 *  outcome clearBookCover gives a book). Both checked in the same pass so
 *  a mural using the same image for both its cover and an Image block
 *  gets scrubbed correctly either way. */
export function scrubImageFromMurals(murals: Mural[], imageId: string): Mural[] {
  let changed = false;
  const result = murals.map((m) => {
    const blocks = m.blocks.filter((b) => !(b.type === "image" && b.imageId === imageId));
    const blocksChanged = blocks.length !== m.blocks.length;
    const coverChanged = m.coverImageId === imageId;
    if (!blocksChanged && !coverChanged) return m;
    changed = true;
    const next: Mural = { ...m, blocks, updatedAt: new Date().toISOString() };
    if (coverChanged) {
      delete next.coverImageId;
      delete next.coverImageUrl;
    }
    return next;
  });
  return changed ? result : murals;
}

/** Resolves a shelf's bookKeys back to actual book objects, in order — a
 *  key with no matching book (deleted some other way, or a merge quirk)
 *  is silently dropped rather than crashing the block, same tolerant
 *  convention as lib/groups.ts's booksInGroup. */
export function resolveShelfBooks(block: Extract<MuralBlock, { type: "shelf" }>, books: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  const resolved: Array<Record<string, unknown>> = [];
  for (const key of block.bookKeys) {
    const book = byKey.get(key);
    if (book) resolved.push(book);
  }
  return resolved;
}

/** Resolves a `quote` block's book + the specific highlight within it —
 *  `null` if either no longer resolves (book deleted through some other
 *  path, or the highlight id no longer exists on it). */
export function resolveQuote(
  block: Extract<MuralBlock, { type: "quote" }>,
  books: Array<Record<string, unknown>>
): { book: Record<string, unknown>; highlight: Record<string, unknown> } | null {
  const book = books.find((b) => bookKey(b) === block.bookKey);
  if (!book) return null;
  const highlights = Array.isArray(book.highlights) ? (book.highlights as Array<Record<string, unknown>>) : [];
  const highlight = highlights.find((h) => String(h.BookmarkID) === block.highlightId);
  if (!highlight) return null;
  return { book, highlight };
}

/** Same as resolveQuote, but for every entry in a `quoteCollection`
 *  block — entries that no longer resolve are silently dropped. */
export function resolveQuoteCollection(
  block: Extract<MuralBlock, { type: "quoteCollection" }>,
  books: Array<Record<string, unknown>>
): Array<{ book: Record<string, unknown>; highlight: Record<string, unknown> }> {
  const resolved: Array<{ book: Record<string, unknown>; highlight: Record<string, unknown> }> = [];
  for (const ref of block.quotes) {
    const found = resolveQuote({ id: block.id, type: "quote", layout: block.layout, bookKey: ref.bookKey, highlightId: ref.highlightId }, books);
    if (found) resolved.push(found);
  }
  return resolved;
}

export interface MuralFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}
