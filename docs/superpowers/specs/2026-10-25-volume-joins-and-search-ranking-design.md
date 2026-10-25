# Volume-safe translation joins and search ranking

## Why

The user searched "lord of the rings" and opened the result. The work showed 14 editions, including *The Fellowship of the Ring* and *As duas Torres*. Goodreads keeps each volume, the one-volume omnibus and the box sets as separate works and never folds a volume into the omnibus. The user expects the same here.

The user also expects search to put a series' own books first, followed by related works:
- "lord of the rings" should show Fellowship, Two Towers and Return of the King first, then the omnibus and box sets.
- "harry potter" should show Rowling's 7 novels first. Today the top results are four unrelated books titled "Harry Potter", plus guides and posters.

This design covers both problems, in this order:
1. **Part 1, grouping.** A guard so that automatic translation joins never fold a volume into a whole. Then a reviewed repair of the joins that already did.
2. **Part 2, scorecard.** A Jev-graded answer key that measures search quality.
3. **Part 3, ranking.** Changes measured against that scorecard.

Ranking can't put the volumes first while two of them are hidden inside the omnibus, so Part 1 comes first.

## What went wrong (production, read 2026-10-25)

- **The merges.** Two Jev translation merges on 2026-10-20 folded whole keyed works into work `48275c0b-2ad8-467e-9415-9eb94c4411b6`, "The Lord of the Rings" (OL27448W):
  - `a5bf1a13-9e86-4769-b642-8a24f00add97` (OL27513W, Fellowship, "A Irmandade do Anel"), confidence 0.99.
  - `1e34a680-2955-467a-875a-6b9a2d2eb135` (OL27479W, Two Towers, "As duas Torres"), confidence 0.97.
- **Why Jev picked the omnibus.** BNP gave volume 1 the original title "The lord of the rings", which is the series name. It gave volume 2 "The lord of the rings-the two towers". The hyphen has no spaces, so `stem` doesn't cut it. Jev sees only titles, authors, publisher and description (`adapters/typesafe/jevWorkMatch.ts`). Nothing told it that the candidate is a series or an omnibus.
- **Existing guards didn't fire:**
  - The code step's series guard (`seriesLikeOriginals`) needs at least 3 distinct Portuguese titles.
  - `hasVolumeMarker` only knows `#N` and book/vol/livro/tomo/part followed by a number.
  - The Jev step has no guard of its own.
- **Follow-on contamination.** "The Lord of the Rings" now holds 15 editions. Besides the two merged works' editions, it has five more Portuguese editions:
  - Two keyless "A irmandade do anel" editions with original title "The fellowship of the ring" (9789721049789, 9789897773921).
  - "As duas torres" (9789897774706, original title "The two towers").
  - Keyless "A irmandade do anel" 9788483026823.
  - Three "O senhor dos anéis" editions, BNP collection Contemporânea #52/#54/#56. Their original title is "The lord of the rings", and they may be genuine one-volume editions or volumes.

  Most of these arrived through title-key folds or other merges that followed the bad ones.
- **Series data on the omnibus is wrong.**
  - The omnibus work carries a Wikidata `work_series` row "The Lord of the Rings", position 2. That is the Two Towers position.
  - Return of the King ("O regresso do rei", `adc3706d…`, OL27455W) is correctly a separate work, position 3.
  - The Fellowship has no series row.
- **A separate Portuguese Fellowship work exists.** "A Irmandade do Anel - O Senhor dos Anéis - Parte I" is work `e2ae6929…`.
- **The pattern is wider than Tolkien.** Other active merges show it too:
  - "Anúncio de um crime" was joined into the omnibus "Murder on the Orient Express / A Murder is Announced".
  - Split volumes were joined into the whole novel: "Os Miseráveis I", "O Conde de Monte Cristo I/II" (manual), "A Coisa - Livro 1" into *It*.

## Decisions the user made

- **Split volumes are works of their own.** When a Portuguese publisher splits one novel into numbered books ("Os Miseráveis I" and "II"), each is its own work, as on Goodreads. They are not editions of the whole novel.
- **Unsure joins go to review, and Claude decides them.** When the guard can't tell whether a translation is a volume or the whole thing, the join goes to the existing translations review queue, and Claude decides it there.
- **Ranking is in scope.** Search ranking is fixed in this same effort, after the grouping.
- **Jev builds the scorecard; it doesn't rank live.** Jev grades a fixed set of queries once, and code ranking is measured against those grades.
- **The scorecard is sized and run this way:**
  - about 150 queries from outside sources, with 50 held back so the ranking isn't fitted to the tuning books;
  - grading runs on the production server over `railway ssh`;
  - scoring runs locally on a snapshot.
