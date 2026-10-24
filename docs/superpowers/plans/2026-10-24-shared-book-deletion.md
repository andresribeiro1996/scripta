# Shared Book Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared `deleteBooks` and `restoreDeletedBooks` in `@scripta/shared`, used by all four delete transforms on web and mobile; mobile's mural stat figure matches web.

**Architecture:** A new pure module `packages/shared/src/library/bookDeletion.ts`. Web pages and mobile hooks call it from inside their `updateLibrary` updaters; nothing about saving, toasts or confirms changes.

**Tech Stack:** TypeScript, `@scripta/shared` (`node:test` via `tsx`), React/Vite web, Expo mobile.

**Spec:** `docs/superpowers/specs/2026-10-24-shared-book-deletion-design.md`

## Global Constraints

- `deleteBooks(data: LibraryData, keys: ReadonlySet<string>): LibraryData` and `restoreDeletedBooks(current: LibraryData, snapshot: LibraryData, keys: ReadonlySet<string>): LibraryData`, exported from `packages/shared/src/library/index.ts`.
- `deleteBooks` sets `book_count: books.length`. Empty `keys` returns the same `data` object.
- Callers keep `snapshot = data` inside the updater; the saver re-runs it on a 409.
- No behaviour change on either client beyond `book_count` and the mobile stat size: same copy, same toasts, same Alerts, same scrub timing.
- No comments in code. Remove the existing comments above both web `handleDeleteSelected` functions, and the one inside `GroupsPage`'s ("see LibraryPage.tsx's own handleDeleteSelected…"), which points at a comment that no longer exists.
- Rebuild shared before client checks: `npm run build --workspace @scripta/shared`. Verify each task with `node scripts/gate.mjs` before committing.

## Review Focus

- **Duplicate book keys in one library** (two copies of the same book): delete removes both, restore puts both back at their own positions. Task 1 tests it.
- **A book added between delete and Undo** keeps its place, and the restored books go around it. Task 1 tests it.
- **A group deleted between delete and Undo** is not recreated by the restore. Task 1 tests it.
- **Inputs are not mutated** by either function. Task 1 checks with the `frozen` helper style of `groups.test.ts`.

---

### Task 1: `bookDeletion.ts` in shared

**Files:**
- Create: `packages/shared/src/library/bookDeletion.ts`
- Test: `packages/shared/src/library/bookDeletion.test.ts`
- Modify: `packages/shared/src/library/index.ts`
- Modify: `packages/shared/src/library/groups.ts`

**Interfaces:**
- Produces: `deleteBooks`, `restoreDeletedBooks` as in Global Constraints, exported from `@scripta/shared`.

- [ ] **Step 1: Write the failing tests** in `bookDeletion.test.ts`, in `groups.test.ts`'s style (`node:test`, `node:assert/strict`). `groups.test.ts`'s `frozen` freezes only a `Group[]`; write a local `frozenLibrary(data)` that freezes the library, its `books` array, each book, its `groups` array, each group and each `bookKeys`:
  - "deleteBooks drops the books with the given keys, scrubs them from every group and sets book_count"
  - "deleteBooks with no keys returns the same library"
  - "deleteBooks removes every copy of a duplicated book"
  - "restoreDeletedBooks puts deleted books back at their old positions"
  - "restoreDeletedBooks restores both copies of a duplicated book in place"
  - "restoreDeletedBooks keeps a book added after the delete and places restored books around it"
  - "restoreDeletedBooks puts books back into their groups in order and bumps only the groups it changed"
  - "restoreDeletedBooks does not recreate a group deleted after the delete"
  - "deleteBooks then restoreDeletedBooks gives back the original books and group keys" (compare books and `groups[].bookKeys`, not `updatedAt`)
  - "neither function mutates its inputs"
- [ ] **Step 2:** Run `npm test --workspace @scripta/shared` and see them fail on the missing module.
- [ ] **Step 3: Implement** `deleteBooks` with `bookKey` and `removeBooksFromAllGroups`; move `restoreDeletedBooks` and its two private helpers verbatim from `frontend/src/lib/restoreDeletedBooks.ts`, importing `bookKey` from `./merge.js` and `LibraryData` from `./types.js`. Add `export * from "./bookDeletion.js";` to the index. In `groups.ts`, the `removeBooksFromAllGroups` doc comment's pointer to "the delete handlers in frontend's LibraryPage.tsx/GroupsPage.tsx" becomes a pointer to `deleteBooks` in `bookDeletion.ts`.
- [ ] **Step 4:** Run `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared` — all pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 2: Web delete uses shared

**Files:**
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `frontend/src/pages/GroupsPage.tsx`
- Delete: `frontend/src/lib/restoreDeletedBooks.ts`

**Interfaces:**
- Consumes: `deleteBooks`, `restoreDeletedBooks` from `@scripta/shared`.

- [ ] **Step 1:** In both pages' `handleDeleteSelected`, the updater becomes `(data) => { snapshot = data; return deleteBooks(data, keys); }`. Import `deleteBooks` and `restoreDeletedBooks` from `@scripta/shared`; drop the `../lib/restoreDeletedBooks` import, and drop `removeBooksFromAllGroups` / `bookKey` imports where nothing else in the file uses them.
- [ ] **Step 2:** Delete `frontend/src/lib/restoreDeletedBooks.ts`. `rg -n restoreDeletedBooks frontend/src` shows only the two shared imports and their call sites.
- [ ] **Step 3:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend` — all pass.
- [ ] **Step 4:** `node scripts/gate.mjs`, then commit.

### Task 3: Mobile delete uses shared; stat figure 1.6

**Files:**
- Modify: `mobile/src/features/library/hooks/useLibraryActions.ts`
- Modify: `mobile/src/features/library/components/GroupDetail.tsx`
- Modify: `mobile/src/features/murals/MuralCanvas.tsx`

**Interfaces:**
- Consumes: `deleteBooks` from `@scripta/shared`.

- [ ] **Step 1:** `useLibraryActions.deleteBooks` passes `(data) => deleteBooks(data, keys)` to `run`. `GroupDetail.handleDeleteSelected` passes `(data) => deleteBooks(data, keys)` to `runUpdate`. Drop `removeBooksFromAllGroups` (and `bookKey`, if unused) from both import lists. `useLibraryActions` keeps its `deleteBooks` action name; the object key doesn't clash with the imported `deleteBooks`, so no alias.
- [ ] **Step 2:** `MuralCanvas.tsx:131` `stat: step(1.45, "700")` becomes `step(1.6, "700")`.
- [ ] **Step 3:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile` — all pass.
- [ ] **Step 4:** `node scripts/gate.mjs`, then commit.
- [ ] **Step 5 (device pass, gates merge, not the PR):** dispatch `device-checker` for one screen: a mural with a stats block, before/after not needed — check the figures aren't clipped or wrapped at 1.6 on the emulator. Skip if `node scripts/dev-status.mjs --json` shows another worktree holds the emulator, and say so in the PR.
