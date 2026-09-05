import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import type { TierDefinition, TierlistData } from "../api/tierlists";
import { DraggableTierTile, TierRow } from "../components/murals/blocks/BookBlocks";
import { OptionsMenu } from "../components/OptionsMenu";
import { PageContainer } from "../components/PageContainer";
import { ChevronDownIcon, ChevronUpIcon, toolbarIconClass } from "../components/Toolbar";
import { AddBooksSheet } from "../components/tierlist/AddBooksSheet";
import { TierColorPicker } from "../components/tierlist/TierColorPicker";
import { TierRowEmpty, TierRowShell, TierRowTiles } from "../components/tierlist/TierRowShell";
import { useDismissible } from "../hooks/useDismissible";
import { useLibrary } from "../hooks/useLibrary";
import { useTierlists } from "../hooks/useTierlists";
import { bookKey } from "../lib/merge";
import { createTier } from "../lib/murals";

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
  onDelete
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
}) {
  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  const resolvedKeys = tier.bookKeys.filter((k) => byKey.has(k));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
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
        {/* Up/down stay as direct buttons — reordering tiers is the
            frequent action. Delete goes behind the ⋮ menu: rare, and
            destructive enough that a mis-tap on a 44px target next to
            two other 44px targets is a real risk. Same consolidation
            OptionsMenu already does for mural blocks and list cards. */}
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
      </div>
      <DropZone id={tier.id}>
        <TierRowShell tier={tier} colorControl={<TierColorPicker color={tier.color} onChange={onRecolor} />}>
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

export function TierListEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { data: library } = useLibrary();
  const { data: tierlistsData, isLoading, rename, saveData } = useTierlists();
  const books = library?.data.books ?? [];
  const tierlist = (tierlistsData ?? []).find((t) => t.id === id);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [addingBooks, setAddingBooks] = useState(false);
  const [editing, setEditing] = useState(false);
  const [poolCollapsed, setPoolCollapsed] = useState(false);
  // Same sensor pair, same constants, as LibraryPage.tsx's own drag-to-
  // reorder: PointerSensor's 150ms/5px activation constraint means a touch
  // press has to hold for a beat before a drag starts (so a tap still just
  // taps — opens the ⋮ menu, follows a link, etc. — rather than every touch
  // immediately kicking off a drag), while a mouse press starts dragging
  // right away since `delay`/`tolerance` are pointer-type-agnostic in
  // effect but a mouse rarely triggers them by accident the way a finger
  // does. KeyboardSensor is what makes ranking reachable without a pointer
  // at all. useSensors is a hook, so it has to sit above BOTH early
  // returns below it, alongside the component's other hooks — calling it
  // conditionally (e.g. only once `tierlist` is known to exist) would
  // break React's rule that the same hooks run in the same order on every
  // render.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  // Leaving edit mode should leave no editing UI armed for the next Edit tap
  // — without this, Edit → open the add-books sheet → Done → Edit reopens
  // the sheet (and, previously, reopened the rename input) because neither
  // piece of state was ever cleared, only hidden behind `editing`'s own
  // check. Called from both places editing actually turns off (Done below,
  // and the dismissible handler right after) rather than from an effect
  // watching `editing`, so this stays a plain event-driven state update
  // instead of a setState-in-effect.
  function exitEditing() {
    setEditing(false);
    setAddingBooks(false);
    setEditingName(false);
  }

  // Escape and the app-wide edge-swipe-back (components/EdgeSwipeBack.tsx)
  // exit editing first and only leave the page on a second gesture —
  // registering here rather than making the mode a route keeps the
  // browser's own history meaning "which tier list", not "which mode".
  useDismissible(exitEditing, editing);

  // The bottom tab bar covers the pool dock and costs 3.5rem of a phone's
  // height while ranking, which is the whole activity in edit mode. Same
  // trade MuralEditorPage.tsx:89-93 already makes for its canvas.
  const { setNavHidden } = useOutletContext<{ setNavHidden: (hidden: boolean) => void }>();
  useEffect(() => {
    setNavHidden(editing);
    return () => setNavHidden(false);
  }, [editing, setNavHidden]);

  if (isLoading) {
    return (
      <PageContainer>
        <p className="text-sm text-(--color-text-dim)">Loading…</p>
      </PageContainer>
    );
  }

  if (!tierlist) {
    return (
      <PageContainer>
        <p className="text-sm text-(--color-text-dim)">
          No tier list with that id.{" "}
          <Link to="/dashboard/arena?tab=tierlists" className="text-(--color-accent) transition-opacity hover:opacity-80">
            Back to Arena
          </Link>
          .
        </p>
      </PageContainer>
    );
  }

  const data = tierlist.data;
  const tierlistId = tierlist.id;
  const tierlistName = tierlist.name;

  function commit(next: TierlistData) {
    void saveData(tierlistId, next);
  }

  async function handleRename() {
    const name = nameDraft.trim();
    setEditingName(false);
    if (!name || name === tierlistName) return;
    await rename(tierlistId, name);
  }

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
          commit({ ...data, pool: swapped });
        } else {
          commit({ ...data, tiers: data.tiers.map((t) => (t.id === keyLoc.tierId ? { ...t, bookKeys: swapped } : t)) });
        }
        return;
      }

      let nextPool = data.pool;
      let nextTiers = data.tiers;
      if (keyLoc.type === "pool") nextPool = replaceAt(nextPool, keyLoc.index, other);
      else nextTiers = nextTiers.map((t) => (t.id === keyLoc.tierId ? { ...t, bookKeys: replaceAt(t.bookKeys, keyLoc.index, other) } : t));
      if (otherLoc.type === "pool") nextPool = replaceAt(nextPool, otherLoc.index, key);
      else nextTiers = nextTiers.map((t) => (t.id === otherLoc.tierId ? { ...t, bookKeys: replaceAt(t.bookKeys, otherLoc.index, key) } : t));
      commit({ ...data, pool: nextPool, tiers: nextTiers });
      return;
    }

    const pool = data.pool.filter((k) => k !== key);
    const tiers = data.tiers.map((t) => ({ ...t, bookKeys: t.bookKeys.filter((k) => k !== key) }));
    if (destination.type === "pool") {
      commit({ ...data, pool: [...pool, key], tiers });
    } else {
      commit({ ...data, pool, tiers: tiers.map((t) => (t.id === destination.tierId ? { ...t, bookKeys: [...t.bookKeys, key] } : t)) });
    }
  }

  // A plain function, not a hook — it closes over `data`/`locate`/
  // `moveBook`, which only exist below this component's two early
  // returns, so it has to live down here rather than next to `sensors`
  // above them.
  function handleDragEnd(e: DragEndEvent) {
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

  function updateTier(tierId: string, patch: Partial<TierDefinition>) {
    commit({ ...data, tiers: data.tiers.map((t) => (t.id === tierId ? { ...t, ...patch } : t)) });
  }

  function moveTier(i: number, dir: -1 | 1) {
    const reordered = [...data.tiers];
    [reordered[i], reordered[i + dir]] = [reordered[i + dir], reordered[i]];
    commit({ ...data, tiers: reordered });
  }

  function deleteTier(tier: TierDefinition) {
    commit({ tiers: data.tiers.filter((t) => t.id !== tier.id), pool: [...data.pool, ...tier.bookKeys] });
  }

  function addTier() {
    commit({ ...data, tiers: [...data.tiers, createTier("New tier", "#8a8580")] });
  }

  function addBooksToPool(keys: string[]) {
    const taken = new Set([...data.pool, ...data.tiers.flatMap((t) => t.bookKeys)]);
    const fresh = keys.filter((k) => !taken.has(k));
    if (fresh.length === 0) return;
    commit({ ...data, pool: [...data.pool, ...fresh] });
  }

  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  const resolvedPool = data.pool.filter((k) => byKey.has(k));

  return (
    <PageContainer>
      <header className="mb-6">
        <Link to="/dashboard/arena?tab=tierlists" className="text-xs text-(--color-text-dim) hover:text-(--color-text)">
          ← Arena
        </Link>
        <div className="flex items-center justify-between gap-3">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void handleRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              aria-label="Tier list name"
              className="block min-w-0 flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-lg font-bold"
            />
          ) : (
            <button
              onClick={() => {
                setNameDraft(tierlist.name);
                setEditingName(true);
              }}
              title="Rename this tier list"
              className="block min-w-0 flex-1 truncate text-left text-lg font-bold transition-colors hover:text-(--color-accent)"
            >
              {tierlist.name}
            </button>
          )}
          <button
            onClick={() => (editing ? exitEditing() : setEditing(true))}
            className={`min-h-9 shrink-0 rounded-lg px-3 text-sm font-semibold ${
              editing
                ? "bg-(--color-accent) text-white"
                : "border border-(--color-border) bg-(--color-surface) hover:bg-(--color-surface-hover)"
            }`}
          >
            {editing ? "Done" : "Edit"}
          </button>
        </div>
      </header>

      {!editing ? (
        <div className="flex flex-col gap-2">
          {data.tiers.length === 0 ? (
            <p className="text-sm text-(--color-text-dim)">No tiers yet — tap Edit to add one.</p>
          ) : (
            data.tiers.map((tier) => <TierRow key={tier.id} tier={tier} books={books} />)
          )}
          {resolvedPool.length > 0 && (
            <p className="mt-1 text-xs text-(--color-text-dim)">
              {resolvedPool.length} {resolvedPool.length === 1 ? "book" : "books"} still unranked — tap Edit to place them.
            </p>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
              />
            ))}

            <button
              onClick={addTier}
              className="self-start rounded-lg border border-dashed border-(--color-border) px-3 py-1.5 text-sm text-(--color-text-dim) hover:border-(--color-accent) hover:text-(--color-accent)"
            >
              + Add tier
            </button>
          </div>

          {/* Pinned to the bottom rather than sitting after the last tier.
              Ranking means dragging pool → tier, which needs both on screen
              at once; as a page-flow block at the end of a long list of
              tiers, the pool was almost never visible at the same time as
              the tier being aimed at. The bottom nav is hidden in edit mode
              (see setNavHidden above), so this occupies space that is
              otherwise unused. */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-(--color-border) bg-(--color-surface) pb-[env(safe-area-inset-bottom,0px)]">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <button
                onClick={() => setPoolCollapsed((c) => !c)}
                aria-expanded={!poolCollapsed}
                className="flex min-h-9 items-center gap-1.5 text-xs font-semibold text-(--color-text-dim) hover:text-(--color-text)"
              >
                {poolCollapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
                Pool — {resolvedPool.length} {resolvedPool.length === 1 ? "book" : "books"}
              </button>
              <button
                onClick={() => setAddingBooks(true)}
                className="min-h-9 shrink-0 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm font-semibold hover:bg-(--color-surface-hover)"
              >
                Add books
              </button>
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
        </DndContext>
      )}

      {addingBooks && (
        <AddBooksSheet
          books={books.filter((b) => {
            const key = bookKey(b);
            return !data.pool.includes(key) && !data.tiers.some((t) => t.bookKeys.includes(key));
          })}
          onAdd={addBooksToPool}
          onClose={() => setAddingBooks(false)}
        />
      )}
    </PageContainer>
  );
}
