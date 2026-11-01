import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@scripta/shared/community";
import type { GalleryImage } from "../api/gallery";
import { fetchOwnProfile } from "../api/community";
import { useConfirm } from "../components/ConfirmDialog";
import { CoverPickerModal } from "../components/CoverPickerModal";
import { EmptyState } from "../components/EmptyState";
import { MoveToFolderModal } from "../components/murals/MoveToFolderModal";
import { MuralFolderTree } from "../components/murals/MuralFolderTree";
import { MuralPresetPicker } from "../components/murals/MuralPresetPicker";
import { MuralThumb } from "../components/murals/MuralThumb";
import { MuralsIcon } from "../components/NavIcons";
import { OptionsMenu } from "../components/OptionsMenu";
import { Page } from "../components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS } from "../components/page/buttonClasses";
import { PANEL } from "../components/page/surfaceClasses";
import { ShareModal } from "../components/ShareModal";
import { OptionSheet } from "../components/Sheet";
import { SkeletonCardGrid } from "../components/Skeleton";
import { FolderIcon, SearchField, SortIcon, ToolbarRow, toolbarIconClass } from "../components/Toolbar";
import { useDelayedShow } from "../hooks/useDelayedShow";
import { useMuralFolders } from "../hooks/useMuralFolders";
import { useMurals } from "../hooks/useMurals";
import { buildTree, collectSubtreeIds, folderPath } from "../lib/muralFolders";
import type { Mural, MuralFolder } from "../lib/murals";
import { useLocale, useT, type WebMessages } from "../i18n";

// Field + direction combined into one option each, rather than two
// separate selects (field, then direction) — four clearly-labeled
// choices in one control reads faster than cross-referencing two, and
// there's no "sort by name" case that would make a split control
// actually pull its weight here.
type SortBy = "updatedDesc" | "updatedAsc" | "createdDesc" | "createdAsc";

const SORT_OPTIONS: Array<{ value: SortBy; label: keyof WebMessages }> = [
  { value: "updatedDesc", label: "murals.sortUpdatedDesc" },
  { value: "updatedAsc", label: "murals.sortUpdatedAsc" },
  { value: "createdDesc", label: "murals.sortCreatedDesc" },
  { value: "createdAsc", label: "murals.sortCreatedAsc" }
];

/** /dashboard/murals — the list of the account's murals (configurable,
 *  freeform dashboards built from books/quotes/images/stats — see
 *  lib/murals.ts). Opening one goes to MuralEditorPage.tsx
 *  (/dashboard/murals/:id); this page is just create/rename/delete, same
 *  role GroupsPage.tsx plays for Series/Collections, but each mural gets
 *  its own full page rather than an inline expandable section — a
 *  freeform canvas needs real room. */
