# Author visibility in one place

Date: 2026-10-07
Status: draft. This is architecture review candidate #7 (`todo/architecture-review.md`). The decisions below were agreed in the brainstorm.

## Problem

There is no single place that decides whether a viewer can see a reader or the reader's content. The rules are spread across `backend/src/modules/community/service.ts` and its SQLite repository, and they have drifted.

- **"Is this profile published?" is decided three ways.**
  - In JS, as `repo.getProfileRow(id)?.published === 1`, at six sites:
    - `glyphLookup`
    - `visibleUserId`
    - `participationItems`
    - `follow`
    - `getProfileByUsername`
    - `searchPeople`
  - In SQL, as `WHERE published = 1`, in `listPublishedProfiles`, which feeds suggestions.
  - As a raw column that `readerVisibility` reads through `visibilityRows` and then compares in JS.
- **The glyph rule is written twice.** The rule is "published and the reader switched the glyph on".
  - `glyphLookup` reads the profile row plus `settingsFor`.
  - `readerVisibility.showGlyph` reads `show_reader_glyph` from `visibilityRows`.
- **The owner of an unpublished profile gets three different answers.**
  - `GET /community/profiles/:me` answers 404.
  - `GET /community/profiles/:me/activity` is allowed. My shelf relies on this.
  - `GET /community/profiles/:me/library` answers 404, because `publishedUserId` passes no viewer.
- **The `private` flag is computed three ways.**
  - `searchPeople` computes `published !== 1`.
  - `suggestPeople` hard-codes `false`.
  - Works readers send `published` (the inverse) instead.
- **The feed ignores `published` entirely.** It only applies the author's per-category switches (`authorShows` SQL). This is the intended rule (see Decisions), but nothing says so.

## Decisions

| Question | Answer |
|---|---|
| Scope | Consolidate the rules into one module, and settle the inconsistencies |
| Owner viewing their own unpublished profile | Sees everything: profile content, activity and library, as a preview of what publishing shows |
| Unpublished author in followers' feeds | Unchanged. Followers see what the author's switches allow, published or not. The switches are the author's consent, and their games are public in Discover anyway. This becomes the named, tested feed rule |
| Stranger viewing an unpublished profile | Unchanged. Gets the `private` shell: username, avatar, follower and following counts, and follow state. No content |
| Discover and works `games()` | Unchanged. They show games by private-profile readers, gated only on the reader having a username (agreed 2026-10-06). This is the documented exception |
| Shape | One visibility reader: `createVisibility(repo, viewerId)`, backed by small pure rules |

## Design

### The module: `backend/src/modules/community/domain/visibility.ts`

**Pure rules.** These are exported for unit tests. Each one takes a `Standing`:

```ts
export interface Standing {
  published: boolean;
  isViewer: boolean;
  followedByViewer: boolean;
  settings: FeedSettings;
}
```

| Rule | True when | Replaces |
|---|---|---|
| `canViewContent(s)` | `s.published \|\| s.isViewer` | `visibleUserId`, `publishedUserId`, the content gate in `getProfileByUsername` |
| `isPrivate(s)` | `!canViewContent(s)` | `searchPeople`'s `private`, `suggestPeople`'s hard-coded `false`, the profile view's `private` |
| `showsGlyph(s)` | `s.published && s.settings.readerGlyph` | `glyphLookup`, `readerVisibility.showGlyph` |
| `canNameAsParticipant(s)` | `s.published && s.settings.votes` | the naming check in `participationItems` |
| `canFollow(s, followsViewer)` | `s.published \|\| followsViewer` | the published check in `follow` |
| `readerListing(s)` | `undefined` when `!s.published && !(s.followedByViewer && s.settings.reading)`; otherwise `{ followed: s.followedByViewer && (s.published \|\| s.settings.reading), published: s.published, showGlyph: showsGlyph(s) }` | the per-row logic of `readerVisibility` |

**The reader.** `createVisibility(repo: CommunityRepository, viewerId: string | null)` returns `{ standing(userId), standings(userIds), canViewContent(userId), isPrivate(userId), showsGlyph(userId), canNameAsParticipant(userId), canFollow(userId) }`.

