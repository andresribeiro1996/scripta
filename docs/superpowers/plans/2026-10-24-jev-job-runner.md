# Jev Job Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Genre, synopsis and translation judgments share one failure ladder, one live-jobs runner and one backlog runner in `backend/src/modules/books/jevJobs.ts`.

**Architecture:** `jevJobs.ts` is written and tested first against a fake repo and fake judges. Then each family moves onto it in its own task, deleting its copies and the tests that now duplicate `jevJobs.test.ts`. Family files keep their exported names (`classifyWork`, `judgeWork`, `startGenreJobs`, `runGenreBacklog`, …) so `plugin.ts` and the backlog scripts don't change.

**Tech Stack:** TypeScript, Fastify backend, `node:sqlite`, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-24-jev-job-runner-design.md`

## Global Constraints

- Pause lengths: outage `10 * 60 * 1000` ms; rejected key `24 * 60 * 60 * 1000` ms with one alert per 24 hours; spent budget until `nextUtcMidnight(now)` from `./typesafe.js`. Held cache `60 * 1000` ms. Sweep every `24 * 60 * 60 * 1000` ms, up to `1000` works. `4` in flight. Cost `0.00012` USD per request, rounded to cents.
- Alert copy, budget-spent messages, sources (`"genres"`, `"synopses"`, `"works"`) and strike stores stay exactly as today.
- `plugin.ts`, `backend/scripts/*.mjs` and every exported name the scripts import (listed in Task 4) keep working unchanged.
- `GENRE_REJECTION_LIMIT` stays in `genreJudgments.ts`. No migration, no production write.
- New test file `src/modules/books/jevJobs.test.ts` goes into the explicit list in `backend/package.json`'s `test` script.
- No comments in code. Verify each task with `node scripts/gate.mjs` before committing.

## Review Focus

- **Four workers hitting a 401 at once** send one alert, in every family. Task 1 tests it once, on the runner.
- **A spent budget hit by every worker** logs one info line until the reset, never an alert. Task 1.
- **A concurrent item failing while another pauses** must not change the stop reason. Task 1 (`runJevBacklog`).
- **A synopsis work with several texts** stops at the first pause and resumes there. Task 3 keeps the existing test.
- **A held alias id** is judged under its canonical work. The canonical lookup stays in each family's `judge*` function; Task 1 checks `held()` holds canonical ids, and the family tests that cover aliases ("a held alias id is judged as its canonical work", "a merged work id is judged as its canonical work") stay.

---

### Task 1: `jevJobs.ts`

**Files:**
- Create: `backend/src/modules/books/jevJobs.ts`
- Test: `backend/src/modules/books/jevJobs.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces:
  ```ts
  export const JEV_IN_FLIGHT = 4;
  export const JEV_REJECTION_LIMIT = 3;
  export const JEV_SWEEP_LIMIT = 1000;
  export type JevStop = "done" | "budget" | "outage" | "key";
  export type JevPauseKind = Exclude<JevStop, "done">;
  export type JevPauseDeps = { now: () => number; alert: (subject: string, text: string) => void; onPause?: (kind: JevPauseKind, until: number) => void };
  export type JevKeyAlert = { subject: string; text: string };
  export type JevStrike = { status: number | null; reason: string };
  export function jevCostUsd(requests: number): number;
  export function heldCanonical(repo: Pick<BooksRepository, "canonicalWorkIds">, heldWorkIds: string[]): Set<string>;
  export function jevPause(error: unknown, deps: JevPauseDeps, keyAlert: JevKeyAlert, strike: (strike: JevStrike) => void): number | null;
  export function runJevBacklog(items: string[], judgeOne: (item: string, onPause: (kind: JevPauseKind, until: number) => void) => Promise<number | null>): Promise<{ asked: string[]; stoppedBy: JevStop }>;
  export type JevJobs = { add(workId: string): void; stop(): void };
  export type JevJobsDeps = { repo: Pick<BooksRepository, "canonicalWorkIds">; heldWorkIds: () => string[]; now: () => number; alert: (subject: string, text: string) => void; info: (details: Record<string, unknown>, message: string) => void; onError: (error: unknown, workId?: string) => void; timers?: Parameters<typeof startDetailsBackfill>[3]; initialDelayMs?: number };
  export type JevJob = { source: string; budgetMessage: string; sweep: (heldWorkIds: string[]) => string[]; judge: (workId: string, held: () => Set<string>, pause: JevPauseDeps) => Promise<number | null> };
  export function startJevJobs(deps: JevJobsDeps, job: JevJob): JevJobs;
  ```
- Rules:
  - `jevPause`: `failureKind(error)` — `"book"` calls `strike(strikeReason(error))` and returns `null`; `"budget"`, `"outage"`, `"key"` compute `until` as in Global Constraints, call `deps.onPause?.(kind, until)`, and return `until`; `"key"` also calls `deps.alert(keyAlert.subject, keyAlert.text)` first; `null` rethrows `error`.
  - `startJevJobs`: a `createWorkQueue` of `JEV_IN_FLIGHT` whose `run` is `job.judge(workId, held, pause)`; `held()` returns `heldCanonical(repo, heldWorkIds())` cached for 60 s; `pause.alert` drops any alert within 24 h of the last one sent; `pause.onPause` on `"budget"` logs `deps.info({ source: job.source, until: <ISO> }, job.budgetMessage)` once until `until` passes; a `startDetailsBackfill(run, (error) => deps.onError(error), 24 * 60 * 60 * 1000, deps.timers, deps.initialDelayMs)` sweep refreshes `held` and queues `job.sweep([...held])`, returning `null`; `stop()` stops the sweep and the queue.
  - `runJevBacklog`: `JEV_IN_FLIGHT` workers share a cursor while `stoppedBy === "done"`; each item gets its own `onPause` that records the kind; an item returning `null` is pushed onto `asked`; an item returning a time sets `stoppedBy` to that item's recorded kind (`"outage"` if none was recorded) unless already set.
  - `jevCostUsd(requests)` is `Number((requests * 0.00012).toFixed(2))`.

- [ ] **Step 1: Write the failing tests** in `jevJobs.test.ts`, with a fake `canonicalWorkIds` (a `Map` of alias → canonical) and fake judges; no database:
  - "jevPause strikes a book failure and an unusable answer, keeping the answer's detail as the reason, and returns null"
  - "jevPause pauses an outage 10 minutes, a spent budget until UTC midnight, and a rejected key 24 hours with one alert"
  - "jevPause tells onPause the kind and the resume time"
  - "jevPause rethrows an error that isn't a TypeSafe failure"
  - "held() returns the canonical ids of the held works, aliases included" — a fake `judge` records what `held()` returned
  - "four workers hitting a rejected key at once send one alert"
  - "a spent budget is logged once at info level with its source, and alerts nobody, however many workers hit it"
  - "the held set is read once a minute, however many works are judged, and a newly held work is judged after it refreshes"
  - "the sweep runs at boot and again after 24 hours, queueing what it returns" (fake `timers`)
  - "the sweep waits for initialDelayMs before its first pass" (fake `timers`)
  - "stop ends the sweep and drops queued works"
  - "the backlog asks every item until the first pause and names its kind"
  - "a backlog stop is attributed to the item whose call failed, not to a concurrent one"
  - "jevCostUsd rounds to cents": `jevCostUsd(1000) === 0.12`, `jevCostUsd(0) === 0`
- [ ] **Step 2:** In `backend/`, `npx tsx --test src/modules/books/jevJobs.test.ts` fails on the missing module.
- [ ] **Step 3: Implement** `jevJobs.ts` to the Interfaces above, using `createWorkQueue` (`./workQueue.js`), `startDetailsBackfill` (`./backfill.js`) and `failureKind`, `nextUtcMidnight`, `strikeReason` (`./typesafe.js`). Add `src/modules/books/jevJobs.test.ts` to `backend/package.json`'s `test` list next to the other books tests.
- [ ] **Step 4:** `npx tsx --test src/modules/books/jevJobs.test.ts` passes; `node scripts/gate.mjs` passes. Commit.

### Task 2: Genre judgments on the runner

**Files:**
- Modify: `backend/src/modules/books/genreJudgments.ts`
- Modify: `backend/src/modules/books/genreBacklog.ts`
- Test: `backend/src/modules/books/genreJudgments.test.ts`
- Test: `backend/src/modules/books/genreBacklog.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: `GenreJudgmentDeps = JevPauseDeps & { repo: BooksRepository; classify: ClassifyGenre }`. `classifyWork`, `judgeWork(deps, workId, held?)`, `startGenreJobs`, `startGenreJobsIfConfigured`, `runGenreBacklog`, `backlogReport`, `backlogWorkIds` keep their names and call shapes. `GENRE_IN_FLIGHT` is removed (nothing outside the file uses it). `BacklogStop` becomes `export type BacklogStop = JevStop`.

- [ ] **Step 1:** `classifyWork`'s catch becomes `return jevPause(error, deps, GENRE_KEY_ALERT, (strike) => deps.repo.recordGenreRejection({ workId, ...strike, at: at() }))`, with `GENRE_KEY_ALERT` holding today's subject and text. `judgeWork`'s default `held` uses `heldCanonical(deps.repo, deps.heldWorkIds())`.
- [ ] **Step 2:** `startGenreJobs(deps: JevJobsDeps & { repo: BooksRepository; classify: ClassifyGenre })` returns `startJevJobs(deps, { source: GENRE_SOURCE, budgetMessage: "genre judgments paused until the daily TypeSafe budget resets", sweep: (held) => deps.repo.worksNeedingGenreJudgment(held, JEV_SWEEP_LIMIT, GENRE_REJECTION_LIMIT), judge: (workId, held, pause) => judgeWork({ ...deps, ...pause }, workId, held) })`. Its `deps` type drops the `classify` wrapper and the local quiet-window, budget-log and held-cache state. Delete the local pause, cache and sweep constants and `heldCanonical`.
- [ ] **Step 3:** `runGenreBacklog(deps, workIds)` returns `runJevBacklog(workIds, (workId, onPause) => classifyWork({ ...deps, onPause }, workId))`. `backlogReport` uses `jevCostUsd`. Delete `IN_FLIGHT`, `COST_PER_REQUEST_USD`.
- [ ] **Step 4: Tests.** In `genreJudgments.test.ts` delete the tests Task 1 now owns: "an error that isn't a TypeSafe failure is rethrown", "four workers hitting a rejected key at once send one alert", "a spent budget is logged once at info level and alerts nobody, however many workers hit it", "the sweep runs at boot and again after 24 hours", "the held set is read once a minute, …". Keep the rest, including "outages, a spent budget and a rejected key pause without storing or striking" (it checks genre stores nothing). In `genreBacklog.test.ts` delete "a stop is attributed to the failure of the call that caused it, not to a concurrent one". Run `npx tsx --test src/modules/books/genreJudgments.test.ts src/modules/books/genreBacklog.test.ts src/modules/books/jevJobs.test.ts` — all pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, commit.

### Task 3: Synopsis judgments on the runner

**Files:**
- Modify: `backend/src/modules/books/synopsisJudgments.ts`
- Modify: `backend/src/modules/books/synopsisBacklog.ts`
- Modify: `backend/src/modules/books/originalArrivals.ts`
- Modify: `backend/src/modules/books/seed/originalsFill.ts`
- Modify: `backend/src/modules/books/translationJudgments.ts`
- Modify: `backend/src/modules/books/translationBacklog.ts`
- Test: `backend/src/modules/books/synopsisJudgments.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `SynopsisJudgmentDeps = JevPauseDeps & { repo: BooksRepository; classify: ClassifySynopsis }`. `classifyText`, `judgeWorkSynopses`, `startSynopsisJobs`, `startSynopsisJobsIfConfigured`, `runSynopsisBacklog`, `synopsisBacklogReport` keep their names. `JEV_REJECTION_LIMIT` and `SYNOPSIS_IN_FLIGHT` are no longer exported from `synopsisJudgments.ts`; every importer of `JEV_REJECTION_LIMIT` (`synopsisBacklog.ts`, `originalArrivals.ts`, `seed/originalsFill.ts`, `translationJudgments.ts`, `translationBacklog.ts`, `synopsisJudgments.test.ts`) imports it from `./jevJobs.js` (`../jevJobs.js` in `seed/`). `SynopsisBacklogStop` becomes `= JevStop`.

- [ ] **Step 1:** `classifyText`'s catch becomes one `jevPause` call striking with `recordJevRejection({ task: "synopses", subject: hash, ...strike, at: at() })` and today's synopsis alert copy. `judgeWorkSynopses`' default `held` uses `heldCanonical`.
- [ ] **Step 2:** `startSynopsisJobs(deps: JevJobsDeps & { repo: BooksRepository; classify: ClassifySynopsis })` returns `startJevJobs(deps, { source: SYNOPSIS_SOURCE, budgetMessage: "TypeSafe budget spent; synopsis checks wait for the next UTC day", sweep: (held) => deps.repo.worksNeedingSynopsisJudgment(held, JEV_SWEEP_LIMIT, JEV_REJECTION_LIMIT), judge: (workId, held, pause) => judgeWorkSynopses({ ...deps, ...pause }, workId, held) })`. Delete the local state and constants.
- [ ] **Step 3:** `runSynopsisBacklog(deps, hashes)` returns `runJevBacklog(hashes, (hash, onPause) => classifyText({ ...deps, onPause }, hash))`; `synopsisBacklogReport` uses `jevCostUsd`. Move every `JEV_REJECTION_LIMIT` import.
- [ ] **Step 4: Tests.** In `synopsisJudgments.test.ts` delete "a spent budget is logged once per pause, at info level, without an alert" and import `JEV_REJECTION_LIMIT` from `./jevJobs.js`. Run `npm test --workspace backend` — all pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, commit.

### Task 4: Translation matching on the runner

**Files:**
- Modify: `backend/src/modules/books/translationJudgments.ts`
- Modify: `backend/src/modules/books/translationBacklog.ts`
- Test: `backend/src/modules/books/translationJudgments.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `TranslationDeps = JevPauseDeps & { repo: BooksRepository; classify: ClassifyMatch; sharesArena: (fromWorkId: string, intoWorkId: string) => boolean }`. `matchWork`, `judgeWorkMatch`, `startTranslationJobs`, `startTranslationJobsIfConfigured`, `runTranslationBacklog`, `translationBacklogReport`, and the script imports `RECHECK_AFTER_MS, runCodeSteps, translationBacklogWorks, translationDryRun, TRANSLATION_BACKLOG_SOURCE, arenaCheck` keep their names. `TranslationBacklogStop` becomes `= JevStop`.

- [ ] **Step 1:** `matchWork`'s catch becomes one `jevPause` call striking with `recordJevRejection({ task: "works", subject: workId, ...strike, at: at() })` and today's translation alert copy. `judgeWorkMatch`'s default `held` uses `heldCanonical`.
- [ ] **Step 2:** `startTranslationJobs(deps: JevJobsDeps & { repo: BooksRepository; classify: ClassifyMatch; sharesArena: TranslationDeps["sharesArena"] })` keeps its `seriesLike` 10-minute cache in its own closure and returns `startJevJobs(deps, { source: WORK_MATCH_SOURCE, budgetMessage: "TypeSafe budget spent; translation matching waits for the next UTC day", sweep: (held) => deps.repo.portugueseWorksNeedingMatch(held, JEV_SWEEP_LIMIT, JEV_REJECTION_LIMIT, null), judge: (workId, held, pause) => judgeWorkMatch({ ...deps, ...pause }, workId, held, seriesLike) })`. Delete the local alert, budget, held state, constants and `heldCanonical`.
- [ ] **Step 3:** `runTranslationBacklog(deps, workIds)` builds `seriesLike` once, then returns `runJevBacklog(workIds, (workId, onPause) => matchWork({ ...deps, onPause }, workId, seriesLike))`; `translationBacklogReport` uses `jevCostUsd`. Delete `IN_FLIGHT`, `COST_PER_REQUEST_USD`.
- [ ] **Step 4: Tests.** Nothing to delete: translation never had the duplicated tests. Run `npm test --workspace backend` — all pass. Run `npm run build --workspace backend` and `node -e "import('./backend/dist/modules/books/translationBacklog.js').then(m => console.log(Object.keys(m).sort().join(' ')))"` from the root (and the same for `genreBacklog.js`, `synopsisBacklog.js`, `translationJudgments.js`, `typesafe.js`); every name the three `backend/scripts/*-backlog.mjs` files and `merge-duplicate-works.mjs` import is listed.
- [ ] **Step 5:** `node scripts/gate.mjs`, commit.
