import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import {
  buildMergedLibrary,
  deleteBooks,
  findDuplicates,
  LIBRARY_CSV_TEMPLATE,
  restoreDeletedBooks,
  saveFailureMessage
} from "@scripta/shared";
import { fetchIsAdmin } from "../api/books";
import type { LibraryData, LibraryDocument } from "../api/library";
import { AddBookModal } from "../components/AddBookModal";
import { BookCard, coverParamsFor } from "../components/BookCard";
import { BookGrid } from "../components/BookGrid";
import { CoverPickerModal } from "../components/CoverPickerModal";
import { DuplicatesSheet } from "../components/DuplicatesSheet";
import { EmptyState } from "../components/EmptyState";
import { LibraryCanvas } from "../components/LibraryCanvas";
import { LibraryToolbar } from "../components/LibraryToolbar";
import { LibraryIcon, MoreIcon } from "../components/NavIcons";
import { OptionsMenu, type OptionsMenuItem } from "../components/OptionsMenu";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../components/page/buttonClasses";
import { PerCardStylePanel } from "../components/PerCardStylePanel";
import { ShareModal } from "../components/ShareModal";
import { SyncGoodreadsModal } from "../components/SyncGoodreadsModal";
import { SkeletonBookGrid } from "../components/Skeleton";
import { useToast } from "../components/Toaster";
import { FilterIcon } from "../components/Toolbar";
import { useBookActions } from "../hooks/useBookActions";
import { useDelayedShow } from "../hooks/useDelayedShow";
import { useLibrary } from "../hooks/useLibrary";
import { useLibrarySaver } from "../hooks/useLibrarySaver";
import { useMurals } from "../hooks/useMurals";
import { parseImportedFile } from "../lib/fileImport";
import { orderLibraryBooks, reorderOnDrop, seriesGroupByBookKey } from "../lib/libraryOrder";
import { area } from "../lib/areas";
import { effectiveCardStyle, resolveLibraryStyle, type PerCardStyle } from "../lib/libraryStyle";
import { bookHref, filterBooks, SORT_OPTIONS, sortBooks, STATUS_FILTER_OPTIONS, type SortKey, type StatusFilter } from "../lib/libraryView";
import { bookKey } from "../lib/merge";
import { saveWithViewTransition } from "../lib/viewTransition";

const scrollPositions = new Map<string, number>();

