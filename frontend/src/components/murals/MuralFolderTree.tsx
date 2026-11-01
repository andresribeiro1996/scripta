import { useState } from "react";
import { buildTree, folderPath } from "../../lib/muralFolders";
import type { MuralFolder } from "../../lib/murals";
import { useT } from "../../i18n";
import { OptionsMenu } from "../OptionsMenu";
import { FIELD_CLASS } from "../page/buttonClasses";

export function MuralFolderTree({
  folders,
  selectedFolderId,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder
}: {
  folders: MuralFolder[];
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folder: MuralFolder, name: string) => void;
  onMoveFolder: (folder: MuralFolder) => void;
  onDeleteFolder: (folder: MuralFolder) => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function commitRename(folder: MuralFolder) {
    setRenamingId(null);
    const name = renameDraft.trim();
    if (name && name !== folder.name) onRenameFolder(folder, name);
  }

  const nested = folders.some((folder) => folder.parentId !== null);
  const indent = nested ? "ml-11.5 " : "";

  return (
    <nav className="flex flex-col gap-0.5">
      <button
        onClick={() => onSelect(null)}
        aria-current={selectedFolderId === null ? "true" : undefined}
        className={`${indent}min-h-11 rounded px-1.5 text-left text-sm font-semibold ${
          selectedFolderId === null
            ? "bg-(--color-accent-soft) text-(--color-accent)"
            : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
        }`}
      >
        {t("murals.allMurals")}
      </button>

      {buildTree(folders)
        .filter(({ folder }) => !folderPath(folders, folder.id).slice(0, -1).some((p) => collapsed.has(p.id)))
        .map(({ folder, depth }) => {
          const hasChildren = folders.some((f) => f.parentId === folder.id);
          const isCollapsed = collapsed.has(folder.id);
          return (
            <div key={folder.id} className="group flex items-center gap-0.5" style={{ paddingLeft: depth * 14 }}>
              {nested ? (
                <button
                  onClick={() => toggle(folder.id)}
                  title={isCollapsed ? t("muralEditor.expand") : t("muralEditor.collapse")}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded text-(--color-text-dim) hover:bg-(--color-surface-hover) ${
                    hasChildren ? "" : "invisible"
                  }`}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={isCollapsed ? "" : "rotate-90"}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ) : null}
              {renamingId === folder.id ? (
                <input
                  autoFocus
                  maxLength={200}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(folder)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(folder);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className={`${FIELD_CLASS} w-full min-w-0`}
                />
              ) : (
                <button
                  onClick={() => onSelect(folder.id)}
                  aria-current={selectedFolderId === folder.id ? "true" : undefined}
                  className={`min-h-11 flex-1 truncate rounded px-1.5 text-left text-sm ${
                    selectedFolderId === folder.id
                      ? "bg-(--color-accent-soft) font-semibold text-(--color-accent)"
                      : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                  }`}
                >
                  {folder.name}
                </button>
              )}
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <OptionsMenu
                  title={t("muralEditor.folderSettings")}
                  triggerClassName="flex h-11 w-11 items-center justify-center rounded text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                  items={[
                    { label: t("muralEditor.newSubfolder"), onClick: () => onCreateFolder(folder.id) },
                    {
                      label: t("library.groupRename"),
                      onClick: () => {
                        setRenamingId(folder.id);
                        setRenameDraft(folder.name);
                      }
                    },
                    { label: t("murals.moveTo"), onClick: () => onMoveFolder(folder) },
                    { label: t("shell.delete"), onClick: () => onDeleteFolder(folder), danger: true }
                  ]}
                />
              </div>
            </div>
          );
        })}

      <button
        onClick={() => onCreateFolder(selectedFolderId === null ? null : (folders.find((f) => f.id === selectedFolderId)?.parentId ?? null))}
        title={t("muralEditor.createFolderNext")}
        className={`${indent}mt-2 min-h-11 rounded border border-dashed border-(--color-border) px-1.5 text-left text-xs text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent)`}
      >
        {t("muralEditor.newFolderButton")}
      </button>
    </nav>
  );
}
