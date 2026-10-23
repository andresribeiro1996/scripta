# Original arrivals: whole-title claim keys

PR #325's drain re-runs the translation code step for Portuguese works when their original arrives. It finds those works through `books.original_key`, the Guard 1 stem of their stored original title, which cuts at `" — "`, `" – "`, `" - "` and `". "`. The arriving book is looked up by its title key, which keeps those parts.

So an arriving "Mr. Mercedes" (arrival key `mr mercedes|`) never reaches the works whose original is "Mr. Mercedes" (stored under `mr|`). After #333 those works pass the drain's subtitle rule and the matcher would find the arrival, so the lookup is the only thing missing. This is a miss, not a wrong join: the fill and the backlog join them today.

## Rules that do not change

- **Guard 1** (non-negotiable): an original claimed by 3 or more distinct Portuguese titles per author surname is series-like, and `planMatch` returns `none`. It is computed over every claim of the claimant's stem key, as the full scan does.
- **Guard 2** (non-negotiable): an edition title with a volume marker never settles in code.
- An owner's `manual` answer is final.
- The drain writes only `code` joins, only into a target work with an Open Library key, and only when that work holds an edition carrying the whole original title (`sameWholeTitle`).
- The #323 shared-original rule and the drain's subtitle rule are unchanged.
- Reads stay in proportion to the answer: no catalog scan per arrival.

## Decisions

### The whole key

- `domain/translation.ts` exports `originalWholeKey(title)`: `` `${normalizeTitle(title)}|${titleNumbers(title)}` ``, or `null` when `normalizeTitle(title)` is `""`.
- `originalKey(title)` becomes `originalWholeKey(stem(title))`. That is today's definition, so its output is unchanged and its pin test stays as it is.
- For any title `t` and an author with a non-empty first author, `arrivalKey(catalogTitleKey(t, author)) === originalWholeKey(t)`. Both are built from the same `normalizeTitle` and `titleNumbers` of the whole title. A test pins this on ". ", dash, colon, bracket and number titles.
- The two keys differ only when the stem cut drops words that `normalizeTitle` keeps: usually a part after `". "` or a dash outside a colon part, and sometimes a `". "` inside brackets ("Le Petit Prince (Ed. illustrée)"), which the subtitle rule then skips.

### Storage

- **A new column, `books.original_whole_key`,** holds `originalWholeKey(original_title)`. It is NULL when there is no original title or the key is null.
  - `books.sql` declares it for new databases.
  - `applyBooksMigrations` adds it to existing ones with the other added columns, so it doesn't depend on a version change.
- **A partial covering index:** `idx_books_original_whole_key ON books(original_whole_key, original_key) WHERE original_whole_key IS NOT NULL`. The drain's stem lookup reads only the index.
- **Every writer of `original_title` writes both keys in the same statement, under the same condition as `original_key`:**
  - `fillOriginalTitle` and `fillOriginalTitlesFromSummaries` (`fillOriginalTitleStmt`);
  - `mergeDetails` (`mergeDetailsStmt`);
  - `applySummaryCleanup` (`updateBook`);
  - the `ORIGINAL_KEY_VERSION` backfill. It also selects rows with a non-null `original_whole_key`, so a later version change clears a stale whole key with its title.
- **No version bump.** `originalKey` doesn't change, so no stored `original_key` is stale. The new column starts NULL everywhere, and the boot self-heal below fills it. Production has run #325, so its stored version is already 1.
  - The pin test is extended to `originalWholeKey`. A change to either key, including a change to `normalizeTitle` or `titleNumbers`, must bump `ORIGINAL_KEY_VERSION`; the backfill recomputes both.

### The boot self-heal

- `UNKEYED_ORIGINALS_SQL` selects `id, original_title, original_key, original_whole_key` from books where `original_title IS NOT NULL AND (original_key IS NULL OR original_whole_key IS NULL)`.
- **Its partial index is renamed** `idx_books_original_keys_missing`, with that same `WHERE`. The boot drops `idx_books_original_key_missing`. `CREATE INDEX IF NOT EXISTS` can't change an existing index's `WHERE`, so keeping the old name would leave production with the old index and a full scan every boot.
- It computes both keys and writes a row only when one of them differs from what is stored.
  - A title whose stem key is null but whose whole key isn't, such as `". Foo"`, is read at each boot through the index, as today, but is written only once.
- `books: keyed N original titles` counts the rows written. On the first boot after this deploy, N is about the number of books with an original title.

### Repository

- `originalKeysOf(wholeKey: string): string[]` in `domain/ports.ts` and `sqliteBooksRepository.ts`.
  - Its SQL is the exported `ORIGINAL_KEYS_OF_WHOLE_SQL`: `SELECT DISTINCT original_key FROM books WHERE original_whole_key = ? AND original_key IS NOT NULL`.
  - It returns the stem keys of the stored originals whose whole key is `wholeKey`.
  - A test checks with `EXPLAIN QUERY PLAN` that it uses `idx_books_original_whole_key`.
- `originalClaimsOf(key)` is unchanged and still reads by stem key.

