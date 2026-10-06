export function boardWorks(data: unknown): string[] {
  const board = data && typeof data === "object" ? (data as { pool?: unknown; tiers?: unknown }) : {};
  const pool = Array.isArray(board.pool) ? board.pool : [];
  const tiers = Array.isArray(board.tiers) ? board.tiers : [];
  const tierWorks = tiers.flatMap((tier) => {
    const ids = tier && typeof tier === "object" ? (tier as { workIds?: unknown }).workIds : undefined;
    return Array.isArray(ids) ? ids : [];
  });
  return [...new Set([...pool, ...tierWorks].filter((id): id is string => typeof id === "string" && id !== ""))];
}
