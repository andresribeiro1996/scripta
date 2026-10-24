# One way to run a background job

From the 2026-10-24 architecture review (candidate E). The backend runs its periodic work in several ways:

- `books/backfill.ts` `startDetailsBackfill`: an overlap guard, a resume time, an abort on stop, a first run at once, errors to a callback. It runs the details, work-key, retitle and BNP jobs in `books/plugin.ts`, the three Jev sweeps and original arrivals. `startWorksBackfill` and `startCoverColorBackfill` wrap it.
- `books/backfill.ts` `startBackfill`: a bare unref'd `setInterval`. The cover enqueue runs on it (`plugin.ts:186`) with no error handler. Its test (`backfill.test.ts:42`) shows a throw escapes the timer; in the server that is an uncaught exception, which stops the process.
- `startWorksGrouping`: its own guard, its own abort, a `runNow` for the admin route, on `startBackfill`.
- `library/worksSweep.ts` `startWorksSweep`: its own `running`/`stopped` flags, its own paging, its own `setInterval`, started in `app.ts`'s `onReady`.
- `arena/plugin.ts:30-41`: a `setInterval` with a try/catch around `timeSync`, and its own `onClose` hook.

`books/plugin.ts` keeps 13 stop handles and calls each in `onClose` (`plugin.ts:224-239`).

## Decision

A new `backend/src/jobs.ts`, beside `stallLog.ts`, owns the timer behaviour:

- `startJob(run, onError, intervalMs, timers?, now?)` is today's `startDetailsBackfill`, moved and renamed. `drainBatches` stays in `books/backfill.ts`, its only user.
- `startTimer(callback, intervalMs, timers?)` is today's `startBackfill`, moved and renamed; only `startJob` and `startWorksGrouping` use it.
- `createJobs(log, timers?)` returns `{ every(name, intervalMs, run), own(stop), stopAll() }`:
  - `every` starts a `startJob` whose errors are logged as `log.error({ err }, \`${name} failed\`)`. A synchronous throw inside `run` is caught the same way.
  - `own` keeps a stop function for something with its own lifecycle: the Jev jobs, the cover worker, the works grouping, original arrivals.
  - `stopAll` calls every stop once, in reverse order of registration.

Callers:

- `books/plugin.ts` makes one `jobs`, registers every job and stopper on it, and its `onClose` calls `jobs.stopAll()`. The cover enqueue becomes `jobs.every("cover-enqueue", BACKFILL_INTERVAL_MS, …)`; its first run replaces the separate `timeStep("startup:cover-enqueue", …)` call.
- `startWorksBackfill` and `startCoverColorBackfill` stay in `books/backfill.ts`, built on `startJob`. `startWorksGrouping` keeps `runNow` and its own guard, on `startTimer`.
- `jevJobs.ts` and `originalArrivals.ts` use `startJob`.
- `app.ts` runs the works sweep through `createJobs(app.log)`; `startWorksSweep` becomes the sweep body (`run(signal)`), paging until each step is drained and stopping when the signal aborts.
- `arena/plugin.ts` uses `createJobs(app.log)` for its round-settlement sweep.

Error messages keep today's wording by choosing each `name` to match: "details backfill", "work key backfill", "lossy retitle", "bnp sync", "works backfill", "cover colour backfill", "works sweep", "arena round-settlement sweep".

## Behaviour changes

- A failing cover enqueue is logged as "cover-enqueue failed" and retried on the next tick, instead of throwing out of the timer.
- The arena sweep and the cover enqueue gain the overlap guard, and the arena sweep now also runs once at boot, settling any round whose deadline passed while the server was down.
- The "startup:cover-enqueue" startup-step line goes; a slow first enqueue still logs "job blocked the event loop" through `timeSync`.
- A first cover enqueue that throws at boot no longer stops the server from starting (today it rejects `booksPlugin`); it is logged and retried in 10 minutes.

## Not in scope

- The cover worker's queue (`worker.ts`) and the Jev work queue (`workQueue.ts`). They are queues, not periodic jobs.
- Intervals and batch sizes. None change.
