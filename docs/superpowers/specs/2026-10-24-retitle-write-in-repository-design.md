# The retitle write goes through the books repository

From the 2026-10-24 architecture review (candidate F). The live lossy-retitle job writes its fixes with `applyMojibakeRepairs(booksDb, plan)` (`plugin.ts:208`), a raw-SQL function in `seed/mojibakeRepair.ts:61-96`. It is the one live production write to `books.db` that skips `BooksRepository`:

- it is not stall-timed, since `timedMethods` wraps only repository methods (`plugin.ts:74`);
- it breaks the rule that `adapters/sqlite/` is the only place with SQL (`backend/README.md`, hexagonal architecture section).

The same function also runs in the `user_version` 4 migration (`adapters/sqlite/connection.ts:269-270`), in `scripts/repair-mojibake.mjs` and `scripts/retitle-lossy.mjs`, and in the `mojibakeRepair`, `lossyRetitle` and `retitleJob` tests.

## Decision

- `applyMojibakeRepairs` moves unchanged to `adapters/sqlite/titleRepairs.ts`. The migration, both scripts and the seed tests import it from there.
- `RowRepair` and `MojibakeApplied` move to `domain/types.ts`, since the port now names them. `seed/mojibakeRepair.ts` keeps `BookRepair`, `MojibakePlan`, the planner and the report, and imports the two types back.
- `BooksRepository` gains `applyTitleRepairs(plan: { books: RowRepair[]; works: RowRepair[] }): MojibakeApplied`, which the SQLite repository implements by calling `applyMojibakeRepairs(db, plan)`.
- The retitle job's `write` becomes `(plan) => repo.applyTitleRepairs(plan)`, so the write is timed under `books:applyTitleRepairs`. `retitleJob.test.ts` writes through the repository too.

Behaviour is unchanged: same SQL, same per-book transactions, same old-value guards, same counts.

## Not in scope

- The read-only planners in `seed/` (`planMojibakeRepairs`, the lossy-retitle planner) and the other one-off scripts' SQL. They run by hand, not in the server.
