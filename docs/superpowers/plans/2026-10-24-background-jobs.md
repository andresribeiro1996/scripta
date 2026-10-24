# Background Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every periodic job in the backend runs through `backend/src/jobs.ts`, with one error log per job name and one `stopAll` per plugin.

**Architecture:** Move the two timer primitives out of `books/backfill.ts` into `backend/src/jobs.ts` and add a small registry, `createJobs`. Then move the books plugin, the library works sweep and the arena sweep onto it.

**Tech Stack:** TypeScript, Fastify, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-24-background-jobs-design.md`

**Base:** after the Jev job runner branch (this one edits `jevJobs.ts`) and the retitle-write branch (both edit `books/plugin.ts`) merge.

## Global Constraints

- `startJob(run: (signal: AbortSignal) => Promise<number | null | void>, onError: (error: unknown) => void, intervalMs?: number, timers?: JobTimers, initialDelayMs?: number, now?: () => number): () => void` keeps today's `startDetailsBackfill` behaviour exactly, including the delayed first run.
- `startTimer(callback: () => void, intervalMs: number, timers?: JobTimers): () => void` keeps today's `startBackfill` behaviour.
- `createJobs(log: { error(details: object, message: string): void }, timers?: JobTimers): Jobs` where `Jobs = { every(name: string, intervalMs: number, run: (signal: AbortSignal) => Promise<number | null | void> | number | null | void, initialDelayMs?: number): void; own(stop: () => void): void; stopAll(): void }`.
- Error lines are `log.error({ err: error }, \`${name} failed\`)`, with the names listed in the spec so today's messages are unchanged.
- No interval or batch size changes. No comments in code.
- `src/jobs.test.ts` goes into the explicit list in `backend/package.json`'s `test` script. Verify each task with `node scripts/gate.mjs` before committing.

## Review Focus

- **A synchronous throw inside an `every` job** (the cover enqueue's `timeSync` rethrows) is logged and the next tick runs. Task 1.
- **A job still running when `stopAll` is called** gets its signal aborted and starts no new run. Task 1.
- **`runNow` from the admin route during the daily grouping run** still returns `null`. The existing `backfill.test.ts` grouping tests cover it; Task 2 keeps them.
- **The works sweep stopping mid-page** on close makes no further step call. Task 3.

---

### Task 1: `jobs.ts`

**Files:**
- Create: `backend/src/jobs.ts`
- Test: `backend/src/jobs.test.ts`
- Modify: `backend/src/modules/books/backfill.ts`
- Test: `backend/src/modules/books/backfill.test.ts`
- Modify: `backend/src/modules/books/jevJobs.ts`
- Modify: `backend/src/modules/books/originalArrivals.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `JobTimers` (today's `Timers` interface in `backfill.ts`), `startTimer`, `startJob`, `createJobs`, `Jobs`, all exported from `backend/src/jobs.ts`. `drainBatches` and its batch-size constants stay in `backfill.ts`.

- [ ] **Step 1: Move the tests.** Move the `startBackfill` tests ("the backfill fires every interval on an unref'd timer", "stop clears the interval") and the eight `startDetailsBackfill` tests (the three initial-delay ones included) from `backfill.test.ts` into `src/jobs.test.ts`, renamed to `startTimer` / `startJob`, with the `fakeTimers` helper. Drop "error from the backfill is not swallowed": `createJobs` replaces that behaviour. Add:
  - "every runs a job at once and again every interval"
  - "a job that throws or rejects is logged with its name, and the next tick still runs" — one sync throw, one rejection; `log.error` called with `{ err }` and `"cover-enqueue failed"`
  - "a job that returns a resume time skips ticks until then"
  - "stopAll aborts running jobs, clears their timers and calls every owned stop once, last registered first"
- [ ] **Step 2:** `npx tsx --test src/jobs.test.ts` in `backend/` fails on the missing module.
- [ ] **Step 3: Implement** `jobs.ts`: `startTimer` and `startJob` are cut from `backfill.ts` verbatim, renamed, with the `startFirstRun` and `systemTimers` helpers that `startJob` and `startWorksGrouping` share (exported); `createJobs.every` wraps `run` so a sync throw becomes a rejection, and passes `(error) => log.error({ err: error }, \`${name} failed\`)` as `onError` and `initialDelayMs` through to `startJob`.
- [ ] **Step 4:** `backfill.ts` imports `startJob`, `startTimer`, `JobTimers` from `../../jobs.js` and no longer exports `startBackfill` / `startDetailsBackfill`. `jevJobs.ts` and `originalArrivals.ts` import `startJob` from `../../jobs.js`; `JevJobsDeps.timers` becomes `JobTimers`. `plugin.ts` imports `startJob` and `startTimer` from `../../jobs.js` and calls them where it called `startDetailsBackfill` and `startBackfill`; Task 2 replaces those calls. Add `src/jobs.test.ts` to the `test` list.
- [ ] **Step 5:** `npm test --workspace backend` passes; `node scripts/gate.mjs`; commit.

### Task 2: Books plugin on `createJobs`

**Files:**
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `createJobs`, `startJob` from Task 1.

- [ ] **Step 1:** In `booksPlugin`, `const jobs = createJobs(app.log)`. Register: `jobs.every("cover-enqueue", BACKFILL_INTERVAL_MS, () => timeSync(app.log, "cover-enqueue", () => service.enqueueUnchecked()))` (and delete the `timeStep("startup:cover-enqueue", …)` call before it), `"details backfill"`, `"work key backfill"`, `"lossy retitle"` (only when ISBNdb is configured), `"bnp sync"` (with `BNP_SYNC_INTERVAL_MS`) — each with today's `run` body, `DETAILS_BATCH_SIZE`/`BACKFILL_INTERVAL_MS` and, except the cover enqueue, its `FIRST_RUN_DELAY_MS` entry as `initialDelayMs` (`detailsBackfill`, `workKeyBackfill`, `retitleJob`, `bnpSync`). `jobs.own(...)` the works backfill, cover colour backfill and works grouping (their starters keep taking their `FIRST_RUN_DELAY_MS` entries), original arrivals, the three Jev jobs (when started) and the cover worker.
- [ ] **Step 2:** The `onClose` hook becomes `activeService = null; jobs.stopAll();`. Delete the `stop*` locals.
- [ ] **Step 3:** Update `backend/README.md`'s books section (around lines 164 and 175) where it names `startBackfill`/`startDetailsBackfill`, to `createJobs`/`startJob` in `src/jobs.ts`. Run `npm test --workspace backend`. `backend/src/booksWiring.test.ts` builds and closes the whole app, which proves the plugin boots and closes with its unconditional jobs; its env sets no TypeSafe or ISBNdb key, so the Jev `own` calls and the lossy-retitle job are not exercised there. What `stopAll` stops is tested in Task 1.
- [ ] **Step 4:** `node scripts/gate.mjs`, commit.

### Task 3: Works sweep and arena sweep on `createJobs`

**Files:**
- Modify: `backend/src/modules/library/worksSweep.ts`
- Modify: `backend/src/modules/library/index.ts`
- Test: `backend/src/modules/library/worksSweep.test.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/modules/arena/plugin.ts`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `createJobs` from Task 1.
- Produces: `sweepWorks(steps: WorksSweepStep[], log: { info(details: object, message: string): void }, batch?: number): (signal: AbortSignal) => Promise<void>` replacing `startWorksSweep`. It pages every step to the end, yields with `setImmediate` before each page, returns as soon as `signal.aborted`, and logs `{ resolved }` "works sweep resolved entries" when it resolved any.

- [ ] **Step 1: Tests.** In `worksSweep.test.ts`, rewrite "startWorksSweep runs every step to the end and logs what it resolved" against `sweepWorks(steps, log)(signal)`. Replace "a failing step is logged and does not stop the next tick" with "a failing step rejects the sweep" (the logging now belongs to `createJobs`, tested in Task 1). Add "an aborted signal stops the sweep before the next page".
- [ ] **Step 2:** Implement `sweepWorks`; delete `startWorksSweep` and `SWEEP_INTERVAL_MS` from the file (export the interval as `WORKS_SWEEP_INTERVAL_MS = 10 * 60 * 1000`). `library/index.ts` re-exports `sweepWorks` and `WORKS_SWEEP_INTERVAL_MS` in place of `startWorksSweep`.
- [ ] **Step 3:** In `app.ts`, replace today's `let stopWorksSweep` with `let sweepJobs: Jobs | null = null` declared before both hooks; the `onReady` hook sets `sweepJobs = createJobs(app.log)` and calls `sweepJobs.every("works sweep", WORKS_SWEEP_INTERVAL_MS, sweepWorks(<today's timed steps>, app.log))`; the `onClose` hook calls `sweepJobs?.stopAll()`.
- [ ] **Step 4:** In `arena/plugin.ts`, replace the `setInterval`/try/catch/`onClose` block with `const jobs = createJobs(app.log); jobs.every("arena round-settlement sweep", SWEEP_INTERVAL_MS, () => timeSync(app.log, "arena-sweep", () => service.runScheduledSweep())); app.addHook("onClose", async () => jobs.stopAll());`. Rewrite the file's header comment (lines 1-7) and drop the inline comment on the old `unref` line, so neither describes a `setInterval`. In `backend/README.md`'s arena section (around line 618), say the sweep runs through `createJobs`, at boot and every 30 s.
- [ ] **Step 5:** `npm test --workspace backend` passes; `node scripts/gate.mjs`; commit.
