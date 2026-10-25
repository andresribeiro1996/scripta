# Book Characters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store cleaned Open Library characters (plus places and times) on catalog works, show them on the book screen, and add a catalog-only "characters → title" quiz question type.

**Architecture:** One pure cleanup function in the books domain. Two callers feed it: the details lookup (a hook for new books, at no extra request) and a batched backfill (100 work keys per `search.json` request). Rows live in a new `work_subjects` table and are read through work aliases. The work page and a new `POST /works/characters` route read people from that table. Quiz publish freezes each book's full list into the quiz document. The shared draw uses the first three names as the prompt, and drops any distractor that shares one of them.

**Tech Stack:** Fastify + TypeScript + `node:sqlite` (backend); `@scripta/shared`; React/Vite (web); Expo/React Native (mobile); `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-25-book-characters-design.md`

## Global Constraints

- Characters come only from the catalog. A `characters` field a client sends on a quiz book is ignored, and owners never type characters.
- Keep API changes additive: `WorkPage.work.characters` is optional, `allowedTypes`' omitted default stays `["cover_title", "title_cover", "quote_title", "blurb_title"]`, and `PublicQuizQuestion.prompt` stays one string.
- The prompt is the first three names joined with `" · "`.
- A book is quiz-ready with **3 or more** names.
- `POST /works/characters` accepts at most **500** ids.
- The book screen shows the first **8** names, then "+N more".
- Copy, verbatim:
  - create screens: "Guess the book from its characters"
  - editors: "Characters → title"
  - play caption: "Who's in this book?"
  - mobile discover clue: "Which book has these characters?"
  - availability failure: "Characters couldn't be checked"
  - publish error: "Not enough books have the covers, quotes, blurbs, or characters those question types need."
- No code computes character identity (series scope). No search, metrics, deny list, or use of places and times.
- Every new backend `*.test.ts` file goes into the explicit list in `backend/package.json`'s `test` script.
- No comments in code. Run `typecheck` (and `lint` for frontend) in each package touched. `node scripts/gate.mjs` before claiming done.

## Review Focus

1. **The fiction gate on real-world subject strings.** "Juvenile fiction", "Ficção portuguesa" and "Fiction, Romance, Historical, Regency" pass. "Nonfiction" and "Non-fiction" never count. Pinned in Task 1.
2. **Two books from one series in one quiz** (Harry, Ron and Hermione on both). Neither ever appears as an option on the other's character question. Pinned in Task 6.
3. **A book whose details come only from the secondary catalog** (no `subjects` field). Its work's characters stay untouched. Pinned in Task 3.
4. **A merged-away work id** sent to `charactersOf`, which the quiz publish and `POST /works/characters` both use. It is answered under the id given, with the canonical work's list. Pinned in Tasks 2 and 5.
5. **An Open Library key missing from a batch response** (a redirect). That work's rows are kept. Pinned in Task 4.

---

### Task 1: Subject cleanup function

