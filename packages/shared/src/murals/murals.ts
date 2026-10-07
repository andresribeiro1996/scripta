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
// it points at is deleted (see scrubBooksFromMurals in blockKinds.ts and scrubImageFromMurals
// below, called alongside the book-delete and gallery-image-delete flows
// in LibraryPage.tsx/GroupsPage.tsx/useDeleteGalleryImage.ts).

import type { BlockStyle } from "../library/libraryStyle.js";
import type { BookGenre } from "../library/bookGenres.js";
import { bookKey } from "../library/merge.js";
import { THEME_IDS, type ThemeId } from "../themes/palettes.js";
import { blockLabel, blockSize, minBlockHeight, newBlock } from "./blockKinds.js";

export * from "./blockKinds.js";

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
  expandedFrom?: Partial<BlockLayout>;
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
  | (MuralBlockBase & { type: "shelf"; title: string; bookKeys: string[]; collectionId?: string; role?: "finished" | "favourites" })
  | (MuralBlockBase & { type: "quote"; bookKey: string; highlightId: string; mode?: "rediscover" })
  | (MuralBlockBase & { type: "quoteCollection"; title: string; quotes: QuoteRef[] })
  | (MuralBlockBase & { type: "image"; imageId: string; caption?: string })
  | (MuralBlockBase & { type: "text"; heading?: string; body?: string })
  | (MuralBlockBase & { type: "profile"; bio: string; favoriteGenres: BookGenre[] })
  | (MuralBlockBase & { type: "currentlyReading" })
  | (MuralBlockBase & { type: "stats"; metrics: StatMetric[] })
  | (MuralBlockBase & { type: "empty" })
  | (MuralBlockBase & { type: "tierlist"; tierlistId: string })
  | (MuralBlockBase & { type: "readerCard" });

export type BlockType = MuralBlock["type"];

export interface ReaderProfile {
  username: string;
  avatarUrl: string | null;
}

export function muralBlockTitle(block: MuralBlock, books: Array<Record<string, unknown>>, tierlistName?: string) {
  if (block.type === "text") return block.heading || "Note";
  if (block.type === "shelf" || block.type === "quoteCollection") return block.title || blockLabel(block.type);
  if (block.type === "spotlight") return String(books.find((book) => bookKey(book) === block.bookKey)?.Title ?? "Book spotlight");
  if (block.type === "image") return block.caption || "Image";
  if (block.type === "tierlist") return tierlistName || "Tier list";
  return blockLabel(block.type);
}