### The drain (`originalArrivals.ts`)

For each queued title key, with `K = arrivalKey(titleKey)` and the surname as today:
1. Collect `stems`: `K` itself first, then `repo.originalKeysOf(K)`, deduplicated.
2. For each stem `S`, read `claims = repo.originalClaimsOf(S)`. When there are none, go to the next stem. Otherwise run the claimant step with `K`, `S`, the surname and `claims`.
3. Drop the key, in the same transaction as today.

**In the claimant step,** a claim *arrived* when `originalKey(o) === K || originalWholeKey(o) === K`, where `o` is its original title.
- `seriesLike` (Guard 1) and `shared` (#323) are built from all of `S`'s claims. That is exactly the full scan's group for every claimant of stem `S`, so Guard 1 stays exact.
- The claimant works come only from the arrived claims whose author names the surname. A claim of `S` whose whole original didn't arrive, such as "Mr. Harrigan's Phone" when "Mr. Mercedes" arrives, is not read further.
- A selected work is skipped, in addition to today's subtitle and shared checks, unless its evidence original `o` has `originalKey(o) === S` and arrived.
  - The first condition keeps Guard 1's subset complete for it.
  - The second keeps this arrival from planning a work whose evidence names another original.
- Everything after that is today's: `planMatch`, the code-only filter, the target check and `joinByCode`.

**When `S === K`,** every claim of `S` arrived, so the step does exactly what it does today.

**A work is planned at most once per arrival.** Its evidence original has one stem key, so it passes the stem check in one group at most.

### Cost

- **Per arrival with no claims:** one more index probe, on `idx_books_original_whole_key`, which finds nothing.
- **Per stem found through the whole key:** that stem's claims are read by `idx_books_original_key`. That is the group Guard 1 needs. Only the arrived claims by the arriving author are read further.
- **No new full read at run time.** The deploy's first boot builds two partial indexes, one full read of `books` each, and writes the whole key once per titled row through the self-heal. Later boots add an index probe.

## Known limits

- **Dash originals are found but still skipped.** "The Trials of Apollo - The Dark Prophecy" arriving whole now reaches its claimants, but `normalizeWords(o) !== normalizeTitle(mainTitle(o))` still skips them as subtitle originals.
  - #325 decision 3 set that rule, and #333 kept it. Loosening it is a separate decision for the user.
  - A test pins today's behaviour.
- **One author's originals that share the part before a full stop count as one shared original.** "Mr. Mercedes" and "Mr. Harrigan's Phone" both have the stem `mr|`. With a Portuguese claimant for each, the #323 rule counts two titles for one original and skips both.
  - That is the user-approved bucket, keyed by `originalKey`. Those works wait for the backlog, as today.
- **Only new arrivals trigger the drain, as before.** Originals already in the catalog are not re-checked.

## Tests

- `translation.test.ts`:
  - `originalWholeKey` keeps the parts after `". "` and a dash, and drops a colon part and brackets;
  - the equivalence with `arrivalKey(catalogTitleKey(...))`;
  - the pin extended to `originalWholeKey`.
- `sqliteBooksRepository.test.ts`:
  - every writer writes the whole key, each with an original whose two keys differ;
  - a version change rewrites a whole key that is already set;
  - `originalKeysOf` returns stem keys by the covering index;
  - the self-heal keys a row that has only `original_key`, which is the rollback case, through the renamed index;
  - the Guard 1 parity test adds the three Druon volumes and checks the drain's path (`originalKeysOf` then `originalClaimsOf`) against the full scan;
  - the existing drop-column test drops the renamed index.
- `summaryCleanup.test.ts`: the cleanup writes the whole key.
- `originalArrivals.test.ts`:
  - a "Mr. Mercedes" claimant joins when "Mr. Mercedes" by Stephen King arrives;
  - the Druon claimant still isn't joined when "Les rois maudits" arrives (existing test, unchanged);
  - with a second King "Mr." claimant, nothing joins, and that claimant's evidence is never read;
  - a dash original arriving whole is found but not planned.

## Out of scope

- The subtitle rule, Guard 1's grouping, the #323 bucket and `planMatch`.
- A catch-up over originals already present.
- Any change to `title_key` or `normalizeTitle`.

## Runbook

No production command. Production has run #325, so this deploy's first boot goes through the self-heal, not the version backfill.

**After the batch deploy:**
- The boot log shows `books: keyed N original titles` once. N is about the number of books with an original title.
- `startup:books-open` grows once. The boot builds `idx_books_original_whole_key` and `idx_books_original_keys_missing`, one full read of `books` each, then writes the whole key once per titled row. That is about #325's first boot, which took 0.9 s warm on a synthetic 234k copy; this boot was not measured. Later boots add about 1 ms.
- Joins show on `/admin/translations` under "Merged", as before.

**Rollback:** an older build ignores the new column and recreates `idx_books_original_key_missing`, one full read. Its writers leave `original_whole_key` NULL on the rows they key. The next forward boot drops that index again and fills those keys through the self-heal.
