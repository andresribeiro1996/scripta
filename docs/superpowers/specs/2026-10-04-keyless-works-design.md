# Keyless works: grouping, Open Library lookup and manual merges

Date: 2026-10-04
Status: direction approved in conversation (approach B, title grouping with
keyless peers and a per-edition block, admin routes for the manual path);
spec awaiting review

## Problem

Phase E puts `work_id` on library books and games, then a work page shows
stats across readers. An edition without an Open Library work key
(`books.ol_work_key`) gets a work of its own (`2026-10-01-works-design.md`),
so two readers of different keyless editions of one book are split.

Measured in production on 2026-10-04 with `backend/scripts/work-gap.mjs`:

| | Count |
|---|---|
| Catalog editions | 77,807 |
| Keyless editions | 18,951 (24%) |
| — from the publisher importer | 18,260 (17,723 still untitled) |
| — from user lookups / seed | 189 / 502 |
| Editions referenced by readers (4 users, 323 rows) | 245 |
| — keyless | **164 (67%)**, all from user lookups |
| — keyless, no ISBN | 63 |
| — keyless, ISBN, details already checked | 101 |
| — keyless whose title key matches exactly one keyed work | 46 |
| — keyless whose title key matches several keyed works | 3 |
| Title groups with a keyed edition | 57,219 |
| — spanning more than one Open Library work | 1,094 (1.9%) |
| Title groups split across readers today | 2 (3 readers) |

A probe of `GET /isbn/{isbn}.json` on 40 sampled keyless ISBNs that the
details backfill had already checked found a work key for 6 of 9 user-lookup
editions and 0 of 31 publisher editions. The misses stayed 404 on a second
request.

Two facts from the code shape the design:

- **New editions rarely miss a work by title.** `findByIdentity` falls back to
  the `ta:` alias and `createBook` returns the existing row when any key
  matches, so a later lookup of the same title and author lands on the
  existing edition and its work. The 46 above are rows created before the
  seed: they claimed the `ta:` alias, so the seed's keyed edition of the same
  title couldn't.
- **`merged_into` has one writer and no reader.** Nothing resolves a merged
  work id yet.

## Decisions

1. **Open Library stays the authority.** Its key always overrides a grouping
   made here, because an edition grouped by title keeps
   `books.ol_work_key = NULL` and `setWorkKey` still moves it.
2. **The title key groups keyless works**, by the rules below. `ta:` aliases
   in `book_keys` still never choose a work. This replaces Decision 3 of the
   works spec.
3. **Keyed works never merge.** Open Library's own duplicate works (the 1.9%)
   are out of scope.
4. **Every merged work id resolves**, through `merged_into`, at most one hop.
5. **The manual path is two admin routes**, keyed by edition lookups, called
   with `curl` until an admin UI exists.

## Data model (`covers.sqlite`)

```
books
  + title_key               TEXT   -- catalogTitleKey(title, author); NULL when the title is empty
  + title_group_blocked_at  TEXT   -- set by a manual detach; the grouping pass skips this edition
  index (title_key)
```

`title_key` is the catalog's existing `ta:` format
(`ta:<normalizeTitle>|<firstAuthor>|<title numbers>`), stored per edition
because `book_keys` gives each alias to only one edition. `createBook` and
`fillIdentity` write it; titles change nowhere else. The works backfill fills
rows where `title_key IS NULL AND title <> ''`, which covers existing rows and
rows written by an importer or seed process still running older code.

## Title grouping

A step in the works tick (`startWorksBackfill`: boot, then every 10 minutes),
after `assignMissingWorks`, in batches, each batch one `BEGIN IMMEDIATE`
transaction, yielding between batches.

**A candidate** is a live keyless work (`ol_work_key IS NULL AND merged_into
IS NULL`) whose editions all have the same non-empty `title_key`, a non-empty
author, and no `title_group_blocked_at`. Any other keyless work is left
alone.

**The target** for a candidate's `title_key`, over the editions of live works
other than its own, ignoring blocked editions:

- exactly one keyed work: that work;
- more than one keyed work: none, so the candidate is skipped;
- no keyed work, other keyless candidates: the oldest of them (by
  `created_at`, then `id`); the oldest itself is not merged.

The candidate is then merged with `mergeWorks(candidate, target)`.

Converging cases:

- a keyed edition arriving later (seed, search hit, lookup) pulls the keyless
  group in on the next tick;
- a grouped edition that later gets a different Open Library key moves out
  through `setWorkKey`; the work it leaves keeps its other editions;
- a group that becomes ambiguous stays as it is; nothing is split
  automatically.

## Open Library work-key lookup

A background job on the non-urgent Open Library lane, run by
`startDetailsBackfill` (boot, then every 10 minutes, no overlap, pauses on a
`retryAt`), 50 lookups per batch.

**Picks**:

```sql
SELECT id, isbn FROM books
WHERE ol_work_key IS NULL AND isbn IS NOT NULL
  AND details_status IS NOT NULL
  AND (created_by IS NULL OR created_by <> 'publisher')
  AND (work_checked_at IS NULL OR work_checked_at < :thirtyDaysAgo)
ORDER BY work_checked_at IS NOT NULL, created_by IS NOT NULL, work_checked_at, created_at, rowid
LIMIT 50
```

