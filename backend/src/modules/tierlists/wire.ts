import { canonicalByKey, canonicalWorkIds, firstKeyPerWork } from "../library/index.js";
import type { HistogramCell, Placement, PublicBookData, TierDefinition, TierlistData } from "@scripta/shared";

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function tiersOf(data: unknown): Array<Record<string, unknown>> {
  return list((data as { tiers?: unknown } | null)?.tiers).filter((tier): tier is Record<string, unknown> => typeof tier === "object" && tier !== null);
}

function poolOf(data: unknown): unknown[] {
  return list((data as { pool?: unknown } | null)?.pool);
}

function storedIds(data: unknown): string[] {
  return [...tiersOf(data).flatMap((tier) => list(tier.workIds)), ...poolOf(data)].filter((id): id is string => typeof id === "string" && id !== "");
}

function selfMap(ids: string[]) {
  return canonicalByKey(new Map(ids.map((id) => [id, id])));
}

export function boardCanonical(data: unknown): Map<string, string> {
  return selfMap(storedIds(data));
}

export function canonicalBoard(data: unknown, known?: Map<string, string>): TierlistData {
  const canonical = known ?? boardCanonical(data);
  const seen = new Set<string>();
  const take = (ids: unknown) =>
    list(ids).flatMap((id) => {
      const work = typeof id === "string" ? canonical.get(id) : undefined;
      if (!work || seen.has(work)) return [];
      seen.add(work);
      return [work];
    });
  const tiers = tiersOf(data).map((tier) => ({ ...tier, workIds: take(tier.workIds) })) as unknown as TierDefinition[];
  return { tiers, pool: take(poolOf(data)) };
}

export function canonicalFirst(ids: string[]): { canonical: Map<string, string>; first: Set<string> } {
  const canonical = selfMap(ids);
  return { canonical, first: new Set(firstKeyPerWork(ids, canonical).values()) };
}

export function histogramToWorks(cells: HistogramCell[], canonical: Map<string, string>, first: Set<string>): HistogramCell[] {
  return cells.flatMap((cell) => (first.has(cell.workId) ? [{ workId: canonical.get(cell.workId)!, tierId: cell.tierId, votes: cell.votes }] : []));
}

export function placementsToWorks(placements: Placement[], canonical: Map<string, string>, first: Set<string>): Placement[] {
  return placements.flatMap((placement) => (first.has(placement.workId) ? [{ workId: canonical.get(placement.workId)!, tierId: placement.tierId }] : []));
}

export function placementsFromWorks(placements: Array<{ workId: string; tierId: string }>, ids: string[], storedByCanonical: Map<string, string>): Placement[] | null {
  const stored: Placement[] = [];
  for (const [index, placement] of placements.entries()) {
    const workId = storedByCanonical.get(ids[index]!);
    if (!workId) return null;
    stored.push({ workId, tierId: placement.tierId });
  }
  return stored;
}

export function boardBooks(pool: string[], snapshot: unknown[] | null, live: () => PublicBookData[]): PublicBookData[] {
  if (!snapshot) return live();
  const entries = snapshot.filter((book): book is PublicBookData => typeof book === "object" && book !== null);
  const canonical = canonicalWorkIds(entries.flatMap((book) => (typeof book.workId === "string" ? [book.workId] : [])));
  const byWork = new Map<string, PublicBookData>();
  for (const book of entries) {
    const work = typeof book.workId === "string" ? canonical.get(book.workId) : undefined;
    if (work && !byWork.has(work)) byWork.set(work, { ...book, workId: work });
  }
  return pool.every((id) => byWork.has(id)) ? pool.map((id) => byWork.get(id)!) : live();
}
