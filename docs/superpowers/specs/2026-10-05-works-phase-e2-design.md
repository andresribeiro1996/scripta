# Phase E2: clients speak works

Date: 2026-10-05
Status: design approved in conversation; spec awaiting review

## Why

E1 (`2026-10-04-works-phase-e1-design.md`) made the server resolve every
library book and game entry to a `work_id`, but no client sees one. The work
page needs a work id behind every book a client shows, and the games should
stop carrying library copy keys. E1 kept those keys as echoes, so clients
that rebuild `bookKey` from keyless public data would keep matching.

E2 gives clients work ids, moves the games to works on the wire, and, once
old builds are provably gone, deletes the game keys from storage. E1's final
works check was clean: every `*Null` count was 0.

## Decisions

1. **The library and murals keep copies; arena, tier lists and quizzes hold
   works.** A mural is a live view of the owner's library. Its blocks resolve
   the owner's copies by key (spotlight, shelf, collection shelves copied from
   `group.bookKeys`), and a quote belongs to the copy that holds the
   highlight. `bookKey` stays the library's copy identity: groups,
   `distinctBooks`, `PATCH /library/books`, reorder, mobile's `/book/[key]`.
   `library_books.book_key`, `mural_works.key` and the mural half of
   `rekeyBooks` stay.
2. **New clients opt in with a header.** Until old builds are gone, the
   server speaks today's format to everyone else and translates at the edge.
   Storage stays as E1 left it until the removal. This is the backend rule's
   opt-in parameter (`backend/AGENTS.md`), as the dashboard's `kinds` is.
3. **The header's absence is the "old builds" signal.** Nothing else
   identifies a build: there is no version header, a mobile OTA applies on
   the next cold start, open web tabs keep old JS, and build 9 has no
   `expo-updates`.
4. **The removal is the first non-additive step of the works effort.** It
   rewrites stored JSON and rebuilds tables, so a rollback needs a restore.
   It waits for the gate and runs one game database at a time.
5. **Clients change once.** Each client moves all three games in one PR,
   because the header switches every game route at once.

## Formats

The works format, which becomes the only one after the removal:

| Field | Today | Works format |
|---|---|---|
| Arena slot, duel side | `key` | `workId` |
| Duel winner, summary winner | `winnerKey`, `winner.key` | `winnerWorkId`, `winner.workId` |
| Vote, tiebreak | `bookKey`, `winnerBookKey` | `workId`, `winnerWorkId` |
| Tier list `data` | `tiers[].bookKeys`, `pool` of keys | `tiers[].workIds`, `pool` of work ids |
| Ballot placement, histogram cell | `bookKey` | `workId` |
| Quiz book, quiz question | `key`, `bookKey` | `workId` |

These fields are always on, whatever the header says, because they are
additive and permanent:

- `LibraryDocument.works: Record<bookKey, workId>` on every response that
  returns a library document: `GET` and `PUT /library`,
  `POST /library/books/merge`, `/library/share`, `/library/unshare`. It is
  built from the user's `library_books` rows that have a `work_id`, mapped
  through `canonicalWorks`. `sendDocumentText` (`library/routes.ts`) appends
  it. The saver never folds an `add` (`librarySaver.ts:117`) and refetches
  instead, so change answers need no works.
- `PublicBookData.key` (the row's `book_key`) and `PublicBookData.workId`
  (canonical, `null` when unresolved), added in `toPublicBooks`
  (`library/publicResolver.ts:80`). They cover public mural books,
  `currentlyReading` and the voting board's live resolve.

Rules:

- Every `workId` the API returns is canonical.
- Within one tier list or quiz, each work appears once. When two stored
  entries share a canonical work, from a pre-E1 item or a later catalog merge,
  the works format keeps the first. A tournament keeps every slot, because a
  bracket can't lose one. A vote for a duel whose two sides share a work goes
  to side A. E1 already prevents both cases in new items.
- A `workId` a client sends must exist in the catalog: `canonicalWorks`
  returns only ids it finds. Otherwise the request gets a 400. Arena slots,
  the random-fill pool and tier-list entries require one. Quiz books may omit
  it (the curated `pool-*` books), and the server resolves those by title and
  author, as E1's resolution step 3 does.
- E1's one-entry-per-work rules and their 409s are unchanged.

## Transition (E2a)

### Header

Web (`frontend/src/api/client.ts`, `rawFetch`) and mobile
(`mobile/src/core/apiClient.ts`, `rawRequest`) send `X-Scripta-Works: 1` on
every request.

The server's `worksFormat(request)` returns whether the header is present.
When it isn't, it logs `legacy client` with the method and route. Only the
routes whose format changes call it:

- arena: `GET /arenas/:id`, `/arenas/mine`, `/arenas/voted`, `/arenas/public`,
  `PUT /arenas/:id/slots`, `random-fill`, `vote`, `tiebreak`;
- tier lists: `POST /tierlists`, `GET /tierlists`, `GET` and
  `PUT /tierlists/:id`, `open-voting`, `results`,
  `GET /tierlists/voting/:code`, and the ballot routes;
- quizzes: the owner routes (`POST`, `PUT`, `GET`, `publish`);
- `GET /murals/shared/:token` and `GET /community/profiles/:username`, for
  their tier-list map.

These responses send `Vary: X-Scripta-Works`. CORS (`app.ts`) gets a
`maxAge`, so anonymous web pages don't send a preflight before every GET.

Without the header, these routes accept and return today's format. E1's
golden tests stay byte-identical, except for the always-on fields above, and
are updated for exactly those.

### Server translation

Storage is unchanged. Translation goes through E1's columns and side tables.

- **Out:**
  - Keys become canonical work ids through `tournament_slots.work_id`, the
    duel work columns, `tierlist_works` and `quiz_works`.
  - Tier-list and quiz entries without a work are left out, as they already
    count nowhere. An arena slot or duel side without one keeps
    `workId: null`.
  - The first-entry rule applies.
  - Histogram cells and ballot placements of the first key of each work
    become that work's.
- **In:**
  - A work already in the item keeps its stored key.
  - A new work gets the owner's copy key for it (a `library_books` row of
    that user whose canonical `work_id` matches), else the work id itself.
    So an old build still renders items made on a new one.
  - Side tables and work columns are written as E1 writes them. Works-format
    writes skip `resolveEntryWorks`, because the id already is the work.
