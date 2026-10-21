import type { DatabaseSync } from "node:sqlite";
import { cleanSummary } from "@scripta/shared";
import { isFragment, summaryHashOf, SYNOPSIS_HIDE_BELOW, type SynopsisJudgment } from "../domain/synopsis.js";
import { originalKey, originalTitleIn } from "../domain/translation.js";

export interface SummaryChange {
  table: "books" | "works";
  id: string;
  source: string | null;
  host: string | null;
  from: string;
  to: string | null;
  oldHash: string | null;
  newHash: string | null;
  originalTitle: string | null;
}

export type JudgmentOutcome = "carried" | "manual-replaced" | "rule" | "jev-hide-dropped" | "kept" | "unjudged";
export interface JudgmentAction {
  hash: string;
  outcome: JudgmentOutcome;
  write: SynopsisJudgment | null;
}

export interface SummaryCleanupPlan {
  scanned: { books: number; works: number };
  changes: SummaryChange[];
  judgments: JudgmentAction[];
}

export interface SummaryCleanupApplied {
  books: number;
  works: number;
  emptied: number;
  skipped: number;
  originalTitles: number;
  judgmentsWritten: number;
}

interface BookScan {
  id: string;
  summary: string;
  summary_hash: string | null;
  summary_source: string | null;
  original_title: string | null;
  url: string | null;
}

interface WorkScan {
  id: string;
  summary: string;
  summary_hash: string | null;
}

interface JudgmentRow {
  text_hash: string;
  model: string;
  usable: number;
  kind: SynopsisJudgment["kind"];
  asked_at: string;
}

const BATCH = 500;
const SAMPLES = 3;
const SAMPLE_LENGTH = 300;

const hostOf = (url: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
};

const toJudgment = (row: JudgmentRow): SynopsisJudgment => ({ model: row.model, usable: row.usable, kind: row.kind, askedAt: row.asked_at });
const isJevHide = (judgment: SynopsisJudgment) => judgment.model !== "manual" && judgment.model !== "rule" && judgment.usable < SYNOPSIS_HIDE_BELOW;

function chooseJudgment(candidates: SynopsisJudgment[]): SynopsisJudgment | null {
  if (candidates.length === 0) return null;
  const rank = (judgment: SynopsisJudgment) => (judgment.model === "manual" ? 2 : judgment.model === "rule" ? 1 : 0);
  return candidates.reduce((best, next) => (rank(next) !== rank(best) ? (rank(next) > rank(best) ? next : best) : next.askedAt > best.askedAt ? next : best));
}

function judgmentsOf(db: DatabaseSync, hashes: string[]): Map<string, SynopsisJudgment> {
  const rows = db.prepare("SELECT text_hash, model, usable, kind, asked_at FROM synopsis_judgments WHERE text_hash IN (SELECT value FROM json_each(?))").all(JSON.stringify(hashes)) as unknown as JudgmentRow[];
  return new Map(rows.map((row) => [row.text_hash, toJudgment(row)]));
}

function decide(chosen: SynopsisJudgment | null, existing: SynopsisJudgment | undefined, text: string, newHash: string): JudgmentAction {
  const manual = chosen?.model === "manual";
  if (existing) {
    if (manual && existing.model !== "manual") return { hash: newHash, outcome: "manual-replaced", write: chosen };
    return { hash: newHash, outcome: "kept", write: null };
  }
  if (isFragment(text) && !manual) return { hash: newHash, outcome: "rule", write: { model: "rule", usable: 0, kind: "fragment", askedAt: new Date().toISOString() } };
  if (chosen && isJevHide(chosen)) return { hash: newHash, outcome: "jev-hide-dropped", write: null };
  return chosen ? { hash: newHash, outcome: "carried", write: chosen } : { hash: newHash, outcome: "unjudged", write: null };
}

export function planSummaryCleanup(db: DatabaseSync): SummaryCleanupPlan {
  const plan: SummaryCleanupPlan = { scanned: { books: 0, works: 0 }, changes: [], judgments: [] };
  const change = (table: "books" | "works", row: WorkScan, extra: Pick<SummaryChange, "source" | "host" | "originalTitle">) => {
    const to = cleanSummary(row.summary);
    if (to === row.summary) return;
    plan.changes.push({ table, id: row.id, from: row.summary, to, oldHash: row.summary_hash ?? summaryHashOf(row.summary), newHash: summaryHashOf(to), ...extra });
  };
  for (const row of db.prepare("SELECT id, summary, summary_hash, summary_source, original_title, coalesce(publisher_url, source_url) AS url FROM books WHERE summary IS NOT NULL AND summary <> ''").iterate() as unknown as Iterable<BookScan>) {
    plan.scanned.books++;
    change("books", row, { source: row.summary_source, host: hostOf(row.url), originalTitle: row.original_title === null ? originalTitleIn(row.summary) : null });
  }
  for (const row of db.prepare("SELECT id, summary, summary_hash FROM works WHERE summary IS NOT NULL AND summary <> ''").iterate() as unknown as Iterable<WorkScan>) {
    plan.scanned.works++;
    change("works", row, { source: null, host: null, originalTitle: null });
  }

  const groups = new Map<string, { text: string; oldHashes: Set<string> }>();
  for (const { oldHash, newHash, to } of plan.changes) {
    if (newHash === null || newHash === oldHash || to === null) continue;
    const group = groups.get(newHash) ?? { text: to, oldHashes: new Set<string>() };
    if (oldHash !== null) group.oldHashes.add(oldHash);
    groups.set(newHash, group);
  }
  const wanted = [...new Set([...groups.keys(), ...[...groups.values()].flatMap((group) => [...group.oldHashes])])];
  const known = wanted.length === 0 ? new Map<string, SynopsisJudgment>() : judgmentsOf(db, wanted);
  for (const [newHash, group] of groups) {
    const chosen = chooseJudgment([...group.oldHashes].flatMap((hash) => known.get(hash) ?? []));
    plan.judgments.push(decide(chosen, known.get(newHash), group.text, newHash));
  }
  return plan;
}

