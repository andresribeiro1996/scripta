import { canonicalByKey, duplicateWorkMessage, firstKeyPerWork, keysForWorks, knownWorkIds } from "../library/index.js";
import type { HistogramCell, Placement, Tierlist } from "./domain/types.js";

export interface WorksTier {
  id: string;
  label: string;
  color: string;
  workIds: string[];
}

export interface WorksBoard {
  tiers: WorksTier[];
  pool: string[];
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function tiersOf(data: unknown): Array<Record<string, unknown>> {
  return list((data as { tiers?: unknown } | null)?.tiers).filter((tier): tier is Record<string, unknown> => typeof tier === "object" && tier !== null);
}

function poolOf(data: unknown): unknown[] {
  return list((data as { pool?: unknown } | null)?.pool);
}

export function boardKeysInOrder(data: unknown): string[] {
  return [...tiersOf(data).flatMap((tier) => list(tier.bookKeys)), ...poolOf(data)].filter((key): key is string => typeof key === "string" && key !== "");
}

export function boardToWorks(data: unknown, works: Map<string, string>) {
  const seen = new Set<string>();
  const take = (keys: unknown) =>
    list(keys).flatMap((key) => {
      const work = typeof key === "string" ? works.get(key) : undefined;
      if (!work || seen.has(work)) return [];
      seen.add(work);
      return [work];
    });
  const tiers = tiersOf(data).map(({ bookKeys, ...tier }) => ({ ...tier, workIds: take(bookKeys) }));
  return { tiers, pool: take(poolOf(data)) };
}

export function histogramToWorks(cells: HistogramCell[], works: Map<string, string>, firstKeys: Set<string>) {
  return cells.flatMap((cell) => (firstKeys.has(cell.bookKey) ? [{ workId: works.get(cell.bookKey)!, tierId: cell.tierId, votes: cell.votes }] : []));
}

export function placementsToWorks(placements: Placement[], works: Map<string, string>, firstKeys: Set<string>) {
  return placements.flatMap((placement) => (firstKeys.has(placement.bookKey) ? [{ workId: works.get(placement.bookKey)!, tierId: placement.tierId }] : []));
}

export function placementsFromWorks(placements: Array<{ workId: string; tierId: string }>, ids: string[], keyByWork: Map<string, string>): Placement[] | null {
  const keyed: Placement[] = [];
  for (const [index, placement] of placements.entries()) {
    const bookKey = keyByWork.get(ids[index]!);
    if (!bookKey) return null;
    keyed.push({ bookKey, tierId: placement.tierId });
  }
  return keyed;
}

export function boardBooksToWorks(pool: string[], snapshot: unknown[] | null, works: Map<string, string>, live: () => unknown[]): unknown[] {
  if (!snapshot || snapshot.length !== pool.length) return live();
  return snapshot.map((book, index) => ({ ...(book as Record<string, unknown>), key: pool[index], workId: works.get(pool[index]!) ?? null }));
}

export function keyedBoard(ownerUserId: string, board: WorksBoard, data: unknown, stored: Map<string, string | null>) {
  const all = [...board.tiers.flatMap((tier) => tier.workIds), ...board.pool];
  if (new Set(all).size !== all.length) return { status: 400 as const, error: "Duplicate tier or book." };
  const ids = knownWorkIds(all);
  if (new Set(ids).size !== ids.length) return { status: 409 as const, error: duplicateWorkMessage({ workId: null, title: null }) };
  const canonical = new Map(all.map((id, index) => [id, ids[index]!]));
  const keys = keysForWorks(ownerUserId, ids, firstKeyPerWork(boardKeysInOrder(data), canonicalByKey(stored)));
  const keyOf = (id: string) => keys.get(canonical.get(id)!)!;
  return {
    data: {
      tiers: board.tiers.map(({ workIds, ...tier }) => ({ ...tier, bookKeys: workIds.map(keyOf) })),
      pool: board.pool.map(keyOf)
    },
    works: new Map<string, string | null>(ids.map((id) => [keys.get(id)!, id]))
  };
}

export function tierlistToWorks(tierlist: Tierlist, stored: Map<string, string | null>): Tierlist {
  return { ...tierlist, data: boardToWorks(tierlist.data, canonicalByKey(stored)) };
}
