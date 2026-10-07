# Quiz Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quizzes record community activity ("published" and "played") and appear everywhere tier lists and tournaments do: the home feed, profile Activity, profile Published, and Discover.

**Architecture:**
- Quizzes emits through optional callbacks, the same way tier lists does.
- Community gets a `quizzes` dependency with the same five reads it uses for tier lists, plus quiz branches in its digest, activity, profile and Discover builders.
- Shared gains `QuizSummary` and exhaustive quiz copy.
- Both clients add quiz rendering and skip anything they don't know.

**Tech Stack:**
- Fastify and `node:sqlite` backend, with `node:test` via tsx and an explicit file list in `backend/package.json`.
- `@scripta/shared`, built to `dist/`.
- React web, with `scripts/test-*.mts` tests.
- Expo mobile, with `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-07-quiz-activity-design.md`

## Before starting

- This builds on PR #174 ("Record community activity through one path"), which adds `recordActivity` in `app.ts`. If `git log origin/main --oneline | rg "Record community activity"` finds it, branch from `origin/main`. Otherwise branch from `origin/claude/community-activity-sink` and rebase onto main once #174 merges.
- This spec and plan live on branch `claude/architecture-skill-todos-84852c`. Copy both files into the new branch with `git checkout origin/claude/architecture-skill-todos-84852c -- docs/superpowers/specs/2026-10-07-quiz-activity-design.md docs/superpowers/plans/2026-10-07-quiz-activity.md`, so they ship with the PR.
- Run `npm run dev:link-deps` once in the worktree.
- Line numbers below are as of `1a47442d` and may have drifted. Find each site by its symbol.

## Global Constraints

- **Event shapes:** published is `quiz_published` with `ref_type: "quiz"` and `ref_id: <quizId>`. Played is `voted_on` with `ref_type: "quiz"`, `ref_id: <quizId>` and payload `{ game: "quiz", id, name }`.
- **Which plays emit:** a play emits only when `player.kind === "user"`, and that includes the owner. Anonymous plays never emit.
- **Feed settings:** no new feed-settings category, no change to `normalizeFeedSettings`, and no change to the `show_*` columns.
- **Recording:** every recording goes through the best-effort `recordActivity` in `app.ts`. A failure logs and never fails the request.
- **Code style:** no comments in new code. Specific error handling.
- **Order:** rebuild shared (`npm run build --workspace packages/shared`) before any backend or client check.
- **Commits:** stage and commit in one command. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The publication index migration on an existing database.** The old `idx_events_publication_ref` must be dropped, the `_v2` created, and existing tier-list and tournament rows kept. A second `quiz_published` for the same quiz must be ignored (`INSERT OR IGNORE`). Task 3 owns the test.
2. **A quiz deleted after its events were recorded.** Feed, activity and Discover must drop the item, not throw or link to a dead `/play/` code. Task 3 owns the test.
3. **A quiz whose play was closed after publishing.** It must still show as "Closed" with no "Open" status, and the link must still open the results page. Tasks 1 and 3 own the tests.
4. **An unknown event type or content kind reaching a client.** It must be skipped, never thrown on. Tasks 1, 4 and 5 own the tests.
5. **The owner playing their own quiz.** It records `voted_on` once. The owner-facing participation row must still exclude owner plays, which is unchanged. Task 2 owns the test.

---

### Task 1: Shared types, copy, and the skip-unknown guard

**Files:**
- `packages/shared/src/community/types.ts`: `QuizSummary`, `PublishedContent`, `CommunityEventType`, `DiscoverType`, and the profile `published` type if it's declared here.
- `packages/shared/src/community/helpers.ts`: `contentKindLabel`, `contentDetail`, `contentStatus`, `contentStats`, `contentTarget`, `feedAction` and `activityRow`.
- `packages/shared/src/dashboard.ts`: `digestAction` vote case and `withKnownDigestItems`.
- Tests: `packages/shared/src/community/helpers.test.ts` and `packages/shared/src/dashboard.test.ts`.

**Produces:** `QuizSummary` as in the spec, and `activityRow(item): ActivityRow | null`.

