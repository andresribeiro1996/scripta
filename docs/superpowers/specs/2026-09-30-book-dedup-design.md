# Book dedup: looser matching and merging duplicates

Date: 2026-09-30
Status: design approved in conversation (approach A); awaiting spec review

## Problem

A book is identified by `bookKey` (`packages/shared/src/library/merge.ts`):
`isbn:<isbn>` when it has an ISBN, otherwise `ta:<title>|<author>` lowercased
with whitespace collapsed. Anything else counts as a different book:

- `Dune` and `Dune (Dune Chronicles #1)` by the same author;
- the Kobo copy with no ISBN and the Goodreads row with one;
- two editions with different ISBNs;
- Goodreads' single author vs Kobo/StoryGraph's `A, B` author list.

So re-imports add duplicates, a library already holding duplicates has no way
to fold them, and the backend catalog (`backend/src/modules/books`, keyed by
`book_keys`) keeps separate rows, so an ISBN-less copy never inherits the
cover and genres the ISBN copy already found.

`bookKey` is also a persisted reference (collections and series, mural blocks,
tier lists, arena, quizzes), so it cannot simply be changed.

## Goals

1. Imports stop creating duplicates that are certainly the same book.
2. Duplicates already in a library are merged after the owner confirms.
   Imports and add-book already prevent new certain duplicates, so there is
   no automatic merge on load.
3. The catalog resolves variant titles, ISBN-less copies and other editions
   to one catalog book.
4. Merging never breaks a reference the owner can still edit.

## Non-goals

- Changing `bookKey` or the key format of anything already stored.
- Rewriting published or frozen data (see "References").
- Using an LLM or Jev. The likely-duplicates list is where a confidence
  score could plug in later; nothing here builds it.
- Parsing `Last, First` author names. No importer produces them.

## 1. Matching rules

New `packages/shared/src/library/bookMatch.ts`. `normalizeWords` and
`normalizeTitle` move here from `backend/src/modules/books/domain/normalize.ts`
(the backend imports them back) so both layers share one normalizer.

Derived per book:

- **canonical ISBN**: `normalizeIsbn`, then ISBN-10 converted to ISBN-13
  (`978` prefix plus a recomputed check digit). `x` and `X` become the same.
- **first author**: `Attribution` split on `,`, first entry, `normalizeWords`.
- **surname**: last word of the first author.
- **exact title**: `normalizeWords(Title)`.
- **main title**: `normalizeTitle(Title)`, which removes `(...)`/`[...]` and
  anything after the first `:`.
- **numbers**: digit runs in the title after removing bracketed parts, in
  order. `Complete Works: Volume 2` → `["2"]`; `Dune (Dune Chronicles #1)` →
  `[]`.

Two books are:

- **certain** when their canonical ISBNs are equal, or when exact title and
  first author are equal and at most one of them has an ISBN;
- **likely** when they are not certain, their main title and surname are
  equal and non-empty, and their numbers are equal.

Different ISBNs are never certain: two editions and two unrelated books both
titled `Poems` by the same poet look identical, so that case always asks.

`findDuplicates(books)` groups books transitively (union-find over the two
relations) and returns `{ certain: string[][]; likely: string[][] }` of
`bookKey` groups, each group ordered with ISBN-bearing books first, then by
library position. A certain group
that ends up holding two or more distinct canonical ISBNs is demoted to
likely. Pairs recorded in `distinctBooks` (section 4) are never paired.
Books with an empty normalized title never match anything, even when their
`bookKey`s are identical.

## 2. Imports

`mergeBookLists` keeps its shape and callers (web `LibraryPage.mergeAndSave`,
mobile `mergeAndSave.ts`) and changes how it pairs books:

- An incoming book pairs with an existing book that it matches as certain,
  not only by equal `bookKey`. If several existing books match, it pairs
  with the first by library position. Each existing book pairs at most once.
- Incoming books that are certain duplicates of each other collapse into the
  first before pairing.
- A paired book keeps the existing book's `Title`, `Attribution` and `ISBN`,
  so its `bookKey` and every reference to it stay put. Every other field
  keeps today's rule: the newest import wins, `_coverUrl` survives, and
  highlights are combined.
- Likely matches are appended as new books and surface in the review list.

The server's add-book path (`library/service.ts` `addBook`) replaces its own
trim-and-lowercase comparison with the certain rule.

## 3. Merge operation

`POST /library/books/merge` with body `{ keep: string; merge: string[]; expectedUpdatedAt: string }`,
signed in, owner only. Keys are `bookKey`s in the caller's library.

Steps, in this order:

1. Load the library. Drop `merge` keys that no longer exist. If none remain,
   or `keep` is missing, return the current document unchanged. That makes
   repeat calls and two devices racing harmless.
2. Rewrite references (below) from each merged key to `keep`.
3. Build the merged library with `mergeDuplicateBooks(library, keep, merge)`
   from `@scripta/shared` and save it with `expectedUpdatedAt`. On conflict,
   return 409. The references already point at `keep`, which exists in both
   versions, so nothing dangles; the client reloads and retries.
