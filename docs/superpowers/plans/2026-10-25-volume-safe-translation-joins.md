# Volume-Safe Translation Joins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatic translation joins stop folding volumes into series or omnibus works, and a reviewed repair undoes the joins that already did. The Lord of the Rings is the first case.

**Architecture:**
- **A pure guard** (`domain/volumeGuard.ts`) gives one of three answers for a Portuguese work and its proposed target: `join`, `review` or `never`.
- **Where it runs.** `translationJudgments.ts` wraps the guard as `guardJoin`. The guard runs before every automatic merge: `decide` (the Jev and code plans) and `joinByCode` (the backlog code steps and the original-arrivals drain).
- **The repair** extends the existing #317 tool (`seriesMergeRepair.ts`, `scripts/undo-series-merges.mjs`). It adds a listing of active joins the guard flags, and it lets an undo file drop wrong series rows.

**Tech Stack:** TypeScript, `node:sqlite`, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-25-volume-joins-and-search-ranking-design.md` (Part 1). This plan is PR 1 of 3. Part 2 and Part 3 are in `docs/superpowers/plans/2026-10-25-search-scorecard-and-ranking.md`.

## Global Constraints

- **Manual merges skip the guard.** Merges from the review queue (`reviewTranslationWith`) never run it.
- **`never` means:** no merge, and the saved judgment has `intoWorkId: null` and keeps the model and confidence.
- **`review` means:** no merge, and the saved judgment keeps the proposed `intoWorkId` and confidence, so the row shows in the review queue's existing "blocked" group.
- **No changes to the review queue's schema or response.** No reason label is added.
- **No production writes and no deploy.** A deploy hold is in force until the pre-2002 BNP import session announces it has finished. Merging to `main` is fine.
- **Code style:**
  - No comments in code.
  - A new `*.test.ts` file goes into `backend/package.json`'s `test` script, or CI won't run it.
  - Prefer the existing test files listed per task.
- **Verify each task** with `node scripts/gate.mjs` before committing.
- **Running a backend script locally** (against a scratch database) needs the same environment preamble the tests set, because `config/env.ts` exits at import time: `AUTH_DB_PATH`, `LIBRARY_DB_PATH` and `GALLERY_DB_PATH` pointing at scratch files, `JWT_ACCESS_SECRET` set to 64 `a`s and `JWT_REFRESH_SECRET` set to 64 `b`s, plus `COVERS_DB_PATH`.

## Review Focus

1. **Famous books with a number in the title still join.** "Henrique V" → "Henry V", "Catch-22" → "Catch-22" and "Malcolm X" → "The Autobiography of Malcolm X" must all still give `join`. Pinned in Task 1.
2. **A series named after its first book.** "Duna" → "Dune", when "Dune" is also a Wikidata series name with other members, gives `review`, not `join`. That's accepted as a review cost, but it must not give `never`. Pinned in Task 1.
3. **Series rows on merged works.** A series row stays on the work it was written to, even after that work is merged. Such a row counts for its canonical work (`COALESCE(merged_into, id)`). A row on a work merged into the target itself doesn't make the target "head a series". Pinned in Task 2.
4. **Re-asking a guarded work.** The 30-day recheck re-selects only judgments with no target (`portugueseWorkFilter`, `sqliteBooksRepository.ts:195`).
   - A `never` work is re-asked every month. The guard says `never` again, and the cost is one Jev call per such work per month.
   - A `review` work keeps its target and is never re-asked.

   Pinned in Task 2.
5. **A guarded code join in the arrivals drain** counts as blocked and writes no merge. Pinned in Task 2.
6. **Series numbers in brackets.** "Harry Potter e a Pedra Filosofal (Harry Potter, #1)" is a whole novel, not a split volume. Brackets are stripped before the volume rules. Pinned in Task 1.

---

### Task 1: The guard's rules

**Files:**
- Create: `backend/src/modules/books/domain/volumeGuard.ts`
- Test: `backend/src/modules/books/domain/volumeGuard.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes:
  - `mainTitle(title: string): string` from `domain/translation.ts`;
  - `normalizeWords` from `@scripta/shared`.
