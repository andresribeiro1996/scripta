import { firstAuthor, normalizeWords } from "@scripta/shared";
import { workTitleKey } from "./normalize.js";

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
  "vv aa"
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

export interface KeyWork {
  titleKey: string;
  workId: string;
  title: string;
  keyed: boolean;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function survivorFirst(a: KeyedWork, b: KeyedWork): number {
  return b.editions - a.editions || compare(a.createdAt, b.createdAt) || compare(a.id, b.id);
}

function mergeable(work: KeyedWork): boolean {
  const author = firstAuthor(work.author);
  return author !== "" && !PLACEHOLDER_AUTHORS.has(author) && workTitleKey(work.title, work.author) === work.titleKey;
}

export function planDuplicateSets(works: KeyedWork[]): DuplicateSet[] {
  const seen = new Set<string>();
  const groups = new Map<string, KeyedWork[]>();
  for (const work of works) {
    if (seen.has(work.id) || !mergeable(work)) continue;
    seen.add(work.id);
    const groupKey = `${work.titleKey}\n${normalizeWords(work.title)}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), work]);
  }
  const sets: DuplicateSet[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [survivor, ...rest] = [...group].sort(survivorFirst);
    sets.push({ titleKey: survivor!.titleKey, into: survivor!.id, from: rest.map((work) => work.id) });
  }
  return sets;
}

export function planCrowdedFolds(works: KeyWork[]): Array<{ source: string; target: string }> {
  const byKey = new Map<string, KeyWork[]>();
  for (const work of works) byKey.set(work.titleKey, [...(byKey.get(work.titleKey) ?? []), work]);
  const folds: Array<{ source: string; target: string }> = [];
  for (const group of byKey.values()) {
    const keyed = group.filter((work) => work.keyed);
    for (const keyless of group.filter((work) => !work.keyed)) {
      const fullTitle = normalizeWords(keyless.title);
      const matches = keyed.filter((work) => normalizeWords(work.title) === fullTitle);
      if (matches.length === 1) folds.push({ source: keyless.workId, target: matches[0]!.workId });
    }
  }
  return folds;
}
