# Catalog genre backfill — design

Follows catalog genres (`2026-10-14-catalog-genres-design.md`). The Jev queue, the budget table and the three strikes are in `2026-10-15-genre-review-design.md`.

## Goal

Label the catalog's genre-less works in one afternoon. Free sources go first, Jev only where they run out, and Claude only for Jev's doubts.

Production on 2026-10-15:
- 77,927 editions in 77,343 works. 76,175 works (98.5%) have no genre.
- By where they came from:

| Source (`books.created_by`) | Works without genres | With a synopsis |
|---|---|---|
| `seed` (Open Library popularity lists) | 56,081 | 0 |
| `publisher` (16 Portuguese publisher feeds) | 20,008 | 18,910 |
| none (added by users or search) | 183 | 39 |

- The details backfill has looked up 10,635 of the genre-less works.

Samples on 2026-10-15, through today's `normalizeBookGenres`:
- **Open Library subjects** give a genre to 78–99% of seed works in each sample: English top, middle and tail; Portuguese top; Portugal-ISBN works. The Portuguese tail gets 42%.
- **Publisher feed labels** (Shopify tags, WooCommerce categories) give a genre to 0–84% of products per publisher, about 40% overall. The unmatched labels include easy wins: "Literatura Romântica", age tags such as "+ 3 anos", "tag_kids".

Three one-off passes, run by the owner in the production container over `railway ssh`, in this order:

1. **Seed subjects pass:** Open Library subjects for seed works. Free, minutes.
2. **Feed labels pass:** publisher tags and categories for publisher works. Free, minutes.
3. **Jev backlog pass:** the works still without genres that have a synopsis. About 10,000 requests, roughly 10–15 minutes, about $1.20.

Then a Claude pass reviews what Jev was unsure about, and the possible genres, through the existing genre-pass export and import.

## Non-goals

- **Works with no synopsis and no usable subjects.** About 6,000–12,000 seed works will have neither. Jev and Claude would be guessing from a title. They are labelled when someone imports them, through the review spec's queue.
- **Grouping translations with their originals.** That is designed separately: "Título original" plus Jev, merging into `works.merged_into`. It doesn't block this. A merged work's genres are the union of its editions' genres, so a translation merged later inherits its original's genres. A Jev genre written before the merge just adds one edition's vote.
- **Synopsis quality.** About 13% of publisher summaries aren't synopses (praise quotes, author bios). Jev reads them as they are. A synopsis-quality flag designed elsewhere may later let the backlog pass skip them.
- **A recurring job.** These passes run once and can be re-run. New books come in through imports and the queue.
- **Other details fields.** The passes write genres only. The details backfill keeps filling ratings, pages and summaries.

## Shared rules for every pass

- **Fill rule:** a pass writes genres only to editions whose `genres` is `'[]'`. It never overwrites any genre: source, Jev, or manual.
- **Source:**
  - The seed and feed passes write `genres_source = NULL`, the meaning it already has for genres from a data source.
  - The backlog pass writes through the Jev judgments, as `'jev'`.
- **Scope:** a pass writes to every edition of the matched canonical work whose genres are `'[]'`, the rule Jev and the manual pass already use.
- **Idempotent:** a second run writes nothing new.
- **Dry run:** `--dry-run` prints the full report and writes nothing.
- **Small transactions:** one transaction per page of results, so the live server's writes aren't held up. The scripts run as their own processes, not inside the server.
- **Before running:**
  - Check the volume's free space (`railway volume list --json`). Updating tens of thousands of rows grows the WAL that Litestream replicates.
  - Hold merges to main during a run, because a deploy kills `railway ssh` jobs.
- **Reports:** each pass prints counts and its unmatched cases, and never prints user data.

## 1. Seed subjects pass

`backend/scripts/genre-seed-subjects.mjs [--eng N] [--por N] [--dry-run]`

- **What it fetches:**
  - It re-runs the seed's own Open Library queries through `collectRanked`, with the same defaults as `seed-catalog.mjs` (`--eng 35000`, `--por 15000`).
  - The queries are `search.json` sorted by reading log, 1,000 works per request, one request a second, retrying 5xx and timeouts. That is about 60–100 requests.
- **Subjects:** it reads **all** of a work's subjects, as the details lookup does from the same search field, not the seed list's first 10. The seed's parser keeps its limit; the pass asks for the full list.
- **Matching:** each result's work key matches `works.ol_work_key`, canonicalised. When no work holds the key, the result's ISBN matches `books.isbn`.
- **Writing:** `normalizeBookGenres(subjects)` under the shared fill rule. A work whose subjects map to nothing is reported, not written.
- **Report:** results fetched, works matched, works and editions filled, works with subjects but no genre, results matching no work.

Expected: about 45,000–50,000 works labelled.

## 2. Feed labels pass

`backend/scripts/genre-feed-labels.mjs [--site NAME] [--dry-run]`

- **What it reads:** each of the 16 sites in `PUBLISHERS`, through the importer's `readSiteFeed`, which respects robots.txt and keeps its throttle.
- **Labels:** Shopify `tags` and `product_type`; WooCommerce `categories[].name` and `tags[].name`.
- **Matching:** a product matches catalog editions by `books.publisher_url` (the product URL the importer stored), else by ISBN.
- **Mapping:**
  1. A feed-only table `FEED_LABEL_GENRES` maps publisher-specific labels to a genre. It lives in the seed module, not in `normalizeBookGenres`, because these labels mean nothing outside the feeds. Initial entries:
     - age labels `+ N anos` and `N-M anos` with N up to 12 → Children's;
     - `tag_kids` → Children's.
  2. The remaining labels go through `normalizeBookGenres`.