**Files:**
- Create: `backend/src/modules/books/domain/workSubjects.ts`
- Test: `backend/src/modules/books/domain/workSubjects.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces:
  - `type WorkSubjects = { person: string[]; place: string[]; time: string[] }`
  - `type CleanedSubjects = { subjects: WorkSubjects; gatedOut: boolean }`. `gatedOut` is true when raw people existed and the gate failed.
  - `cleanWorkSubjects(raw: { people: unknown; places: unknown; times: unknown; subjects: unknown; authors: unknown }): CleanedSubjects`. Non-array or non-string input is treated as empty.
  - `personNameKey(name: string): string | null`

- [ ] **Step 1: Write the failing tests** in `workSubjects.test.ts`, using the 2026-10-25 probe data from the spec:
  - `pride and prejudice keeps all 14 in order`: `subject_people` from `/works/OL66554W.json` (14 names, Elizabeth Bennet first), subjects include `"Fiction, Romance, Historical, Regency"`. Assert `person.length === 14`, `person[0] === "Elizabeth Bennet"`, `gatedOut === false`.
  - `1984 drops the dated author heading`: the 20 names from the spec probe, authors `["George Orwell"]`. Assert `person.slice(0,3)` deep-equals `["Big Brother","Emmanuel Goldstein","Thought Police"]`, and that no name contains `"Orwell"`.
  - `qualifier and honorific variants merge`: `["Mr. Sherlock Holmes (Fictional character)","Dr. Watson (Fictional character)","Sherlock Holmes","John H. Watson (Fictitious character)","Inspector Lestrade"]`, subjects `[]`. The gate passes via the qualifier. Assert `person` deep-equals `["Sherlock Holmes","Dr. Watson","John H. Watson","Inspector Lestrade"]`.
  - `non-fiction is gated out`: people `["Adolf Hitler (1889-1945)","Neville Chamberlain (1869-1940)"]`, subjects `["History","Third Reich"]`. Assert `person` is `[]` and `gatedOut === true`. Repeat with people `["Abraham Lincoln","William H. Seward"]` and subjects `["Nonfiction","American Civil War","Non-fiction"]`, expecting the same.
  - `gate words`: each of `"Juvenile fiction"`, `"Ficção portuguesa"`, `"Ficción"`, `"Graphic novels"`, `"Romance"`, `"Romans"` alone passes the gate for people `["A B","C D","E F"]`.
  - `the author is dropped by key`: people `["Jane Austen","Elizabeth Bennet"]`, subjects `["Fiction"]`, authors `["Jane Austen"]`. Assert `["Elizabeth Bennet"]`.
  - `three digits drop a name`: `"HAL 9000"` and `"William Shakespeare (1564-1616)"` are dropped, `"R2-D2"` is kept.
  - `one-word honorific stays distinct`: `personNameKey("Mr. Bennet") === "mr bennet"` and `personNameKey("Mr. Sherlock Holmes") === personNameKey("Sherlock Holmes")`.
  - `places and times are trimmed and de-duplicated, ungated`: places `["England"," England ","London"]` with subjects `["History"]` give `["England","London"]`.
  - `missing fields are empty`: `cleanWorkSubjects({people: undefined, places: null, times: 3, subjects: undefined, authors: undefined})` deep-equals `{subjects:{person:[],place:[],time:[]},gatedOut:false}`.

- [ ] **Step 2: Run to verify failure**
  Run: `cd backend && npx tsx --test src/modules/books/domain/workSubjects.test.ts`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement `cleanWorkSubjects` and `personNameKey`** in `workSubjects.ts`. Apply the spec's "Cleanup rules", steps 1–6, in order.
  - Fiction regex on subjects: whole words `fiction|ficción|ficção|novels?|romance|romans`, case-insensitive. Any subject matching `/non-?fiction/i` never counts.
  - Qualifier: strip `/\s*\((fictional|fictitious|legendary|mythical) character\)\s*$/i`. Its presence on any raw person also passes the gate.
  - Digits: drop on `/\d{3,}/`.
  - `personNameKey`: `seriesNameKey` (from `./series.js`). Then remove a leading `mr|mrs|ms|miss|dr|sir|lady` word when 2 or more words remain.
  - Merge: keep the first position, and display the variant with the fewest words (ties: first seen).
  - Places and times: key with `seriesNameKey`, keep the first variant.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Add the test file to `backend/package.json` `test`, typecheck, commit**
  Run: `npm run typecheck --workspace backend`
  ```bash
  git add backend/src/modules/books/domain/workSubjects.ts backend/src/modules/books/domain/workSubjects.test.ts backend/package.json
  git commit -m "Add Open Library subject cleanup for work characters"
  ```

### Task 2: `work_subjects` storage and alias-aware reads

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes: `WorkSubjects` and `personNameKey` (Task 1), and `seriesNameKey` for place and time keys.
- Produces, on `BooksRepository`:
  - `replaceWorkSubjects(workId: string, subjects: WorkSubjects, at: string): void` deletes all of the work's rows, then inserts `position` = index within kind.
  - `charactersOf(workIds: string[]): Map<string, string[]>` is keyed by the ids given. It returns people by position, using the canonical work's own list if non-empty, otherwise the longest list among its aliases. Works with none are omitted.
  - `worksWithOpenLibraryKey(): Array<{ id: string; olWorkKey: string }>` returns rows `WHERE merged_into IS NULL AND ol_work_key IS NOT NULL`, ordered by rowid.

- [ ] **Step 1: Write failing tests** in `sqliteBooksRepository.test.ts`:
  - `replaceWorkSubjects replaces every kind`: write `{person:["A B","C D"],place:["X"],time:["T"]}`, then `{person:["E F"],place:[],time:[]}`. Assert `charactersOf([id]).get(id)` deep-equals `["E F"]`, and the `work_subjects` row count for the work is 1.
  - `charactersOf keeps order`: write `["Elizabeth Bennet","Fitzwilliam Darcy","Charlotte Lucas"]` and assert the same order back.
  - `charactersOf answers a merged-away id with the canonical list`: work B is merged into A, and only A has people. `charactersOf([B]).get(B)` equals A's list.
  - `charactersOf falls back to the longest alias list`: A has none, alias B has 2 names and alias C has 4. `charactersOf([A]).get(A)` equals C's list.
  - `worksWithOpenLibraryKey skips merged and keyless works`.
  Use the file's existing work and merge fixtures. Set `merged_into` the way the `awardsOf` tests do.

- [ ] **Step 2: Run to verify failure**
  Run: `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Add the DDL and implement the methods.**
  - DDL: the spec's `work_subjects` table, verbatim, after the `work_awards` index in `books.sql`.
  - Reads: resolve aliases exactly as `bestSeriesOf` does (`rootOf` + `canonicalWorkIds(aliasesOf(...))`, around `sqliteBooksRepository.ts:1394`). Select with `json_each`, ordered by `work_id, position`.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Typecheck and commit**
  Run: `npm run typecheck --workspace backend`
  ```bash
  git add backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts
  git commit -m "Store work subjects and read characters through aliases"
  ```
  Fakes of `BooksRepository` elsewhere that fail typecheck get the three methods as minimal stubs, in the same commit.

