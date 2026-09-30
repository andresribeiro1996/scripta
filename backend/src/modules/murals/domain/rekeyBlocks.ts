import { rekeyKeys, rekeyTierBoard } from "@scripta/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rekeyQuotes(quotes: unknown[], from: ReadonlySet<string>, to: string): unknown[] {
  const seen = new Set<string>();
  return quotes.flatMap((quote) => {
    if (!isRecord(quote)) return [quote];
    const next = typeof quote.bookKey === "string" && from.has(quote.bookKey) ? { ...quote, bookKey: to } : quote;
    const id = `${String(next.bookKey)}\u0000${String(next.highlightId)}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [next];
  });
}

export function rekeyBlocks(blocks: unknown, from: ReadonlySet<string>, to: string): unknown {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((block) => {
    if (!isRecord(block)) return block;
    let next: Record<string, unknown> = block;
    if (typeof next.bookKey === "string" && from.has(next.bookKey)) next = { ...next, bookKey: to };
    if (Array.isArray(next.bookKeys)) next = { ...next, bookKeys: rekeyKeys(next.bookKeys as string[], from, to) };
    if (Array.isArray(next.quotes)) next = { ...next, quotes: rekeyQuotes(next.quotes, from, to) };
    if (Array.isArray(next.tiers) || Array.isArray(next.pool)) next = rekeyTierBoard(next, from, to);
    return next;
  });
}