export interface Mural {
  id: string;
  name: string;
  theme: ThemeId;
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
  coverImageId?: string | null;
  coverImageUrl?: string | null;
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

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m_${Math.random().toString(36).slice(2)}`;
}

// Canvas is GRID_COLUMNS wide; every block type gets a sensible starting
// footprint so "Add block" drops something reasonably-shaped rather than
// a 1x1 sliver the user has to resize before it's even legible.
export const GRID_COLUMNS = 12;

export function ensureBookBlockHeights(blocks: MuralBlock[]): MuralBlock[] {
  const boundaries = new Map<number, number>();
  for (const block of blocks) {
    const minimum = minBlockHeight(block.type);
    const increase = Math.max(0, minimum - block.layout.h);
    if (increase > 0) {
      const boundary = block.layout.y + block.layout.h;
      boundaries.set(boundary, Math.max(boundaries.get(boundary) ?? 0, increase));
    }
  }
  if (boundaries.size === 0) return blocks;
  return blocks.map((block) => {
    const minimum = minBlockHeight(block.type);
    const shift = [...boundaries].reduce((total, [boundary, amount]) => total + (block.layout.y >= boundary ? amount : 0), 0);
    return withMuralBlockLayout(block, { ...block.layout, y: block.layout.y + shift, h: Math.max(block.layout.h, minimum) });
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
  const { w, h } = blockSize(type);
  return nextLayoutBelow(existing, w, h);
}

export function layoutsOverlap(a: BlockLayout, b: BlockLayout): boolean {
  "worklet";
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function isValidBlockLayout(layout: BlockLayout, blocks: MuralBlock[], ignoreBlockId?: string): boolean {
  "worklet";
  if (layout.x < 0 || layout.y < 0 || layout.w < 1 || layout.h < 1 || layout.x + layout.w > GRID_COLUMNS) return false;
  return !blocks.some((block) => block.id !== ignoreBlockId && layoutsOverlap(layout, block.layout));
}

export function withMuralBlockLayout(block: MuralBlock, layout: BlockLayout): MuralBlock {
  "worklet";
  const { expandedFrom, ...rest } = block;
  const remaining = { ...expandedFrom };
  if (layout.w !== block.layout.w) { delete remaining.w; delete remaining.x; }
  else if (remaining.x !== undefined) remaining.x += layout.x - block.layout.x;
  if (layout.h !== block.layout.h) { delete remaining.h; delete remaining.y; }
  else if (remaining.y !== undefined) remaining.y += layout.y - block.layout.y;
  return { ...rest, layout, ...(Object.keys(remaining).length ? { expandedFrom: remaining } : {}) };
}

export function compactMuralBlocks(blocks: MuralBlock[]): MuralBlock[] {
  "worklet";
  if (blocks.some((block) => !Object.values(block.layout).every(Number.isSafeInteger) || !isValidBlockLayout(block.layout, []))) return blocks;
  const placed = new Map<string, BlockLayout>();
  for (const block of [...blocks].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)) {
    let y = 0;
    for (const other of placed.values()) {
      if (block.layout.x < other.x + other.w && other.x < block.layout.x + block.layout.w) y = Math.max(y, other.y + other.h);
    }
    placed.set(block.id, y === block.layout.y ? block.layout : { ...block.layout, y });
  }
  if (blocks.every((block) => placed.get(block.id) === block.layout)) return blocks;
  return blocks.map((block) => placed.get(block.id) === block.layout ? block : withMuralBlockLayout(block, placed.get(block.id)!));
}

export function toggleMuralBlockExpansion(blocks: MuralBlock[], blockId: string, axis: "w" | "h", bottom: number, top = 0): MuralBlock[] {
  const block = blocks.find((item) => item.id === blockId);
  if (!block || !Object.values(block.layout).every(Number.isSafeInteger) || !isValidBlockLayout(block.layout, blocks, blockId)) return blocks;
  const { layout, expandedFrom, ...rest } = block;
  const previous = expandedFrom?.[axis];
  const restore = Number.isSafeInteger(previous) && previous! > 0 && previous! <= layout[axis];
  const position = axis === "w" ? "x" : "y";
  let start = axis === "w" ? 0 : Math.min(layout.y, Math.max(0, Math.ceil(top)));
  let end = axis === "w" ? GRID_COLUMNS : Math.max(layout.y + layout.h, Math.floor(bottom));
  if (restore) {
    const original = expandedFrom?.[position] ?? layout[position];
    if (!Number.isSafeInteger(original) || original < layout[position] || original + previous! > layout[position] + layout[axis]) return blocks;
    start = original;
    end = original + previous!;
  }
  if (!restore) {
    for (const other of blocks) {
      if (other.id === blockId) continue;
      const candidate = other.layout;
      const overlaps = axis === "w" ? layout.y < candidate.y + candidate.h && candidate.y < layout.y + layout.h : layout.x < candidate.x + candidate.w && candidate.x < layout.x + layout.w;
      if (!overlaps) continue;
      if (candidate[position] + candidate[axis] <= layout[position]) start = Math.max(start, candidate[position] + candidate[axis]);
      if (candidate[position] >= layout[position] + layout[axis]) end = Math.min(end, candidate[position]);
    }
  }
  const next = { ...layout, [position]: start, [axis]: end - start };
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(next[axis]) || !isValidBlockLayout(next, blocks, blockId) || (!restore && next[axis] === layout[axis])) return blocks;
  const remembered = { ...expandedFrom };
  if (restore) { delete remembered[axis]; delete remembered[position]; }
  else { remembered[axis] = layout[axis]; remembered[position] = layout[position]; }
  const updated: MuralBlock = { ...rest, layout: next, ...(Object.keys(remembered).length ? { expandedFrom: remembered } : {}) };
  return blocks.map((item) => item.id === blockId ? updated : item);
}

export function moveMuralBlock(blocks: MuralBlock[], blockId: string, layout: BlockLayout): MuralBlock[] {
  "worklet";
  const moving = blocks.find((block) => block.id === blockId);
  if (!moving || !Object.values(layout).every(Number.isSafeInteger) || !isValidBlockLayout(layout, [])) return blocks;
  if (Object.keys(layout).every((key) => layout[key as keyof BlockLayout] === moving.layout[key as keyof BlockLayout]) && isValidBlockLayout(layout, blocks, blockId)) return compactMuralBlocks(blocks);
  if (Math.abs(layout.x - moving.layout.x) > Math.abs(layout.y - moving.layout.y) && layout.w === moving.layout.w && layout.h === moving.layout.h && isValidBlockLayout(moving.layout, blocks, blockId)) {
    const swap = blocks.find((block) => block.id !== blockId && block.layout.y === moving.layout.y
      && (layout.x - moving.layout.x) * (block.layout.x - moving.layout.x) > 0
      && layout.x < block.layout.x + block.layout.w && block.layout.x < layout.x + layout.w
      && isValidBlockLayout(block.layout, blocks, block.id));
    if (swap) {
      const right = swap.layout.x > moving.layout.x;
      const moved = { ...moving.layout, x: right ? swap.layout.x + swap.layout.w - layout.w : swap.layout.x };
      const swapped = { ...swap.layout, x: right ? moving.layout.x : moving.layout.x + moving.layout.w - swap.layout.w };
      const next = blocks.map((block) => {
        if (block.id === blockId) return withMuralBlockLayout(block, moved);
        if (block.id === swap.id) return withMuralBlockLayout(block, swapped);
        if (moving.layout.w !== swap.layout.w && block.layout.y === moving.layout.y && block.layout.x > Math.min(moving.layout.x, swap.layout.x) && block.layout.x < Math.max(moving.layout.x, swap.layout.x)) {
          return withMuralBlockLayout(block, { ...block.layout, x: block.layout.x + (right ? swap.layout.w - moving.layout.w : moving.layout.w - swap.layout.w) });
        }
        return block;
      });
      if (next.every((block) => isValidBlockLayout(block.layout, next, block.id))) {
        const overlap = Math.min(layout.x + layout.w, swap.layout.x + swap.layout.w) - Math.max(layout.x, swap.layout.x);
        if (overlap < Math.min(layout.w, swap.layout.w) / 2) return blocks;
        return compactMuralBlocks(next);
      }
    }
  }
  if (layout.y > moving.layout.y && layout.w === moving.layout.w && layout.h === moving.layout.h) {
    const crossed = blocks.filter((block) => block.id !== blockId && block.layout.y >= moving.layout.y + moving.layout.h
      && layout.x < block.layout.x + block.layout.w && block.layout.x < layout.x + layout.w
      && layout.y + layout.h > block.layout.y);
    if (crossed.length) layout = { ...layout, y: Math.max(layout.y, ...crossed.map((block) => block.layout.y + block.layout.h)) };
  }
  const placed = new Map<string, BlockLayout>([[blockId, layout]]);
  const others = blocks.filter((block) => block.id !== blockId).sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  for (const block of others) {
    let next = block.layout;
    let collisions = [...placed.values()].filter((item) => layoutsOverlap(next, item));
    while (collisions.length) {
      next = { ...next, y: Math.max(...collisions.map((item) => item.y + item.h)) };
      collisions = [...placed.values()].filter((item) => layoutsOverlap(next, item));
    }
    placed.set(block.id, next);
  }
  return compactMuralBlocks(blocks.map((block) => placed.get(block.id) === block.layout ? block : withMuralBlockLayout(block, placed.get(block.id)!)));
}

export function muralDragScrollSpeed(pointerY: number, top: number, bottom: number): number {
  "worklet";
  const edge = Math.min(64, (bottom - top) / 3);
  if (edge <= 0) return 0;
  if (pointerY < top + edge) return -420 * Math.min(1, (top + edge - pointerY) / edge) ** 2;
  if (pointerY > bottom - edge) return 420 * Math.min(1, (pointerY - bottom + edge) / edge) ** 2;
  return 0;
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
    const block = newBlock(blockId, type, layout);
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
    const duplicate: MuralBlock = { ...withMuralBlockLayout(original, layout), id: newId() };
    return { ...m, blocks: [...m.blocks, duplicate], updatedAt: now };
  });
  return changed ? result : murals;
}

export function createBlockCandidate(type: BlockType, blocks: MuralBlock[]): MuralBlock {
  const { w, h } = blockSize(type);
  return newBlock(newId(), type, findAvailableLayout(blocks, w, h));
}

export function muralThemeId(theme: unknown): ThemeId {
  return THEME_IDS.find((id) => id === theme) ?? "light";
}

export function profileOnlyMural(theme: ThemeId): Mural {
  const block = createBlockCandidate("profile", []);
  return { id: "profile", name: "", theme, blocks: [{ ...block, layout: { x: 0, y: 0, w: GRID_COLUMNS, h: 3 } }], createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null };
}

export function createDuplicateCandidate(block: MuralBlock, blocks: MuralBlock[]): MuralBlock {
  return { ...withMuralBlockLayout(block, findAvailableLayout(blocks, block.layout.w, block.layout.h)), id: newId() };
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
  const highlight = highlights.find((h) => h && typeof h === "object" && String(h.BookmarkID) === block.highlightId);
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