### Task 3: Details hook stores subjects

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts` (`CatalogDetails`)
- Modify: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Test: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
- Test: `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- Consumes: `cleanWorkSubjects` (Task 1) and `replaceWorkSubjects` (Task 2).
- Produces: `CatalogDetails.subjects?: WorkSubjects`. Open Library's `fetchDetails` always sets it when it returns details, even when every list is empty. Other catalogs never set it.

- [ ] **Step 1: Write failing tests**
  - In `openLibraryCatalog.test.ts`, add `details carry cleaned subjects from the work record`:
    - The work JSON has `subject_people: ["Mr. Sherlock Holmes (Fictional character)","Sherlock Holmes","Dr. Watson"]`, `subject_places: ["London"]`, `subject_times: ["19th century"]` and `subjects: ["Fiction"]`.
    - The search doc has `author_name: ["Arthur Conan Doyle"]`.
    - Assert `details.subjects` deep-equals `{person:["Sherlock Holmes","Dr. Watson"],place:["London"],time:["19th century"]}`.
    - Update the existing whole-object `deepEqual`s (test at line 26 and others) to include `subjects: {person:[],place:[],time:[]}`.
  - In `booksService.test.ts`:
    - `details with subjects replace the work's subjects`: a `recordingCatalog` returns `subjects: {person:["A B","C D","E F"],place:[],time:[]}`. Assert via `rowsOf(h, "work_subjects", workId)`. Then return `{person:[],place:[],time:[]}` and assert zero rows.
    - `details without subjects leave stored subjects alone`: pre-write rows, return details with no `subjects` key, and assert the rows are unchanged.
    - `a null details result touches nothing`.
    - Cover both the found branch and the details-missing branch (details with only `workKey`).

