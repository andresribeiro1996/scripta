# Held Originals Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For translated works on readers' shelves whose original is not in the catalog, find the original on Open Library, add it, and let the translation job's free code step join them. The #317 guards hold throughout.

**Architecture:** A fill module, `seed/originalsFill.ts`:
1. It selects held Portuguese works that are unjudged or answered "none" (never `manual`).
2. It skips series-like originals (Guard 1), volume titles (Guard 2) and works without an author. Works whose original is already in the catalog aren't looked up.
3. It groups the rest by original key plus surname, drops groups whose shelved works carry different titles, and asks Open Library once per group, through a new fielded search function.
4. It adds each found original with `seedBook`. Then it runs `runCodeSteps` on the works it served and on the works whose original was already present.

A script, `backend/scripts/fetch-originals.mjs`, runs it with `--dry-run` first.

**Tech Stack:** Fastify/TypeScript backend, SQLite (`node:sqlite`), `@scripta/shared` (from `dist`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-21-held-originals-lookup-design.md`

## Global Constraints

- **No comments in code** (root `AGENTS.md`).
- **Before backend typecheck or tests,** run `npm run build --workspace @scripta/shared`.
- **New test files** go in `backend/package.json`'s explicit `test` list.
- **Don't edit `backend/src/modules/books/domain/translation.ts` or `fillOriginalTitlesFromSummaries`.** Another session is fixing `originalTitleIn` there, and a conflict would block both PRs. Import from them, don't change them.
- **Reuse, don't copy:**
  - From `domain/translation.ts`: `evidenceOf`, `seriesLikeOriginals`, `originalKey`, `mainTitle`, `sameMainTitle`, `hasVolumeMarker`, `titlePattern`, `surnameOf`, `mentionsSurname`.
  - `firstAuthor`, `normalizeTitle`, `normalizeWords`, `titleNumbers` from `@scripta/shared`.
  - `normalizeWorkKey` from `domain/normalize.ts`.
  - `runCodeSteps` and `TranslationDeps` from `translationBacklog.ts` / `translationJudgments.ts`.
  - `seedBook` from `seed/seedCatalog.ts`.
  - `JEV_REJECTION_LIMIT` from `synopsisJudgments.ts`.
  - `fetchJson`, `createThrottle`, `Throttle` from `adapters/http/http.ts`.
  - `SourceUnavailableError` from `domain/errors.ts`.
- **No ISBNdb and no TypeSafe calls.** The module and the script never call an ISBNdb or TypeSafe adapter. `runCodeSteps` imports TypeSafe types indirectly, which is fine: `classify` is a stub that rejects, and the code step never calls it.
- **Backend tests need the env preamble.** Set the env vars, then import `connection.ts` dynamically, as `translationJudgments.test.ts:8-32` does. Copy its `freshRepo` and `edition` helpers into the new test file; they are file-private there.
- **Commits end with** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Guards run before any lookup.** Guard 1 is called exactly as `planMatch` calls it: `seriesLike(original, evidence.workAuthor || evidence.author)`, with the rule built once per run from `repo.originalTitleClaims()`. Guard 2 checks both the edition title and the original title. A skipped work never reaches `search`.
- **`manual` answers are never selected.** Selection is `portugueseWorksNeedingMatch(heldCanonical, Number.MAX_SAFE_INTEGER, JEV_REJECTION_LIMIT, nowIso)`, which already excludes them.
- **The dry run writes nothing:** no `seedBook`, no `runCodeSteps` (which calls `fillOriginalTitlesFromSummaries`). The script also opens the database read-only for it.
- **The pick rule guarantees the code step finds and accepts the new row.**
  - The found title's `normalizeTitle` and `titleNumbers` equal those of `mainTitle(original)`, so the new row's `title_key` matches `titlePattern(original)`.
  - The stored author is the Open Library name whose `surnameOf` the Portuguese work's own author fields mention, and `planMatch` checks exactly that after the insert.
  - `sameMainTitle` alone isn't enough: it cuts at `". "`, so "Mrs. Dalloway's Party" would pass for "Mrs. Dalloway".
- **A re-run heals a killed run.** In a real run, `present` works go to `runCodeSteps` as well.
- **The new book has no ISBN and no language**, `created_by` `seed`, and `ol_work_key` set to the Open Library work key.

### Task 1: Open Library work search and the fill module

**Files:**
- Modify: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts`
- Test: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
- Create: `backend/src/modules/books/seed/originalsFill.ts`
- Test: `backend/src/modules/books/seed/originalsFill.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- **`openLibraryCatalog.ts`:**
  - `export type OpenLibraryWork = { key: string; title: string; authors: string[] };`
  - `export async function searchOpenLibraryWorks(throttle: Throttle, title: string, author: string): Promise<OpenLibraryWork[]>`.
    - It sends one request through `throttle` to `https://openlibrary.org/search.json?` with params `title`, `author`, `fields=key,title,author_name` and `limit=10`, using `fetchJson("openlibrary", url)`.
    - It keeps docs whose `key` matches `/^\/works\/OL\d+W$/` and whose `title` is a non-empty string. `authors` holds the string entries of `author_name`, or `[]`.
    - Not an object, or no `docs` array (a 404 gives `null`): it returns `[]`.
    - Errors propagate, so a 429 or 5xx throws `SourceUnavailableError` with its `status`.
- **`seed/originalsFill.ts`:**
  - `export type FoundOriginal = { key: string; title: string; author: string };`
  - `export function pickOriginal(works: OpenLibraryWork[], originalTitle: string, authorTexts: string[]): FoundOriginal | null`. It returns the first work, in Open Library's order, where:
    - `normalizeWords`, `normalizeTitle` and `titleNumbers` of `work.title` each equal those of `mainTitle(originalTitle)`, using the whole found title. `title_key` is built from that (`catalogTitleKey`, `domain/normalize.ts`), and `normalizeWords` keeps a colon subtitle that `normalizeTitle` drops;
    - `hasVolumeMarker(work.title)` is false;
    - some name in `work.authors` has a non-null `surnameOf(name)` that `mentionsSurname(authorTexts, surname)` finds.

    The result is `{ key, title: work.title, author: <that name> }`.
  - `export type OriginalsReport` has:
    - **Counts:** `held`, `selected`, `noOriginal`, `seriesLike`, `volume`, `present`, `noAuthor`, `sharedOriginal`, `lookups`, `found`, `notFound`, `added`, `existing`, `codeMerges`, `codeBlocked`, `noCandidates`.
    - **`failed: string[]`:** original titles whose lookup hit a `SourceUnavailableError` other than a 429, such as a 5xx or a timeout with no `status`.
    - **`ask: string[]`:** work ids `runCodeSteps` left for Jev.
    - **`originals`:** `Array<{ originalTitle: string; author: string; works: Array<{ workId: string; title: string }>; found: FoundOriginal | null }>`.
  - `export async function fillOriginals(deps: TranslationDeps & { search: (title: string, author: string) => Promise<OpenLibraryWork[]>; log: (line: string) => void }, heldWorkIds: string[], { dryRun }: { dryRun: boolean }): Promise<OriginalsReport>`.
    1. `held` is the number of distinct canonical held ids, from `repo.canonicalWorkIds(heldWorkIds)`.
    2. `works = repo.portugueseWorksNeedingMatch([...held], Number.MAX_SAFE_INTEGER, JEV_REJECTION_LIMIT, new Date(deps.now()).toISOString())`; `selected` is `works.length`.
    3. `seriesLike = seriesLikeOriginals(repo.originalTitleClaims())`, built once.
    4. For each work, `evidence = evidenceOf(repo.translationEvidence(id))` (skip the work if `translationEvidence` is undefined), with `original = evidence.originalTitle` and `author = evidence.workAuthor || evidence.author`. Count the first rule that matches, then move on:
       - `noOriginal`: `!original`, `originalKey(original) === null`, or `sameMainTitle(original, evidence.title)`;
       - `seriesLike`: `seriesLike(original, author)`;
       - `volume`: `hasVolumeMarker(evidence.title) || hasVolumeMarker(original)`;
       - `present`: `titlePattern(original)` gives candidates from `repo.titleCandidates(pattern)` other than the work itself. These ids are kept for step 8;
       - `noAuthor`: `surnameOf(author) === null`.
    5. Remaining works are grouped by `${originalKey(original)}#${surnameOf(author)}`. Each group keeps:
       - `originalTitle: mainTitle(original)` and `author: firstAuthor(author)` from its first work;
       - its `works` (id plus `evidence.title`);
       - `authorTexts`: every `evidence.workAuthor` and `evidence.author` of its works.

       A group is dropped, and its works count in `sharedOriginal`, when two or more distinct Portuguese main titles in the whole catalog claim it. These are two different books naming one original: a series name below Guard 1's threshold, or two re-translations.
       - Count it once per run from `repo.originalTitleClaims()`, the way Guard 1's grouping does: Portuguese claims only (`isPortuguese`), leaving out claims where `sameMainTitle(title, originalTitle)` is true.
       - The key is `${originalKey(originalTitle)}#${surnameOf(author)}`, and the value is the set of distinct `originalKey(title)`.

       `lookups` is the number of groups left.
    6. Groups are processed in order, with `found = pickOriginal(await deps.search(group.originalTitle, group.author), group.originalTitle, group.authorTexts)`.
       - A `SourceUnavailableError` whose `status` is not 429 pushes `originalTitle` to `failed` and continues. Any other error, a 429 included, propagates.
       - `found` or `notFound` counts the outcome.
       - Every 10 groups, `deps.log(JSON.stringify({ looked, of, found }))`.
    7. Without `dryRun`, for each found group: `seedBook({ isbn: "", title: found.title, author: found.author, workKey: found.key }, repo, () => new Date(deps.now()), "seed")`.
       - `created` counts `added`.
       - `existing` counts `existing`. It happens when the server added the same title between the `present` check and the insert.
       - `invalid` throws an `Error` naming the title. The pick rule guarantees a title and an author, so it can't happen.

       The group's work ids are collected.
    8. Without `dryRun`, call `runCodeSteps(deps, ids)` on the collected ids plus the `present` works, when that list isn't empty. Copy `codeMerges`, `codeBlocked`, `noCandidates` and `ask` into the report.
       - The `present` works make a re-run finish a killed one: an original added just before the kill is `present` next time, and its works still carry their old "none".
       - A `present` work's plan is `code` or `ask`, never `none`, because it has a title candidate.
    9. `originals` lists every group in order, with `found` (null when not found or failed).
- **`backend/package.json`:** add `src/modules/books/seed/originalsFill.test.ts` to the `test` list, next to `src/modules/books/seed/seriesFill.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - **`openLibraryCatalog.test.ts`**, using its `respond` helper and `direct` throttle. `searchOpenLibraryWorks(direct, "To the Lighthouse", "virginia woolf")`:
    - requests a URL with `title=To+the+Lighthouse`, `author=virginia+woolf`, `fields=key%2Ctitle%2Cauthor_name` and `limit=10`;
    - maps `{ docs: [{ key: "/works/OL1W", title: "To the Lighthouse", author_name: ["Virginia Woolf"] }, { key: "/books/OL2M", title: "x" }, { key: "/works/OL3W" }] }` to the first doc only;
    - returns `[]` for `{}`.
  - **`originalsFill.test.ts`**: a fresh repo per test and a fake `search` that records its calls and answers from a map. `deps` has:
    - `classify`: rejects;
    - `sharesArena`: `() => false`;
    - `now`: fixed;
    - `alert` and `log`: no-ops.

    Use pt-PT editions, with `originalTitle` set through the copied `edition` helper. Tests:
    1. **Missing original, real run:** a held "Passeio ao Farol" by "Virginia Woolf", original "To the Lighthouse", and search answering `[{ key: "/works/OL930W", title: "To the Lighthouse", authors: ["Virginia Woolf"] }]`. The report has `lookups` 1, `found` 1, `added` 1 and `codeMerges` 1. `canonicalWorkIds` maps the pt work to the new book's work. The new book has `isbn` null, `language` null, `created_by` `seed` and `ol_work_key` `OL930W` (`normalizeWorkKey` strips `/works/`). Search was called once with `("To the Lighthouse", "virginia woolf")`.
    2. **Same fixture, dry run:** search is called and `originals[0].found` is set. But `added` and `codeMerges` are 0, the catalog has no new book, and the pt work is still its own canonical work.
    3. **Guard 1:** three pt works with distinct titles each claiming "Princess Poppy" by Janey Louise Jones, one of them held. `seriesLike` is 1, `lookups` 0, and search is never called.
    4. **Guard 2:** a held "Os Pilares da Terra, Vol. 1" (original "The Pillars of the Earth") and a held "O Encontro" (original "The Meeting, Book 2"). `volume` is 2, and search is never called.
    5. **Present:** the English "To the Lighthouse" by Virginia Woolf is already in the catalog. `present` is 1, and search is never called.
    6. **Judgments:** a held work with a saved `manual` none is not selected. A held work with a saved `code` none is selected, joined, and its judgment now has `intoWorkId` set. Save both judgments with an `askedAt` before `now`, or the recheck date doesn't reopen them (`sqliteBooksRepository.ts:173`).
    7. **Not held:** a pt work missing its original but not in `heldWorkIds` is not selected.
    8. **Pick rule:** search answers, in order:
       - a wrong title;
       - the right title by "Leonard Woolfe";
       - "To the Lighthouse (Book 1)", which has the same normalized title but a volume marker;
       - "To the Lighthouse - A Novel", which has the same main title but a different whole title;
       - the right one.

       The last is picked. With only the first four, `notFound` is 1, `added` is 0 and `originals[0].found` is null.
    9. **Two copies of one translation:** two held works whose editions are both "Passeio ao Farol", given different `workKey`s so they stay separate works, both with original "To the Lighthouse". `lookups` is 1, search is called once, and both works are joined into the new work.
    10. **Shared original:** two held works with different titles ("Passeio ao Farol" and "Rumo ao Farol"), both with original "To the Lighthouse". `sharedOriginal` is 2, `lookups` is 0, and search is never called.
    11. **Unavailable:** search throws `new SourceUnavailableError("openlibrary", "503", { status: 503 })` for the first of three groups, and `new SourceUnavailableError("openlibrary", "timeout")` (no status) for the second. Both titles are in `failed`, and the third group is still found and added. A `{ status: 429 }` error makes `fillOriginals` reject.
    12. **No original:** held works with no original title, with the original ":", and with an original equal to their own title each count in `noOriginal`. A held work whose author is empty counts in `noAuthor`. Search is never called.
    13. **Re-run after a kill:** the English original is already in the catalog, and the held work has an old `code` none. A real run counts it in `present`, makes no lookup, and joins it (`codeMerges` 1). The dry run of the same fixture joins nothing.
    14. **Race with the server:** the fake search inserts the English "To the Lighthouse" by Virginia Woolf into the repo before answering, with `repo.createBook({ title: "To the Lighthouse", author: "Virginia Woolf", isbn: null }, [catalogTitleKey("To the Lighthouse", "Virginia Woolf")!], AT)`. The title key has to be registered, because `seedBook` looks the new row up by it. The real run counts `existing` 1 and `added` 0, and still joins the work.
    15. **Same Open Library work as the translation:** the pt work's edition has `workKey` `OL930W`, and search answers `/works/OL930W`. The new book lands in the pt work itself (its `work_id` is the pt work), `added` is 1, `codeMerges` 0 and `noCandidates` 1.
    16. **`pickOriginal` unit:** an author named only "Anonymous", whose surname the texts don't mention, gives null. "Mrs. Dalloway's Party" for the original "Mrs. Dalloway" gives null.
- [ ] **Step 2: Run them and watch them fail.** Run `npm run build --workspace @scripta/shared && npx tsx --test backend/src/modules/books/seed/originalsFill.test.ts backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts` from the repo root (or the `backend` equivalent). Expected: they fail because the new exports are missing.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: all pass.
- [ ] **Step 5: Commit.** Message: `Fetch missing originals of shelved translations from Open Library`. The body says why:
  - shelved translations whose original was never in the catalog stand alone;
  - both #317 guards run before any lookup, because a fetched series name would recreate the collapses undone on 2026-10-20;
  - no ISBN is stored, because a search doc's `isbn` list mixes every edition and language.

### Task 2: The script and its runbook

**Files:**
- Create: `backend/scripts/fetch-originals.mjs`
- Modify: `backend/README.md`

**Interfaces:**
- **`backend/scripts/fetch-originals.mjs [--dry-run]`**, modelled on `translation-backlog.mjs` and `fill-series.mjs`:
  - `parseArgs` takes only `--dry-run` (boolean); anything else prints `Usage: node scripts/fetch-originals.mjs [--dry-run]` and exits 1.
  - `COVERS_DB_PATH`, `LIBRARY_DB_PATH` and `ARENA_DB_PATH` are required, with the same message and exit as `translation-backlog.mjs`.
  - Dynamic imports from `../dist`: `createThrottle`, `searchOpenLibraryWorks`, `openBooksDb`, `createSqliteBooksRepository`, `waitForBnpLock`, `createSqliteArenaRepository`, `createWorkHolders`, `arenaCheck` and `fillOriginals`.
  - `const OPEN_LIBRARY_GAP_MS = 1000;`, then `const throttle = createThrottle(OPEN_LIBRARY_GAP_MS);` and `search = (title, author) => searchOpenLibraryWorks(throttle, title, author)`.
  - Database: `--dry-run` uses `new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true })`; otherwise `openBooksDb()`. Either way, it is wrapped in `waitForBnpLock` as `fill-series.mjs` does.
  - Library and arena databases are opened read-only. `held` comes from `heldWorks().map((work) => work.workId)`, and `sharesArena` from `arenaCheck(repo, (a, b) => arena.worksShareATournament(a, b))`.
  - `classify` rejects with `new Error("no Jev in the originals fill")`. `alert` writes to stderr. `log` is `console.error`. `now` is `Date.now`.
  - It prints `JSON.stringify({ dryRun, ...report }, null, 2)` to stdout.
- **`backend/README.md`:** a `#### Fetching missing originals` subsection right after "Translation backlog". It says:
  - **Purpose:** for held works only, it finds originals missing from the catalog on Open Library (one call per second, no ISBNdb, no TypeSafe), adds them as `seed` rows without ISBN or language, then runs the backlog's free code step on those works.
  - **When:** run it after the deploy that ships it, since scripts run from the deployed `dist`.
  - **What it skips, before any lookup:**
    - series-like originals (Guard 1) and volume titles (Guard 2);
    - originals already present, which go straight to the code step in a real run;
    - works without an author;
    - shelved works with different titles naming one original (`sharedOriginal`);
    - owner (`manual`) answers.
  - **Dry run first:** it writes nothing and makes the same lookups. Read `originals`: each Portuguese title, and the Open Library work it would add.
  - **Real run:** same command without `--dry-run`. Every join is listed under "Merged" on `/admin/translations`, where it can be undone.
    - It is safe to re-run.
    - A work listed in `ask` keeps its earlier answer. `translation-backlog.mjs --recheck-none` reaches it once that answer is 30 days old.
    - A deploy kills it, so hold production deploys while it runs.
  - **Report fields:** one line naming them.
  - **Commands:**

    ```bash
    npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/fetch-originals.mjs --dry-run' > originals-dry.json
    npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && setsid node scripts/fetch-originals.mjs > /data/fetch-originals.json 2> /data/fetch-originals.log < /dev/null & sleep 3; echo started'
    npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cat /data/fetch-originals.json; tail -n 3 /data/fetch-originals.log'
    ```

