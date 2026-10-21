import { planDuplicateSets } from "./domain/duplicateWorks.js";
import { WorkMergeError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";

const DEFAULT_PAGE_SIZE = 500;

export interface DuplicateDeps {
  repo: Pick<BooksRepository, "keyedWorksWithTitleKeys" | "groupableTitleKeys" | "undoneMergeAmong" | "mergeDuplicateWork">;
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
  undone: number;
  arena: number;
  gone: number;
}

export function mergeDuplicateWorks(deps: DuplicateDeps, titleKeys: string[], dryRun = false): DuplicateReport {
  const report: DuplicateReport = { merges: [], undone: 0, arena: 0, gone: 0 };
  for (const set of planDuplicateSets(deps.repo.keyedWorksWithTitleKeys(titleKeys))) {
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
  const total: DuplicateReport = { merges: [], undone: 0, arena: 0, gone: 0 };
  let after = "";
  while (!signal?.aborted) {
    const keys = deps.repo.groupableTitleKeys(after, pageSize);
    if (keys.length === 0) break;
    const page = mergeDuplicateWorks(deps, keys, dryRun);
    total.merges.push(...page.merges);
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
