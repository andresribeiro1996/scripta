# Joining translations when their original arrives

## Problem

The translation job joins a Portuguese work to its original's work, but only when it plans that work. On 2026-10-20 the user agreed on a rule: when an original arrives in the catalog through any path, the Portuguese works that name it as their original get the translation job's free code step again.

Nothing does that today:
- `createBook`, `saveHits`, `findOrCreateBook`, the BNP import and the `fetch-originals` fill call no translation hook.
- A Portuguese work answered "none" (`work_match_judgments`, model `code` or Jev, `into_work_id` NULL) is planned again only in two cases:
  - by `translation-backlog.mjs --recheck-none`, 30 days after its answer;
  - when `fillIdentity` fills its own empty title or author.
- `fetch-originals`' `presentWorks` pass catches shelved works, but only when the script runs.

An original found by a reader's search therefore waits up to 30 days and a manual backlog run.

## Decisions

**From the user (2026-10-20, relayed by the starting session):**
- When an original arrives through any path, its claimants get the free code step again: catalog search (`saveHits`), `findOrCreateBook` and the library add, the BNP import, and the `fetch-originals` fill.
- The #317 guards are non-negotiable:
  - **Guard 1:** an original claimed by 3 or more distinct Portuguese titles per author surname is series-like, and `planMatch` returns `none`.
  - **Guard 2:** an edition title with a volume marker never settles in code.
- An owner's `manual` answer is final and is never reopened.
- Watch the cost. The catalog holds about 234k books, so finding the claimants of a new title must read pages in proportion to the answer. `originalTitleClaims()` is a full scan and must not run per insert.

**Builder's calls (Claude's, each open to the user's override):**
1. **Free step only.** The hook writes only when the plan is a `code` join. An `ask`, `none` or `original` plan leaves the work's answer as it was. Overwriting a Jev "none" with a code "none" would erase Jev's answer and restart its 30-day recheck clock for nothing. Paid re-asks stay with `--recheck-none` and the server's held-work job.
2. **All Portuguese works, held or not.** The rule names the works that claim the original, not only shelved ones. The step is free.
3. **The whole title must match, as in #323.** The matcher still drops a colon part (`normalizeTitle`) and a part after `". "` or `" - "` (`mainTitle`). The automatic hook therefore takes the #323 fill's two extra checks:
   - the claimant's original must not lose words to those cuts (`subtitle`);
   - the target work must hold an edition whose whole title equals the original (`sameWholeTitle`).

   Without them, an arriving "Dune: Messiah" would become the only candidate of a work whose original is "Dune", and join it.
4. **The #323 shared-original rule as well.** Guard 1 needs three distinct Portuguese titles, and it counts them by `originalKey`, which drops a colon part, so "Crónicas: Aurora" and "Crónicas: Crepúsculo" count as one.

   Take two Fairy Oak volumes:
   - Portuguese "Capitão Grisam" records the series name "Fairy Oak" as its original;
   - Portuguese "O Segredo das Gémeas" records "Fairy Oak: Il segreto delle gemelle".

   Guard 1 sees two titles and lets them through. An arriving Italian "Fairy Oak" would then become the only candidate of "Capitão Grisam", and join it.

   The hook skips a claimant when its bucket holds two or more distinct whole Portuguese titles, or two or more distinct whole originals. The bucket is the original key plus surname, over every claim of that key. That is the rule the user approved for the `fetch-originals` fill.
   - **The cost:** a classic with two differently titled Portuguese translations isn't joined on arrival. It waits for the backlog, as today.
   - Guard 1 still runs inside `planMatch`, unchanged. In the hook the stricter shared rule makes it redundant in practice, but it stays as the floor.
5. **Every title-key write counts as an arrival.** SQLite triggers record:
   - an insert with a title key;
   - an update that changes a title key;
   - a book's first Open Library work key (decision 6).

   That covers every path the user listed, including scripts in their own process (`fetch-originals`, `import-bnp`), plus `fillIdentity`, the lossy retitle job and `fillTitleKeys`.
   - Recording the key in each caller would miss the next writer someone adds.
   - Re-planning a claimant whose original was already present is harmless. It is the same step, with stricter checks, that the next backlog run would take.
6. **Join only into a work with an Open Library key.** Three paths create a work with no key: `findOrCreateBook` (the library add), the BNP import and ISBNdb search hits. The details and work-key jobs bring the key minutes later.
   - When `setWorkKey` then keys that book, `keyOwnWorkStmt` won't key a work that holds other editions (`sqliteBooksRepository.ts:119`). So the original moves to a new work and leaves the joined translation behind in the old one (`:808-824`).
   - The hook therefore skips a target work without `ol_work_key`.
   - A trigger on a book's `ol_work_key` going from NULL to a value queues its title key again, so the join happens once the work is settled.
   - **The cost:** an original that never gets an Open Library key is never joined by the hook. It waits for the backlog, as today.
