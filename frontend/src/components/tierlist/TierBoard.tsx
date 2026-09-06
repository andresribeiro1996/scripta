import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { useState } from "react";
import type { TierDefinition, TierlistData } from "../../api/tierlists";
import { DraggableTierTile, MiniBookTile } from "../murals/blocks/BookBlocks";
import { OptionsMenu } from "../OptionsMenu";
import { ChevronDownIcon, ChevronUpIcon, toolbarIconClass } from "../Toolbar";
import { bookKey } from "../../lib/merge";
import { createTier } from "../../lib/murals";
import { TierColorPicker } from "./TierColorPicker";
import { TierRowEmpty, TierRowShell, TierRowTiles } from "./TierRowShell";

export interface TierBoardProps {
  data: TierlistData;
  books: Array<Record<string, unknown>>;
  onChange: (next: TierlistData) => void;
  /** false on the public voting page: the tier set and the pool are frozen
   *  there, so no add/rename/recolor/reorder/delete affordances render. */
  structureEditable: boolean;
  poolLabel?: string;
  /** Opens the caller's own "add books" sheet. Only rendered (and only
   *  needed) when `structureEditable` is true — the sheet itself stays
   *  owned by the caller (TierListEditorPage) because it needs the
   *  caller's own library data; the public voting page has no such sheet
   *  and never passes this, which is fine since `structureEditable` is
   *  false there anyway. */
  onAddBooks?: () => void;
}

type MoveDestination = { type: "pool"; beforeKey?: string } | { type: "tier"; tierId: string; beforeKey?: string };

/** A tier row or the pool as a drop target. `id` is what `handleDragEnd`
 *  reads back from `over.id`: the literal string "pool", or a tier's own
 *  id. This is also what restores the drag-over highlight a tier row lost
 *  when the previous task pulled the old HTML5 `dragOverTarget` styling out
 *  ahead of this one — the pool's dashed box already had this feedback,
 *  and a tier row now matches it via the same mechanism instead of a
 *  bespoke one. `shrink-0` lives here (not just on `TierRowShell`/the pool
 *  box nested inside) because THIS div — not its child — is now the actual
 *  flex item inside the surrounding `flex flex-col` stack of rows; putting
 *  it only on the child would leave the real flex item free to shrink. */
function DropZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`shrink-0 rounded-lg transition-colors ${isOver ? "bg-(--color-accent-soft)" : ""}`}>
      {children}
    </div>
  );
}

function TierEditorRow({
  tier,
  books,
  otherTiers,
  onMoveBook,
  isFirst,
  isLast,
  onRename,
  onRecolor,
  onMoveUp,
  onMoveDown,
  onDelete,
  structureEditable
}: {
  tier: TierDefinition;
  books: Array<Record<string, unknown>>;
  otherTiers: TierDefinition[];
  onMoveBook: (key: string, destination: MoveDestination) => void;
  isFirst: boolean;
  isLast: boolean;
  onRename: (label: string) => void;
  onRecolor: (color: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  /** Ranking (dragging books between the pool and tiers, and each tile's
   *  own ⋮ "move to" menu) works either way — that's the entire point of
   *  the public voting page. Only the tier list's own SHAPE — its label,
   *  color, order, and existence — is gated here. */
  structureEditable: boolean;
}) {
  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  const resolvedKeys = tier.bookKeys.filter((k) => byKey.has(k));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {structureEditable ? (
          <input
            defaultValue={tier.label}
            onBlur={(e) => {
              const label = e.target.value;
              if (label !== tier.label) onRename(label);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = tier.label;
                e.currentTarget.blur();
              }
            }}
            placeholder="Label"
            aria-label="Tier label"
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-2.5 text-sm font-semibold"
          />
        ) : (
          <span className="min-h-9 min-w-0 flex-1 truncate px-2.5 py-1.5 text-sm font-semibold">{tier.label || "Untitled tier"}</span>
        )}
        {/* Up/down stay as direct buttons — reordering tiers is the
            frequent action. Delete goes behind the ⋮ menu: rare, and
            destructive enough that a mis-tap on a 44px target next to
            two other 44px targets is a real risk. Same consolidation
            OptionsMenu already does for mural blocks and list cards. */}
        {structureEditable && (
          <>
            <button
              disabled={isFirst}
              onClick={onMoveUp}
              aria-label="Move tier up"
              title="Move tier up"
              className={`${toolbarIconClass()} disabled:opacity-30`}
            >
              <ChevronUpIcon />
            </button>
            <button
              disabled={isLast}
              onClick={onMoveDown}
              aria-label="Move tier down"
              title="Move tier down"
              className={`${toolbarIconClass()} disabled:opacity-30`}
            >
              <ChevronDownIcon />
            </button>
            <OptionsMenu
              title="Tier settings"
              triggerClassName={toolbarIconClass()}
              items={[{ label: "Delete tier", onClick: onDelete, danger: true }]}
            />
          </>
        )}
      </div>
      <DropZone id={tier.id}>
        <TierRowShell tier={tier} colorControl={structureEditable ? <TierColorPicker color={tier.color} onChange={onRecolor} /> : undefined}>
          {resolvedKeys.length === 0 ? (
            <TierRowEmpty message="Drag a book here from the pool." />
          ) : (
            <TierRowTiles>
              {resolvedKeys.map((key) => {
                const book = byKey.get(key)!;
                return (
                  <DraggableTierTile
                    key={key}
                    book={book}
                    bookKeyStr={key}
                    menuItems={[
                      ...otherTiers.map((t) => ({ label: `Move to ${t.label || "Untitled tier"}`, onClick: () => onMoveBook(key, { type: "tier", tierId: t.id }) })),
                      { label: "Return to pool", onClick: () => onMoveBook(key, { type: "pool" }) }
                    ]}
                  />
                );
              })}
            </TierRowTiles>
          )}
        </TierRowShell>
      </DropZone>
    </div>
  );
}

