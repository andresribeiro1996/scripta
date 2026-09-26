# Cover Quiz — a third arena game

## Context

Scripta's Arena already has two social ballot games built on a user's book
pool: bracket tournaments (`modules/arena`) and tier lists
(`modules/tierlists`). Both share one weakness the user identified while
brainstorming a third game: their spectating value depends on the viewer
knowing the books, so they captivate friends but not strangers.

The cover quiz is the app's first score-based game. Questions are
objective (pick the right title/cover), so anyone can play — including
people who have never seen the owner's library. It ships with link
challenges first (share a code, compare scores) and a data model shaped so
public/stranger challenges can bolt on later without rework.

## Decisions locked in with the user

- Three question sources, chosen at creation: the owner's whole shelf, a
  single collection, or the curated common pool. The backend is
  source-agnostic: the create/publish payload always carries a book list
  plus a display-only `sourceLabel`.
- Four question types: **cover→title** (blurred cover), **title→cover**,
  **quote→title**, **blurb→title**. Books have no quote data today and
  OpenLibrary has no quote endpoint, so quotes are owner-entered per book
  (pool books ship with curated famous lines). Blurbs come from the
  summaries already resolved during metadata lookup.
- Every player of a quiz gets the **same question set**: the draw is
  seeded from the quiz's vote code and generated once, at publish time.
- Questions = one prompt + 4 shuffled options; covers get a fixed CSS
  blur (one value for all players; ramping difficulty is future work).
- Scoring: correct count, tiebroken by total duration. No streaks/combos.
- Challenge model for v1 is link-only (vote-code style, like tier lists);
  public directory / stranger matchmaking is explicitly out of scope but
  the `source` seam is where it lands later.
- Web only in v1; mobile comes later.
- One play per voter, locked once submitted (no edits — a player must not
  resubmit after seeing results).

## Backend design (`backend/src/modules/quizzes/`)

Follow the tierlists module shape exactly:
`domain/{ports.ts,types.ts}`, `service.ts`, `routes.ts`, `plugin.ts`,
`adapters/sqlite/{connection.ts,schema.sql,sqliteQuizzesRepository.ts}`.
New env var `QUIZZES_DB_PATH` (default `./data/quizzes.sqlite`) in
`config/env.ts`; register the module from `app.ts`. Add new test files to
`npm test`'s explicit file list.

**Data model (quizzes.sqlite, raw SQL, no ORM):**

- `quizzes(id, owner_user_id, name, data, vote_code NULL, play_open 0|1,
  created_at, updated_at)` — `data` is the opaque quiz document (parsed
  only at the service edges, same convention as tier lists). Same
  partial-unique-index treatment for `vote_code` and the public-listing
  index as `schema.sql` in tierlists. (Tier lists' `vote_access` column
  is deliberately omitted — nothing in v1 sets it; plays are
  anonymous-by-link. Add it when members-only quizzes are actually
  wanted.)
- `quiz_plays(id, quiz_id, voter_user_id NULL, player_name NULL, score,
  duration_ms, created_at, updated_at)` — one play per voter per quiz via
  a partial unique index on `(quiz_id, voter_user_id) WHERE voter_user_id
  IS NOT NULL` (anonymous plays collide only with themselves; the
  anonymous handle is the play id, handed back once on submit — the same
  idiom as anonymous tier-list ballots). `player_name` is optional
  free text supplied at submit time so challenge leaderboards are
  readable without accounts.
- `quiz_play_answers(play_id, question_id, choice_index, correct 0|1,
  PRIMARY KEY(play_id, question_id))` — normalized so per-question
  pick-rate/correct-rate stats are plain GROUP BYs, mirroring the
  tierlist placements pattern.

**Quiz document (the `data` JSON):**

```
{
  sourceLabel: string,              // display only ("Shelf", "Dostoevsky", "Classics pool")
  questionCount: number,            // 10 default, 20 max
  allowedTypes: QuestionType[],     // subset of the four types
  books: QuizBook[],                // publish-time snapshot
  questions: QuizQuestion[] | null  // null until publish
}
QuizBook    { key, title, author, coverUrl: string|null, quote: string|null, blurb: string|null }
QuizQuestion{ id, type, bookKey, options: string[4], answerIndex }
```

`options` holds **titles** for cover/quote/blurb questions and **cover
URLs** for title→cover questions; the render switch is on `type`. Cover
blur is a render-time constant (same value for every player), not stored
per question.

