# Load safety: bounded work per request

Date: 2026-10-01
Status: decisions approved in conversation, including the inbox and trace
ids for workstream 5; a plan exists for each workstream

## Problem

The backend is one Node process using `node:sqlite`'s synchronous
`DatabaseSync`. Node runs one piece of JavaScript at a time, so a request
that computes for 500 ms delays every other request by 500 ms, `/health` and
logins included. PR #95 fixed three stalls. A follow-up audit (this spec)
found the rest, and the rule they all break:

**Every request's main-thread work must be small and bounded.** Indexed
queries, capped rows, no per-request parsing of whole libraries. Heavy work
happens at write time, in a background lane, or in a child process.

SQLite itself is not the problem: indexed queries take microseconds. What
blocks is JavaScript processing of large JSON documents and unbounded scans,
which would block the same way with any database. The "sqlite vs rdb" session
(2026-09-30) decided SQLite stays; nothing here changes that.

## Measurements

Node 24.21, this repo's code paths reproduced in isolation.

| Library document | Size | `JSON.parse` |
|---|---|---|
| 5,000 books, no highlights | 2.4 MiB | 14 ms |
| 5,000 books, 10 highlights each | 24 MiB | 71 ms |
| 35,000 books, no highlights | 16.6 MiB | 69 ms |

The 2026-10-01 security review measured 0.8 s for
`GET /community/profiles/:username/library` on a 24 MiB library (parse, a
covers-DB lookup per book, and serialising the response), and `/health`
waiting 3.2 s behind one heavy request (since fixed).

Dashboard feed, 100 viewers who each follow 1,000 accounts, page of 21:

| Design | 30k events in 30 days | 300k events in 30 days | Worst case |
|---|---|---|---|
| Today (one query per followee, up to 5 rounds) | 14.6 ms per round | 147 ms per round | grows with follows × rounds |
| One join query | 4.6 ms | 52.5 ms | grows with followees' activity |
| Scan newest events, probe follows | — | 0.8 ms | 880 ms when followees are silent |
| **Inbox, written when the event happens** | — | **0.13 ms** | grows only with rows an author hid after writing them, 30 days at most (about 45 ms a page at 30k) |

With 100 people opening the dashboard at the same moment, requests run one
after another: at 52 ms a page the last person waits ~5 s; with the inbox,
~15 ms.

## Workstreams

Five workstreams. 1–4 run in parallel and ship as one PR. 5 starts from
that PR's branch.

### 1. Abuse guards

- **Auth before the body on `PUT /library`.** `authGuard` moves from
  `preHandler` to `onRequest` on that route, so an anonymous request is
  rejected before Fastify reads and parses up to the body limit.
