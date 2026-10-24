import type { TierDefinition, TierlistData } from "@scripta/shared";

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function tiersOf(data: unknown): Array<Record<string, unknown>> {
  return list((data as { tiers?: unknown } | null)?.tiers).filter((tier): tier is Record<string, unknown> => typeof tier === "object" && tier !== null);
}

function poolOf(data: unknown): unknown[] {
  return list((data as { pool?: unknown } | null)?.pool);
}

export function storedIds(data: unknown): string[] {
  return [...tiersOf(data).flatMap((tier) => list(tier.workIds)), ...poolOf(data)].filter((id): id is string => typeof id === "string" && id !== "");
}

export function canonicalBoard(data: unknown, known: Map<string, string>): TierlistData {
  const seen = new Set<string>();
  const take = (ids: unknown) =>
    list(ids).flatMap((id) => {
      const work = typeof id === "string" ? known.get(id) : undefined;
      if (!work || seen.has(work)) return [];
      seen.add(work);
      return [work];
    });
  const tiers = tiersOf(data).map((tier) => ({ ...tier, workIds: take(tier.workIds) })) as unknown as TierDefinition[];
  return { tiers, pool: take(poolOf(data)) };
}
