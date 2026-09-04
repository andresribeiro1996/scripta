import { buildTree } from "../../lib/muralFolders";
import type { MuralFolder } from "../../lib/murals";
import { useDismissible } from "../../hooks/useDismissible";
import { useScrollLock } from "../../hooks/useScrollLock";

export function MoveToFolderModal({
  title,
  folders,
  disabledIds,
  onSelect,
  onClose
}: {
  title: string;
  folders: MuralFolder[];
  disabledIds: Set<string>;
  onSelect: (folderId: string | null) => void;
  onClose: () => void;
}) {
  useScrollLock();
  useDismissible(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-(--color-border) bg-(--color-surface) shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--color-border) p-4">
          <h3 className="text-sm font-semibold">Move "{title}"</h3>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto overscroll-contain p-3">
          <button
            onClick={() => onSelect(null)}
            className="rounded-lg px-2 py-1.5 text-left text-sm text-(--color-text) hover:bg-(--color-surface-hover)"
          >
            All murals (root)
          </button>
          {buildTree(folders).map(({ folder, depth }) => {
            const disabled = disabledIds.has(folder.id);
            return (
              <button
                key={folder.id}
                disabled={disabled}
                onClick={() => onSelect(folder.id)}
                style={{ marginLeft: (depth + 1) * 14 }}
                className={`truncate rounded-lg px-2 py-1.5 text-left text-sm ${
                  disabled
                    ? "cursor-not-allowed text-(--color-text-dim) opacity-40"
                    : "text-(--color-text) hover:bg-(--color-surface-hover)"
                }`}
              >
                {folder.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
