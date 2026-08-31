import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createMuralFolderApi, deleteMuralFolderApi, fetchMuralFolders, updateMuralFolderApi } from "../api/murals";
import type { Mural, MuralFolder } from "../lib/murals";

export function useMuralFolders() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["muralFolders"], queryFn: fetchMuralFolders });

  function current(): MuralFolder[] {
    return queryClient.getQueryData<MuralFolder[]>(["muralFolders"]) ?? [];
  }

  function setFolders(folders: MuralFolder[]) {
    queryClient.setQueryData(["muralFolders"], folders);
  }

  function replaceOne(updated: MuralFolder) {
    setFolders(current().map((f) => (f.id === updated.id ? updated : f)));
  }

  async function create(name: string, parentId: string | null = null): Promise<MuralFolder> {
    const created = await createMuralFolderApi(name, parentId);
    setFolders([...current(), created]);
    return created;
  }

  async function rename(id: string, name: string): Promise<MuralFolder> {
    const updated = await updateMuralFolderApi(id, { name });
    replaceOne(updated);
    return updated;
  }

  async function move(id: string, parentId: string | null): Promise<MuralFolder> {
    const updated = await updateMuralFolderApi(id, { parentId });
    replaceOne(updated);
    return updated;
  }

  async function remove(id: string): Promise<void> {
    await deleteMuralFolderApi(id);
    const parentId = current().find((f) => f.id === id)?.parentId ?? null;
    setFolders(
      current()
        .filter((f) => f.id !== id)
        .map((f) => (f.parentId === id ? { ...f, parentId } : f))
    );
    const murals = queryClient.getQueryData<Mural[]>(["murals"]);
    if (murals) {
      queryClient.setQueryData(
        ["murals"],
        murals.map((m) => ((m.folderId ?? null) === id ? { ...m, folderId: parentId } : m))
      );
    }
  }

  return { ...query, create, rename, move, remove };
}
