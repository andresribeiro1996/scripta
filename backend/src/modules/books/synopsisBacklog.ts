import type { BooksRepository } from "./domain/ports.js";
import { isFragment, isHiddenSynopsis, SYNOPSIS_REVIEW_BELOW } from "./domain/synopsis.js";
import { jevCostUsd, JEV_REJECTION_LIMIT, runJevBacklog, type JevStop } from "./jevJobs.js";
import { applySynopsisRule, classifyText, type SynopsisJudgmentDeps } from "./synopsisJudgments.js";

export const SYNOPSIS_BACKLOG_SOURCE = "synopses-backlog";

export type BacklogText = { hash: string; source: string };
export type SynopsisBacklogStop = JevStop;
export type SourceCounts = { texts: number; rule: number; hidden: number; doubtful: number; shown: number };
export type SynopsisBacklogReport = { selected: number; bySource: Record<string, SourceCounts>; strikes: number; stoppedBy: SynopsisBacklogStop | "no-key"; requests: number; estimatedCostUsd: number };

export function synopsisBacklogTexts(repo: Pick<BooksRepository, "canonicalWorkIds" | "synopsisBacklog">, heldWorkIds: string[]): BacklogText[] {
  const held = new Set(repo.canonicalWorkIds(heldWorkIds).values());
  const texts = new Map<string, { source: string; held: boolean }>();
  for (const row of repo.synopsisBacklog(JEV_REJECTION_LIMIT)) {
    const isHeld = row.workId !== null && held.has(row.workId);
    const seen = texts.get(row.hash);
    if (seen) seen.held ||= isHeld;
    else texts.set(row.hash, { source: row.source ?? "unknown", held: isHeld });
  }
  const all = [...texts].map(([hash, text]) => ({ hash, source: text.source, held: text.held }));
  return [...all.filter((text) => text.held), ...all.filter((text) => !text.held)].map(({ hash, source }) => ({ hash, source }));
}

export function synopsisDryRun(repo: Pick<BooksRepository, "synopsisText">, texts: BacklogText[], max: number) {
  const bySource: Record<string, { texts: number; rule: number }> = {};
  let byRule = 0;
  for (const text of texts) {
    const counts = (bySource[text.source] ??= { texts: 0, rule: 0 });
    counts.texts += 1;
    const carrier = repo.synopsisText(text.hash);
    if (carrier && isFragment(carrier.text)) {
      counts.rule += 1;
      byRule += 1;
    }
  }
  return { selected: texts.length, byRule, wouldAsk: Math.min(texts.length - byRule, max), max, bySource };
}

export function applyRulePass(repo: Pick<BooksRepository, "synopsisText" | "saveSynopsisJudgment">, texts: BacklogText[], at: string): BacklogText[] {
  return texts.filter((text) => !applySynopsisRule(repo, text.hash, at));
}

export function runSynopsisBacklog(deps: SynopsisJudgmentDeps, hashes: string[]): Promise<{ asked: string[]; stoppedBy: SynopsisBacklogStop }> {
  return runJevBacklog(hashes, (hash, onPause) => classifyText({ ...deps, onPause }, hash));
}

export function synopsisBacklogReport(repo: Pick<BooksRepository, "synopsisJudgments" | "jevRejections">, texts: BacklogText[], stoppedBy: SynopsisBacklogStop | "no-key", requests: number): SynopsisBacklogReport {
  const hashes = texts.map((text) => text.hash);
  const judgments = repo.synopsisJudgments(hashes);
  const bySource: Record<string, SourceCounts> = {};
  for (const text of texts) {
    const counts = (bySource[text.source] ??= { texts: 0, rule: 0, hidden: 0, doubtful: 0, shown: 0 });
    counts.texts += 1;
    const judgment = judgments.get(text.hash);
    if (!judgment) continue;
    if (judgment.model === "rule") counts.rule += 1;
    else if (isHiddenSynopsis(judgment)) counts.hidden += 1;
    else if (judgment.usable < SYNOPSIS_REVIEW_BELOW) counts.doubtful += 1;
    else counts.shown += 1;
  }
  return { selected: texts.length, bySource, strikes: repo.jevRejections("synopses", hashes).size, stoppedBy, requests, estimatedCostUsd: jevCostUsd(requests) };
}
