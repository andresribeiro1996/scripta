import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { catalogHits } from "../../src/modules/books/catalogSearch.js";
import { searchTokens } from "../../src/modules/books/domain/normalize.js";
import { scoreQueries, type Grade } from "../../src/modules/books/scorecard.js";
import grades from "./grades.json" with { type: "json" };
import queries from "./queries.json" with { type: "json" };
import { readonlyRepo } from "./readonlyRepo.js";

const { values } = parseArgs({ options: { set: { type: "string", default: "tune" }, wikipedia: { type: "string" } } });
if (!["tune", "hidden", "all"].includes(values.set!)) {
  console.error("Usage: score.mjs [--set tune|hidden|all] [--wikipedia <sites.json>]");
  process.exit(1);
}
const chosen = queries.filter(({ hidden }) => values.set === "all" || hidden === (values.set === "hidden"));
const { db, repo: live } = readonlyRepo();
const sites: Record<string, number> = values.wikipedia ? JSON.parse(readFileSync(values.wikipedia, "utf8")) : {};
const keysOf = db.prepare("SELECT id AS root, ol_work_key AS key FROM works WHERE id IN (SELECT value FROM json_each(?1)) AND ol_work_key IS NOT NULL UNION ALL SELECT merged_into AS root, ol_work_key AS key FROM works WHERE merged_into IN (SELECT value FROM json_each(?1)) AND ol_work_key IS NOT NULL");
const repo = values.wikipedia
  ? {
      ...live,
      workSignals(workIds: string[]) {
        const signals = live.workSignals(workIds);
        for (const { root, key } of keysOf.all(JSON.stringify(workIds)) as Array<{ root: string; key: string }>) {
          const count = sites[key];
          const entry = signals.get(root);
          if (count === undefined || !entry) continue;
          entry.wikipediaSites = Math.max(entry.wikipediaSites ?? 0, count);
        }
        return signals;
      }
    }
  : live;
const ranked = new Map<string, string[]>();
const timings: number[] = [];
for (const { q } of chosen) {
  const started = performance.now();
  const hits = catalogHits(repo, searchTokens(q), true);
  timings.push(performance.now() - started);
  ranked.set(q, [...new Set(hits.flatMap(({ workId }) => (workId ? [workId] : [])))]);
}
const { perQuery, tune, hidden } = scoreQueries(chosen, ranked, new Map(Object.entries(grades as Record<string, Grade[]>)));
for (const row of perQuery) console.log(`${row.ndcg.toFixed(3)}\t${row.unlabelled.length}\t${row.hidden ? "hidden" : "tune"}\t${row.q}`);
const sorted = [...timings].sort((a, b) => a - b);
const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!.toFixed(1);
console.log(`tune ${tune.toFixed(4)}  hidden ${hidden.toFixed(4)}  p50 ${at(0.5)} ms  p95 ${at(0.95)} ms  queries ${chosen.length}`);
const topUp = Object.fromEntries(perQuery.filter(({ unlabelled }) => unlabelled.length > 0).map(({ q, unlabelled }) => [q, repo.matchCandidates(unlabelled).map(({ id, title, author, year }) => ({ workId: id, title, author, year }))]));
console.error(`TOPUP ${JSON.stringify(topUp)}`);
