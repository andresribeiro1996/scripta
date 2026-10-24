import { planDuplicateSets } from "./domain/duplicateWorks.js";
import { WorkMergeError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";

const DEFAULT_PAGE_SIZE = 500;

export interface DuplicateDeps {
  repo: Pick<BooksRepository, "keyedWorksWithTitleKeys" | "groupableTitleKeys" | "isSeriesName" | "undoneMergeAmong" | "mergeDuplicateWork">;
  sharesArena: (from: string, into: string) => boolean;
  now: () => number;
}

export interface DuplicateMerge {
  titleKey: string;
  from: string;
  into: string;
}

export interface DuplicateReport {
  merges: DuplicateMerge[];
  seriesName: number;
  crowded: number;
  undone: number;
  arena: number;
  gone: number;
}

export function mergeDuplicateWorks(deps: DuplicateDeps, titleKeys: string[], dryRun = false): DuplicateReport {
  const plan = planDuplicateSets(deps.repo.keyedWorksWithTitleKeys(titleKeys), (title) => deps.repo.isSeriesName(title));
  const report: DuplicateReport = { merges: [], seriesName: plan.seriesName, crowded: plan.crowded, undone: 0, arena: 0, gone: 0 };
  for (const set of plan.sets) {
    if (deps.repo.undoneMergeAmong([set.into, ...set.from])) {
      report.undone += 1;
      continue;
    }
    for (const from of set.from) {
      if (deps.sharesArena(from, set.into)) {
        report.arena += 1;
        continue;
      }
      if (!dryRun) {
        try {
          deps.repo.mergeDuplicateWork(from, set.into, new Date(deps.now()).toISOString());
        } catch (error) {
          if (!(error instanceof WorkMergeError)) throw error;
          report.gone += 1;
          continue;
        }
      }
      report.merges.push({ titleKey: set.titleKey, from, into: set.into });
    }
  }
  return report;
}

export async function walkDuplicateWorks(deps: DuplicateDeps, options: { dryRun: boolean; signal?: AbortSignal; pageSize?: number; pauseMs?: number }): Promise<DuplicateReport> {
  const { dryRun, signal, pageSize = DEFAULT_PAGE_SIZE, pauseMs = 0 } = options;
  const total: DuplicateReport = { merges: [], seriesName: 0, crowded: 0, undone: 0, arena: 0, gone: 0 };
  let after = "";
  while (!signal?.aborted) {
    const keys = deps.repo.groupableTitleKeys(after, pageSize);
    if (keys.length === 0) break;
    await new Promise(setImmediate);
    if (signal?.aborted) break;
    const page = mergeDuplicateWorks(deps, keys, dryRun);
    total.merges.push(...page.merges);
    total.seriesName += page.seriesName;
    total.crowded += page.crowded;
    total.undone += page.undone;
    total.arena += page.arena;
    total.gone += page.gone;
    if (keys.length < pageSize) break;
    after = keys[keys.length - 1]!;
    await new Promise(setImmediate);
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return total;
}

export async function groupKeylessWorks(
  repo: Pick<BooksRepository, "groupableTitleKeys" | "groupTitleKeys">,
  limit: number,
  options: { at?: string; skip?: (from: string, into: string) => boolean; signal?: AbortSignal; pageSize?: number } = {}
): Promise<number> {
  const { at = new Date().toISOString(), skip, signal, pageSize = limit } = options;
  let merged = 0;
  let after = "";
  while (merged < limit && !signal?.aborted) {
    const keys = repo.groupableTitleKeys(after, pageSize);
    if (keys.length === 0) break;
    await new Promise(setImmediate);
    if (signal?.aborted) break;
    merged += repo.groupTitleKeys(keys, limit - merged, at, skip);
    if (keys.length < pageSize) break;
    after = keys[keys.length - 1]!;
    await new Promise(setImmediate);
  }
  return merged;
}