7. **A queue, drained by the server.** The trigger writes the title key to a queue table. A server job drains it every minute, one transaction per key.
   - The join waits until the insert has committed.
   - A search request never pays for the join.
   - Writes made by another process wait for the server's next tick.
8. **A key version, not `user_version`.** The stored keys are recomputed whenever `ORIGINAL_KEY_VERSION` differs from the version the database records in its own one-row table.
   - The matcher-fix session ("Fix the translation matcher's lossy title keys") is changing `originalKey` and may take `user_version` 6.
   - A recompute gated on the column's absence would never run again after `originalKey` changes. Guard 1 and the shared rule would then read a stale subset and undercount.
   - A test pins sample `originalKey` outputs, and its message says to bump the constant.

## Design

### Finding claimants by index

**`books.original_key`** is a new column holding `originalKey(original_title)` from `domain/translation.ts`: `<normalizeTitle(mainTitle(o))>|<titleNumbers(mainTitle(o))>`. It is NULL when there is no original title or the key is null. A partial index covers it: `idx_books_original_key ON books(original_key) WHERE original_key IS NOT NULL`.

**The arrival key** is read from the arriving row's `title_key`.
- `title_key` is `ta:<normalizeTitle(title)>|<firstAuthor(author)>|<titleNumbers(title)>` (`domain/normalize.ts:118`). None of its three parts can contain `|`, because `normalizeWords` keeps only letters, digits and spaces.
- `arrivalKey("ta:t|a|n")` is `"t|n"`. It is null for a key that isn't `ta:` with exactly three parts.
- `title_key GLOB titlePattern(o)` holds exactly when `arrivalKey(title_key) === originalKey(o)`, since `titlePattern(o)` is `ta:<T>|*|<N>` with the same `T` and `N`. So `WHERE original_key = arrivalKey(title_key)` finds exactly the claims whose title-pattern search would see the new row.
- A test pins that equivalence on examples, colon, brackets, numbers and `". "` included. Any later change to one side then fails it.

**Guard 1 from the same index.**
- `seriesLikeOriginals(claims)` groups claims by `originalKey(claim.originalTitle)` plus surname. Built from every claim whose `original_key` is `K`, it therefore gives the same answer for any original with key `K` as when built from `originalTitleClaims()`.
- The hook checks that a claimant's evidence original has key `K` before planning it.
- `originalTitleClaims()` also reads originals out of summaries (`original_title || originalTitleIn(summary)`). For the subset to stay complete, every such original must already be stored in `original_title`:
  - the backfill first runs the same fill as `fillOriginalTitlesFromSummaries()` (NULL `original_title`, summary containing "tulo original", `originalTitleIn`);
  - from then on, every writer of `summary` already fills `original_title` from that summary when it is NULL: `mergeDetails` and `applySummaryCleanup`.

**Keeping `original_key` current.** Every writer of `original_title` writes `original_key` with it:
- `fillOriginalTitle`, and `fillOriginalTitlesFromSummaries` through the same statement: `SET original_title = ?, original_key = ?`, still only `WHERE original_title IS NULL`;
- `mergeDetails`: `original_key = CASE WHEN <takesSummary> AND original_title IS NULL THEN $original_key ELSE original_key END`. SQLite evaluates every SET expression against the old row, so this sets the key exactly when `original_title` goes from NULL to `$original_title`;
- `applySummaryCleanup` (`seed/summaryCleanup.ts`): the same `CASE WHEN original_title IS NULL` form.

Today no writer changes one non-NULL original title into another. The `user_version` 5 clear runs before the column exists, as described next.

**Backfill and recompute, in `connection.ts`.** `ORIGINAL_KEY_VERSION = 1` is appended to `domain/translation.ts`. A one-row table `original_key_version (version INTEGER NOT NULL)` comes from `books.sql`.

A new step runs last in `applyBooksMigrations`, after `clearNonTitleOriginals`. When the stored version differs from the constant, or no row is stored, one `BEGIN IMMEDIATE` does this:
1. adds the column when `PRAGMA table_info(books)` lacks it;
2. fills `original_title` from summaries, exactly as `fillOriginalTitlesFromSummaries()` does;
3. sets `original_key` to `originalKey(original_title)` on every row with an `original_title`, and to NULL on the rest;
4. replaces the stored version with the constant.

It logs `books: keyed N original titles`. Because it runs after every version step, the v5 clear can never leave a stale key behind. Then, on every boot, it creates the partial index (`IF NOT EXISTS`).

On a fresh database the column comes from `books.sql`. The step runs once over no rows and records the version.

### Recording arrivals

**`books.sql`** gets the queue table: `CREATE TABLE IF NOT EXISTS original_arrivals (title_key TEXT PRIMARY KEY)`.