- **Arena:**
  - A vote or tiebreak maps the work id to the duel side whose canonical work
    matches, and stores that side's key.
  - An id matching neither side gets a 400.
- **Tier lists:**
  - A ballot maps each placement's work id to its pool key through
    `tierlist_works`. An id not in the pool gets a 400, as an unknown key
    does today.
  - A frozen board's `public_books` snapshot gets `key` and `workId` by
    zipping it with `pool` when the lengths match. Otherwise the board falls
    back to the live library resolve. `open-voting` has no length guard
    (`tierlists/routes.ts:168`).
  - The public mural and the profile mural translate their `tierlists` map
    the same way.
- **Quizzes:** books and published questions translate through `quiz_works`.
  `generateQuizQuestions` still runs on stored keys at publish.

### Clients

- `@scripta/shared` gains `LibraryDocument.works` (empty when unknown) and
  `workIdOf(document, book)`, which is `works[bookKey(book)]`.
- Game screens hold work ids end to end:
  - arena seeding, random-fill, view, voting and tiebreak;
  - tier-list create, editor, add-books, board, ballots, results and
    voting;
  - quiz create and editor.
  Owner screens match entries to their own books through `workIdOf`.
- Pickers offer only library books that have a work, and hide works already
  in the item. E1's duplicate-work 409 then fires only from a stale screen.
- Public murals match blocks and highlights by `PublicBookData.key` instead
  of rebuilding `bookKey` (`frontend/src/lib/sharedMural.ts:32`,
  `mobile/src/features/public/adapters.ts:13`). This also fixes the keyless
  book with an empty author, whose rebuilt key ends in `unknown author`
  because `toPublicBooks` substitutes it. Tier rows, voting boards and
  results match by `workId`.
- No client persists a book key (no offline queue, no persisted query cache),
  so nothing client-side needs migrating.
- **Web goes first.** Its PR adds the works-format types and helpers to
  `@scripta/shared` next to today's (`arena/types.ts`, `tierlists/`,
  `quizzes/types.ts`) and turns the header on for web.
- **Mobile follows.** Its PR moves mobile over and deletes the old shared
  types and helpers. Until it ships, mobile shows up in the legacy log, as
  expected.

## Gate

The removal starts only when both of these hold, and you decide:

- no `legacy client` line in the Railway logs for 14 days, counted from the
  mobile PR's OTA publish;
- EAS Update insights for the `production` channel shows no device still on
  the embedded bundle or an older update.

Build 9 cannot update over the air. If it is still in use it appears in the
log, and the fix is a Play reinstall. You run both checks, or `deploy-ops`
runs them read-only.

## Removal (E2b)

### Pre-removal check

`backend/scripts/works-check.mjs` gains a read-only `e2` section, run by you
over `railway ssh`. Per game database it counts:

- entries without a work: slots, duel sides, tier-list and quiz side-table
  rows, placements;
- items where two entries share a stored work;
- duels whose two sides share a work;
- published tier lists whose `public_books` length differs from `pool`.

A removal PR merges only when its "without a work" count is 0. The quizzes PR
also needs its duplicate count at 0: a published question builds its prompt
from its book's quote or blurb, so merging two books would show one book's
text under the other's question. For tier lists, the duplicate and
snapshot-mismatch counts show what the rules below will drop. For arena they
are informational, since slots aren't dropped.

### One pass per game database