- [ ] **Step 2: Run to verify failure**
  Run: `cd backend && npx tsx --test src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts src/modules/books/booksService.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - In `fetchDetails`, build `subjects` with `cleanWorkSubjects`:
    - `people`, `places`, `times` and `subjects` come from the work record. Fall back to `match.subject` for `subjects`, as `subjectsOf` does.
    - `authors` comes from `match.author_name`.
  - In `lookupDetails`, next to each `storeSeries` call: when `details.subjects` is present and the book has a `work_id`, call `replaceWorkSubjects` inside the same `deps.repo.transaction` as `storeSeries`.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Typecheck and commit**
  ```bash
  git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts backend/src/modules/books/booksService.ts backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts backend/src/modules/books/booksService.test.ts
  git commit -m "Store Open Library characters during the details lookup"
  ```

### Task 4: Batched backfill script and runbook

**Files:**
- Modify: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts`
- Create: `backend/src/modules/books/seed/charactersFill.ts`
- Test: `backend/src/modules/books/seed/charactersFill.test.ts`
- Test: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
- Create: `backend/scripts/fill-characters.mjs`
- Modify: `backend/README.md`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `cleanWorkSubjects` and `CleanedSubjects` (Task 1); `replaceWorkSubjects` and `worksWithOpenLibraryKey` (Task 2).
- Produces:
  - `fetchOpenLibrarySubjects(throttle: Throttle, keys: string[]): Promise<Map<string, CleanedSubjects>>`.
    - Keys are the bare `OL…W` form, at most 100.
    - Query: `search.json` with `q=key:(/works/K1 OR /works/K2 …)`, `fields=key,author_name,person,place,time,subject`, `limit=100`.
    - Response keys are mapped back through `normalizeWorkKey`. Only returned docs are in the map.
    - Throws on a `null` or unreadable response.
  - `type CharactersReport = { works: number; returned: number; withPeople: number; quizReady: number; gatedOut: number; rows: { person: number; place: number; time: number }; sample: Array<{ key: string; people: string[] }> }`
  - `fillCharacters(repo: BooksRepository, fetchBatch: (keys: string[]) => Promise<Map<string, CleanedSubjects>>, at: string, options: { dryRun: boolean; log: (line: string) => void }): Promise<CharactersReport>`.
    - Batches of 100.
    - One `repo.transaction` per batch, skipped on a dry run.
    - `sample` holds the first 20 works with people, showing their first 5.

- [ ] **Step 1: Write failing tests**
  - In `openLibraryCatalog.test.ts`: `subjects batch maps docs back to bare keys`:
    - The stubbed response has docs for `/works/OL66554W` (people + `subject: ["Fiction"]`) and `/works/OL47181W` (dated people + `subject: ["History"]`). Request keys are `["OL66554W","OL47181W","OL1W"]`.
    - Assert the requested URL's `q` equals `key:(/works/OL66554W OR /works/OL47181W OR /works/OL1W)`.
    - Assert the map has 2 entries, `OL1W` is absent, and `OL47181W` has `gatedOut === true`.
  - In `charactersFill.test.ts` (in-memory DB via `applyBooksMigrations`, as in `awardsFill.test.ts:36-39`):
    - `dry run writes nothing and counts`: three keyed works. A fake `fetchBatch` returns one with 3 people, one gated, and omits the third. Assert the report is `{works:3, returned:2, withPeople:1, quizReady:1, gatedOut:1}` with `rows.person === 3`, and the `work_subjects` count is 0.
    - `apply replaces returned works and keeps missing ones`: pre-write rows for the omitted work. After apply, its rows are unchanged and the returned work's rows match.
    - `batches are 100 keys`: 250 works give `fetchBatch` call sizes `[100,100,50]`.
    - `a failing batch rejects after earlier batches are written`.

- [ ] **Step 2: Run to verify failure**
  Run: `cd backend && npx tsx --test src/modules/books/seed/charactersFill.test.ts src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** `fetchOpenLibrarySubjects` (use `fetchJson("openlibrary", url)` through the throttle) and `fillCharacters`.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Write `backend/scripts/fill-characters.mjs`** as a thin wrapper, cloned from `fill-awards.mjs`:
  - `parseArgs` with `--dry-run` only.
  - The `fail()` helper, and the `COVERS_DB_PATH` check.
  - Dynamic imports from `../dist/...`.
  - A read-only `DatabaseSync` on a dry run, otherwise `openBooksDb()`, wrapped in `waitForBnpLock`.
  - `createThrottle(1000)` from `adapters/http/http.js`.
  - Prints `JSON.stringify({ dryRun, ...report }, null, 2)` to stdout.
  - Any rejection goes to `fail(error.message)`, which exits 1.
  Then run `npm run build --workspace backend` and confirm `node backend/scripts/fill-characters.mjs --bogus` prints the usage line and exits 1.

- [ ] **Step 6: Add a `#### Book characters` section to `backend/README.md`** between the awards section and `#### Known limitations of covers…` (around line 654). It covers:
  - What the script does (cleanup rules in one line each, a reference to the spec)
  - Replace semantics, and the missing-key rule
  - The two runbook commands, in the awards section's format:
    - `railway ssh … "cd /app/backend && setsid node scripts/fill-characters.mjs --dry-run > /data/fill-characters-dry.json 2> /data/fill-characters-dry.log"`
    - the same without `--dry-run` writing `/data/fill-characters.json`
  - "Read `quizReady` from the dry run."
  - "Re-run after large imports."

