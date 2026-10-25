import { buildTree } from "../../lib/muralFolders";
import type { MuralFolder } from "../../lib/murals";
import { Sheet } from "../Sheet";

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
  return (
    <Sheet title={`Move "${title}"`} onClose={onClose}>
      <div className="flex flex-col gap-0.5 p-1">
        <button
          onClick={() => onSelect(null)}
          className="min-h-11 rounded-lg px-2 text-left text-sm text-(--color-text) hover:bg-(--color-surface-hover)"
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
              className={`truncate min-h-11 rounded-lg px-2 text-left text-sm ${
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
    </Sheet>
  );
}
