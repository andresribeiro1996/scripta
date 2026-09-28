# Cover Quiz on mobile — native screens (full parity)

Addendum to `2026-09-26-cover-quiz-design.md`, which locked "web only in v1".
The PR review flagged the missing native component; the owner chose full
parity: play, create, and manage quizzes natively. The backend needs
nothing new — every route exists, and `@scripta/shared/quizzes` (types,
seeded draw, grading, pool) is already platform-agnostic and consumed via
`dist`. This phase is mobile screens + an API wrapper module only.

## Decisions locked in with the user

- Full parity (option B): play, create/edit, and manage — not the
  play-only smaller scope offered first.
- Play is **tap-based**: one question per screen, four large option
  buttons, auto-advance on pick. No gesture deck — `ArenaVoteDeck`'s drag
  semantics don't map onto 4-option multiple choice.
- The mobile editor uses the platform's explicit-save idiom (header Save
  action + dirty status line, like `TierlistEditorScreen`), not the web
  page's autosave queue. Publish saves dirty state first, then mints.
- Anonymous play via AsyncStorage `quiz-play:<code>` (the established
  home for per-link anonymous ids — tier lists use
  `tierlist-ballot:<code>`; SecureStore stays reserved for the refresh
  token). Signed-in players are account-keyed. Submit/recover routes take
  an `authenticated` boolean, same as `submitBallot`.
- Owner results (leaderboard + per-question pick bars) live in the
  editor's third view; the play end screen shows the player's own verdicts
  plus the public leaderboard behind "You" / "Leaderboard" tabs.
- Decision logic goes in sibling `*.ts` modules with `node:test` coverage;
  screens stay untested (mobile convention — no component tests exist).
- Deep link: one new Android intentFilter `pathPrefix: "/play/"`; iOS
  associatedDomains are path-agnostic but the server's AASA file must add
  `/play/` (outside this repo — flagged, not done here).

## Screens

Route files stay thin wrappers (5–15 lines) over feature screens, per the
`vote/[code].tsx` and `(arena)/tierlist/[id].tsx` precedents.

1. **`src/app/play/[code].tsx`** (public, outside `(app)` and the auth
   guard) → `QuizPlayScreen({ code })`.
2. **`(arena)/quiz/new.tsx`** → `QuizCreateScreen` — two-step wizard:
   source + books, then length + types. Sources: whole shelf
   (`filterBooks` search over `["library"]`), one collection, or the
   curated pool (`QUIZ_POOL`). Shelf/collection books get covers resolved
   through mobile's cache-aware resolve chain
   (`features/library/api/covers.ts` `resolveCover` — the same fix the web
   create page got in review) so cover-question availability is honest
   before the snapshot ships. Length options `[4,5,10,15,20]` filtered to
   `≤ books.length`; type checkboxes greyed via `eligibleTypes`.
   Create → `router.replace` to the editor (the `TierlistCreateScreen`
   idiom).
3. **`(arena)/quiz/[id].tsx`** → `QuizEditorScreen({ quiz, onUpdated })`,
   resolving the quiz from the `["quizzes"]` query like the tierlist
   editor. Draft sections: questions length + type toggles, book list with
   remove, per-book quote/blurb paste, explicit Save (dirty = JSON
   compare, "Saving… / Unsaved changes / Saved" status), publish
   (menu → Dialog → save-then-publish → share via
   `Linking.createURL("/play/<code>")` + `Share.share`), open/close for
   play, published-question preview with answers (cover thumbnails for
   title→cover), and the owner results view (leaderboard rows +
   per-question pick bars).
4. **`ArenaHomeScreen`** — a third `SwipeableTabs` tab, "Quizzes", listing
   the account's own quizzes (`fetchQuizzes`, `["quizzes"]` key) with the
   same FlatList/search/EmptyState/pull-to-refresh skeleton as the other
   two tabs; delete via `Dialog`; the Fab routes by active tab
   (`/quiz/new` on the quizzes tab).

## API layer (`src/features/quizzes/api.ts`)

Thin `apiClient.request` wrappers, one per backend route, mirroring
`features/tierlists/api.ts`: `fetchQuizzes`, `fetchQuiz`, `createQuiz`,
`updateQuiz`, `deleteQuiz`, `publishQuiz`, `setPlayState`,
`fetchQuizResults` (owner, `auth: true`); `fetchPlayBoard` (public),
`submitPlay(code, body, authenticated)`, `fetchPlay(code, playId,
authenticated)`, `fetchPublicResults` (public). Play-id helpers read/write
AsyncStorage `quiz-play:<code>` and report storage failure as a message,
never a silent swallow (the `VoteTierlistScreen` precedent).

## Play state machine

`skeleton` (board resolving / stored id resolving) → board fetch error →
`ErrorState` "No quiz at that link" → `!playOpen` → closed notice → own
play exists (signed-in: `fetchPlay(code, null, true)`; anonymous: stored
id) → end screen → otherwise the question view. Picking an option
advances after a short beat (`commitHaptic`), the last answer reveals the
name input + submit, and the submitted response renders the end screen
(the backend grades; the device never sees the key). Extracted pure logic
(`features/quizzes/quizPlay.ts`): submission payload building, the
answered-count/last-question decisions, and the storage key — the parts
`quizPlay.test.ts` covers.

## Verification

- `npm run build --workspace @scripta/shared` (already current), then
  `npm run typecheck --workspace mobile` and
  `npm test --workspace mobile` (new `*.test.ts` files are picked up by
  the glob automatically).
- `cd mobile && npx expo-doctor` after the app.json change.
- `npm run mobile` with `EXPO_PUBLIC_API_URL` pointed at a dev backend:
  walk play (deep link via `npx uri-scheme open` or the vote-screen
  pattern), create from each source, paste a quote, publish, share, and
  confirm the leaderboard. Device/emulator work follows
  `docs/dev-workflow.md` (lease rules; Maestro only with a device).

## Deferred

- Quiz discovery in the mobile community feed (community integration is
  deferred globally, web included).
- AASA server update for `/play/` (documented for the owner).
