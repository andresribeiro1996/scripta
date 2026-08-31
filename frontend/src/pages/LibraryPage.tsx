import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { GalleryImage } from "../api/gallery";
import { fetchLibrary, saveLibrary, type LibraryDocument } from "../api/library";
import { BookCard } from "../components/BookCard";
import { BookDetailSheet } from "../components/BookDetailSheet";
import { BookGrid } from "../components/BookGrid";
import { useConfirm } from "../components/ConfirmDialog";
import { CoverPickerModal } from "../components/CoverPickerModal";
import { LibraryToolbar } from "../components/LibraryToolbar";
import { PageContainer } from "../components/PageContainer";
import { PerCardStylePanel } from "../components/PerCardStylePanel";
import { ShareModal } from "../components/ShareModal";
import { useLibrary } from "../hooks/useLibrary";
import { useMurals } from "../hooks/useMurals";
import { clearBookCover, setBookCover } from "../lib/bookCovers";
import { deriveSeriesGroups, removeBooksFromAllGroups } from "../lib/groups";
import { parseImportedFile } from "../lib/fileImport";
import { assignBookOrder, orderLibraryBooks, reorderOnDrop, seriesGroupByBookKey } from "../lib/libraryOrder";
import { effectiveCardStyle, resolveLibraryStyle, type PerCardStyle } from "../lib/libraryStyle";
import { filterBooks, nextReadStatus, sortBooks, type SortKey, type StatusFilter } from "../lib/libraryView";
import { bookKey, mergeLibraryData } from "../lib/merge";

/** Applies a React state update wrapped in the View Transitions API when
 *  the browser supports it, so a drag-to-reorder visibly animates cards
 *  sliding to their new slots instead of just popping there (see
 *  BookCard.tsx's `viewTransitionName`). `flushSync` is required because
 *  the API needs the DOM to have actually re-rendered by the time its
 *  callback returns — a plain state update wouldn't commit until React's
 *  next scheduled render, too late for the transition to see it. Falls
 *  back to a plain (instant, unanimated) update on any browser that
 *  doesn't support it — this is a nice-to-have, never required. */
function updateWithViewTransition(applyUpdate: () => void) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
  };
  if (typeof doc.startViewTransition !== "function") {
    applyUpdate();
    return;
  }
  try {
    const transition = doc.startViewTransition(() => flushSync(applyUpdate));
    // The state update above already committed via flushSync regardless
    // of what happens to the animation itself — these two promises are
    // purely about the *animation's* outcome, not the data. `ready`
    // rejects (InvalidStateError) whenever the browser skips the
    // transition outright — a hidden document, or another transition
    // still in flight — which is routine, not a real failure, so both
    // need a no-op `.catch` or it surfaces as an unhandled rejection.
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
  } catch {
    applyUpdate();
  }
}

