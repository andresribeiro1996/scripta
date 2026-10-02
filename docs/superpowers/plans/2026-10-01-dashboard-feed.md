# Dashboard feed on an inbox: implementation plan

> **For agentic workers:** implement task by task, verify each, commit each task separately. Steps use checkbox (`- [ ]`) syntax. Run a spec review and a quality review after each task (`.claude/agents/`).

**Goal:** Opening the dashboard costs the same small, indexed read however many
people you follow and however active they are; events older than 30 days move
to a history table; every event records the request that caused it.

**Spec:** `docs/superpowers/specs/2026-10-01-load-safety-design.md`,
workstream 5.

**Base:** start from `claude/exciting-brown-ccq1ct` after workstreams 1–4 are
integrated there (they touch `app.ts`, the community routes, and the tier list
and arena repositories this plan also changes).

**Today** (`backend/src/modules/community/service.ts`, `getDashboard`): every
page runs one events query per followee for up to 5 rounds, re-reading each
followee's feed settings every round, then a 100-row-per-followee pass to count
what's new. Measured with 1,000 follows and 300k events in 30 days: 147 ms per
round. With the inbox: 0.13 ms per page (spec, "Measurements").

**Rules:** root `AGENTS.md`, `backend/AGENTS.md`. No code comments. The
`GET /community/dashboard` response shape, its `kinds` and `cursor`
parameters, and `GET /community/profiles/:username/activity` must not change.
New `*.test.ts` files go into `backend/package.json`'s `test` list. Verify with:

```
npm run build --workspace @scripta/shared
npm run typecheck --workspace backend
npm test --workspace backend
```

---

## Task 1: Trace context for every request

**Files:** new `backend/src/trace.ts` and `backend/src/trace.test.ts`,
`backend/src/app.ts`, `backend/package.json`.

- [ ] Both `Fastify(...)` calls in `app.ts` pass `genReqId: () => randomUUID()`,
  so `reqId` in logs (and the trace id below) is unique across restarts.
- [ ] `trace.ts` keeps an `AsyncLocalStorage<{ traceId: string; source: string }>`
  and exports:
  - `registerTrace(app)`: an `onRequest` hook
    `(request, _reply, done) => storage.run({ traceId: request.id, source: \`${request.method} ${request.routeOptions.url ?? request.url}\` }, done)`
    (running `done` inside `run` carries the context through the rest of the
    request);
  - `currentTrace()`: the store, or `undefined` outside a request.
- [ ] `app.ts` calls `registerTrace(app)` next to `registerStallLog(app)`,
  before any route.
- [ ] Tests: inside a handler, before and after an `await`, `currentTrace()`
  has the request's id and `"GET /things/:id"`; two overlapping requests each
  see their own; outside a request it is `undefined`.

## Task 2: Events record their trace; the history table

**Files:** `backend/src/modules/community/adapters/sqlite/{schema.sql,connection.ts,sqliteCommunityRepository.ts}`,
`backend/src/modules/community/domain/types.ts`,
`backend/src/modules/community/service.ts`, their tests.

- [ ] `events` gains nullable `trace_id TEXT` and `source TEXT` (the existing
  `tableColumns` + `ALTER TABLE` pattern in `connection.ts`).
- [ ] New `events_history` with exactly the columns of `events` (including the
  two new ones), primary key `id`, indexes `(user_id, created_at DESC, id DESC)`
  and `(created_at)`. No unique indexes: history only receives rows.
- [ ] Both emit paths, `emit` inside `createCommunityService` and
  `createCommunityPublicApi().emitEvent`, fill `trace_id` and `source` from
  `currentTrace()` (`NULL` when absent).
- [ ] Tests: an event emitted while handling an injected request stores that
  request's id and route pattern; one emitted outside a request stores `NULL`s.

## Task 3: Feed settings as columns, failing closed

**Files:** community `schema.sql`, `connection.ts`, `sqliteCommunityRepository.ts`,
their tests.

- [ ] `profiles` gains `show_publications`, `show_reading`, `show_votes`,
  `show_follows`, `show_reader_glyph`: `INTEGER NOT NULL` with defaults equal to
  `DEFAULT_FEED_SETTINGS` (1, 0, 1, 1, 0).
- [ ] When the columns are added, copy every non-null `feed_settings` JSON into
  them in one transaction. JSON that fails to parse, or that
  `normalizeFeedSettings` rejects, becomes all `0` and is reported with
  `console.warn` naming the `user_id` (privacy fails closed; today it falls
  back to defaults with votes on).