- **Popularity signals:** start with the free ones (editions, languages, has-a-cover) plus the Wikidata Wikipedia count. Scripta readers were dropped: the user pointed out Scripta has almost no users, so the count can't move a score and would add library-module plumbing. The scorecard decides which stay. Open Library reader counts and Hardcover come later, and only if the scorecard shows famous books still ranking too low.

## Goals

1. No automatic translation join (code step, Jev step, original-arrivals drain) folds a numbered volume into an unnumbered work.
2. Automatic joins that look like "volume into series" or "anything into an omnibus" are not merged. They wait in the translations review queue.
3. The existing wrong joins are undone in production, after review:
   - the Tolkien ones;
   - the split-volume ones;
   - every other active `code`/`jev` merge the guard flags that Claude judges wrong.

   The Fellowship (OL27513W) and Two Towers (OL27479W) works exist again with their own editions, and the omnibus keeps only one-volume, omnibus and box-set editions.
4. A repeatable scorecard prints a per-query and an overall search-quality score for the current code, against production catalog data.
5. Ranking changes raise the scorecard's overall score, and the two user examples come out right:
   - "harry potter": Rowling's 7 novels at positions 1–7, in reading order.
   - "lord of the rings": Fellowship, Two Towers, Return of the King at positions 1–3, followed by the omnibus and box sets ahead of guides and calendars.

## Non-goals

- A blanket rule that works with different Open Library keys never merge. Most of the ~1,040 such active merges are correct translations.
- A series page or series card. Results stay ordinary rows; only the order changes.
- Ranking or re-ordering outside results (Open Library, ISBNdb). They still come after ours, unchanged.
- Live Jev calls during search.
- Logging what people tap after searching.
- Open Library reader counts and Hardcover in this round, unless the scorecard calls for them.
- Changing which series sources exist or how they're ranked against each other (`domain/series.ts`).

## Anti-goals

- **The guard must not break the bulk of correct joins.** If it flags hundreds of the existing active cross-key merges, its rules are too broad. The expected flag count is dozens.
- **No production writes, and no moving `production`, without the user's go-ahead.** Repairs ship as runbook entries. A deploy hold is in force until the pre-2002 BNP import session announces it has finished, expected around 21:00Z on 2026-10-25.
- **No API change that an installed app can't handle.** Response fields are not removed. New fields, if any, are optional.
- **Search must not get noticeably slower.** Measure it on production-sized data (see `sqlite-planner-traps-at-scale`).

## Part 1: grouping

### The guard

There is one check, applied wherever an automatic translation join is about to merge:
- `decide` in `translationJudgments.ts` (the Jev and code plans);
- `joinByCode` in `translationBacklog.ts`, which the code steps and `originalArrivals.ts` reach.

Manual merges from the review queue skip the check.

The check takes the Portuguese work (its title and original title) and the target work. It returns one of three answers.

**Never join (no merge, and no review entry).** The Portuguese title's main part, before any spaced dash, carries a volume number. The target's title doesn't carry the same number.
- Volume numbers include today's `hasVolumeMarker` forms plus a trailing Arabic or Roman numeral I–X after the main title:
  - "Os Miseráveis I";
  - "O Conde de Monte Cristo II";
  - "A Coisa 1".
