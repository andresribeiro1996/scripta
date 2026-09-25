# My shelf PR 1: status and finish date. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cycling "Mark as …" button with a To read / Reading / Finished control on both clients, and record the finish date when a book moves to Finished.

**Architecture:** One pure helper in `@scripta/shared` (`setReadStatus`) decides what a status change writes. Both clients call it from their existing library-update paths. The label for status 0 becomes "To read" everywhere.

**Tech Stack:** TypeScript, `node:test` via tsx (shared, mobile), Expo/React Native (mobile), React + Tailwind v4 (web).

**Spec:** `docs/superpowers/specs/2026-09-25-my-shelf-release-1-design.md`, section "1. Status and finish date".

## Global Constraints

- No comments in code unless the surrounding file's pattern demands one; put the *why* in the commit message.
- Minimum code that works; reuse `@scripta/shared`; no new packages.
- Status numbers stay 0 / 1 / 2 (`ReadStatus`); filter values (`"unread"` etc.) don't change.
- Label for status 0 is exactly `To read`.
- Finishing sets `DateLastRead` (local `YYYY-MM-DD`) and `___PercentRead: 100`; leaving Finished never clears `DateLastRead`.
- After changing `packages/shared`, run `npm run build --workspace @scripta/shared` before client typechecks.
- In a worktree session, run git as `/usr/bin/git …` from the worktree root (the rtk hook is refused there).

---

### Task 1: Shared status helpers and the "To read" label

**Files:**
- Modify: `packages/shared/src/library/libraryView.ts`
- Modify: `packages/shared/src/library/covers.ts:40-44`
- Test: `packages/shared/src/library/libraryView.test.ts` (create)

**Interfaces:**
- Produces: `type ReadStatus = 0 | 1 | 2`; `localDay(now?: Date): string`; `setReadStatus(book: LibraryBook, status: ReadStatus, day: string): LibraryBook`, which returns the same object when the status is unchanged. All exported from `@scripta/shared` through the existing `export * from "./libraryView.js"`.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/library/libraryView.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { statusLabel } from "./covers.js";
import { STATUS_FILTER_OPTIONS, localDay, setReadStatus } from "./libraryView.js";

test("finishing a book records the day and full progress", () => {
  const book = { Title: "A", ReadStatus: 1, ___PercentRead: 40, DateLastRead: "2024-01-01" };
  assert.deepEqual(setReadStatus(book, 2, "2026-09-25"), { Title: "A", ReadStatus: 2, ___PercentRead: 100, DateLastRead: "2026-09-25" });
});

test("choosing the status a book already has returns the same object", () => {
  const finished = { ReadStatus: 2, DateLastRead: "2025-03-01" };
  assert.equal(setReadStatus(finished, 2, "2026-09-25"), finished);
  const unset = { Title: "B" };
  assert.equal(setReadStatus(unset, 0, "2026-09-25"), unset);
});

test("leaving Finished keeps the recorded day and progress", () => {
  assert.deepEqual(
    setReadStatus({ ReadStatus: 2, DateLastRead: "2025-03-01", ___PercentRead: 100 }, 1, "2026-09-25"),
    { ReadStatus: 1, DateLastRead: "2025-03-01", ___PercentRead: 100 }
  );
});

