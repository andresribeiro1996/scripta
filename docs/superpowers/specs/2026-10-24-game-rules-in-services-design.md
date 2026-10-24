# Game publish and save rules move into the services

From the 2026-10-24 architecture review (candidate B). The rules that decide whether a tier list, quiz or tournament may be saved or published live in route handlers, so only `app.inject` tests reach them, and three of them have no test at all:

- `tierlists/routes.ts`:
  - `storedBoard` (66-75): duplicate tier or book → 400, two editions of one work → 409, ids swapped for canonical works.
  - `POST /tierlists` (91-111): "Choose books and tiers before publishing." (`access` without `data`), duplicate tier ids, "Public tier lists need an unranked book pool.", "A selected book is no longer in your library." The last three are untested.
  - `PUT /tierlists/:id` (125-148): a missing or public list is a 404, then `storedBoard`.
  - `POST /:id/open-voting` (162-183): builds the public-books snapshot (`booksInOrder`) for the service.
- `quizzes/routes.ts`:
  - `POST /quizzes` (62-80): resolves books to works (`quizBookWorks`), "That book isn't in the catalog.", silently keeps the first book per work.
  - `PUT /quizzes/:id` (90-117): the same resolution, plus two editions of one work → 409.
  - `POST /:id/publish` (127-150): finds books without a cover and fills them from the owner's library before calling `publishQuiz`, which dedupes by work a second time.
- `arena/routes.ts` `PUT /arenas/:id/slots` (117-135): two editions of one work → `DuplicateBookError`, before `setSlotsManual`.

The library lookups these rules need (`knownWorkIds`, `resolveTitleWorks`, `canonicalByKey`, `resolvePublicBooksByWork`) are imported straight from `library/index.ts` by the routes, by `tierlists/wire.ts` and `quizzes/wire.ts`, and by `arena/service.ts:31` (as a default parameter). So `arena/service.test.ts` points `LIBRARY_DB_PATH` at a temp file to construct a service.

## Decision

**A works port per game.** Each game's `domain/ports.ts` declares the library lookups its service needs:

- `TierlistWorks`: `knownWorkIds`, `canonicalByKey`, `publicBooksByWork(ownerUserId, workIds)`
- `QuizWorks`: `knownWorkIds`, `resolveTitleWorks`, `canonicalByKey`, `publicBooksByWork`
- `ArenaWorks`: `knownWorkIds`, `canonicalWorkIds`

Each `plugin.ts` builds it from `library/index.ts`, exports it, and passes it as the service's second argument: `create*Service(repo, works, …emitters)`. Service tests pass an in-memory fake; route tests pass the real one. Nothing in a game's `service.ts` imports `library/index.ts`, directly or through `wire.ts`: the pure board helpers the tier-list service needs move from `wire.ts` to `tierlists/domain/board.ts`.

**The rules move into the services.** Tier lists and quizzes return `{ ok: true, … } | { ok: false, reason, error }` outcomes, as `publishQuiz` and `BallotOutcome` already do. Routes map each reason to a status:

| reason | status |
|---|---|
| `not-found` | 404 |
| `invalid` | 400 |
| `duplicate-work` | 409 |
| `already-published` | 409 |

A `duplicate-work` outcome carries the book's title, and the route builds today's message from it with `duplicateWorkMessage`. Every error string stays word for word.

- **Tier lists.**
  - `createTierlist(userId, input)` takes `{ name, data?, access?, ranksWorstFirst? }` and owns every create rule, including the public-books snapshot.
  - `updateTierlist` owns the 404 and the board rules.
  - `openVoting(userId, id, access)` builds its own snapshot.
  - `booksInOrder` moves from the routes onto the service, and the public voting-board route keeps its live fallback through it.
  - The ok outcome carries the canonical board the route sends.
- **Quizzes.**
  - `createQuiz` owns resolution, the catalog error and the first-per-work dedupe.
  - `updateQuiz` owns resolution and the duplicate 409.
  - `publishQuiz(userId, id)` fills missing covers from the owner's library itself.
  - The ok outcomes carry the canonical map the route needs for `quizToWorks`.
  - `quizBookWorks` moves from `wire.ts` into the service, over the port.
- **Arena.** `setSlotsManual` resolves the slots' works through the port and throws `DuplicateBookError` itself. `randomFill` resolves its pool through the port. Arena keeps its typed errors and `statusForArenaError`.

Work-resolution failures (`UnknownWorkError`, `WorkResolutionError`) stay thrown, and routes keep mapping them through `sendWorksError` or arena's catch, so a catalog outage is still a 503 that writes nothing.

`wire.ts` stays a wire concern: the translation of stored ids to canonical ids for responses (`canonicalBoard`, `quizToWorks`, `canonicalForQuiz`, …) keeps calling `library/index.ts`. It doesn't decide anything.

Checks keep today's order: ownership and state first, then the request's own checks, then work lookups, then writes.

## Behaviour changes

- Publishing an already-published quiz while the catalog is down answers 409 "This quiz is already published." instead of 503, since the published check now runs before the cover lookup.
- Opening voting on, or a name-only edit of, an already-public tier list while the catalog is down answers 404 "No tier list with that id." instead of 503, since the public check now runs before the catalog lookups.

## Tests

The rules are tested at the service with the fake port, including the three untested tier-list rules. Each status mapping keeps one route test; route tests that only re-check a rule now covered at the service are deleted.

## Not in scope

- Unpublishing (none exists), the shape of responses, and status codes other than the one change above.
- `murals/routes.ts`, which already takes `resolveWorks` as an injected parameter.
- The game contract between community and the games (candidate D, its own spec).
