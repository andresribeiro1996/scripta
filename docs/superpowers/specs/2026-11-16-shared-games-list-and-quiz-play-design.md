# Shared games list and quiz play

From the 2026-11-16 architecture review (candidates 3 and 5). Both moves take a pure, tested mobile module into `@scripta/shared`, then make web render from it.

## Games list

Today:

- **Mobile** `mobile/src/features/arena/arenaHome.ts` holds the status badges (`tournamentBadge` :50, `stage` :61, `TIERLIST_STATUS`, `QUIZ_STATUS`) and the sections and search (`homeSections` :127-151).
  - Search covers owned rows plus voted tournaments or voted tier lists. It skips voted rows when the owner filter is "voted", and the quizzes tab has no voted section.
  - An active tournament's badge reads "In progress" (shared `contentStatusBadge("inProgress")`, tone `info`). Its caption reads "Round N of M" (`tournamentProgress`).
- **Web** `frontend/src/pages/ArenaListPage.tsx` builds the sections inline (:146-168).
  - Search is on tournaments only; the field renders only on that tab (:60-67, :131-135).
  - Voted tier lists get `badges={null}` (:257).
  - `TournamentStatusBadge.tsx:33-42` shows "Round {number}" in accent for an active tournament, or "Active" when `currentRound` is missing.
  - `QuizStatusBadge.tsx` `quizStatus` is the same draft/open/closed rule as mobile's `stage`.

Decided with the user:

- An active tournament's badge reads "Round N" on both clients.
- Search covers every row on the tab, as mobile does.
- Web gets mobile's voted-tier-list badges.

### Decision

New file `packages/shared/src/arena/gamesList.ts`, exported from `arena/index.ts`. It uses structural input types, so neither client's API types leak into shared.

- `tournamentBadge(t: { status: "seeding" | "active" | "completed"; currentRound?: number | null }, locale: Locale): { label: string; tone: ContentTone }`
  - Seeding gives `shared.gamesList.seeding`, tone `neutral`.
  - Active with `currentRound > 0` gives `shared.gamesList.round` ("Round {number}"), tone `accent`. Seeding fixtures use round 0, so 0 counts as no round.
  - Active with no round gives `contentStatusBadge("inProgress")`.
  - Completed gives `contentStatusBadge("completed")`.
  - The two new keys go into `packages/shared/src/i18n/messages/en.ts` and `pt-PT.ts`. Their text is copied from web's `arena.statusSeeding` and `arena.statusRound` (`frontend/src/i18n/messages/{en,pt-PT}/arena.ts:59-62`).
- `gameStage(voteCode: string | null, open: boolean): "draft" | "open" | "closed"` is today's mobile `stage`. Web's `quizStatus` is the same rule, and both clients use the shared one. Each client keeps its own stage-to-badge mapping. Web's quiz colours (`QuizStatusBadge.tsx:13-17`) and mobile's `QUIZ_STATUS` are deliberately different, and unifying them is not part of this work.
- `votedTierlistBadges(t: { votingOpen: boolean }, locale): Badge[]` returns the status badge plus "Voted", as mobile does today (`arenaHome.ts:~236`). Owned tier lists keep `ownedTierlistStatus` (`community/helpers.ts:90`).
- `gamesSections<O extends { name: string }, V extends { name: string }>(input: { owned: O[]; voted: V[] | null; search: string; owner: "all" | "mine" | "voted" }): { created: O[]; voted: V[] }` holds today's `homeSections` search and filtering:
  - a `trim().toLowerCase().includes` match on `name`;
  - with `voted: null` (the quizzes tab) there is no voted section;
  - the owner filter applies on top.

  Web passes `owner: "all"`. Section headings and empty copy stay per client.

Mobile `arenaHome.ts` keeps its tabs, `NEW_GAMES`, row models, covers, `emptyCopy` and `tournamentProgress`. It calls the shared functions instead of its private copies, and the caption keeps "Round N of M". Web:

- `TournamentStatusBadge` renders `tournamentBadge` through the existing `StatusBadge`/`STATUS_TONES` (`GameTicket.tsx:24`), which has a class for every tone. This also applies on `ArenaViewPage.tsx:152`.
- `QuizStatusBadge` uses `gameStage` and keeps its own colours.
- `ArenaListPage` uses `gamesSections` for all three tabs. It shows the search field and a "nothing matches" line on every tab, and clears the search when the tab changes.
- Voted tier lists get `votedTierlistBadges`.

The active-tournament tone on mobile changes from `info` to `accent`.

## Quiz play

Today mobile `mobile/src/features/quizzes/quizPlay.ts` has `buildSubmission`, `isComplete`, `nextIndex` and `playStage`. `playStage` returns `loading | unavailable | leaderboard | played | playing` from `{boardReady, boardMissing, playOpen, resolved, alreadyPlayed}`.

Web has its own pieces:

- `frontend/src/lib/quizPlayStage.ts` returns `loading | leaderboard | result | playing`.
- `PlayQuizPage.tsx` does completeness by key count (:68), the submission body inline (~:143) and the clamp inline (:126-131, inside a 220 ms timeout).
- Web shows an open quiz as playable while the own-play lookup is still pending.
- On a 404 for a stored anonymous play id, mobile removes the id (`QuizPlayScreen.tsx:51-67`). Web keeps it in `localStorage` (`useQuizPlay.ts`) and asks again on every visit.

### Decision

- `packages/shared/src/quizzes/play.ts`, exported from `quizzes/index.ts`, holds mobile's four functions verbatim. `playStorageKey` stays per client: web's `quiz-play-${code}` and mobile's `quiz-play:${code}` live in different stores, and renaming web's key would orphan existing anonymous result links.
- Mobile imports them from shared. `quizPlay.ts` keeps only `playStorageKey`.
- Web `PlayQuizPage` renders from shared `playStage`:
  - `boardMissing` is `board.isError`. "unavailable" shows today's error `InfoScreen`.
  - The own-play lookup runs only when it can find something, as on mobile (`QuizPlayScreen.tsx:49`): `playCount > 0 && (signedIn || playId !== null)`. Signed-in players look up by account with a null id.
  - `resolved` is true when the lookup is disabled, or when it has succeeded or answered 404. Any other error shows a retry `InfoScreen`, as mobile does (`QuizPlayScreen.tsx:60-64`). A failed read must not show the questions to someone who already played.
  - `alreadyPlayed` is `(submitted ?? ownPlay.data ?? null) !== null`.
  - "played" replaces "result".

  So web now waits for the own-play lookup before showing an open quiz, which stops a player who already played from seeing the questions flash.
- Web also uses shared `isComplete`, `buildSubmission` and `nextIndex`. The 220 ms delay before advancing stays in `PlayQuizPage`.
- Web `useQuizPlay` removes the stored play id when an anonymous player's lookup answers 404, as mobile does (`QuizPlayScreen.tsx:59`). Signed-in players and other errors leave it alone.
- `frontend/src/lib/quizPlayStage.ts` and `frontend/scripts/test-quiz-play-stage.mts` are deleted. Their cases move to `packages/shared/src/quizzes/play.test.ts`, together with mobile `quizPlay.test.ts`'s cases.

## Not in scope

- Web tournament card meta and links, and mobile's row models and covers.
- Discover and profile status wording. They use `contentStatus`, which still reads "In progress" for an active tournament.
- Unifying `playStorageKey`.