`books` is a snapshot: editing the library or the collection afterwards
never mutates a published quiz (same philosophy as tournament slots).
`answerIndex` lives in the document but is **never** sent to a player —
the public play payload strips it; the owner payload keeps it. Grading is
server-side; the client never sees the key before or after playing
(individual correct/incorrect feedback after submit is computed from the
player's own stored answers plus the key, server-side).

**Publish flow** (`POST /quizzes/:id/publish`, owner only, private quizzes only):

1. Validate: ≥4 books total (options need distractors) and ≥
   `questionCount` books eligible under `allowedTypes` (eligibility:
   cover→title and title→cover both need `coverUrl` — the latter's
   options are cover URLs; quote→title needs `quote`; blurb→title needs
   `blurb`).
2. Mint the vote code, then generate `questions` via the shared seeded
   draw (seed = hash of vote code) and store them on the document.
3. Set `play_open = 1`.

Mirrors tier lists' two-step: `PUT /quizzes/:id/voting` `{open}` toggles
`play_open` afterwards. The document is not editable once a vote code
exists.

## Shared package (`packages/shared/src/quizzes/`)

New entry point in the `exports` map. Pure logic, no platform imports:

- `types.ts` — `QuizBook`, `QuizQuestion`, `PublicQuizQuestion`
  (answerIndex stripped), `QuestionType`, `QuizData`, play/result payload
  types the three clients share.
- `draw.ts` — `generateQuizQuestions(books, config, seed)` plus the small
  seeded RNG (mulberry32; seed = FNV-1a hash of the vote code) and the
  `eligibleTypes(book)` helper. Deterministic: same seed → same set.
  Lives in shared so eligibility/render rules have one home for when the
  mobile client renders plays.
- `pool.ts` — the curated common pool: ~30–40 famous books (title,
  author, OpenLibrary cover URL, one famous quote each). The web client
  reads this to offer pool books at create time; whatever the owner picks
  is submitted like any other source and snapshotted.
- `grade.ts` — `gradeAnswers(questions, submitted)` → `{score, correct:
  Record<questionId, boolean>}`. Backend uses it to score; both score
  displays derive from the same function.

## Routes (zod-validated bodies, `authGuard` where noted)

| Route | Auth | Purpose |
|---|---|---|
| `GET/POST /quizzes` | owner | list / create (private, no questions yet) |
| `GET/PUT/DELETE /quizzes/:id` | owner | read (with answer key) / edit while private / delete |
| `POST /quizzes/:id/publish` | owner | validate → seed → mint code → open |
| `PUT /quizzes/:id/voting` | owner | toggle `play_open` |
| `GET /quizzes/:id/results` | owner | plays leaderboard (score DESC, duration_ms ASC) + per-question option pick rates + correct rates |
| `GET /quizzes/voting/:code` | public | quiz meta + questions **sans** `answerIndex`; 403 when `play_open = 0` |
| `POST /quizzes/voting/:code/play` | public | `{answers:[{questionId, choiceIndex}], durationMs, playerName?}`; grades server-side, creates the play (409 on second play by same voter), returns score + per-question correct/incorrect map |
| `GET /quizzes/voting/:code/results` | public | leaderboard (score, durationMs, playerName or "Guest") — both challenge partners compare here |
| `GET /quizzes/voting/:code/play/:playId` | public | recover your own play (anonymous handle), same shape as the ballot-recovery route in tierlists |

Invalid `questionId`/`choiceIndex` in a submission → 400. Closed quiz →
403. Second play by the same account → 409.

## Frontend design (web only)

- `src/api/quizzes.ts` + react-query hooks, mirroring `api/tierlists.ts`.
- Dashboard: third Arena tab "Quizzes" (`/dashboard/arena?tab=quizzes`,
  same ListCard row pattern as tier lists/tournaments).
- Create form: name, source picker (shelf / collection / curated pool —
  pool books render from `@scripta/shared`'s `pool.ts`), length
  (default 10, max 20), type checkboxes auto-greyed when no book in the
  source has the data.
- Quiz editor (`/dashboard/arena/quizzes/:id`): add/remove books, paste a
  quote per book, preview the seeded question set after publish.
- Play page (`/play/:code`, public, outside `RequireAuth`): one question
  at a time, timer running, blurred cover / title / quote / blurb with 4
  options; end screen = score, per-question right/wrong, and the
  challenge link plus leaderboard.
- Results: leaderboard + per-question pick-rate bars; owner's view
  additionally shows the answer key.

## Known simplifications (stated, not hidden)

- `durationMs` is client-reported. It only breaks ties, so a cheater
  hurts their own ranking; correctness is graded server-side and cannot
  be read from any public payload.
- Fixed blur for every cover question — one tunable value, no ramping.
- Anonymous play is bounded the same way anonymous tier-list ballots are:
  the play id is the only handle, and a cleared localStorage can play
  again as a "new" guest. Acceptable for friend challenges; revisit when
  public challenges arrive.
- A quiz's books are a snapshot; later library/collection edits don't
  propagate.
- No community-feed integration (`quiz_published` events, Discover
  filter) and no public directory — both deferred to the strangers phase.

## Verification

- Shared: `npm run build --workspace @scripta/shared`; draw-function
  tests — same seed → identical set, distractor shuffling is a
  permutation of 4 distinct options, eligibility filtering, grade.ts
  scoring.
- Backend: `npm run typecheck --workspace backend && npm test
  --workspace backend`; service tests for publish validation (too few
  books / ineligible types), grading, answer stripping on the public
  payload, one-play-per-voter, anonymous play handles, closed-quiz
  rejection; route tests; adapter tests against the schema — same file
  layout as tierlists' three test files.
- Frontend: `npm run typecheck --workspace frontend && npm run lint
  --workspace frontend`; walk the flow against the dev backend — create
  from each of the three sources, paste a quote, publish, open `/play/:code`
  in an incognito window, submit, confirm the leaderboard shows the play
  and the owner's stats update.
