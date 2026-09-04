import { useState } from "react";
import { CoverImage } from "../../BookCard";
import { bookKey } from "../../../lib/merge";
import { resolveShelfBooks, type MuralBlock, type TierDefinition } from "../../../lib/murals";
import { OptionsMenu, type OptionsMenuItem } from "../../OptionsMenu";

/** A small, read-only cover tile — reuses BookCard's own CoverImage (same
 *  Kobo/Open Library/gallery-assigned resolution chain) but with none of
 *  BookCard's interactive chrome (drag, Style/Cover buttons, selection),
 *  which would actively conflict with react-grid-layout's own drag
 *  handling inside a mural block anyway.
 *
 *  Text sizes here (and throughout every block view in this directory)
 *  are `em`, not Tailwind's rem-based text-* utilities — `em` is relative
 *  to the INHERITED font-size, which is exactly how a block's `fontSize`
 *  setting (MuralCanvas.tsx, applied on the block wrapper) reaches every
 *  text element inside it; `rem` measures against the document root and
 *  wouldn't respond to a per-block setting at all. The title has no
 *  explicit color, so it inherits the block's (possibly customized)
 *  `textColor` — the author line keeps its own muted color regardless,
 *  same as everywhere else in this app that a secondary/meta line stays
 *  dim on purpose. `showTitle`/`showAuthor` both default to true (Shelf/
 *  Currently-reading want both) but the tier list passes both `false` —
 *  a tier's whole point is scanning many small covers at once, and at
 *  that tile size any text line was mostly just a truncated fragment
 *  eating into the cover art's own room, not adding legible information.
 *  When NEITHER shows, the footer strip itself is skipped entirely
 *  (rather than rendering an empty `<div>`) so the cover gets the tile's
 *  full height, not just what's left after a blank footer.
 *
 *  `fit="contain"` (not CoverImage's own default `"cover"`) — every
 *  MiniBookTile usage is a small, fixed-size box that rarely matches a
 *  cover's actual proportions, so cropping to fill was cutting real
 *  content off the top/bottom or sides of small covers. The tile's own
 *  `bg-(--color-border)` (right below) does double duty as the letterbox
 *  color behind whatever gap `contain` leaves, not just the no-cover
 *  placeholder background it already was. */
export function MiniBookTile({
  book,
  showTitle = true,
  showAuthor = true
}: {
  book: Record<string, unknown>;
  showTitle?: boolean;
  showAuthor?: boolean;
}) {
  const showFooter = showTitle || showAuthor;
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg">
      <div className={`relative min-h-0 overflow-hidden bg-(--color-border) ${showFooter ? "flex-1" : "h-full"}`}>
        <CoverImage book={book} fit="contain" />
      </div>
      {showFooter && (
        <div className="shrink-0 px-1.5 py-1">
          {showTitle && <div className="truncate text-[0.75em] font-medium leading-tight">{String(book.Title ?? "Untitled")}</div>}
          {showAuthor && <div className="truncate text-[0.65em] text-(--color-text-dim)">{String(book.Attribution ?? "Unknown author")}</div>}
        </div>
      )}
    </div>
  );
}

/** One book, given the most room a mural block can offer it — the "big
 *  cover + optional caption" spotlight case. */
export function SpotlightBlockView({ block, books }: { block: Extract<MuralBlock, { type: "spotlight" }>; books: Array<Record<string, unknown>> }) {
  const book = books.find((b) => bookKey(b) === block.bookKey);
  if (!book) {
    return <EmptyBlockState message="Pick a book for this spotlight." />;
  }
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-(--color-border)">
        <CoverImage book={book} />
      </div>
      <div className="shrink-0 px-2.5 py-2">
        <div className="truncate text-[1.1em] font-semibold">{String(book.Title ?? "Untitled")}</div>
        <div className="truncate text-[0.85em] text-(--color-text-dim)">{String(book.Attribution ?? "Unknown author")}</div>
        {block.caption && <p className="mt-1 text-[0.85em]">{block.caption}</p>}
      </div>
    </div>
  );
}

