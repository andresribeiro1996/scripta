import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { TierDefinition, TierlistData } from "../api/tierlists";
import { DraggableTierTile } from "../components/murals/blocks/BookBlocks";
import { BookSearchList } from "../components/murals/pickers";
import { PageContainer } from "../components/PageContainer";
import { useLibrary } from "../hooks/useLibrary";
import { useTierlists } from "../hooks/useTierlists";
import { bookKey } from "../lib/merge";
import { createTier } from "../lib/murals";

type MoveDestination = { type: "pool"; beforeKey?: string } | { type: "tier"; tierId: string; beforeKey?: string };

function TierEditorRow({
  tier,
  books,
  isDragOver,
  dropZoneProps,
  dragOverTileKey,
  tileDropProps,
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
  isDragOver: boolean;
  dropZoneProps: React.HTMLAttributes<HTMLDivElement>;
  dragOverTileKey: string | null;
  tileDropProps: (beforeKey: string) => React.HTMLAttributes<HTMLDivElement>;
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
      <div className="flex items-center gap-2">
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
          className="min-w-0 flex-1 rounded-lg border border-(--color-border) bg-transparent px-2 py-1 text-sm font-semibold"
        />
        <button
          disabled={isFirst}
          onClick={onMoveUp}
          className="shrink-0 text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-30"
          title="Move tier up"
        >
          ▲
        </button>
        <button
          disabled={isLast}
          onClick={onMoveDown}
          className="shrink-0 text-(--color-text-dim) hover:text-(--color-text) disabled:opacity-30"
          title="Move tier down"
        >
          ▼
        </button>
        <button onClick={onDelete} className="shrink-0 text-(--color-danger) transition-opacity hover:opacity-80" title="Delete tier">
          Delete
        </button>
      </div>
      <div
        {...dropZoneProps}
        className={`flex shrink-0 items-stretch gap-2 overflow-hidden rounded-lg border transition-colors ${
          isDragOver ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border)"
        }`}
      >
        <div
          className="flex w-[3em] shrink-0 flex-col items-center justify-center gap-1 overflow-hidden p-1 text-center text-[0.9em] leading-tight font-bold break-words text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]"
          style={{ backgroundColor: tier.color }}
        >
          <span className="line-clamp-3">{tier.label || "—"}</span>
          <input
            type="color"
            defaultValue={tier.color}
            onBlur={(e) => {
              const color = e.target.value;
              if (color !== tier.color) onRecolor(color);
            }}
            title="Tier color"
            aria-label="Tier color"
            className="h-3 w-6 shrink-0 cursor-pointer rounded-sm border-0 bg-transparent p-0 ring-1 ring-white/70"
          />
        </div>
        {resolvedKeys.length === 0 ? (
          <div className="flex min-h-[4em] flex-1 items-center px-2 text-[0.75em] text-(--color-text-dim)">Drag a book here from the pool.</div>
        ) : (
          <div className="flex flex-1 flex-wrap content-start gap-1.5 p-1.5">
            {resolvedKeys.map((key) => {
              const book = byKey.get(key)!;
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [dragOverTileKey, setDragOverTileKey] = useState<string | null>(null);

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

  function addBookToPool(book: Record<string, unknown>) {
    const key = bookKey(book);
    if (data.pool.includes(key) || data.tiers.some((t) => t.bookKeys.includes(key))) return;
    commit({ ...data, pool: [...data.pool, key] });
  }

  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  const resolvedPool = data.pool.filter((k) => byKey.has(k));

  return (
    <PageContainer>
      <header className="mb-6">
        <Link to="/dashboard/arena?tab=tierlists" className="text-xs text-(--color-text-dim) hover:text-(--color-text)">
          ← Arena
        </Link>
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
            className="block rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-lg font-bold"
          />
        ) : (
          <button
            onClick={() => {
              setNameDraft(tierlist.name);
              setEditingName(true);
            }}
            title="Rename this tier list"
            className="block text-left text-lg font-bold transition-colors hover:text-(--color-accent)"
          >
            {tierlist.name}
          </button>
        )}
      </header>

      <div className="flex flex-col gap-2">
        {data.tiers.length === 0 && <p className="text-sm text-(--color-text-dim)">No tiers yet — add one.</p>}
        {data.tiers.map((tier, i) => (
          <TierEditorRow
            key={tier.id}
            tier={tier}
            books={books}
            isDragOver={dragOverTarget === tier.id}
            dropZoneProps={dropZoneProps(tier.id)}
            dragOverTileKey={dragOverTileKey}
            tileDropProps={(k) => tileDropProps({ type: "tier", tierId: tier.id }, k)}
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

        {(resolvedPool.length > 0 || searchOpen) && (
          <div
            {...dropZoneProps("pool")}
            className={`flex shrink-0 flex-col gap-1.5 rounded-lg border border-dashed p-2 transition-colors ${
              dragOverTarget === "pool" ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-border)"
            }`}
          >
            <div className="text-xs font-semibold text-(--color-text-dim)">Pool — drag up into a tier</div>
            <div className="flex min-h-[4em] flex-wrap items-start gap-1.5">
              {resolvedPool.map((key) => (
                <DraggableTierTile
                  key={key}
                  book={byKey.get(key)!}
                  bookKeyStr={key}
                  isDragOver={dragOverTileKey === key}
                  dropProps={tileDropProps({ type: "pool" }, key)}
                  menuItems={data.tiers.map((t) => ({ label: `Move to ${t.label || "Untitled tier"}`, onClick: () => moveBook(key, { type: "tier", tierId: t.id }) }))}
                />
              ))}
            </div>
            {searchOpen && (
              <div>
                <BookSearchList
                  books={books.filter((b) => {
                    const key = bookKey(b);
                    return !data.pool.includes(key) && !data.tiers.some((t) => t.bookKeys.includes(key));
                  })}
                  onSelect={(b) => addBookToPool(b)}
                />
                <button onClick={() => setSearchOpen(false)} className="mt-1 text-xs text-(--color-text-dim) hover:text-(--color-text)">
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {!searchOpen && (
          <button onClick={() => setSearchOpen(true)} className="self-start text-xs font-medium text-(--color-accent) hover:opacity-80">
            + Add books to pool
          </button>
        )}
      </div>
    </PageContainer>
  );
}
