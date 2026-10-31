import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import type { WorkAward } from "./types.js";

type Prize = { honours: "work" | "author" };

const prizes = {
  booker: { honours: "work" },
  "international-booker": { honours: "work" },
  "hugo-novel": { honours: "work" },
  "nebula-novel": { honours: "work" },
  "pulitzer-fiction": { honours: "work" },
  "nobel-literature": { honours: "author" },
  camoes: { honours: "author" },
  leya: { honours: "work" },
  saramago: { honours: "work" },
  "ape-novel": { honours: "work" }
} satisfies Record<string, Prize>;

const TRANSLATED_NAMES = {
  booker: "shared.awards.booker",
  "international-booker": "shared.awards.internationalBooker",
  "hugo-novel": "shared.awards.hugo",
  "nebula-novel": "shared.awards.nebula",
  "pulitzer-fiction": "shared.awards.pulitzer",
  "nobel-literature": "shared.awards.nobel"
} as const;

const PORTUGUESE_NAMES = {
  camoes: "Prémio Camões",
  leya: "Prémio LeYa",
  saramago: "Prémio José Saramago",
  "ape-novel": "Grande Prémio de Romance e Novela APE"
} as const;

export type PrizeKey = keyof typeof prizes;

export const PRIZES: Record<PrizeKey, Prize> = prizes;

export function isPrizeKey(value: string): value is PrizeKey {
  return Object.hasOwn(PRIZES, value);
}

export function prizeLabel(prize: PrizeKey, locale: Locale): string {
  return prize in TRANSLATED_NAMES ? sharedT(locale)(TRANSLATED_NAMES[prize as keyof typeof TRANSLATED_NAMES]) : PORTUGUESE_NAMES[prize as keyof typeof PORTUGUESE_NAMES];
}

export function awardLabel(award: WorkAward & { prize: PrizeKey }, locale: Locale): string {
  const label = `${prizeLabel(award.prize, locale)} ${award.year}`;
  return award.won ? label : sharedT(locale)("shared.awards.nominee", { label });
}

export function knownAwards(awards: WorkAward[] | undefined): Array<WorkAward & { prize: PrizeKey }> {
  return (awards ?? [])
    .filter((award): award is WorkAward & { prize: PrizeKey } => isPrizeKey(award.prize))
    .sort((a, b) => Number(b.won) - Number(a.won) || b.year - a.year);
}