**`connection.ts`** creates three triggers after the column checks, so that a very old database already has `title_key` and `ol_work_key` when they are made:
- `books_original_arrival`: `AFTER INSERT ON books WHEN NEW.title_key <> ''`, `INSERT OR IGNORE INTO original_arrivals (title_key) VALUES (NEW.title_key)`;
- `books_original_retitle`: `AFTER UPDATE OF title_key ON books WHEN NEW.title_key <> '' AND NEW.title_key IS NOT OLD.title_key`, with the same insert;
- `books_original_keyed`: `AFTER UPDATE OF ol_work_key ON books WHEN NEW.title_key <> '' AND OLD.ol_work_key IS NULL AND NEW.ol_work_key IS NOT NULL`, with the same insert.
  - `setWorkKeyStmt` writes the book's key before `setWorkKey` settles the work, in the same transaction, so the drain sees the settled work.

A NULL or empty title key, meaning an authorless or blank row, records nothing. A forward search can't find such a row either.

The existing test that drops `books.title_key` to simulate an old database (`sqliteBooksRepository.test.ts:1028`) has to drop these triggers first. SQLite refuses to drop a column a trigger names.

**Repository** (`domain/ports.ts`, `sqliteBooksRepository.ts`):
- `originalArrivals(limit: number): string[]` is `SELECT title_key FROM original_arrivals LIMIT ?`;
- `dropOriginalArrival(titleKey: string): void`;
- `originalClaimsOf(key: string): OriginalClaim[]` is `SELECT work_id, title, author, language, original_title FROM books WHERE original_key = ?`, mapped as `originalTitleClaims()` maps its rows. A test checks with `EXPLAIN QUERY PLAN` that it uses `idx_books_original_key`.

### The drain

A new module, `backend/src/modules/books/originalArrivals.ts`.

