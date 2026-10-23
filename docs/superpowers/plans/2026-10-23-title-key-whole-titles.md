# Title-Key Whole Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A keyless work joins another work by title only when both share the title key and the whole title (`wholeTitle`). Then volumes such as "Arsène Lupin: A Agulha Oca" stop folding into "Arsène Lupin: Gentleman Ladrão", and a book stops folding into its graphic-novel adaptation.

**Architecture:** `domain/duplicateWorks.ts` gets one pure planner, `planTitleFolds`, which replaces `planCrowdedFolds` and the SQL single-keyed and oldest-keyless rules (`GROUPABLE_PAIRS_SQL`). `groupTitleKeys` feeds the planner from `KEYLESS_CANDIDATES_SQL` (plus `created_at`) and a new `KEYED_EDITIONS_SQL`. It keeps its undone-pair skip, arena skip, limit and transaction.

**Tech Stack:** TypeScript, Fastify backend, `node:sqlite`, `node:test` via `tsx --test`, `@scripta/shared`.

**Spec:** `docs/superpowers/specs/2026-10-23-title-key-whole-titles-design.md`

**Base:** main with the undoable-title-key branch `claude/bold-dubinsky-3052e6` merged (`groupTitleKeys` skips undone pairs, one hop included, and always fetches every pair; `undoMerge` handles `title-key`). Cut the branch from origin/main after it merges.

## Global Constraints

- The whole title is `wholeTitle` from `backend/src/modules/books/domain/translation.ts`. Never `normalizeWords(title)`: bracketed notes ("[EBOOK]", "(edição de bolso)") must not split a group.
- Keyed works are matched through the whole titles of their editions under the key, not through `works.title`.
- `planDuplicateSets`, `KEYED_WORKS_SQL`, `keyedWorksWithTitleKeys`, `normalizeTitle` and the `title_key` format don't change. No migration, no production write.
- `groupTitleKeys` keeps:
  - the undone-pair skip and the `skip` callback, applied to every planned pair;
  - `merged === limit` checked before each pair;
  - one transaction.
- Planned folds keep today's order: title key, then the source's `created_at`, then its id. The batching tests depend on it.
- No comments in code. No new test files: every test touched is already listed in `backend/package.json`.
- Rebuild shared before any backend run: `npm run build --workspace @scripta/shared`. Verify each task with `node scripts/gate.mjs` before committing.

## Review Focus

- **A translation join leaves Portuguese editions inside an English keyed work** ("1984" holding "Mil Novecentos e Oitenta e Quatro"). A later keyless copy of the Portuguese title must still fold into that work. Task 2 tests it.
- **A keyed work that holds an edition only through an earlier title-key fold** attracts later copies of that edition. That is accepted, and it is why the reviewed undos run right after this deploys.
- **A crowded key whose keyed works lack the keyless work's whole title** used to leave keyless works alone. Now keyless works with the same whole title fold into the oldest of them. That is intended and tested.
- **Restored copies of one volume** (undone from the same target) now fold together, and still never back into the target. The test "two copies of one volume folded into the same target and both undone stay apart from it, unblocked" changes to assert that.

---

### Task 1: `planTitleFolds`

**Files:**
- Modify: `backend/src/modules/books/domain/duplicateWorks.ts`
- Test: `backend/src/modules/books/domain/duplicateWorks.test.ts`

**Interfaces:**
- New `TitleWork { titleKey: string; workId: string; title: string; keyed: boolean; createdAt: string }`. `KeyWork` and `planCrowdedFolds` stay until Task 2 deletes them.
- `planTitleFolds(works: TitleWork[]): Array<{ source: string; target: string }>`. Rules:
  1. Group entries by `titleKey` and `wholeTitle(title)`. Skip an entry whose key or whole title is `""`.
  2. A group with two or more distinct keyed `workId`s plans nothing.
  3. Otherwise the target is the keyed work, or else the oldest keyless entry (`createdAt`, then `workId`). Every other keyless entry folds into it.
  4. Keyed entries are one per (work, edition title). A keyed work can appear in several groups.
  5. Output is ordered by `titleKey`, then the source's `createdAt`, then its `workId`.

- [ ] **Step 1: Write the failing tests.** Copy the four `planCrowdedFolds` tests as `planTitleFolds` tests, with `createdAt` in their fixtures. Their expectations stay, except "leaves a keyless work alone when no keyed work, or several, have its full title": a lone keyless work still plans nothing, and the two-keyed case still plans nothing. Add:
  - "keeps a keyless volume apart from the one keyed work whose whole title differs": keyed `Arsène Lupin: Gentleman Ladrão` plus keyless `Arsène Lupin: A Agulha Oca` → `[]`.
  - "folds keyless works with one whole title into the oldest of them, and keeps other whole titles apart": three keyless Lupin volumes plus a second `A Agulha Oca` copy → exactly the copy folds into the older `A Agulha Oca`.
  - "matches a keyed work through any of its edition titles": a keyed work entered twice, `1984` and `Mil Novecentos e Oitenta e Quatro`, plus a keyless `Mil Novecentos e Oitenta e Quatro` → folds into it.
  - "ignores bracketed notes": keyless `[EBOOK] Os Maias` folds into keyed `Os Maias`.
  - "a crowded key with no keyed work of that whole title folds its keyless works together".
  - The output order, using three keys created out of order.
- [ ] **Step 2:** Run `npx tsx --test src/modules/books/domain/duplicateWorks.test.ts` in `backend/` and see the new tests fail.
- [ ] **Step 3: Implement** `planTitleFolds` next to `planCrowdedFolds`. Import `wholeTitle` from `./translation.js` and reuse the file's `compare`. Nothing calls it yet.
- [ ] **Step 4:** Run `node scripts/gate.mjs` and commit.

