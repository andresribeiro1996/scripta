import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { deleteBooks, restoreDeletedBooks, saveFailureMessage, setBookCoverUrl, type ResolvedCoverResponse } from "@scripta/shared";
import { fetchIsAdmin } from "../api/books";
import { rememberResolvedCover } from "../api/covers";
import type { GalleryImage } from "../api/gallery";
import { BookCard, coverParamsFor } from "../components/BookCard";
import { BookGrid } from "../components/BookGrid";
import { CoverPickerModal } from "../components/CoverPickerModal";
import { EmptyState } from "../components/EmptyState";
import { LibraryCanvas } from "../components/LibraryCanvas";
import { CollectionsIcon, MoreIcon, SeriesIcon } from "../components/NavIcons";
import { OptionsMenu } from "../components/OptionsMenu";
import { Page } from "../components/page/Page";
import { BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "../components/page/buttonClasses";
import { PerCardStylePanel } from "../components/PerCardStylePanel";
import { Sheet } from "../components/Sheet";
import { SkeletonGroups } from "../components/Skeleton";
import { useToast } from "../components/Toaster";
import { ToolbarRow, CHECKBOX_CLASS, SearchField, toolbarIconClass } from "../components/Toolbar";
import { useDelayedShow } from "../hooks/useDelayedShow";
import { useLibrary } from "../hooks/useLibrary";
import { useLibrarySaver } from "../hooks/useLibrarySaver";
import { useMurals } from "../hooks/useMurals";
import { clearBookCover, setBookCover } from "../lib/bookCovers";
import {
  deleteGroup,
  makeGroup,
  normalizeGroupName,
  orderedGroupBooks,
  renameGroup,
  setGroupStyle,
  type Group,
  type GroupType
} from "../lib/groups";
import { area } from "../lib/areas";
import { seriesGroupByBookKey } from "../lib/libraryOrder";
import { effectiveCardStyle, resolveLibraryStyle, type PerCardStyle } from "../lib/libraryStyle";
import { bookKey } from "../lib/merge";

const COPY: Record<GroupType, { title: string; noun: string; plural: string; emptyTitle: string; emptyBody: string; untitled: string; icon: ComponentType<{ size?: number }> }> = {
  series: {
    title: "Series",
    noun: "series",
    plural: "series",
    emptyTitle: "No series yet.",
    emptyBody:
      "Series are picked up automatically from your books' Series field on import — or add one by hand with the button above.",
    untitled: "Untitled series",
    icon: SeriesIcon
  },
  collection: {
    title: "Collections",
    noun: "collection",
    plural: "collections",
    emptyTitle: "No collections yet.",
    emptyBody: "Create one to start organizing your books your own way.",
    untitled: "Untitled collection",
    icon: CollectionsIcon
  }
};

/** Backs both /dashboard/series and /dashboard/collections — the two are
 *  the same underlying resource (see lib/groups.ts), differing only in
 *  copy and in that series also get auto-seeded from book metadata. */
export function GroupsPage({ type }: { type: GroupType }) {
  const saver = useLibrarySaver();
  const { data: library, isLoading, updateLibrary } = useLibrary();
  const { scrubBooks } = useMurals();
  const { data: isAdmin = false } = useQuery({ queryKey: ["books-admin"], queryFn: fetchIsAdmin, staleTime: Infinity });
  const copy = COPY[type];
  const [params] = useSearchParams();
  const selectedGroupId = params.get("group");
  const [search, setSearch] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
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
    () => (library?.data.groups ?? []).filter((g) => g.type === type && (!selectedGroupId || g.id === selectedGroupId)).sort((a, b) => a.name.localeCompare(b.name)),
    [library, type, selectedGroupId]
  );
  // Matches a group's own name OR any book title inside it — "which
  // collection did I put Dune in?" is at least as common a question here
  // as "where's my sci-fi collection", and the second is unanswerable if
  // only names are searched. Kept out of `allGroups` so the
  // empty-state copy can still reason about how many groups exist at
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

  // Starting a draft does NOT create anything: it opens an unsaved draft row
  // with its name field focused. The group is only persisted once a
  // non-empty name is committed — so backing out, or starting one out of
  // curiosity, leaves nothing behind. Creating on click had been
  // littering the list with "Untitled series" every time someone
  // changed their mind.
  function handleStartDraft() {
    setDraftName("");
    setDraftError(null);
    setDrafting(true);
  }

  async function handleCommitDraft(fromEnter = false) {
    const name = draftName.trim();
    if (fromEnter && !name) {
      setDraftError(`Give this ${copy.noun} a name.`);
      return;
    }
    setDrafting(false);
    setDraftName("");
    // Tapping away from an empty draft is the ordinary way of backing out.
    if (!name || creating) return;
    setCreating(true);
    try {
      await updateLibrary((data) => ({ ...data, groups: [...(data.groups ?? []), makeGroup(type, name)] }));
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save — check your connection."), kind: "error" });
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
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save — check your connection."), kind: "error" });
    }
  }

  async function handleDelete(group: Group) {
    try {
      await updateLibrary((data) => ({ ...data, groups: deleteGroup(data.groups ?? [], group.id) }));
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't delete — nothing was changed."), kind: "error" });
      return;
    }
    toast({
      message: `Deleted "${group.name}".`,
      action: {
        label: "Undo",
        onClick: () => {
          void (async () => {
            try {
              await updateLibrary((data) => {
                const exists = (data.groups ?? []).some((candidate) =>
                  candidate.id === group.id ||
                  (group.type === "series" && candidate.type === "series" && normalizeGroupName(candidate.name) === normalizeGroupName(group.name))
                );
                if (exists) return data;
                return { ...data, groups: [...(data.groups ?? []), group] };
              });
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

  async function handleToggleBook(groupId: string, book: Record<string, unknown>, inGroup: boolean) {
    const result = await saver.submit({ kind: "membership", groupId, bookKey: bookKey(book), member: !inGroup });
    if (!result.ok) toast({ message: saveFailureMessage(result.error, "Couldn't save — check your connection."), kind: "error" });
  }

  async function handleSaveGroupStyle(groupId: string, groupStyle: PerCardStyle | undefined) {
    try {
      await updateLibrary((data) => ({ ...data, groups: setGroupStyle(data.groups ?? [], groupId, groupStyle) }));
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save — check your connection."), kind: "error" });
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
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save — check your connection."), kind: "error" });
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
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save — check your connection."), kind: "error" });
    }
  }

  async function handleSaveBookCoverUrl(book: Record<string, unknown>, url: string) {
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? setBookCoverUrl(b, url) : b))
      }));
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save — check your connection."), kind: "error" });
    }
  }

  async function handleRemoveBookCover(book: Record<string, unknown>) {
    const key = bookKey(book);
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? clearBookCover(b) : b))
      }));
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save — check your connection."), kind: "error" });
    }
  }

  function handlePickFoundCover(book: Record<string, unknown>, cover: ResolvedCoverResponse, everyone: boolean) {
    if (everyone) {
      rememberResolvedCover(coverParamsFor(book), cover);
      if (book._coverUrl) void handleRemoveBookCover(book);
    } else if (cover.fullUrl) {
      void handleSaveBookCoverUrl(book, cover.fullUrl);
    }
    setCoverBookKey(null);
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

  async function handleDeleteSelected() {
    if (selectedKeys.size === 0) return;
    const initialSnapshot = library?.data;
    if (!initialSnapshot) return;
    let snapshot = initialSnapshot;
    const keys = selectedKeys;
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

  const pickerGroup = groups.find((g) => g.id === pickerGroupId) ?? null;
  const styleGroup = groups.find((g) => g.id === styleGroupId) ?? null;
  const style = resolveLibraryStyle(library?.data.style);
  const showSkeleton = useDelayedShow(isLoading);
  const styleBook = styleBookKey ? books.find((b) => bookKey(b) === styleBookKey) : null;
  const coverBook = coverBookKey ? books.find((b) => bookKey(b) === coverBookKey) : null;

  return (
    <Page
      width="wide"
      title="Library"
      subtitle={isLoading ? undefined : `${allGroups.length} ${allGroups.length === 1 ? copy.noun : copy.plural}`}
      tabs={area("library").tabs}
      maxWidth={style.contentMaxWidth}
      actions={
        books.length > 0 && selectionMode ? (
          <>
            <span className="text-sm text-(--color-text-dim)">{selectedKeys.size} selected</span>
            <button
              onClick={() => void handleDeleteSelected()}
              disabled={selectedKeys.size === 0}
              className={BUTTON_DANGER}
            >
              Delete selected
            </button>
            <button onClick={handleToggleSelectionMode} className={BUTTON_SECONDARY}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={handleStartDraft} disabled={creating || drafting} className={BUTTON_PRIMARY}>
              {creating ? "Adding…" : `New ${copy.noun}`}
            </button>
            {books.length > 0 && (
              <OptionsMenu
                items={[{ label: "Select…", onClick: handleToggleSelectionMode }]}
                title="More actions"
                trigger={<MoreIcon size={22} />}
                triggerClassName={toolbarIconClass()}
              />
            )}
          </>
        )
      }
    >
      {books.length > 0 && (
        <ToolbarRow>
          <SearchField value={search} onChange={setSearch} placeholder="Search" label={`Search ${copy.title.toLowerCase()} by name`} className="flex-1 sm:flex-none" />
        </ToolbarRow>
      )}

      {!isLoading && allGroups.length === 0 && <EmptyState icon={copy.icon} title={copy.emptyTitle} body={copy.emptyBody} />}
      {!isLoading && allGroups.length > 0 && groups.length === 0 && (
        <p className="text-sm text-(--color-text-dim)">Nothing matches “{search.trim()}”.</p>
      )}

      <div className="flex flex-col">
        {drafting ? (
          <div className="mb-6 rounded-xl border-2 border-dashed border-(--color-accent) p-3">
            <label htmlFor="new-group-name" className="mb-1 block text-sm font-semibold">
              Name
            </label>
            <input
              id="new-group-name"
              autoFocus
              value={draftName}
              maxLength={200}
              aria-invalid={draftError ? true : undefined}
              aria-describedby="new-group-name-hint"
              onChange={(e) => {
                setDraftName(e.target.value);
                setDraftError(null);
              }}
              onBlur={() => void handleCommitDraft()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCommitDraft(true);
                if (e.key === "Escape") {
                  // Discard outright — don't let the blur that follows
                  // commit what Escape just cancelled.
                  setDraftName("");
                  setDrafting(false);
                }
              }}
              placeholder={`Name this ${copy.noun}…`}
              className={`${FIELD_CLASS} w-full`}
            />
            <p id="new-group-name-hint" role={draftError ? "alert" : undefined} className={`mt-1 text-xs ${draftError ? "text-(--color-danger)" : "text-(--color-text-dim)"}`}>
              {draftError ?? "Press Enter to add it."}
            </p>
          </div>
        ) : null}

        {showSkeleton && <SkeletonGroups style={style} />}

        {groups.map((group) => {
          const members = orderedGroupBooks(group, books);
          return (
            <section
              key={group.id}
              aria-labelledby={`group-${group.id}-name`}
              className="mt-8 border-t border-(--color-border) pt-8 first-of-type:mt-0 first-of-type:border-t-0 first-of-type:pt-0"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id={`group-${group.id}-name`} className="min-w-0 text-lg font-bold">
                  {editingId === group.id ? (
                    <input
                      autoFocus
                      value={editingName}
                      maxLength={200}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => handleRename(group.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(group.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className={`${FIELD_CLASS} text-lg font-bold`}
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setEditingId(group.id);
                        setEditingName(group.name);
                      }}
                      className="min-h-11 wrap-anywhere text-left text-lg font-bold transition-colors hover:text-(--color-accent)"
                      title="Rename"
                    >
                      {group.name}
                      {group.style && (
                        <span className="ml-1.5 inline-block rounded-full bg-(--color-accent-soft) px-1.5 py-0.5 align-middle whitespace-nowrap text-[10px] font-semibold text-(--color-accent)">
                          custom style
                        </span>
                      )}
                    </button>
                  )}
                </h2>
                <div className="flex shrink-0 items-center gap-3 text-sm text-(--color-text-dim)">
                  <span>
                    {members.length} book{members.length === 1 ? "" : "s"}
                  </span>
                  <OptionsMenu
                    title={`${copy.noun[0].toUpperCase()}${copy.noun.slice(1)} settings`}
                    triggerClassName="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
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
                <EmptyState title="No books here yet" body='Use "Manage books" to add some.' />
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
          lookup={coverParamsFor(coverBook)}
          coverUrl={typeof coverBook._coverUrl === "string" ? coverBook._coverUrl : null}
          isAdmin={isAdmin}
          removeCoverLabel="Remove custom cover — go back to the normal auto-detected one"
          onSelect={(image) => void handleSaveBookCover(coverBook, image)}
          onPickFound={(cover, everyone) => handlePickFoundCover(coverBook, cover, everyone)}
          onRemoveCover={() => void handleRemoveBookCover(coverBook)}
          onClose={() => setCoverBookKey(null)}
        />
      )}
    </Page>
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
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  const [search, setSearch] = useState("");
  const memberKeys = useMemo(() => new Set(group.bookKeys), [group]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allBooks;
    return allBooks.filter((b) => String(b.Title ?? "").toLowerCase().includes(q) || String(b.Attribution ?? "").toLowerCase().includes(q));
  }, [allBooks, search]);

  return (
    <Sheet title={`Books in "${group.name}"`} onClose={onClose}>
      <div className="sticky top-0 z-10 bg-(--color-surface) p-2 pt-0">
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your library…"
          aria-label="Search your library"
          className={`${FIELD_CLASS} w-full`}
        />
      </div>
      <div className="p-2">
        {filtered.length === 0 && <p className="p-3 text-sm text-(--color-text-dim)">No books match.</p>}
        {filtered.map((book, i) => {
          const key = bookKey(book);
          const inGroup = memberKeys.has(key);
          return (
            <label
              key={String(book.ContentID ?? i)}
              className="flex cursor-pointer items-center gap-1 rounded-lg px-2 text-sm hover:bg-(--color-surface-hover)"
            >
              <input type="checkbox" className={CHECKBOX_CLASS} checked={inGroup} onChange={() => onToggle(book, inGroup)} />
              <span className="min-w-0 flex-1 truncate">
                {String(book.Title ?? "Untitled")}
                <span className="text-(--color-text-dim)"> — {String(book.Attribution ?? "Unknown author")}</span>
              </span>
            </label>
          );
        })}
      </div>
    </Sheet>
  );
}
