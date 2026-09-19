# Profile activity — tabs, richer events, and add-to-library from public contexts

## Context

The community profile screen (`/community/u/:username` web, `u/[username]`
mobile) shows a published mural plus a "Published" cards section. There is
no way to see a user's activity over time — their own or anyone else's. The
community events table records exactly two event types
(`tierlist_published`, `tournament_published`), and reading data is
deliberately stripped from every public payload (`library/publicResolver.ts`).

Two gaps, decided together because one feeds the other:

1. **No activity view.** Users want a profile tab showing a chronological
   history — publications, but also reading and participation.
2. **No path from seeing to collecting.** Browsing a shared library, a
   public tournament bracket, or a tierlist vote page shows books, but
   there is no way to add one to your own library; every book card is a
   no-op tap.

## Decisions locked in with the user

- **Tabs on the profile screen: Mural | Activity.** The mural stays the
  body; activity is a second tab. Same on web and mobile.
- **Event set**: `book_added`, `book_finished`, `following`,
  `mural_published`, `voted_on`, plus the existing two publication types.
  - **No "started reading" event** — too noisy.
  - **`voted_on` is condensed to one event per user per game** (tournament
    or tierlist), emitted at first signed-in participation, not one per
    duel/ballot. Dedup is a database partial unique index, race-safe.
  - **Imports never emit events.** Importing an 800-book Kobo library must
    not flood anything. Activity starts from real in-app actions. No
    retroactive seeding from `DateLastRead` / "Date Read" in v1.
  - **Anonymous votes are not attributed.** Both vote flows already capture
    an optional session (`voter_user_id`); only signed-in votes emit.
    The existing backfill that links past anonymous votes to an account
    does **not** retroactively create events.
- **Statuses stay three**: Not read / Reading / Finished. No "Interested"
  value. The add-from-context picker offers the existing three.