export function applySummaryCleanup(db: DatabaseSync, plan: SummaryCleanupPlan): SummaryCleanupApplied {
  const applied: SummaryCleanupApplied = { books: 0, works: 0, emptied: 0, skipped: 0, originalTitles: 0, judgmentsWritten: 0 };
  const saveJudgment = db.prepare("INSERT OR IGNORE INTO synopsis_judgments (text_hash, model, usable, kind, asked_at) VALUES (?, ?, ?, ?, ?)");
  const replaceJudgment = db.prepare("INSERT INTO synopsis_judgments (text_hash, model, usable, kind, asked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(text_hash) DO UPDATE SET model = excluded.model, usable = excluded.usable, kind = excluded.kind, asked_at = excluded.asked_at WHERE synopsis_judgments.model <> 'manual'");
  const updateBook = db.prepare("UPDATE books SET summary = ?, summary_hash = ?, summary_source = CASE WHEN ? IS NULL THEN NULL ELSE summary_source END, original_title = COALESCE(original_title, ?), original_key = CASE WHEN original_title IS NULL THEN ? ELSE original_key END WHERE id = ? AND summary = ?");
  const updateWork = db.prepare("UPDATE works SET summary = ?, summary_hash = ? WHERE id = ? AND summary = ?");

  const inTransaction = (work: () => void) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      work();
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  };

  inTransaction(() => {
    for (const { hash, outcome, write } of plan.judgments) {
      if (!write) continue;
      const statement = outcome === "manual-replaced" ? replaceJudgment : saveJudgment;
      if (statement.run(hash, write.model, write.usable, write.kind, write.askedAt).changes > 0) applied.judgmentsWritten++;
    }
  });

  for (let start = 0; start < plan.changes.length; start += BATCH) {
    const batch = plan.changes.slice(start, start + BATCH);
    const counts = { books: 0, works: 0, emptied: 0, skipped: 0, originalTitles: 0 };
    inTransaction(() => {
      for (const change of batch) {
        const changed =
          change.table === "books"
            ? updateBook.run(change.to, change.newHash, change.to, change.originalTitle, change.originalTitle === null ? null : originalKey(change.originalTitle), change.id, change.from).changes
            : updateWork.run(change.to, change.newHash, change.id, change.from).changes;
        if (changed === 0) {
          counts.skipped++;
          continue;
        }
        counts[change.table]++;
        if (change.to === null) counts.emptied++;
        if (change.originalTitle !== null) counts.originalTitles++;
      }
    });
    for (const key of Object.keys(counts) as Array<keyof typeof counts>) applied[key] += counts[key];
  }
  return applied;
}

const tally = (values: Array<string | null>) => {
  const counts: Record<string, number> = {};
  for (const value of values) if (value !== null) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

export function summaryCleanupReport(plan: SummaryCleanupPlan, applied: SummaryCleanupApplied | null, dryRun: boolean) {
  const countsFor = (table: "books" | "works") => {
    const changes = plan.changes.filter((change) => change.table === table);
    return { scanned: plan.scanned[table], changed: changes.length, emptied: changes.filter((change) => change.to === null).length };
  };
  const samples: Record<string, Array<{ table: string; id: string; from: string; to: string | null }>> = {};
  for (const change of plan.changes) {
    const key = change.host ?? change.source ?? change.table;
    const list = (samples[key] ??= []);
    if (list.length < SAMPLES) list.push({ table: change.table, id: change.id, from: change.from.slice(0, SAMPLE_LENGTH), to: change.to === null ? null : change.to.slice(0, SAMPLE_LENGTH) });
  }
  return {
    dryRun,
    books: countsFor("books"),
    works: countsFor("works"),
    bySource: tally(plan.changes.map((change) => change.source ?? change.table)),
    byHost: tally(plan.changes.map((change) => change.host)),
    judgments: tally(plan.judgments.map((judgment) => judgment.outcome)),
    samples,
    applied,
    ...(dryRun ? {} : { originals: plan.changes.map((change) => ({ table: change.table, id: change.id, summary: change.from })) })
  };
}
