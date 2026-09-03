import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GalleryImage } from "../api/gallery";
import { useConfirm } from "../components/ConfirmDialog";
import { CoverPickerModal } from "../components/CoverPickerModal";
import { OptionsMenu } from "../components/OptionsMenu";
import { PageContainer } from "../components/PageContainer";
import { OptionSheet } from "../components/Sheet";
import { FolderIcon, SortIcon, TOOLBAR_CONTROL_CLASS, TOOLBAR_ICON_BUTTON_CLASS, ToolbarRow } from "../components/Toolbar";
import { ShareModal } from "../components/ShareModal";
import { MoveToFolderModal } from "../components/murals/MoveToFolderModal";
import { MuralFolderTree } from "../components/murals/MuralFolderTree";
import { useMurals } from "../hooks/useMurals";
import { useMuralFolders } from "../hooks/useMuralFolders";
import type { Mural, MuralFolder } from "../lib/murals";
import { buildTree, collectSubtreeIds, folderPath } from "../lib/muralFolders";

// Field + direction combined into one option each, rather than two
// separate selects (field, then direction) — four clearly-labeled
// choices in one control reads faster than cross-referencing two, and
// there's no "sort by name" case that would make a split control
// actually pull its weight here.
type SortBy = "updatedDesc" | "updatedAsc" | "createdDesc" | "createdAsc";

const SORT_OPTIONS: Array<{ value: SortBy; label: string }> = [
  { value: "updatedDesc", label: "Recently updated" },
  { value: "updatedAsc", label: "Oldest updated" },
  { value: "createdDesc", label: "Recently created" },
  { value: "createdAsc", label: "Oldest created" }
];

/** /dashboard/murals — the list of the account's murals (configurable,
 *  freeform dashboards built from books/quotes/images/stats — see
 *  lib/murals.ts). Opening one goes to MuralEditorPage.tsx
 *  (/dashboard/murals/:id); this page is just create/rename/delete, same
 *  role GroupsPage.tsx plays for Series/Collections, but each mural gets
 *  its own full page rather than an inline expandable section — a
 *  freeform canvas needs real room. */