- **Report:** per site, products, matched, works and editions filled. Then the 50 most frequent unmatched labels with counts, across all sites.
- **The real run waits for the census.** The dry run comes first. The owner reviews its unmatched-label census, and agreed additions go into `FEED_LABEL_GENRES` or the Portuguese rules (below) before the real run.

Expected: about 8,000–10,000 works labelled, depending on the census.

### Portuguese rule additions

Added to `normalizeBookGenres`, because they are Portuguese genre words that also reach the app through import tags and subjects:

| Genre | Adds |
|---|---|
| Romance | literatura romantica (covers "Literatura Romântica e Erótica") |
| Children's | infantojuvenil |

Everything else from the census goes to `FEED_LABEL_GENRES` unless it is a genre word in its own right. Labels with no matching genre stay unmapped; "Ensaio" (essays), "Contos" (short stories) and "Humor" have no `BOOK_GENRES` equivalent.

## 3. Jev backlog pass

`backend/scripts/genre-backlog.mjs --max N [--dry-run]`

- **Selection:** canonical works with no genres, a synopsis of at least 40 characters (work or edition), no judgment, and fewer than 3 strikes. Held works first, then oldest first. Held or not doesn't matter here.
- **Classification:** each work goes through the same code as the review spec's queue:
  - the same Jev request;
  - every answer stored as a judgment, and applied at 0.5;
  - book failures recorded as strikes;
  - outages end the run and store nothing;
  - a 401 ends the run.
- **Budget:**
  - `--max` is required, and is the run's hard limit on HTTP requests, retries included.
  - Usage is recorded under the `genres-backlog` source in `typesafe_usage`. The queue's 1,000-a-day `genres` budget is untouched.
- **Throughput:** 4 requests in flight. At about 0.24 s per request, 10,000 works take roughly 10–15 minutes.
- **Dry run:** prints how many works qualify, and the `--max` they would need, without calling TypeSafe.
- **Report:** works asked; answers applied as confident (≥0.8), possible (0.5–0.8), unsure (<0.5) and none; strikes; outages; requests used; estimated cost.
- **Requires `TYPESAFE_API_KEY`.** Without it the script exits with an error before selecting anything.

Expected, using the 2026-10-14 measurement (63% at 0.8 or above, 30% from 0.5 to 0.8, 8% below 0.5), for about 10,000 works:
- about 6,300 get confident genres;
- about 3,000 get possible genres;
- about 800 stay unsure or none.

## 4. Claude doubts pass

- **The export gets `--scope catalog`.** Today's default scope is held works only. The catalog scope also covers works no library holds. It lists those whose Jev answer is none or below 0.5, or whose only genres are possible.
- **Labelling** follows the existing genre-pass procedure in `backend/README.md`. Claude labels in batches of at most 100 works per Sonnet subagent, and the owner runs the import.
- **Not Haiku:** on 2026-10-15, Haiku subagents given long batches produced unusable labels in another session's test.
- **Size:** about 3,800 works (about 3,000 possible, 800 unsure or none), about 40 batches.

## Order of work

1. **Part 1 (passes 1 and 2, and the Portuguese rules)** doesn't depend on the review spec or on a key. It is built and run first.
2. **Part 2 (the backlog pass)** needs the review spec's budget table, strikes and shared classification code. It is built after them.
3. **Part 3 (the catalog-scope export)** is a small change to the genre pass. It can ship with Part 2.

Running order once deployed:
1. seed dry run, then seed;
2. feed dry run, census review, then feed;
3. set the key;
4. backlog dry run, then backlog;
5. Claude doubts pass.

## Error handling

- **Network errors and 5xx** in the seed and feed passes are retried like the importer's. A site that keeps failing is skipped and reported; the other sites carry on.
- **robots.txt** is respected; a disallowed feed is reported as skipped.
- **The backlog pass** uses the review spec's failure rules.
- **No pass catches more than the failure it expects.** An unexpected error stops the run with a stack trace and leaves earlier pages committed. Re-running is safe because of the fill rule.

## Testing

- **Seed pass:**
  - parsing keeps all subjects;
  - matching by work key, then ISBN, through merged works;
  - the fill rule, with no overwrite of source, Jev or manual genres;
  - a repeat writes nothing;
  - a dry run writes nothing;
  - the report counts.
- **Feed pass:**
  - label extraction for both platforms, using the existing Shopify and WooCommerce fixtures;
  - age labels up to 12, and none above;
  - `tag_kids`;
  - matching by publisher URL, then ISBN;
  - the fill rule, repeat and dry run;
  - the unmatched-label census.
- **Portuguese rules:** "Literatura Romântica e Erótica" → Romance; "Infantojuvenil" → Children's; the canonical-name and existing Portuguese tests still pass.
- **Backlog pass:**
  - selection: synopsis length, no judgment, strikes, held first;
  - `--max` stops at exactly N requests, retries included;
  - usage is recorded under `genres-backlog` and not `genres`;
  - outage, 401 and missing-key behaviour;
  - the report.
- **Export:** catalog scope includes non-held doubts; the default scope is unchanged.

## Rollout

1. Merge Part 1. The owner deploys, checks volume space, then runs the seed and feed passes: dry runs first.
2. Merge the review spec and Part 2. The owner deploys and sets a fresh `TYPESAFE_API_KEY`, then runs the backlog: dry run first, then `--max` at the dry run's figure.
3. The owner exports the catalog-scope doubts, Claude labels them, and the owner imports.
4. **Check:** rerun the 2026-10-15 count.
   - Works without genres should drop from 76,175 to roughly 8,000–14,000.
   - What's left should be mostly seed works with neither synopsis nor subjects.
