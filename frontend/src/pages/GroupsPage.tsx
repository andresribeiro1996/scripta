import { useMemo, useState } from "react";
import type { GalleryImage } from "../api/gallery";
import { BookCard } from "../components/BookCard";
import { BookGrid } from "../components/BookGrid";
import { CoverPickerModal } from "../components/CoverPickerModal";
import { LibraryCanvas } from "../components/LibraryCanvas";
import { OptionsMenu } from "../components/OptionsMenu";
import { PageContainer } from "../components/PageContainer";
import { PerCardStylePanel } from "../components/PerCardStylePanel";
import { ActionSheet } from "../components/Sheet";
import { SkeletonGroups } from "../components/Skeleton";
import { useToast } from "../components/Toaster";
import { GearIcon, PlusIcon, TOOLBAR_CONTROL_CLASS, ToolbarRow, toolbarIconClass } from "../components/Toolbar";
import { useDelayedShow } from "../hooks/useDelayedShow";
import { useLibrary } from "../hooks/useLibrary";
import { useMurals } from "../hooks/useMurals";
import { clearBookCover, setBookCover } from "../lib/bookCovers";
import {
  addBookToGroup,
  deleteGroup,
  makeGroup,
  orderedGroupBooks,
  removeBooksFromAllGroups,
  removeBookFromGroup,
  renameGroup,
  setGroupStyle,
  type Group,
  type GroupType
} from "../lib/groups";
import { seriesGroupByBookKey } from "../lib/libraryOrder";
import { effectiveCardStyle, resolveLibraryStyle, type PerCardStyle } from "../lib/libraryStyle";
import { bookKey } from "../lib/merge";

const COPY: Record<GroupType, { title: string; noun: string; empty: string; untitled: string }> = {
  series: {
    title: "Series",
    noun: "series",
    empty:
      "No series yet. Series are picked up automatically from your books' Series field on import — or add one by hand below.",
    untitled: "Untitled series"
  },
  collection: {
    title: "Collections",
    noun: "collection",
    empty: "No collections yet. Create one to start organizing your books your own way.",
    untitled: "Untitled collection"
  }
};

/** Backs both /dashboard/series and /dashboard/collections — the two are
 *  the same underlying resource (see lib/groups.ts), differing only in
 *  copy and in that series also get auto-seeded from book metadata. */
