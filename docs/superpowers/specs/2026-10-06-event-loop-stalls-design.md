# Event-loop stalls: name them, then remove the background ones

Date: 2026-10-06
Status: outline approved in conversation; this spec awaits review

## Problem

The backend is one Node process on synchronous `node:sqlite`. The
2026-10-01 load-safety spec bounded the work each *request* does. This
spec covers the work nothing bounded: background timers and startup.

Production, `scripta` service, 2 Oct 10:09 to 6 Oct 11:03 UTC (the stall
log went live on 2 Oct). Only stalls over 200 ms are logged.

| Signal | Value |
|---|---|
| `event loop stalled` lines | 228, about 50 a day |
| Thread time lost | 147 s in 4 days (0.04%) |
| `handler blocked the event loop` lines | 0 |
| First stall in each new container | 34 containers: 1.0 s on 2 Oct, 1.4–1.8 s since 4 Oct, 14.9 s once (4 Oct 20:23, during the full-volume outage) |
| Later stalls | 194: median 329 ms, 25 over 500 ms, worst 7.0 s (5 Oct 01:07) |
| Traffic while they happened | a few requests an hour |
| HTTP p99, typical 3-hour bucket | about 15 ms |

What the numbers say:

- **No request has blocked the thread.** The request rule from 2026-10-01
  holds.
- **Later stalls hit an idle server.** 77 of the 194 started within 40 s
  of a 10-minute mark counted from the container's boot. Chance alone would
  put about 26 there. The 10-minute backfill timers are the likely cause of
  those. The other 117 are unattributed. The details and work-key backfills
  run for minutes after each tick, and the works sweep and cover worker
  keep their own clocks, so they are candidates. Nothing proves it.
- **The startup stall grows with the catalog.** It happens during plugin
  registration, before `listen()`. Railway keeps the old container serving
  until `/health` answers on the new one, so during a deploy users don't
  see it. They see it after a crash restart, when there is no old
  container.

The stall log is a 10-second histogram maximum, so it cannot say what ran.
That is the first thing to fix.

## Goal

1. Every stall over 200 ms in background or startup work is logged with
   the name of the job or step that caused it.
2. The background jobs we can see stalling stop doing unbounded work on
   the main thread: indexed queries, bounded batches.
3. Measured in production over the 7 days after deploy, against the table
   above: later stalls fall from about 50 a day to under 5 a day, and none
   of them is over 500 ms. Any that remain carry a job name.

## Non-goals

- **Changing the stack.** No Postgres, worker threads or second replica.
  The numbers above don't call for any of them.
- **The 10 MiB library cap.** No request has blocked, and the largest
  stored library was 67 KB on 2 Oct. If `handler blocked the event loop`
  starts firing on `PUT /library`, lower it then.
- **`busy_timeout`.** A 5 s busy wait on the main thread is possible while
  a `railway ssh` script writes to `covers.sqlite`, but the logs don't show
  it happening. The rule stays operational: run catalog scripts when nobody
  is using the app.
- **Rewriting the one-time startup migrations.** Several scan on every
  boot: `resetPresetBlockStyles`, `readEmbeddedMurals`,
  `backfillMuralThemes`, `deleteOrphanedDerived` and community
  `syncFeedSettingColumns`. They run before `listen()` and the data behind
  them is small. Workstream 1 times each one. If one turns out to be
  slow, deleting a migration that has finished in production is a
  separate change.
- **`groupablePairsStmt` redesign.** It aggregates every keyless work on
  each call. Workstream 2 measures it. If it is over budget, stop and bring
  the numbers back rather than redesigning it inside this change.

## Budget

On a synthetic 78k-book catalog (the size of production on 4 Oct), on a
development Mac:

- every synchronous slice of a background job is under 50 ms;
- the books plugin's registration, `enqueueUnchecked` included, is under
  200 ms.

Railway's CPU is slower than a Mac. A 4× margin under the 200 ms log
threshold leaves room for that.

## Design

### 1. Name what blocks

Add `timeSync(log, name, fn)` to `backend/src/stallLog.ts`. It runs `fn`
and returns its result. If `fn` held the thread for more than `STALL_MS`,
it logs at warn:

```
{ job: name, blockedMs } "job blocked the event loop"
```

This mirrors the existing handler wrapper. It times the synchronous call
only, so wrap synchronous slices, not async functions. Wrap these, using
these names:

| Name | What it wraps |
|---|---|
| `cover-enqueue` | each `enqueueUnchecked` call, boot included |
| `details-backfill` | the batch query and each book's synchronous writes in `backfillDetails` |
| `work-key-backfill` | the same in `backfillWorkKeys` |
| `works-backfill:<step>` | each `drain` batch: `assignMissingWorks`, `fillTitleKeys`, `groupKeylessWorks` |
| `works-sweep:<module>` | each 250-row batch in `startWorksSweep` |
| `cover-worker` | the synchronous repository work around each cover job |
| `arena-sweep` | `runScheduledSweep` |
| `community-archive` | each archive batch |
| `startup:<step>` | each step of `runStartupMigrations`, and each module's `open*Db()` during plugin registration |