- [ ] **Step 7: Add the test file to `backend/package.json`, typecheck, commit**
  ```bash
  git add backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts backend/src/modules/books/seed/charactersFill.ts backend/src/modules/books/seed/charactersFill.test.ts backend/scripts/fill-characters.mjs backend/README.md backend/package.json
  git commit -m "Add the batched Open Library characters backfill"
  ```

### Task 5: Characters on the work page and `POST /works/characters`

**Files:**
- Modify: `backend/src/modules/books/works.ts`
- Modify: `backend/src/modules/books/index.ts`
- Modify: `backend/src/modules/works/service.ts`
- Modify: `backend/src/modules/works/routes.ts`
- Modify: `backend/src/modules/works/plugin.ts`
- Modify: `backend/src/app.ts`
- Modify: `packages/shared/src/works/types.ts`
- Modify: `packages/shared/src/works/api.ts`
- Test: `backend/src/modules/works/routes.test.ts`
- Test: `backend/src/modules/works/service.test.ts`
- Test: `packages/shared/src/works/api.test.ts`

**Interfaces:**
- Consumes: `charactersOf` (Task 2).
- Produces:
  - `CatalogWorkPage.characters: string[]`, and `WorkPage.work.characters?: string[]` (shared).
  - `WorksDeps.charactersOf(workIds: string[]): Map<string, string[]>`.
  - `WorksService.characters(workIds: string[]): Record<string, string[]>` returns the first 3 names, only for lists of length ≥ 3, keyed by the ids given.
  - Route: `POST /works/characters`, body `{ workIds: string[] }` (zod: non-empty strings, `.max(500)`). It responds `200 { characters }`, or `400` over the cap or on a malformed body. Auth is optional, and the `Cache-Control: no-store` header matches `GET /works/:id`.
  - Shared: `createWorksApi(...).fetchWorkCharacters(workIds: string[]): Promise<{ characters: Record<string, string[]> }>`, a `POST` to `/works/characters` with `auth: "optional"`.

- [ ] **Step 1: Write failing tests**
  - `works/service.test.ts`: `characters keeps only quiz-ready works, first three names`. The fake `charactersOf` returns `{a:["1 1","2 2","3 3","4 4"], b:["1 1","2 2"]}`. Assert `{a:["1 1","2 2","3 3"]}`. Also assert `getPage` passes `characters` through.
  - `works/routes.test.ts`:
    - `characters route answers by given id` (via `app.inject`)
    - `characters route rejects 501 ids with 400`
    - `characters route needs no token`
    - Extend `appWith` with a `characters` stub.
  - `packages/shared/src/works/api.test.ts`: `fetchWorkCharacters posts the ids`. Assert the path, the method, `body: { workIds }` and `auth: "optional"`.
  - Pin Review Focus 4 at the route: a merged-away id, given a `charactersOf` stub keyed by given ids, comes back under that id.

- [ ] **Step 2: Run to verify failure**
  Run: `cd backend && npx tsx --test src/modules/works/service.test.ts src/modules/works/routes.test.ts` and `npm test --workspace @scripta/shared`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Add `characters: books.charactersOf([rows.work.id]).get(rows.work.id) ?? []` in `getWorkPageWith`.
  - Export a `getWorkCharacters` reader from `books/index.ts`.
  - Thread it through `app.ts` → `WorksDeps`.
  - `getPage` copies `characters` into `work`.
  - Add the route, then the shared API method.

- [ ] **Step 4: Run to verify pass.** Run `npm run build --workspace @scripta/shared` first, then the same commands. Expected: PASS.

- [ ] **Step 5: Typecheck both packages and commit**
  ```bash
  git add backend/src/modules/books/works.ts backend/src/modules/books/index.ts backend/src/modules/works/service.ts backend/src/modules/works/routes.ts backend/src/modules/works/plugin.ts backend/src/app.ts backend/src/modules/works/routes.test.ts backend/src/modules/works/service.test.ts packages/shared/src/works/types.ts packages/shared/src/works/api.ts packages/shared/src/works/api.test.ts
  git commit -m "Serve work characters on the work page and a batch route"
  ```

### Task 6: Shared quiz type, draw rule and preview