- Produces:
  - `export type JoinVerdict = "join" | "review" | "never";`
  - `export function volumeNumber(text: string): string | null`. It returns the volume number of a title part as an Arabic string, or `null`.
  - `export function isOmnibusTitle(title: string): boolean`
  - `export function joinVerdict(work: { title: string; originalTitle: string | null }, target: { title: string }, headsSeries: (title: string) => boolean): JoinVerdict`

**Rules (exact):**
- `joinVerdict` applies `withoutBrackets` (from `@scripta/shared`) to `work.title` and `target.title` before the volume rules (steps 1–2).
- `volumeNumber(text)` works on `normalizeWords(text)` and returns the first of these:
  - a `#N` in the raw text;
  - a volume word followed by a number, using today's `VOLUME_WORD` words (book, bk, vol, volume, livro, tomo, tome, part, parte). The number may be Arabic, a Roman numeral I–X, or an English or Portuguese number word up to ten, and is converted to Arabic.
  - the last word, when there are at least two words and the last word is an Arabic number of 1–2 digits or a Roman numeral `i`–`x`. A Roman numeral is converted to Arabic.
- **A target's numbers** are every Arabic digit group in its title (as `titleNumbers` from `@scripta/shared` reads them), plus `volumeNumber(target.title)`.
- `isOmnibusTitle(title)` is true when either:
  - the raw title contains `" / "`; or
  - `normalizeWords(title)` contains one of the following as whole words: `box set`, `boxed set`, `boxset`, `omnibus`, `trilogy`, `trilogia`, `collection`, `colectanea`, `coletanea`, `obra completa`, `obras completas`, or a `books N N` / `livros N N` range.
- `joinVerdict`, in this order:
  1. `main = volumeNumber(mainTitle(work.title))`. If `main` is set and not among the target's numbers, the answer is `never`.
  2. `sub = volumeNumber` of the rest of `work.title` after `mainTitle`. If `sub` is set and not among the target's numbers, the answer is `review`.
  3. If `headsSeries(target.title)`, or `work.originalTitle !== null && headsSeries(work.originalTitle)`, the answer is `review`.
  4. If `isOmnibusTitle(target.title) && !isOmnibusTitle(work.title)`, the answer is `review`.
  5. Otherwise the answer is `join`.