test("localDay formats the local calendar date", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("status 0 reads as To read", () => {
  assert.equal(statusLabel(0), "To read");
  assert.equal(statusLabel(undefined), "To read");
  assert.equal(STATUS_FILTER_OPTIONS.find((option) => option.value === "unread")?.label, "To read");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL. `setReadStatus`/`localDay` aren't exported, and `statusLabel(0)` is `"Not read"`.

- [ ] **Step 3: Implement**

In `packages/shared/src/library/libraryView.ts`, change the `unread` option's label to `"To read"` in `STATUS_FILTER_OPTIONS`, and add at the end of the file:

```ts
export type ReadStatus = 0 | 1 | 2;

export function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function setReadStatus(book: LibraryBook, status: ReadStatus, day: string): LibraryBook {
  const current = book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0;
  if (current === status) return book;
  if (status === 2) return { ...book, ReadStatus: 2, DateLastRead: day, ___PercentRead: 100 };
  return { ...book, ReadStatus: status };
}
```

In `packages/shared/src/library/covers.ts`, make `statusLabel` return `"To read"` instead of `"Not read"`.

Leave `nextReadStatus` in place for now; Task 4 removes it once no client uses it.

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace @scripta/shared`
Expected: PASS, all shared tests.

- [ ] **Step 5: Build and commit**

```bash
npm run build --workspace @scripta/shared
/usr/bin/git add packages/shared/src/library/libraryView.ts packages/shared/src/library/covers.ts packages/shared/src/library/libraryView.test.ts
/usr/bin/git commit -m "Add setReadStatus and record the finish day"
```

The commit body should say why: finishing in the app never saved a date, so "Finished this year" skipped those books.

---

### Task 2: Mobile status control

**Files:**
- Modify: `mobile/src/features/library/components/BookDetail.tsx`
- Modify: `mobile/src/app/(app)/(library)/book/[key]/index.tsx`
- Modify: `mobile/src/features/library/hooks/useLibraryActions.ts:57-58`
- Modify: `mobile/src/features/library/components/AddBookForm.tsx:21`
- Modify: `mobile/src/features/community/AddBookSheet.tsx:12`

**Interfaces:**
- Consumes: `setReadStatus`, `localDay`, `ReadStatus`, `statusLabel` from `@scripta/shared`; `Segmented` from `mobile/src/ui/components.tsx:366`.
- Produces: `useLibraryActions().setStatus(book, status: ReadStatus)`; the `BookDetail` prop `onSetStatus: (book, status: ReadStatus) => void`.

- [ ] **Step 1: Replace `cycleStatus` in `useLibraryActions`**

Import `localDay`, `setReadStatus` and `type ReadStatus` from `@scripta/shared`, and remove the `nextReadStatus` import. Replace the `cycleStatus` entry with:

```ts
    setStatus: (book: Record<string, unknown>, status: ReadStatus) => {
      const day = localDay();
      if (setReadStatus(book, status, day) === book) return;
      return run(mapBook(bookKey(book), (b) => setReadStatus(b, status, day)), "Couldn't save the status change.");
    },
```

Then run `grep -rn "cycleStatus" mobile/src` and update every caller to `setStatus`. The only expected one is the book route.

- [ ] **Step 2: Replace the button in `BookDetail`**

- Change the prop type to `onSetStatus: (book: Record<string, unknown>, status: ReadStatus) => void`.
- Remove the `nextReadStatus` import, and import `Segmented` from `../../../ui/components` alongside `Button`.
- Delete the `Mark as …` `<Button>` from the actions row, keeping Style and Cover.
- Directly above that actions `<View>`, add:

```tsx
        <Segmented
          accessibilityLabel="Reading status"
          options={STATUS_OPTIONS}
          value={String(book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0) as StatusValue}
          onChange={(value) => onSetStatus(book, Number(value) as ReadStatus)}
        />
```

At module level, below the imports:

```ts
const STATUS_OPTIONS = [
  { value: "0", label: statusLabel(0) },
  { value: "1", label: statusLabel(1) },
  { value: "2", label: statusLabel(2) },
] as const;
type StatusValue = (typeof STATUS_OPTIONS)[number]["value"];
```

- [ ] **Step 3: Wire the route**

In `mobile/src/app/(app)/(library)/book/[key]/index.tsx`, replace `const { cycleStatus } = useLibraryActions();` with `const { setStatus } = useLibraryActions();` and pass `onSetStatus={setStatus}`.

- [ ] **Step 4: Rename the add-book option**

In `AddBookForm.tsx:21` and `community/AddBookSheet.tsx:12`, change the label `"Not read"` to `"To read"`. Values stay the same.

- [ ] **Step 5: Verify**

Run:
```bash
npm run typecheck --workspace mobile
npm test --workspace mobile
```
Expected: both pass. `grep -rn "Not read\|nextReadStatus\|cycleStatus" mobile/src` prints nothing.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add mobile/src
/usr/bin/git commit -m "Mobile: choose a book's status instead of cycling it"
```

---

### Task 3: Web status control

**Files:**
- Modify: `frontend/src/components/BookDetailSheet.tsx`
- Modify: `frontend/src/pages/LibraryPage.tsx:222-235` and `:658`
- Modify: `frontend/src/lib/libraryView.ts`
- Modify: `frontend/src/components/AddBookModal.tsx:28`
- Modify: `frontend/scripts/test-library-view.mts:1,28`

**Interfaces:**
- Consumes: `setReadStatus`, `localDay`, `ReadStatus`, `statusLabel` (the shared exports from Task 1, re-exported through `frontend/src/lib/libraryView.ts` and `frontend/src/lib/covers.ts`).
- Produces: the `BookDetailSheet` prop `onSetStatus: (book, status: ReadStatus) => void`.

- [ ] **Step 1: Re-export the new helpers**

In `frontend/src/lib/libraryView.ts`, replace `nextReadStatus` with `setReadStatus, localDay` in the value export, and add `ReadStatus` to the type export.

- [ ] **Step 2: Update the test script first**

In `frontend/scripts/test-library-view.mts`, change the import to use `setReadStatus` instead of `nextReadStatus`, and replace the `nextReadStatus cycles…` check with:

```ts
const finishedBook = setReadStatus({ ReadStatus: 1 }, 2, "2026-09-25");
check("setReadStatus records the finish day", finishedBook.ReadStatus === 2 && finishedBook.DateLastRead === "2026-09-25" && finishedBook.___PercentRead === 100);
const same = { ReadStatus: 2 };
check("setReadStatus returns the same book when nothing changes", setReadStatus(same, 2, "2026-09-25") === same);
```

Run: `npm test --workspace frontend`
Expected: the new checks pass. If the script fails to import, rebuild shared first.

- [ ] **Step 3: Replace the button in `BookDetailSheet`**

- Change the prop type to `onSetStatus: (book: Record<string, unknown>, status: ReadStatus) => void`.
- Remove the `nextReadStatus` import, and import `type ReadStatus` from `../lib/libraryView`.
- Delete the `Mark as …` button. Keep Style and Cover.
- Under that button row, add:

```tsx
            <div role="radiogroup" aria-label="Reading status" className="mt-3 inline-flex rounded-lg border border-(--color-border) p-0.5">
              {([0, 1, 2] as const).map((status) => {
                const checked = (book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0) === status;
                return (
                  <button
                    key={status}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => { if (!checked) onSetStatus(book, status); }}
                    className={`min-h-11 rounded-md px-3 text-sm font-medium ${checked ? "bg-(--color-accent) text-white" : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}
                  >
                    {statusLabel(status)}
                  </button>
                );
              })}
            </div>
