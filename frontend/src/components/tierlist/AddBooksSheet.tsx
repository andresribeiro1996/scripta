import { useMemo, useState } from "react";
import { MiniBookTile } from "../murals/blocks/BookBlocks";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useDismissible } from "../../hooks/useDismissible";
import { bookKey } from "../../lib/merge";

/** Picks several books into a tier list's pool in one trip.
 *
 *  A cover grid rather than pickers.tsx's BookSearchList (a text list of
 *  "Title — Author" rows): a tier list is an entirely cover-driven UI,
 *  and the book you are looking for is one you recognise by its spine,
 *  not by reading a list. Same reasoning pickers.tsx already gives for
 *  keeping its gallery grid separate instead of threading layout props
 *  through one shared picker.
 *
 *  Multi-select with an explicit commit, not add-on-tap: the whole
 *  complaint this replaces was that seeding a pool meant one round trip
 *  per book. Selecting ten and committing once is the point, and it also
 *  leaves room to undo a mis-tap before anything is saved. */
export function AddBooksSheet({
  books,
  onAdd,
  onClose
}: {
  books: Array<Record<string, unknown>>;
  onAdd: (keys: string[]) => void;
  onClose: () => void;
}) {
  useScrollLock();
  useDismissible(onClose);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) => String(b.Title ?? "").toLowerCase().includes(q) || String(b.Attribution ?? "").toLowerCase().includes(q)
    );
  }, [books, search]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-(--color-border) bg-(--color-surface) shadow-lg sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add books to the pool"
      >
        <div className="shrink-0 border-b border-(--color-border) p-3">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your library…"
            aria-label="Search your library"
            className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-(--color-text-dim)">No books match.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {filtered.map((book, i) => {
                const key = bookKey(book);
                const isSelected = selected.has(key);
                return (
                  <button
                    key={String(book.ContentID ?? i)}
                    onClick={() => toggle(key)}
                    aria-pressed={isSelected}
                    className={`relative h-[6.5em] overflow-hidden rounded-lg ring-2 transition-shadow ${
                      isSelected ? "ring-(--color-accent)" : "ring-transparent"
                    }`}
                  >
                    <MiniBookTile book={book} showTitle={false} showAuthor={false} />
                    {isSelected && (
                      <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-(--color-accent) text-white">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-(--color-border) p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <button onClick={onClose} className="min-h-11 rounded-lg px-3 text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Cancel
          </button>
          <button
            onClick={() => {
              onAdd([...selected]);
              onClose();
            }}
            disabled={selected.size === 0}
            className="min-h-11 rounded-lg bg-(--color-accent) px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add {selected.size > 0 ? selected.size : ""} {selected.size === 1 ? "book" : "books"}
          </button>
        </div>
      </div>
    </div>
  );
}