**Files:**
- Modify: `packages/shared/src/quizzes/types.ts`
- Modify: `packages/shared/src/quizzes/draw.ts`
- Modify: `packages/shared/src/quizzes/preview.ts`
- Test: `packages/shared/src/quizzes/draw.test.ts`
- Test: `packages/shared/src/quizzes/preview.test.ts`

**Interfaces:**
- Produces:
  - `QUIZ_QUESTION_TYPES` gains `"characters_title"` as the last entry.
  - `QuizBookContent.characters?: string[] | null`. That makes it present on `QuizBook` and `QuizBookInput` too.
  - `QUIZ_MIN_CHARACTERS = 3`
  - `characterPrompt(characters: readonly string[]): string` returns the first 3 joined with `" · "`. It is exported from the quizzes entry point and used by `preview.ts` and the backend.
  - `eligibleTypes` adds `"characters_title"` when `(book.characters?.length ?? 0) >= QUIZ_MIN_CHARACTERS`.

- [ ] **Step 1: Write failing tests**
  - `draw.test.ts`:
    - `a book with three characters is eligible for characters_title`
    - `two names are not enough`
    - `characters_title never offers a book that shares a prompt name`:
      - Two books share `["Harry Potter","Ron Weasley","Hermione Granger"]`. Four other books have disjoint casts. `allowedTypes: ["characters_title"]`, `questionCount: 2`, several seeds.
      - For every question whose answer book is a Potter book, assert the other Potter title is not among the `options`.
    - `characters_title is skipped when fewer than three clean distractors remain`:
      - Four books all share one name. Assert zero questions are generated for `allowedTypes: ["characters_title"]`.
    - The name comparison is lowercase-trimmed. A distractor listing `" harry potter "` counts as sharing.
  - `preview.test.ts`: `characters preview is the first three names`. Assert `prompt === "A · B · C"` for characters `["A","B","C","D"]`.

- [ ] **Step 2: Run to verify failure**
  Run: `npm test --workspace @scripta/shared`
  Expected: FAIL.

- [ ] **Step 3: Implement.** In `generateQuizQuestions`, when `type === "characters_title"`, the candidate loop also skips any candidate whose `characters` include one of the prompt's three names (lowercase-trimmed set). The existing `distractors.length < 3` → `continue` handles the rest.

- [ ] **Step 4: Run to verify pass, build, commit**
  Run: `npm test --workspace @scripta/shared && npm run build --workspace @scripta/shared`
  ```bash
  git add packages/shared/src/quizzes/types.ts packages/shared/src/quizzes/draw.ts packages/shared/src/quizzes/preview.ts packages/shared/src/quizzes/draw.test.ts packages/shared/src/quizzes/preview.test.ts
  git commit -m "Add the characters quiz question type to the shared draw"
  ```
  Add `characterPrompt` and `QUIZ_MIN_CHARACTERS` to `packages/shared/src/quizzes/index.ts` exports, and stage that file in the same commit.

### Task 7: Backend quiz publish fills and freezes characters

**Files:**
- Modify: `backend/src/modules/quizzes/domain/ports.ts`
- Modify: `backend/src/modules/quizzes/plugin.ts`
- Modify: `backend/src/modules/quizzes/service.ts`
- Modify: `backend/src/modules/quizzes/routes.ts`
- Test: `backend/src/modules/quizzes/service.test.ts`
- Test: `backend/src/modules/quizzes/routes.test.ts`

**Interfaces:**
- Consumes: `charactersOf` (Task 2, sourced from the books module in `quizzes/plugin.ts:21`), and `characterPrompt` and `"characters_title"` (Task 6).
- Produces: `QuizWorks.charactersOf(workIds: string[]): Map<string, string[]>`.

- [ ] **Step 1: Write failing tests**
  - `service.test.ts` (extend `fakeWorks` at line 12 with a `charactersOf` map):
    - `publish fills characters from the catalog and freezes them`:
      - Books are created with `characters: ["Fake A","Fake B","Fake C"]`, and the catalog returns different names.
      - Assert the published `data.books[i].characters` equals the catalog's.
      - Changing the fake afterwards does not change `getPlay`/public question prompts.
    - `public characters question prompt is the joined first three` asserts `prompt === "Elizabeth Bennet · Fitzwilliam Darcy · Charlotte Lucas"`.
    - `publish error names characters` asserts the exact new error string for `allowedTypes: ["characters_title"]` with too few ready books.
  - `routes.test.ts`:
    - `allowedTypes accepts characters_title`
    - `omitted allowedTypes still defaults to the four original types`
    - `a client-sent characters field is stripped`, asserting the stored quiz data has no client `characters` before publish

