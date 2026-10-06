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

import type { ThemeId } from "@scripta/shared/themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";
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
import { compactMuralBlocks, ensureBookBlockHeights, scrubBooksFromMurals, scrubImageFromMurals, type Mural, type MuralBlock } from "../lib/murals";

export class MuralConflictError extends Error {
  constructor() {
    super("This mural was changed somewhere else, so the latest version is showing now. Your last change wasn't saved.");
  }
}

const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite<T>(id: string, work: () => Promise<T>): Promise<T> {
  const run = (writeQueues.get(id) ?? Promise.resolve()).then(work);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  writeQueues.set(id, tail);
  void tail.then(() => {
    if (writeQueues.get(id) === tail) writeQueues.delete(id);
  });
  return run;
}

export function useMurals() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["murals"],
    queryFn: async () => (await fetchMurals()).map((mural) => ({ ...mural, blocks: compactMuralBlocks(ensureBookBlockHeights(mural.blocks)) }))
  });

  function current(): Mural[] {
    return queryClient.getQueryData<Mural[]>(["murals"]) ?? [];
  }

  function currentMural(id: string): Mural | undefined {
    return current().find((mural) => mural.id === id);
  }

  function setMurals(murals: Mural[]) {
    queryClient.setQueryData(["murals"], murals);
    void queryClient.invalidateQueries({ queryKey: ["home"] });
  }

  function replaceOne(updated: Mural) {
    setMurals(current().map((m) => (m.id === updated.id ? { ...updated, blocks: compactMuralBlocks(ensureBookBlockHeights(updated.blocks)) } : m)));
  }

  async function putMural(id: string, patch: Parameters<typeof updateMuralApi>[1]): Promise<Mural> {
    try {
      return await updateMuralApi(id, { ...patch, updatedAt: currentMural(id)?.updatedAt });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      await queryClient.invalidateQueries({ queryKey: ["murals"] });
      throw new MuralConflictError();
    }
  }

  function writeOne(id: string, send: () => Promise<Mural>): Promise<Mural> {
    return enqueueWrite(id, async () => {
      const updated = await send();
      replaceOne(updated);
      return updated;
    });
  }

  async function create(name: string, theme: ThemeId, folderId: string | null = null): Promise<Mural> {
    const created = await createMuralApi(name, theme, folderId);
    setMurals([...current(), created]);
    return created;
  }

  async function rename(id: string, name: string): Promise<Mural> {
    return writeOne(id, () => putMural(id, { name }));
  }

  async function setTheme(id: string, theme: ThemeId): Promise<Mural> {
    return writeOne(id, () => putMural(id, { theme }));
  }

  async function saveBlocks(id: string, blocks: MuralBlock[]): Promise<Mural> {
    await queryClient.cancelQueries({ queryKey: ["murals"] });
    const before = currentMural(id);
    const next = compactMuralBlocks(ensureBookBlockHeights(blocks));
    if (before) replaceOne({ ...before, blocks: next });
    const optimistic = currentMural(id)?.blocks;
    try {
      return await enqueueWrite(id, async () => {
        const updated = await putMural(id, { blocks: next });
        const latest = currentMural(id);
        const base = latest ?? updated;
        replaceOne({ ...base, blocks: !before || latest?.blocks === optimistic ? updated.blocks : base.blocks, updatedAt: updated.updatedAt });
        return updated;
      });
    } catch (error) {
      const latest = currentMural(id);
      if (before && latest && latest.blocks === optimistic) replaceOne({ ...latest, blocks: before.blocks });
      throw error;
    }
  }

  async function remove(id: string): Promise<void> {
    await deleteMuralApi(id);
    setMurals(current().filter((m) => m.id !== id));
    await queryClient.invalidateQueries({ queryKey: ["community", "own-profile"] });
  }

  async function setCover(id: string, imageId: string, url: string): Promise<Mural> {
    return writeOne(id, () => setMuralCoverApi(id, imageId, url));
  }

  async function clearCover(id: string): Promise<Mural> {
    return writeOne(id, () => clearMuralCoverApi(id));
  }

  async function share(id: string): Promise<Mural> {
    return writeOne(id, () => shareMuralApi(id));
  }

  async function unshare(id: string): Promise<Mural> {
    return writeOne(id, () => unshareMuralApi(id));
  }

  async function move(id: string, folderId: string | null): Promise<Mural> {
    return writeOne(id, () => putMural(id, { folderId }));
  }

  /** Scrubs one or more deleted books' keys out of every mural, PUTting
   *  only the murals scrubBooksFromMurals actually touched. */
  async function scrubBooks(keys: Iterable<string>): Promise<void> {
    const before = current();
    const after = scrubBooksFromMurals(before, keys);
    if (after === before) return; // no-op — nothing referenced these keys

    await Promise.all(
      before.map((b, i) => {
        const m = after[i];
        return m === b ? b : writeOne(b.id, () => putMural(b.id, { blocks: m.blocks }));
      })
    );
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

    await Promise.all(
      before.map((b, i) => {
        const m = after[i];
        if (m === b) return b;
        return enqueueWrite(b.id, async () => {
          if (b.coverImageId === imageId) replaceOne(await clearMuralCoverApi(b.id));
          if (b.blocks.some((block) => block.type === "image" && block.imageId === imageId)) replaceOne(await putMural(b.id, { blocks: m.blocks }));
        });
      })
    );
  }

  return { ...query, create, rename, setTheme, saveBlocks, currentMural, remove, setCover, clearCover, share, unshare, move, scrubBooks, scrubImage };
}