export function LibraryPage() {
  const queryClient = useQueryClient();
  const { scrubBooks } = useMurals();
  const { share: shareLibraryDoc, unshare: unshareLibraryDoc } = useLibrary();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const { data: library, isLoading } = useQuery({
    queryKey: ["library"],
    queryFn: fetchLibrary
  });

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [styleBookKey, setStyleBookKey] = useState<string | null>(null);
  const [coverBookKey, setCoverBookKey] = useState<string | null>(null);
  const [detailBookKey, setDetailBookKey] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("manual");

  async function handleRenameLibrary() {
    const name = nameDraft.trim();
    setEditingName(false);
    // Read the freshest cached copy, same reasoning as flushCoverUpdates
    // below — a blur and an Enter keypress can both fire this, and by the
    // time the second one runs the first's save may already be in flight.
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    const base = current?.data ?? library?.data ?? { books: [] };
    if ((base.name ?? "") === name) return; // unchanged — nothing to save
    const saved = await saveLibrary({ ...base, name });
    queryClient.setQueryData(["library"], saved);
  }

  async function handleFileChosen(file: File) {
    setImportError(null);
    // Parsing a multi-MB SQLite file through sql.js's WASM engine can take
    // a beat — worth a status message rather than a silent pause.
    setImportStatus(file.name.toLowerCase().endsWith(".sqlite") || file.name.toLowerCase().endsWith(".db") ? "Reading SQLite database…" : "Reading file…");
    try {
      const parsed = await parseImportedFile(file);
      // First import: nothing to merge against, save as-is. Every import
      // after that merges into whatever's already saved — see lib/merge.ts
      // for the actual rules (book identity across sources, the
      // keep-whichever-has-a-cover rule, highlight union, ...).
      const merged = library ? mergeLibraryData(library.data, parsed) : parsed;
      // Every book gets a stable `_order` the first time it's seen — the
      // backbone of the Library grid's display order (lib/libraryOrder.ts).
      // A book that already has one (survived a prior merge) keeps it.
      const ordered = { ...merged, books: assignBookOrder(merged.books) };
      // Additive series auto-seed (see lib/groups.ts) — never touches a
      // series the user has already renamed/deleted/hand-edited, only
      // fills in newly-appeared Series values from this import.
      const withSeries = { ...ordered, groups: deriveSeriesGroups(ordered.books, ordered.groups ?? []) };
      const saved = await saveLibrary(withSeries);
      queryClient.setQueryData(["library"], saved);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Couldn't import that file.");
    } finally {
      setImportStatus(null);
    }
  }

  // Drag a card onto another to reorder — see lib/libraryOrder.ts's
  // reorderOnDrop() for exactly what moves (the dragged book's whole
  // series if it's in one, otherwise just that book; collections never
  // affect this). The grid updates immediately (optimistically, and
  // animated via updateWithViewTransition above where supported) — the
  // dropped card visibly takes its new slot and the card that was there
  // shifts out of the way right away, not after a network round trip.
  // The save happens in the background; a failure rolls the local state
  // back rather than leaving the UI showing an order that didn't persist.
  function handleReorder(draggedKey: string, targetBook: Record<string, unknown>) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const targetKey = bookKey(targetBook);
    if (draggedKey === targetKey) return;
    const reordered = reorderOnDrop(current.data.books, current.data.groups ?? [], draggedKey, targetKey);
    if (reordered === current.data.books) return; // no-op (e.g. dropped within the same series)

    const optimistic: LibraryDocument = { ...current, data: { ...current.data, books: reordered } };
    updateWithViewTransition(() => queryClient.setQueryData(["library"], optimistic));

    saveLibrary({ ...current.data, books: reordered })
      .then((saved) => queryClient.setQueryData(["library"], saved))
      .catch((err) => {
        console.error("Failed to persist new book order:", err);
        queryClient.setQueryData(["library"], current); // roll back the optimistic update
      });
  }

  // A book's own style override — highest priority, takes effect
  // everywhere that book renders (this page, Series, Collections). See
  // BookCard.tsx's "Style" button and lib/libraryStyle.ts's
  // effectiveCardStyle for the full priority chain.
  async function handleSaveBookStyle(book: Record<string, unknown>, bookStyle: PerCardStyle | undefined) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const key = bookKey(book);
    const updatedBooks = current.data.books.map((b) => (bookKey(b) === key ? { ...b, _style: bookStyle } : b));
    const saved = await saveLibrary({ ...current.data, books: updatedBooks });
    queryClient.setQueryData(["library"], saved);
  }

  async function handleSetBookStatus(book: Record<string, unknown>) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const key = bookKey(book);
    const updatedBooks = current.data.books.map((b) => (bookKey(b) === key ? { ...b, ReadStatus: nextReadStatus(b.ReadStatus) } : b));
    const saved = await saveLibrary({ ...current.data, books: updatedBooks });
    queryClient.setQueryData(["library"], saved);
  }

  // Assigning/clearing a gallery image as a book's cover — see
  // lib/bookCovers.ts. Same read-current/mutate/save shape as
  // handleSaveBookStyle above; CoverPickerModal.tsx itself owns the
  // gallery-side upload/delete calls (hooks/useGalleryImages.ts /
  // useDeleteGalleryImage.ts), these two only ever touch this one book's
  // fields on the library document.
  async function handleSaveBookCover(book: Record<string, unknown>, image: GalleryImage) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const key = bookKey(book);
    const updatedBooks = current.data.books.map((b) => (bookKey(b) === key ? setBookCover(b, image.id, image.url) : b));
    const saved = await saveLibrary({ ...current.data, books: updatedBooks });
    queryClient.setQueryData(["library"], saved);
  }

  async function handleRemoveBookCover(book: Record<string, unknown>) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const key = bookKey(book);
    const updatedBooks = current.data.books.map((b) => (bookKey(b) === key ? clearBookCover(b) : b));
    const saved = await saveLibrary({ ...current.data, books: updatedBooks });
    queryClient.setQueryData(["library"], saved);
  }

  // Select mode: turn it on, tap cards to build up a selection, then
  // delete them all in one go — one confirmation instead of one per book.
  // Replaced an earlier per-card "Delete" button with this; selecting
  // just one book and deleting it still covers that case fine.
  function handleToggleSelect(book: Record<string, unknown>) {
    const key = bookKey(book);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleToggleSelectionMode() {
    setSelectionMode((prev) => !prev);
    setSelectedKeys(new Set()); // always start a fresh selection, whichever direction
  }

  // Scrubs every selected book's key out of every group's bookKeys too
  // (lib/groups.ts's removeBooksFromAllGroups) in the same save, so a
  // deleted book doesn't linger as a dangling reference in any series or
  // collection it was in.
  async function handleDeleteSelected() {
    if (selectedKeys.size === 0) return;
    if (
      !(await confirm({
        title: `Delete ${selectedKeys.size} book${selectedKeys.size === 1 ? "" : "s"} from your library?`,
        body: "This can't be undone."
      }))
    ) {
      return;
    }
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const saved = await saveLibrary({
      ...current.data,
      books: current.data.books.filter((b) => !selectedKeys.has(bookKey(b))),
      groups: removeBooksFromAllGroups(current.data.groups ?? [], selectedKeys)
    });
    queryClient.setQueryData(["library"], saved);
    // Independent of the library save above — murals live on their own
    // backend rows now (modules/murals), not on this document, so
    // scrubbing them out of any mural that referenced a deleted book is a
    // separate call rather than a field riding along in `saved`.
    await scrubBooks(selectedKeys);
    setSelectedKeys(new Set());
    setSelectionMode(false);
  }

  const books = library?.data.books ?? [];
  const importing = importStatus !== null;
  const style = resolveLibraryStyle(library?.data.style);
  // Display order only — the stored `books` array itself stays in plain
  // merge order (see lib/libraryOrder.ts's own comment for why). Series
  // cluster together ahead of standalone books (collections don't affect
  // this); within each, `_order` is respected. Keyed on `library` itself
  // rather than the derived `books`/`groups` — React Query keeps that
  // reference stable across re-renders that don't actually change the
  // data, where the `?? []` fallbacks above would look "new" to useMemo
  // every time.
  const ordered = useMemo(() => orderLibraryBooks(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const displayBooks = useMemo(
    () => sortBooks(filterBooks(ordered, query, statusFilter), sortKey),
    [ordered, query, statusFilter, sortKey]
  );
  const toolbarActive = query.trim() !== "" || statusFilter !== "all" || sortKey !== "manual";
  // Which series (if any) each book belongs to, for style priority — a
  // series' own style panel (GroupsPage.tsx, series only) overrides the
  // library-wide one for its cards. Built from the exact same clustering
  // orderLibraryBooks() itself uses, so "which series is this card
  // visually part of" and "whose style applies to it" never disagree.
  const bookSeriesGroup = useMemo(() => seriesGroupByBookKey(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const styleBook = styleBookKey ? books.find((b) => bookKey(b) === styleBookKey) : null;
  const coverBook = coverBookKey ? books.find((b) => bookKey(b) === coverBookKey) : null;
  const detailBook = detailBookKey ? books.find((b) => bookKey(b) === detailBookKey) : null;

  return (
    <PageContainer style={style}>
      <header className="mb-6 flex items-center justify-between gap-4">
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void handleRenameLibrary()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRenameLibrary();
              if (e.key === "Escape") setEditingName(false);
            }}
            placeholder="Name your library…"
            className="rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-lg font-bold"
          />
        ) : (
          <button
            onClick={() => {
              setNameDraft(library?.data.name ?? "");
              setEditingName(true);
            }}
            title="Rename your library"
            className="text-left text-lg font-bold transition-colors hover:text-(--color-accent)"
          >
            {library?.data.name || "Library"}
          </button>
        )}
        <div className="flex items-center gap-2">
          {books.length > 0 &&
            (selectionMode ? (
              <>
                <span className="text-sm text-(--color-text-dim)">{selectedKeys.size} selected</span>
                <button
                  onClick={() => void handleDeleteSelected()}
                  disabled={selectedKeys.size === 0}
                  className="rounded-lg bg-(--color-danger) px-3.5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  Delete selected
                </button>
                <button
                  onClick={handleToggleSelectionMode}
                  className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={handleToggleSelectionMode}
                className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
              >
                Select…
              </button>
            ))}
          <button
            onClick={() => setSharing(true)}
            className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
          >
            Share
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title={books.length > 0 ? "Matching books are merged with what's already here, not duplicated." : undefined}
            className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover) disabled:opacity-60"
          >
            {importing ? "Importing…" : books.length > 0 ? "Import more…" : "Import library…"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json,.sqlite,.db,.sqlite3,.csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileChosen(file);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {importStatus && (
        <div className="mb-5 rounded-lg bg-(--color-accent-soft) px-3 py-2 text-sm text-(--color-accent)">{importStatus}</div>
      )}
      {importError && (
        <div className="mb-5 rounded-lg bg-(--color-danger-soft) px-3 py-2 text-sm text-(--color-danger)">{importError}</div>
      )}

      {books.length > 0 && (
        <LibraryToolbar
          query={query}
          onQueryChange={setQuery}
          status={statusFilter}
          onStatusChange={setStatusFilter}
          sort={sortKey}
          onSortChange={setSortKey}
        />
      )}

      {isLoading && <p className="text-sm text-(--color-text-dim)">Loading your library…</p>}

      {!isLoading && books.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-(--color-border) py-16 text-center">
          <p className="mb-1 text-(--color-text)">No library saved yet.</p>
          <p className="mb-4 text-sm text-(--color-text-dim)">
            Import one of: a <code>library.json</code> from the exporter CLI, a <code>KoboReader.sqlite</code> straight
            off your device's USB drive, or a Goodreads library CSV export (My Books → Tools → Import/Export → Export
            Library).
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="rounded-lg bg-(--color-accent) px-4 py-2.5 font-semibold text-white disabled:opacity-60"
          >
            {importing ? "Importing…" : "Choose a file"}
          </button>
        </div>
      )}

      {books.length > 0 && displayBooks.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-(--color-border) py-12 text-center">
          <p className="mb-3 text-(--color-text)">No books match.</p>
          {toolbarActive && (
            <button
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
                setSortKey("manual");
              }}
              className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
            >
              Clear search and filters
            </button>
          )}
        </div>
      )}

      {books.length > 0 && displayBooks.length > 0 && (
        <BookGrid style={style}>
          {displayBooks.map((book, i) => {
            const seriesGroup = bookSeriesGroup.get(bookKey(book));
            const cardStyle = effectiveCardStyle(style, seriesGroup?.style, book._style as PerCardStyle | undefined);
            return (
              <BookCard
                key={String(book.ContentID ?? i)}
                book={book}
                onClick={() => setDetailBookKey(bookKey(book))}
                style={cardStyle}
                draggable={!selectionMode}
                onReorder={handleReorder}
                onOpenStyle={selectionMode ? undefined : () => setStyleBookKey(bookKey(book))}
                onOpenCoverPicker={selectionMode ? undefined : () => setCoverBookKey(bookKey(book))}
                selectable={selectionMode}
                selected={selectedKeys.has(bookKey(book))}
                onToggleSelect={handleToggleSelect}
              />
            );
          })}
        </BookGrid>
      )}

      {detailBook && (
        <BookDetailSheet
          book={detailBook}
          onOpenStyle={(b) => setStyleBookKey(bookKey(b))}
          onOpenCoverPicker={(b) => setCoverBookKey(bookKey(b))}
          onSetStatus={(b) => void handleSetBookStatus(b)}
          onClose={() => setDetailBookKey(null)}
        />
      )}

      {styleBook && (
        <PerCardStylePanel
          idPrefix="book"
          name={String(styleBook.Title ?? "Untitled")}
          priorityText="the series and library-wide"
          currentOverride={styleBook._style as PerCardStyle | undefined}
          // Seed from what this book currently looks like one level up
          // the chain — its series' style if it's in a customized one,
          // not from a blank slate.
          seedStyle={effectiveCardStyle(style, bookSeriesGroup.get(styleBookKey ?? "")?.style)}
          onSave={(bookStyle) => handleSaveBookStyle(styleBook, bookStyle)}
          onClose={() => setStyleBookKey(null)}
        />
      )}

      {coverBook && (
        <CoverPickerModal
          title={String(coverBook.Title ?? "Untitled")}
          currentImageId={typeof coverBook._coverImageId === "string" ? coverBook._coverImageId : null}
          removeCoverLabel="Remove custom cover — go back to the normal auto-detected one"
          onSelect={(image) => void handleSaveBookCover(coverBook, image)}
          onRemoveCover={() => void handleRemoveBookCover(coverBook)}
          onClose={() => setCoverBookKey(null)}
        />
      )}

      {sharing && (
        <ShareModal
          title={library?.data.name || "Library"}
          shareToken={library?.shareToken ?? null}
          shareUrl={library?.shareUrl ?? null}
          defaultCaption={library?.data.name ?? "My library"}
          onShare={async () => {
            const updated = await shareLibraryDoc();
            return { shareToken: updated.shareToken as string, shareUrl: updated.shareUrl as string };
          }}
          onUnshare={async () => {
            await unshareLibraryDoc();
          }}
          onClose={() => setSharing(false)}
        />
      )}
    </PageContainer>
  );
}