- It loads each target's standing once and caches it for the reader's lifetime.
- A reader is created per request, inside each service method that needs one.
- `standing` reads `getProfileRow` and `getFeedSettings`, falling back to `DEFAULT_FEED_SETTINGS` (the same fallback as today's `settingsFor`). It reads the viewer's followees once (`listFollowees`).
- A user with no profile row has `published: false` and default settings.
- `standings(userIds)` is the batch path for works readers. It keeps today's single query by reading `visibilityRows` plus `listFollowees` once.
  - `visibilityRows` widens to return `show_votes` too. This makes `Standing.settings` complete without a per-user settings read.
  - Columns not selected keep their SQL defaults, which match `DEFAULT_FEED_SETTINGS`.

### Call sites

| Site | After |
|---|---|
| `getProfileByUsername` | `canViewContent` decides whether content (mural, published lists, `publishedAt`) is filled. `private: isPrivate(...)`. The owner-unpublished 404 is removed. `feedSettings` is still sent only to the owner |
| `getActivity` | `canViewContent` replaces `visibleUserId`. The owner still sees all categories |
| `getLibrary` | `canViewContent` replaces `publishedUserId`, so the owner can now read their own library |
| `glyphLookup` | `showsGlyph`, cached by the reader |
| `participationItems` | `canNameAsParticipant` |
| `follow` | `canFollow`, using the existing reverse-follow lookup |
| `searchPeople` | `private: isPrivate(...)` |
| `suggestPeople` | Keeps `listPublishedProfiles` (`WHERE published = 1`) as a pre-filter for the 500-row cap. `private: isPrivate(...)`, which is `false` for those rows by construction |
| `readerVisibility` (on `CommunityPublicApi`) | Same signature and return. Its body becomes `standings` plus `readerListing`, so works is untouched |

After this change, `service.ts` and the works module contain no `published === 1`, `published !== 1` or `show_reader_glyph` comparison. The two SQL filters (`listPublishedProfiles`, `authorShows`) stay in SQL.

### The feed rule

The feed's `authorShows` stays in SQL, because it runs on every inbox write and read. Two changes make it the named rule:

- A test asserts that the SQL `COALESCE` defaults in `authorShows` and the `profiles` column defaults equal `DEFAULT_FEED_SETTINGS`. Today they agree by coincidence.
- A sentence in `backend/src/modules/community/README.md` names the rule:
  - The feed is gated by the author's switches only.
  - Profile publishing does not gate it.
  - Discover and works games are gated by having a username only.

### Clients

The owner's own profile address no longer answers 404.

- **Web.** `CommunityProfilePage` renders `OwnShelfView` for the viewer's own handle before it fetches. No change.
- **Mobile.** `ProfileScreen` fetches `/community/profiles/:username` for any username, including the viewer's own.
  - Today an unpublished owner gets 404, and the screen shows "This profile is private".
  - After the change, the owner gets the full view, with `private: false` because content is visible to them.
  - The screen renders it with no code change. The follow button must not be offered on your own profile; the plan checks that this already holds.

`private` now means "content is withheld from this viewer". It no longer means "the profile is unpublished". For every non-owner viewer the two are the same.

## Behaviour changes

Everything not listed here stays exactly as it is today.

1. **`GET /community/profiles/:me`.** The owner of an unpublished profile gets the full view, with `private: false`. It used to answer 404.
2. **`GET /community/profiles/:me/library`.** The owner of an unpublished profile gets their library. It used to answer 404.
3. **`GET /community/people/suggested`.** `private` is computed, not hard-coded. The value is unchanged (`false`), because suggestions list only published profiles.

## Testing

- **`domain/visibility.test.ts`.** Unit tests for each pure rule, covering every combination of `published`, `isViewer`, `followedByViewer` and the relevant switch. Plus `createVisibility` against a repo fake:
  - one profile read per user
  - followees read once
  - the no-profile-row default
- **Existing tests stay green, unchanged**, except these three, which change for behaviour changes 1 and 2:
  - `community/service.test.ts` "404 for the viewer's own unpublished profile" (around :773)
  - the owner case in the library test (around :2260)
  - any routes test that pins that 404
- **New service tests:**
  - the owner sees their own unpublished profile and library
  - a stranger still gets the `private` shell and a 404 on activity and library
- **Feed rule test:** the defaults-agree check above.
- **Works:** `works/service.test.ts` passes unchanged, because the `readerVisibility` contract is unchanged.
- **Device check:** mobile, signed in as an unpublished reader, opening their own `/u/<username>`. It shows the full profile with no follow button.
- **Security review:** `security-review` runs before merge, because this branch changes who can see what.

## Delivery

One PR, on branch `claude/author-visibility`.

## Out of scope

- Share tokens, vote codes and game "published" states (`vote_code`, arena `status`). These stay with each game and murals module.
- The username-only gate for Discover and works `games()`. It is kept and documented, not moved.
- The feed's SQL switch logic. It stays in SQL and is only named and tested.
- Activity items whose game is gone. Quiz plays are dropped and tier-list and tournament plays are kept plain. This is not a visibility rule.
- The unused `deps.resolveProfile` dependency.
- The arena `GET /arenas/:id` exposing `ownerUserId`.
