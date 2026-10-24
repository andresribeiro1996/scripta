# The works-grouping run yields between its reads

After #346 staggered the first runs, the production boot of 9c2eb91d (2026-10-24) has no event-loop stall above 804 ms before +120 s. The worst one left is the works-grouping run at +121 to +131 s, where `event loop stalled` peaks at 1850 ms.

## What blocks

- **The duplicate walk** (`walkDuplicateWorks`, `duplicateWorks.ts:56-76`; the plugin passes 100 keys a page and 250 ms pauses) runs each page as one synchronous block. That block is `books:groupableTitleKeys` (656–776 ms) followed by `mergeDuplicateWorks`, which reads `books:keyedWorksWithTitleKeys` (469–1088 ms) and then merges. 776 + 1088 ≈ the 1850 ms stall. The walk yields and pauses only after the merges.
- **The keyless drain** (`groupKeylessWorks`, `sqliteBooksRepository.ts:1205-1217`) runs every page of `groupableTitleKeys` plus `groupTitleKeys` inside one `BEGIN IMMEDIATE` transaction and one synchronous call. Once the drain has nothing left to merge, one call walks every shared title key: 715 ms on that boot, warm from the walk just before it. The block grows with the catalog and with a cold cache, and the write lock is held the whole time.

Both reads cost roughly in proportion to the number of keys in a page. `groupableTitleKeys` scans the title index until it has found that many shared keys, and `keyedWorksWithTitleKeys` reads each key's editions and works.

## Decision

1. **The walk yields between a page's key read and its merge step.** After `groupableTitleKeys` returns a non-empty page, the walk awaits `setImmediate`. It stops without merging if the signal was aborted meanwhile, so a resume after shutdown never touches a closed database. Reading the plan and applying its merges stay one synchronous step. A yield there would let a search save or an undo change works between the plan and its merges.
2. **The keyless drain becomes an async page walk outside the repository.** `groupKeylessWorks(repo, limit, { at?, skip?, signal?, pageSize? })` moves from the SQLite repository to `duplicateWorks.ts` and composes `groupableTitleKeys` with `groupTitleKeys`, which already opens its own transaction. Each page is now its own transaction, with a `setImmediate` yield after the key read and after each page. An aborted signal ends the walk at the next yield. `pageSize` defaults to `limit`, which was the page size until now. The contract `drainBatches` relies on is unchanged: at most `limit` merges per call, starting again from the first key each time. `BooksRepository.groupKeylessWorks` is removed from the port and the adapter.
3. **The boot, daily and `POST /books/works/group` run reads 50 title keys a page**, down from 100, for both the walk and the keyless drain. With the yields from 1 and 2, the largest block in the run becomes one read. On the 2026-10-24 numbers that is about 390 ms for the key read and 550 ms for the keyed-works read, against a 1088 ms worst case with yields alone. The walk keeps its 250 ms pause per page. That about doubles its pauses, to roughly 5 s per run. The keyless drain gets no pause, since it holds the write lock for one page at a time now instead of for the whole drain.
4. `drainBatches` passes the run's signal to its step as a second argument, so the keyless walk can stop at a page boundary. Steps that take only `limit` are unaffected.

Results are unchanged. The walk and the keyless fold both plan per title key. `planDuplicateSets` and `planTitleFolds` group by key, and a keyless candidate's editions all carry one key. So splitting the keys into smaller pages, or across transactions, merges the same pairs in the same title-key order. The existing tests already show this for the walk at `pageSize: 1` and for the drain at `limit` 1 against 250.

## Tests

- The walk yields between the key read and the merge step: a `setImmediate` queued during `groupableTitleKeys` runs before `keyedWorksWithTitleKeys`.
- The walk, aborted during that yield, merges nothing from the page and never reads its keyed works.
- Keyless grouping one key a page gives the same merges, in the same order, as one page over the rule-case fixture. No key read or `groupTitleKeys` call runs inside an open transaction, and a yield lands between each key read and its `groupTitleKeys`.
- Keyless grouping stops on an aborted signal, including one aborted during the key read.
- The works-grouping scheduler hands the keyless step the same signal it gives the duplicate pass.
- The existing keyless repository tests run through the new function and still pass unchanged in substance.

## After deploy

The parent session batches deploys. On the next boot after this merges and deploys:

- No `event loop stalled` above about 800 ms between +120 s and the end of the grouping run.
- `books:groupableTitleKeys` and `books:keyedWorksWithTitleKeys` roughly halve.
- `books:groupKeylessWorks` no longer appears. A slow keyless page shows as `books:groupTitleKeys`, logged only above 200 ms.

## Not in scope

- The SQL and indexes of the four grouping reads.
- `groupTitleKeys` taking `BEGIN IMMEDIATE` for a page that merges nothing.
- Search save's `groupTitleKeys` call, which reads at most 12 keys.