/** A titled, ordered row of hand-picked books — the "Top 5 Books This
 *  Year" case. Horizontally scrollable rather than wrapping, so it stays
 *  a genuine "shelf" regardless of the block's width. */
export function ShelfBlockView({ block, books }: { block: Extract<MuralBlock, { type: "shelf" }>; books: Array<Record<string, unknown>> }) {
  const resolved = resolveShelfBooks(block, books);
  return (
    <div className="flex h-full flex-col overflow-hidden p-2.5">
      <div className="mb-1.5 shrink-0 truncate text-[1.1em] font-semibold">{block.title || "Untitled shelf"}</div>
      {resolved.length === 0 ? (
        <EmptyBlockState message="No books picked yet." />
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto">
          {resolved.map((book, i) => (
            <div key={String(book.ContentID ?? i)} className="aspect-[2/3] h-full shrink-0 overflow-hidden">
              <MiniBookTile book={book} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Auto-computed, no picker at all — every book with ReadStatus === 1. */
export function CurrentlyReadingBlockView({ books }: { books: Array<Record<string, unknown>> }) {
  const reading = books.filter((b) => b.ReadStatus === 1);
  return (
    <div className="flex h-full flex-col overflow-hidden p-2.5">
      <div className="mb-1.5 shrink-0 text-[1.1em] font-semibold">Currently reading</div>
      {reading.length === 0 ? (
        <EmptyBlockState message="Nothing marked as reading right now." />
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto">
          {reading.map((book, i) => (
            <div key={String(book.ContentID ?? i)} className="aspect-[2/3] h-full shrink-0 overflow-hidden">
              <MiniBookTile book={book} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One rung of the tier list — a fixed-width colored label on the left
 *  (the tier's own color, white bold text; no auto-contrast calculation,
 *  same deliberate choice DEFAULT_TIER_PRESET's own comment in
 *  lib/murals.ts explains) and its books on the right, WRAPPING onto
 *  additional lines rather than scrolling — deliberately the opposite of
 *  ShelfBlockView's horizontal scroll. A shelf is a hand-curated, ordered
 *  sequence where order and "which ones are visible first" matter, so
 *  scrolling (never reflowing the row's own height) is right for it; a
 *  tier is closer to a bucket you keep piling books into, where the whole
 *  point is seeing every book on that rung at a glance, not scrubbing
 *  through it — so a rung with more books than fit on one line simply
 *  grows taller (`flex-wrap`) instead of hiding the overflow behind a
 *  scrollbar. Each cover tile gets a fixed height (`h-24`, not `h-full`)
 *  specifically so this works: an intrinsic height lets the row's own
 *  height be DERIVED from how many lines its tiles wrap onto, whereas
 *  `h-full` would need a height from its parent that doesn't exist yet —
 *  a circular dependency the old fixed-height/scroll design never had to
 *  resolve. `items-stretch` on the row then stretches the color label to
 *  match, so it stays full-height regardless of how many lines a rung's
 *  covers wrap onto. Rendered even when empty — a tier list's whole point
 *  is showing every configured rung, blank ones included, not hiding the
 *  ones nobody's filled in yet.
 *
 *  The label itself needs its OWN `overflow-hidden` (not just the row's) —
 *  a label is free-typed text, so a long single "word" with no spaces to
 *  wrap on (no whitespace for the browser's normal line-breaking) would
 *  otherwise render past the edge of its fixed `w-12` box and visibly
 *  bleed into the books next to it, since a flex child's own overflow is
 *  visible by default regardless of its parent's. `break-words` (so it
 *  wraps mid-word once nothing else will fit) plus `line-clamp-3` (so a
 *  genuinely long label clips with an ellipsis rather than pushing the
 *  row's height around on its own) keep it fully contained either way.
 *
 *  Every cover tile is `w-16 h-24` — a fixed pixel box, not `aspect-[2/3]`
 *  computed from height alone — plus its OWN `overflow-hidden`, for the
 *  same reason the label needs one: this is `flex-wrap`, so a tile's own
 *  intrinsic box directly determines the grid every book lines up against.
 *  `MiniBookTile`'s title/author use `truncate` (`white-space: nowrap`),
 *  and a flex item's "automatic minimum size" is its CONTENT's min-content
 *  width unless that item's own `overflow` is non-`visible` — so without
 *  `overflow-hidden` right here, a book with a long title/author (whose
 *  nowrap text can't shrink) silently forced its OWN tile wider than every
 *  other book's, since the aspect-ratio-derived width was only ever a
 *  *hint*, not a floor. Reported live as "some books have a bigger width
 *  in a tier list" — same bug existed in Shelf/Currently-reading's tiles
 *  too (`aspect-[2/3] h-full`), just harder to notice there since a
 *  horizontally-scrolling row has no neighboring line for a too-wide tile
 *  to visibly misalign against; both got the identical `overflow-hidden`
 *  fix for consistency, even though only the tier list version was ever
 *  actually reported as visibly wrong.
 *
 *  Title AND author both omitted (`showTitle={false} showAuthor={false}`)
 *  — at a tier tile's small footprint, a text footer (of either one line
 *  or two) was mostly just a truncated fragment eating into the cover
 *  art's own room, not adding legible information; dropping both lets
 *  `MiniBookTile` skip the footer strip entirely, so the cover fills the
 *  whole tile. `h-24` (having briefly been `h-28` — bumped up when the
 *  tile still carried a title line, then brought back down once that
 *  line was removed too) is a deliberately compact height now that
 *  there's no text competing for room at all.
 *
 *  In edit mode, every tile ALSO becomes a live drag source (see
 *  DraggableTierTile below) — the same `w-16 h-24` cover tile, just
 *  wrapped in `draggable` plus a small hover-revealed ⋮ menu, so ranking
 *  by dragging (or tapping the menu on touch) happens right here on the
 *  canvas rather than in a separate modal. View mode keeps the plain,
 *  non-interactive tile — nothing to drag when nobody's editing. */
function TierRow({
  tier,
  books,
  editMode,
  isDragOver,
  dropZoneProps,
  dragOverTileKey,
  tileDropProps,
  otherTiers,
  onMoveBook
}: {
  tier: TierDefinition;
  books: Array<Record<string, unknown>>;
  editMode: boolean;
  isDragOver: boolean;
  dropZoneProps: React.HTMLAttributes<HTMLDivElement>;
  dragOverTileKey: string | null;
  tileDropProps: (beforeKey: string) => React.HTMLAttributes<HTMLDivElement>;
  otherTiers: TierDefinition[];
  onMoveBook: (key: string, destination: { type: "pool"; beforeKey?: string } | { type: "tier"; tierId: string; beforeKey?: string }) => void;
}) {
  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  // Walking `tier.bookKeys` directly (not filtering to resolved books
  // first) so each tile still knows its own real bookKey string for
  // drag/menu purposes — a dangling reference (book deleted some other
  // way) is silently skipped, same tolerant convention resolveShelfBooks
  // already uses for a shelf.
  const resolvedKeys = tier.bookKeys.filter((k) => byKey.has(k));
  return (
    <div
      {...(editMode ? dropZoneProps : {})}
      className={`mural-tierlist-editor flex shrink-0 items-stretch gap-2 overflow-hidden rounded-lg border transition-colors ${
        editMode && isDragOver ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border)"
      }`}
    >
      <div
        className="flex w-[3em] shrink-0 items-center justify-center overflow-hidden p-1 text-center text-[0.9em] leading-tight font-bold break-words text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]"
        style={{ backgroundColor: tier.color }}
      >
        <span className="line-clamp-3">{tier.label || "—"}</span>
      </div>
      {resolvedKeys.length === 0 ? (
        <div className="flex min-h-[4em] flex-1 items-center px-2 text-[0.75em] text-(--color-text-dim)">
          {editMode ? "Drag a book here from the pool." : "No books on this tier."}
        </div>
      ) : (
        <div className="flex flex-1 flex-wrap content-start gap-1.5 p-1.5">
          {resolvedKeys.map((key) => {
            const book = byKey.get(key)!;
            if (!editMode) {
              return (
                <div key={key} className="h-[6em] w-[4em] shrink-0 overflow-hidden">
                  <MiniBookTile book={book} showTitle={false} showAuthor={false} />
                </div>
              );
            }
            return (
              <DraggableTierTile
                key={key}
                book={book}
                bookKeyStr={key}
                isDragOver={dragOverTileKey === key}
                dropProps={tileDropProps(key)}
                menuItems={[
                  ...otherTiers.map((t) => ({ label: `Move to ${t.label || "Untitled tier"}`, onClick: () => onMoveBook(key, { type: "tier", tierId: t.id }) })),
                  { label: "Return to pool", onClick: () => onMoveBook(key, { type: "pool" }) }
                ]}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One draggable, rankable book — the same `w-16 h-24` cover tile every
 *  tier row already renders (`MiniBookTile`), just wrapped in plain HTML5
 *  drag-and-drop (`draggable` + `dataTransfer`, the exact convention
 *  BookCard.tsx's own shelf-reorder drag already uses) plus a small
 *  hover-revealed ⋮ menu (`OptionsMenu`, reused rather than rebuilt).
 *  Native HTML5 drag has no real touch equivalent, so the menu is never
 *  optional polish — it's the only way to rank a book at all on a device
 *  that can't drag. Used identically by a tier's own tiles and the pool's
 *  own tiles below, so a book looks and behaves the same regardless of
 *  which side of "ranked" it's currently on.
 *
 *  Every tile is ALSO a drop target (`dropProps`, wired up by the caller
 *  — see `tileDropProps`/`moveBook` in TierListBlockView) — not just the
 *  row/pool container around it. Dropping directly on a tile SWAPS the
 *  dragged book with it (each takes the other's exact slot), which is
 *  what actually makes moving a book backward/earlier possible — an
 *  earlier version instead removed the dragged book and re-inserted it
 *  before the target, which shifts every book BETWEEN the two spots over
 *  by one rather than trading places; reported live as the dragged book
 *  visibly sliding rightward instead of the two actually swapping.
 *  Dropping on the row/pool's own background (no specific tile under the
 *  cursor) still just appends at the end, same as always. `stopPropagation()`
 *  on this tile's own dragover/drop keeps the row-level handler from ALSO firing for the
 *  same event and re-appending the book a second time. */
export function DraggableTierTile({
  book,
  bookKeyStr,
  menuItems,
  isDragOver,
  dropProps
}: {
  book: Record<string, unknown>;
  bookKeyStr: string;
  menuItems: OptionsMenuItem[];
  isDragOver: boolean;
  dropProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", bookKeyStr);
        e.dataTransfer.effectAllowed = "move";
      }}
      {...dropProps}
      title="Drag to a tier, or use the ⋮ menu"
      className={`group/tile relative h-[6em] w-[4em] shrink-0 cursor-grab overflow-hidden rounded-lg active:cursor-grabbing ${
        isDragOver ? "ring-2 ring-(--color-accent)" : ""
      }`}
    >
      <MiniBookTile book={book} showTitle={false} showAuthor={false} />
      <div className="absolute top-0.5 right-0.5 opacity-0 transition-opacity group-hover/tile:opacity-100">
        <OptionsMenu
          items={menuItems}
          title="Move this book"
          triggerClassName="flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(10,8,6,0.72)] text-white backdrop-blur-xs"
        />
      </div>
    </div>
  );
}

/** A ranked tier list — every configured tier stacked in its own natural
 *  (not evenly-split) height, so a packed rung grows taller via
 *  TierRow's own wrapping while a thin/empty one stays compact, and the
 *  whole stack scrolls vertically (`overflow-y-auto`) once it outgrows
 *  the block's own allotted height — the same "the block scrolls as a
 *  whole once its content doesn't fit" behavior every other tall mural
 *  block already falls back on, rather than trying to cram every rung
 *  into a fixed evenly-divided slot the way an early version of this
 *  view did.
 *
 *  **In edit mode, this is a live ranking board, not just a display** —
 *  an "unranked pool" panel renders below the tiers WHEN there's anything
 *  in it (see the trailing block in the JSX below — empty, it renders
 *  nothing at all, rather than sitting there as permanent dead chrome
 *  most of the time it's actually in use), and every tile everywhere is
 *  draggable: pull one out of the pool into any tier, move it between
 *  tiers, or drag it back down to unrank it. Dropping directly on
 *  another tile SWAPS the two books' exact positions (`moveBook`'s
 *  `beforeKey`, resolved via `locate`) rather than always appending —
 *  which is what makes moving a book EARLIER in a row possible, not just
 *  later; dropping on a row/pool's own empty background still appends at
 *  the end, same as always. `moveBook` is the one function every one of
 *  those gestures (and every tile's own ⋮ menu fallback) routes
 *  through, so a book can never end up duplicated or orphaned regardless
 *  of where it started or which gesture moved it.
 *  `onUpdateBlock` persists the change immediately on drop/click (not
 *  continuously mid-drag) — same "only the final state of a gesture
 *  needs to round-trip to the saved document" principle
 *  MuralCanvas.tsx's own block-position dragging already follows.
 *
 *  Edit-mode-only: nobody just viewing the finished mural should see a
 *  pile of not-yet-ranked books, or be able to drag anything — View mode
 *  renders the plain tiers-only board from before, unchanged.
 *
 *  `.mural-tierlist-editor` (on both a tier row and the pool panel below)
 *  is matched by MuralCanvas.tsx's own `draggableCancel` selector —
 *  without it, `react-grid-layout` would treat any mousedown inside this
 *  editor as the start of a drag to REPOSITION THE WHOLE BLOCK (RGL makes
 *  an entire grid item draggable from anywhere inside it by default), and
 *  our own native HTML5 drag-and-drop would never get a chance to fire.
 *  Excluding just this inner region — not the block's title bar above it
 *  — means the block itself is still fully repositionable by dragging
 *  from anywhere else in it, exactly like every other block. */
export function TierListBlockView({
  block,
  books,
  editMode = false,
  onUpdateBlock
}: {
  block: Extract<MuralBlock, { type: "tierlist" }>;
  books: Array<Record<string, unknown>>;
  editMode?: boolean;
  onUpdateBlock?: (block: MuralBlock) => void;
}) {
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  // Which specific TILE (by bookKey) is currently being dragged over —
  // separate from `dragOverTarget` above (which tracks the coarser row/
  // pool container). Lets a drop SWAP with that exact book instead of
  // always appending at the end of whatever row/pool it's dropped into.
  const [dragOverTileKey, setDragOverTileKey] = useState<string | null>(null);

  // Finds where a bookKey currently lives — needed to tell "dropped on a
  // tile in the SAME row it's already in" (a reorder) apart from
  // "dropped on a tile in a DIFFERENT row" (a move into that row), which
  // `moveBook` below treats differently.
  function locate(k: string): { type: "pool"; index: number } | { type: "tier"; tierId: string; index: number } | null {
    const poolIndex = block.pool.indexOf(k);
    if (poolIndex !== -1) return { type: "pool", index: poolIndex };
    for (const t of block.tiers) {
      const index = t.bookKeys.indexOf(k);
      if (index !== -1) return { type: "tier", tierId: t.id, index };
    }
    return null;
  }

  function replaceAt(arr: string[], index: number, value: string): string[] {
    const copy = [...arr];
    copy[index] = value;
    return copy;
  }

  // `beforeKey`, when given, means "this was dropped directly on that
  // tile" (see DraggableTierTile's own comment) rather than on the row/
  // pool's own empty background. What that does depends on whether the
  // dragged book and `beforeKey` started in the SAME row:
  //  - same row (reordering) → a true SWAP: the two books trade exact
  //    positions. Reported live as wrong when this was still "remove,
  //    then insert before" — that shifts every book BETWEEN the two
  //    spots over by one instead of just trading the two, so a book
  //    dragged onto an earlier neighbor visibly slid rightward rather
  //    than the two actually changing places.
  //  - different rows (moving into a new tier/the pool) → still swaps,
  //    but across containers: the dragged book takes `beforeKey`'s exact
  //    slot in its row, and `beforeKey` takes the dragged book's old slot
  //    in ITS row — same "trade places" idea, just each book's own row
  //    changes too. No plain "insert and shift everyone over" case is
  //    left standing; every drop-on-a-tile is a swap now, one way or the
  //    other. Dropping on a row's own empty background (no `beforeKey`)
  //    is the one remaining case that still appends at the end.
  function moveBook(key: string, destination: { type: "pool"; beforeKey?: string } | { type: "tier"; tierId: string; beforeKey?: string }) {
    if (!onUpdateBlock) return;

    if (destination.beforeKey) {
      const other = destination.beforeKey;
      const keyLoc = locate(key);
      const otherLoc = locate(other);
      if (!keyLoc || !otherLoc) return;

      const sameRow = keyLoc.type === "pool" ? otherLoc.type === "pool" : otherLoc.type === "tier" && otherLoc.tierId === keyLoc.tierId;

      if (sameRow) {
        const arr = keyLoc.type === "pool" ? block.pool : block.tiers.find((t) => t.id === keyLoc.tierId)!.bookKeys;
        const swapped = [...arr];
        swapped[keyLoc.index] = other;
        swapped[otherLoc.index] = key;
        if (keyLoc.type === "pool") {
          onUpdateBlock({ ...block, pool: swapped });
        } else {
          onUpdateBlock({ ...block, tiers: block.tiers.map((t) => (t.id === keyLoc.tierId ? { ...t, bookKeys: swapped } : t)) });
        }
        return;
      }

      let nextPool = block.pool;
      let nextTiers = block.tiers;
      if (keyLoc.type === "pool") nextPool = replaceAt(nextPool, keyLoc.index, other);
      else nextTiers = nextTiers.map((t) => (t.id === keyLoc.tierId ? { ...t, bookKeys: replaceAt(t.bookKeys, keyLoc.index, other) } : t));
      if (otherLoc.type === "pool") nextPool = replaceAt(nextPool, otherLoc.index, key);
      else nextTiers = nextTiers.map((t) => (t.id === otherLoc.tierId ? { ...t, bookKeys: replaceAt(t.bookKeys, otherLoc.index, key) } : t));
      onUpdateBlock({ ...block, pool: nextPool, tiers: nextTiers });
      return;
    }

    // Dropped on the row/pool's own background, not on a specific tile —
    // nothing to swap with, so this still just appends at the end, same
    // as the very first version of this feature.
    const pool = block.pool.filter((k) => k !== key);
    const tiers = block.tiers.map((t) => ({ ...t, bookKeys: t.bookKeys.filter((k) => k !== key) }));
    if (destination.type === "pool") {
      onUpdateBlock({ ...block, pool: [...pool, key], tiers });
    } else {
      onUpdateBlock({ ...block, pool, tiers: tiers.map((t) => (t.id === destination.tierId ? { ...t, bookKeys: [...t.bookKeys, key] } : t)) });
    }
  }

  // Row/pool-level fallback drop target — used for the empty area beside
  // the tiles (an empty row, or the padding around the last tile), where
  // there's no specific tile to drop "before." Always appends at the end.
  function dropZoneProps(target: string): React.HTMLAttributes<HTMLDivElement> {
    return {
      onDragOver: (e) => {
        e.preventDefault();
        setDragOverTarget(target);
      },
      onDragLeave: () => setDragOverTarget((t) => (t === target ? null : t)),
      onDrop: (e) => {
        e.preventDefault();
        setDragOverTarget(null);
        const key = e.dataTransfer.getData("text/plain");
        if (key) moveBook(key, target === "pool" ? { type: "pool" } : { type: "tier", tierId: target });
      }
    };
  }

  // Per-tile drop target — dropping directly on a tile SWAPS it with the
  // dragged book (see `moveBook`'s own comment for same-row vs.
  // cross-row swapping), rather than always appending at the end.
  // `stopPropagation()` keeps this event from also bubbling up into the
  // row/pool's own `dropZoneProps` handler above, which would otherwise
  // append the same book a second time right after this one placed it
  // precisely.
  function tileDropProps(container: { type: "pool" } | { type: "tier"; tierId: string }, beforeKey: string): React.HTMLAttributes<HTMLDivElement> {
    return {
      onDragOver: (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverTileKey(beforeKey);
      },
      onDragLeave: () => setDragOverTileKey((k) => (k === beforeKey ? null : k)),
      onDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverTileKey(null);
        setDragOverTarget(null);
        const key = e.dataTransfer.getData("text/plain");
        if (key && key !== beforeKey) {
          moveBook(key, container.type === "pool" ? { type: "pool", beforeKey } : { type: "tier", tierId: container.tierId, beforeKey });
        }
      }
    };
  }

  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  const resolvedPool = block.pool.filter((k) => byKey.has(k));

  return (
    <div className="flex h-full flex-col overflow-hidden p-2.5">
      {/* Always rendered, with a fallback — same "always show SOME title
          line" convention ShelfBlockView's own `block.title || "Untitled
          shelf"` already follows (this used to skip rendering entirely
          when empty; two reasons to always show one now: consistency
          with Shelf, and — the reason this actually got caught — in edit
          mode this is the ONLY strip of the block NOT covered by
          `.mural-tierlist-editor`'s drag-and-drop zones below, so without
          it react-grid-layout would have nowhere left to grab to
          reposition the whole block once its content fills the rest of
          the rectangle. */}
      <div className="mb-1.5 shrink-0 truncate text-[1.1em] font-semibold">{block.title || "Untitled tier list"}</div>
      {block.tiers.length === 0 ? (
        <EmptyBlockState message="No tiers configured yet." />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {block.tiers.map((tier) => (
            <TierRow
              key={tier.id}
              tier={tier}
              books={books}
              editMode={editMode}
              isDragOver={dragOverTarget === tier.id}
              dropZoneProps={dropZoneProps(tier.id)}
              dragOverTileKey={dragOverTileKey}
              tileDropProps={(k) => tileDropProps({ type: "tier", tierId: tier.id }, k)}
              otherTiers={block.tiers.filter((t) => t.id !== tier.id)}
              onMoveBook={moveBook}
            />
          ))}

          {/* Rendered only once there's something to rank — an empty
              pool panel was just dead chrome permanently taking up space
              on a board most of the time it's actually in use (once
              everything's been sorted into tiers, which is the whole
              point of the exercise). Returning a book to an empty pool
              still works fine without a visible drop target for it: a
              tier tile's own ⋮ menu's "Return to pool" item calls
              `moveBook` directly, no live panel required to land on. */}
          {editMode && resolvedPool.length > 0 && (
            <div
              {...dropZoneProps("pool")}
              className={`mural-tierlist-editor flex shrink-0 flex-col gap-1.5 rounded-lg border border-dashed p-2 transition-colors ${
                dragOverTarget === "pool" ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border)"
              }`}
            >
              <div className="text-[0.7em] font-semibold text-(--color-text-dim)">Pool — drag up into a tier</div>
              <div className="flex min-h-[4em] flex-wrap items-start gap-1.5">
                {resolvedPool.map((key) => (
                  <DraggableTierTile
                    key={key}
                    book={byKey.get(key)!}
                    bookKeyStr={key}
                    isDragOver={dragOverTileKey === key}
                    dropProps={tileDropProps({ type: "pool" }, key)}
                    menuItems={block.tiers.map((t) => ({ label: `Move to ${t.label || "Untitled tier"}`, onClick: () => moveBook(key, { type: "tier", tierId: t.id }) }))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Shared "this block has nothing to show yet" placeholder — a freshly
 *  added, not-yet-configured block, or a shelf that lost every member. */
export function EmptyBlockState({ message }: { message: string }) {
  return <div className="flex h-full min-h-0 flex-1 items-center justify-center p-3 text-center text-[0.85em] text-(--color-text-dim)">{message}</div>;
}
