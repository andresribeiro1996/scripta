import { CoverImage } from "../../BookCard";
import type { ResolvedTierlist } from "../../../api/tierlists";
import { bookKey } from "../../../lib/merge";
import { resolveShelfBooks, type MuralBlock, type TierDefinition } from "../../../lib/murals";
import { OptionsMenu, type OptionsMenuItem } from "../../OptionsMenu";
import { TierRowEmpty, TierRowShell, TierRowTiles } from "../../tierlist/TierRowShell";

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

/** A tier from the tier list, with its books displayed in tiles. Uses TierRowShell for
 *  the chrome (colored label, wrapping layout, empty state), and fills the tile area
 *  with MiniBookTile components. Each cover tile gets a fixed height (`h-[6em]`,
 *  not `h-full`) specifically so the tiles can wrap onto additional lines while
 *  letting the row's own height be DERIVED from how many lines they wrap onto,
 *  rather than forcing a fixed height that would require scrolling.
 *
 *  Every cover tile is a fixed pixel box, not `aspect-[2/3]` computed from height
 *  alone — plus its OWN `overflow-hidden`: this is `flex-wrap`, so a tile's own
 *  intrinsic box directly determines the grid every book lines up against.
 *  `MiniBookTile`'s title/author use `truncate` (`white-space: nowrap`), and a flex
 *  item's "automatic minimum size" is its CONTENT's min-content width unless that
 *  item's own `overflow` is non-`visible` — so without `overflow-hidden` right here,
 *  a book with a long title/author (whose nowrap text can't shrink) silently forced
 *  its OWN tile wider than every other book's.
 *
 *  Title AND author both omitted (`showTitle={false} showAuthor={false}`) — at a
 *  tier tile's small footprint, a text footer (of either one line or two) was mostly
 *  just a truncated fragment eating into the cover art's own room, not adding legible
 *  information; dropping both lets `MiniBookTile` skip the footer strip entirely, so
 *  the cover fills the whole tile. View-only by design: this is the mural block's
 *  pure renderer — all ranking/editing lives in TierListEditorPage, whose own
 *  draggable tiles (DraggableTierTile below) are shared from this file. */
export function TierRow({ tier, books }: { tier: TierDefinition; books: Array<Record<string, unknown>> }) {
  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  // Walking `tier.bookKeys` directly (not filtering to resolved books
  // first) so each tile still knows its own real bookKey string — a
  // dangling reference (book deleted some other way) is silently
  // skipped, same tolerant convention resolveShelfBooks already uses for
  // a shelf.
  const resolvedKeys = tier.bookKeys.filter((k) => byKey.has(k));
  return (
    <TierRowShell tier={tier}>
      {resolvedKeys.length === 0 ? (
        <TierRowEmpty message="No books on this tier." />
      ) : (
        <TierRowTiles>
          {resolvedKeys.map((key) => (
            <div key={key} className="h-[6em] w-[4em] shrink-0 overflow-hidden">
              <MiniBookTile book={byKey.get(key)!} showTitle={false} showAuthor={false} />
            </div>
          ))}
        </TierRowTiles>
      )}
    </TierRowShell>
  );
}

/** One draggable, rankable book — the same compact cover tile TierRow
 *  above renders (`MiniBookTile`), just wrapped in plain HTML5
 *  drag-and-drop (`draggable` + `dataTransfer`, the exact convention
 *  BookCard.tsx's own shelf-reorder drag already uses) plus a small
 *  hover-revealed ⋮ menu (`OptionsMenu`, reused rather than rebuilt).
 *  Native HTML5 drag has no real touch equivalent, so the menu is never
 *  optional polish — it's the only way to rank a book at all on a device
 *  that can't drag. Used identically by TierListEditorPage's tier tiles
 *  and pool tiles, so a book looks and behaves the same regardless of
 *  which side of "ranked" it's currently on.
 *
 *  Every tile is ALSO a drop target (`dropProps`, wired up by the caller
 *  — see `tileDropProps`/`moveBook` in TierListEditorPage) — not just the
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
 *  block already falls back on.
 *
 *  A pure renderer: the block carries only a `tierlistId` reference, and
 *  the RESOLVED tier list arrives as a prop (the authenticated editor
 *  resolves it from useTierlists' cache; the public share page from the
 *  shared-mural response's server-side resolution). ALL ranking and
 *  structure editing lives in TierListEditorPage — a dangling reference
 *  (tier list deleted, or a block that never picked one) renders the
 *  unavailable state rather than an empty shell. */
export function TierListBlockView({ tierlist, books }: { tierlist: ResolvedTierlist | undefined; books: Array<Record<string, unknown>> }) {
  if (!tierlist) return <EmptyBlockState message="Tier list unavailable." />;
  return (
    <div className="flex h-full flex-col overflow-hidden p-2.5">
      {/* Always rendered, with a fallback — same "always show SOME title
          line" convention ShelfBlockView's own `block.title || "Untitled
          shelf"` already follows. */}
      <div className="mb-1.5 shrink-0 truncate text-[1.1em] font-semibold">{tierlist.name || "Untitled tier list"}</div>
      {tierlist.tiers.length === 0 ? (
        <EmptyBlockState message="No tiers yet." />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {tierlist.tiers.map((tier) => (
            <TierRow key={tier.id} tier={tier} books={books} />
          ))}
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