- [ ] **Step 2: Run to verify failure**
  Run: `cd backend && npx tsx --test src/modules/quizzes/service.test.ts src/modules/quizzes/routes.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `publishQuiz` (`service.ts:246-276`): after the work dedupe, call `works.charactersOf(doc.books.map(b => b.workId))`. Set each book's `characters` to the result or `null` in the same `books` map that fills covers.
  - `toPublicQuestion`: `characters_title` → `characterPrompt(book?.characters ?? [])`.
  - Route zod: add the enum value, keeping the omitted default at the four original types. Make sure `quizBookSchema` doesn't carry `characters`.
  - Replace the error string with the new one.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Typecheck and commit**
  ```bash
  git add backend/src/modules/quizzes/domain/ports.ts backend/src/modules/quizzes/plugin.ts backend/src/modules/quizzes/service.ts backend/src/modules/quizzes/routes.ts backend/src/modules/quizzes/service.test.ts backend/src/modules/quizzes/routes.test.ts
  git commit -m "Fill quiz characters from the catalog at publish"
  ```

### Task 8: Book screen characters line (shared model, web, mobile)

**Files:**
- Modify: `packages/shared/src/works/bookScreen.ts`
- Test: `packages/shared/src/works/bookScreen.test.ts`
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Test: `frontend/scripts/test-work-page.mts`
- Modify: `mobile/src/features/works/BookScreen.tsx`

**Interfaces:**
- Consumes: `WorkPage.work.characters` (Task 5).
- Produces:
  - `BookScreenModel.characters: { shown: string[]; more: string[] }`. `shown` is the first 8, `more` is the rest, and both are empty when there are none.
  - `CHARACTERS_SHOWN = 8`.

- [ ] **Step 1: Write failing tests**
  - `bookScreen.test.ts`:
    - `characters split after eight`: 11 names give `shown.length === 8` and `more.length === 3`.
    - `a page without characters has none`: `characters` absent gives `{shown:[],more:[]}`.
  - `test-work-page.mts`:
    - A page with 10 characters renders "Characters", the first 8 names and "+2 more".
    - A page without characters doesn't render "Characters".

- [ ] **Step 2: Run to verify failure**
  Run: `npm test --workspace @scripta/shared` and `npm test --workspace frontend`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Build the model field in `bookScreen.ts`.
  - Web, after the awards `<ul>` (`BookScreen.tsx:204-214`): a `text-xs text-(--color-text-dim)` line reading "Characters: " + `shown.join(", ")`, plus a "+N more" button that expands `more` inline. Check `DESIGN.md` for tokens.
  - Mobile, after the awards block (`BookScreen.tsx:179-189`): the same, with `typography.caption` / `colors.textDim` and a `Pressable` for "+N more".

- [ ] **Step 4: Run to verify pass, typecheck and lint**
  Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm test --workspace frontend && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm run typecheck --workspace mobile && npm test --workspace mobile`
  Expected: all pass.

- [ ] **Step 5: Commit**
  ```bash
  git add packages/shared/src/works/bookScreen.ts packages/shared/src/works/bookScreen.test.ts frontend/src/components/book/BookScreen.tsx frontend/scripts/test-work-page.mts mobile/src/features/works/BookScreen.tsx
  git commit -m "Show characters on the book screen"
  ```

### Task 9: Web quiz screens

**Files:**
- Modify: `frontend/src/pages/QuizCreatePage.tsx`
- Modify: `frontend/src/pages/QuizEditorPage.tsx`
- Modify: `frontend/src/pages/PlayQuizPage.tsx`
- Test: `frontend/scripts/test-quiz-play-stage.mts`

**Interfaces:**
- Consumes: `fetchWorkCharacters` (Task 5), and `"characters_title"` and `eligibleTypes` (Task 6).

- [ ] **Step 1: Write failing test** in `test-quiz-play-stage.mts`: a `characters_title` question renders the caption "Who's in this book?" and the prompt text `A · B · C` without the quotation-mark wrapper used for quotes.

