# Book stats v2 — tier list direction and stats presentation

Follows `docs/superpowers/specs/2026-10-11-book-stats-design.md` (shipped in #221 and #224, not yet deployed). Two PRs, in order:

1. **PR C — tier list direction.** A tier list says, once at creation, whether its top tier is the best or the worst, and book stats respect it.
2. **PR D — presentation.** The book-screen strip becomes big-number tiles; the Stats page gets one picture per section; tier standing becomes words, not letters.

## Why

- Book stats average every published tier list as if its top tier were the best. A "Worst books of 2024" list puts the worst book at the top, so it pulls that book towards "Top tier".
- Tier lists label their own tiers ("Loved / Liked / Meh", S–F, 3 or 8 tiers). Showing a book as "S tier" invents a letter nobody chose.
- The owner didn't like the current strip (bordered two-column grid) or the three similar text blocks on the Stats page; picked option B (tiles) from the mockups.

## PR C — tier list direction

### Data

- `tierlists.ranks_worst_first INTEGER NOT NULL DEFAULT 0`, in `schema.sql` and retrofitted in `applyTierlistsMigrations` with the existing `PRAGMA table_info` + `ALTER TABLE` pattern. Existing lists read as best-first.
- `TierlistRow.ranks_worst_first: number`; the insert statement binds it.
- `POST /tierlists` accepts `ranksWorstFirst?: boolean` (default `false`). No other route accepts it, and the repository `update` statement doesn't set it, so it cannot change after creation. There is no copy/fork flow to inherit it.
- Shared `Tierlist` and `VotingBoard` gain `ranksWorstFirst: boolean` (the voting route builds its response field by field, so it's added there explicitly). `createTierlist(name, data?, access?, ranksWorstFirst?)`.

### Creation UI

- The settings step of tier list creation (web `TierListCreatePage`, mobile `TierlistCreateScreen`) gains "Top tier means": **Best** (default) / **Worst**, with the hint "Can't be changed later." Web uses the page's existing radio fieldset style; mobile uses `Segmented`, like the visibility and access controls beside it.
- Offered for private and public lists alike, since a private list can be published later and the choice is fixed.

### Voters

- When `ranksWorstFirst` is true, the voting screen shows "Top tier = worst" next to the list's status: under the title on web `VoteTierlistPage` (both the voting and results views), as its own one-line caption above the board header on mobile `VoteTierlistScreen`, on both the My board and Community tabs. Best-first lists show nothing new.

### Stats

- `tierPlacements` also returns `ranksWorstFirst` per placement (from `t.ranks_worst_first`).
- The works stats service flips worst-first positions: `position = index / (tierCount - 1)`, then `1 - position` when `ranksWorstFirst`. Everything else (1-tier lists skipped, lists weighted equally, minimum 3) is unchanged.

### Tests

- Repository: the column retrofit on an old table; insert stores the flag; `tierPlacements` returns it.
- Routes: create accepts and returns `ranksWorstFirst`; `PUT /tierlists/:id` with it in the body leaves it unchanged; the voting board includes it.
- Stats service: a worst-first list's top-tier votes count as bottom.
- Shared API: `createTierlist` sends the field.
- Web and mobile: typecheck/tests; web render check of the creation step and the voter caption; emulator pass of the creation step and the voter caption.

## PR D — presentation

### Shared model (`bookStats.ts`)

- `tierBand(score)` returns `"Top tier" | "Upper tiers" | "Middle" | "Lower tiers" | "Bottom tier"` using the same five equal bands (`Math.min(4, Math.floor(score * 5))`).
- The stats response keeps `tiers.letter` (and shared `tierLetter`/`TierLetter`) because installed builds from the previous release read it (backend/CLAUDE.md additive-API rule); clients no longer display it. Removal is a follow-up once no shipped build reads it.
- `bookStatsModel` returns:
  - `tiles`: up to four `{ key, value, caption }`, in this order, each only when its data exists:
    - Open Library: `4.4` / `★ Open Library`
    - Community: average to one decimal, `3.8` / the nearest feeling, `Loved it`
    - Tier lists: the band's first word, `Upper` / `tiers · 2 lists` (`Top` / `tier · 1 list` for "Top tier"; singular/plural by band and list count)
    - Tournaments: `🏆` / `Winner` when it has a title, else the best round label (`Semis`), else `Entered` (in a bracket that hasn't played its round yet)
  - `ratings`: Open Library line (unchanged); community `{ feeling, summary, columns }` where `columns` are the five feelings from "Not for me" to "All-time", each `{ label, count, fraction, top }` (`fraction` of the largest, `top` on the largest; ties all `top`); the empty line (unchanged).
  - `tiers`: `{ band, marker, summary }` with `marker = score` (0 = top, 1 = bottom) and the summary `Across 2 published tier lists · 4 votes`; the empty line (unchanged).
  - `tournaments`: `{ path, champion, summary }` — `path` is the best run's rounds from round 1 to the final, each `{ label, reached }` using `roundLabel(duelsInRound, round)` with `duelsInRound = 2^(finalRound - round)` and `finalRound = best.round + log2(best.duels)`; `reached` for rounds ≤ `best.round`; `champion` when `titles > 0`; summary `1 tournament · 2 won, 1 lost · 0 titles` (plurals). No path when `best` is null. The empty line (unchanged).

### Book screen

- The strip becomes one row of equal tiles (big value, small caption), in a single tappable control that opens the Stats page, with the accessible name "Book stats: " followed by each tile's value and caption. Missing stats drop their tile and the rest widen. Loading/failure: only the Open Library tile, as now.

### Stats page

- **Ratings**: Open Library line; the feeling large with the summary under it; five vertical columns with labels under them, the top column in the accent colour, heights by `fraction`.
- **Tier lists**: the band large; a Top ←→ Bottom bar with a marker at `marker` and the end labels "Top" and "Bottom"; the summary.
- **Tournaments**: the path as connected steps (reached steps highlighted) ending in 🏆 (highlighted when `champion`); the summary under it.
- Empty states unchanged.

### Tests

- Shared: `tierBand` edges; tiles for each combination and the singular/plural captions; columns `top` with ties; path for brackets of 4, 8 and 64 with best round 1, the semis and a title.
- Backend: the stats response keeps `letter`; clients no longer display it. Removal is a follow-up once no shipped build reads it.
- Web render tests for the tiles and the three sections; mobile typecheck/tests; emulator pass of the tiles (Android text in narrow tiles) and the three sections.
