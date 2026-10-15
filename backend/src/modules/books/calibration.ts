import type { BooksRepository } from "./domain/ports.js";
import { isFragment, SYNOPSIS_HIDE_BELOW, SYNOPSIS_REVIEW_BELOW } from "./domain/synopsis.js";
import { failureKind } from "./typesafe.js";

export const TASKS = ["synopses"] as const;
const IN_FLIGHT = 4;

export type SynopsisSampleItem = { hash: string; stratum: string; title: string; author: string; text: string };
export type SynopsisLabel = { hash: string; usable: boolean; kind: string };
export type SynopsisAnswerRow = { hash: string; usable: number; kind: string };

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function synopsisSample(repo: Pick<BooksRepository, "synopsisTexts">, n: number, random: () => number = Math.random): SynopsisSampleItem[] {
  const strata = new Map<string, SynopsisSampleItem[]>();
  for (const text of repo.synopsisTexts()) {
    const stratum = isFragment(text.text) ? "rule" : text.source;
    strata.set(stratum, [...(strata.get(stratum) ?? []), { hash: text.hash, stratum, title: text.title, author: text.author, text: text.text }]);
  }
  const quota = Math.ceil(n / Math.max(strata.size, 1));
  return [...strata.values()].flatMap((items) => shuffled(items, random).slice(0, quota));
}

export function scoreSynopses(sample: SynopsisSampleItem[], labels: SynopsisLabel[], answers: SynopsisAnswerRow[]): Array<{ decision: string; items: number; notUsable: number }> {
  const label = new Map(labels.map((entry) => [entry.hash, entry]));
  const answer = new Map(answers.map((entry) => [entry.hash, entry]));
  const labelled = sample.filter((item) => label.has(item.hash));
  const row = (decision: string, items: SynopsisSampleItem[]) => ({ decision, items: items.length, notUsable: items.filter((item) => label.get(item.hash)!.usable === false).length });
  const asked = labelled.filter((item) => item.stratum !== "rule" && answer.has(item.hash));
  const usable = (item: SynopsisSampleItem) => answer.get(item.hash)!.usable;
  return [
    row("rule", labelled.filter((item) => item.stratum === "rule")),
    row(`jev below ${SYNOPSIS_HIDE_BELOW}`, asked.filter((item) => usable(item) < SYNOPSIS_HIDE_BELOW)),
    row(`jev ${SYNOPSIS_HIDE_BELOW} to ${SYNOPSIS_REVIEW_BELOW}`, asked.filter((item) => usable(item) >= SYNOPSIS_HIDE_BELOW && usable(item) < SYNOPSIS_REVIEW_BELOW)),
    row(`jev ${SYNOPSIS_REVIEW_BELOW} and above`, asked.filter((item) => usable(item) >= SYNOPSIS_REVIEW_BELOW))
  ];
}

export async function answerEach<T, A>(items: T[], ask: (item: T) => Promise<A>): Promise<{ answers: A[]; skipped: number }> {
  const answers: A[] = [];
  let skipped = 0;
  let next = 0;
  await Promise.all(Array.from({ length: IN_FLIGHT }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        answers.push(await ask(item));
      } catch (error) {
        if (failureKind(error) !== "book") throw error;
        skipped += 1;
      }
    }
  }));
  return { answers, skipped };
}
