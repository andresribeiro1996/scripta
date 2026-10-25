# Book characters — design

## Why

The user wants characters for games. The first game is a fifth cover-quiz question type, "Frodo Baggins, Samwise Gamgee, Peregrin Took: which book?". Character tier lists and tournaments come next, in a separate spec. Characters will later carry metrics, such as quiz and game stats, so they must come only from the catalog and have a stable identity. They are never owner-typed.

Open Library's per-work person subjects are the source. They are CC0, and Hardcover's characters turned out to be mostly these same headings. They are library subject headings for people a book is *about*, not a curated cast list. On non-fiction they are real people: Hitler on *The Rise and Fall of the Third Reich*, Lincoln on *Team of Rivals*. Even on fiction they carry noise. *Nineteen Eighty-Four* lists "God", "Rudyard Kipling", Orwell's literary agent, a translator and "George Orwell (1862-1931)". Precision matters more than coverage: a wrong name makes a broken quiz question, while a book with no characters just doesn't get that question type.

## Decisions

**From the user (2026-10-25):**
- **Order of work.** This release covers the data and the quiz question. Character tier lists and tournaments get their own spec afterwards, because their items stop being books: no covers, no work ids for Top Shelf or community discovery, and no share-video artwork.
- **Quiz question type: characters → title.**
- **Catalog only.** Quiz owners cannot type or edit characters, because characters will carry metrics.
- **Character identity is per series, otherwise per work.** Harry Potter on all seven books is one character.
- **Agreed as proposed:**
  - the filtering rules below
  - lookups by Open Library work key only
  - places and times stored but unused
  - the book-screen line
  - no search this release
  - no metrics this release

**Builder's calls (Claude's, each open to the user's override):**
1. **Identity is derived on read and not built yet.** Rows are stored per work. A character's identity is `(scope, name_key)`. The scope is the work's best series (`bestSeriesOf`, its `name_key`) when it has one, otherwise the canonical work id. No code computes this in this release, because nothing consumes it. The rule is recorded here for the tier-list/tournament spec. It's derived rather than stamped, because series fills (Wikidata, BNP, Hardcover) keep landing, and a stamped identity would split a book's characters when it gains a series later.
2. **Replace, not add-only.** Open Library is the only source, so each fetch replaces a work's rows of every kind. That lets a re-run apply changed cleanup rules. The exception: a work whose key Open Library doesn't return (a redirect or deleted record) keeps its rows untouched, because absence isn't evidence.
3. **The fiction gate uses Open Library's own subjects, not Scripta's genres.** Scripta's genres sit on editions, are often empty, and have no fiction/non-fiction field.
4. **The quiz uses the first three cleaned names.** Open Library lists main characters first.
5. **Old clients get a joined string.** The public question's `prompt` stays a single string, the names joined with " · ". Installed apps that don't know the type fall through to their quote rendering and show it in quotation marks. That looks odd but works (`mobile/src/features/quizzes/QuizPlayScreen.tsx:144-153`). No new field is added to `PublicQuizQuestion`.
6. **No resume flag on the backfill.** It batches 100 keys per request, so a full run is roughly one request per 100 works. Re-running from the start is the resume.
7. **Merged works are read through their aliases.** Use the canonical work's own list when it is non-empty. Otherwise use the longest list among its alias works. This mirrors how `bestSeriesOf` and `awardsOf` fold aliases (`sqliteBooksRepository.ts:1394`, `:1484`). Lists are not unioned, because the order would lose its meaning. Any read given a merged-away id resolves it to its canonical work first, and answers under the id it was given.
8. **No two options may share the prompt's characters.** Several books of one series in a quiz often share their first three names (Harry, Ron and Hermione on every Harry Potter book), which would make a question with two right answers.
   - A `characters_title` draw skips any distractor whose character list contains one of the three prompt names (compared by lowercase trimmed name).
   - If fewer than three distractors remain, that book doesn't get this type on that draw. That follows the existing skip of duplicate-valued distractors (`draw.ts:68-76`).
   - So quiz books carry their full cleaned list, not just three names. The prompt uses the first three.