export function GroupsPage({ type }: { type: GroupType }) {
  const { data: library, isLoading, updateLibrary } = useLibrary();
  const { scrubBooks } = useMurals();
  const copy = COPY[type];
  const [actionsOpen, setActionsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftName, setDraftName] = useState("");
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null);
  const [styleGroupId, setStyleGroupId] = useState<string | null>(null);
  const [styleBookKey, setStyleBookKey] = useState<string | null>(null);
  const [coverBookKey, setCoverBookKey] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const books = library?.data.books ?? [];
  const allGroups = useMemo(
    () => (library?.data.groups ?? []).filter((g) => g.type === type).sort((a, b) => a.name.localeCompare(b.name)),
    [library, type]
  );
  // Matches a group's own name OR any book title inside it — "which
  // collection did I put Dune in?" is at least as common a question here
  // as "where's my sci-fi collection", and the second is unanswerable if
  // only names are searched. Kept out of `allGroups` so the "+" tile and
  // the empty-state copy can still reason about how many groups exist at
  // all, rather than how many currently match.
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return allGroups;
    return allGroups.filter((group) => {
      if (group.name.toLowerCase().includes(needle)) return true;
      return orderedGroupBooks(group, books).some((book) => String(book.Title ?? "").toLowerCase().includes(needle));
    });
  }, [allGroups, books, search]);
  // Which series (if any) each book actually belongs to, regardless of
  // which page this is (Series or Collections) — `groups` above is
  // filtered to just this page's type, so on Collections it never
  // contains the series a book might be in. A book's true effective
  // style (library < series < book) doesn't change depending on which
  // page happens to be showing it, so this always resolves against the
  // FULL group list, same as LibraryPage.tsx's identical lookup.
  const bookSeriesGroup = useMemo(() => seriesGroupByBookKey(library?.data.books ?? [], library?.data.groups ?? []), [library]);

  // Clicking "+" does NOT create anything: it opens an unsaved draft row
  // with its name field focused. The group is only persisted once a
  // non-empty name is committed — so backing out, or tapping "+" out of
  // curiosity, leaves nothing behind. Creating on click had been
  // littering the list with "Untitled series" every time someone
  // changed their mind.
  function handleStartDraft() {
    setDraftName("");
    setDrafting(true);
  }

  async function handleCommitDraft() {
    const name = draftName.trim();
    setDrafting(false);
    setDraftName("");
    // An empty name is an abandoned draft, not an error to report: it's
    // the ordinary way of backing out, by tapping away.
    if (!name || creating) return;
    setCreating(true);
    try {
      await updateLibrary((data) => ({ ...data, groups: [...(data.groups ?? []), makeGroup(type, name)] }));
    } catch {
      toast({ message: "Couldn't save — check your connection.", kind: "error" });
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(id: string) {
    const name = editingName.trim();
    setEditingId(null);
    if (!name) return;
    try {
      await updateLibrary((data) => ({ ...data, groups: renameGroup(data.groups ?? [], id, name) }));
    } catch {
      toast({ message: "Couldn't save — check your connection.", kind: "error" });
    }
  }

  async function handleDelete(group: Group) {
    const snapshot = library?.data;
    if (!snapshot) return;
    try {
      await updateLibrary((data) => ({ ...data, groups: deleteGroup(data.groups ?? [], group.id) }));
    } catch {
      toast({ message: "Couldn't delete — nothing was changed.", kind: "error" });
      return;
    }
    toast({
      message: `Deleted "${group.name}".`,
      action: {
        label: "Undo",
        onClick: () => {
          void (async () => {
            try {
              await updateLibrary(() => snapshot);
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

  async function handleToggleBook(groupId: string, book: Record<string, unknown>, inGroup: boolean) {
    try {
      await updateLibrary((data) => ({
        ...data,
        groups: inGroup ? removeBookFromGroup(data.groups ?? [], groupId, book) : addBookToGroup(data.groups ?? [], groupId, book)
      }));
    } catch {
      toast({ message: "Couldn't save — check your connection.", kind: "error" });
    }
  }

  async function handleSaveGroupStyle(groupId: string, groupStyle: PerCardStyle | undefined) {
    try {
      await updateLibrary((data) => ({ ...data, groups: setGroupStyle(data.groups ?? [], groupId, groupStyle) }));
    } catch {
      toast({ message: "Couldn't save — check your connection.", kind: "error" });
    }
  }

  // A book's own style override — highest priority, takes effect
  // everywhere that book renders (this page, Library, the other
  // GroupsPage instance). See BookCard.tsx's "Style" button and
  // lib/libraryStyle.ts's effectiveCardStyle for the full priority chain.
  async function handleSaveBookStyle(book: Record<string, unknown>, bookStyle: PerCardStyle | undefined) {
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? { ...b, _style: bookStyle } : b))
      }));
    } catch {
      toast({ message: "Couldn't save — check your connection.", kind: "error" });
    }
  }

  // Assigning/clearing a gallery image as a book's cover — see
  // lib/bookCovers.ts. CoverPickerModal.tsx itself owns the gallery-side
  // upload/delete calls; these two only ever touch this one book's fields.
  async function handleSaveBookCover(book: Record<string, unknown>, image: GalleryImage) {
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? setBookCover(b, image.id, image.url) : b))
      }));
    } catch {
      toast({ message: "Couldn't save — check your connection.", kind: "error" });
    }
  }

  async function handleRemoveBookCover(book: Record<string, unknown>) {
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? clearBookCover(b) : b))
      }));
    } catch {
      toast({ message: "Couldn't save — check your connection.", kind: "error" });
    }
  }

  // Select mode: turn it on, tap books across any of this page's group
  // sections to build up a selection, then delete them all in one go —
  // same pattern as LibraryPage.tsx. A book deleted from here is removed
  // from the library entirely, not just from the group it was clicked in.
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
    setSelectedKeys(new Set());
  }

  // Scrubs every selected book's key out of every group's bookKeys too
  // (lib/groups.ts's removeBooksFromAllGroups) in the same save, so a
  // deleted book doesn't linger as a dangling reference in any series or
  // collection it was in.
  async function handleDeleteSelected() {
    if (selectedKeys.size === 0) return;
    const snapshot = library?.data;
    if (!snapshot) return;
    const keys = selectedKeys;
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.filter((b) => !keys.has(bookKey(b))),
        groups: removeBooksFromAllGroups(data.groups ?? [], keys)
      }));
    } catch {
      toast({ message: "Couldn't delete — nothing was changed.", kind: "error" });
      return;
    }
    setSelectedKeys(new Set());
    setSelectionMode(false);
    // Independent of the library save above — see LibraryPage.tsx's own
    // handleDeleteSelected for why murals are scrubbed via a separate
    // call rather than a field on that save.
    const scrubTimer = setTimeout(() => void scrubBooks(keys), 6500);
    toast({
      message: `Deleted ${keys.size} book${keys.size === 1 ? "" : "s"}.`,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(scrubTimer);
          void (async () => {
            try {
              await updateLibrary(() => snapshot);
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

  const pickerGroup = groups.find((g) => g.id === pickerGroupId) ?? null;
  const styleGroup = groups.find((g) => g.id === styleGroupId) ?? null;
  const style = resolveLibraryStyle(library?.data.style);
  const showSkeleton = useDelayedShow(isLoading);
  const styleBook = styleBookKey ? books.find((b) => bookKey(b) === styleBookKey) : null;
  const coverBook = coverBookKey ? books.find((b) => bookKey(b) === coverBookKey) : null;

  return (
    <PageContainer maxWidth={style.contentMaxWidth}>
      {/* Desktop-only, except in selection mode: the search row below
          carries the phone gear, and the bottom tab bar already says
          which page this is. Selection mode is the exception — it holds
          "Delete selected" with a live count, which is destructive and
          count-dependent, so it stays visible with explicit buttons. */}
      <header
        className={`mb-6 items-center justify-between gap-4 sm:flex ${selectionMode ? "flex" : "hidden"}`}
      >
        <h2 className="text-lg font-bold">{copy.title}</h2>
        {books.length > 0 &&
          (selectionMode ? (
            <div className="flex items-center gap-2">
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
            </div>
          ) : (
            <button
              onClick={handleToggleSelectionMode}
              className="hidden rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover) sm:block"
            >
              Select…
            </button>
          ))}
      </header>

      {books.length > 0 && (
        <ToolbarRow>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label={`Search ${copy.title.toLowerCase()} by name`}
              className={`${TOOLBAR_CONTROL_CLASS} min-w-0 flex-1 sm:max-w-xs`}
            />
            {!selectionMode && (
              <button
                onClick={() => setActionsOpen(true)}
                aria-label={`${copy.title} actions`}
                className={`${toolbarIconClass()} sm:hidden`}
              >
                <GearIcon />
              </button>
            )}
          </div>
        </ToolbarRow>
      )}

      {actionsOpen && (
        <ActionSheet
          title={copy.title}
          items={[{ label: "Select…", onClick: handleToggleSelectionMode }]}
          onClose={() => setActionsOpen(false)}
        />
      )}


      {!isLoading && allGroups.length === 0 && <p className="text-sm text-(--color-text-dim)">{copy.empty}</p>}
      {!isLoading && allGroups.length > 0 && groups.length === 0 && (
        <p className="text-sm text-(--color-text-dim)">Nothing matches “{search.trim()}”.</p>
      )}

      <div className="flex flex-col gap-6">
        {/* Always first, and always present — deliberately outside the
            `groups.map` below so the ability to add one never disappears
            just because the list is empty, exactly like the mural grid's
            "+" tile. Shaped as a full-width dashed bar rather than a
            square card because this page stacks its groups vertically
            instead of laying them out in a grid; the dashed border and
            the "+" are what carry the "this makes a new one" meaning
            across both. */}
        {drafting ? (
          <div className="flex min-h-14 items-center gap-2 rounded-xl border-2 border-dashed border-(--color-accent) p-3">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => void handleCommitDraft()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCommitDraft();
                if (e.key === "Escape") {
                  // Discard outright — don't let the blur that follows
                  // commit what Escape just cancelled.
                  setDraftName("");
                  setDrafting(false);
                }
              }}
              placeholder={`Name this ${copy.noun}…`}
              aria-label={`Name the new ${copy.noun}`}
              className="min-h-11 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm"
            />
          </div>
        ) : (
          <button
            onClick={handleStartDraft}
            disabled={creating}
            className="flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(--color-border) p-4 text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-60"
          >
            {creating ? (
              <span className="text-sm font-semibold">Adding…</span>
            ) : (
              <>
                <PlusIcon />
                <span className="text-sm font-semibold">New {copy.noun}</span>
              </>
            )}
          </button>
        )}

        {/* After the "New …" tile, which is where the real panels
            start — a skeleton above it would put the placeholder
            somewhere the content never appears. */}
        {showSkeleton && <SkeletonGroups style={style} />}

        {groups.map((group) => {
          const members = orderedGroupBooks(group, books);
          return (
            <section key={group.id} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                {editingId === group.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => handleRename(group.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(group.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-sm font-semibold"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(group.id);
                      setEditingName(group.name);
                    }}
                    className="text-left text-sm font-semibold transition-colors hover:text-(--color-accent)"
                    title="Rename"
                  >
                    {group.name}
                    {group.style && (
                      <span className="ml-1.5 rounded-full bg-(--color-accent-soft) px-1.5 py-0.5 align-middle text-[10px] font-semibold text-(--color-accent)">
                        custom style
                      </span>
                    )}
                  </button>
                )}
                <div className="flex shrink-0 items-center gap-3 text-xs text-(--color-text-dim)">
                  <span>
                    {members.length} book{members.length === 1 ? "" : "s"}
                  </span>
                  <OptionsMenu
                    title={`${copy.noun[0].toUpperCase()}${copy.noun.slice(1)} settings`}
                    triggerClassName="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                    items={[
                      // Collections don't get their own style override —
                      // same reason there's no "Style" button on a
                      // collection's card at all before this change.
                      ...(type === "series" ? [{ label: "Style", onClick: () => setStyleGroupId(group.id) }] : []),
                      { label: "Manage books", onClick: () => setPickerGroupId(group.id) },
                      { label: "Delete", onClick: () => handleDelete(group), danger: true }
                    ]}
                  />
                </div>
              </div>

              {members.length === 0 ? (
                <p className="text-sm text-(--color-text-dim)">No books here yet — use "Manage books" to add some.</p>
              ) : (
                // Layout (BookGrid's own style prop) is always the plain
                // library style — series/book overrides never touch
                // layout fields (see PerCardStyle's type), so there's
                // nothing to resolve here regardless of which group this is.
                <LibraryCanvas style={style}>
                  <BookGrid style={style}>
                    {members.map((book, i) => (
                      <BookCard
                        key={String(book.ContentID ?? i)}
                        book={book}
                        onClick={() => {}}
                        style={effectiveCardStyle(style, bookSeriesGroup.get(bookKey(book))?.style, book._style as PerCardStyle | undefined)}
                        onOpenStyle={selectionMode ? undefined : () => setStyleBookKey(bookKey(book))}
                        onOpenCoverPicker={selectionMode ? undefined : () => setCoverBookKey(bookKey(book))}
                        selectable={selectionMode}
                        selected={selectedKeys.has(bookKey(book))}
                        onToggleSelect={handleToggleSelect}
                      />
                    ))}
                  </BookGrid>
                </LibraryCanvas>
              )}
            </section>
          );
        })}
      </div>

      {pickerGroup && (
        <BookPickerModal
          group={pickerGroup}
          allBooks={books}
          onToggle={(book, inGroup) => handleToggleBook(pickerGroup.id, book, inGroup)}
          onClose={() => setPickerGroupId(null)}
        />
      )}

      {styleGroup && (
        <PerCardStylePanel
          idPrefix="series"
          name={styleGroup.name}
          priorityText="the library-wide"
          currentOverride={styleGroup.style}
          seedStyle={style}
          onSave={(groupStyle) => handleSaveGroupStyle(styleGroup.id, groupStyle)}
          onClose={() => setStyleGroupId(null)}
        />
      )}

      {styleBook && (
        <PerCardStylePanel
          idPrefix="book"
          name={String(styleBook.Title ?? "Untitled")}
          priorityText="the series and library-wide"
          currentOverride={styleBook._style as PerCardStyle | undefined}
          // Seed from what this book currently looks like one level up the
          // chain — its series' style if it's in a customized one
          // (regardless of whether this happens to be the Series or
          // Collections page — bookSeriesGroup resolves the same either
          // way), not from a blank slate.
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
    </PageContainer>
  );
}

function BookPickerModal({
  group,
  allBooks,
  onToggle,
  onClose
}: {
  group: Group;
  allBooks: Array<Record<string, unknown>>;
  onToggle: (book: Record<string, unknown>, inGroup: boolean) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const memberKeys = useMemo(() => new Set(group.bookKeys), [group]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allBooks;
    return allBooks.filter((b) => String(b.Title ?? "").toLowerCase().includes(q) || String(b.Attribution ?? "").toLowerCase().includes(q));
  }, [allBooks, search]);

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-(--color-border) bg-(--color-surface) shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--color-border) p-4">
          <h3 className="text-sm font-semibold">Books in "{group.name}"</h3>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>
        <div className="border-b border-(--color-border) p-3">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your library…"
            className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 && <p className="p-3 text-sm text-(--color-text-dim)">No books match.</p>}
          {filtered.map((book, i) => {
            const key = bookKey(book);
            const inGroup = memberKeys.has(key);
            return (
              <label
                key={String(book.ContentID ?? i)}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-(--color-surface-hover)"
              >
                <input type="checkbox" checked={inGroup} onChange={() => onToggle(book, inGroup)} />
                <span className="min-w-0 flex-1 truncate">
                  {String(book.Title ?? "Untitled")}
                  <span className="text-(--color-text-dim)"> — {String(book.Attribution ?? "Unknown author")}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