- [ ] **Step 1: Write the script and the README section.**
- [ ] **Step 2: Smoke-test the script locally against a scratch copy, never production.**
  1. Build: `npm run build --workspace @scripta/shared && npm run build --workspace backend`.
  2. Create scratch databases in the session scratchpad:
     - the books database with `applyBooksMigrations`;
     - the library database with its schema, and one held pt work missing its original;
     - the arena database, by calling the arena module's `openArenaDb()` from `dist` once with `ARENA_DB_PATH` set. The arena repository prepares its statements when it is created, so the database needs its schema.
  3. `connection.ts` loads `config/env.ts`, which exits unless these are set: `AUTH_DB_PATH`, `GALLERY_DB_PATH` (scratch paths), and `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (64 characters each, as the test preamble uses). Run `AUTH_DB_PATH=… GALLERY_DB_PATH=… JWT_ACCESS_SECRET=… JWT_REFRESH_SECRET=… COVERS_DB_PATH=… LIBRARY_DB_PATH=… ARENA_DB_PATH=… node backend/scripts/fetch-originals.mjs --dry-run`.

  Expected: valid JSON with `held` 1 and `selected` 1. It may make one real Open Library call. A run with a bad flag prints the usage and exits 1.
- [ ] **Step 3: Verify.** Run `npm run typecheck --workspace backend && npm test --workspace backend`. Expected: all pass.
- [ ] **Step 4: Commit.** Message: `Add the fetch-originals script and its runbook`.