- **Feed settings, not a single reading switch.** A `feed_settings` map on
  the profile controls which event categories appear on the **public**
  activity tab: `publications` (default on), `reading` (default **off**,
  preserving today's private-reading posture), `votes` (on), `follows`
  (on). Events are always written; settings filter at read time, so
  enabling a category reveals its past events. Self-view ignores settings.
- **Add-to-library from public contexts.** Shared library pages, public
  tournament view, and tierlist vote pages get a book sheet with three
  status buttons → new `POST /library/books` upsert endpoint. Collections
  arrive via shared-library links (groups pass through today); murals and
  standalone collection browsing are out of scope.
- **The followees feed stays publications-only in v1**, except that the
  `publications` toggle also filters it (one privacy surface).

## Shared: `@scripta/shared/community`

New types in `community/types.ts`:

```ts
type ActivityEventType =
  | "book_added" | "book_finished"        // payload: {title, author, isbn?, coverUrl?} + status for added
  | "following"                           // payload: {username}
  | "mural_published"                     // payload: {muralId}
  | "voted_on"                            // payload: {game: "tournament"|"tierlist", id, name} + placementCount for tierlist
  | "tierlist_published" | "tournament_published"; // payload: {id, name}

interface ActivityItem {
  id: string;
  type: ActivityEventType;
  payload: Record<string, unknown>;   // discriminated per type via helpers
  createdAt: string;
}

type FeedCategory = "publications" | "reading" | "votes" | "follows";

interface FeedSettings { publications: boolean; reading: boolean; votes: boolean; follows: boolean; }

interface BookRecommendation {  // body of POST /library/books
  title: string; author: string; isbn?: string | null;
  coverUrl?: string | null; readStatus: 0 | 1 | 2;
}
```

New helpers in `community/helpers.ts`, used identically by both clients:
`categoryFor(type): FeedCategory`, `feedSettingsOrDefault(Full|Partial)`,
and `activityText(item): {verb, target, href?}` returning the display row
("Added", "*Title* — Reading", href when it is a publication).

## Backend

### Community module (`backend/src/modules/community/`)

**Schema migration.** `events` gets a `payload TEXT` column and the
table-level `UNIQUE (ref_type, ref_id)` is replaced by per-type partial
unique indexes (SQLite cannot ALTER a table constraint, so connection.ts
runs a guarded rebuild: `PRAGMA user_version` gate → create `events_new`,
copy rows, drop, rename):

- `UNIQUE (ref_type, ref_id)` **only for** `tierlist_published`,
  `tournament_published` (existing idempotency preserved)
- `UNIQUE (user_id, type, ref_id)` for `voted_on`, `following`,
  `mural_published` (one participation event per user per target)

`profiles` gains `feed_settings TEXT` (nullable JSON; NULL = defaults) —
plain `ALTER TABLE ADD COLUMN`, no rebuild. `feed_settings` is validated
on write against the shared `FeedSettings` shape.

**Emission points** (all server-side; clients never emit):

| Event | Emitted in | Ref |
|---|---|---|
| `tierlist_published`, `tournament_published` | unchanged (existing `emitEvent` wiring from app.ts) | content id |
| `mural_published` | `publishProfile` (first publish and mural switch) | mural id |
| `following` | follow service | followee user id |
| `voted_on` | arena `ArenaService.vote` (signed-in, first successful insert only — the 409 no-op path emits nothing); tierlists `submitBallot` on ballot **creation** when voter is a user (edits never re-emit) | tournament id / tierlist id |
| `book_added`, `book_finished` | library save diff (below) | book key (ContentID) |

`voted_on` payloads snapshot tournament/tierlist **name** at vote time
(tournaments: one `getTournament` call already ported in the repo).

**Endpoints:**

- `GET /community/profiles/:username/activity?cursor=&limit=` — public,
  gated on `published = 1` (404 otherwise, same as profile). Keyset
  pagination on `(created_at, id)` via the shared `cursor.ts` helpers,
  same shape as the community feed. Rows are filtered by the owner's
  `feedSettings` categories. When the optional session user **is** the
  owner, no category filtering applies.
- `GET /community/profile` response gains `feedSettings` for the owner;
  `PUT /community/profile/feed-settings` accepts the four-boolean object
  (validated, stored as JSON).

**Library save diff** (`backend/src/modules/library/`): on non-import
saves, diff previous vs next blob per book key: absent → present =
`book_added` (payload includes chosen status); present with `ReadStatus`
≠ 2 → 2 = `book_finished`. Import endpoints bypass the diff entirely.
Emission runs **after** the save commits and must not fail the save —
catch, log, continue. A phantom missing event is acceptable; a failed
library save because activity hiccuped is not.

**`POST /library/books`** (auth'd): body is the shared
`BookRecommendation`. Load the caller's library document, upsert:
match by ISBN when present, else exact title+author; match → update that
book's `ReadStatus` in place (response `{updated: true}`); no match →
append via `buildManualBook` (`@scripta/shared`), applying `coverUrl`
through the same custom-cover fields `setBookCover` writes. Response
includes the resulting book key so clients can navigate/refresh.
Errors: 400 missing title/author, 401 unauthenticated, 409 stale
library version (same optimistic-concurrency contract as `PUT /library`).

## Clients

**Profile tabs** (`frontend/src/pages/CommunityProfilePage.tsx`,
`mobile/src/features/community/ProfileScreen.tsx`): tab bar **Mural |
Activity**. Mural tab = today's screen. Activity tab = list of
`activityText(item)` rows — icon/verb + target + relative date;
publication rows navigate to their target (`contentTarget` already
exists), all other rows are informational. Web: load-more button;
mobile: infinite scroll + pull-to-refresh. Owner also gets the
**Feed settings** control beside Switch mural / Unpublish — four labeled
switches, `PUT` on change.

**Add-from-context** — book taps become live in
`SharedLibraryPage.tsx` / `SharedLibraryScreen.tsx`,
`ArenaViewPage.tsx` / arena view, `VoteTierlistPage.tsx` /
`VoteTierlistScreen.tsx`: sheet (modal on web, bottom sheet on mobile)
with cover, title, author and three buttons — Not read (TBR) / Reading /
Finished — calling `POST /library/books`. Signed-out users get a
sign-in prompt instead of the sheet. Success: optimistic toast ("Added
to your library"), sheet closes. Arena books have no ISBN field — pass
`isbn: null` and match on title+author; the tournament `key` string's
embedded ISBN is incidental and not used.

Covers for book events resolve client-side from payload
`coverUrl`/`isbn` through the existing `peekCachedCoverUrl` path; the
existing initials fallback covers missing covers. The followees feed UI
is untouched apart from honoring the `publications` toggle server-side.

## Error handling

- Activity read: malformed cursor → 400; unpublished profile → 404;
  unknown username → 404. No silent empty-page-on-error.
- `POST /library/books` validation rejects missing title/author with the
  field named; upsert failures propagate (no `catch { return null }`).
- Vote/ballot emission rides the same service call as the vote — a failed
  event insert must fail the vote response so the DB and the feed never
  disagree about "Voted in X".
- Library-diff emission failures are logged and swallowed **by design**
  (activity must never break saves/imports) — the only sanctioned
  swallow in this feature.

## Testing

- **backend**: diff emission (add / finish / no-op on unrelated saves /
  import skip), category filtering per settings on the public endpoint +
  owner-unfiltered self view, cursor pagination, vote dedup uniqueness
  (second vote and ballot edit emit nothing), `POST /library/books` dedup
  by ISBN vs title+author, update-in-place vs append, feed-settings
  validation. New test files registered in the explicit `npm test` list.
- **frontend / mobile**: tab render + switching, activity row text/links
  via shared `activityText`, add-sheet happy path, signed-out prompt,
  feed-settings control persists.
- **@scripta/shared**: `categoryFor` coverage, settings defaults/partial
  merge, `activityText` per event type. Rebuild `dist` before consumer
  typechecks/tests.

## Non-goals (deliberate)

- No retroactive import seeding; no "started reading" event; no
  "Interested" status; no per-duel vote events.
- No add-from-mural, no standalone collection browsing/sharing.
- No follower/following list UI (counts stay counts).
- No changes to what `PUT /library` accepts or to existing public
  payload redaction rules — `publicResolver.ts` stays as-is; the activity
  feed is the only new surface for reading data, gated by settings.