9. **Sparse records wipe; failed lookups don't.**
   - A details fetch that succeeds with zero cleaned people deletes the work's people, because replace applies to every kind.
   - A `null` details result (no Open Library match) touches nothing, the same as `storeSeries` today.
   - If the hook (work record) and the backfill (search index) disagree for a work, the last writer wins. That's accepted.

## Source

Two Open Library reads return the same fields in the same order. Both were checked on 2026-10-25.

| Read | Fields | Used by |
|---|---|---|
| Work record `/works/OLxxxW.json` | `subject_people`, `subject_places`, `subject_times`, `subjects` | the details hook, which already fetches this record in `fetchDetails` (`adapters/openlibrary/openLibraryCatalog.ts:51`) at no extra request |
| Search `search.json?q=key:(/works/OL1W OR /works/OL2W …)&fields=key,author_name,person,place,time,subject&limit=100` | `person`, `place`, `time`, `subject`, `author_name` | the backfill: 100 works per request |

In the details hook, the author names come from the search match (`match.author_name`) that `fetchDetails` already holds.

`works.ol_work_key` and `books.ol_work_key` store the bare form `OL66554W` (`normalizeWorkKey`, `domain/normalize.ts:35`). The backfill prefixes `/works/` when it builds the query, and maps each response `key` back through `normalizeWorkKey`.

## Cleanup rules

One pure function in the books domain turns `{ people, places, times, subjects, authors }` into `{ person: string[], place: string[], time: string[] }`. Both the hook and the backfill use it. Places and times are only trimmed and de-duplicated by key, with no gate.

People, in order:
1. **Fiction gate.** The work passes when a subject matches fiction, or when a person heading carries a "(Fictional character)" / "(Fictitious character)" qualifier.
   - Fiction subjects match `fiction`, `ficción`, `ficção`, `novel`, `romance` or `romans` as words, case-insensitive. That covers "Fiction", "Fantasy fiction", "Juvenile fiction" and "Fiction, Romance, Historical, Regency".
   - Any subject matching `non-?fiction` never counts as fiction.
   - A work that fails the gate stores no people.
2. **Strip qualifiers.** Remove a trailing `(Fictional character)`, `(Fictitious character)`, `(Legendary character)` or `(Mythical character)`, case-insensitive.
3. **Drop life dates.** Drop any name containing a run of three or more digits, which catches "William Shakespeare (1564-1616)" and "Hermann Goering (1893-1946)". HAL 9000 is lost too; that's accepted.
4. **Drop the author.** Drop names whose key equals the key of one of the work's authors.
5. **Merge duplicates by `name_key`.**
   - `name_key` is `seriesNameKey` (`domain/series.ts:10`), with a leading honorific (mr, mrs, ms, miss, dr, sir, lady) removed when two or more words remain. So "Mr. Sherlock Holmes" and "Sherlock Holmes" merge, but "Mr. Bennet" stays "mr bennet".
   - The merged entry keeps the first occurrence's position and displays the variant with the fewest words.
6. Drop empty names after trimming.

Expected results from the 2026-10-25 probes. These become test fixtures:

| Work | Result |
|---|---|
| *Pride and Prejudice* | 14 people: Elizabeth Bennet, Fitzwilliam Darcy, Charlotte Lucas… |
| *Nineteen Eighty-Four* | starts Big Brother, Emmanuel Goldstein, Thought Police; "George Orwell (1862-1931)" dropped |
| *The Hound of the Baskervilles* | starts Sherlock Holmes, Dr. Watson, John H. Watson |
| *Rise and Fall of the Third Reich*, *Team of Rivals*, *Steve Jobs*, *The Innovators* | no people (gate) |
| *Dune* | no people (Open Library has none) |

## Storage

