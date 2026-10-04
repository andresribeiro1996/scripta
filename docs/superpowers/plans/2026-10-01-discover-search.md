# Discover and people search: implementation plan

> **For agentic workers:** implement task by task, verify each, commit each task separately. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A Discover search reads only matching rows and builds summaries only
for the page it returns, and both clients stop sending a request on every
keystroke.

**Spec:** `docs/superpowers/specs/2026-10-01-load-safety-design.md`,
workstream 3.

**Today** (`backend/src/modules/community/service.ts`, `getDiscover`): any
non-empty `q` loads the newest 500 published tier lists and 500 tournaments,
builds a full summary for each (two `JSON.parse` calls and a COUNT query per
tier list, plus a whole-table `GROUP BY` over ballots), resolves every owner,
then filters names in JavaScript and slices one page. Signed-in viewers also
build full summaries for every list they ever voted on, just to get a set of
ids. Both clients fetch on every keystroke (web
`frontend/src/pages/DiscoverPage.tsx`, `PeoplePage.tsx`; mobile
`mobile/src/features/community/DiscoverPane.tsx`, `PeoplePane.tsx`).

**Rules:** root `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`,
`mobile/AGENTS.md`. No code comments. The response shape of
`GET /community/discover` (`{ items, nextOffset }`) and its `offset` paging
must not change. New `*.test.ts` files go into the package's test list.
Verify with:

```
npm run build --workspace @scripta/shared
npm run typecheck --workspace backend && npm test --workspace backend
npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend
npm run typecheck --workspace mobile && npm test --workspace mobile
```

---

## Task 1: A searchable name key on tier lists and tournaments

**Files:** `backend/src/modules/tierlists/adapters/sqlite/{schema.sql,connection.ts,sqliteTierlistsRepository.ts}`,
`backend/src/modules/arena/adapters/sqlite/{schema.sql,connection.ts,sqliteArenaRepository.ts}`,
their repository tests.

- [ ] Add a nullable `name_key TEXT` column to `tierlists` and `tournaments`
  with the existing `PRAGMA table_info` + `ALTER TABLE` pattern in each
  `connection.ts`, and to each `schema.sql`.
- [ ] `name_key = normalizeWords(name)` from `@scripta/shared`
  (`packages/shared/src/library/bookMatch.ts`: accents removed, lowercase,
  punctuation as spaces). Every repository statement that writes `name`
  (insert, rename, publish, promote, copy: find them all with
  `rg -n "name" …Repository.ts`) also writes `name_key`.
- [ ] At open, fill `name_key` for rows where it is `NULL` (old rows), in one
  transaction.
- [ ] Add `CREATE INDEX IF NOT EXISTS idx_tournaments_public ON
  tournaments(created_at DESC) WHERE status != 'seeding'` so the newest-first
  listing doesn't sort the whole table (tier lists already have
  `idx_tierlists_public`).
- [ ] Tests: creating, renaming and publishing keep `name_key` in step; a row
  with `NULL` gets filled on open.

## Task 2: Window queries and page-only summaries

**Files:** the two repositories and services, `tierlists/service.ts`
(`TierlistsPublicApi`), `arena/service.ts` (`ArenaPublicApi`), their tests.

Add to each module's public API (names are suggestions; keep each module's
own style):

- [ ] `discoverWindow(needle, limit)` → `[{ id, createdAt, ownerUserId }]`
  (tier lists also `promotedAt`), newest first, only published/listed rows,
  `name_key LIKE '%' || needle || '%'` when `needle` is non-empty. No JSON
  parsing, no counts. `needle` is already normalized, so it holds no LIKE
  wildcards.
- [ ] `getPublishedMany(ids)` → the same refs `list` returns today
  (`PublishedTierlistRef` / `PublishedTournamentRef`), built only for those
  ids. Tier lists: ballot counts and eligible counts for those ids only (an
  `IN (SELECT value FROM json_each(?))` query), not `ballotCountsByTierlist()`.
  Tournaments: `summariesWithPreviews` over those rows only.
- [ ] `votedAmong(viewerId, ids)` → the subset of `ids` the viewer has a ballot
  or vote on, with the same exclusions as today's `listVotedByUser` (tier
  lists: the viewer's own lists don't count).
- [ ] Repository tests for each new query, including: an accented name found
  by an unaccented needle, a non-matching row excluded, unpublished and
  `seeding` rows excluded, counts correct for the requested ids only.

## Task 3: `getDiscover` on the new queries

**Files:** `backend/src/modules/community/service.ts`,
`backend/src/app.ts` (deps wiring), `backend/src/modules/community/service.test.ts`,
`backend/src/modules/community/routes.test.ts`.

- [ ] Replace the `tierlists.list` / `tournaments.list` / `listVotedByUser`
  deps of the community service with the three new functions, and wire them
  in `app.ts`. Remove deps that become unused.
- [ ] New flow:
  1. `needle = normalizeWords(q)`.
  2. `window = needle ? 500 : Math.min(offset + limit + 1, 500)` per type
     (the same caps as today's `DISCOVER_SCAN_CAP`).
  3. Read both windows (respecting `type`), resolve authors for the distinct
     owner ids, drop entries with no author except promoted tier lists, which
     keep the "Original creator unavailable" author exactly as today.
  4. Sort by `createdAt` descending, slice `offset .. offset + limit`,
     compute `nextOffset` exactly as today.
  5. Only for the page: `getPublishedMany`, `votedAmong` (signed-in viewers),
     `withGlyph` authors, same item shape and `viewerVoted` flag as today.
- [ ] Matching becomes accent- and punctuation-insensitive (`"habitos"` finds
  `"Hábitos Atómicos"`). Add a test for that; all existing discover tests
  must pass unchanged otherwise.
- [ ] A test that a search returns the right page when more than one page of
  rows matches, including `nextOffset`.

## Task 4: Wait for a pause in typing (web)

**Files:** new `frontend/src/hooks/useDebouncedValue.ts`,
`frontend/src/pages/DiscoverPage.tsx`, `frontend/src/pages/PeoplePage.tsx`.

- [ ] `useDebouncedValue(value, delayMs)` returns `value` after it has stopped
  changing for `delayMs` (a `setTimeout` cleared on change and unmount).
  First check `frontend/src` and `packages/shared` for an existing debounce to
  reuse; the inline 400 ms debounces in `LibraryStylePage.tsx` are not
  reusable hooks.
- [ ] Discover and People keep the input value immediate and pass
  `useDebouncedValue(search.trim(), 300)` to their query hooks.

## Task 5: Wait for a pause in typing (mobile)

**Files:** `mobile/src/features/community/DiscoverPane.tsx`,
`mobile/src/features/community/PeoplePane.tsx`, and the existing
`mobile/src/features/library/lib/debounce.ts`.

- [ ] Same behaviour as Task 4, 300 ms. Reuse
  `mobile/src/features/library/lib/debounce.ts` (`useDebouncedCallback`), or
  add a `useDebouncedValue` next to it there if a value hook is cleaner; don't
  create a second debounce helper elsewhere.

## Done when

- All tasks committed; every verify command above passes.
- Report test counts per package, and the files touched in each client.