4. Return the saved document.

`mergeDuplicateBooks` rules. `keep` survives in its own position. For each
merged book:

| Field | Rule |
|---|---|
| `ReadStatus` | highest (2 finished > 1 reading > 0) |
| `___PercentRead`, `TimeSpentReading` | highest |
| `DateLastRead` | latest |
| `highlights` | union by `BookmarkID` (existing `unionHighlights`) |
| `_genres` | union, normalized |
| `Title`, `Attribution`, `ISBN` | always `keep`'s, so its `bookKey` is unchanged |
| anything else | `keep`'s value, filled from the merged book where `keep`'s is missing or empty |

The merged books are removed. Group `bookKeys` and `distinctBooks` pairs are
rewritten to `keep` and de-duplicated. A pair that collapses onto itself is
dropped.

### References

Rewritten, owner's editable data only:

| Module | Field | When |
|---|---|---|
| library | `groups[].bookKeys` | always (inside `mergeDuplicateBooks`) |
| murals | `blocks[]`: `spotlight.bookKey`, `shelf.bookKeys`, `quote.bookKey`, `quoteCollection.quotes[].bookKey`, legacy inline `tierlist.tiers[].bookKeys` / `pool` | all of the owner's murals |
| tierlists | `data.tiers[].bookKeys`, `data.pool` | `vote_code IS NULL` |
| arena | `tournament_slots.book_key` | `status = 'seeding'`; if both keys are seeded, the merged book's slot is removed |
| quizzes | `data.books[].key`, `data.questions[].bookKey` | unpublished drafts |

Arrays are de-duplicated after rewriting. Each module exposes
`rekeyBooks(userId, fromKeys, toKey)` on its service, and `app.ts` hands them
to the library service as one callback, the same way `emitBookEvents` is
wired today. Each module's rewrite runs in one transaction on its own
database.

Left alone because they carry their own title/author/cover copy: published
tier lists (`pool`, `public_books`, ballot placements), arena duels, votes
and non-seeding slots, published quizzes, community events (keyed by
`ContentID`), and the catalog.

## 4. Review UI (web and mobile)

- `LibraryData` gains `distinctBooks?: string[][]`, pairs the owner said are
  different.
- There is no automatic merge on load. Imports and add-book already pair
  certain matches as they save, so a library has no certain backlog.
- If `findDuplicates` returns any certain or likely groups, the library
  screen shows a "N possible duplicates" banner. It opens a sheet listing each
  group, certain first: cover, title, author, ISBN, status. **Merge** calls the endpoint. **Not the same** adds the group's
  pairs to `distinctBooks` through the normal library save.
- Web: `LibraryPage`. Mobile: the library tab screen plus a sheet, following
  the existing sheet components.

## 5. Catalog

`lookupIdentity` keeps the `isbn:` key and changes its title key to
`ta:<main title>|<first author>|<numbers joined by space>`, built from the
shared helpers. The numbers part keeps volumes apart, because the catalog has
no confirm step.

- `createBook` registers the ISBN key and the title key when both exist.
- `findOrCreate` and `saveHits` look up the ISBN key first, then the title
  key. When the title key finds a book that has no ISBN of its own, the
  lookup's ISBN key is added as an alias to it. Editions with different ISBNs
  keep separate catalog books.
- A startup backfill inserts the new-format title key for every existing
  `books` row (`INSERT OR IGNORE`). Old keys stay and are harmless.

## Error handling

- Merge endpoint: 400 for a malformed body, 404 when there's no library,
  409 on conflict. A failure in a module's rewrite aborts before the library
  is saved and returns 500. Rewrites already committed only point at `keep`,
  so the state stays consistent and a retry finishes the job.
- Clients: a failed or conflicting Merge from the sheet surfaces as an error
  and leaves the library as it is. It must not surface as a silent success.

## Testing

- `bookMatch.test.ts`:
  - the Dune variants;
  - ISBN-10 vs ISBN-13, and `x` vs `X`;
  - first author only;
  - `Volume 1` vs `Volume 2`;
  - `Poems` with different ISBNs is likely, not certain;
  - a mixed-ISBN group is demoted;
  - `distinctBooks` is respected.
- `merge.test.ts`: certain pairing on import keeps the existing identity;
  in-import collapse; likely matches are appended.
- `mergeDuplicateBooks` tests: each field rule, groups and `distinctBooks`
  rewrite.
- Backend:
  - endpoint auth and 400/404/409;
  - repeat calls;
  - each module's `rekeyBooks` rewrites drafts and leaves published rows;
  - the arena double-seed case;
  - `addBook` uses the certain rule.
- Catalog: an ISBN miss that resolves through the title key adds the alias;
  volumes stay apart; the backfill.
- Clients have no component test harness. The banner and sheet are verified
  by typecheck, lint and a manual check.

## Rollout

Before deploying, run the production count script
(`genre-dupe-count.mjs`) to size certain vs likely duplicates. Take a Railway
volume snapshot first, since merging rewrites user data.
