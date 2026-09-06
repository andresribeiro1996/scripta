// Shared read/mutate access to the account's murals — same overall shape
// as useSocials.ts (a useQuery over one list, plain mutate-then-cache-set
// helpers), but each mutation here targets ONE mural by id rather than
// replacing the whole list, since a mural is its own row on the backend
// now (modules/murals), not a field on the library blob.
//
// scrubBooks/scrubImage are the two exceptions — they run the EXISTING
// pure functions in lib/murals.ts (unchanged) against the whole cached
// list, diff which individual murals actually changed (reference
// inequality — those pure functions already return the SAME array/mural
// reference for anything untouched, see their own comments), and PUT only
// the ones that changed. Called alongside a book delete
// (LibraryPage.tsx/GroupsPage.tsx) or a gallery image delete
// (useDeleteGalleryImage.ts) as an independent step next to the library
// save — books/groups data still lives in the library blob, but murals no
// longer do.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearMuralCoverApi,
  createMuralApi,
  deleteMuralApi,
  fetchMurals,
  setMuralCoverApi,
  shareMuralApi,
  unshareMuralApi,
  updateMuralApi
} from "../api/murals";
import { ensureBookBlockHeights, scrubBooksFromMurals, scrubImageFromMurals, type Mural, type MuralBlock } from "../lib/murals";

export function useMurals() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["murals"],
    queryFn: async () => (await fetchMurals()).map((mural) => ({ ...mural, blocks: ensureBookBlockHeights(mural.blocks) }))
  });

  function current(): Mural[] {
    return queryClient.getQueryData<Mural[]>(["murals"]) ?? [];
  }

  function currentMural(id: string): Mural | undefined {
    return current().find((mural) => mural.id === id);
  }

  function setMurals(murals: Mural[]) {
    queryClient.setQueryData(["murals"], murals);
  }

  function replaceOne(updated: Mural) {
    setMurals(current().map((m) => (m.id === updated.id ? { ...updated, blocks: ensureBookBlockHeights(updated.blocks) } : m)));
  }

  async function create(name: string, folderId: string | null = null): Promise<Mural> {
    const created = await createMuralApi(name, folderId);
    setMurals([...current(), created]);
    return created;
  }

  async function rename(id: string, name: string): Promise<Mural> {
    const updated = await updateMuralApi(id, { name });
    replaceOne(updated);
    return updated;
  }

  async function saveBlocks(id: string, blocks: MuralBlock[]): Promise<Mural> {
    const updated = await updateMuralApi(id, { blocks });
    replaceOne(updated);
    return updated;
  }

  async function remove(id: string): Promise<void> {
    await deleteMuralApi(id);
    setMurals(current().filter((m) => m.id !== id));
  }

  async function setCover(id: string, imageId: string, url: string): Promise<Mural> {
    const updated = await setMuralCoverApi(id, imageId, url);
    replaceOne(updated);
    return updated;
  }

  async function clearCover(id: string): Promise<Mural> {
    const updated = await clearMuralCoverApi(id);
    replaceOne(updated);
    return updated;
  }

  async function share(id: string): Promise<Mural> {
    const updated = await shareMuralApi(id);
    replaceOne(updated);
    return updated;
  }

  async function unshare(id: string): Promise<Mural> {
    const updated = await unshareMuralApi(id);
    replaceOne(updated);
    return updated;
  }

  async function move(id: string, folderId: string | null): Promise<Mural> {
    const updated = await updateMuralApi(id, { folderId });
    replaceOne(updated);
    return updated;
  }

  /** Scrubs one or more deleted books' keys out of every mural, PUTting
   *  only the murals scrubBooksFromMurals actually touched. */
  async function scrubBooks(keys: Iterable<string>): Promise<void> {
    const before = current();
    const after = scrubBooksFromMurals(before, keys);
    if (after === before) return; // no-op — nothing referenced these keys

    const results = await Promise.all(
      before.map((b, i) => {
        const m = after[i];
        return m === b ? b : updateMuralApi(b.id, { blocks: m.blocks });
      })
    );
    setMurals(results);
  }

  /** Same idea for a deleted gallery image — a mural could need BOTH its
   *  cover cleared and an `image` block removed, so both are checked
   *  independently per mural rather than assuming one implies the other.
   *  clearMuralCoverApi runs first when needed so the follow-up
   *  updateMuralApi (which patches only `blocks`) reflects the already-
   *  cleared cover in its response, rather than a stale one. */
  async function scrubImage(imageId: string): Promise<void> {
    const before = current();
    const after = scrubImageFromMurals(before, imageId);
    if (after === before) return; // no-op — nothing referenced this image

    const results = await Promise.all(
      before.map(async (b, i) => {
        const m = after[i];
        if (m === b) return b;
        let result: Mural = b;
        if (b.coverImageId === imageId) {
          result = await clearMuralCoverApi(b.id);
        }
        if (b.blocks.some((block) => block.type === "image" && block.imageId === imageId)) {
          result = await updateMuralApi(b.id, { blocks: m.blocks });
        }
        return result;
      })
    );
    setMurals(results);
  }

  return { ...query, create, rename, saveBlocks, currentMural, remove, setCover, clearCover, share, unshare, move, scrubBooks, scrubImage };
}
