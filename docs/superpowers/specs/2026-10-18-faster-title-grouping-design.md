# Faster title-key grouping

## Why

The national bibliography import (spec `2026-10-18-national-bibliography-import-design.md`) adds about 240k keyless editions. Its scale check failed on `groupKeylessWorks(250)`: every call took 0.85–1.7 s (p50 1.1 s, 547 of 726 calls over 1 s) on an M1 Pro, and a call that merges nothing still took 0.9 s. Each call holds the write lock (`BEGIN IMMEDIATE`) and blocks the event loop for that long. The production import steps are blocked until grouping passes the same check.

Almost all of a call is the `groupablePairsStmt` SELECT. Its `candidates` CTE groups every live keyless work on every call, so its cost tracks the catalog size, not the limit: 1.4 s for `LIMIT 1`, 250 or 1000.

## Goal

Each `groupKeylessWorks(250)` call on the scaled copy (dev `covers.sqlite` plus 240k synthetic keyless books, about 4 editions per title key) is under 1 s, aiming for under 200 ms (the stall-log threshold). On that copy, a call with nothing to merge takes tens of milliseconds, not a second.

## Non-goals

- No change to which source merges into which target, to `mergeInto`, to the drain loop in `startWorksGrouping`, or to the nightly schedule.
- No state kept between runs (no watermark of "works changed since last run"). Too many paths change grouping inputs (new editions, `fillTitleKeys`, `fillIdentity`, mojibake repair, detach, undo, `setWorkKey`); missing one would silently stop grouping.

## What stays the same

The rules, exactly as `groupablePairsStmt` states them today:

- A **candidate** is a live keyless work whose editions all carry the same non-empty title key, none of them blocked (`title_group_blocked_at`).
- A candidate joins the **single live keyed work** that has an unblocked edition with its title key.
- With two or more such keyed works it is skipped.
- With none, every candidate joins the **oldest candidate** with that key (`created_at`, then id), and the oldest stays put.

The set of all pairs the new code finds equals the set the current SELECT finds, at any state of the catalog. Within one title key, sources still merge oldest first, also across batches.

## The change

1. **Only title keys shared by two or more works can produce a pair.** A source and its target are distinct works that both hold an edition with that key. A covering index on `books(title_key, work_id)` lets one index-only pass find those keys (`GROUP BY title_key HAVING COUNT(DISTINCT work_id) > 1`) without touching table rows.
2. **Work through those keys in title-key order and stop at the limit.** Each call takes the next `limit` shareable keys after a cursor. It runs today's three CTEs restricted to the works holding an edition with one of those keys, and repeats until it has `limit` pairs or runs out of keys. Early in a drain the first 250 keys yield the batch. Once the drain is done, a call is one index pass plus the pairs query for every key that is shared but never pairs: a key held by two keyed works, a mixed-key work, blocked editions. Each of those costs about 15 µs per call.
3. **Pairs come back ordered by title key, then source `created_at`, then source id.** Today they come back by source `created_at` across all keys.

The covering index replaces `idx_books_title_key`. Every other query that reads `title_key` (`GLOB` prefixes, `IN`, `IS NULL`) uses the same leading column.

## The one visible difference

Which pairs land in which batch changes: batches now walk title keys in order instead of taking the globally oldest sources. After a full drain the merges, moved editions, aliases and work rows are the same.

The one exception: a keyed work that gathers sources under two or more different title keys in one drain may take them in a different order. Order only matters there for the first-wins carries in `mergeInto`: work summary (`carryWorkSummaryStmt`), empty title or author (`fillWorkFromEditionsStmt`) and genre judgment or rejection (`carryGenreState`). Keyless targets only ever gather sources under their own key, so they're unaffected. Today's order is no more deliberate. It already depends on when editions arrive between nightly runs.

## Measured with a prototype (240k copy, same machine)

| | Today | Prototype |
|---|---|---|
| SELECT, first batch of 250 | 1,400 ms | 18 ms |
| Call with nothing to merge (drained copy) | ~900 ms | 30 ms |
| All pairs on the undrained copy | 181,132 | 181,132, the same set |
| Building the covering index at boot (240k books) | — | 0.64 s, once |

The scale check also drained a production-shaped copy, which is deliberately pessimistic: 318k books, 37k keyed works, and 14k title keys left shared but never pairing after the drain. There, a call took p50 250 ms and max 446 ms (old code: 1,385 ms and 6.4 s). A no-merge call took about 280 ms (old code: 1,011 ms). That is under 1 s but over the 200 ms stall-log threshold. A covering index on `works` would cut the stuck-key part by about 25%, and bigger key chunks change nothing, so neither went in. Production's count of such keys is unknown; the PR gives the query to count them.

A shareable-key pass through the existing `idx_books_title_key` reads table rows for `work_id` and takes about 400 ms. That's why the index changes.

## Verification

- The existing grouping tests stay green unchanged. The migration test that drops `idx_books_title_key` to drop its column names the new index.
- New tests pin today's behaviour and pass on the current code before the change: a fixture with every rule case, pairs read from `work_merges`; a stuck shareable key (two keyed works) sorted before a real pair with `limit` 1; draining in batches of 1 gives the same pairs as one large call, oldest first within a key.
- Scale check on the 240k copy: per-call times for the whole drain, a no-merge call, and the final `books`, `works` and `work_merges` state compared with a drain by the current code.
