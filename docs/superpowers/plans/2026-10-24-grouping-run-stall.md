# Grouping Run Stall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No synchronous block in the boot/daily works-grouping run much above ~800 ms, with the same merges as today.

**Architecture:** The duplicate walk yields between a page's key read and its merge step. The keyless drain moves out of the repository into an async page walk next to the duplicate walk, one transaction per page. The plugin reads 50 title keys a page for both.

**Tech Stack:** TypeScript, `node:sqlite`, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-24-grouping-run-stall-design.md`

**Base:** origin/main (31097fe9).

## Global Constraints

- Only the page boundaries move. The SQL, the planners (`planDuplicateSets`, `planTitleFolds`), `groupTitleKeys`, `mergeDuplicateWork` and the guards (`undoneMergeAmong`, `sharesArena`, `skip`) stay unchanged.
- The yield is `await new Promise(setImmediate)`, as the walk and `drainBatches` already do.
- No comments in code. No new test files. Verify with `node scripts/gate.mjs` before committing.

## Review Focus

- **The keyless contract `drainBatches` relies on.** Each call returns at most `limit`, starts again from the first key, and returns less than `limit` only when nothing is left. "groupKeylessWorks merges at most its limit per batch", "shared title keys that never pair don't end a batch early" and "a batch never merges more than its limit when shared keys yield uneven pairs" cover it.
- **Abort after a yield** never runs a database call.

---

### Task 1: The duplicate walk yields between a page's key read and its merges

**Files:**
- Modify: `backend/src/modules/books/duplicateWorks.ts`
- Test: `backend/src/modules/books/duplicateWorks.test.ts`

**Interfaces:**
- Produces: no signature change. `walkDuplicateWorks` awaits `setImmediate` after a non-empty `groupableTitleKeys` page and returns its totals so far if `signal` is aborted then.

- [ ] **Step 1: Write the failing tests** in `duplicateWorks.test.ts`, next to "walk covers keys across pages":
  - "walk yields to the event loop between a page's key read and its merges". Use two duplicate pairs (`twoDuplicates`) and `pageSize: 1`. A spy repo's `groupableTitleKeys` pushes `"keys"` and queues `setImmediate(() => events.push("tick"))`; its `keyedWorksWithTitleKeys` pushes `"plan"`. Assert every `"plan"` comes right after a `"tick"`, which itself follows a `"keys"`. Assert both pairs still merged.
  - "walk aborted while yielding after a key read merges nothing from that page". The spy's `groupableTitleKeys` aborts the controller on its first call, and its `keyedWorksWithTitleKeys` counts calls. Expect `{ merges: [], ...counts }`, zero keyed-works reads and no active `ol-duplicate` merges.
  Run `npx tsx --test src/modules/books/duplicateWorks.test.ts` in `backend/`. Both new tests fail.
- [ ] **Step 2: Implement.** In `walkDuplicateWorks`, after `if (keys.length === 0) break;`, add `await new Promise(setImmediate);` and `if (signal?.aborted) break;`. Everything else in the loop stays as is.
- [ ] **Step 3: Verify.** The test file passes, the existing "walk stops when the signal is aborted" included. `npm run typecheck --workspace backend`.
- [ ] **Step 4:** `node scripts/gate.mjs`, commit.

---

### Task 2: Keyless grouping pages across transactions, and the run reads 50 keys a page

**Files:**
- Modify: `backend/src/modules/books/duplicateWorks.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/backfill.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/README.md`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Test: `backend/src/modules/books/backfill.test.ts`

**Interfaces:**
- Consumes: `walkDuplicateWorks` from Task 1.
- Produces: `groupKeylessWorks(repo: Pick<BooksRepository, "groupableTitleKeys" | "groupTitleKeys">, limit: number, options?: { at?: string; skip?: (from: string, into: string) => boolean; signal?: AbortSignal; pageSize?: number }): Promise<number>`, exported from `duplicateWorks.ts`. `BooksRepository.groupKeylessWorks` is removed. `startWorksGrouping`'s second parameter becomes `(limit: number, signal: AbortSignal) => number | Promise<number>`.

- [ ] **Step 1: Point the existing tests at the new function.** In `sqliteBooksRepository.test.ts`, import `groupKeylessWorks` from `../../duplicateWorks.js` with the other dynamic imports. Replace every `repo.groupKeylessWorks(n)` with `await groupKeylessWorks(repo, n)`, and every `repo.groupKeylessWorks(n, at)` with `await groupKeylessWorks(repo, n, { at })`; there are 46 call sites. Make each enclosing test or helper `async`. Keep each assertion's expected value as it is. If a call sits in a synchronous helper, make the helper async and await it at its callers.
- [ ] **Step 2: Write the failing tests** in `sqliteBooksRepository.test.ts`, after "batches of one merge the same pairs as one call, oldest first within a title key":
  - "keyless grouping one title key a page, each page its own transaction, merges the same pairs in the same order as one page". Take two `groupingFixture()`s. For the paged one, wrap its repo as `{ ...repo, groupableTitleKeys, groupTitleKeys }`. Each wrapper records `db.isTransaction` before calling through. The key read also pushes `"keys"` and queues `setImmediate(() => events.push("tick"))`, and `groupTitleKeys` pushes `"group"`. Then:
    - `await groupKeylessWorks(spy, 250, { at: NOW, pageSize: 1 })` is 7.
    - `await groupKeylessWorks(all.repo, 250, { at: NOW })` is 7.
    - `mergedPairs` of both are deep-equal in order.
    - Every recorded `isTransaction` is `false`.
    - Every `"group"` comes right after a `"tick"` that follows a `"keys"`.
    - There is more than one `"keys"`.
  - "keyless grouping stops on an aborted signal". With an already-aborted signal it returns 0 and records no `title-key` merge. With a spy whose key read aborts the controller, it returns 0 and `groupTitleKeys` is never called. Use the rule-case fixture.
  In `backfill.test.ts`, extend "works grouping merges duplicate works before grouping keyless ones": the keyless fake records its second argument, and the test asserts it is the same signal the duplicate pass got.
  Run `npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/backfill.test.ts` in `backend/`. It fails because `groupKeylessWorks` is not exported.
- [ ] **Step 3: Implement the walk** in `duplicateWorks.ts`:

```ts
export async function groupKeylessWorks(
  repo: Pick<BooksRepository, "groupableTitleKeys" | "groupTitleKeys">,
  limit: number,
  options: { at?: string; skip?: (from: string, into: string) => boolean; signal?: AbortSignal; pageSize?: number } = {}
): Promise<number> {
  const { at = new Date().toISOString(), skip, signal, pageSize = limit } = options;
  let merged = 0;
  let after = "";
  while (merged < limit && !signal?.aborted) {
    const keys = repo.groupableTitleKeys(after, pageSize);
    if (keys.length === 0) break;
    await new Promise(setImmediate);
    if (signal?.aborted) break;
    merged += repo.groupTitleKeys(keys, limit - merged, at, skip);
    if (keys.length < pageSize) break;
    after = keys[keys.length - 1]!;
    await new Promise(setImmediate);
  }
  return merged;
}
```

  Remove `groupKeylessWorks` from `BooksRepository` in `domain/ports.ts` and from the SQLite repository's returned object.
- [ ] **Step 4: Wire it.** In `backfill.ts`:
  - `drainBatches`'s `step` becomes `(limit: number, signal: AbortSignal) => number | Promise<number>`, called as `step(size, signal)`.
  - `startWorksGrouping`'s `groupKeylessWorks` parameter takes the same type.

  In `plugin.ts`:
  - Add `const GROUPING_PAGE_SIZE = 50;` beside the other constants.
  - The walk gets `pageSize: GROUPING_PAGE_SIZE`; keep `pauseMs: 250`.
  - The keyless step becomes `(limit, signal) => groupKeylessWorks(repo, limit, { skip: sharesArena, signal, pageSize: GROUPING_PAGE_SIZE })`, with `groupKeylessWorks` imported from `./duplicateWorks.js`.
- [ ] **Step 5: Docs.** Edit the "Boot, daily and `POST /books/works/group`" bullet in `backend/README.md` (around line 230):
  - The walk reads 50 title keys a page, yields between a page's key read and its merges, and pauses 250 ms between pages.
  - Keyless grouping then walks the shared title keys 50 a page. Each page is its own transaction, with a yield between pages, and each drain batch still merges at most 250.
- [ ] **Step 6: Verify.**
  - `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace backend` and `npm test --workspace backend` pass.
  - `rg -n "groupKeylessWorks" backend/src` shows only `duplicateWorks.ts`, `plugin.ts` and the tests, plus `backfill.ts`'s parameter name.
  - `npm run build --workspace backend`, so `backend/scripts/merge-duplicate-works.mjs`'s `dist` import of `walkDuplicateWorks` still resolves.
- [ ] **Step 7:** `node scripts/gate.mjs`, commit.