About 700 rows today, so the first pass takes about 2½ hours. Editions grouped
by title are still picked, since the filter is on the edition's key.

**Per edition**: `GET https://openlibrary.org/isbn/{isbn}.json` through a new
`fetchEditionRecord(isbn)` on the Open Library catalog adapter, parsed with
the existing `parseEditionRecord`.

- A work key: `setWorkKey` (fill-only, existing move and merge rules) and the
  edition's language from the record, which replaces a language another source
  filled (the works spec's rule).
- 404, or a record without `works`: no change.
- Either way, `work_checked_at` is set.
- `SourceUnavailableError` (timeouts, 5xx, 429 with its `Retry-After`) stops
  the batch and returns its `retryAt`, as the details backfill does. Anything
  else propagates and is logged by the tick.

Publisher editions are excluded because none in the sample were known;
including them is a one-line filter change.

## Merging, detaching, resolving

Repository operations in the books module, each one `BEGIN IMMEDIATE`
transaction.

**`mergeWorks(from, into)`**

- Resolves `into` through `merged_into`.
- Refuses with `WorkMergeError` when `from` is unknown, already merged, keyed,
  or the same as the resolved `into`.
- Moves every edition of `from` to `into`, fills an empty title or author on
  `into` from them, sets `from.merged_into = into`, and repoints works whose
  `merged_into` is `from` to `into`, so no chain is longer than one hop.

**`detachEdition(bookId)`**

- Refuses with `WorkMergeError` when the edition has its own `ol_work_key`.
- Sets `title_group_blocked_at`.
- When the edition shares its work with other editions, gives it a new keyless
  work from its own title and author. When it is alone, only the block is set.

**`resolveWorkId(workId)`** follows `merged_into` and returns the live work id,
or `null` for an unknown id; more than one hop throws, since it means the
invariant broke. **`workIdForEdition(bookId)`** returns the edition's
current `work_id`. Both go on the books module's public API for phase E, which
should read a reader's work through the edition rather than keep its own copy
of a work id.

## Admin routes

In `buildAdminRoutes`, behind `authGuard` and `service.isAdmin`, like
`POST /books/cover/reject`. Edition lookups use the existing `lookupSchema`
(`{isbn?, title?, author?}`) and resolve with `findByIdentity`, without
creating anything.

| Route | Body | Does |
|---|---|---|
| `POST /books/works/merge` | `{ from: lookup, into: lookup }` | `mergeWorks(work of from, work of into)` |
| `POST /books/works/detach` | `{ edition: lookup }` | `detachEdition` |

Both answer `200` with the resulting work: `{ id, olWorkKey, title, author,
editions: [{ id, isbn, title, author, olWorkKey }] }`. Errors: `400` invalid
body, `403` not the admin, `404` an edition not found, `409` a
`WorkMergeError`, with its message. Both are additive; no client calls them.

The branch adds admin write routes, so the `security-review` skill runs before
merge.

## Docs

- `2026-10-01-works-design.md`: Decision 3 and "Not in this phase" point here.
- `docs/work-model-notes.md`: the gaps section reflects what is built.
- `backend/README.md`: the two routes in the books row, and the gap script.

## Not in this phase

- Merging keyed works (Open Library duplicates).
- Grouping by a looser key: title plus surname found 1 more edition and spans
  more keyed works (2.1%).
- Looking up publisher editions, Wikidata or PORBASE.
- An admin UI for merging.
- Library rows and games storing `work_id` (phase E).

## Verification

- **Repository tests**:
  - `title_key` is written on create and on `fillIdentity`, and the backfill
    fills it;
  - a keyless work joins the single keyed work with its title key;
  - two keyless works with one title key merge into the oldest;
  - ambiguous title keys, empty authors, mixed title keys within a work and
    blocked editions are skipped;
  - a keyed edition arriving later pulls the keyless group in;
  - `setWorkKey` moves a grouped edition to a different keyed work;
  - `mergeWorks` refusals, chain repointing and `merged_into`;
  - `detachEdition` blocks, splits and refuses a keyed edition, and the next
    grouping pass leaves it alone;
  - `resolveWorkId` for live, merged and unknown ids.
- **Lookup tests**:
  - the pick order and its filters (publisher, unchecked details, the
    30-day re-check);
  - a hit keys the edition and sets its language;
  - a 404 only marks it checked;
  - a 429 pauses with its `retryAt`.
- **Route tests**: `403` for a non-admin, `404`, `409`, and a merge and detach
  that succeed.
- **Production check** (the user runs it, read-only): `work-gap.mjs`, extended
  with title-grouped editions, blocked editions, looked-up editions with and
  without a key, and merged works, before and after deploy. Expected
  afterwards:
  - referenced editions in keyless works fall from 164, through the 46
    title-key matches and about two thirds of the 101 with an ISBN (the two
    sets overlap);
  - no merge chain is longer than one hop.