Each removal PR adds a one-time pass at startup, gated by
`PRAGMA user_version`, in one `BEGIN IMMEDIATE` transaction. Columns that are
part of a primary key or an index can't be dropped in SQLite, so tables are
rebuilt by copy and rename, like `events` in
`community/adapters/sqlite/connection.ts`.

- **Arena:**
  - `tournament_slots` is rebuilt without `book_key`.
  - `duels` is rebuilt without `book_a_key`, `book_b_key` and `winner_key`.
  - `votes` replaces `book_key` with `side` (`'a'` or `'b'`, from the
    duel's keys). A tally then never merges two sides, even after a catalog
    merge.
  - The index becomes `(duel_id, side)`.
- **Tier lists:**
  - `data` is rewritten to stored work ids through `tierlist_works`.
    Entries without a work are dropped, and the first of any duplicate pair
    wins.
  - `public_books` gets a `workId` on each entry where the zip with `pool`
    lines up, and is set to NULL otherwise, which falls back to the live
    resolve.
  - `tierlist_ballot_placements` is rebuilt with primary key
    `(ballot_id, work_id)`, keeping a ballot's first placement per work.
  - `tierlist_works` is rebuilt as `(tierlist_id, work_id)`.
  - The published `data` of promoted (`__app__`) lists is rewritten the same
    way.
- **Quizzes:**
  - `data.books[].key` and `data.questions[].bookKey` become `workId`
    through `quiz_works`.
  - `quiz_works` is rebuilt as `(quiz_id, work_id)`.

Each removal PR also deletes, for its module:

- the translator and the old request schemas, so the server always speaks
  the works format;
- the key-based duplicate checks;
- the module's `rekeyBooks` hook entry, which leaves murals only in the
  `app.ts` hook;
- its works-sweep step, since every entry now gets its work at write;
- its use of `resolveEntryWorks`.

The last of the three also deletes `worksFormat` and the legacy log. A
follow-up client PR drops the header.

### Rollback

Older code can't read the rebuilt tables. Rolling back a removal PR means a
Litestream point-in-time restore of that one database to just before its
deploy. `backend/README.md` records the restore steps next to the works
check.

## Rollout

Stacked PRs, each merged by you, in order:

| # | PR | Contents |
|---|---|---|
| 1 | Server plumbing | `worksFormat`, legacy log, `Vary`, CORS `maxAge`, `LibraryDocument.works`, `PublicBookData.key`/`workId` |
| 2 | Server arena | works format |
| 3 | Server tier lists | works format, including the mural and profile `tierlists` map |
| 4 | Server quizzes | works format |
| 5 | Web | works types added to shared, header on for web. Merges only after a `curl` with the header shows `workId` in production. |
| 6 | Mobile | old shared types deleted. It adds no native dependency, so it ships as an OTA update on merge. |
| — | Gate | as above |
| 7–9 | Removal | arena, tier lists, quizzes, each after the pre-removal check |
| 10 | Clients | drop the header |

PRs 1–6 are additive: an older server build ignores the header and serves
today's format, so rolling them back needs no restore.

## Not in E2

- The work page. It can start once PR 6 is live, because clients already
  have work ids by then.
- Murals moving to works. Reader overlap by work (`library_match_keys` is
  unchanged), and stats.
- A general client-version mechanism. The header exists for this migration
  only, and PR 10 removes it.

## Verification

- **PR 1:**
  - without the header, golden responses change only by the always-on
    fields;
  - `legacy client` is logged on the listed routes and nowhere else;
  - `works` appears on every library document response and is canonical;
  - public books carry `key` and `workId`;
  - the keyless book with an empty author matches by `key`.
- **PRs 2–4, per module:**
  - works-format reads and writes work;
  - an unknown id gets a 400, and a missing id gets a 400 for arena and tier
    lists;
  - quiz pool books are resolved by title and author;
  - a work already in the item keeps its key, and a new one gets the owner's
    copy key, or the work id when there is no copy;
  - an old-format read of an item written in the works format returns usable
    keys;
  - duplicates keep the first, and entries without a work are left out;
  - votes, tiebreaks and placements map to the right key;
  - a vote for a duel whose sides share a work goes to side A;
  - the duplicate-work 409 still fires, and `Vary` is set;
  - tier lists also cover the frozen snapshot zip, a length mismatch, and
    the mural and profile map.
- **PRs 5–6:**
  - shared tests for `workIdOf`, ballots, results and seeding;
  - public mural matching by `key` (`adapters.test.ts`);
  - voting by `workId`;
  - pickers hide used works and books without a work;
  - a `device-checker` pass covering arena seed and vote, tier list create,
    edit, vote and results, quiz create, and a public mural with a tier list
    block.
- **PRs 7–9:**
  - migration tests from E1-shaped fixtures: entries without a work,
    duplicate works, a snapshot length mismatch, a duel whose sides share a
    work, a promoted tier list;
  - the routes after the pass;
  - `rekeyBooks` touches murals only;
  - the pre-removal check before the deploy and the works check after it.