- [ ] **Step 2: Run to verify failure**
  Run: `npm test --workspace frontend`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `TYPE_LABELS` get the two exact labels (create: "Guess the book from its characters"; editor: "Characters → title").
  - Create page:
    - An effect keyed on the chosen books' work ids calls `fetchWorkCharacters`, and sets `characters` on matching books before `availableTypes` is computed.
    - On failure, show the note "Characters couldn't be checked" and leave `characters` unset.
  - Play page: a `characters_title` branch in the prompt renderer (`PlayQuizPage.tsx:33-40`).

- [ ] **Step 4: Run to verify pass, typecheck and lint**
  Run: `npm test --workspace frontend && npm run typecheck --workspace frontend && npm run lint --workspace frontend`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add frontend/src/pages/QuizCreatePage.tsx frontend/src/pages/QuizEditorPage.tsx frontend/src/pages/PlayQuizPage.tsx frontend/scripts/test-quiz-play-stage.mts
  git commit -m "Offer and play character questions on the web"
  ```

### Task 10: Mobile quiz screens and discover clue

**Files:**
- Modify: `mobile/src/features/quizzes/QuizCreateScreen.tsx`
- Modify: `mobile/src/features/quizzes/QuizEditorScreen.tsx`
- Modify: `mobile/src/features/quizzes/QuizPlayScreen.tsx`
- Modify: `mobile/src/features/community/DiscoverRow.tsx`
- Modify: `packages/shared/src/quizzes/labels.ts`
- Test: `packages/shared/src/quizzes/labels.test.ts`

**Interfaces:**
- Consumes: `fetchWorkCharacters` (Task 5, via `mobile/src/features/works/api.ts`) and `"characters_title"` (Task 6).
- Produces: `quizClueHeading(type: QuizQuestionType): string` in `labels.ts`. It returns "Which book has these characters?" for `characters_title`, "Which cover belongs to this title?" for `title_cover`, and the current default text otherwise. That moves the existing ternary at `DiscoverRow.tsx:124-125` into shared, so it can be tested.

- [ ] **Step 1: Write failing test** in `labels.test.ts`: `quizClueHeading` returns the three strings above for `characters_title`, `title_cover` and `quote_title`. Copy `quote_title`'s expected value from `DiscoverRow.tsx:125`'s current default branch.

- [ ] **Step 2: Run to verify failure**
  Run: `npm test --workspace @scripta/shared`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `quizClueHeading`, used by `DiscoverRow`. The icon for `characters_title` is `"quote"`, unchanged.
  - Mobile `TYPE_LABELS` (create and editor) get the exact labels.
  - The create screen fetches characters on chosen-book change, as on the web, with the failure note beside the existing cover note (`QuizCreateScreen.tsx:161`).
  - `Prompt` (`QuizPlayScreen.tsx:144-153`) gets a `characters_title` branch: the "Who's in this book?" caption above the plain prompt text, with no quotation marks.

- [ ] **Step 4: Run to verify pass and typecheck**
  Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add mobile/src/features/quizzes/QuizCreateScreen.tsx mobile/src/features/quizzes/QuizEditorScreen.tsx mobile/src/features/quizzes/QuizPlayScreen.tsx mobile/src/features/community/DiscoverRow.tsx packages/shared/src/quizzes/labels.ts packages/shared/src/quizzes/labels.test.ts
  git commit -m "Offer and play character questions on mobile"
  ```

- [ ] **Step 6: Device pass (gates merge, not the PR).** Dispatch `device-checker` for:
  - the book screen of a fixture book with characters (line, "+N more" expand)
  - quiz create (the characters type offered)
  - a `characters_title` question in play

  Before dispatching, the main session builds the backend and runs `COVERS_DB_PATH=<dev slot's books DB> node backend/scripts/fill-characters.mjs` against the local dev DB (never production), so fixture works such as *The Hobbit* carry characters. Device-checkers never write the dev DB themselves.

## After the last task

- `node scripts/gate.mjs`, run on the combined change. The gate only sees uncommitted changes, so compute the Verify commands from `origin/main...HEAD`.
- `branch-reviewer` with the spec and this plan, and `node scripts/codex-review.mjs branch docs/superpowers/specs/2026-10-25-book-characters-design.md docs/superpowers/plans/2026-10-25-book-characters.md`, in parallel.
- Open the PR with auto-merge. Hand the user one runbook entry for the next batch deploy:
  - deploy
  - `fill-characters.mjs --dry-run`
  - report `quizReady`
  - apply
  - manual OTA for phones (EAS CI minutes are out until 11-01)