`startup:*` steps log their duration at info even under the threshold.
The startup log is one line per step per boot, and it is the only way to
see what the growing 1.5 s is made of.

The per-request `trace` context is not involved: these jobs emit no
events.

### 2. Index the backfill queries

None of the columns the books backfills filter or sort on is indexed.
Every 10-minute tick scans and sorts the whole `books` table. Add partial
indexes in `applyBooksMigrations`, next to the existing `CREATE INDEX IF
NOT EXISTS` lines, one per statement:

- `uncheckedStmt`: partial on its exact `WHERE`, ordered `created_at`.
- `uncheckedDetailsStmt`: partial on `details_status IS NULL`, with key
  expressions matching its `ORDER BY`.
- `upgradeWantedStmt`: partial on `cover_upgrade_wanted_at IS NOT NULL`,
  ordered by it.
- `workLookupStmt`: partial on its constant conditions (`ol_work_key IS
  NULL AND isbn IS NOT NULL AND details_status IS NOT NULL`), with key
  expressions matching its `ORDER BY`.

The plan writes the exact DDL, checked with `EXPLAIN QUERY PLAN`. The test
for each statement asserts its plan uses the index: no `SCAN books` and no
`USE TEMP B-TREE FOR ORDER BY`. That test guards the next person who
edits the query and drifts from the index.

The index build runs once on an existing database, about 78k rows, at the
first boot after deploy. That boot is before `listen()`.

### 3. Bound the cover enqueue

`enqueueUnchecked` loads every unchecked and upgrade-wanted id, then
schedules each one in a loop with no yield. With 78k books that is tens of
thousands of ids per tick, most already queued.

Change it to page through the set across ticks. Each call enqueues at
most `COVER_ENQUEUE_BATCH` ids from each list. It continues after the
last `(created_at, rowid)` it reached, and wraps to the start when a page
comes back short. The cursor lives in memory, so a restart begins again
from the top.

Why a cursor and not just a `LIMIT`: a book whose lookup came back
unavailable keeps `cover_checked_at` NULL and gets an in-memory backoff
(`booksService.ts`, `backoffUntil`). With a plain `LIMIT`, enough of those
at the front of the order would fill every page, and the books behind
them would never be scheduled.

Set `COVER_ENQUEUE_BATCH` to at least twice what the worker can finish in
one 10-minute interval. The plan derives that from the worker's three
slots and the source throttles in `books/plugin.ts`. The backfill must
not get slower.

### 4. One way to open a database, with `synchronous = NORMAL`

All 11 `open*Db()` functions repeat the same lines: `mkdirSync`, `new
DatabaseSync`, WAL, `busy_timeout`. Add one helper,
`backend/src/db/openSqlite.ts`, that does those and also sets
`PRAGMA synchronous = NORMAL`. Each module keeps its own schema and
migrations, and keeps `foreign_keys = ON` where it has it today (auth,
community).

`synchronous` defaults to `FULL`. In WAL mode, that makes every commit
wait for a disk flush on the main thread. `NORMAL` is SQLite's
recommended setting for WAL: it flushes at checkpoints instead. A process
crash loses nothing. A power or OS failure can lose the last commits
before the checkpoint. Litestream ships the WAL about every second, so
that window is already the recovery point.

The read-only open in `library/import/importChild.ts` stays as it is.

## Testing

- `stallLog.test.ts`: `timeSync` logs over the threshold, stays silent
  under it, returns the function's result, and rethrows its error. The
  existing `busyWait` helper drives it.
- `sqliteBooksRepository.test.ts`: one plan assertion per indexed
  statement, against `:memory:` through `applyBooksMigrations`.
- `booksService.test.ts`: the enqueue cursor.
  - Pages are bounded.
  - Consecutive calls continue where the last one stopped.
  - A short page wraps to the start.
  - Backed-off ids at the front don't starve the ids behind them.
- One test that a database opened through `openSqlite` reports
  `journal_mode` `wal`, `synchronous` 1 and `busy_timeout` 5000.
- `backend/package.json`'s `test` script lists files explicitly. Any new
  test file goes on that list, or it never runs.
- Measurement, recorded in the PR description: a scratch script builds the
  synthetic 78k-book catalog in memory. The keyless-works plan's step 7
  did the same (`docs/superpowers/plans/2026-10-04-keyless-works.md`). It
  times each statement in workstream 2, `groupKeylessWorks(250)`, and
  `enqueueUnchecked`, before and after. The script is not committed.

## Rollout and verification

One PR, four workstreams, in order: 1, then 2 and 3, then 4. Workstream 1
is useful on its own, so it may ship first if the rest runs long.

After deploy:

1. Search the Railway logs for `job blocked the event loop` and
   `startup:` once a day for 7 days.
2. Compare stalls per day and their sizes against the table in
   [Problem](#problem).
3. Add a log panel for `"job blocked the event loop"` to the Railway
   Observability dashboard, beside the two existing stall panels.

If later stalls stay above 5 a day, the job names say where to look next.
That is a new spec, not a reopening of this one.
