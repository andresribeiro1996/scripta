import { scrubBooksFromMurals, scrubImageFromMurals, type Mural, type MuralBlock, type MuralFolder } from "@scripta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

export const MURALS_QUERY_KEY = ["murals"] as const;
export const MURAL_FOLDERS_QUERY_KEY = ["mural-folders"] as const;

export function useMurals() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: MURALS_QUERY_KEY, queryFn: api.fetchMurals });
  const current = () => client.getQueryData<Mural[]>(MURALS_QUERY_KEY) ?? [];
  const replace = (mural: Mural) => client.setQueryData<Mural[]>(MURALS_QUERY_KEY, current().map((item) => item.id === mural.id ? mural : item));
  return {
    ...query,
    async create(name: string, folderId: string | null = null) { const mural = await api.createMural(name, folderId); client.setQueryData(MURALS_QUERY_KEY, [...current(), mural]); return mural; },
    async update(id: string, patch: { name?: string; blocks?: MuralBlock[]; folderId?: string | null }) { const mural = await api.updateMural(id, { ...patch, updatedAt: current().find((item) => item.id === id)?.updatedAt }); replace(mural); return mural; },
    async remove(id: string) { await api.deleteMural(id); client.setQueryData(MURALS_QUERY_KEY, current().filter((item) => item.id !== id)); },
    async setCover(id: string, imageId: string, url: string) { const mural = await api.setMuralCover(id, imageId, url); replace(mural); return mural; },
    async clearCover(id: string) { const mural = await api.clearMuralCover(id); replace(mural); return mural; },
    async share(id: string) { const mural = await api.shareMural(id); replace(mural); return mural; },
    async unshare(id: string) { const mural = await api.unshareMural(id); replace(mural); return mural; },
    async scrubBooks(keys: Iterable<string>) {
      const before = current();
      const after = scrubBooksFromMurals(before, keys);
      if (after === before) return;
      const results = await Promise.all(before.map((mural, index) => after[index] === mural ? mural : api.updateMural(mural.id, { blocks: after[index]!.blocks, updatedAt: mural.updatedAt })));
      client.setQueryData(MURALS_QUERY_KEY, results);
    },
    async scrubImage(imageId: string) {
      const before = current();
      const after = scrubImageFromMurals(before, imageId);
      if (after === before) return;
      const results = await Promise.all(before.map(async (mural, index) => {
        if (after[index] === mural) return mural;
        let currentMural = mural;
        if (mural.coverImageId === imageId) currentMural = await api.clearMuralCover(mural.id);
        if (mural.blocks.some((block) => block.type === "image" && block.imageId === imageId)) currentMural = await api.updateMural(mural.id, { blocks: after[index]!.blocks, updatedAt: currentMural.updatedAt });
        return currentMural;
      }));
      client.setQueryData(MURALS_QUERY_KEY, results);
    },
  };
}

export function useMuralFolders() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: MURAL_FOLDERS_QUERY_KEY, queryFn: api.fetchFolders });
  const current = () => client.getQueryData<MuralFolder[]>(MURAL_FOLDERS_QUERY_KEY) ?? [];
  return {
    ...query,
    async create(name: string, parentId: string | null = null) { const folder = await api.createFolder(name, parentId); client.setQueryData(MURAL_FOLDERS_QUERY_KEY, [...current(), folder]); return folder; },
    async update(id: string, patch: { name?: string; parentId?: string | null }) { const folder = await api.updateFolder(id, patch); client.setQueryData<MuralFolder[]>(MURAL_FOLDERS_QUERY_KEY, current().map((item) => item.id === id ? folder : item)); return folder; },
    async remove(id: string) { await api.deleteFolder(id); await client.invalidateQueries({ queryKey: MURAL_FOLDERS_QUERY_KEY }); await client.invalidateQueries({ queryKey: MURALS_QUERY_KEY }); },
  };
}