- "Henrique V" into "Henry V" still joins, because the number matches.
- "Fahrenheit 451" still joins.
- "Os Miseráveis I" may still join a target whose title carries the same number ("Les Misérables I"). The rule compares numbers; it doesn't ban numbered works from joining.
- The saved judgment records no target, so the steps don't keep re-asking.
- A never-joined volume stays its own work. Its other editions gather under it through the existing title-key fold. There is no new volume-to-volume matching path (Claude's call).

**Review (no merge; the judgment keeps its target and confidence so the row shows in the review queue).** Any one of these:
- **Series target.** The target's title, normalised, is the name of a series (`work_series`) or collection (`book_collections`), and that series or collection has at least one member work other than the target.
  - This catches "The Lord of the Rings".
  - `isSeriesNameStmt` is a starting point, but it doesn't check for other members.
  - Compare on the same key the series tables store (`name_key`), computed from the target's title.
  - Members are canonical works only (`merged_into IS NULL`), other than the target. A collection's members are the canonical works of its member editions.
  - Publisher collections like "Contemporânea" count too. A target titled exactly like a publisher collection is rare, and a false flag only costs a review (Claude's call).
- **Series-name original title.** The Portuguese work's original title, normalised, equals such a series or collection name.
- **Omnibus target.** The target's title names several books and the Portuguese title doesn't. That means one of:
  - two titles joined by " / ";
  - an omnibus word: box set, boxed set, omnibus, trilogy, collection, trilogia, coletânea, obra completa, or a "books 1-7" style range.
- **Volume in the subtitle.** The Portuguese title has a volume number only after a spaced dash ("A Irmandade do Anel - O Senhor dos Anéis - Parte I"), and the target has no number. This may be a split volume, or it may be the volume work itself, so a reviewer decides.

**Join.** Everything else, as today.

Facts the builder must verify before relying on them:
- **What happens to a high-confidence judgment that wasn't merged.** It shows in the review queue's "blocked" group (`translationReviewRowsStmt`). Confirm nothing else merges such judgments later, such as a backlog recheck or a sweep. If something does, the guard must also stop that path.
- **Re-asking cost.** The 30-day backlog recheck re-selects only judgments with no target.
  - A `never` work is re-asked monthly, and the guard must stop it again. Record that cost.
  - A `review` work keeps its target and waits in the queue.

The review queue doesn't store or show the guard's reason; no schema or response change. Guard reviews sit in the existing "blocked" group, and the reviewer sees titles, original titles and the proposed target (Claude's call).

### Repair

- **List.** A read-only listing gives, for every active (not undone) `code` and `jev` merge, the answer the guard would give today. It shows the from-work, the into-work, the titles, the original titles, the collections and the confidence. Flagged merges go to review.
- **Claude decides each flagged merge**, applying the user's rules:
  - split volumes stay apart;
  - a volume never sits inside its series or omnibus;
  - a genuine one-volume or omnibus translation may stay.
- **Undo** uses the existing tool: `undo-series-merges.mjs --undo` → `undoReviewedMerges`. It undoes newest-first, refuses onward-joined targets, and writes a `manual` null judgment so the step won't rejoin.
- **Follow-on merges.** For each undone merge, also undo the later merges into the same target whose moved editions belong with the restored work:
  - the title-key folds;
  - the "fellowship"/"two towers" editions listed above.

  The builder works out how to identify these from `work_merges.moved_book_ids` and title keys, and shows the list for review before writing an undo file.
- **Series rows.**
  - Find which work holds the position-2 row. Rows stay on the work they were written to, and the fill writes to the current work of the ISBN's edition.
  - Remove any wrong row from the omnibus.
  - Add Fellowship position 1 and Two Towers position 2 directly in the undo file. Rerunning the Wikidata fill is not an option: a real run needs a reviewed skip list.
- **The Portuguese Fellowship work.** Decide in review whether "A Irmandade do Anel - … Parte I" (`e2ae6929…`) and the restored Fellowship belong together. They probably do, since the Fellowship itself is "Part I". If so, use a manual merge.
- **"O senhor dos anéis" editions.** Decide them in review, using page count, collection numbering and BNP data, as either one-volume or volume. Move the volumes to their volume works.
- **Commit the review artifact.** Claude's decisions are committed in the repo, reviewable like earlier repairs:
  - the undo JSON file;
  - a short markdown table of each flagged merge with its decision and reason.
- **Ship it all as one runbook entry,** run by the user after the guard is deployed. Use read-only dry runs and expected counts, as in earlier repairs. Hand it over per `batch-deploys-one-runbook`.

### Tests (Part 1)

- **Unit tests for the guard,** one per answer:
  - "Os Miseráveis I" → "Les Misérables" never joins;
  - "Henrique V" → "Henry V" joins;
  - "A Irmandade do Anel" with original "The lord of the rings" → a work titled "The Lord of the Rings" that heads a series with other members goes to review;
  - "Anúncio de um crime" → "Murder on the Orient Express / A Murder is Announced" goes to review;
  - "Parte I" in the subtitle goes to review.
- **Integration tests through `matchWork` and `joinByCode`:** no merge is written when the guard says review or never join, and the review queue lists the review cases.

## Part 2: scorecard

- **Query set.** About 150 queries, committed to the repo. None comes from Scripta's own data: users' libraries are too few to be useful, and taking queries from our catalog's most-edition works would bias the test toward the edition-count signal.
  - **50 hand-picked by Claude:** series names, famous authors and titles, short or ambiguous queries ("dune", "it", "1984"), in Portuguese and English. They include "harry potter", "lord of the rings", "senhor dos anéis" and "saramago".
  - **50 from public lists:** Wikipedia's best-selling books and best-selling book series.
  - **50 Portuguese:** recent bestsellers from Portuguese charts (Bertrand, Wook, Fnac) and well-known Portuguese authors.
  - The user may add queries later.
- **Hidden set.** The queries are split once, at random, into 100 for tuning and 50 held back. Each source keeps its share in both parts. The split is committed with the queries.
  - Ranking work looks only at the tuning scores.
  - Before a ranking PR merges, the held-back 50 are scored too.
  - A change that raises the tuning score but not the held-back score has been fitted to those books. It doesn't ship.
- **No per-query rules.** The ranking never names a book or a query; there is no "if the query is X, show Y".
- **Candidates per query.** About 40 works, chosen independently of any ranking version: the union of
  - the top FTS hits deduplicated by work;
  - the members of any series whose name matches the query;
  - the works with the most editions among the FTS hits.
- **Grades.** Jev grades each (query, work) pair with a three-way choice:
  - "a book this query names" (gain 2);
  - "related to it" (gain 1);
  - "unrelated" (gain 0).

  Each gain is weighted by Jev's confidence. Grades are saved by work id and committed as the answer key.
- **Where grading runs.** On the production server, through a script piped over `railway ssh` as in today's read-only checks. The user chose this because no local TypeSafe key exists.
  - The script reads candidates read-only, calls Jev with the server's key and prints the grades. Claude commits them.
  - Nothing is written to production or deployed, and the key never leaves the server.
  - Grading pulls candidates from the live catalog, so it has to wait for the pre-2002 BNP import to finish. It may run during the deploy hold, which only stops deploys.
- **Score.** NDCG@10 per query, the mean for the tuning set and the mean for the hidden set. It is computed by running the branch's ranking code against a local snapshot of the production catalog, read-only. Production can only run deployed code, which is why scoring is local.
- **Unlabelled works.** The score treats unlabelled works in a top 10 as unrelated, and lists them so they can be graded and added.
- **The first run is the baseline** and goes in the PR description.
- **Cost.** About 6,000 Jev calls once (about $6 at earlier rates), plus top-ups. Record the actual spend.

## Part 3: ranking

The ranking applies in both search modes:
- by work (`by=work`, used by the mobile Search tab);
- by edition (the add-book flows), which orders editions by their work's rank.

Changes, each measured against the scorecard:

1. **Rank works, not editions.**
   - Pull enough FTS hits to see the real candidates. Today's 100-row scan can miss "Harry Potter e a Pedra Filosofal" behind dozens of short "Harry Potter" titles.
   - Score each canonical work once.
2. **Series first.** When the query matches a series name, that series' member works lead, ordered by position (Claude's call on the details):
   - **What counts as a match.** The comparison ignores one leading article (the/a/an/o/os/as/um/uma) on both sides.
     - An exact match (the query equals the series name) always leads.
     - A whole-word prefix match (a query of at least 3 characters) leads only when no work's title exactly matches the query.
   - **Several series match.** Pick the one whose key equals the query exactly. Then prefer the one with the most canonical member works, then the higher-ranked source (`domain/series.ts`).
   - **Members are fetched from the series tables,** whether or not FTS found them. Members without a position come after the numbered ones.
   - **Non-member works with matching titles** (the other "Harry Potter" books) come after all members.
3. **Then text match combined with how well known the work is.** Candidate signals, each kept only if it raises the overall score without making any of the hard examples wrong:
   - number of editions;
   - number of distinct edition languages;
   - has a cover;
   - the Wikidata Wikipedia (sitelink) count.

   The Wikipedia count needs a new nullable column on `works`, filled by a one-off script from Wikidata via Open Library work keys. It reuses the series fill's Wikidata access and keeps label lookups out of paged queries (`wikidata-label-optionals-slow`). It is refreshed by rerunning the script, with no nightly job.

   Details on the Wikipedia count (Claude's call):
   - A null count adds nothing, the same as zero.
   - The column comes in through the usual schema migration. Merging it to `main` is fine during the deploy hold. Only the deploy waits.
   - A merged work's count is read through its canonical work.

   Edition-mode details (Claude's call):
   - Each work's editions stay together, in today's within-work order.
   - Series-first applies here too.
   - Result caps stay as they are (`SEARCH_LIMIT` 12, `WORK_SEARCH_LIMIT` 20). Only the catalog's own scan size before ranking grows. It gets its own constant, because `WORK_SCAN_LIMIT` also drives the games search.
4. **The hard examples** ("harry potter", "lord of the rings", and "dune", where an exact famous title comes first) are unit tests on a fixture, as well as scorecard queries.

The current spec `2026-10-20-series-in-search-design.md` lists "sorting results by series position" as a non-goal. This design supersedes that line.

## Left to the builder

- The exact numeral and omnibus-word lists, within the rules above.
- The ranking formula and weights, as long as the scorecard and the hard examples drive them.
- How to get a local snapshot of the production catalog: a Litestream restore, or a copy over `railway ssh`. Either way it must be read-only.
  - `covers.sqlite` is about 500 MB, plus a 100 MB WAL.
  - Take the snapshot only after the pre-2002 BNP import has finished. A large read during the import risks the cross-process starvation in `sqlite-cross-process-starvation`.
- PR shape. Claude's call: three PRs in order, one per part, each to `main`.
- If the snapshot or the grades are not yet available, Part 3 can still be built against the fixture and the hard-example tests. Its PR waits for the scorecard numbers before merging.
