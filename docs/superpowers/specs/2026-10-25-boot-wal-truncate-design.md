# Truncate the WALs before Litestream starts

## Problem

Right after a production boot, `books:spendTypesafe` (a one-row upsert on covers.sqlite) waits the full 5 s `busy_timeout` and fails with "database is locked". It is not alone: `cover lookup failed` and `details backfill failed` come with the same error. Deploy logs since 2026-10-20 (raw lines in the side-session notes folder `local_1c361fc7…/boot-logs/`):

| Boot | Litestream on covers.sqlite | Writers blocked |
|---|---|---|
| 438654e7, 10-20 16:20 | +1.6 s `forcing truncate checkpoint wal_size=174885792` | +2.3 → +16.7 s without a break: 5006 (locked), 5005 (locked), 3833 |
| efa6c288, 10-20 15:10 | +3.5 s and +7.5 s forced truncate, `wal_size=248094072`; a sync error at +5.3 s (`bump litestream seq: database is locked`) | 5006 (locked), 3332 until +16.9 s; later 5006 (locked), 2131 ending 40 ms after "wal restarted by passive checkpoint" |
| bdab548f, 10-23 17:09 | +2.5 s forced truncate, `wal_size=91484632` | 5005 (locked), 1831 (locked) ending 40 ms after "wal restarted by passive checkpoint" |
| 3a9ee8f2, 10-23 12:45 | no Info line | 5005 (locked), 1130, right after the 47,118-row original-key migration committed |
| 6059bd78, 24b2c2a0 | +1.5 s "wal restarted by passive checkpoint, skipping truncate", `wal_size=101405592` | none |

## Cause

Litestream holds SQLite's write lock while it checkpoints, and the first sync after a restart can turn that into a whole-database copy. In Litestream 0.5.17's `db.go` (v0.5.17 tag):

1. **The first sync judges the WAL by file size.** `verifyAndSyncWithExecutor` uses `lastSyncedWALOffset`, which is 0 in a new process, and falls back to `walFileSize()`.
2. **The file never shrinks.** `init` sets `SQLITE_FCNTL_PERSIST_WAL`, and the PASSIVE checkpoints Litestream runs keep the WAL file at its high-water mark. covers.sqlite's WAL file is 91–248 MB across these boots, above `truncate-page-n: 12800` (52,736,032 bytes). So every boot takes `checkpointIfNeeded`'s emergency branch.
3. **The emergency branch first tries a PASSIVE checkpoint.** It runs inside a `_litestream_lock` barrier transaction, so it holds the write lock. If that checkpoint restarts the WAL, which it can only do when no app reader is mid-query, Litestream skips the rest. That is boots 6059bd78 and 24b2c2a0, where the app was idle at +1.5 s.
4. **Otherwise it forces a TRUNCATE.** `checkpointWithExecutor` then takes a "checkpoint boundary snapshot" unconditionally, writing every page of the database to an LTX file while holding the write lock. That is boot 438654e7's 15 s.

The local repro confirms this with the real Litestream 0.5.17 binary. It uses a 334 MB covers-shaped database, a 110 MB WAL file left by a previous Litestream run, and an app that reads and upserts the way the booting server does. All three runs log `forcing truncate checkpoint`, then `mode=TRUNCATE`, then `checkpoint boundary snapshot`, and block the upsert 2.6–2.7 s on a Mac SSD. Production's volume is slower, so the same sequence took 9–15 s there.

A second, separate cause shows in 3a9ee8f2, and in the later halves of efa6c288 and bdab548f. A big commit is followed by Litestream's next checkpoint, which copies the new WAL frames under the same barrier: the original-key migration rewrote 47k rows, and the boot works grouping merged 3,804. That costs about 1 s per 10–15 MB on the production volume and about 96 ms per 110 MB locally. This change does not address it (see Out of scope).

## Design

`backend/scripts/start-with-litestream.sh` runs `node scripts/truncate-wals.mjs $databases` just before `exec litestream replicate`. At that point no other process has the databases open: Railway stops the old container before starting a volume-mounted new one, and the logs show a 2–8 s gap.

`truncate-wals.mjs` opens each path that exists and runs `PRAGMA wal_checkpoint(TRUNCATE)`, then closes it, which removes the WAL. It prints one line per database with the WAL size it found. If the checkpoint reports busy, it says so and leaves the file alone; the boot then behaves as it does today. A SQLite error propagates, and `set -eu` stops the start. The app would hit the same error opening that database anyway.

**What Litestream does then.** Its first sync finds the WAL shorter than its last LTX position and logs `wal truncated by another process`. It then takes a full snapshot of the database through its normal sync path, which holds no SQLite lock, only its own long read transaction. In the repro:
- Upserts during that snapshot had a maximum wait of 0–4 ms across four runs (three with reads, one idle).
- There was no forced truncate.
- A `litestream restore` of the replica afterwards matched the live database: integrity `ok`, the same row count and sum, and the upserts written after the truncation.

**Cost.** Every boot now writes one full L0 LTX per database. For covers.sqlite that is about a quarter of the database size, compressed: 86.7 MB for the 334 MB copy. Boots that hit the TRUNCATE branch already wrote one under the lock. The checkpoint itself runs before the server starts, against a WAL nobody waits on, and `healthcheckTimeout` is 300 s.

## Out of scope

- **Big commits checkpointed under the barrier** (the second cause). Options: pace one-shot migrations the way `createBnpPacer` paces the import, run the books migrations in this pre-start step before Litestream attaches, or take it upstream. Each needs its own measurement.
- **Raising `truncate-page-n` back to the default (~500 MB).** This was rejected. It only moves the threshold: the WAL file keeps ratcheting up to its largest burst, and once past 500 MB the same TRUNCATE plus boundary snapshot runs, with a bigger WAL to copy. It also undoes the 2026-10-04 cap that keeps the WAL off the volume limit.

## Done

- The start script truncates every database's WAL before replication starts, and a test pins the script's contract.
- After deploy, the first boot's log shows a `truncate-wals:` line for `/data/covers.sqlite` before Litestream's lines, and no `forcing truncate checkpoint` or `wal restarted by passive checkpoint` for covers.sqlite in the first minute. No `spendTypesafe` block appears in that minute, apart from one following a big startup migration commit (the out-of-scope cause). Litestream's `wal truncated by another process` is a Debug line, so Railway doesn't show it.
