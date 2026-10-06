# Phase E1: works as the reference, on the server

Date: 2026-10-04
Status: design approved in conversation; spec awaiting review

## Why

The product is turning work-centric: opening a book should show its details,
every place it has been used (murals, tier lists, tournaments, quizzes,
shares) and its stats, for you and for the public community. Two readers
holding different editions of one book (a Portuguese and an English copy,
a hardcover and a paperback) must feed the same stats.

The catalog already has works above editions
(`2026-10-01-works-design.md`). Nothing else uses them: the library and every
game reference a per-user `bookKey` string (`isbn:<isbn>` or
`ta:<title>|<author>`), murals, tier lists and quizzes keep those keys inside
JSON, and nothing can answer "everything that uses work X".

## The path

| Step | What |
|---|---|
| **E1 (this spec)** | The server resolves every library book and every game entry to a `work_id`. Clients and payloads are unchanged. |
| E2 | Library payloads carry `workId`, web and mobile send works, the echo keys below are deleted. Old builds keep sending `bookKey` until they are gone. Spec: `2026-10-05-works-phase-e2-design.md`. |
| Work page | A route per work on web and mobile: details, editions, your history, community references, basic stats. |
| Stats | Arena rating across duels, rivals, "often ranked with", opt-in popular highlights, a shareable stats card. |

Grouping keyless editions into shared works runs as its own job (separate
session, started 2026-10-04). Until it lands, two keyless editions of one
book are two works.

## Decisions

1. **The library holds copies; everything else holds works.** A library book
   is one edition you own, identified by its `bookKey`, and carries the
   `work_id` it belongs to. Murals, tier lists, tournaments, quizzes, ballots,
   stats and the work page reference works.
2. **Server first.** E1 changes no request or response shape. Installed
   builds, frozen public snapshots and promoted tier lists keep working.
3. **Each game entry is `{work_id, key}`.** `work_id` carries all meaning:
   duplicate checks, indexes, cross-user queries, stats. `key` is the string
   the client sent, echoed back verbatim and never used by the server for
   logic. It exists because public clients rebuild `bookKey` from the
   keyless public book data and match it against keys in the same payload
   (`frontend/src/lib/sharedMural.ts:32`, `mobile/src/features/public/adapters.ts:13`,
   both voting boards), so any key the server rewrote would make books vanish
   without an error. E2 deletes it.
4. **A library save never fails on work resolution; a game write does.**
   Losing a save over a catalog problem is worse than a late `work_id`.
5. **ISBN-10 and ISBN-13 of one edition are one edition.** Fixed here,
   because identity is the point of this phase.

## Books module

**ISBN identity.** The catalog builds `isbn:` keys with `canonicalIsbn`
(`packages/shared/src/library/bookMatch.ts:55`, ISBN-10 → ISBN-13) instead of
`normalizeIsbn`, in `domain/normalize.ts` (`:57`, `:95`) and the ISBN search
in `booksService.ts:304`. The shared `normalizeIsbn` is not changed: the
library's `bookKey` uses it, and changing it would rekey every library.
A new edition created from an ISBN-10 also gets its `isbn:<10>` key as an
alias.

**One-time pass for existing editions**, gated by `PRAGMA user_version`, in
one `BEGIN IMMEDIATE` transaction at startup, like the title-key backfill
before it. For
each `isbn:` key of 10 characters, with X its edition and the ISBN-13 form
computed:

- No edition holds `isbn:<13>`: add that key to X and store the ISBN-13 in
  `books.isbn`.
- Edition Y holds it:
  - X's work has no Open Library key and only X: X's work gets
    `merged_into` Y's work and X moves there.
  - Y's work is that case instead: the same, the other way round.
  - Both works have Open Library keys and they differ: left alone, logged.
  - The `isbn:<10>` key keeps pointing at X, so a stored edition id never
    dangles.

**New public functions** (`index.ts`). Like `peekCachedCoverUrls`, they open
the catalog database lazily, so they work whatever order the plugins
register in (the library registers before books):

- `resolveWorks(lookups: { isbn, title, author }[]): (string | null)[]`.
  One `BEGIN IMMEDIATE` transaction; `findOrCreate` per lookup (local only,
  no network); each result follows `merged_into` (one hop, merges never
  chain). `null` when a lookup has neither an ISBN nor a title. Database
  errors propagate.
- `canonicalWorks(ids: string[]): Map<string, string>`. Every reader of a
  stored `work_id` maps it through this, so a later catalog merge (a late
  Open Library key, the keyless-grouping job) never splits a work's stats.
  Stored ids are not rewritten.

## Library

```
library_books
  + work_id   TEXT          -- NULL until resolved
  index (work_id, user_id)
```

- **Writing.** Resolution runs before the library transaction (the catalog is
  another database), only for books whose row is new or changed by the
  existing `row_hash` comparison, and the ids are written with the rows. It
  covers every path that writes rows: `saveLibrary`, `addBook`,
  `mergeBooks`, `applyChange`, and `updateDocumentData` (`PATCH
  /library/books`). Marking a book read resolves nothing new.
- **Failure.** Only an error thrown by `resolveWorks` is caught: the save
  goes through with `work_id` NULL and logs `work resolve failed` with the
  user id and count. Anything else propagates.
- **Sweep.** Off the boot path and every 10 minutes, rows with `work_id IS
  NULL` and an ISBN or title are resolved, 250 per batch, yielding between
  batches. It is also the backfill for every existing library.
- **Public API** for the game modules: `resolveEntryWorks(ownerUserId,
  entries)`, which applies the resolution order below and returns each key's
  canonical `work_id` and title. A catalog error comes out as
  `WorkResolutionError`.