export function LibraryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { key: locationKey } = useLocation();
  const navigationType = useNavigationType();
  const restorePendingRef = useRef(navigationType === "POP" && scrollPositions.has(locationKey));
  const csvTemplateUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(LIBRARY_CSV_TEMPLATE)}`;

  function downloadCsvTemplate() {
    const link = document.createElement("a");
    link.href = csvTemplateUrl;
    link.download = "atmyshelf-library.csv";
    link.click();
  }
  const [searchParams, setSearchParams] = useSearchParams();
  const { scrubBooks } = useMurals();
  const saver = useLibrarySaver();
  const { data: library, isLoading, updateLibrary, share: shareLibraryDoc, unshare: unshareLibraryDoc } = useLibrary();
  const possibleDuplicates = useMemo(() => {
    if (!library) return [];
    const { certain, likely } = findDuplicates(library.data);
    return [...certain, ...likely];
  }, [library]);
  const toast = useToast();
  const bookActions = useBookActions();
  const { data: isAdmin = false } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suppressClickAfterDragRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [syncingGoodreads, setSyncingGoodreads] = useState(false);
  const [reviewingDuplicates, setReviewingDuplicates] = useState(false);
  const [addingBook, setAddingBook] = useState(searchParams.get("action") === "add");

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [styleBookKey, setStyleBookKey] = useState<string | null>(null);
  const [coverBookKey, setCoverBookKey] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  useEffect(() => { setQuery(urlQuery); }, [urlQuery]);
  useEffect(() => { setAddingBook(searchParams.get("action") === "add"); }, [searchParams]);
  const statusParam = searchParams.get("status");
  const statusFilter = STATUS_FILTER_OPTIONS.find((option) => option.value === statusParam)?.value ?? "all";
  const sortParam = searchParams.get("sort");
  const sortKey = SORT_OPTIONS.find((option) => option.value === sortParam)?.value ?? "manual";
  function updateView(changes: { status?: StatusFilter; sort?: SortKey }) {
    const defaults = { status: "all", sort: "manual" };
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [name, value] of Object.entries(changes)) {
          if (value === defaults[name as keyof typeof defaults]) next.delete(name);
          else next.set(name, value);
        }
        return next;
      },
      { replace: true }
    );
  }

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
      await updateLibrary((data) => ({ ...data, name }));
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save the new name."), kind: "error" });
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
  //
  // `source: "import"` marks the bulk paths (file import, Goodreads
  // re-sync) so the backend's save diff skips book-event emission for
  // them — a re-import of the same file is housekeeping, not reading
  // activity. The manual add passes no source, so its save still emits.
  async function mergeAndSave(parsed: LibraryData, source?: "import") {
    await updateLibrary((existing) => buildMergedLibrary(existing, parsed), { source });
  }

  async function handleFileChosen(file: File) {
    setImportError(null);
    // Parsing a multi-MB SQLite file through sql.js's WASM engine can take
    // a beat — worth a status message rather than a silent pause.
    setImportStatus(file.name.toLowerCase().endsWith(".sqlite") || file.name.toLowerCase().endsWith(".db") ? "Reading SQLite database…" : "Reading file…");
    try {
      await mergeAndSave(await parseImportedFile(file), "import");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Couldn't import that file.");
    } finally {
      setImportStatus(null);
    }
  }

  async function handleAddBook(book: Record<string, unknown>) {
    const result = await saver.submit({ kind: "add", book });
    if (!result.ok) throw result.error;
    toast({ message: `Added "${String(book.Title ?? "book")}".` });
  }

  // Drag a card onto another to reorder — see lib/libraryOrder.ts's
  // reorderOnDrop() for exactly what moves (the dragged book's whole
  // series if it's in one, otherwise just that book; collections never
  // affect this). The grid updates immediately (optimistically, and
  // animated via saveWithViewTransition where supported) — the
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

    const saving = saveWithViewTransition(() =>
      updateLibrary((data) => {
        const books = reorderOnDrop(data.books, data.groups ?? [], draggedKey, targetKey);
        return books === data.books ? data : { ...data, books };
      }, { optimistic: true }),
    );

    saving.catch((err) => {
      console.error("Failed to persist new book order:", err);
      toast({ message: saveFailureMessage(err, "Couldn't save the new order — moved back."), kind: "error" });
    });
  }

  function handleDragEnd(e: DragEndEvent) {
    if (e.over && String(e.over.id) !== String(e.active.id)) {
      handleReorder(String(e.active.id), String(e.over.id));
    }
    if (e.activatorEvent instanceof KeyboardEvent) suppressClickAfterDragRef.current = true;
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

  async function handleDeleteSelected() {
    if (selectedKeys.size === 0) return;
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const keys = selectedKeys;
    let snapshot = current.data;
    try {
      await updateLibrary((data) => {
        snapshot = data;
        return deleteBooks(data, keys);
      });
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't delete — nothing was changed."), kind: "error" });
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
              await updateLibrary((data) => restoreDeletedBooks(data, snapshot, keys));
              toast({ message: "Restored." });
            } catch (error) {
              toast({ message: saveFailureMessage(error, "Couldn't restore — check your connection."), kind: "error" });
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
  const gridReady = books.length > 0 && displayBooks.length > 0;
  useLayoutEffect(() => {
    function remember() {
      if (!restorePendingRef.current) scrollPositions.set(locationKey, window.scrollY);
    }
    remember();
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [locationKey]);
  useLayoutEffect(() => {
    if (!restorePendingRef.current) return;
    if (gridReady) {
      restorePendingRef.current = false;
      window.scrollTo({ top: scrollPositions.get(locationKey), behavior: "instant" });
    } else if (!isLoading) {
      restorePendingRef.current = false;
    }
  }, [gridReady, isLoading, locationKey]);
  const toolbarActive = query.trim() !== "" || statusFilter !== "all" || sortKey !== "manual";
  // Which series (if any) each book belongs to, for style priority — a
  // series' own style panel (GroupsPage.tsx, series only) overrides the
  // library-wide one for its cards. Built from the exact same clustering
  // orderLibraryBooks() itself uses, so "which series is this card
  // visually part of" and "whose style applies to it" never disagree.
  const bookSeriesGroup = useMemo(() => seriesGroupByBookKey(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const styleBook = styleBookKey ? books.find((b) => bookKey(b) === styleBookKey) : null;
  const coverBook = coverBookKey ? books.find((b) => bookKey(b) === coverBookKey) : null;

  const actionItems: OptionsMenuItem[] = [
    { label: "Sync Goodreads…", onClick: () => setSyncingGoodreads(true) },
    { label: "Download CSV template", onClick: downloadCsvTemplate },
    ...(books.length > 0 ? [{ label: "Select…", onClick: handleToggleSelectionMode }] : []),
    { label: "Library style…", onClick: () => navigate("/dashboard/style") },
    { label: "Share", onClick: () => setSharing(true) },
    {
      label: importing ? "Importing…" : "Import library…",
      onClick: () => {
        if (!importing) fileInputRef.current?.click();
      }
    }
  ];

  return (
    <Page
      title="Library"
      subtitle={
        <>
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              maxLength={200}
              aria-label="Library name"
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void handleRenameLibrary()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRenameLibrary();
                if (e.key === "Escape") setEditingName(false);
              }}
              placeholder="Name your library…"
              className="min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-2 text-sm"
            />
          ) : (
            <button
              onClick={() => {
                setNameDraft(library?.data.name ?? "");
                setEditingName(true);
              }}
              title="Rename your library"
              className="inline-flex min-h-11 max-w-full min-w-0 items-center rounded-lg text-left break-all min-w-11 hover:text-(--color-accent)"
            >
              {library?.data.name || "Name your library"}
            </button>
          )}
          {isLoading ? null : ` · ${books.length} book${books.length === 1 ? "" : "s"}`}
        </>
      }
      tabs={area("library").tabs}
      maxWidth={style.contentMaxWidth}
      actions={
        <>
          {books.length > 0 && selectionMode ? (
            <>
              <span className="text-sm text-(--color-text-dim)">{selectedKeys.size} selected</span>
              <button
                onClick={() => void handleDeleteSelected()}
                disabled={selectedKeys.size === 0}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-(--color-danger) px-4 text-sm font-semibold text-(--color-on-danger) hover:opacity-90 disabled:opacity-50"
              >
                Delete selected
              </button>
              <button onClick={handleToggleSelectionMode} className={BUTTON_SECONDARY}>Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => setAddingBook(true)} className={BUTTON_PRIMARY}>Add a book</button>
              <OptionsMenu
                items={actionItems}
                title="More actions"
                trigger={<MoreIcon size={22} />}
                triggerClassName="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface) text-(--color-text) hover:bg-(--color-surface-hover)"
              />
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json,.sqlite,.db,.sqlite3,.csv,text/csv,.tsv,text/tab-separated-values"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileChosen(file);
              e.target.value = "";
            }}
          />
        </>
      }
    >
      {searchParams.get("action") === "import" ? <div className="mb-4 rounded-lg border border-(--color-border) p-4"><h2 className="font-semibold">Import library</h2><button className={`mt-2 ${BUTTON_SECONDARY}`} onClick={() => fileInputRef.current?.click()}>Choose import file</button></div> : null}

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
          onStatusChange={(status) => updateView({ status })}
          sort={sortKey}
          onSortChange={(sort) => updateView({ sort })}
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
              Library), a StoryGraph library CSV export (profile icon → Manage Your Account → Manage Your Data →
              Export StoryGraph Library), a Calibre CSV catalog, a LibraryThing TSV export, a BookWyrm book-list CSV, or a spreadsheet CSV.
              <span className="mt-2 block">LibraryThing: More → Import/Export → Tab-Delimited Text. BookWyrm: Settings → Export Book List → CSV.</span>
              <span className="mt-2 block">For Calibre, export a CSV catalog with title and authors. For spreadsheets, Title and Author are required; other fields are optional. Status: to-read, reading, or read. Rating: 0–5. Dates: YYYY-MM-DD. Blank fields keep your saved values.</span>
              <a href={csvTemplateUrl} download="atmyshelf-library.csv" className="mt-2 inline-block min-h-11 py-2.5 text-(--color-accent) underline">Download CSV template</a>
            </>
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className={BUTTON_SECONDARY}
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
                  updateView({ status: "all", sort: "manual" });
                }}
                className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
              >
                Clear search and filters
              </button>
            )
          }
        />
      )}

      {possibleDuplicates.length > 0 && (
        <button
          type="button"
          onClick={() => setReviewingDuplicates(true)}
          className="mb-3 flex min-h-11 w-full items-center justify-between rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
        >
          <span>{possibleDuplicates.length === 1 ? "1 possible duplicate" : `${possibleDuplicates.length} possible duplicates`}</span>
          <span className="font-semibold">Review</span>
        </button>
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
                      navigate(bookHref(bookKey(book), library?.works));
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
          onSave={(bookStyle) => bookActions.saveStyle(styleBook, bookStyle)}
          onClose={() => setStyleBookKey(null)}
        />
      )}

      {coverBook && (
        <CoverPickerModal
          title={String(coverBook.Title ?? "Untitled")}
          currentImageId={typeof coverBook._coverImageId === "string" ? coverBook._coverImageId : null}
          lookup={coverParamsFor(coverBook)}
          coverUrl={typeof coverBook._coverUrl === "string" ? coverBook._coverUrl : null}
          isAdmin={isAdmin}
          removeCoverLabel="Remove custom cover — go back to the normal auto-detected one"
          onSelect={(image) => void bookActions.saveCover(coverBook, image)}
          onPickFound={(cover, everyone) => {
            if (everyone) void bookActions.saveCoverForEveryone(coverBook, cover);
            else if (cover.fullUrl) void bookActions.saveCoverUrl(coverBook, cover.fullUrl);
            setCoverBookKey(null);
          }}
          onRemoveCover={() => void bookActions.removeCover(coverBook)}
          onClose={() => setCoverBookKey(null)}
        />
      )}

      {addingBook && <AddBookModal onAdd={(book) => handleAddBook(book)} onClose={() => setAddingBook(false)} />}

      {reviewingDuplicates && library && possibleDuplicates.length > 0 && (
        <DuplicatesSheet groups={possibleDuplicates} library={library} onClose={() => setReviewingDuplicates(false)} />
      )}

      {syncingGoodreads && (
        <SyncGoodreadsModal
          onFile={async (file) => mergeAndSave(await parseImportedFile(file), "import")}
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
    </Page>
  );
}