New table in `books.sql`. `CREATE TABLE IF NOT EXISTS` ships it on boot (`adapters/sqlite/connection.ts:31`):

```sql
CREATE TABLE IF NOT EXISTS work_subjects (
  work_id TEXT NOT NULL REFERENCES works(id),
  kind TEXT NOT NULL CHECK (kind IN ('person', 'place', 'time')),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_id, kind, name_key)
);
```

Repository additions:
- `replaceWorkSubjects(workId, subjects, at)` deletes the work's rows and inserts the new ones.
- `charactersOf(workIds)` returns `Map<workId, string[]>`: people ordered by position, read through aliases (call 7). The work page, the quiz publish and the new route all use it.

## Getting characters

- **New works (the hook).** `fetchDetails` returns the cleaned subjects beside `subjectSeries`, but only when the work record is a real work (`type.key === "/type/work"`). A missing or redirect record returns none, so stored rows survive (call 2). `lookupDetails` (`booksService.ts:284`) calls `replaceWorkSubjects` after `setWorkKey` on both the found and the details-missing branches. It writes only when the book's work, re-read after `setWorkKey` (which can move the book), has the same Open Library key as the details. This covers every book that goes through the details lookup from now on.
- **Existing works (the backfill).** `backend/scripts/fill-characters.mjs [--dry-run]`, built like the other fills: it imports from `../dist`, needs `COVERS_DB_PATH`, and writes a JSON report to stdout.
  - It reads `SELECT id, ol_work_key FROM works WHERE merged_into IS NULL AND ol_work_key IS NOT NULL`.
  - It queries search in batches of 100 keys through the Open Library throttle (`createThrottle(1000)`).
  - Without `--dry-run` it replaces each returned work's subjects in one transaction per batch.
  - On a 429, any other HTTP error, or an unreadable response, it stops with an error and exit code 1. Rows already written stay, which is safe because writes replace.
  - Report fields:
    - `works`: keys queried
    - `returned`: docs Open Library returned
    - `withPeople`: works with at least one person after cleanup
    - `quizReady`: works with three or more
    - `gatedOut`: works with people that failed the gate
    - `rows`, by kind
    - `sample`: 20 works with their first five people
- **Runbook.** A backend/README.md section next to the other fills: deploy, then dry run, read the report (`quizReady` is the number to tell the user), then apply. The user runs both over `railway ssh` (`setsid node scripts/fill-characters.mjs [--dry-run] > /data/fill-characters.json 2> /data/fill-characters.log`). The session hands this as one runbook entry for the next batch deploy. Re-run after large imports.

## Book screen

- `getWorkPageWith` (`books/works.ts:59`) adds an optional `characters?: string[]` (all cleaned people, in order). The shared `WorkPage.work` type gets an optional `characters?: string[]`, which is additive, so old clients ignore it.
- `bookScreenModel` exposes it.
- Web (`frontend/src/components/book/BookScreen.tsx`, after the awards list) and mobile (`mobile/src/features/works/BookScreen.tsx`, the same place) show a "Characters" line:
  - the first eight names joined with ", "
  - a "+N more" control that expands the full list
  - nothing when the list is empty
  - styled like the existing dim caption lines; check `DESIGN.md` for tokens.

## Quiz

Shared (`packages/shared/src/quizzes/`):
- `QUIZ_QUESTION_TYPES` gains `characters_title`.
- `QuizBook` and `QuizBookContent` gain `characters?: string[] | null`, the work's full cleaned list.
- `eligibleTypes` adds `characters_title` when `characters` has three or more names.
- `generateQuizQuestions` applies call 8 to `characters_title` distractors.
- `preview.ts` builds the prompt as the first three names joined with " · ".
- Labels: "Guess the book from its characters" on the web create screen. "Characters → title" on the mobile create screen and both editors, matching each screen's existing style.

