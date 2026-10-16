import { createHash } from "node:crypto";

export const SYNOPSIS_HIDE_BELOW = 0.15;
export const SYNOPSIS_REVIEW_BELOW = 0.5;
export const SYNOPSIS_MIN_LETTERS = 40;
export const SYNOPSIS_KINDS = ["synopsis", "author_bio", "praise", "collection", "product", "contents", "other_book", "fragment"] as const;

export type SynopsisKind = (typeof SYNOPSIS_KINDS)[number];
export type SynopsisJudgment = { model: string; usable: number; kind: SynopsisKind; askedAt: string };

export function summaryHashOf(text: string | null): string | null {
  const normalized = (text ?? "").trim().replace(/\s+/g, " ");
  return normalized === "" ? null : createHash("sha1").update(normalized).digest("hex");
}

export function isFragment(text: string): boolean {
  return (text.match(/\p{L}/gu)?.length ?? 0) < SYNOPSIS_MIN_LETTERS;
}

export function isHiddenSynopsis(judgment: Pick<SynopsisJudgment, "model" | "usable"> | undefined): boolean {
  if (!judgment) return false;
  if (judgment.model === "rule") return true;
  if (judgment.model === "manual") return judgment.usable === 0;
  return judgment.usable < SYNOPSIS_HIDE_BELOW;
}

export function hiddenSynopsisHashes(source: { synopsisJudgments(hashes: string[]): Map<string, SynopsisJudgment> }, hashes: Array<string | null>): Set<string> {
  const wanted = [...new Set(hashes.filter((hash): hash is string => hash !== null))];
  if (wanted.length === 0) return new Set();
  const judgments = source.synopsisJudgments(wanted);
  return new Set(wanted.filter((hash) => isHiddenSynopsis(judgments.get(hash))));
}