### Task 2: `groupTitleKeys` plans every fold with whole titles

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Modify: `backend/src/modules/books/domain/duplicateWorks.ts`
- Test: `backend/src/modules/books/domain/duplicateWorks.test.ts`
- Test: `backend/src/modules/books/seriesMergeRepair.test.ts`
- Modify: `backend/README.md`

**Interfaces:**
- `planCrowdedFolds`, `KeyWork` and their four tests are deleted. Task 1's copies cover the same cases.
- `KEYLESS_CANDIDATES_SQL` also selects `candidates.created_at AS created_at`.
- New export `KEYED_EDITIONS_SQL`, which takes one JSON array of keys. It returns `DISTINCT books.title_key AS title_key, works.id AS id, books.title AS title, works.created_at AS created_at`, for editions with `books.title_key IN json_each(?)` and `books.title_group_blocked_at IS NULL` in works with `ol_work_key IS NOT NULL AND merged_into IS NULL`. Copy `KEYED_WORKS_SQL`'s join order: a `DISTINCT` subquery over `books` first, then `CROSS JOIN works`. Otherwise the planner can start from `works` through `sqlite_autoindex_works_2`, which an existing test guards against.
- `GROUPABLE_PAIRS_SQL`, `groupablePairsStmt` and `crowdedFolds` are deleted.
- `groupTitleKeys` plans `planTitleFolds` over `KEYED_EDITIONS_SQL` rows (keyed) and `KEYLESS_CANDIDATES_SQL` rows (keyless) for `keys`, then runs today's loop.

- [ ] **Step 1: Write the failing tests** next to the existing grouping tests (reuse `freshRepo`, `edition`, `at`, `AT`):
  - "three keyless volumes of one series stay three works", and the same with the first volume keyed (`OL1W`). This is today's repro: on main they became one work.
  - "two keyless copies of one volume fold together and not into the keyed volume beside them".
  - "a keyless copy of a Portuguese edition folds into the English keyed work that holds it through a translation join". Build it with `mergeTranslation` from a keyless `Mil Novecentos e Oitenta e Quatro` into keyed `1984`, then add a keyless copy. This is a guard test: it passes before and after the change.
  - "the plain book and its graphic novel stay apart": keyless `O Profeta` ×2 and `O Profeta: Novela Gráfica`.
  - **Tests that only use a cross-title fold as setup** keep what they test. Under whole titles, grouping no longer builds that state, so build it directly:
    - call `mergeWorks(source, target, at)` for each fold;
    - then run `UPDATE work_merges SET source = 'title-key' WHERE from_work = ?`. `mergeWorks` logs an `admin` row, and editing that row keeps a single active row, where adding one would leave two.

    This applies to the undoable-title-key branch's title-key undo tests in `sqliteBooksRepository.test.ts`:
    - the two Lupin variants, keyless and keyed target;
    - the synopsis take-back tests;
    - the onward-join and one-hop tests;
    - "two copies of one volume folded into the same target and both undone stay apart from it, unblocked".

    It also applies to the title-key test in `seriesMergeRepair.test.ts`, which expects "A Agulha Oca" and "Gentleman Ladrão" to be grouped.

    For the two-copies test, build both copies of "Arsène Lupin: A Agulha Oca" into the target "Arsène Lupin: Gentleman Ladrão" that way. After both undos, assert that one `groupKeylessWorks` folds the second copy into the first, never into the target, and that no book is blocked.
  - In "grouping reads shared title keys from the covering index and starts from them", drop the `GROUPABLE_PAIRS_SQL` assertion and the import.
  - Add `KEYED_EDITIONS_SQL` to the loop in "looking up keyed works and keyless candidates for a title key reads through the title index, never a scan of books".
- [ ] **Step 2:** Run `npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts` in `backend/` and see the new tests fail. The 1984 guard test passes.
- [ ] **Step 3: Implement.** The rule-case fixture, the batching tests and the Fourth Wing tests must pass unchanged. They use whole titles that already decide the same way. A test whose subject is a cross-title fold itself changes to assert the works stay apart. A test that only needs one as setup builds it as in Step 1. Name each changed test in the commit message.
- [ ] **Step 4: README** (`backend/README.md`):
  - "Works group editions": replace the three-way rule with the spec's rule. A keyless work joins the one keyed work holding an edition with its title key and whole title, or else the oldest keyless work with both. It is left alone when two keyed works hold it. Keep the sentences on the arena skip, the undone-pair skip and blocked editions.
  - "Duplicate Open Library works": rewrite the crowded-key paragraph and the paragraph "Once a duplicate merge leaves a single keyed work…" ("whatever their full title … subtitle variants included"). No rule folds a different whole title now.
  - The "**Boot, daily and `POST /books/works/group`.**" bullet: drop "applies the full-title fold too", since there is one rule now.
- [ ] **Step 5:** Run `node scripts/gate.mjs` (shared build, backend typecheck, backend tests) and commit.

---

## After merge (owner's runbook, not a task)

1. **Order.** Deploy this together with, or after, the undoable-title-key branch. Run the reviewed title-key undos right after the deploy (spec, Rollout). The files are in the session notes: `title-key-undo.json` and the review table.
2. **Then fold the restored copies of one volume together.** Run `POST /books/works/group` (admin), or wait for the daily run. Read the `grouped keyless works by title` log line, and check for `stallLog` warnings during that run.
3. **Re-run the read-only listing** from the session notes (`list-title-key-merges.mjs`) over `railway ssh`, and look at merges with `merged_at` after the deploy. Expect none listed. Review any made between 2026-10-23 and the deploy in the same way.
