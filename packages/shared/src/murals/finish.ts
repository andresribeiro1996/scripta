import { newId, type MuralBlock } from "./murals.js";

type Shelf = Extract<MuralBlock, { type: "shelf" }>;
export type Landing = "finished" | "favourites";

function shelfWithRole(blocks: MuralBlock[], role: Landing) {
  return blocks.find((block): block is Shelf => block.type === "shelf" && block.role === role);
}

function toFront(shelf: Shelf, key: string): Shelf {
  return { ...shelf, bookKeys: [key, ...shelf.bookKeys.filter((item) => item !== key)] };
}

export function shelfAfterFinish(blocks: MuralBlock[], key: string, rating: number | null): { blocks: MuralBlock[]; landed: Landing[] } {
  const finished = shelfWithRole(blocks, "finished");
  if (!finished) return { blocks, landed: [] };
  const alreadyFront = finished.bookKeys[0] === key;
  const addsFavourite = rating !== null && rating >= 4 && !shelfWithRole(blocks, "favourites");
  const landed: Landing[] = ["finished"];
  if (alreadyFront && !addsFavourite) return { blocks, landed };
  const next: MuralBlock[] = alreadyFront ? [...blocks] : blocks.map((block) => (block === finished ? toFront(finished, key) : block));
  if (addsFavourite) {
    const y = Math.max(...blocks.map((block) => block.layout.y + block.layout.h));
    next.push({ id: newId(), type: "shelf", title: "Favourites", role: "favourites", bookKeys: [key], layout: { x: 0, y, w: 12, h: 5 }, ...(finished.style ? { style: finished.style } : {}) });
    landed.push("favourites");
  }
  return { blocks: next, landed };
}

export function favouriteOpponent(blocks: MuralBlock[], key: string): string | null {
  return shelfWithRole(blocks, "favourites")?.bookKeys.find((item) => item !== key) ?? null;
}

export function promoteFavourite(blocks: MuralBlock[], key: string): MuralBlock[] {
  const favourites = shelfWithRole(blocks, "favourites");
  if (!favourites || favourites.bookKeys[0] === key) return blocks;
  return blocks.map((block) => (block === favourites ? toFront(favourites, key) : block));
}

interface ShelfLoadResult {
  id: string;
  blocks: MuralBlock[];
  updatedAt?: string;
}

interface ShelfSaveResult {
  updatedAt?: string;
}

export interface ShelfSession {
  finish(key: string, rating: number | null): Promise<void>;
  promote(key: string): Promise<void>;
  restore(): Promise<boolean>;
  stop(): void;
}

/** Runs every shelf change through one serialized promise chain — the base
 *  is loaded once (never re-fetched), every operation reads and writes the
 *  latest in-memory blocks (never a stale closure), and `restore()` can
 *  land in the middle of that chain (a queued rating/promote after it turns
 *  into a no-op) or before the load even resolves (nothing to restore yet).
 *  Web (FinishSheet.tsx) and mobile (FinishedScreen.tsx) both drive one of
 *  these instead of keeping their own shelf state/closures. */
export function createShelfSession(opts: {
  load: () => Promise<ShelfLoadResult>;
  save: (id: string, blocks: MuralBlock[], updatedAt?: string) => Promise<ShelfSaveResult>;
  onChange: (state: { blocks: MuralBlock[]; landed: Landing[] }) => void;
}): ShelfSession {
  let chain: Promise<void> = Promise.resolve();
  let loadPromise: Promise<void> | null = null;
  let loaded: { id: string; original: MuralBlock[]; blocks: MuralBlock[]; updatedAt?: string } | null = null;
  const landed = new Set<Landing>();
  let undone = false;
  let stopped = false;

  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = opts.load().then((result) => {
        loaded = { id: result.id, original: result.blocks, blocks: result.blocks, updatedAt: result.updatedAt };
      });
    }
    return loadPromise;
  }

  function enqueue(op: () => Promise<void>): Promise<void> {
    const result = chain.then(op);
    chain = result.catch(() => {});
    return result;
  }

  async function applyChange(change: (blocks: MuralBlock[]) => { blocks: MuralBlock[]; landed?: Landing[] }) {
    await ensureLoaded();
    if (undone || !loaded) return;
    const outcome = change(loaded.blocks);
    for (const l of outcome.landed ?? []) landed.add(l);
    const changed = outcome.blocks !== loaded.blocks;
    loaded.blocks = outcome.blocks;
    if (!stopped) opts.onChange({ blocks: loaded.blocks, landed: [...landed] });
    if (changed) {
      const result = await opts.save(loaded.id, outcome.blocks, loaded.updatedAt);
      loaded.updatedAt = result.updatedAt ?? loaded.updatedAt;
    }
  }

  return {
    finish(key, rating) {
      return enqueue(() => applyChange((blocks) => shelfAfterFinish(blocks, key, rating)));
    },
    promote(key) {
      return enqueue(() => applyChange((blocks) => ({ blocks: promoteFavourite(blocks, key) })));
    },
    async restore() {
      undone = true;
      await chain;
      if (!loaded || loaded.blocks === loaded.original) return true;
      try {
        const result = await opts.save(loaded.id, loaded.original, loaded.updatedAt);
        loaded.blocks = loaded.original;
        loaded.updatedAt = result.updatedAt ?? loaded.updatedAt;
        if (!stopped) opts.onChange({ blocks: loaded.blocks, landed: [...landed] });
        return true;
      } catch {
        return false;
      }
    },
    stop() {
      stopped = true;
    }
  };
}