- [ ] **Write the failing tests** in `domain/volumeGuard.test.ts`. Use `const none = () => false` and `const heads = (names: string[]) => (title: string) => names.includes(title)`.
  - `joinVerdict({ title: "Os Miseráveis I", originalTitle: "Les Misérables" }, { title: "Les Misérables" }, none)` → `"never"`
  - `joinVerdict({ title: "O Conde de Monte Cristo II", originalTitle: null }, { title: "The Count of Monte Cristo" }, none)` → `"never"`
  - `joinVerdict({ title: "Os Miseráveis I", originalTitle: null }, { title: "Les Misérables I" }, none)` → `"join"`
  - `joinVerdict({ title: "Henrique V", originalTitle: "Henry V" }, { title: "Henry V" }, none)` → `"join"`
  - `joinVerdict({ title: "Catch-22", originalTitle: "Catch-22" }, { title: "Catch-22" }, none)` → `"join"`
  - `joinVerdict({ title: "Malcolm X", originalTitle: null }, { title: "The Autobiography of Malcolm X" }, none)` → `"join"`
  - `joinVerdict({ title: "Fahrenheit 451", originalTitle: null }, { title: "Fahrenheit 451" }, none)` → `"join"`
  - `joinVerdict({ title: "A Coisa - Livro 1", originalTitle: "It" }, { title: "It" }, none)` → `"review"`
  - `joinVerdict({ title: "A Irmandade do Anel - O Senhor dos Anéis - Parte I", originalTitle: null }, { title: "The Fellowship of the Ring" }, none)` → `"review"`
  - `joinVerdict({ title: "A Irmandade do Anel", originalTitle: "The lord of the rings" }, { title: "The Lord of the Rings" }, heads(["The Lord of the Rings"]))` → `"review"`
  - `joinVerdict({ title: "As duas Torres", originalTitle: "The lord of the rings-the two towers" }, { title: "The Lord of the Rings" }, heads(["The Lord of the Rings"]))` → `"review"`
  - `joinVerdict({ title: "Duna", originalTitle: "Dune" }, { title: "Dune" }, heads(["Dune"]))` → `"review"`
  - `joinVerdict({ title: "Anúncio de um crime", originalTitle: "A Murder is Announced" }, { title: "Murder on the Orient Express / A Murder is Announced" }, none)` → `"review"`
  - `joinVerdict({ title: "Trilogia Millennium", originalTitle: null }, { title: "The Millennium Trilogy" }, none)` → `"join"`, because both titles are omnibus titles.
  - `joinVerdict({ title: "Passeio ao Farol", originalTitle: "To the Lighthouse" }, { title: "To the Lighthouse" }, none)` → `"join"`
  - `volumeNumber("Harry Potter #3")` → `"3"`; `volumeNumber("tomo dois")` → `"2"`; `volumeNumber("1984")` → `null`; `volumeNumber("Henry")` → `null`.
  - `isOmnibusTitle("Harry Potter Boxset Books 1-7")` → `true`; `isOmnibusTitle("The Collector")` → `false`; `isOmnibusTitle("Recollections")` → `false`.
  - `joinVerdict({ title: "Harry Potter e a Pedra Filosofal (Harry Potter, #1)", originalTitle: "Harry Potter and the Philosopher's Stone" }, { title: "Harry Potter and the Philosopher's Stone" }, none)` → `"join"`
- [ ] Add `src/modules/books/domain/volumeGuard.test.ts` to `backend/package.json`'s `test` script next to `domain/translation.test.ts`. Run `npm test --workspace backend` and check that the new file fails because the module doesn't exist.
- [ ] Implement `domain/volumeGuard.ts` per the rules above.
- [ ] Run `node scripts/gate.mjs`. Expected: all green.
- [ ] Commit: `git add backend/src/modules/books/domain/volumeGuard.ts backend/src/modules/books/domain/volumeGuard.test.ts backend/package.json && git commit -m "Volume guard rules for translation joins"`

### Task 2: Run the guard before every automatic join

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/translationJudgments.ts`
- Modify: `backend/src/modules/books/translationBacklog.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Test: `backend/src/modules/books/translationJudgments.test.ts`
- Test: `backend/src/modules/books/translationBacklog.test.ts`
- Test: `backend/src/modules/books/originalArrivals.test.ts`
- Test: `backend/src/modules/books/translationReview.test.ts`

**Interfaces:**
- Consumes: `joinVerdict`, `JoinVerdict` (Task 1); `seriesNameKey` from `domain/series.ts`.
- Produces:
  - **On `BooksRepository`:** `seriesHasOtherMembers(nameKey: string, workId: string): boolean`. It is true when either:
    - some `work_series` row with that `name_key` sits on a work whose `COALESCE(merged_into, id) <> workId`; or
    - some `book_collections` row with that `name_key` sits on a book whose work's `COALESCE(merged_into, id) <> workId`.

    Rows stay on merged works (`bestSeriesOf` reads them through aliases), so they must count for their canonical work.
  - **In `translationJudgments.ts`:** `export function guardJoin(repo: Pick<BooksRepository, "translationEvidence" | "matchCandidates" | "seriesHasOtherMembers">, workId: string, intoWorkId: string): JoinVerdict`. Behaviour:
    - The work side is `evidenceOf(repo.translationEvidence(workId))`'s `title` and `originalTitle`.
    - The target title is `repo.matchCandidates([intoWorkId])[0].title`.
    - `headsSeries` is `(title) => { const key = seriesNameKey(title); return key !== null && repo.seriesHasOtherMembers(key, intoWorkId); }`.
    - Missing evidence or a missing target returns `"join"`, which leaves today's behaviour.

