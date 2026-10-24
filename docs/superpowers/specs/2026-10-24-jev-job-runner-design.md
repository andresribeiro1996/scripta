# One Jev job runner

From the 2026-10-24 architecture review (candidate A). Genre, synopsis and translation judgments each carry their own copy of the machinery around a Jev call:

- **The failure ladder** in `classifyWork` (`genreJudgments.ts:53-66`), `classifyText` (`synopsisJudgments.ts:47-60`) and `matchWork` (`translationJudgments.ts:97-110`): a book failure records a strike and moves on; a spent budget pauses until the next UTC midnight; an outage pauses 10 minutes; a 401 alerts and pauses 24 hours; anything else is rethrown. Only the alert copy and the strike store differ.
- **The live jobs** `startGenreJobs`, `startSynopsisJobs`, `startTranslationJobs`: an alert quiet window of 24 hours, a budget-spent info line logged once per pause, a held-works set cached for a minute, a work queue of 4, and a daily sweep. Constants `OUTAGE_PAUSE_MS`, `KEY_PAUSE_MS`, `HELD_CACHE_MS`, the sweep interval and limit, and the `heldCanonical` helper are redeclared in each file.
- **The backlog runners** `runGenreBacklog`, `runSynopsisBacklog`, `runTranslationBacklog`: 4 workers over a shared cursor, stopping at the first pause and naming its cause. The `"done" | "budget" | "outage" | "key"` type is declared three times, `IN_FLIGHT` and `COST_PER_REQUEST_USD` three times, and the cost formula three times.

Translation's backlog also imports `JEV_REJECTION_LIMIT` from `synopsisJudgments.ts`, as do `originalArrivals.ts` and `seed/originalsFill.ts`.

## Decision

A new `backend/src/modules/books/jevJobs.ts` owns the machinery. Each family keeps only what is its own: which works or texts to pick, the needs-judgment check, building the Jev input, saving the answer, its strike store, its alert copy, and its reports and dry runs.

**The failure ladder.** `jevPause(error, deps, keyAlert, strike)` returns the time to resume, or `null` after a strike, and rethrows anything that is not a TypeSafe failure. Its `deps` carry `now`, `alert` and an optional `onPause(kind, until)`. Every family's catch block becomes one call to it.

**The live jobs.** `startJevJobs(deps, job)` builds the queue, the held cache, the quiet-window alert and the daily sweep. `job` names the family's `source`, its budget-spent message, its sweep query and its `judge`. The runner hands `judge` a `held()` lookup and pause deps whose `onPause` logs a spent budget once per pause. Each `start*Jobs` becomes a call to `startJevJobs`. Translation keeps its 10-minute `seriesLike` cache inside its own `judge` closure. Every family's sweep gets the same injectable `timers`, which only genre has today.

**The backlog runner.** `runJevBacklog(items, judgeOne)` runs 4 workers and stops at the first pause. The stop reason is the kind that `onPause` reported for that item, so a concurrent item's failure is never blamed (the per-item attribution synopsis and translation already use; genre moves to it). `JevStop` replaces the three stop types, and `jevCostUsd(requests)` replaces the three cost formulas.

**Constants.** `JEV_IN_FLIGHT = 4`, `JEV_REJECTION_LIMIT = 3` and the pause, cache, sweep and cost constants live in `jevJobs.ts`. `GENRE_REJECTION_LIMIT` stays separate, since it counts strikes in another table.

## Behaviour changes

- Genre's budget-spent info line gains the `source` field the other two already log.
- Genre's backlog attributes a stop to the item that caused it. Its test at `genreBacklog.test.ts:87` already checks that outcome.
- Translation gains tested outage, single-alert and budget-logged-once behaviour; synopsis and translation gain injectable sweep timers. The behaviour already matched; only genre was tested.

## Not in scope

- Merging `genre_rejections` into `jev_rejections`. That needs a production migration; `jevPause` takes the strike as a callback instead.
- The `start*JobsIfConfigured` functions. They stay per family: each is three lines naming its classifier, source and budget.
- The backlog scripts' command-line interfaces and report shapes.
- The scheduler for the books module's other jobs (candidate E, its own spec).