/** The drag-to-rank board: the pool dock plus every tier row, all sharing
 *  one `DndContext` so a book can be dragged between any of them. Used
 *  both by the authenticated owner's editor (`structureEditable: true`,
 *  full add/rename/recolor/reorder/delete controls) and — starting with
 *  the public voting page added a few tasks after this one — by voters,
 *  who rank the same fixed set of books into the same fixed tiers but
 *  can't touch the tier list's own shape (`structureEditable: false`). */
export function TierBoard({ data, books, onChange, structureEditable, poolLabel, onAddBooks }: TierBoardProps) {
  const [poolCollapsed, setPoolCollapsed] = useState(false);
  // The book currently being dragged, tracked purely to feed `DragOverlay`
  // below — dnd-kit doesn't render an overlay on its own, and without one
  // the dragged tile is only ever moved IN PLACE via its own transform
  // (BookBlocks.tsx used to do exactly that). The pool dock's strip is
  // `overflow-x-auto`, which computes `overflow-y` to `auto` too, so an
  // in-place-translated tile lifted toward a tier row got clipped at the
  // strip's own top edge the moment it crossed it — you were dragging
  // something you couldn't see. `DragOverlay` renders in a portal outside
  // that clipping ancestor, so it stays visible for the whole drag; the
  // source tile just dims in place (see its own `isDragging` styling).
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Same sensor pair, same constants, as LibraryPage.tsx's own drag-to-
  // reorder: PointerSensor's 150ms/5px activation constraint means a touch
  // press has to hold for a beat before a drag starts (so a tap still just
  // taps — opens the ⋮ menu, follows a link, etc. — rather than every touch
  // immediately kicking off a drag), while a mouse press starts dragging
  // right away since `delay`/`tolerance` are pointer-type-agnostic in
  // effect but a mouse rarely triggers them by accident the way a finger
  // does. KeyboardSensor is what makes ranking reachable without a pointer
  // at all.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  function locate(k: string): { type: "pool"; index: number } | { type: "tier"; tierId: string; index: number } | null {
    const poolIndex = data.pool.indexOf(k);
    if (poolIndex !== -1) return { type: "pool", index: poolIndex };
    for (const t of data.tiers) {
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

  function moveBook(key: string, destination: MoveDestination) {
    if (destination.beforeKey) {
      const other = destination.beforeKey;
      const keyLoc = locate(key);
      const otherLoc = locate(other);
      if (!keyLoc || !otherLoc) return;

      const sameRow = keyLoc.type === "pool" ? otherLoc.type === "pool" : otherLoc.type === "tier" && otherLoc.tierId === keyLoc.tierId;

      if (sameRow) {
        const arr = keyLoc.type === "pool" ? data.pool : data.tiers.find((t) => t.id === keyLoc.tierId)!.bookKeys;
        const swapped = [...arr];
        swapped[keyLoc.index] = other;
        swapped[otherLoc.index] = key;
        if (keyLoc.type === "pool") {
          onChange({ ...data, pool: swapped });
        } else {
          onChange({ ...data, tiers: data.tiers.map((t) => (t.id === keyLoc.tierId ? { ...t, bookKeys: swapped } : t)) });
        }
        return;
      }

      let nextPool = data.pool;
      let nextTiers = data.tiers;
      if (keyLoc.type === "pool") nextPool = replaceAt(nextPool, keyLoc.index, other);
      else nextTiers = nextTiers.map((t) => (t.id === keyLoc.tierId ? { ...t, bookKeys: replaceAt(t.bookKeys, keyLoc.index, other) } : t));
      if (otherLoc.type === "pool") nextPool = replaceAt(nextPool, otherLoc.index, key);
      else nextTiers = nextTiers.map((t) => (t.id === otherLoc.tierId ? { ...t, bookKeys: replaceAt(t.bookKeys, otherLoc.index, key) } : t));
      onChange({ ...data, pool: nextPool, tiers: nextTiers });
      return;
    }

    const pool = data.pool.filter((k) => k !== key);
    const tiers = data.tiers.map((t) => ({ ...t, bookKeys: t.bookKeys.filter((k) => k !== key) }));
    if (destination.type === "pool") {
      onChange({ ...data, pool: [...pool, key], tiers });
    } else {
      onChange({ ...data, pool, tiers: tiers.map((t) => (t.id === destination.tierId ? { ...t, bookKeys: [...t.bookKeys, key] } : t)) });
    }
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveKey(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveKey(null);
    if (!e.over) return;
    const key = String(e.active.id);
    const overId = String(e.over.id);
    if (overId === key) return;
    // Dropping onto another TILE swaps the two (beforeKey); dropping onto
    // a row or the pool background appends. The swap is deliberate — see
    // DraggableTierTile's comment; an earlier version re-inserted instead,
    // which slid every book between the two spots over by one.
    const overIsTile = data.pool.includes(overId) || data.tiers.some((t) => t.bookKeys.includes(overId));
    if (overIsTile) {
      const dest = locate(overId);
      if (!dest) return;
      moveBook(key, dest.type === "pool" ? { type: "pool", beforeKey: overId } : { type: "tier", tierId: dest.tierId, beforeKey: overId });
      return;
    }
    moveBook(key, overId === "pool" ? { type: "pool" } : { type: "tier", tierId: overId });
  }

  // Plain `closestCenter` compares rect CENTRES with no containment test
  // at all, and a tier's `DropZone` rect fully CONTAINS every tile inside
  // it — so on any non-empty row, whichever tile's centre happens to be
  // nearest the pointer always wins over the row itself, even when the
  // pointer is over bare row background nowhere near a tile. That made
  // "drop on the row background to append" (the comment on `handleDragEnd`
  // above, and `DraggableTierTile`'s own comment, both promise this)
  // actually unreachable on any tier that already has a book in it — every
  // drop resolved to a swap instead, silently demoting whichever existing
  // book happened to be geometrically closest. `pointerWithin` fixes this
  // by only considering droppables the pointer is literally INSIDE, sorted
  // nearest-centre-first: over bare row background that's just the row
  // (append); over a tile it's the tile first, since a tile's rect nests
  // inside the row's (swap). It can return zero results (pointer not
  // over any registered droppable, e.g. mid-drag over the header), so
  // `closestCenter` stays as the fallback for that case only.
  const collisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    return within.length > 0 ? within : closestCenter(args);
  };

  function updateTier(tierId: string, patch: Partial<TierDefinition>) {
    onChange({ ...data, tiers: data.tiers.map((t) => (t.id === tierId ? { ...t, ...patch } : t)) });
  }

  function moveTier(i: number, dir: -1 | 1) {
    const reordered = [...data.tiers];
    [reordered[i], reordered[i + dir]] = [reordered[i + dir], reordered[i]];
    onChange({ ...data, tiers: reordered });
  }

  function deleteTier(tier: TierDefinition) {
    onChange({ tiers: data.tiers.filter((t) => t.id !== tier.id), pool: [...data.pool, ...tier.bookKeys] });
  }

  function addTier() {
    onChange({ ...data, tiers: [...data.tiers, createTier("New tier", "#8a8580")] });
  }

  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  const resolvedPool = data.pool.filter((k) => byKey.has(k));
  const poolHeading = poolLabel ?? "Pool";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      // Cancelled drags (Escape, or the draggable node unmounting) skip
      // `onDragEnd` entirely — without also clearing `activeKey` here,
      // `DragOverlay` would keep rendering the last-dragged book frozen
      // in place until some later drag started and ended normally.
      onDragCancel={() => setActiveKey(null)}
    >
      <div className="flex flex-col gap-2 pb-[13rem]">
        {data.tiers.length === 0 && <p className="text-sm text-(--color-text-dim)">No tiers yet — add one.</p>}
        {data.tiers.map((tier, i) => (
          <TierEditorRow
            key={tier.id}
            tier={tier}
            books={books}
            otherTiers={data.tiers.filter((t) => t.id !== tier.id)}
            onMoveBook={moveBook}
            isFirst={i === 0}
            isLast={i === data.tiers.length - 1}
            onRename={(label) => updateTier(tier.id, { label })}
            onRecolor={(color) => updateTier(tier.id, { color })}
            onMoveUp={() => moveTier(i, -1)}
            onMoveDown={() => moveTier(i, 1)}
            onDelete={() => deleteTier(tier)}
            structureEditable={structureEditable}
          />
        ))}

        {structureEditable && (
          <button
            onClick={addTier}
            className="self-start rounded-lg border border-dashed border-(--color-border) px-3 py-1.5 text-sm text-(--color-text-dim) hover:border-(--color-accent) hover:text-(--color-accent)"
          >
            + Add tier
          </button>
        )}
      </div>

      {/* Pinned to the bottom rather than sitting after the last tier.
          Ranking means dragging pool → tier, which needs both on screen
          at once; as a page-flow block at the end of a long list of
          tiers, the pool was almost never visible at the same time as
          the tier being aimed at. The bottom nav is hidden while this
          board is showing (see the page's own `setNavHidden`), so this
          occupies space that is otherwise unused. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-(--color-border) bg-(--color-surface) pb-[env(safe-area-inset-bottom,0px)]">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <button
            onClick={() => setPoolCollapsed((c) => !c)}
            aria-expanded={!poolCollapsed}
            className="flex min-h-9 items-center gap-1.5 text-xs font-semibold text-(--color-text-dim) hover:text-(--color-text)"
          >
            {poolCollapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
            {poolHeading} — {resolvedPool.length} {resolvedPool.length === 1 ? "book" : "books"}
          </button>
          {/* Adding to the pool grows the frozen set voters would be
              ranking, so it's gated the same as the tier controls above —
              see `structureEditable`'s own doc comment. */}
          {structureEditable && onAddBooks && (
            <button
              onClick={onAddBooks}
              className="min-h-9 shrink-0 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm font-semibold hover:bg-(--color-surface-hover)"
            >
              Add books
            </button>
          )}
        </div>
        {!poolCollapsed && (
          <DropZone id="pool">
            <div className="flex min-h-[7em] items-start gap-1.5 overflow-x-auto overscroll-contain px-3 pb-3">
              {resolvedPool.length === 0 ? (
                <p className="py-4 text-xs text-(--color-text-dim)">
                  Pool is empty — every book is ranked. Drag one back here to unrank it.
                </p>
              ) : (
                resolvedPool.map((key) => (
                  <DraggableTierTile
                    key={key}
                    book={byKey.get(key)!}
                    bookKeyStr={key}
                    menuItems={data.tiers.map((t) => ({
                      label: `Move to ${t.label || "Untitled tier"}`,
                      onClick: () => moveBook(key, { type: "tier", tierId: t.id })
                    }))}
                  />
                ))
              )}
            </div>
          </DropZone>
        )}
      </div>

      {/* Renders the ONLY visible copy of the dragged book — the source
          tile stays mounted (dimmed via its own `isDragging` opacity)
          rather than hiding, which is what lets it keep receiving a
          drop (it's also a `useDroppable` target for the swap case)
          and keeps its layout slot from collapsing mid-drag. This
          floats in a portal at the document root, outside the pool
          strip's `overflow-x-auto` (which computes `overflow-y` to
          `auto` too and would otherwise clip a tile the instant it's
          lifted past the strip's own top edge — see DraggableTierTile's
          comment). Plain `MiniBookTile` at the same `h-[6em] w-[4em]`
          tile size, not `DraggableTierTile` itself — the overlay copy
          needs no drag listeners or drop target of its own, only to
          look like the tile being moved. */}
      <DragOverlay>
        {activeKey && byKey.has(activeKey) ? (
          <div className="h-[6em] w-[4em] cursor-grabbing overflow-hidden rounded-lg shadow-lg">
            <MiniBookTile book={byKey.get(activeKey)!} showTitle={false} showAuthor={false} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