export function MuralsListPage() {
  const locale = useLocale();
  const t = useT();
  const sortOptions = SORT_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }));
  const ownProfile = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const { data: muralsData, isLoading, rename, remove, move: moveMural, setCover, clearCover, share, unshare } = useMurals();
  const showSkeleton = useDelayedShow(isLoading);
  const { data: foldersData, create: createFolder, rename: renameFolder, move: moveFolderApi, remove: removeFolder } = useMuralFolders();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const murals = muralsData ?? [];
  const folders = foldersData ?? [];

  const [sheet, setSheet] = useState<"sort" | "folder" | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [coverMuralId, setCoverMuralId] = useState<string | null>(null);
  const [sharingMuralId, setSharingMuralId] = useState<string | null>(null);
  // Which folder you're looking at lives in the URL rather than in
  // component state. It used to be state, so it was lost the moment you
  // opened a mural: the editor's back link goes to /dashboard/murals,
  // which remounted this page at "All murals" no matter which folder you
  // had come from. In the URL it survives the round trip (the editor's
  // back link carries the mural's own folder), a refresh, and a shared
  // link. `replace` so picking through a folder tree doesn't fill the
  // back button with every step.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFolderId = searchParams.get("folder");
  function setSelectedFolderId(folderId: string | null) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (folderId) next.set("folder", folderId);
        else next.delete("folder");
        return next;
      },
      { replace: true }
    );
  }
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

  // Opens an UNSAVED mural rather than POSTing one. Creating on click
  // meant every idle tap left an "Untitled mural" in the list; the
  // editor now persists it on the first real change (see
  // MuralEditorPage's materialize). The current folder rides along so a
  // mural started inside one lands there.
  function handleCreate() {
    navigate(selectedFolderId ? `/dashboard/murals/new?folder=${encodeURIComponent(selectedFolderId)}` : "/dashboard/murals/new");
  }

  async function handleRename(id: string) {
    const name = editingName.trim();
    setEditingId(null);
    if (!name) return;
    await rename(id, name);
  }

  async function handleDelete(mural: Mural) {
    if (!(await confirm({ title: t("murals.deleteTitle", { name: mural.name }), body: t("library.cannotUndo") }))) return;
    await remove(mural.id);
  }

  async function handleDeleteFolder(folder: MuralFolder) {
    if (!(await confirm({ title: t("murals.deleteTitle", { name: folder.name }), body: t("murals.deleteFolderBody") }))) return;
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
    <Page
      width="wide"
      title={t("shell.areaMurals")}
      actions={
        <>
          <button onClick={() => setPresetsOpen(true)} className={BUTTON_SECONDARY}>
            {t("murals.startFromPreset")}
          </button>
          <button onClick={handleCreate} className={BUTTON_PRIMARY}>
            {t("murals.newMural")}
          </button>
        </>
      }
    >
      {presetsOpen && <MuralPresetPicker folderId={selectedFolderId} onClose={() => setPresetsOpen(false)} />}
      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden md:block">
          <MuralFolderTree
            folders={folders}
            selectedFolderId={selectedFolderId}
            onSelect={setSelectedFolderId}
            onCreateFolder={(parentId) => void createFolder(t("murals.newFolder"), parentId)}
            onRenameFolder={(folder, name) => void renameFolder(folder.id, name)}
            onMoveFolder={(folder) => setMovingFolderId(folder.id)}
            onDeleteFolder={(folder) => void handleDeleteFolder(folder)}
          />
        </div>

        <div className="min-w-0">
          <nav className="mb-3 hidden items-center gap-1 text-xs text-(--color-text-dim) md:flex">
            <button onClick={() => setSelectedFolderId(null)} className="inline-flex min-h-11 items-center hover:text-(--color-text)">
              {t("murals.allMurals")}
            </button>
            {folderPath(folders, selectedFolderId).map((f, i, path) => (
              <span key={f.id} className="flex min-w-0 items-center gap-1">
                <span>/</span>
                {i === path.length - 1 ? (
                  <span className="min-w-0 break-words font-semibold text-(--color-text)">{f.name}</span>
                ) : (
                  <button onClick={() => setSelectedFolderId(f.id)} className="inline-flex min-h-11 min-w-0 items-center break-words text-left hover:text-(--color-text)">
                    {f.name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          {showSkeleton && <SkeletonCardGrid label={t("murals.loading")} />}

          {!isLoading && murals.length === 0 && (
            <EmptyState
              icon={MuralsIcon}
              title={t("murals.emptyTitle")}
              body={t("murals.emptyBody")}
            />
          )}

          {!isLoading && murals.length > 0 && (
            <ToolbarRow>
              <div className="flex items-center gap-2">
                <SearchField className="flex-1 sm:flex-initial" value={search} onChange={setSearch} placeholder={t("library.search")} label={t("murals.searchLabel")} />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  aria-label={t("murals.sort")}
                  className={`${FIELD_CLASS} hidden sm:block`}
                >
                  {sortOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setSheet("sort")}
                  aria-label={t("murals.sortCurrent", { sort: sortOptions.find((o) => o.value === sortBy)?.label ?? "" })}
                  className={`${toolbarIconClass(sortBy !== SORT_OPTIONS[0].value)} sm:hidden`}
                >
                  <SortIcon />
                </button>
                <button
                  onClick={() => setSheet("folder")}
                  aria-label={t("murals.folderCurrent", { path: selectedFolderId ? folderPath(folders, selectedFolderId).map((f) => f.name).join(" / ") : t("murals.allMurals") })}
                  className={`${toolbarIconClass(selectedFolderId !== null)} md:hidden`}
                >
                  <FolderIcon />
                </button>
              </div>
            </ToolbarRow>
          )}

          {sheet === "sort" && (
            <OptionSheet
              title={t("murals.sort")}
              options={sortOptions}
              value={sortBy}
              onSelect={(v) => setSortBy(v as SortBy)}
              onClose={() => setSheet(null)}
            />
          )}
          {sheet === "folder" && (
            <OptionSheet
              title={t("murals.folder")}
              // "" stands in for "no folder selected" — OptionSheet keys
              // on a string, and `null` isn't one. Mapped back on the way
              // out, the same substitution the <select> this replaced
              // already made with its empty-string <option>.
              options={[
                { value: "", label: t("murals.allMurals") },
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
            <p className="text-sm text-(--color-text-dim)">{t("murals.noMatch")}</p>
          )}

          {!isLoading && needle === "" && murals.length > 0 && filteredMurals.length === 0 && selectedFolderId !== null && (
            <p className="text-sm text-(--color-text-dim)">{t("murals.noneInFolder")}</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredMurals.map((mural) => (
              <div
                key={mural.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/dashboard/murals/${mural.id}`)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                    e.preventDefault();
                    navigate(`/dashboard/murals/${mural.id}`);
                  }
                }}
                className={`${PANEL} group relative cursor-pointer overflow-hidden transition-colors hover:bg-(--color-surface-hover)`}
              >
                <MuralThumb theme={mural.theme} coverUrl={mural.coverImageUrl} layouts={mural.blocks.map((block) => block.layout)} className="aspect-[16/7] w-full border-b border-(--color-border)" />
                <div className="p-4">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    {editingId === mural.id ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => handleRename(mural.id)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") handleRename(mural.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={`${FIELD_CLASS} w-full text-lg font-bold`}
                      />
                    ) : (
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="min-w-0 text-left text-lg leading-tight font-bold break-words transition-colors group-hover:text-(--color-accent)">
                          {mural.name}
                        </span>
                        {ownProfile.data?.muralId === mural.id && (
                          <span className="shrink-0 rounded-full bg-(--color-accent-soft) px-1.5 py-0.5 text-[10px] font-semibold text-(--color-accent)">{t("shell.myShelf")}</span>
                        )}
                      </span>
                    )}
                    <OptionsMenu
                      title={t("murals.settings")}
                      triggerClassName="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                      items={[
                        {
                          label: t("library.groupRename"),
                          onClick: () => {
                            setEditingId(mural.id);
                            setEditingName(mural.name);
                          }
                        },
                        { label: mural.coverImageUrl ? t("book.changeCover") : t("murals.addCover"), onClick: () => setCoverMuralId(mural.id) },
                        { label: t("murals.moveTo"), onClick: () => setMovingMuralId(mural.id) },
                        { label: t("library.actionShare"), onClick: () => setSharingMuralId(mural.id) },
                        { label: t("shell.delete"), onClick: () => handleDelete(mural), danger: true }
                      ]}
                    />
                  </div>
                  <p className="text-xs text-(--color-text-dim)">
                    {t("murals.cardMeta", { count: mural.blocks.length, date: formatDate(mural.updatedAt, locale) })}
                  </p>
                </div>
              </div>
            ))}
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
          removeCoverLabel={t("murals.removeCover")}
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
    </Page>
  );
}