```

- [ ] **Step 4: Update `LibraryPage`**

Replace `handleSetBookStatus` with:

```ts
  async function handleSetBookStatus(book: Record<string, unknown>, status: ReadStatus) {
    const current = queryClient.getQueryData<LibraryDocument>(["library"]);
    if (!current) return;
    const key = bookKey(book);
    const day = localDay();
    try {
      await updateLibrary((data) => ({
        ...data,
        books: data.books.map((b) => (bookKey(b) === key ? setReadStatus(b, status, day) : b))
      }));
    } catch {
      toast({ message: "Couldn't save the status change.", kind: "error" });
    }
  }
```

Update the import from `../lib/libraryView` (drop `nextReadStatus`, add `setReadStatus`, `localDay`, `type ReadStatus`) and the prop at `:658` to `onSetStatus={(b, status) => void handleSetBookStatus(b, status)}`.

- [ ] **Step 5: Rename the add-book option**

In `AddBookModal.tsx:28`, change `"Not read"` to `"To read"`.

- [ ] **Step 6: Verify**

Run:
```bash
npm run typecheck --workspace frontend
npm run lint --workspace frontend
npm test --workspace frontend
```
Expected: all pass. `grep -rn "Not read\|nextReadStatus" frontend/src frontend/scripts` prints nothing.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add frontend
/usr/bin/git commit -m "Web: choose a book's status instead of cycling it"
```

---

### Task 4: Remove `nextReadStatus` and verify everything

**Files:**
- Modify: `packages/shared/src/library/libraryView.ts` (delete `nextReadStatus`)

- [ ] **Step 1: Confirm nothing uses it**

Run: `grep -rn "nextReadStatus" packages mobile/src frontend/src frontend/scripts backend/src`
Expected: only the definition in `libraryView.ts`.

- [ ] **Step 2: Delete it, then run the full verification**

```bash
npm run build --workspace @scripta/shared
npm test --workspace @scripta/shared
npm run typecheck --workspace mobile
npm test --workspace mobile
npm run typecheck --workspace frontend
npm run lint --workspace frontend
npm test --workspace frontend
```
Expected: every command passes.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add packages/shared/src/library/libraryView.ts
/usr/bin/git commit -m "Remove nextReadStatus now that no client cycles statuses"
```