- [ ] **Repository test** in `sqliteBooksRepository.test.ts` for `seriesHasOtherMembers`. Set up a work A with a `work_series` row "The Lord of the Rings" (via `addWorkSeries`) and a work B with the same series:
  - `seriesHasOtherMembers("the lord of the rings", A)` → `true`.
  - After merging B into A, it → `false`.
  - A work C with the same series row, merged into an unrelated work D, makes it `true` again.
  - A `book_collections` row on another canonical work's edition (via `addBookCollection`) also makes it `true`.
- [ ] **Implement** `seriesHasOtherMembers` in `ports.ts` and the SQLite repository, as one prepared statement.
- [ ] **Wire `decide`.** When `merge && intoWorkId`, compute `guardJoin(deps.repo, workId, intoWorkId)` before the transaction:
  - `never`: save the judgment with `intoWorkId: null` and don't merge;
  - `review`: save it unchanged and don't merge;
  - `join`: today's path.
- [ ] **Wire `joinByCode`.** Compute the verdict first:
  - `never`: save a `code` judgment with `intoWorkId: null` and return `false`;
  - `review`: save the `code` judgment with the target and return `false`;
  - `join`: today's path.
- [ ] **Tests in `translationJudgments.test.ts`.** Use the file's `edition()` helper and `repo.addWorkSeries`.
  - **Jev into a series head.** An English "The Lord of the Rings" (OL27448W) and an English "The Return of the King" (OL27455W), both with Wikidata series "The Lord of the Rings". A Portuguese "A Irmandade do Anel" with original title "The lord of the rings". `matchWork` with a stub `classify` that returns that target at confidence 0.99:
    - no `work_merges` row;
    - the work isn't merged;
    - the judgment keeps the target.
  - **Jev, split volume.** A Portuguese "Os Miseráveis I" and an English "Les Misérables". Jev answers the latter at 0.99. Expected: no merge, and the judgment's `intoWorkId` is `null`.
  - **Recheck.** For the split-volume (`never`) case: after the recheck time passes, `translationBacklogWorks(repo, [], recheckBefore)` selects the work again. A second `matchWork` still writes no merge, and the judgment's `intoWorkId` is still `null`. The series-head (`review`) work is not selected.
  - **A plain translation still merges.** "Passeio ao Farol" into "To the Lighthouse" at 0.99 merges, as today.
- [ ] **Test in `translationBacklog.test.ts`.** `runCodeSteps` on a code-plan work whose target heads a series:
  - `codeBlocked` is 1 and `codeMerges` is 0;
  - the `code` judgment keeps the target.
- [ ] **Test in `originalArrivals.test.ts`.** An arrival whose claimant's code join is guarded to `review` (the target heads a series):
  - the drain counts it in `codeBlocked`;
  - nothing is merged.
- [ ] **Test in `translationReview.test.ts`.** After a guarded Jev `review`, `translationReviewWith` lists the work in group `"blocked"` with the proposed target.
- [ ] **Check that nothing merges a guarded judgment later.**
  - Grep for every caller of `mergeTranslation` and of `saveWorkMatchJudgment`'s readers: `rg -n "mergeTranslation|workMatchJudgment" backend/src`.
  - Confirm that the only non-manual merge paths are `decide` and `joinByCode`.
  - If another path merges from a stored judgment, route it through `guardJoin` too, and add a test like the ones above.
  - State the finding in the commit message.
- [ ] Run `node scripts/gate.mjs`. Expected: all green.
- [ ] Commit the listed files with message `Guard automatic translation joins against volumes, series heads and omnibuses`.

### Task 3: Repair tooling: list guarded joins, drop wrong series rows

