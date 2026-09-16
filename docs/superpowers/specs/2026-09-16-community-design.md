# Community — follows, public profiles, and a home for published games

## Context

Scripta has published content (every tournament past seeding, every
community tier-list copy) but no social layer at all: no follows, no
profiles, no way to see what a *person* has published. Discovery is a
flat directory — the `/arena` page lists all public content with the
"BookArena" brand and no author identity. The `socials` module is
unrelated (it stores the user's own X/Instagram OAuth tokens).

This feature adds a **Community**: a one-way follow graph, public user
profiles, a feed of what followed users publish, and a Discover surface
that absorbs the old BookArena directory. Alongside it, the
"BookArena"/"Arena" branding renames to **"Games"**.

## Decisions locked in with the user

- **One-way follow.** No requests, no acceptance. `follows` is a set of
  (follower → followee) rows. Groups/clubs are a *future* direction,
  deliberately out of scope; the schema leaves room for a sibling table,
  nothing more.
- **Everything stays public; the feed curates.** Published tournaments
  and community tier lists do not change visibility. Following only
  changes what *you* see aggregated. No per-item audience settings.
- **Community absorbs discovery.** The old BookArena public directory
  becomes the Discover tab inside Community. "My Arena" (owner side)
  survives as "My Games", unchanged in flow. Tier lists and tournaments
  do **not** get their own browse sub-menus — one browse surface, not
  three.
- **Rename is display-only.** "BookArena"/"Arena" strings become
  "Games"/"My Games". URLs (`/arena`, `/arenas*`, `/vote/:code`), the
  mobile deep-link `pathPrefix: /arena`, backend route namespaces and
  code identifiers stay as-is. Existing shared links keep working; no
  redirect layer.
- **Feed = publish events only**, carried in an **event store**. The
  user expects new activity types later, so writes go through a small
  `events` table rather than a derived UNION. v1 writes exactly two
  event types, both at publish time.
- **Profiles are rich, and the body is a mural.** Each user already has
  a home screen that *is* a mural; the public profile reuses the proven
  shared-mural rendering pipeline instead of inventing a profile markup.
  No new mural block types.
- **Publishing a profile is opt-in, with a mural choice.** A
  "Publish profile" toggle (default off) plus a picker of which owned
  mural is the public body, defaulting to the home mural. Unpublished =
  profile 404s and the user is unsearchable.
- **No follower/following list UI in v1** — counts only. The list
  endpoints and service methods that would feed them are cut; they come
  back with the UI that consumes them.

## The two publish points feed everything

Content is already public on existing terms: a tournament becomes
visible when it leaves `seeding`; a tier list becomes public when the
owner opens voting (the frozen "community copy"). The event store is
written at exactly those two moments:

| Event | Emitted in | Ref |
|---|---|---|
| `tierlist_published` | `tierlists/service.ts` `openVoting()` | community-copy id |
| `tournament_published` | arena service, `seeding → active` transition | tournament id |

Emission is injected into those plugins from `app.ts` as
`communityPublicApi.emitEvent` — the same wiring direction the repo
already uses (murals receiving `getTierlistData`). Idempotency is the
schema's job: `UNIQUE(ref_type, ref_id)` + `INSERT OR IGNORE`, so
re-runs and re-transitions never duplicate.

Deletions are not events. Feed and Discover join events to content
summaries at read time and silently drop rows whose content is gone —
the repo's established fail-safe pattern (dangling tierlist block →
"unavailable", never a 500).

## Backend: `modules/community`

One module, own SQLite file (`COMMUNITY_DB_PATH`), following the
arena/tierlists module shape (plugin → routes → service → domain →
adapters).

### Schema

```sql
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS profiles (
  user_id      TEXT PRIMARY KEY,
  published    INTEGER NOT NULL DEFAULT 0,
  mural_id     TEXT,
  published_at TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,   -- 'tierlist_published' | 'tournament_published'
  ref_type   TEXT NOT NULL,   -- 'tierlist' | 'tournament'
  ref_id     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);
```

No cross-module foreign keys anywhere — user and content ids are opaque
strings trusted because auth verified them, as everywhere else.

### Rules

- **Follow targets must have a published profile.** No half-visible
  users: if someone is followable, their profile resolves; if they
  unpublish later, existing follows persist and the profile 404s until
  they republish. Self-follow is rejected.
- **`publishProfile` requires a username** (auth enforces existence;
  username is still nullable on `users`) and **mural ownership**
  (injected check from murals). Without a username the client is sent
  to `/choose-username`.
- **Feed** is keyset-paginated (`created_at, id` DESC, cursor opaque
  base64), events from followees newest-first, each enriched with the
  actor's `ReaderProfile` and a content summary resolved through
  injected tierlists/arena public APIs. Missing content or a missing
  user drops the row.
- **Discover** merges public tournaments + community tier lists with
  author identity — today `/tierlists/public` deliberately exposes no
  user, so Discover is a new community endpoint over injected public
  listers, not a reuse of the old directory responses. Old directory
  endpoints stay untouched for compatibility; the old directory *page*
  is replaced by Community.

### Wiring