- `library_match_keys` is unchanged; reader overlap moves to works with the
  work page.

## Game modules

Each entry becomes `{work_id, key}`. Real-row tables get columns; JSON
documents stay byte-identical and get a side table written in the same
transaction as the JSON.

| Module | Storage |
|---|---|
| Arena | `tournament_slots.work_id`, `duels.book_a_work_id`, `book_b_work_id`, `winner_work_id`. Index `tournament_slots(work_id)`. Votes stay keyed by `book_key` within their duel; a duel side's work comes from the duel row. |
| Tier lists | `tierlist_works(tierlist_id, key, work_id)`, PK `(tierlist_id, key)`, index `(work_id)`. `tierlist_ballot_placements.work_id`, index `(work_id, tier_id)`. |
| Quizzes | `quiz_works(quiz_id, key, work_id)`, PK `(quiz_id, key)`, index `(work_id)`. |
| Murals | `mural_works(mural_id, key, work_id)`, PK `(mural_id, key)`, index `(work_id)`. Keys from `spotlight`, `shelf`, `quote`, `quoteCollection` and legacy inline boards, via `extractReferences`. |

**Resolving a key on write**, in order:

1. `""`: no work and no side-table row (rediscover quotes, empty
   spotlights).
2. The owner's library row for that key: its `work_id`, or, while that is
   still NULL, `resolveWorks` with the row's ISBN, title and author.
3. `resolveWorks` with the title and author the request already carries
   (arena slots and random-fill pool, quiz `data.books[]`, including the
   curated `pool-*` books).
4. Otherwise no work: an orphaned key (a deleted book) is stored with a NULL
   `work_id` and passed through, as today.

A `resolveWorks` error returns 503 and stores nothing. NULL works count
nowhere.

**Responses** return the stored keys exactly as today. Tier-list results
histograms stay per key (clients match them against the pool); per-work
aggregation is for the work page.

**One entry per work** in tier lists, tournaments and quizzes, where two
editions would split a vote or let a book duel itself:

- Server-picked sets keep the first edition of each work and drop the rest:
  arena `random-fill` and quiz create (it sends the whole shelf).
- Manual writes that add a second edition of a work return 409 naming the
  book: tier-list create and `PUT`, arena `PUT slots`. Today's duplicate-key
  checks (`tierlists/routes.ts:66`, `arena/service.ts:366`,
  `quizzes/routes.ts:66,86`) become duplicate-work checks. The plan checks
  each client surfaces the 409 and adds handling where one doesn't.
- Murals allow it: a shelf shows your copies, and a quote belongs to the
  copy that holds the highlight.
- Items already holding two editions of one work keep both. Their ballots and
  votes keep matching by key.

**Backfill.** One sweep runner in `app.ts` runs a step per module after the
library's, off the boot path and every 10 minutes. Each step walks its items
by `rowid` cursor, 250 per batch, so it ends even when keys never resolve:
items with no side-table rows or any NULL `work_id` (arena: any slot or duel
side with a NULL `work_id`) are resolved again from the owner's library, then
the stored snapshot (slot and duel titles, tier-list `public_books` by pool
position, quiz `data.books[]`). A tier list's owner library is its
`origin_user_id`'s, so a promoted list (`__app__`) still finds its creator's
copies, and falls back to the snapshot once that account is gone.

## Merging library copies

`rekeyBooks` keeps today's scope (all murals, private tier lists, seeding
tournaments, private quizzes) and still rewrites keys, because the echo key
must name a copy the owner still has. It also rewrites the matching
`work_id`s and side-table rows.

`mergeBooks` keeps its order (version check, rekey, save). If the save loses
a race after the rekey, games point at the kept copy, which is in the library
either way, so nothing is lost. (An earlier draft called this a bug; it
isn't.)

## Rollout

One PR per layer, merged by the user, in order:

1. Books: ISBN identity, the one-time pass, `resolveWorks`, `canonicalWorks`.
2. Library: `work_id`, write paths, sweep, `resolveEntryWorks`, and the
   read-only check script. After deploy, a read-only production check (run by the
   user) shows NULL `work_id`s with an ISBN or title near 0 before step 3.
3. Arena, tier lists, quizzes, murals: one PR each.

Every change is additive: new columns, new tables, no JSON rewritten. An older
build ignores them, so a rollback needs no restore.

## Not in E1

- Clients sending or receiving `workId`; deleting echo keys and `book_key`
  columns (E2).
- Reader overlap by work, the work page, and any stats.
- Grouping keyless editions (separate job).

## Verification

- **Books:** an ISBN-10 and ISBN-13 lookup land on one edition; the one-time
  pass for each case above; `resolveWorks` creates, finds, follows a merge,
  returns `null` for an empty lookup; `canonicalWorks`.
- **Library:** each write path fills `work_id`; an unchanged save resolves
  nothing; a `resolveWorks` error still saves and logs; the sweep fills
  NULLs and skips rows with no ISBN or title; `resolveEntryWorks` in each
  resolution case.
- **Each game module:**
  - golden tests: today's requests return byte-identical responses,
    including public mural, profile and voting payloads;
  - the resolution order, including `""`, `pool-*` and orphaned keys;
  - duplicate-work 409s and the first-edition rule for server-picked sets;
  - an existing item with two editions still takes ballots and votes;
  - the backfill, including a promoted tier list;
  - `rekeyBooks` across two works.
- **Production checks** after each deploy, run by the user read-only: NULL
  `work_id` counts per table, split into "has a key" and "empty key", and the
  ISBN-10 pairs the one-time pass left alone.
