# Boot WAL Truncate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Railway's start script checkpoints and truncates every database's WAL before Litestream starts, so Litestream's first sync never holds the write lock through a forced TRUNCATE and a full-database boundary snapshot.

**Architecture:** A standalone `node:sqlite` script, `backend/scripts/truncate-wals.mjs`, called once from `start-with-litestream.sh` with the database list the script already reads from `litestream.yml`.

**Tech Stack:** POSIX sh, Node 24+ `node:sqlite`, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-25-boot-wal-truncate-design.md`

**Base:** origin/main (f3b6bf0a).

## Global Constraints

- `truncate-wals.mjs` imports nothing from `dist` or the app. Its only imports are `node:fs` and `node:sqlite`.
- **Arguments and per-path behaviour.** Each argument is a database path. Skip a path that doesn't exist, and never create one. For an existing path:
  1. Read the size of `<path>-wal`, or 0 if there is none.
  2. Open the database with `new DatabaseSync(path)`. Run `PRAGMA wal_checkpoint(TRUNCATE)`, then close it.
  3. Print exactly one line: `truncate-wals: <path> wal_bytes=<n>`. When the pragma's `busy` is 1, the line instead ends ` wal_bytes=<n> busy, WAL left in place`.
- The script exits 0 when it reports busy. Any thrown SQLite error propagates, so the script exits non-zero.
- **The start script.** In `start-with-litestream.sh`, the call goes after the restore loop and immediately before `exec litestream replicate`, as `node scripts/truncate-wals.mjs $databases`. It is unquoted, like the restore loop's word splitting. The `set -eu` already in that script stops the start on a non-zero exit.
- No comments in code. The *why* goes in the commit message: the spec's Cause section, in short.
- Verify with `node scripts/gate.mjs` before committing.

## Review Focus

- **Order.** The truncation must run after the restore and the staged-rollback swap, and before `litestream replicate`. Nothing else may hold the databases open then.
- **The test's WAL.** It must hold real committed frames when the script runs. Copy the `-wal` file while the writing connection is still open, because closing the last connection checkpoints and deletes it. The test then shows that the rows survive in the main file with the WAL gone.

---

### Task 1: Truncate the WALs in the start script

**Files:**
- Create: `backend/scripts/truncate-wals.mjs`
- Modify: `backend/scripts/start-with-litestream.sh`
- Modify: `backend/package.json`
- Modify: `backend/README.md`
- Test: `backend/src/db/truncateWals.test.ts`

**Interfaces:**
- Produces: the CLI `node scripts/truncate-wals.mjs <db path>...`, run from `backend/`, as specified in Global Constraints.

- [ ] **Step 1: Write the failing test.** Create `backend/src/db/truncateWals.test.ts`. It runs the script with `execFileSync(process.execPath, [<abs path to backend/scripts/truncate-wals.mjs>, ...paths])`, resolving the script path from `import.meta.url`. Three tests:
  1. **A WAL that holds frames is checkpointed and removed.**
     - In a temp dir, open `a.sqlite` with `openSqlite` and run `PRAGMA wal_autocheckpoint = 0`. Create a table, insert 500 rows in one transaction, and leave the connection open.
     - Copy `a.sqlite` and `a.sqlite-wal` to `b.sqlite` and `b.sqlite-wal`, assert `b.sqlite-wal` is over 0 bytes, and close the first connection.
     - Run the script on `b.sqlite`. Its stdout is `truncate-wals: <b path> wal_bytes=<the copied size>\n`.
     - `b.sqlite-wal` either doesn't exist or is 0 bytes.
     - Opening `b.sqlite` with `{ readOnly: true }` counts 500 rows.
  2. **A missing path is skipped.** Running on `<tmp>/missing.sqlite` prints nothing, exits 0, and leaves no `missing.sqlite`.
  3. **A busy checkpoint is reported, not thrown.**
     - Keep a connection open on `c.sqlite` (WAL with frames, autocheckpoint 0) inside an open read transaction: `BEGIN`, then a `SELECT`.
     - Run the script on it. It exits 0 and prints the line ending ` busy, WAL left in place`.
     - `c.sqlite-wal` still exists and is larger than 0 bytes.

  Add `src/db/truncateWals.test.ts` to the `test` file list in `backend/package.json`, next to `src/db/openSqlite.test.ts`. In `backend/`, run `npx tsx --test src/db/truncateWals.test.ts`. It fails because the script doesn't exist.
- [ ] **Step 2: Write the script** to the Global Constraints. Re-run the test; all three pass.
- [ ] **Step 3: Call it from the start script.** Put `node scripts/truncate-wals.mjs $databases` on its own line directly above `exec litestream replicate -config litestream.yml -exec "node dist/server.js"`.
- [ ] **Step 4: Document it.** In `backend/README.md` § Backups, the **Boot** bullet gets two sentences after the restore sentence.
  - The first says that, before replication starts, the script checkpoints and truncates every database's WAL (`scripts/truncate-wals.mjs`), while nothing else has it open.
  - The second gives the reason. Litestream 0.5.17 judges its first sync after a restart by the WAL file's size, which its `PERSIST_WAL` never shrinks. Past `truncate-page-n`, it forced a TRUNCATE checkpoint and a whole-database snapshot while holding SQLite's write lock, and app writes failed with "database is locked" for 5–15 s after each boot. Litestream now logs `wal truncated by another process` and takes that full snapshot without the lock instead.
  - Keep it to those two sentences.
- [ ] **Step 5: Verify.**
  - `sh -n backend/scripts/start-with-litestream.sh` succeeds.
  - `npm test --workspace backend` and `npm run typecheck --workspace backend` pass.
  - `node scripts/gate.mjs` passes. Then commit.
