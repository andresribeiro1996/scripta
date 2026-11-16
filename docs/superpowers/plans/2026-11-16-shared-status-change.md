# Shared Status Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web and mobile change a book's reading status, decide the finish prompt, list possible duplicates and search groups through one `@scripta/shared` implementation.

**Architecture:** Four pure functions in `packages/shared/src/library/`, consumed by the existing hooks and screens of both clients.

**Tech Stack:** TypeScript, React, React Native/Expo, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-16-shared-status-change-design.md`

**Base:** `main`. This lane must not touch the community lane's Home files (`HomePage.tsx`, `homeModel.ts`) or its shared `community/` files.

## Global Constraints

- No comments in code. Build shared before web or mobile tests. Shared, mobile and web tests are globbed.
- Verify each task with `node scripts/gate.mjs` before committing.

## Review Focus

- **Picking the current status** sends no request on either client and shows no prompt. Task 2.
- **The `LibraryChange` that `statusChange` builds** carries `day` for finished, and no `day` for reading or unread. Task 1.
- **No hook tests exist** in either client. The client behaviour is covered by the shared `statusChange(...) === null` test, plus a browser check of web's status menu in Task 2.
- **The finish prompt** compares against the book as it was before the save. Task 2.

---

### Task 1: Shared functions

**Files:**
- Modify: `packages/shared/src/library/libraryChange.ts`
- Test: `packages/shared/src/library/libraryChange.test.ts`
- Modify: `packages/shared/src/library/finish.ts`
- Test: `packages/shared/src/library/finish.test.ts`
- Modify: `packages/shared/src/library/dedupe.ts`
- Test: `packages/shared/src/library/dedupe.test.ts`
- Modify: `packages/shared/src/library/groups.ts`
- Test: `packages/shared/src/library/groups.test.ts`

**Interfaces:**
- Produces:
  - `statusChange(book, status, day): LibraryChange | null`
  - `promptsFinish(book, status): boolean`
  - `possibleDuplicates(data: LibraryData | undefined): string[][]`
  - `searchGroups(groups, books, search): Group[]`

- [ ] **Step 1:** Write the tests and watch them fail:
  - `statusChange`: unchanged status gives `null`; a missing `ReadStatus` treated as 0 gives `null` for 0; 2 carries `day`; 0 and 1 carry no `day`; `bookKey` matches `bookKey(book)`.
  - `promptsFinish`: true for 1→2 and 0→2; false for 2→2, 2→1 and 1→0.
  - `possibleDuplicates`: certain come before likely, and `undefined` gives `[]`.
  - `searchGroups`: an empty or whitespace search returns the input; matches by group name or by a member book title, case-insensitive; input order is kept.
- [ ] **Step 2:** Implement them, using `setReadStatus`, `bookKey`, `findDuplicates` and `orderedGroupBooks`, which already exist in shared.
- [ ] **Step 3:** Build shared and run its tests. Run `node scripts/gate.mjs`, then commit.

### Task 2: Clients on the shared functions

**Files:**
- Modify: `frontend/src/hooks/useBookActions.ts`
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `frontend/src/pages/GroupsPage.tsx`
- Modify: `mobile/src/features/library/hooks/useLibraryActions.ts`
- Modify: `mobile/src/features/library/hooks/useChangeStatus.ts`
- Modify: `mobile/src/features/library/LibraryScreen.tsx`
- Modify: `mobile/src/features/library/components/GroupsView.tsx`

**Interfaces:**
- Consumes: Task 1's four functions.

- [ ] **Step 1:** Web `setStatus` and mobile `setStatus` build their request from `statusChange(book, status, localDay())`. When it returns `null`, web returns `false` and mobile returns `Promise.resolve(false)`, as its `setRating` does at `:83`. Web `pickStatus` and mobile `useChangeStatus` prompt on `saved && promptsFinish(book, status)`. They still take `readSnapshot(book)` before the save. Drop mobile's now-unused `setReadStatus` import (`useLibraryActions.ts:21`).
- [ ] **Step 2:** `LibraryPage` and `LibraryScreen` rename their local `possibleDuplicates` to `duplicates`, updating its uses at `LibraryPage.tsx:492,498,579-580` and `LibraryScreen.tsx:299,307,353-354`. It becomes `useMemo(() => possibleDuplicates(library?.data), [library])`. Drop the now-unused `findDuplicates` imports (`LibraryPage.tsx:8`, `LibraryScreen.tsx:26`). `GroupsPage` and `GroupsView` keep their own type-filter-and-sort memo, and replace the search memo body with `searchGroups(allGroups, books, search)`. Web's comment block above that memo goes with the code it described.
- [ ] **Step 3:** Run the web and mobile typecheck, lint and tests. In the browser pane, open a book's status menu on web and pick the status that is already checked: the network panel shows no `PATCH /library/books`. Run `node scripts/gate.mjs`, then commit.