- [ ] Write failing tests:
  - Each helper's quiz output, using the copy table in the spec.
  - `contentTarget(quiz)` is `/play/<voteCode>`.
  - `digestAction` for a quiz vote is `played <name>`.
  - `activityRow` gives "Published a quiz" for `quiz_published` and "Played a quiz" for a quiz `voted_on`, and `null` for `{ type: "hologram" }`.
  - `withKnownDigestItems` drops a publication whose `content.kind` is `"hologram"`.
- [ ] Implement:
  - Every kind branch becomes a `switch (content.kind)` with all three cases, so a fourth kind fails to compile.
  - `activityRow` gets a `default: return null`. The `voted_on` label branches on `p.game`: tierlist is "Ranked a tier list", quiz is "Played a quiz", anything else "Voted in a tournament".
- [ ] `npm test --workspace packages/shared && npm run build --workspace packages/shared`.
- [ ] Commit.

### Task 2: Quizzes emits and exposes published quizzes

**Files:**
- `backend/src/modules/quizzes/service.ts`:
  - `EmitPublished` and `EmitPlayed` types, and `createQuizzesService(repo, emitPublished?, emitPlayed?)`.
  - Emit after `repo.publish` in `publishQuiz`, and after `repo.savePlay` in `submitPlay` when `player.kind === "user"`.
  - `PublishedQuizRef`, and five public reads.
- `backend/src/modules/quizzes/domain/ports.ts` and `adapters/sqlite/sqliteQuizzesRepository.ts`: queries for the published-quiz reads.
  - Published means `vote_code IS NOT NULL`.
  - `playCount` and `questionCount` come from existing columns or data. Reuse `playCount` if it exists.
  - `covers` come from `data.books[].coverUrl`, taking the first 3 non-empty.
  - `votedAmong(viewerId, ids)` means the viewer has a play.
  - `discoverWindow(needle, limit)` mirrors tier lists: a name filter, newest first.
- `backend/src/modules/quizzes/plugin.ts` and `index.ts`: `QuizzesPluginOptions { emitPublished?, emitPlayed? }`, and the reads exported on the public API.
- Tests: `quizzes/service.test.ts` and the repository test.

**Produces:**
- `PublishedQuizRef { id, ownerUserId, createdAt, voteCode, name, questionCount, playCount, playOpen, covers }`.
- A public API with `get(id)`, `getPublishedMany(ids)`, `listByOwner(ownerUserId)`, `discoverWindow(needle, limit)` and `votedAmong(viewerId, ids)`. The return types mirror tier lists: discover refs are `{ id, createdAt, ownerUserId }`.

- [ ] Write failing tests, modelled on the tier-list emit tests (`tierlists/service.test.ts` around "openVoting emits exactly one publish event"):
  - Publish emits once with `(quizId, ownerId)`, and a second publish (409) emits nothing.
  - A signed-in play emits `(userId, quizId, name)` once.
  - The owner's own play emits.
  - An anonymous play emits nothing.
  - A closed quiz's play emits nothing, because it never saves.
  - The reads return only published quizzes, with correct `playCount`, `questionCount`, `playOpen` and `covers`.
- [ ] Implement, then run `npm run typecheck --workspace backend && npm test --workspace backend`. Add any new test file to `backend/package.json`.
- [ ] Commit.

### Task 3: Community shows quiz activity

**Files:**
- `backend/src/modules/community/domain/types.ts` and `service.ts`: `CommunityRefType` gains `"quiz"`, in both copies.
- `community/domain/feed.ts`: add `quiz_published` to `DIGEST_EVENT_TYPES` (as a publication) and to `EVERY_ACTIVITY_EVENT_TYPE`.
- `community/adapters/sqlite/schema.sql` and `connection.ts` (`migrateSchema`):
  - Replace `idx_events_publication_ref` with `idx_events_publication_ref_v2`, which covers all three `*_published` types.
  - The migration runs `DROP INDEX IF EXISTS idx_events_publication_ref`, then the create.
- `community/service.ts`:
  - `CommunityDeps.quizzes`, and a `toQuizSummary`.
  - Quiz branches in `toDigestItem` for publication and vote. The publication branch checks ownership the way tier lists do, with no promoted placeholder.
  - Quiz branches in `getActivity` / `toActivityItem`: `quiz_published` gets `name`, `detail`, `covers` and `href: /play/<voteCode>`, and a quiz `voted_on` gets `covers` and `href`. Drop the item if the quiz is gone or not owned.
  - Profile `published.quizzes`.
  - `getDiscover`: merge the quiz window when `type` is `all` or `quiz`, and set the `played` flags with `votedAmong`.