export function MuralsListPage() {
  const { data: muralsData, isLoading, create, rename, remove, move: moveMural, setCover, clearCover, share, unshare } = useMurals();
  const { data: foldersData, create: createFolder, rename: renameFolder, move: moveFolderApi, remove: removeFolder } = useMuralFolders();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const murals = muralsData ?? [];
  const folders = foldersData ?? [];

  const [creating, setCreating] = useState(false);
  const [sheet, setSheet] = useState<"sort" | "folder" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [coverMuralId, setCoverMuralId] = useState<string | null>(null);
  const [sharingMuralId, setSharingMuralId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [movingMuralId, setMovingMuralId] = useState<string | null>(null);
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("updatedDesc");

  // Plain filter + sort on every render, no useMemo — client-side only,
  // same "trivial dataset, no reason to push this to the backend"
  // reasoning as the old viewer's own filtering: a personal library's
  // mural count is never going to be large enough for re-computing this
  // on every render to matter, and `murals` itself is a fresh `?? []`
  // fallback array most renders anyway (nothing for a memo to actually
  // key off). `.filter()` returns a fresh array, so `.sort()`-ing it in
  // place afterward never mutates `murals`/the `["murals"]` query cache
  // itself (useMurals.ts).
  const needle = search.trim().toLowerCase();
  const sortField = sortBy.startsWith("created") ? "createdAt" : "updatedAt";
  const sortDirection = sortBy.endsWith("Desc") ? -1 : 1;
  const candidateMurals = needle
    ? murals.filter((m) => m.name.toLowerCase().includes(needle))
    : murals.filter((m) => (m.folderId ?? null) === selectedFolderId);
  const filteredMurals = [...candidateMurals].sort(
    (a, b) => (new Date(a[sortField]).getTime() - new Date(b[sortField]).getTime()) * sortDirection
  );

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      // No name prompt anymore — the "+" tile creates on click, not on
      // submitting a form, so there's nothing to type a name into first.
      // "Untitled mural" is the same "name it now, or don't — rename any
      // time from the ⚙ menu" convention a fresh Google Doc/Figma file
      // uses. Straight into the new mural afterward, same as before:
      // creating one with nothing to build on isn't useful on its own, so
      // skip the extra click back here.
      const created = await create("Untitled mural", selectedFolderId);
      navigate(`/dashboard/murals/${created.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(id: string) {
    const name = editingName.trim();
    setEditingId(null);
    if (!name) return;
    await rename(id, name);
  }

  async function handleDelete(mural: Mural) {
    if (!(await confirm({ title: `Delete "${mural.name}"?`, body: "This can't be undone." }))) return;
    await remove(mural.id);
  }

  async function handleDeleteFolder(folder: MuralFolder) {
    if (!(await confirm({ title: `Delete "${folder.name}"?`, body: "Murals and subfolders inside it move up one level. Nothing is deleted." }))) return;
    await removeFolder(folder.id);
    if (selectedFolderId === folder.id) setSelectedFolderId(folder.parentId);
  }

  async function handleSaveMuralCover(muralId: string, image: GalleryImage) {
    await setCover(muralId, image.id, image.url);
  }

  async function handleRemoveMuralCover(muralId: string) {
    await clearCover(muralId);
  }

  const coverMural = coverMuralId ? murals.find((m) => m.id === coverMuralId) : null;
  const sharingMural = sharingMuralId ? murals.find((m) => m.id === sharingMuralId) : null;
  const movingMural = movingMuralId ? murals.find((m) => m.id === movingMuralId) : null;
  const movingFolder = movingFolderId ? folders.find((f) => f.id === movingFolderId) : null;

  return (
    <PageContainer>
      {/* Desktop-only. On a phone this row held nothing but the word
          "Murals", which the bottom tab bar already says. */}
      <header className="mb-6 hidden items-center justify-between gap-4 sm:flex">
        <h2 className="text-lg font-bold">Murals</h2>
      </header>

      <div className="flex items-start gap-6">
        <div className="hidden w-56 shrink-0 md:block">
          <MuralFolderTree
            folders={folders}
            selectedFolderId={selectedFolderId}
            onSelect={setSelectedFolderId}
            onCreateFolder={(parentId) => void createFolder("New folder", parentId)}
            onRenameFolder={(folder, name) => void renameFolder(folder.id, name)}
            onMoveFolder={(folder) => setMovingFolderId(folder.id)}
            onDeleteFolder={(folder) => void handleDeleteFolder(folder)}
          />
        </div>

        <div className="min-w-0 flex-1">
          <nav className="mb-3 hidden items-center gap-1 text-xs text-(--color-text-dim) md:flex">
            <button onClick={() => setSelectedFolderId(null)} className="hover:text-(--color-text)">
              All murals
            </button>
            {folderPath(folders, selectedFolderId).map((f, i, path) => (
              <span key={f.id} className="flex items-center gap-1">
                <span>/</span>
                {i === path.length - 1 ? (
                  <span className="font-semibold text-(--color-text)">{f.name}</span>
                ) : (
                  <button onClick={() => setSelectedFolderId(f.id)} className="hover:text-(--color-text)">
                    {f.name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          {isLoading && <p className="text-sm text-(--color-text-dim)">Loading…</p>}

          {!isLoading && murals.length === 0 && (
            <p className="mb-4 text-sm text-(--color-text-dim)">
              No murals yet. A mural is a freeform dashboard you build yourself — a "Top 5 Books This Year" shelf, a favorite
              quote, a photo, whatever you want on the wall. Click the + below to start.
            </p>
          )}

          {!isLoading && murals.length > 0 && (
            <ToolbarRow>
              {/* Phone: one row — search, sort, folder. The three used to
                  be a full-width folder select on its own line plus two
                  labelled controls below it, which on a 375px phone cost
                  more vertical space than the first row of murals. Each
                  becomes a 44px icon opening a bottom sheet, matching the
                  Library toolbar's filter and sort exactly, so the same
                  gesture works on both pages. An icon can't show its
                  current value, so it goes accent-coloured whenever its
                  control is off its default — the only cue left once the
                  labels are gone. */}
              <div className="flex items-center gap-2 sm:hidden">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  aria-label="Search murals by name"
                  className={`${TOOLBAR_CONTROL_CLASS} min-w-0 flex-1`}
                />
                <button
                  onClick={() => setSheet("sort")}
                  aria-label={`Sort murals (${SORT_OPTIONS.find((o) => o.value === sortBy)?.label})`}
                  className={`${TOOLBAR_ICON_BUTTON_CLASS} ${sortBy !== SORT_OPTIONS[0].value ? "text-(--color-accent)" : ""}`}
                >
                  <SortIcon />
                </button>
                <button
                  onClick={() => setSheet("folder")}
                  aria-label={`Folder (${selectedFolderId ? folderPath(folders, selectedFolderId).map((f) => f.name).join(" / ") : "All murals"})`}
                  className={`${TOOLBAR_ICON_BUTTON_CLASS} ${selectedFolderId !== null ? "text-(--color-accent)" : ""}`}
                >
                  <FolderIcon />
                </button>
              </div>

              {/* Desktop keeps the labelled controls: there's room, and a
                  word beats an icon whose value you'd have to open a
                  sheet to read. `items-end` bottom-aligns each control
                  regardless of its label's height. */}
              <div className="hidden flex-wrap items-end gap-3 sm:flex">
                <label className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-semibold tracking-wide text-(--color-text-dim) uppercase">Search</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search"
                    className="w-56 max-w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-semibold tracking-wide text-(--color-text-dim) uppercase">Sort</span>
                  {/* appearance-none + a hand-drawn chevron, not the browser's
                      own <select> arrow — the native one rendered flush
                      against the box's right edge with no real breathing room
                      from the border at this size, cramped rather than
                      deliberate. pr-8 clears space for it; pointer-events-none
                      on the chevron keeps clicks reaching the (invisibly
                      stretched, same-size) real <select> underneath. */}
                  <div className="relative">
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortBy)}
                      className="w-full appearance-none rounded-lg border border-(--color-border) bg-(--color-surface) py-2 pr-8 pl-3 text-sm"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-(--color-text-dim)"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </label>
              </div>
            </ToolbarRow>
          )}

          {sheet === "sort" && (
            <OptionSheet
              title="Sort murals"
              options={SORT_OPTIONS}
              value={sortBy}
              onSelect={(v) => setSortBy(v as SortBy)}
              onClose={() => setSheet(null)}
            />
          )}
          {sheet === "folder" && (
            <OptionSheet
              title="Folder"
              // "" stands in for "no folder selected" — OptionSheet keys
              // on a string, and `null` isn't one. Mapped back on the way
              // out, the same substitution the <select> this replaced
              // already made with its empty-string <option>.
              options={[
                { value: "", label: "All murals" },
                ...buildTree(folders).map(({ folder }) => ({
                  value: folder.id,
                  label: folderPath(folders, folder.id).map((p) => p.name).join(" / ")
                }))
              ]}
              value={selectedFolderId ?? ""}
              onSelect={(v) => setSelectedFolderId(v || null)}
              onClose={() => setSheet(null)}
            />
          )}

          {!isLoading && murals.length > 0 && filteredMurals.length === 0 && (
            <p className="text-sm text-(--color-text-dim)">No murals match this filter.</p>
          )}

          {!isLoading && needle === "" && murals.length > 0 && filteredMurals.length === 0 && selectedFolderId !== null && (
            <p className="text-sm text-(--color-text-dim)">No murals in this folder.</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Replaces the old "New mural name…" input + "Create mural"
                button — same tile shape/size as a real mural card (so it
                sits naturally among them, always the first one) rather than
                a separate form row above the grid. Creates immediately on
                click with a placeholder name ("Untitled mural," see
                handleCreate) instead of asking for a name up front — there's
                no text field left to type one into before creating. Stays
                visible regardless of the search/filter controls above (it's
                not part of `filteredMurals`), since the ability to create a
                new mural shouldn't disappear just because a filter currently
                matches nothing. */}
            <button
              onClick={() => void handleCreate()}
              disabled={creating}
              title="Create a new mural"
              className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-(--color-border) p-4 text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent) disabled:opacity-60"
            >
              <span className="text-2xl leading-none">{creating ? "…" : "+"}</span>
              <span className="text-sm font-semibold">New mural</span>
            </button>

            {filteredMurals.map((mural) => {
              const hasCover = Boolean(mural.coverImageUrl);
              return (
                // The whole card opens the mural, not just its name — same
                // "the card itself is the click target" convention
                // BookCard.tsx already uses for opening a book. role="button"/
                // tabIndex/onKeyDown mirror CoverPickerModal.tsx's gallery
                // tiles, so opening a mural this way stays keyboard-reachable
                // too, not just clickable. A fixed min-h-40 — same as the "+"
                // tile above — so every card in the grid lines up whether or
                // not it has a cover image, instead of content-driven cards
                // of differing heights sitting next to a full-bleed image one.
                <div
                  key={mural.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/dashboard/murals/${mural.id}`)}
                  onKeyDown={(e) => {
                    // e.target === e.currentTarget: only react when the key
                    // event originated on the card itself, not bubbled up
                    // from a real focusable control nested inside it (the
                    // settings ⚙, or the rename input while editing) — those
                    // need Enter/Space for their own purposes (activating the
                    // button, typing a literal space into the name), not
                    // "open this mural."
                    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                      e.preventDefault();
                      navigate(`/dashboard/murals/${mural.id}`);
                    }
                  }}
                  className={`group relative min-h-40 cursor-pointer overflow-hidden rounded-xl border border-(--color-border) transition-colors ${
                    hasCover ? "" : "bg-(--color-surface) hover:bg-(--color-surface-hover)"
                  }`}
                >
                  {hasCover && (
                    <>
                      <img src={mural.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      {/* Same dark-scrim-behind-overlay-text treatment
                          BookCard.tsx uses over its own cover art — strongest
                          right where the name/menu sit, fading out toward the
                          top so the image itself still reads through. */}
                      <div className="absolute inset-0 bg-linear-to-t from-[rgba(10,8,6,0.85)] via-[rgba(10,8,6,0.35)] to-transparent" />
                    </>
                  )}
                  <div className={`relative flex h-full flex-col p-4 ${hasCover ? "justify-end" : ""}`}>
                    <div className="mb-1 flex items-start justify-between gap-2">
                      {editingId === mural.id ? (
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => handleRename(mural.id)}
                          onKeyDown={(e) => {
                            // Stopped from bubbling to the card's own
                            // onKeyDown — without this, typing a space into
                            // the name (a very normal thing to want to
                            // rename a mural to) would trigger the card's
                            // "Space activates" handler and navigate away
                            // mid-edit, on every space character.
                            e.stopPropagation();
                            if (e.key === "Enter") handleRename(mural.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-lg font-bold text-(--color-text)"
                        />
                      ) : (
                        // text-lg font-bold — bigger than the old text-sm, so
                        // a mural's name reads as its own real identity on
                        // the card, not a caption. text-shadow (only over a
                        // cover image, where it sits on arbitrary artwork
                        // rather than a flat theme surface) keeps it legible
                        // the same way BookCard's own title treatment does.
                        <span
                          className={`text-left text-lg leading-tight font-bold transition-colors ${
                            hasCover ? "text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]" : "group-hover:text-(--color-accent)"
                          }`}
                        >
                          {mural.name}
                        </span>
                      )}
                      <OptionsMenu
                        title="Mural settings"
                        triggerClassName={
                          hasCover
                            ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgba(10,8,6,0.72)] text-white backdrop-blur-xs"
                            : "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                        }
                        items={[
                          {
                            label: "Rename",
                            onClick: () => {
                              setEditingId(mural.id);
                              setEditingName(mural.name);
                            }
                          },
                          { label: hasCover ? "Change cover" : "Add cover", onClick: () => setCoverMuralId(mural.id) },
                          { label: "Move to…", onClick: () => setMovingMuralId(mural.id) },
                          { label: "Share", onClick: () => setSharingMuralId(mural.id) },
                          { label: "Delete", onClick: () => handleDelete(mural), danger: true }
                        ]}
                      />
                    </div>
                    <p className={`text-xs ${hasCover ? "text-white/75" : "text-(--color-text-dim)"}`}>
                      {mural.blocks.length} block{mural.blocks.length === 1 ? "" : "s"} · Updated {new Date(mural.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {movingMural && (
        <MoveToFolderModal
          title={movingMural.name}
          folders={folders}
          disabledIds={new Set()}
          onSelect={(folderId) => {
            setMovingMuralId(null);
            if ((movingMural.folderId ?? null) !== folderId) void moveMural(movingMural.id, folderId);
          }}
          onClose={() => setMovingMuralId(null)}
        />
      )}

      {movingFolder && (
        <MoveToFolderModal
          title={movingFolder.name}
          folders={folders}
          disabledIds={collectSubtreeIds(folders, movingFolder.id)}
          onSelect={(folderId) => {
            setMovingFolderId(null);
            if (folderId !== movingFolder.parentId) void moveFolderApi(movingFolder.id, folderId);
          }}
          onClose={() => setMovingFolderId(null)}
        />
      )}

      {coverMural && (
        <CoverPickerModal
          title={coverMural.name}
          currentImageId={coverMural.coverImageId ?? null}
          removeCoverLabel="Remove cover"
          onSelect={(image) => void handleSaveMuralCover(coverMural.id, image)}
          onRemoveCover={() => void handleRemoveMuralCover(coverMural.id)}
          onClose={() => setCoverMuralId(null)}
        />
      )}

      {sharingMural && (
        <ShareModal
          title={sharingMural.name}
          shareToken={sharingMural.shareToken}
          shareUrl={sharingMural.shareUrl}
          defaultCaption={sharingMural.name}
          onShare={async () => {
            const updated = await share(sharingMural.id);
            return { shareToken: updated.shareToken as string, shareUrl: updated.shareUrl as string };
          }}
          onUnshare={async () => {
            await unshare(sharingMural.id);
          }}
          onClose={() => setSharingMuralId(null)}
        />
      )}
    </PageContainer>
  );
}