Backend (`backend/src/modules/quizzes/`):
- The route's `allowedTypes` enum gains `characters_title`. Its default when omitted stays the current four, and so does `readDocument`'s fallback for stored drafts without `allowedTypes` (`service.ts:42`). Neither old clients nor old drafts silently gain the type.
- Any `characters` a client sends on a book is ignored, because characters are catalog only.
- `publishQuiz` fills each book's `characters` from the catalog with `charactersOf`, through a new works-port read, next to where it fills covers (`service.ts:257-262`). The full list is stored. The values are frozen into the published document, so a later re-fetch never changes a published quiz.
- `toPublicQuestion` returns the joined names as the prompt for `characters_title`.
- The not-enough-books error becomes "Not enough books have the covers, quotes, blurbs, or characters those question types need."

Create- and edit-time availability. The create screens and the quiz editors only offer a type that at least one book supports (`QuizCreatePage.tsx:109`, `QuizCreateScreen.tsx:102`, `QuizEditorPage.tsx:149`, `QuizEditorScreen.tsx:131`), and the client has no character data. So:
- **New route** `POST /works/characters` with body `{ workIds: string[] }`, capped at 500 ids (builder's choice of cap). It returns `{ characters: Record<string, string[]> }` with the first three names, only for works with three or more. Optional auth, like `GET /works/:id`.
- The create screens and the editors call it whenever their book set changes, and overlay `characters` on those books for availability only. The values are never saved into the draft; publish refills them from the catalog.
- The starter pool's books carry no work ids on the client, so the characters type isn't offered for a pool-only quiz. Accepted for this release.
- The route shares the works scope's rate limit of 30 requests a minute (`works/plugin.ts:25-27`). That's enough, since calls happen on discrete book picks.
- If the call fails, the type is not offered. A one-line note says "Characters couldn't be checked", like mobile's existing cover note (`QuizCreateScreen.tsx:161`).
- No debounce or client cache: the set changes on discrete picks.
- Results are keyed by the id the client sent (call 7).

Play (web and mobile): a `characters_title` prompt renders as plain text without quotation marks, under a small "Who's in this book?" caption. The community discover clue heading (`mobile/src/features/community/DiscoverRow.tsx:124`, and its web counterpart if any) reads "Which book has these characters?" for this type.

## Not in this release

- character tier lists and tournaments (next spec)
- metrics, and any code that computes character identity
- search by character
- works without an Open Library key, which includes many BNP editions
- using places and times
- a deny list for names like "God"
- spoiler flags (Open Library has none)

## Deploy impact

- One new table, created on boot. No new env var and no `*_DB_PATH`.
- The API changes are additive: a new optional field, a new route and a new enum value. Old clients degrade as described in call 5.
- Mobile changes are JS-only and reach phones by OTA. EAS CI minutes run out until 11-01, so that's a manual OTA or a wait.
- The backfill needs the deploy first, because it imports from `dist`.

## Tests

Following the repo's conventions: `node:test` via `tsx --test`, in-memory SQLite, and replaced `fetch`. New backend test files go into the explicit list in `backend/package.json`.
- Cleanup function: the fixture table above, plus each rule on its own (the non-fiction subject, the qualifier, digits, the author, the honorific merge).
- Open Library adapter: `fetchDetails` returns cleaned subjects from a work record. The batched search parser maps docs back to keys and skips missing ones.
- Repository: replace semantics, alias read (canonical first, then the longest alias), and the three-name read for quizzes.
- Details hook: `lookupDetails` stores and replaces subjects.
- Backfill script: a dry run writes nothing and reports counts; apply writes; a missing key keeps its rows.
- Quiz: `eligibleTypes`, the draw with `characters_title` (including call 8: same-series books sharing the prompt names never appear as options), publish filling and freezing characters, client-sent characters ignored, the public prompt string, and route enum acceptance.
- `POST /works/characters`: the shape, the three-name minimum, and the cap.
- Work page: `characters` in `GET /works/:id`, and `bookScreenModel`.
