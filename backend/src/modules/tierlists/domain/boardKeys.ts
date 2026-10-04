export function boardKeys(data: unknown): string[] {
  const board = data && typeof data === "object" ? (data as { pool?: unknown; tiers?: unknown }) : {};
  const pool = Array.isArray(board.pool) ? board.pool : [];
  const tiers = Array.isArray(board.tiers) ? board.tiers : [];
  const tierKeys = tiers.flatMap((tier) => {
    const keys = tier && typeof tier === "object" ? (tier as { bookKeys?: unknown }).bookKeys : undefined;
    return Array.isArray(keys) ? keys : [];
  });
  return [...new Set([...pool, ...tierKeys].filter((key): key is string => typeof key === "string" && key !== ""))];
}