Injected **into** community: auth (username existence, batch
`ReaderProfile` resolution — extends `auth/publicProfile.ts`, plus a
username-search query), murals (`ownsMural`; one new murals public API
`getMuralPublicPayload(userId, muralId)` — the token-share route's
resolution refactored into a shared internal function both call),
tierlists and arena (public list + `summaryById` each).

Injected **out of** community: `emitEvent` into tierlists and arena.

### Routes

Authed (`authGuard`):

- `POST /community/follows` `{ userId }` / `DELETE /community/follows/:userId`
- `PUT /community/profile/publish` `{ muralId }` / `DELETE /community/profile/publish`
- `GET /community/feed?cursor=`
- `GET /community/people?q=`

Public, module-scoped rate limit (30/min, matching the murals share
route), `Cache-Control: no-store` (profiles render live library-derived
data):

- `GET /community/profiles/:username` — 404 when unpublished; viewer
  follows state via `getOptionalAuthenticatedUser`
- `GET /community/discover?type=&q=&cursor=`

`GET /community/feed` and the publish routes require auth; Discover is
public content with viewer-aware enrichment.

## Shared: `@scripta/shared/community`

New entry point, added to the `exports` map. DTOs the three clients
agree on plus one helper — no platform-specific code:

```ts
CommunityAuthor   = ReaderProfile & { userId }
FollowState       = { following, followerCount, followingCount }

TierlistSummary   = { kind: "tierlist", id, voteCode, name, poolSize, ballotCount, votingOpen }
TournamentSummary = { kind: "tournament", id, name, bracketSize, status, bookCount }

FeedItem          = { id, actor, type, content: TierlistSummary | TournamentSummary, createdAt }
DiscoverItem      = { author, content: TierlistSummary | TournamentSummary }
PersonResult      = { user, followerCount, viewerFollows? }
Page<T>           = { items, nextCursor }

encodeCursor / decodeCursor     // one keyset-cursor format, all clients
```

## Web

**Nav** (`DashboardLayout.tsx` NAV_GROUPS — sidebar, mobile drawer and
bottom-bar "More" drawer all render from it): "Arena" relabels to
"Games"; new "Community" entry below it. Route `/community` (authed).

**Community page**, three tabs, Discover default:

- **Discover** — segmented filter (All / Tier lists / Tournaments),
  search, card grid reusing the arena card patterns; every card carries
  an author chip (avatar + username → profile).
- **Feed** — reverse-chronological `FeedItem`s ("X published a tier
  list" + content card); empty state points at Discover/People; refetch
  on focus like arena views.
- **People** — search box → `PersonResult` rows with a follow toggle.

**Profile** `/community/u/:username`: identity header (avatar,
username, counts, follow button — owner sees Edit/Publish controls),
the chosen mural rendered read-only via the `SharedMuralPage` stack
(`toPrivateBook` reconstruction, `statsOverride`, `tierlistData` map),
then a **Published** section of their community tier lists and
tournaments. Owner chrome: publish toggle + mural picker defaulting to
home.

**Absorption**: `/arena` (directory page) redirects to Community
Discover; `/arena/:id` and `/vote/:code` unchanged; "BookArena" /
"My Arena" strings become "Games" / "My Games".

## Mobile

Six tabs: Home, Library, **Games** (relabeled; routes untouched),
**Community** (new `(community)` group), Murals, Settings.

- `CommunityScreen` — segmented Feed / Discover / People, same
  payloads as web.
- `ProfileScreen` (`/community/u/[username].tsx`) — header + mural via
  the existing `SharedMuralScreen` adapters (`reconstructBooks`,
  `reconstructTierlists`) + Published section + follow button; owner
  chrome mirrors web.

No new deep-link `pathPrefix` — nothing links to community URLs
externally yet.

## Edge cases

- **No username** → publish 400 → clients route to `/choose-username`.
- **Profile mural deleted later** → mural payload resolves null;
  profile renders header + Published section without the mural.
- **Unpublish** → profile 404s, drops from People search; follows and
  feed persist; author chips resolve from auth data (username/avatar
  live there, not in profiles), so feed items still render — tapping a
  chip shows a "not published" state.
- **Self-follow** blocked; **content deleted** → rows drop at read
  time; **duplicate events** impossible (`UNIQUE` + ignore).
- **User deleted** → batch profile resolution misses → item dropped.

## Out of scope (deliberate)

Groups/clubs; follower/following list screens; per-item audience
settings; feed activity beyond the two publish events; new mural block
types; URL/route renames; follower notifications.

## Testing / verification

- `community/service.test.ts` against an in-memory repo fake: follow
  rules (target published, no self-follow), publish gates (username,
  mural ownership, idempotence), feed ordering + cursor + dropped
  rows, discover merge/filter/search, event idempotency. **The file is
  added to backend `npm test`'s explicit list** — unlisted test files
  do not run in CI.
- tierlists and arena service tests assert exactly one emission at the
  two publish points (fake `emitEvent` injected).
- Frontend: typecheck, oxlint, tests; style test for Discover/profile
  layout if it introduces new resolved-layout components.
- Mobile: typecheck, tests, `expo-doctor`; one emulator lease at the
  end for a single render-verification pass.
- `@scripta/shared` rebuilt before any consumer typecheck; exports map
  gains `./community`.
