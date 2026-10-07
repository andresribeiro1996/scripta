# Quiz activity in the community

Date: 2026-10-07
Status: approved in chat on 2026-10-07. This comes out of architecture review candidate #2.

## Problem

Tier lists and tournaments record community activity: "published", and "voted on" when a signed-in person takes part. Followers see that activity in the home feed, on the person's profile (Activity tab and Published list), and in Discover. Quizzes record nothing, so a quiz someone publishes or plays is invisible to the people who follow them. The only quiz signal today is the owner-facing participation row ("Ana played your quiz"), which is not event-based.

## Decisions

| Question | Answer |
|---|---|
| Where quizzes appear | Everywhere tier lists and tournaments appear: home feed, profile Activity, profile Published list, and Discover with its own filter |
| Which plays count | Every signed-in play, including the owner playing their own quiz. Anonymous plays record nothing. Every play is final, so there is one event per player per quiz |
| "Published" event | A new event type, `quiz_published` |
| "Played" event | Reuse `voted_on` with `ref_type: "quiz"` and payload `{ game: "quiz", id, name }`, the same shape tier lists and tournaments already use |
| Feed settings | No new category. `quiz_published` falls under Publications and a quiz `voted_on` under Votes |
| Unknown types on clients | Web and mobile skip activity rows and feed or Discover items they can't render, as a general guard for future types |
| Client/server negotiation | None. See Rollout |

## Design

### Shared types and copy (`packages/shared/src/community`, `dashboard.ts`)

Add `QuizSummary` to `PublishedContent`:

```ts
export interface QuizSummary {
  kind: "quiz";
  id: string;
  voteCode: string;
  name: string;
  questionCount: number;
  playCount: number;
  playOpen: boolean;
  covers: string[];
  viewerVoted?: boolean;
}
```

`CommunityEventType` gains `"quiz_published"`, and so `ActivityEventType` does too. `DiscoverType` gains `"quiz"`.

Copy, mirroring the tier-list wording:

| Helper | Quiz |
|---|---|
| `contentKindLabel` | "Quiz" |
| `contentDetail` | `${questionCount} questions · ${playCount} plays` plus `" · closed"` when play is closed |
| `contentStatus` | "Played" (info) when open and the viewer played; "Open" (accent) when open; "Closed" (neutral) otherwise |
| `contentStats` | questions, plays |
| `contentTarget` | `/play/${voteCode}` |
| `feedAction` | "published a quiz" |
| `digestAction` (vote) | `played ${name}` |
| `activityRow` | `quiz_published` is "Published a quiz"; a quiz `voted_on` is "Played a quiz" |

Every helper that branches on `kind` switches over all three kinds, so a fourth kind is a compile error, not a silent fall into the tournament branch.

`activityRow` returns `null` for an item type it doesn't know instead of `undefined`, and its callers skip null rows. `withKnownDigestItems` also drops `publication` and `vote` items whose `content.kind` it doesn't know. Discover lists on both clients drop items with an unknown `content.kind`.

### Quizzes backend

- `createQuizzesService(repo, emitPublished?, emitPlayed?)`:
  - `EmitPublished = (quizId, ownerUserId) => void` is called once, after `repo.publish` succeeds in `publishQuiz`.
  - `EmitPlayed = (playerUserId, quizId, quizName) => void` is called after `repo.savePlay` in `submitPlay` when `player.kind === "user"`, including the owner.
- `quizzesPlugin` takes `{ emitPublished?, emitPlayed? }`, the same way the tier lists plugin does.
- The quizzes public API gets the five reads community needs, matching `deps.tierlists`: `get`, `getPublishedMany`, `listByOwner`, `discoverWindow` and `votedAmong`. They return a `PublishedQuizRef`:
  - `id`, `ownerUserId`, `createdAt`, `voteCode`, `name`
  - `questionCount`, `playCount`, `playOpen`
  - `covers`: book covers from the quiz document
  - "Published" means `vote_code IS NOT NULL`.
  - `votedAmong` means the viewer has a play.

### Community backend

- `CommunityRefType` gains `"quiz"`. There are two copies, `domain/types.ts` and `service.ts`, and both change.
- `DIGEST_EVENT_TYPES` gains `["quiz_published", "publication"]`, and `EVERY_ACTIVITY_EVENT_TYPE` gains it too.
- **Publication index.** The unique publication index currently covers `tierlist_published` and `tournament_published` only. The new version also covers `quiz_published` and gets a new name, `idx_events_publication_ref_v2`. `migrateSchema` drops the old index and creates the new one, and `schema.sql` is updated to match. `voted_on` is already covered by the user/type/ref index.
- **`CommunityDeps.quizzes`.** A new dependency with the five reads above, wired in `app.ts`. The backfill and archive tests build `CommunityDeps` by hand and need it too.
- **Quiz branches.** Each of these gets a quiz case:
  - `toDigestItem` for publication and vote: ownership check on publication, no promoted placeholder.
  - `getActivity`: `quiz_published` enrichment, and a quiz `voted_on` with `href` `/play/<voteCode>`.
  - The profile `published` block gains `quizzes`.
  - `getDiscover`: a quiz window plus `played` flags.
  - The `routes.ts` discover `type` enum gains `quiz`.
- `app.ts` wires the quizzes plugin's callbacks through the same best-effort `recordActivity` the other games use (PR #174).

### Clients

- **Web**
  - `ProfileActivity` glyph for quiz rows, skipping null rows.
  - `DiscoverPage`: Quizzes filter and a quiz thumb.
  - `CommunityProfilePage`: quizzes in Published.
  - `api/community.ts` types.
- **Mobile**
  - `feedRowModel`: publication and vote icon and label, and `digestRoute` for `/play/<code>`.
  - `ActivityList` icon, skipping null rows.
  - `communityHome` filters.
  - `DiscoverPane` quiz thumb.
  - `ProfileScreen` Published rows.
  - `api.ts` types.
- Quiz icons follow the existing quiz participation row ("champion" on mobile).

## Rollout

One PR, merged after PR #174. Web and backend deploy together from main, and mobile JS ships over the air, so the window where an old mobile bundle sees a quiz item is the time until a user relaunches the app. Two people use the app. A `kinds=`-style negotiation for quiz content would be permanent code for a window of hours, so it is left out. The skip-unknown guard closes this class of problem for future types.

## Tests

- **Shared:** each helper's quiz case, `activityRow` null for an unknown type, and `withKnownDigestItems` dropping unknown content kinds.
- **Quizzes:**
  - Publish emits once, and a second publish does not.
  - A signed-in play emits once, including the owner. An anonymous play emits nothing.
  - The five reads return only published quizzes with the right counts.
- **Community:**
  - A quiz publication and a quiz play appear in a follower's feed under the right settings category.
  - `getActivity` enriches both quiz events and drops a deleted quiz.
  - The profile Published list includes quizzes.
  - Discover's `quiz` filter, and quizzes in `all`.
  - The index migration on an existing database: the old index is dropped, and a duplicate `quiz_published` is ignored.
- **Clients:** the existing feed, activity and Discover helper tests gain quiz cases, plus a skip-unknown case.
- **Docs:** `backend/README.md`'s feed-type and index sentences are updated.
