import type { WorkAward } from "./types.js";

type Prize = { label: string; honours: "work" | "author" };

const prizes = {
  booker: { label: "Booker Prize", honours: "work" },
  "international-booker": { label: "International Booker Prize", honours: "work" },
  "hugo-novel": { label: "Hugo Award", honours: "work" },
  "nebula-novel": { label: "Nebula Award", honours: "work" },
  "pulitzer-fiction": { label: "Pulitzer Prize for Fiction", honours: "work" },
  "nobel-literature": { label: "Nobel Prize in Literature", honours: "author" },
  camoes: { label: "Prémio Camões", honours: "author" },
  leya: { label: "Prémio LeYa", honours: "work" },
  saramago: { label: "Prémio José Saramago", honours: "work" },
  "ape-novel": { label: "Grande Prémio de Romance e Novela APE", honours: "work" }
} satisfies Record<string, Prize>;

export type PrizeKey = keyof typeof prizes;

export const PRIZES: Record<PrizeKey, Prize> = prizes;

export function isPrizeKey(value: string): value is PrizeKey {
  return Object.hasOwn(PRIZES, value);
}

export function awardLabel(award: WorkAward & { prize: PrizeKey }): string {
  const label = `${PRIZES[award.prize].label} ${award.year}`;
  return award.won ? label : `${label} · nominee`;
}

export function knownAwards(awards: WorkAward[] | undefined): Array<WorkAward & { prize: PrizeKey }> {
  return (awards ?? [])
    .filter((award): award is WorkAward & { prize: PrizeKey } => isPrizeKey(award.prize))
    .sort((a, b) => Number(b.won) - Number(a.won) || b.year - a.year);
}
