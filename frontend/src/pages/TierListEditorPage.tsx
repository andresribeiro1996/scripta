import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import type { TierlistData } from "../api/tierlists";
import { TierRow } from "../components/murals/blocks/BookBlocks";
import { PageContainer } from "../components/PageContainer";
import { AddBooksSheet } from "../components/tierlist/AddBooksSheet";
import { TierBoard } from "../components/tierlist/TierBoard";
import { useDismissible } from "../hooks/useDismissible";
import { useLibrary } from "../hooks/useLibrary";
import { useTierlists } from "../hooks/useTierlists";
import { bookKey } from "../lib/merge";

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
        <TierBoard data={data} books={books} onChange={commit} structureEditable={editing} onAddBooks={() => setAddingBooks(true)} />
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