- `community/routes.ts`: the discover `type` enum gains `quiz`.
- `backend/src/app.ts`:
  - `registerQuizzesModule` gets `emitPublished: (quizId, owner) => recordActivity(owner, "quiz_published", "quiz", quizId)` and `emitPlayed: (userId, quizId, name) => recordActivity(userId, "voted_on", "quiz", quizId, { game: "quiz", id: quizId, name })`.
  - Community deps get `quizzes: getQuizzesPublicApi()`'s five reads.
- Every test or helper that builds `CommunityDeps` by hand needs a `quizzes` stub: `community/service.test.ts` (`createDeps`), `backfill.test.ts` and `archive.test.ts`. In `sqliteCommunityRepository.test.ts`, the "five feed types" name and the hard-coded default-shown list need the new type.
- `backend/README.md` (around :351-356): the feed-type list and the index sentence.

- [ ] Write failing tests:
  - A follower's dashboard shows a quiz publication item (kind "quiz", correct counts) and a quiz vote item.
  - Turning off Publications hides the first, and turning off Votes hides the second.
  - `getActivity` returns both quiz events with `/play/<code>` hrefs, and drops them once the quiz is deleted.
  - The profile Published list includes the quiz.
  - Discover's `type=quiz` returns only quizzes, `all` includes them, and the viewer's played flag is set.
  - Schema test: on a database created with the old index, `migrateSchema` leaves `_v2` in place and the old one gone. A duplicate `quiz_published` insert is ignored.
- [ ] Implement, then `npm run typecheck --workspace backend && npm test --workspace backend`.
- [ ] Commit.

### Task 4: Web renders quizzes and skips unknowns

**Files:**
- `frontend/src/components/ProfileActivity.tsx`: a quiz glyph in `Glyph`, and filter out rows where `activityRow` returns null.
- `frontend/src/pages/DiscoverPage.tsx`: a "Quizzes" filter in `DISCOVER_FILTERS`, a `QuizThumb` beside `TierlistThumb`/`TournamentThumb`, and skip items with an unknown `content.kind`.
- `frontend/src/pages/CommunityProfilePage.tsx`: published rows include `view.published.quizzes`.
- `frontend/src/api/community.ts`: types.
- `frontend/src/pages/HomePage.tsx`: change only if it branches on content kind beyond the generic digest helpers.
- Tests: `frontend/scripts/test-activity-helpers.mts`, `test-community-helpers.mts` and `test-dashboard-cards.mts` gain quiz and skip-unknown cases.

- [ ] Tests first, then implement.
- [ ] `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`.
- [ ] Commit.

### Task 5: Mobile renders quizzes and skips unknowns

**Files:**
- `mobile/src/features/home/feedRowModel.ts`: publication and vote icon and label for quiz (icon `"champion"`, the same as quiz participation), and `digestRoute` to `/play/<code>`.
- `mobile/src/features/community/ActivityList.tsx`: an `iconFor` quiz case, and skip null rows.
- `mobile/src/features/community/communityHome.ts`: the Quizzes filter.
- `mobile/src/features/community/DiscoverPane.tsx`: a quiz thumb, no "See books", and skip unknown kinds.
- `mobile/src/features/community/ProfileScreen.tsx`: `PublishedRow.kind` gains `"quiz"`, and rows come from `published.quizzes`.
- `mobile/src/features/community/api.ts`: types.
- Tests: `feedRowModel.test.ts` and `communityHome.test.ts`.

- [ ] Tests first, then implement.
- [ ] `npm run typecheck --workspace mobile && npm test --workspace mobile`.
- [ ] Commit.
- [ ] Device pass with `device-checker`. On the seeded dev account, publish and play a quiz from a second account, then check the home feed, profile Activity and Published, and Discover with the Quizzes filter.

## After all tasks

- Run `branch-reviewer` once against the spec and this plan.
- Then use the `ship` skill to open the PR. Merging is the user's call.
