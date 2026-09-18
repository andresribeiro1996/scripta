# Home dashboard + profile mural split

## Context

The community feature (2026-09-16) gave every user two overlapping
mural concepts: a designated **home mural** rendered on the Home tab,
and a **published profile mural** others see at `/community/u/:username`
— the publish picker even defaulted to the home mural. Home currently
duplicates profile-ish content (profile block, currently reading) the
published profile already covers, while the social layer (follows, feed)
sits buried as a tab inside Community doing nothing for the user day to
day.

This feature splits the concepts cleanly:

- **Home = a dashboard**, not a mural. It answers "what should I act
  on": your reading state, and what the people you follow did.
- **Mural = profile.** One mural per user is their public body; the
  separate home designation is deleted.

## Decisions locked in with the user

- **Home absorbs Community.** The Community tab disappears (mobile goes
  six tabs → five). People search and Discover survive as screens
  reachable from Home; the Feed tab dissolves into the Home digest.
- **Reading-state cards + follower digest are the v1 dashboard.**
  Account-setup nudges were considered and cut.
- **One mural, one truth: the profile mural.** The `/murals/home`
  designation, its endpoints, and the default-mural generation go away.
  Your own profile opens from your avatar (Home header), reusing the
  existing profile view with its owner chrome.
- **No auto-publish in the migration.** A user whose home mural becomes
  their profile mural keeps their previous published state — if they
  never published, the profile stays private until they choose to.

## Concept model

| Surface | Before | After |
|---|---|---|
| Home | renders the designated home mural | dashboard: reading cards + follower digest |
| Profile | published mural at `/community/u/:username` | unchanged, no home-mural default in the picker |
| Community tab | Feed / Discover / People | gone; Discover + People standalone, feed lives on Home |
| Murals tab | list + "set as home" | list + profile-mural badge / publish state |
| New user | auto-created default home mural | no auto-mural; dashboard cards come from library data |

Mural block types (`currentlyReading`, `shelf`, rediscover `quote`,
…) stay — profile murals still use them. Only the home *designation*
and home-default generation die.

## Backend

### Community module

- **New followers come from the `follows` table, not the event store.**
  An event type cannot dedup follows correctly (`UNIQUE(ref_type,
  ref_id)` is per single column — either other followers or other
  followees get swallowed), and `follows` already carries `created_at`
  and a `(follower_id, followee_id)` primary key. "Who followed me
  since I last looked" is a plain query on it; unfollow naturally
  retracts.
- **`GET /community/dashboard?cursor=`** (authed) — replaces
  `GET /community/feed`, which is removed along with its only consumer.
  Merges two sources newest-first into one keyset-paginated stream on
  `(created_at, id)`:
  1. `tierlist_published` / `tournament_published` events from followees
     (the old feed query), enriched with actor + content summary;
  2. `follows` rows where followee = viewer, id = follower id, enriched
     with the follower's `ReaderProfile`.
  First page carries `newCount`: rows with `created_at > ` the viewer's
  seen marker.
- **`POST /community/dashboard/seen`** (authed) — sets the viewer's seen
  marker to now.
- Migration at community startup: users whose home mural exists and who
  have no profile mural get `profiles.mural_id` set to it, `published`
  untouched. Home mural + already-published user → their published
  choice stands; the ex-home mural remains a regular mural. Neither →
  no-op. The legacy home flag is read through an injected murals API in
  the same release murals drops the designation (ordering resolved at
  plan time against actual plugin wiring).

### Auth module

`dashboard_seen_at TEXT` column on `users` (per-user state, not
per-profile; a never-published user has no `profiles` row to hang it
on). Exposed to community via the existing injected public-API pattern:
getter + setter.

### Murals module

`/murals/home` GET/PUT/POST removed; no default mural is generated for
new users; the home designation storage is dropped. The Murals list
endpoint and payload stay untouched — clients badge the profile mural
from the existing profile endpoints they already call.

## Shared: `@scripta/shared`

- New `dashboard` entry point (added to the `exports` map) replacing
  `murals/home`: `DashboardCard` union — currently-reading (book +
  progress), up-next shelf, rediscover quote (daily-rotating highlight)
  — plus `buildDashboardCards(libraryData)`, the card-derivation logic
  lifted from `buildHomeBlocks` and consumed by both clients.
  `resolveHomeBlock` dies with the home screen.
- `FeedItem` is joined by `DigestItem`:
  `{ kind: 'publication', ...FeedItem } | { kind: 'follow', actor,
  createdAt }` — the dashboard response type; `FeedItem` itself is
  unchanged.
- `murals/home` helpers deleted from the murals entry point.

## Web

- `HomePage` (`/dashboard`) becomes the dashboard: reading cards
  (existing library endpoints, no new card endpoint), follower digest
  (new rows visually flagged via `newCount`), avatar → own profile, and
  links to People and Discover.
- Community page split: `/community` redirects to `/dashboard`;
  Discover and People become standalone pages (`/community/discover`,
  `/community/people`) linked from Home. Sidebar's Community entry
  removed. `/community/u/:username` unchanged — it is also the own-
  profile view, owner chrome already present.
- Murals list: "set as home" action removed; profile mural badged with
  its published state; publish flow picker no longer preselects a home
  default (owner picks explicitly; `PUT /community/profile/publish`
  contract unchanged).

## Mobile

- Five tabs: Home, Library, Games, Murals, Settings. `(community)` tab
  group dissolved.
- `HomeScreen` becomes the dashboard: cards + digest + header avatar →
  own profile (`u/[username]` screen, moved out of the `(community)`
  group; owner chrome mirrors web).
- People and Discover become standalone screens pushed from Home
  (split out of the three-segment `CommunityScreen`).

## Edge cases

- **Never-published user after migration** → profile mural chosen but
  private; dashboard works regardless (cards are library-derived,
  digest is follow-derived); avatar → own profile shows the mural with
  a "not published" state (already exists for unpublish).
- **Follower account deleted** → their digest rows drop at read time
  (batch actor resolution misses), the established fail-safe.
- **`dashboard_seen_at` null** (first visit) → `newCount` counts
  nothing; marker set on first seen call.
- **Digest content deleted** (tier list removed, unpublish) → row
  drops at read time like feed did; follow rows have no content to
  lose.
- **Home mural deleted by its owner** post-migration → profile renders
  header + Published section without the mural (existing behavior).

## Out of scope (deliberate)

Account-setup nudges; follow requests / approve flows; follower or
following list screens; push/email notifications; per-item audience
settings; any new mural block type; renaming the community URLs.

## Testing / verification

- Backend `community/service.test.ts`: dashboard merge ordering
  (publications + follows interleaved), cursor behavior, follow rows
  surfaced only to the followee, unfollow retracting a follow row,
  `newCount` arithmetic, seen-marker write. Migration tests cover the
  three cases (home only / home + published / neither) with
  `published` preserved. Auth test for the marker column round-trip.
  **New test files go into backend `npm test`'s explicit list.**
- `@scripta/shared` rebuilt before any consumer typecheck; card
  derivation unit-tested (empty library, no highlights, rotation).
- Frontend: typecheck, oxlint, tests; dashboard component tests
  (cards render, digest flags new rows, redirect from `/community`).
  Style test only if a new resolved-layout component appears.
- Mobile: typecheck, tests, `expo-doctor`; one emulator lease at the
  end for a single render-verification pass of the new Home, tab bar,
  and own-profile entry.
