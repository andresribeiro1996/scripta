import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { GalleryImage } from "../api/gallery";
import { fetchLibrary, saveLibrary, type LibraryData, type LibraryDocument } from "../api/library";
import { AddBookModal } from "../components/AddBookModal";
import { BookCard } from "../components/BookCard";
import { BookDetailSheet } from "../components/BookDetailSheet";
import { BookGrid } from "../components/BookGrid";
import { CoverPickerModal } from "../components/CoverPickerModal";
import { EmptyState } from "../components/EmptyState";
import { LibraryCanvas } from "../components/LibraryCanvas";
import { LibraryToolbar } from "../components/LibraryToolbar";
import { LibraryIcon } from "../components/NavIcons";
import type { OptionsMenuItem } from "../components/OptionsMenu";
import { PageContainer } from "../components/PageContainer";
import { PerCardStylePanel } from "../components/PerCardStylePanel";
import { ShareModal } from "../components/ShareModal";
import { SyncGoodreadsModal } from "../components/SyncGoodreadsModal";
import { SkeletonBookGrid } from "../components/Skeleton";
import { useToast } from "../components/Toaster";
import { FilterIcon } from "../components/Toolbar";
import { useDelayedShow } from "../hooks/useDelayedShow";
import { useLibrary } from "../hooks/useLibrary";
import { useMurals } from "../hooks/useMurals";
import { clearBookCover, setBookCover } from "../lib/bookCovers";
import { parseImportedFile } from "../lib/fileImport";
import { deriveSeriesGroups, removeBooksFromAllGroups } from "../lib/groups";
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
  const navigate = useNavigate();
  const { scrubBooks } = useMurals();
  const { share: shareLibraryDoc, unshare: unshareLibraryDoc } = useLibrary();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suppressClickAfterDragRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [syncingGoodreads, setSyncingGoodreads] = useState(false);
  const [addingBook, setAddingBook] = useState(false);

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
    try {
      const saved = await saveLibrary({ ...base, name });
      queryClient.setQueryData(["library"], saved);
    } catch {
      toast({ message: "Couldn't save the new name.", kind: "error" });
    }
  }

  // Shared tail of every path that brings books in — a generic file
  // import, a Goodreads re-sync (SyncGoodreadsModal), a single manual
  // add (AddBookModal). Merge against the freshest saved document (see
  // lib/merge.ts for the rules — book identity across sources,
  // newest-wins, the keep-whichever-has-a-cover rule, highlight union),
  // then `_order` for genuinely-new books (lib/libraryOrder.ts) and the
  // additive series auto-seed (lib/groups.ts), and one PUT. Because the
  // manual-add path funnels through here too, adding a book you already
  // have updates it in place instead of duplicating it.
  async function mergeAndSave(parsed: LibraryData) {
    // Read the freshest cached copy, not a stale closure — same
    // reasoning as handleRenameLibrary above.
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    const existing = current?.data ?? library?.data;
    const merged = existing ? mergeLibraryData(existing, parsed) : parsed;
    const ordered = { ...merged, books: assignBookOrder(merged.books) };
    const withSeries = { ...ordered, groups: deriveSeriesGroups(ordered.books, ordered.groups ?? []) };
    const saved = await saveLibrary(withSeries);
    queryClient.setQueryData(["library"], saved);
  }

  async function handleFileChosen(file: File) {
    setImportError(null);
    // Parsing a multi-MB SQLite file through sql.js's WASM engine can take
    // a beat — worth a status message rather than a silent pause.
    setImportStatus(file.name.toLowerCase().endsWith(".sqlite") || file.name.toLowerCase().endsWith(".db") ? "Reading SQLite database…" : "Reading file…");
    try {
      await mergeAndSave(await parseImportedFile(file));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Couldn't import that file.");
    } finally {
      setImportStatus(null);
    }
  }

  async function handleAddBook(book: Record<string, unknown>) {
    await mergeAndSave({ books: [book] });
    toast({ message: `Added "${String(book.Title ?? "book")}".` });
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
  function handleReorder(draggedKey: string, targetKey: string) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    if (draggedKey === targetKey) return;
    const reordered = reorderOnDrop(current.data.books, current.data.groups ?? [], draggedKey, targetKey);
    if (reordered === current.data.books) return; // no-op (e.g. dropped within the same series)

    const optimistic: LibraryDocument = { ...current, data: { ...current.data, books: reordered } };
    updateWithViewTransition(() => queryClient.setQueryData(["library"], optimistic));

    saveLibrary({ ...current.data, books: reordered })
      .then((saved) => queryClient.setQueryData(["library"], saved))
      .catch((err) => {
        console.error("Failed to persist new book order:", err);
        toast({ message: "Couldn't save the new order — moved back.", kind: "error" });
        queryClient.setQueryData(["library"], current); // roll back the optimistic update
      });
  }

  function handleDragEnd(e: DragEndEvent) {
    if (e.over && String(e.over.id) !== String(e.active.id)) {
      handleReorder(String(e.active.id), String(e.over.id));
    }
    if (e.activatorEvent instanceof KeyboardEvent) suppressClickAfterDragRef.current = true;
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
    try {
      const saved = await saveLibrary({ ...current.data, books: updatedBooks });
      queryClient.setQueryData(["library"], saved);
    } catch {
      toast({ message: "Couldn't save the style change.", kind: "error" });
    }
  }

  async function handleSetBookStatus(book: Record<string, unknown>) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const key = bookKey(book);
    const updatedBooks = current.data.books.map((b) => (bookKey(b) === key ? { ...b, ReadStatus: nextReadStatus(b.ReadStatus) } : b));
    try {
      const saved = await saveLibrary({ ...current.data, books: updatedBooks });
      queryClient.setQueryData(["library"], saved);
    } catch {
      toast({ message: "Couldn't save the status change.", kind: "error" });
    }
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
    try {
      const saved = await saveLibrary({ ...current.data, books: updatedBooks });
      queryClient.setQueryData(["library"], saved);
    } catch {
      toast({ message: "Couldn't save the cover change.", kind: "error" });
    }
  }

  async function handleRemoveBookCover(book: Record<string, unknown>) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const key = bookKey(book);
    const updatedBooks = current.data.books.map((b) => (bookKey(b) === key ? clearBookCover(b) : b));
    try {
      const saved = await saveLibrary({ ...current.data, books: updatedBooks });
      queryClient.setQueryData(["library"], saved);
    } catch {
      toast({ message: "Couldn't save the cover change.", kind: "error" });
    }
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
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const keys = selectedKeys;
    try {
      const saved = await saveLibrary({
        ...current.data,
        books: current.data.books.filter((b) => !keys.has(bookKey(b))),
        groups: removeBooksFromAllGroups(current.data.groups ?? [], keys)
      });
      queryClient.setQueryData(["library"], saved);
    } catch {
      toast({ message: "Couldn't delete — nothing was changed.", kind: "error" });
      return;
    }
    setSelectedKeys(new Set());
    setSelectionMode(false);
    const scrubTimer = setTimeout(() => void scrubBooks(keys), 6500);
    toast({
      message: `Deleted ${keys.size} book${keys.size === 1 ? "" : "s"}.`,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(scrubTimer);
          void (async () => {
            try {
              const restored = await saveLibrary(current.data);
              queryClient.setQueryData(["library"], restored);
              toast({ message: "Restored." });
            } catch {
              toast({ message: "Couldn't restore — check your connection.", kind: "error" });
            }
          })();
        }
      },
      duration: 6000
    });
  }

  const books = library?.data.books ?? [];
  const importing = importStatus !== null;
  const style = resolveLibraryStyle(library?.data.style);
  const showSkeleton = useDelayedShow(isLoading);
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

  // The phone's only route to these actions — there is no header on a
  // phone to hold them. Passed to LibraryToolbar as ITEMS rather than a
  // rendered menu: the toolbar shows them behind a gear in its own row
  // and opens them in a bottom sheet, matching the filter and sort
  // controls sitting right beside it.
  //
  // Suppressed during selection mode, where the header reappears
  // carrying "Delete selected" and its live count: that action is
  // destructive and count-dependent, so it stays visible with explicit
  // buttons rather than hiding behind a gear.
  //
  // Nothing renders these when the library is empty, since the toolbar
  // itself doesn't render then. That's deliberate rather than a gap: the
  // empty state shows the header (so the library name is there and
  // tappable to rename) plus its own prominent "Choose a file" button,
  // which covers importing. Sharing an empty library is the only thing
  // out of reach, and it has nothing to share.
  const actionItems: OptionsMenuItem[] = [
    // First, because it's the one thing that lost its own visible
    // affordance when the library-name row went away on phones.
    {
      label: "Rename library…",
      onClick: () => {
        setNameDraft(library?.data.name ?? "");
        setEditingName(true);
      }
    },
    { label: "Add book…", onClick: () => setAddingBook(true) },
    { label: "Sync Goodreads…", onClick: () => setSyncingGoodreads(true) },
    ...(books.length > 0 ? [{ label: "Select…", onClick: handleToggleSelectionMode }] : []),
    // Moved out of the app nav: it styles this page's cards and canvas,
    // not the app, so it belongs with the other things you do to your
    // library rather than sitting beside Settings.
    { label: "Library style…", onClick: () => navigate("/dashboard/style") },
    { label: "Share", onClick: () => setSharing(true) },
    {
      label: importing ? "Importing…" : books.length > 0 ? "Import more…" : "Import library…",
      onClick: () => {
        if (!importing) fileInputRef.current?.click();
      }
    }
  ];

  return (
    <PageContainer maxWidth={style.contentMaxWidth}>
      {/* Desktop-only, with one exception: renaming. On a phone the whole
          header is gone — its actions moved into the toolbar row and the
          library name into that row's menu — but "Rename library…" in
          that menu still needs somewhere to put its text input, so the
          header comes back for exactly as long as `editingName` is on.
          Without that the menu item would appear to do nothing. */}
      <header
        className={`mb-4 items-center justify-between gap-3 sm:mb-6 sm:flex sm:gap-4 ${
          editingName || books.length === 0 ? "flex" : "hidden"
        }`}
      >
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
            className="min-w-0 truncate text-left text-lg font-bold transition-colors hover:text-(--color-accent)"
          >
            {library?.data.name || "Library"}
          </button>
        )}
        {/* Selection mode is deliberately NOT collapsed into the menu on
            mobile — "Delete selected" is destructive and count-dependent,
            so it stays visible with its live count next to it. Everything
            else folds behind one gear below `sm`; see the menu below. */}
        <div className="flex items-center gap-2">
          {books.length > 0 && selectionMode && (
            <>
              <span className="text-sm text-(--color-text-dim)">{selectedKeys.size} selected</span>
              <button
                onClick={() => void handleDeleteSelected()}
                disabled={selectedKeys.size === 0}
                className="min-h-11 rounded-lg bg-(--color-danger) px-3.5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                Delete selected
              </button>
              <button
                onClick={handleToggleSelectionMode}
                className="min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
              >
                Cancel
              </button>
            </>
          )}

          <div className={`hidden items-center gap-2 sm:flex ${selectionMode ? "sm:hidden" : ""}`}>
            <button
              onClick={() => setAddingBook(true)}
              className="min-h-11 rounded-lg bg-(--color-accent) px-3.5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              Add book
            </button>
            <button
              onClick={() => setSyncingGoodreads(true)}
              className="min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
            >
              Sync Goodreads…
            </button>
            {books.length > 0 && (
              <button
                onClick={handleToggleSelectionMode}
                className="min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
              >
                Select…
              </button>
            )}
            {/* The phone reaches this through the toolbar gear; the
                desktop header has no gear, so without an explicit button
                here Library style would be unreachable from the UI
                entirely once it left the nav. */}
            <button
              onClick={() => navigate("/dashboard/style")}
              className="min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
            >
              Style…
            </button>
            <button
              onClick={() => setSharing(true)}
              className="min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
            >
              Share
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              title={books.length > 0 ? "Matching books are merged with what's already here, not duplicated." : undefined}
              className="min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover) disabled:opacity-60"
            >
              {importing ? "Importing…" : books.length > 0 ? "Import more…" : "Import library…"}
            </button>
          </div>
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
          // Phone-only; see the `actionItems` definition above.
          actions={selectionMode ? undefined : actionItems}
        />
      )}

      {/* Inside LibraryCanvas, like the real grid below: the canvas
          carries the user's own background and padding, so a skeleton
          outside it would shift the whole grid the moment books
          arrive — the exact jump this replaces. */}
      {showSkeleton && (
        <LibraryCanvas style={style}>
          <SkeletonBookGrid style={style} />
        </LibraryCanvas>
      )}

      {!isLoading && books.length === 0 && (
        <EmptyState
          icon={LibraryIcon}
          title="No library saved yet."
          body={
            <>
              Import one of: a <code>library.json</code> from the exporter CLI, a <code>KoboReader.sqlite</code> straight
              off your device's USB drive, a Goodreads library CSV export (My Books → Tools → Import/Export → Export
              Library), or a StoryGraph library CSV export (profile icon → Manage Your Account → Manage Your Data →
              Export StoryGraph Library).
            </>
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="rounded-lg bg-(--color-accent) px-4 py-2.5 font-semibold text-white disabled:opacity-60"
              >
                {importing ? "Importing…" : "Choose a file"}
              </button>
              <button
                onClick={() => setAddingBook(true)}
                className="rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-2.5 text-sm hover:bg-(--color-surface-hover)"
              >
                Add a book
              </button>
            </div>
          }
        />
      )}

      {books.length > 0 && displayBooks.length === 0 && (
        <EmptyState
          icon={FilterIcon}
          title="No books match."
          body="Every book is still here — the search or filters above just don't match any of them."
          action={
            toolbarActive && (
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
            )
          }
        />
      )}

      {books.length > 0 && displayBooks.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            suppressClickAfterDragRef.current = true;
          }}
        >
          <LibraryCanvas style={style}>
            <BookGrid style={style}>
              {displayBooks.map((book, i) => {
                const seriesGroup = bookSeriesGroup.get(bookKey(book));
                const cardStyle = effectiveCardStyle(style, seriesGroup?.style, book._style as PerCardStyle | undefined);
                return (
                  <BookCard
                    key={String(book.ContentID ?? i)}
                    book={book}
                    onClick={() => {
                      if (suppressClickAfterDragRef.current) {
                        suppressClickAfterDragRef.current = false;
                        return;
                      }
                      setDetailBookKey(bookKey(book));
                    }}
                    style={cardStyle}
                    reorderable={!selectionMode}
                    onOpenStyle={selectionMode ? undefined : () => setStyleBookKey(bookKey(book))}
                    onOpenCoverPicker={selectionMode ? undefined : () => setCoverBookKey(bookKey(book))}
                    selectable={selectionMode}
                    selected={selectedKeys.has(bookKey(book))}
                    onToggleSelect={handleToggleSelect}
                  />
                );
              })}
            </BookGrid>
          </LibraryCanvas>
        </DndContext>
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

      {addingBook && <AddBookModal onAdd={(book) => handleAddBook(book)} onClose={() => setAddingBook(false)} />}

      {syncingGoodreads && (
        <SyncGoodreadsModal
          onFile={async (file) => mergeAndSave(await parseImportedFile(file))}
          onClose={() => setSyncingGoodreads(false)}
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
