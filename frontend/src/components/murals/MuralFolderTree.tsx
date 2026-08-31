import { useState } from "react";
import { buildTree, folderPath } from "../../lib/muralFolders";
import type { MuralFolder } from "../../lib/murals";
import { OptionsMenu } from "../OptionsMenu";

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

  return (
    <nav className="flex flex-col gap-0.5">
      <button
        onClick={() => onSelect(null)}
        className={`rounded-lg px-2 py-1.5 text-left text-sm font-semibold ${
          selectedFolderId === null
            ? "bg-(--color-accent-soft) text-(--color-accent)"
            : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
        }`}
      >
        All murals
      </button>

      {buildTree(folders)
        .filter(({ folder }) => !folderPath(folders, folder.id).slice(0, -1).some((p) => collapsed.has(p.id)))
        .map(({ folder, depth }) => {
          const hasChildren = folders.some((f) => f.parentId === folder.id);
          const isCollapsed = collapsed.has(folder.id);
          return (
            <div key={folder.id} className="group flex items-center gap-0.5" style={{ paddingLeft: depth * 14 }}>
              <button
                onClick={() => toggle(folder.id)}
                title={isCollapsed ? "Expand" : "Collapse"}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-(--color-text-dim) hover:bg-(--color-surface-hover) ${
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
              {renamingId === folder.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(folder)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(folder);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="w-full min-w-0 rounded border border-(--color-border) bg-(--color-surface) px-1.5 py-0.5 text-sm"
                />
              ) : (
                <button
                  onClick={() => onSelect(folder.id)}
                  className={`flex-1 truncate rounded px-1.5 py-1 text-left text-sm ${
                    selectedFolderId === folder.id
                      ? "bg-(--color-accent-soft) font-semibold text-(--color-accent)"
                      : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                  }`}
                >
                  {folder.name}
                </button>
              )}
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => onCreateFolder(folder.id)}
                  title="New subfolder"
                  className="flex h-5 w-5 items-center justify-center rounded text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <OptionsMenu
                  title="Folder settings"
                  triggerClassName="flex h-5 w-5 items-center justify-center rounded text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                  items={[
                    {
                      label: "Rename",
                      onClick: () => {
                        setRenamingId(folder.id);
                        setRenameDraft(folder.name);
                      }
                    },
                    { label: "Move to…", onClick: () => onMoveFolder(folder) },
                    { label: "Delete", onClick: () => onDeleteFolder(folder), danger: true }
                  ]}
                />
              </div>
            </div>
          );
        })}

      <button
        onClick={() => onCreateFolder(selectedFolderId)}
        className="mt-2 rounded-lg border border-dashed border-(--color-border) px-2 py-1.5 text-left text-xs text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent)"
      >
        + New folder
      </button>
    </nav>
  );
}
