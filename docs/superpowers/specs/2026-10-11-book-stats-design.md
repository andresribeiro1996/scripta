# Book stats — design

Pieces 2 and 3 of the book screen work. Piece 1 (merged book screen, `docs/superpowers/specs/2026-10-11-merged-book-screen-design.md`, branch `claude/book-details-menu-ui-01a2bc`) is being built in parallel; this spec only depends on it for the UI PR.

## Goal

Show how a book does beyond its Open Library score: the community's "how it landed", its average tier across published tier lists, and its tournament record — as a strip on the book screen and a full Stats page.

## Non-goals

- Per-tier histogram, per-tierlist breakdown, quiz stats (quizzes don't link answers to books).
- Any opt-out setting for contributing ratings.
- Recounting tournament duels without anonymous votes.
- Caching or precomputing stats.

## Delivery

1. **PR A — backend + shared** (this worktree, from `main`): library `rating` column and backfill, three queries, `GET /works/:id/stats`, `bookStatsModel`. Can merge before piece 1.
2. **PR B — UI** (after piece 1 is on `main`): strip on the book screen, Stats page on web and mobile.

## Counting rules

All three stats count signed-in accounts only. Tournaments are the one exception, by necessity: round winners are settled with anonymous votes included, and the stats use those official results.

### Community rating

- `library_books` gains `rating INTEGER` (1–5 or NULL), set from the library book's `Rating` when it is a number 1–5, else NULL.
- `LIBRARY_ROWS_VERSION` goes 1 → 2 so `backfillLibraryDerived` (startup migration) rebuilds every account's rows once and fills `rating` for existing libraries. The column is added in `applyLibrarySchema` with the same `PRAGMA table_info` + `ALTER TABLE` retrofit `work_id` uses.
- Aggregate over the work's `aliasIds`: rows with `read_status = 2` and `rating IS NOT NULL`, one per user: a user holding two finished, rated editions counts once, using their lowest-`position` such row (the same ordering `copyOfWork` and `holdersOfWorks` use).
- Returned only when `count >= 3`; otherwise `null`. The viewer's own rating counts.
- Shape: `{ average: number; count: number; distribution: [number, number, number, number, number] }`, `distribution[i]` = ratings equal to `i + 1`.

### Average tier

- Source: `tierlist_ballot_placements` joined to `tierlist_ballots` with `voter_user_id IS NOT NULL`, joined to `tierlists` with `vote_code IS NOT NULL`, for the work's `aliasIds`.
- Each placement's tier index comes from that list's `data.tiers` array order; position = `index / (tiers - 1)`, 0 = top. Lists with fewer than 2 tiers, and placements whose `tier_id` isn't in `data.tiers`, are skipped.
- Average placements within each list, then average the lists equally → `score` in [0, 1].
- Letter: `["S", "A", "B", "C", "D"][Math.min(4, Math.floor(score * 5))]`.
- Returned only when counted placements (`ballots`) ≥ 3; otherwise `null`.
- Shape: `{ score: number; letter: "S" | "A" | "B" | "C" | "D"; lists: number; ballots: number }`.

### Tournaments

- Tournaments with `status != 'seeding'` that have a `tournament_slots` row for one of the work's `aliasIds`.
- `entered`: those tournaments. `wins` / `losses`: settled duels (`winner_side` set) where the work is on side a or b. `titles`: completed tournaments whose final (max-round settled duel) it won.
- `best`: the furthest round it played in, as `{ round: number; duels: number }` where `duels = bracket_size / 2^round`; the label comes from the shared `roundLabel(duels, round)` ("Final", "Semis", "Quarters", "Round N"), or "Winner" when `titles > 0`.
- `null` when `entered = 0`. No minimum (tournaments are public).
- Shape: `{ entered: number; titles: number; wins: number; losses: number; best: { round: number; duels: number } | null }`.

## Endpoint

`GET /works/:id/stats` — optional auth (only to keep the route shape of `/works/:id`; stats are the same for every viewer), `Cache-Control: no-store`, 404 for an unknown work, canonical-id resolution like `/works/:id`.

```ts
type BookStats = { community: CommunityRating | null; tiers: TierStanding | null; tournaments: TournamentRecord | null };
```

Types live in `packages/shared/src/works/bookStats.ts`, alongside the model. The service is `backend/src/modules/works/stats.ts`, a factory taking deps the same way `createWorksService` does:

- `getWorkPage(id)` → for `aliasIds` (existing dep).
- `communityRatings(workIds)` → `Array<{ userId: string; rating: number }>` (library module).
- `tierPlacements(workIds)` → `Array<{ tierlistId: string; tierIndex: number; tierCount: number }>` (tierlists module; maps `tier_id` through `data.tiers`).
- `tournamentRecord(workIds)` → `{ entered; titles; wins; losses; best }` raw (arena module).

Wired in `app.ts` next to the works service.

## Shared model

`bookStatsModel(stats: BookStats | null, openLibrary: WorkRating | null)` in `bookStats.ts` returns:

- `strip`: up to four cells `{ key, value, label }` in order Open Library (`★ 4.1` / `Open Library`), community (nearest feeling / `12 readers`), tiers (`A tier` / `4 lists`), tournaments (`1 title` / `3 tournaments`, or best-round label / `N tournaments` when no titles). Cells with no data are absent; `stats === null` (still loading or failed) gives only the Open Library cell.
- `page`: sections for the Stats page — ratings (Open Library line, community feeling + `3.8 average · 12 ratings` + five bars from All-time down to Not for me with `count` and `fraction` of the largest bar, or the "Shown once 3 readers have rated it." line), tiers (letter + `Average across 4 published tier lists · 23 votes`, or "Shown once 3 people have voted on it in tier lists."), tournaments (entered, titles, `W–L`, best label, or "Not in any tournament yet.").

Nearest feeling: `FINISH_FEELINGS` entry whose rating equals `Math.round(average)`.

## UI (PR B)

- **Strip** on the book screen under the genre chips, replacing the `★ rating` part of piece 1's meta line (the meta line keeps year and pages). Hidden when it has no cells. Tapping it opens `/work/:id/stats`. The book screen fetches `/works/:id/stats` with its own query (`["works", id, "stats"]`), so the page never waits on it.
- **Stats page** `/work/:id/stats`: public route on web and mobile (mobile in `(home,arena,library)` and `(public)` like `work/[id]`). Header with the title and back. Three sections as the model describes. Bars are plain views/divs with percentage widths.
- Loading: skeleton; error: retry, same as the book page.

## Error handling

- The stats query failing on the book screen leaves the strip with the Open Library cell only; no error UI there. The Stats page shows the error state with Retry.
- A malformed `tierlists.data` JSON propagates (it's written only by our code); no silent skip.
- Backfill failures per account keep today's logging in `backfillLibraryDerived`.

## Testing

- Library: `bookRow` sets `rating` (valid, out-of-range, missing); repository writes it; `communityRatings` returns one row per user, finished and rated only.
- Tierlists: `tierPlacements` excludes anonymous ballots and unpublished lists, maps tier ids through `data.tiers`.
- Arena: `tournamentRecord` ignores seeding tournaments, counts wins/losses/titles, finds the furthest round.
- Works stats service: the 3-rating and 3-ballot minimums, equal weighting of lists of different sizes, 1-tier lists skipped, letter bands at their edges, 404 for unknown work.
- Route: `GET /works/:id/stats` 200 shape, 404, `no-store`.
- Shared: `bookStatsModel` strip cells for each null combination, nearest feeling rounding, bar fractions, every empty-state line.
- PR B: typecheck, lint, tests on both clients; browser check on web; device-checker pass on mobile.

## Rollout

The rows-version bump makes the first boot after deploy re-derive every library. Check the startup log line (`library backfill: rebuilt N accounts in M ms`) after deploy; if it is slow enough to matter, that is a deploy-time concern for the user, not something this change works around.
