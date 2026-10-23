import { firstAuthor, normalizeWords } from "@scripta/shared";
import { workTitleKey } from "./normalize.js";
import { wholeTitle } from "./translation.js";

const PLACEHOLDER_AUTHORS = new Set([
  "anonymous",
  "anon",
  "anonimo",
  "unknown",
  "unknown author",
  "desconhecido",
  "desconocido",
  "inconnu",
  "autor desconhecido",
  "various",
  "various authors",
  "varios",
  "varios autores",
  "autores varios",
  "aa vv",
  "vv aa",
  "aavv",
  "vvaa",
  "diversos",
  "autor anonimo",
  "autor desconocido"
]);

export interface KeyedWork {
  titleKey: string;
  id: string;
  title: string;
  author: string;
  editions: number;
  createdAt: string;
}

export interface DuplicateSet {
  titleKey: string;
  into: string;
  from: string[];
}

export interface DuplicatePlan {
  sets: DuplicateSet[];
  seriesName: number;
  crowded: number;
}

export interface TitleWork {
  titleKey: string;
  workId: string;
  title: string;
  keyed: boolean;
  createdAt: string;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function survivorFirst(a: KeyedWork, b: KeyedWork): number {
  return b.editions - a.editions || compare(a.createdAt, b.createdAt) || compare(a.id, b.id);
}

function mergeable(work: KeyedWork): boolean {
  const author = firstAuthor(work.author);
  return work.titleKey !== "" && author !== "" && !PLACEHOLDER_AUTHORS.has(author) && workTitleKey(work.title, work.author) === work.titleKey;
}

export function planDuplicateSets(works: KeyedWork[], isSeriesName: (fullTitle: string) => boolean): DuplicatePlan {
  const seen = new Set<string>();
  const groups = new Map<string, KeyedWork[]>();
  for (const work of works) {
    if (seen.has(work.id) || !mergeable(work)) continue;
    seen.add(work.id);
    const groupKey = `${work.titleKey}\n${normalizeWords(work.title)}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), work]);
  }
  const plan: DuplicatePlan = { sets: [], seriesName: 0, crowded: 0 };
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (isSeriesName(normalizeWords(group[0]!.title))) {
      plan.seriesName += group.length - 1;
      continue;
    }
    if (group.length > 2) {
      plan.crowded += group.length - 1;
      continue;
    }
    const [survivor, ...rest] = [...group].sort(survivorFirst);
    plan.sets.push({ titleKey: survivor!.titleKey, into: survivor!.id, from: rest.map((work) => work.id) });
  }
  return plan;
}

function oldestFirst(a: TitleWork, b: TitleWork): number {
  return compare(a.createdAt, b.createdAt) || compare(a.workId, b.workId);
}

export function planTitleFolds(works: TitleWork[]): Array<{ source: string; target: string }> {
  const groups = new Map<string, TitleWork[]>();
  for (const work of works) {
    const whole = wholeTitle(work.title);
    if (work.titleKey === "" || whole === "") continue;
    const groupKey = `${work.titleKey}\n${whole}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), work]);
  }
  const folds: Array<{ work: TitleWork; target: string }> = [];
  for (const group of groups.values()) {
    const keyedIds = new Set(group.filter((work) => work.keyed).map((work) => work.workId));
    if (keyedIds.size > 1) continue;
    const keyless = group.filter((work) => !work.keyed).sort(oldestFirst);
    const target = [...keyedIds][0] ?? keyless.shift()?.workId;
    if (target === undefined) continue;
    for (const work of keyless) folds.push({ work, target });
  }
  return folds
    .sort((a, b) => compare(a.work.titleKey, b.work.titleKey) || oldestFirst(a.work, b.work))
    .map(({ work, target }) => ({ source: work.workId, target }));
}