- [ ] `getFeedSettings` reads the columns (a missing row still returns `null`,
  so the service's defaults for readers who never chose stay as they are).
  `updateFeedSettings` writes the columns and keeps writing the JSON too, so a
  rollback to the previous build still sees current settings.
- [ ] Tests: valid JSON is copied; unparsable and partial JSON become all off;
  a profile with no JSON gets the defaults; an update round-trips.

## Task 4: The inbox

**Files:** community `schema.sql`, `connection.ts`, `sqliteCommunityRepository.ts`,
`domain/ports.ts`, `domain/types.ts`, their tests.

- [ ] Table, created with the schema:
  ```sql
  CREATE TABLE IF NOT EXISTS feed_inbox (
    viewer_id  TEXT NOT NULL,
    created_at TEXT NOT NULL,
    event_id   TEXT NOT NULL,
    author_id  TEXT NOT NULL,
    PRIMARY KEY (viewer_id, created_at, event_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_feed_inbox_author ON feed_inbox(author_id, viewer_id);
  CREATE INDEX IF NOT EXISTS idx_feed_inbox_time ON feed_inbox(created_at);
  ```
- [ ] Feed types are the dashboard's event types: `tierlist_published`,
  `tournament_published`, `voted_on`, `book_added`, `book_finished`. Move the
  list to one constant in the community domain that the service's
  `DIGEST_EVENT_TYPES` and the repository both use.
- [ ] `insertEvent`: in one transaction, insert the event as today
  (`INSERT OR IGNORE`); only if a row was inserted and its type is a feed type,
  `INSERT OR IGNORE INTO feed_inbox SELECT follower_id, $created_at, $id, $user_id FROM follows WHERE followee_id = $user_id`.
- [ ] `insertFollow`: in the same transaction as the follow row, copy the
  followee's feed-type events from `events` into the follower's inbox.
  `deleteFollow`: delete the follower's inbox rows from that author.
- [ ] `deleteUserData` also deletes inbox rows where the user is viewer or
  author, and the user's `events_history` rows (same condition as its `events`
  delete).
- [ ] When `feed_inbox` is first created, fill it from existing data: events of
  feed types from the last 30 days joined to `follows`, one statement.
- [ ] Repository reads:
  - `listInbox(viewerId, bound, limit, types)`: inbox rows joined to `events`,
    newest first by `(created_at, event_id)`, keyset or `since` bound exactly
    like today's `withinBound`, restricted to `types`, and to categories the
    author shows: `show_publications` for the two `_published` types,
    `show_votes` for `voted_on`, `show_reading` for the two book types, using
    `DEFAULT_FEED_SETTINGS` values when the author has no profile row.
  - `countInboxSince(viewerId, since, types)`: the same filter, counted with
    `LIMIT 100`.
- [ ] Tests: an event reaches every follower's inbox and no one else's; a
  duplicate event (unique index) fans out once; follow copies recent events,
  unfollow removes them; hidden categories are filtered at read time and
  reappear when the author shows them again; account deletion clears both
  sides.

## Task 5: The dashboard reads the inbox

**Files:** `backend/src/modules/community/{service.ts,routes.ts,domain/errors.ts}`,
the tier list, arena and quiz services and repositories (`participationByOwner`
/ `listParticipation`), `backend/src/app.ts` wiring, their tests.

- [ ] `getDashboard`: the following stream is `listInbox` (replacing
  `followingWindows` and its per-followee settings reads). Personal rows
  (followers and participation) keep their current sources, limited to the
  last 30 days. Keep the existing merge, horizon and cursor logic over the two
  windows, with `DASHBOARD_REFILL_ROUNDS` lowered to 3.
- [ ] First-page counts: `followingNewCount` from `countInboxSince`;
  `personalNewCount` as today; both capped at 100 (clients show 99+).
- [ ] Participation only for games with a vote in the last 30 days:
  `participationByOwner(ownerUserId, since)` in all three modules, filtering
  games with `HAVING MAX(<vote>.created_at) >= ?`; participant counts stay
  totals.
- [ ] Follow cap: `follow` throws a new `FollowLimitError` when the follower
  already follows 1,000 accounts; the route answers `409` with
  `{ error: "You can follow up to 1,000 readers." }`.
- [ ] All existing dashboard tests pass unchanged. New tests: a viewer
  following 1,000 silent accounts gets an empty page; the cap; participation
  older than 30 days is not shown.

## Task 6: Move old events to history

**Files:** `sqliteCommunityRepository.ts`, `domain/ports.ts`,
`backend/src/modules/community/plugin.ts`, `service.ts` (`getActivity`), their
tests.

- [ ] Repository: `moveEventsBefore(cutoff, batch)` selects up to `batch`
  event ids older than `cutoff` (oldest first), copies those rows to
  `events_history` and deletes them, in one transaction, returning the count;
  `purgeInboxBefore(cutoff, batch)` deletes up to `batch` inbox rows older than
  `cutoff`, returning the count.
- [ ] `communityPlugin` runs a job at startup and every 24 hours (an unref'd
  `setInterval`, cleared in `onClose`, like the arena sweep): cutoff = now − 30
  days; batches of 1,000, awaiting `setImmediate` between batches; logs one
  `info` line with the totals; errors go to `app.log.error` and never crash the
  process.
- [ ] `getActivity` (profile activity) continues into `events_history` once
  `events` runs out, with the same keyset, so pages stay continuous.
- [ ] Tests: old events move with their trace columns; inbox rows older than
  the cutoff go; recent ones stay; a profile's activity pages through hot then
  history rows without gaps or repeats.

## Task 7: Document it

- [ ] `backend/README.md`, community section: the inbox, the 30-day window and
  `events_history`, trace ids, the follow cap and the 99+ counts.

## Done when

- All tasks committed; build, typecheck and backend tests pass.
- Report test counts, and one timing from a throwaway script (not a test, not
  committed) with a viewer following 1,000 accounts and 30,000 recent events:
  a dashboard page should take a few milliseconds.
