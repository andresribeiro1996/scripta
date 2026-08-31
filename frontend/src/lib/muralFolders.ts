import type { MuralFolder } from "./murals";

export interface FolderNode {
  folder: MuralFolder;
  depth: number;
}

export function buildTree(folders: MuralFolder[]): FolderNode[] {
  const byParent = new Map<string | null, MuralFolder[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  const out: FolderNode[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const folder of byParent.get(parentId) ?? []) {
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

export function folderPath(folders: MuralFolder[], id: string | null): MuralFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: MuralFolder[] = [];
  let current = id === null ? null : (byId.get(id) ?? null);
  while (current) {
    path.unshift(current);
    current = current.parentId === null ? null : (byId.get(current.parentId) ?? null);
  }
  return path;
}

export function collectSubtreeIds(folders: MuralFolder[], id: string): Set<string> {
  const ids = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}