- **Trusted proxies.** `trustProxy: true` trusts every `X-Forwarded-For`
  entry, so `request.ip` (every rate limit's key) is whatever the client
  writes. A numeric hop count does not work: Fastify 5.12 ignores the header
  entirely for numbers ("fail closed"). Instead trust a fixed list of proxy
  ranges: loopback, `100.64.0.0/10` (Railway's edge), and Cloudflare's published
  ranges. `request.ip` becomes the first address that isn't a trusted proxy:
  the real client, whether the request came through Cloudflare or straight
  to Railway's domain. **Gate:** before merging, confirm Railway's edge
  connects from inside those ranges (production check in the plan). If it
  doesn't, every client would share one rate-limit bucket.
- **Rate limits keyed per user when signed in**, per IP otherwise, via a
  `keyGenerator` that reads the bearer token with
  `getOptionalAuthenticatedUser`:

  | Routes | Limit |
  |---|---|
  | `PUT /library` that declares a `Content-Length` of at most 1 MiB (one bucket per account, shared with the next row; 120 because group curation sends a save per checkbox, and a save of a library that small costs about 65 ms, so 120/min is about 13% of the event loop; a small save that conflicts with a big stored library answers 409 with the whole stored document, about 75–150 ms, until library rows replace whole-document saves) | 120/min |
  | `PUT /library` over 1 MiB or with no or an invalid `Content-Length`, `POST /library/books`, `POST /library/books/add`, `POST /library/books/merge`, `POST /library/share`, `POST /library/unshare` (same bucket; measured at the 10 MiB cap through the real route, a save costs 0.3–0.65 s and a share or unshare 148–164 ms, so 30/min is about a third of the event loop where 120/min would be 65–130%; add-book and merge process the whole stored document, so their cost grows with the stored library, not with their tiny bodies) | 30/min |
  | `POST /library/groups/:groupId/books`, `PATCH /library/books` (own bucket per account, apart from whole-library saves; each reads and rewrites the stored document, measured at 140–200 ms for a 10 MiB one, so 60/min is about 20% of the event loop) | 60/min |
  | `GET /library` | 60/min |
  | `GET /community/dashboard` | 60/min |
  | `GET /community/people` | 60/min |
  | `POST /community/follows`, `DELETE /community/follows/:userId` (one shared bucket; a follow copies the followee's recent events into the follower's inbox and an unfollow deletes them) | 30/min |
  | `PUT /community/profile/feed-settings`, `PUT /community/profile/publish` (one shared bucket; turning a category on copies the author's last 30 days of it into every follower's inbox, up to 100 rows each, in the background) | 30/min |
  | `GET /arenas/public` | 30/min |

- `backend/README.md`: the auth limit of 20/min covers every `/auth` route,
  not only signup/login/refresh/logout as it says.

### 2. Stall logging

- A wrapper installed with Fastify's `onRoute` hook times the synchronous part
  of every handler. Over 200 ms it logs `warn` "handler blocked the event
  loop" with method, route and milliseconds.
- `perf_hooks.monitorEventLoopDelay` catches stalls outside handlers (body
  parsing, timers, startup jobs): every 10 s, a max delay over 200 ms logs
  `warn` "event loop stalled".
- Not `onResponse` timing: it includes awaited I/O and slow downloads, so it
  would report routes that never blocked. Fastify already logs `responseTime`
  per request.

### 3. Discover and people search

- **Search in SQL.** A non-empty `q` filters names with `LIKE` in the
  tier list and tournament queries, so only matching rows are read. The newest
  500 matches per type are considered (today: matches among the newest 500
  rows, so older matches were never found).
- **Work only for the page.** The window is merged by `created_at` using ids
  and dates alone; summaries, ballot counts, eligible counts, cover previews
  and "you voted" flags are built only for the page's ≤50 rows. Today
  each search groups the whole ballots table twice and parses every scanned
  tier list.
- **Clients wait for a 300 ms pause in typing** before searching Discover or
  People, on web and mobile. The server change matters more: installed mobile
  builds keep searching on every keystroke.
- Response shape and paging (`offset`, `nextOffset`) unchanged.

### 4. Library size cap: 10 MiB

- `LIBRARY_BODY_LIMIT_BYTES` default 25 MiB → 10 MiB. It also caps import
  previews, which use the same limit.
- Bytes, not books or highlights: parse cost grows with bytes, and highlights
  dominate size (5,000 books are 2.4 MiB bare, 24 MiB with 10 highlights each).
- Both clients show a clear message for `LIBRARY_BODY_TOO_LARGE` and
  `IMPORT_TOO_LARGE` instead of a generic error.
- **Gate:** before merging, the production size check must show no stored
  library over 10 MiB; an account over the cap could no longer save at all.
- A stop-gap until books are rows (see "Next"), when per-book limits replace
  the whole-document cap.
- Dropped from the audit: cutting stored cover URLs to 512 characters. The
  tables it shrinks are replaced by library rows.

### 5. Dashboard feed

Decided in conversation (the inbox follows standard social-feed practice,
"fan-out on write"):

- **Events are hot for 30 days.** A job moves older rows from `events` to a
  new `events_history` table (same columns), kept for metrics; when to clean
  it is decided later. Batches of 250, yielding between batches, at boot
  and daily.
- **Profile activity pages read through to history**, so an inactive
  reader's profile doesn't look empty after 30 days.
- **Follow cap: 1,000** accounts per follower.
- **Book events: 100 per author in any rolling 24 hours.** A save already
  emits at most 10, but alternating between two sets of 10 books makes 10 new
  events on every save, and at the library write limit of 120 a minute that is
  1,200 events a minute. Everything that reads an author's events grows with
  that: the activity page, copy-on-follow, and the inboxes when reading is on.
  Past 100 events of the reading category in 24 hours an event is not recorded
  at all. The check is in the community public API's `emitEvent`, the path the
  library uses, and counts with a bounded query on `idx_events_user_time`.
- **Participation cards** ("N people voted on your tier list") only for games
  with votes in the last 30 days.
- **"New" badge** is one count capped at 100, shown as 99+.
- **Feed settings become columns** (`show_publications`, `show_reading`,
  `show_votes`, `show_follows`, `show_reader_glyph`) so the feed filters in
  SQL. The boot migration copies the JSON; an unreadable row becomes all
  off and is logged (privacy fails closed). The API shape is unchanged.

- **Every event records what caused it.** `trace_id` is the id of the request
  that emitted it; the same id is `reqId` on every log line of that request,
  so an event can be followed from the click through the logs to the inbox
  rows. `source` is the route pattern (`POST /tierlists/:id/open-voting`).
  Request ids become UUIDs so they stay unique across restarts. Both columns
  move to `events_history` with the event. Every emitter today runs inside a
  request; a future background job that emits events sets `source` to
  `job:<name>`.

**An inbox written when an event happens, holding only what its author
shows:**

- `feed_inbox (viewer_id, created_at, event_id, author_id)`, primary key
  `(viewer_id, created_at, event_id)`, plus indexes on
  `(viewer_id, author_id)` and `(created_at)`.
- Writing an event also runs one `INSERT … SELECT` from `follows` into the
  inbox of every follower, but only if the author's switch for the event's
  category is on (the `show_*` columns; the defaults when there is no profile
  row, so reading is off). Measured 25–60 ms for an account with 10,000
  followers (3–6 µs each), so no batching until someone has far more; a hidden
  event at the same size writes nothing and takes about 2 ms.
- **Why the filter is on the write too.** The first version wrote a row for
  every feed event and filtered on read. Reading is off by default, so every
  book event of every followee became a hidden row the reader walks past: the
  whole-branch review measured 45 ms for a first page plus 41 ms for the new
  count, on every dashboard open, for a viewer following 1,000 authors with
  30k such rows in 30 days, and about 980 ms a page at 300k. The read keeps its
  filter, using the same SQL fragment as the write so they cannot disagree, so
  a category switched off after rows were written is hidden at once; those rows
  stay until they age out, and switching the category back on shows them again.
- Switching a category on brings the author's last 30 days of it into every
  follower's inbox, the newest 100 per follower (`FOLLOW_COPY_LIMIT`), with
  the events' own dates. Saving feed settings, or publishing with
  `shareReading`, compares the switches before and after, and for the feed
  types of the categories that came on starts a background task in the
  handler. The task yields to the event loop before its first batch, so its
  batches run on later turns, after the request has answered. It lists the
  author's followers and fills 50 at a time
  (`BACKFILL_BATCH`): one `INSERT OR IGNORE … SELECT` per batch in its own
  transaction, with a turn of the event loop before it, selecting the events
  once and joining them to the batch's followers in `follows`, so a reader who
  unfollows before their batch gets nothing. It applies the same `authorShows`
  fragment as the other writes. A failure is logged
  (`community feed backfill failed`); a restart in the middle leaves the
  followers not yet reached without the rows until the author switches the
  category off and on again. A batch of 50 followers and 100 events is 5,000
  rows and 15–35 ms; 1,000 followers take about 0.5 s and 10,000 about 7 s,
  in turns of at most 76 ms.
- Following someone copies their events of the last 30 days into your inbox,
  only the categories they show now, newest first, at most 100
  (`FOLLOW_COPY_LIMIT`); unfollowing deletes theirs. Rows older than 30 days
  are deleted with the event move.
- A feed page is one indexed range read of the viewer's inbox, joined to
  `events` and the author's settings columns. It reads only rows the author
  showed, so its cost does not grow with hidden activity or with how many
  people you follow. The only rows it walks past are those hidden after they
  were written.
- The one-time inbox fill at first boot is the exception and ignores the
  switches: on an existing database it runs before the `show_*` columns
  exist. Its rows from hidden categories are filtered at read and age out
  within 30 days.
- Account deletion also clears the user's inbox rows (as viewer and as
  author) and their `events_history` rows.

## API compatibility

Additive only (`backend/AGENTS.md`). No response shape changes. New
behaviours old clients may see: `429` on the newly limited routes, `413` for
libraries over 10 MiB, `400`/`409` when following past 1,000.

## Next: the data model

Separate specs, because they change what the app stores:

- **Works** (`2026-10-01-works-design.md`): a `works` table above editions,
  and a language on every edition.
- **Library rows** (`2026-10-01-library-rows-design.md`): books, highlights
  and groups as rows instead of one JSON document per account.