**Files:**
- Modify: `backend/src/modules/books/seriesMergeRepair.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/scripts/undo-series-merges.mjs`
- Test: `backend/src/modules/books/seriesMergeRepair.test.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Consumes:
  - `joinVerdict` (Task 1);
  - `seriesHasOtherMembers` (Task 2);
  - the existing `activeMerges`, `editionsOf`, `canonicalWorkIds`, `getWorkView` and `collectionsOf`.
- Produces:
  - `activeMerges` gains `confidence: number | null` (add `confidence` to `activeMergesStmt` and the port's return type).
  - `export type GuardedMerge = { mergeId: number; fromWork: string; intoWork: string; source: "code" | "jev"; confidence: number | null; verdict: "review" | "never"; intoTitle: string; editions: Array<{ title: string; isbn: string | null; originalTitle: string | null; collections: string[] }>; later: Array<{ mergeId: number; fromWork: string; source: MergeSource; editions: Array<{ title: string; isbn: string | null; originalTitle: string | null }> }> }`
  - `export function listGuardedMerges(repo): { checked: number; flagged: GuardedMerge[] }`. It covers every active `code` and `jev` merge.
    - The work side is the first moved edition's title and the first non-null `originalTitle` among the moved editions. They are found among the canonical target's `editionsOf`, filtered by `movedBookIds`, as `listSeriesCollapses` does.
    - The target is the canonical target's title, with `headsSeries` checked against the canonical target id.
    - `later` lists every other active merge, of any source, into the same canonical target with a higher id.
    - `collections` are `"<name>#<position>"` strings.
  - **On `BooksRepository`:** `removeWorkSeries(workId: string, nameKey: string, source: SeriesSource): number`. It deletes that `work_series` row (and its `series_fts` entry if the table keeps one per row) and returns the count deleted.
  - `export function dropSeriesRows(repo, rows: Array<{ workId: string; name: string; source: SeriesSource }>): number`
  - `export function addSeriesRows(repo, rows: Array<{ workId: string; name: string; position: string | null; source: SeriesSource }>, at: string): number`. It uses the existing `addWorkSeries`.
  - **Script.**
    - `node scripts/undo-series-merges.mjs --guarded` prints `listGuardedMerges` as JSON on stdout, read-only, with `checked` and the flagged count on stderr.
    - `--undo <file>` accepts optional `dropSeries` and `addSeries` arrays beside `undo`, and applies them after the undos, in the same run.
    - There is no Wikidata refill: `fill-series.mjs wikidata` refuses a real run without a reviewed `--skip` list, and a blank list would write series an earlier review rejected.

- [ ] **Tests in `seriesMergeRepair.test.ts`.** Build the Tolkien shape:
  - An omnibus "The Lord of the Rings" with a series row, and "The Return of the King" with the same series.
  - A Portuguese "A Irmandade do Anel" (original title "The lord of the rings") merged into the omnibus through `mergeTranslation(…, "jev", 0.99, AT)`.
  - Then a keyless "A irmandade do anel" merged through `"title-key"`.

  Expected:
  - `listGuardedMerges` flags the Jev merge with `verdict: "review"`, and lists the title-key merge in `later`.
  - A plain translation merge ("Passeio ao Farol") isn't flagged.
  - `checked` counts both `jev`/`code` merges.
- [ ] **Test for `dropSeriesRows`.** It removes only the named row, and `bestSeriesOf` no longer returns it. Repository test for `removeWorkSeries` returning `1`, then `0`.
- [ ] **Test for `addSeriesRows`.** It adds a row that `bestSeriesOf` then returns with its position.
- [ ] **Implement** the functions and the two script changes. The script's usage line becomes `node scripts/undo-series-merges.mjs --list | --guarded | --undo <file.json>`, and the file shape becomes `{"undo": [...], "dropSeries": [{"workId", "name", "source"}], "addSeries": [{"workId", "name", "position", "source"}]}`.
- [ ] Run `node scripts/gate.mjs`. Expected: all green. Then run `npm run build --workspace backend`, and run `node backend/scripts/undo-series-merges.mjs --guarded` with the Global Constraints' environment and `COVERS_DB_PATH` pointing at a scratch database with migrations applied. Expected: `{"checked":0,"flagged":[]}`.
- [ ] Commit the listed files with message `Repair tooling: list guarded translation joins, drop wrong series rows`.

### Task 4 (main session, not an implementer): review and runbook

**Files:**
- Create: `docs/repairs/2026-10-25-volume-joins.md`
- Create: `docs/repairs/2026-10-25-volume-joins-undo.json`

This needs Claude's judgment and production data. It is committed on Plan 2's branch (PR 2), because the repair runbook and Plan 2's baseline both depend on it. It runs after Tasks 1–3 are merged.

**No local snapshot (user decision, 2026-10-25: "just do it in prod").** Every read in this task runs on the production container over `railway ssh` (command in Plan 2's Global Constraints), with `new DatabaseSync(process.env.COVERS_DB_PATH, { readOnly: true })`. The listing needs code that isn't deployed yet, so:
- bundle a small entry that opens the database read-only and prints `listGuardedMerges` into one file with esbuild (it ships with tsx);
- upload it in base64 chunks under 100 KB to `/tmp` on the container (never `/data`), run it, then delete it;
- print results to stdout only. No writes, and never print secrets.

Keep these reads light while the pre-2002 BNP import runs (`sqlite-cross-process-starvation`).

- [ ] **List.** Run the bundled `--guarded` listing in production.
  - If `flagged` is in the hundreds, the rules are too broad (spec anti-goal). Stop, and bring the counts to the user.
- [ ] **Decide each flagged merge.** Rules:
  - split volumes stay apart;
  - a volume never sits inside its series or omnibus;
  - a genuine one-volume or omnibus translation stays.

  For each undone merge, also decide its `later` merges. For Tolkien:
  - the Fellowship and Two Towers Jev merges;
  - the title-key fold of 9788483026823;
  - whichever merges brought in 9789721049789, 9789897773921 and 9789897774706;
  - the three "O senhor dos anéis" Contemporânea editions (#52/#54/#56), judged on pages, collection and BNP data;
  - `e2ae6929…` "A Irmandade do Anel - … Parte I": a manual merge into the restored Fellowship if it is the same book.
- [ ] **Series rows.**
  - First query `work_series` read-only in production for `name_key = 'the lord of the rings'`, to see which work holds the position-2 row. The fill writes to the current `work_id` of the edition holding the ISBN (`seed/seriesFill.ts:144-148`), so the row may sit on the omnibus or on the merged Two Towers work (`1e34a680…`).
  - Put any row on the omnibus in `dropSeries`.
  - Put Fellowship position 1 and Two Towers position 2 (source `wikidata`) in `addSeries`, unless their own rows already exist.
- [ ] **Editions with no merge row to undo.** Some editions sit in the omnibus without a `work_merges` row that moved them, possibly the Contemporânea volumes. These need the admin `POST /books/works/detach` route (`routes.ts:163`), with each edition's ISBN. Afterwards a manual review merge moves them into the right volume work. List them in the review file.
- [ ] **Commit the review:**
  - `docs/repairs/2026-10-25-volume-joins.md`: a table of each flagged merge with from title → into title, verdict, decision and one-line reason;
  - `docs/repairs/2026-10-25-volume-joins-undo.json`.
- [ ] **Hand the user one runbook entry,** run after the deploy that carries Tasks 1–3, in order:
  1. a read-only `--guarded` dry run with the expected flagged count;
  2. `--undo docs/repairs/2026-10-25-volume-joins-undo.json` with the expected `undone` count and no failures;
  3. any detaches (`POST /books/works/detach`), then any manual merges, through the admin routes;
  4. a read-only check that OL27513W and OL27479W are unmerged works with their editions, and that the omnibus holds only one-volume, omnibus and box-set editions.