`joinArrivedOriginals(deps, limit)` takes `deps: Pick<TranslationDeps, "repo" | "sharesArena" | "now">`. It processes up to `limit` keys from `originalArrivals`, each in its own `repo.transaction` (`BEGIN IMMEDIATE`). For each title key:
1. `K = arrivalKey(titleKey)` and `surname = surnameOf(<the title key's author part>)`. When either is null, drop the key and move on.
2. `claims = repo.originalClaimsOf(K)`. When there are none, which is almost always, drop the key and move on.
3. Build `seriesLike = seriesLikeOriginals(claims)` (Guard 1) and `shared = sharedOriginals(claims)` (the #323 bucket rule, see Reuse).
4. Collect the claimant works: the canonical ids (`repo.canonicalWorkIds`) of the non-null `workId`s of the claims whose author names `surname` (`mentionsSurname([claim.author], surname)`). A code join needs the claimant to name the candidate's author, and the candidate is the arrival's work, so this keeps a generic title such as "Poems" from planning every claimant by other authors. Guard 1 and the shared rule still read all of the key's claims. Filter them through `repo.portugueseWorksNeedingMatch(ids, Number.MAX_SAFE_INTEGER, JEV_REJECTION_LIMIT, new Date(deps.now()).toISOString())`. That selects:
   - live works whose editions are all Portuguese;
   - that are unjudged, or that hold a `code` or Jev "none" answered before now;
   - that have fewer than the limit of Jev strikes.

   `manual` answers, and answers that name a target, are never selected.
5. For each selected work:
   1. Take `evidence = evidenceOf(repo.translationEvidence(id))`, `original = evidence.originalTitle` and `author = evidence.workAuthor || evidence.author`.
   2. Skip the work when any of these holds:
      - `original` is missing, or `originalKey(original) !== K`. The work's evidence uses another original, so this arrival doesn't touch its candidates, and the subset Guard 1 wouldn't be complete for it.
      - `normalizeWords(original) !== normalizeTitle(mainTitle(original))` (`subtitle`).
      - `shared(original, author)`.
   3. Otherwise, `plan = planMatch(repo, id, seriesLike)`, which runs Guard 1, Guard 2, the single-candidate rule and the surname check. Skip unless `plan.kind === "code"`.
   4. `target = repo.getWorkView(plan.intoWorkId)`. Skip unless `target?.olWorkKey` is set (decision 6) and `target.editions.some((edition) => sameWholeTitle(edition.title, original))`. Merges move editions into the target, so `editions` is all of them.
   5. `joinByCode(deps, id, plan.intoWorkId, at)` saves the `code` judgment and merges unless an arena holds both works. It is the code-join branch of `runCodeSteps`, extracted so both share it.
6. Drop the key.

An error inside a key's transaction rolls that key back, and the key stays queued. The error goes to `onError` with the title key and is logged at error level. The drain then carries on with the next key, so one failing key can't hold back the queue. The next tick retries it.

A tick stops starting new keys once 200 ms have passed (`ORIGINAL_ARRIVALS_TICK_MS`); the rest wait for the next tick. A key's counts join the tick's totals only once its transaction commits.

It returns `{ arrivals, claimants, codeMerges, codeBlocked }`:
- `arrivals`: keys processed;
- `claimants`: works planned in step 5.3;
- `codeMerges` and `codeBlocked`: what `joinByCode` reported.

**`startOriginalArrivals(deps & { info, onError })`** uses `startDetailsBackfill(run, onError, ORIGINAL_ARRIVALS_INTERVAL_MS)`, every 60 seconds, with `ORIGINAL_ARRIVALS_BATCH = 500` keys per tick.
- It logs `info({ ...steps }, "original arrivals joined")` when `codeMerges + codeBlocked > 0`.
- `plugin.ts` starts it with `{ repo, sharesArena, now: Date.now }` whether or not TypeSafe is configured or `heldWorks` is given, and stops it on close.

### Reuse

- `sameWholeTitle` is imported from `seed/originalsFill.ts`, where it lives today.
- The shared-original rule is a local `sharedOriginals(claims): SeriesLike` in `originalArrivals.ts`. It is the #323 fill's bucket (`originalsFill.ts:68-77,117-121`), copied for now.
  - The bucket key is `originalKey(originalTitle)#surnameOf(author)`, the same as `claimGroups`.
  - The bucket counts Portuguese claims whose `normalizeWords(title)` isn't empty and that aren't `sameMainTitle(title, originalTitle)`.
  - It is true when the bucket holds two or more distinct `normalizeWords(title)`, or two or more distinct `normalizeWords(originalTitle)`.
- The matcher-fix session asked that neither helper be moved on this branch. Its branch exports both from `domain/translation.ts` and replaces the fill's bucket. Whichever branch merges second switches the drain to those exports and drops the copy.
- `runCodeSteps` keeps its behaviour through `joinByCode`, extracted into `translationBacklog.ts`. It neither catches `WorkMergeError` nor adds a transaction, and it stays one `repo.transaction` around the judgment and the merge.

### Cost

- **Per insert or retitle:** one trigger `INSERT OR IGNORE` into a small table.
- **Per drained key with no claims:** a primary-key read plus an index probe that finds nothing, and the delete.
- **Per key with claims:** reads in proportion to its claims and their works. That is `planMatch`'s title and author candidates (index ranges), `getWorkView` for one target, and `portugueseWorksNeedingMatch` driven from the id list.
- **No whole-catalog read at run time.** The one full read is the backfill, at the deploy's first boot and again only when `ORIGINAL_KEY_VERSION` changes. The v5 clear already reads every `original_title` once on that boot.
- **No ISBNdb, no Open Library, no TypeSafe.**
- **A bulk insert** (a large BNP import) queues one row per new title key. At 500 keys a minute, a 155k-book import drains in about 5 hours, mostly as index probes that find nothing.

### Known limits

- **A race with the server's held-work job.** That job may be mid-Jev on a claimant when the drain joins it.
  - If Jev answers 0.9 or more, `decide` tries to merge, gets `WorkMergeError`, and rolls its whole transaction back, so the drain's `code` row stays.
  - If Jev answers below 0.9, its answer overwrites the `code` row while the work stays joined.

  The backlog has the same race today.
- **Not a catch-up.** Claimants whose original arrived before this deploy aren't planned until the backlog runs; only new arrivals trigger the hook.
- **Originals without an Open Library key** are never joined by the hook (decision 6).
- **A claimant whose own edition author doesn't name the arriving author** isn't planned. This is stricter than `planMatch`, which also reads the work author and the summaries.
- **A single key with very many claimants by the arriving author** runs to the end even past the tick budget, with one `planMatch` per claimant.
- **Coupling with the matcher fix.** If `originalKey` changes, bumping `ORIGINAL_KEY_VERSION` recomputes the stored keys at the next boot; the pin test says so.
  - If `titlePattern` or the `title_key` format changes, `arrivalKey` may need the same change. The equivalence test fails if one side changes without the other.
  - A migration that rewrites every `title_key` queues every changed row: about 234k keys, roughly 8 hours of draining, mostly index probes.

  That session has been told.

## Out of scope

- Fixing the matcher's colon and `". "` cuts. The matcher-fix session owns that.
- Re-asking Jev for `ask` plans.
- A one-time catch-up over originals already present.

## Runbook

No production command. The backfill and the triggers come with the next deploy.

After the batch deploy:
- The boot log shows `books: keyed N original titles` once. N should be roughly the number of books with an original title, a few tens of thousands.
- `startup:books-open` takes one extra full read of `books`, once.
- Afterwards, `original arrivals joined` lines show each join the hook makes. Every join is listed under "Merged" on `/admin/translations`, where it can be undone.
