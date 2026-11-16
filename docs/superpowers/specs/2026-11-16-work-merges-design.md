# Work merges and series ranking out of the books adapter

From the 2026-11-16 architecture review (candidate 2). `BooksRepository` (`backend/src/modules/books/domain/ports.ts:34-177`) has 141 methods and one adapter, `adapters/sqlite/sqliteBooksRepository.ts` (1,738 lines, the most-changed file in the backend). Two sets of domain rules live inside that adapter:

- **Work merging.** `mergeInto` (A:804-816) moves editions, carries the summary, refreshes the series author, marks and repoints `merged_into`, carries genre judgments and rejections (`carryGenreState`, A:797-802), re-applies the joined judgment and records the merge. Its callers are `groupTitleKeys` (A:836-849, which also runs `planTitleFolds` and the undone-merge veto), `mergeWorks` (A:1110-1122), `mergeDuplicateWork` (A:1124-1135), `addWorkAlias` (A:1137-1145) and `mergeTranslation` (A:1147-1155). `undoMerge` (A:1157-1171) branches on the merge source.
- **Series ranking.** `bestSeriesWithKey` (A:747-775) ranks stored series by `SERIES_SOURCE_RANK`, then `created_at`, and promotes an edition collection to an `ol-edition` candidate only when a `wikidata`, `hardcover` or `ol-subject` candidate already has the same name key. `searchSeries` (A:1612-1647) matches, aggregates and sorts in the adapter.

(A = `adapters/sqlite/sqliteBooksRepository.ts`. Line numbers as of `231b94f3`.)

## Decision

**No behaviour change.** Every existing test keeps passing with the same assertions; only their location changes.

### Series ranking is pure, in `domain/series.ts`

- `pickSeries(candidates: SeriesCandidateRow[], collections: CollectionRow[]): Map<string, SeriesEntry & { nameKey: string }>` takes the rows the adapter already loads, keyed by root work id, and returns today's `bestSeriesWithKey` result: the corroboration rule, the rank-then-`createdAt` sort, and the position taken from the first same-`nameKey` candidate that has one.
- `rankSeriesMatches(...)` takes the matched names and member rows `searchSeries` loads, and returns today's ordering: exact first, then member count, then best rank, with the lowest rank kept per work.
- The adapter keeps the SQL and the alias/canonical resolution, and calls these two functions.
- The ranking-rule tests move from the adapter test to `domain/series.test.ts` and run in-process: wikidata beats hardcover, `ol-edition` counts only when corroborated, ties go to the earliest row, and the search order. Adapter tests keep what needs SQLite: loading, alias and canonical following, and merge and undo following.

### Work merges get their own port and adapter file

- `domain/ports.ts` gets `interface WorkMerges` with the merge methods moved out of `BooksRepository` unchanged: `mergeWorks`, `mergeDuplicateWork`, `addWorkAlias`, `mergeTranslation`, `undoMerge`, `groupTitleKeys`, `undoneMergeAmong`, `activeMerges`. `BooksRepository extends WorkMerges`, so `repo.mergeWorks(...)` and every `Pick<BooksRepository, ...>` keep compiling.
- The new `adapters/sqlite/sqliteWorkMerges.ts` exports `createSqliteWorkMerges(db: DatabaseSync, shared: MergeHelpers): WorkMerges & { carryGenreState(from: string, into: string): void }`. It holds:
  - the merge-only statements, listed in the plan's Task 2. That includes the six genre-carry statements, plus its own copies of the four statements the books repository also keeps (`workLinkStmt`, `workStmt`, `aliasStmt`, `repointMergedStmt`);
  - the planner statements and their exported SQL constants (`GROUPABLE_KEYS_SQL`, `KEYED_EDITIONS_SQL`, `KEYED_WORKS_SQL`, `KEYLESS_CANDIDATES_SQL`). `groupableTitleKeys`, `keyedWorksWithTitleKeys` and `isSeriesName` go with them, also as `WorkMerges` methods;
  - `mergeInto`, `carryGenreState` and the methods above.
- `MergeHelpers` is what both sides need from the books repository: `inTransaction`, `refreshSeriesAuthor`, `applyJoinedJudgment`, `liveWorkId`, `insertWork`. `createSqliteBooksRepository` builds these first, calls `createSqliteWorkMerges(db, helpers)`, and spreads its methods into the returned object. That keeps one object for `timedMethods` and one `transaction`.
- `setWorkKey` stays in the books repository. It assigns a work key and folds an empty work without recording a merge. It uses the returned `carryGenreState`.
- `detachEdition` stays in the books repository too. It blocks title grouping but writes no merge.
- Callers that take a `Pick<BooksRepository, ...>` narrow their merge methods to `Pick<WorkMerges, ...>`: `duplicateWorks.ts` (:8, :81), `seriesMergeRepair.ts` (:14-17, :35) and `seed/awardBooksImport.ts` (:123). `translationJudgments.ts`, `translationBacklog.ts`, `translationReview.ts` and `saveHits.ts` take the whole `BooksRepository` and stay on it.
- Merge tests move from `sqliteBooksRepository.test.ts` to `adapters/sqlite/sqliteWorkMerges.test.ts`, which builds the real repository on SQLite `:memory:` the way `freshRepo()` does. The new test file is added to the explicit list in `backend/package.json`.

## Not in scope

- Splitting the rest of the 141-method port (covers, details, Jev, translations, awards). A later review can do it once this split shows the pattern holds.
- The `work_merges`/`merged_into` fragments inside unrelated read statements (A:95-96, 106, 236-237, 298, 542, 561-562, 606). They read merge state; they don't apply merge rules.
- Fakes. The port has one adapter, and tests keep the real SQLite stand-in.
