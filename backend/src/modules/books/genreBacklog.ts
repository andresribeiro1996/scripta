import type { BooksRepository } from "./domain/ports.js";
import { classifyWork, GENRE_REJECTION_LIMIT, GENRE_SAVE_LINE, type GenreJudgmentDeps } from "./genreJudgments.js";
import { jevCostUsd, runJevBacklog, type JevStop } from "./jevJobs.js";
import { CONFIDENT_GENRE_LINE } from "./works.js";

export const GENRE_BACKLOG_SOURCE = "genres-backlog";
export const BACKLOG_MIN_SYNOPSIS = 40;

export type BacklogStop = JevStop;
export type BacklogResult = { asked: string[]; stoppedBy: BacklogStop };
export type BacklogReport = { selected: number; asked: number; confident: number; possible: number; unsure: number; none: number; strikes: number; stoppedBy: BacklogStop; requests: number; estimatedCostUsd: number };

export function backlogWorkIds(repo: Pick<BooksRepository, "canonicalWorkIds" | "genreBacklogWorks">, heldWorkIds: string[], max: number): string[] {
  const held = new Set(repo.canonicalWorkIds(heldWorkIds).values());
  const candidates = repo.genreBacklogWorks(Number.MAX_SAFE_INTEGER, BACKLOG_MIN_SYNOPSIS, GENRE_REJECTION_LIMIT);
  return [...candidates.filter((id) => held.has(id)), ...candidates.filter((id) => !held.has(id))].slice(0, max);
}

export function runGenreBacklog(deps: GenreJudgmentDeps, workIds: string[]): Promise<BacklogResult> {
  return runJevBacklog(workIds, (workId, onPause) => classifyWork({ ...deps, onPause }, workId));
}

export function backlogReport(repo: Pick<BooksRepository, "genreJudgments" | "genreRejections">, selected: number, result: BacklogResult, requests: number): BacklogReport {
  const report: BacklogReport = { selected, asked: result.asked.length, confident: 0, possible: 0, unsure: 0, none: 0, strikes: repo.genreRejections(result.asked).size, stoppedBy: result.stoppedBy, requests, estimatedCostUsd: jevCostUsd(requests) };
  for (const judgment of repo.genreJudgments(result.asked).values()) {
    if (judgment.genre === null) report.none += 1;
    else if (judgment.confidence >= CONFIDENT_GENRE_LINE) report.confident += 1;
    else if (judgment.confidence >= GENRE_SAVE_LINE) report.possible += 1;
    else report.unsure += 1;
  }
  return report;
}
