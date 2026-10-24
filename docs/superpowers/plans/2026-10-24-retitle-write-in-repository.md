# Retitle Write In Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live retitle job writes through `BooksRepository.applyTitleRepairs`, and the raw write lives in `adapters/sqlite/`.

**Architecture:** Move `applyMojibakeRepairs` to `adapters/sqlite/titleRepairs.ts` unchanged; add a one-line repository method over it; point the plugin, migration, scripts and tests at the new places.

**Tech Stack:** TypeScript, `node:sqlite`, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-24-retitle-write-in-repository-design.md`

**Base:** origin/main. Independent of the Jev job runner (no shared files); the background-jobs branch goes after this one, since both touch `plugin.ts`.

## Global Constraints

- The SQL, transactions, guards and returned counts of `applyMojibakeRepairs` do not change.
- `BooksRepository.applyTitleRepairs(plan: { books: RowRepair[]; works: RowRepair[] }): MojibakeApplied`.
- `RowRepair` and `MojibakeApplied` are defined in `backend/src/modules/books/domain/types.ts`.
- No comments in code. No new test files. Verify with `node scripts/gate.mjs` before committing.

## Review Focus

- **The startup migration** (`user_version` 4) still applies the author-order fixes at boot. The six "the ISBNdb-first author pass …" tests in `sqliteBooksRepository.test.ts` (from line 1811) cover it; they run in `npm test`.
- **The two scripts** import from `dist`. Task 1 checks the built paths resolve.

---

### Task 1: Move the write behind the repository

**Files:**
- Create: `backend/src/modules/books/adapters/sqlite/titleRepairs.ts`
- Modify: `backend/src/modules/books/seed/mojibakeRepair.ts`
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/seed/lossyRetitle.ts`
- Modify: `backend/src/modules/books/retitleJob.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/scripts/repair-mojibake.mjs`
- Modify: `backend/scripts/retitle-lossy.mjs`
- Test: `backend/src/modules/books/retitleJob.test.ts`
- Test: `backend/src/modules/books/seed/mojibakeRepair.test.ts`
- Test: `backend/src/modules/books/seed/lossyRetitle.test.ts`

**Interfaces:**
- Produces: `applyMojibakeRepairs(db: DatabaseSync, plan: { books: RowRepair[]; works: RowRepair[] }): MojibakeApplied` exported from `adapters/sqlite/titleRepairs.ts`; `repo.applyTitleRepairs(plan)` on `BooksRepository`.

- [ ] **Step 1: Write the failing test.** In `retitleJob.test.ts`, the job's `write` becomes `(plan) => repo.applyTitleRepairs(plan)` and the `applyMojibakeRepairs` import goes. Run `npx tsx --test src/modules/books/retitleJob.test.ts` in `backend/` — it fails with "repo.applyTitleRepairs is not a function".
- [ ] **Step 2: Move the types.** `RowRepair` and `MojibakeApplied` move to `domain/types.ts`; `seed/mojibakeRepair.ts` and `seed/lossyRetitle.ts` import them from there, and `retitleJob.ts` imports `MojibakeApplied` from there (its `MojibakePlan` import stays on the seed file) (`BookRepair extends RowRepair` stays in the seed file).
- [ ] **Step 3: Move the function.** Cut `applyMojibakeRepairs` from `seed/mojibakeRepair.ts` into `adapters/sqlite/titleRepairs.ts` verbatim, with the `catalogTitleKey`/`workTitleKey` import from `../../domain/normalize.js`. Point `connection.ts`, `mojibakeRepair.test.ts` and `lossyRetitle.test.ts` at it. In both scripts, change the `dist` import of `applyMojibakeRepairs` to `../dist/modules/books/adapters/sqlite/titleRepairs.js`, keeping their other imports from `seed/mojibakeRepair.js`.
- [ ] **Step 4: Add the method.** `applyTitleRepairs` on `BooksRepository` in `domain/ports.ts`; the SQLite repository returns `applyMojibakeRepairs(db, plan)`. In `plugin.ts` the retitle job's `write` becomes `(plan) => repo.applyTitleRepairs(plan)` and the `seed/mojibakeRepair.js` import goes.
- [ ] **Step 5: Verify.** `npm test --workspace backend` passes. `rg -n "applyMojibakeRepairs" backend/src/modules/books/plugin.ts backend/src/modules/books/seed` returns nothing. `npm run build --workspace backend`, then `node -e "import('./backend/dist/modules/books/adapters/sqlite/titleRepairs.js').then(m => console.log(typeof m.applyMojibakeRepairs))"` from the root prints `function`.
- [ ] **Step 6:** `node scripts/gate.mjs`, commit.
