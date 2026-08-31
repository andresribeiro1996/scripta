# Phase 1 — Book Detail View + Library Search/Filter/Sort Implementation Plan

**Goal:** Give the Library grid a working primary action (a book detail sheet with highlights, actions, and status cycling), plus a client-side search / status filter / sort toolbar. Cards stop being dead buttons; Style/Cover actions become reachable on touch via the sheet.

**Architecture:** Pure view logic (matching, filtering, sorting, status cycling) goes in a new `lib/libraryView.ts`, unit-tested with the repo's `npx tsx scripts/` convention. Two new presentational components (`LibraryToolbar`, `BookDetailSheet`) are wired into `LibraryPage.tsx` only — Series/Collections keep their current behavior except for the touch-target sweep in Task 6. The detail sheet is one component that docks to the bottom on phones (`items-end`) and centers on ≥`sm`, matching the existing modal shell conventions (`bg-black/40` backdrop, `z-50`, stopPropagation). No backend changes, no new dependencies.

**Tech Stack:** React 19 + Vite + TypeScript, Tailwind CSS v4, TanStack Query (existing cache-read/save patterns).

**Spec:** `docs/superpowers/plans/2026-08-31-ux-enhancements-roadmap.md` (Phase 1; decision D-B confirmed). Findings addressed: D1, D2, M5 (touch reachability of Style/Cover), plus the GroupsPage half of M7 deferred from Phase 0.

## Global Constraints

- Run in `frontend/`: `npm run typecheck` and `npm run lint` after every task; both must pass.
- No comments in code unless asked (AGENTS.md).
- Sorting/filtering is client-side only; the stored library document is never modified by toolbar controls.
- Manual verification at 390×844 and 1440×900 after every task; keyboard-only pass for Tasks 3–5.
- Book shape reference: `Title`, `Attribution`, `ReadStatus` (0=Not read, 1=Reading, 2=Finished — see `lib/covers.ts` `statusLabel`), `___PercentRead` (0–100), `highlights[]` with `Text` (the passage), `Annotation` (optional note), `BookmarkID`.

---

### Task 1: `lib/libraryView.ts` — filter/sort/status-cycle logic

**Files:**
- Create: `frontend/src/lib/libraryView.ts`
- Test: `frontend/scripts/test-library-view.mts`

**Interfaces:**
- Produces: `filterBooks(books: LibraryBook[], query: string, status: StatusFilter): LibraryBook[]`; `sortBooks(books: LibraryBook[], key: SortKey): LibraryBook[]`; `nextReadStatus(current: unknown): number`; `STATUS_FILTER_OPTIONS`; `SORT_OPTIONS`; types `StatusFilter = "all" | "unread" | "reading" | "finished"`, `SortKey = "manual" | "title" | "author"`, `LibraryBook = Record<string, unknown>`. Tasks 2–5 import these exact names.

- [ ] **Step 1: Write the failing tests**

Create `frontend/scripts/test-library-view.mts`:

```ts
import { filterBooks, nextReadStatus, sortBooks } from "../src/lib/libraryView";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.error(`FAIL  ${name}`);
  }
}

const books = [
  { Title: "The Left Hand of Darkness", Attribution: "Ursula K. Le Guin", ReadStatus: 2 },
  { Title: "Ancillary Justice", Attribution: "Ann Leckie", ReadStatus: 1 },
  { Title: "Unnamed draft", Attribution: "", ReadStatus: 0 }
];

check("query matches title case-insensitively", filterBooks(books, "justice", "all").length === 1);
check("query matches author", filterBooks(books, "le guin", "all").length === 1);
check("blank query keeps all", filterBooks(books, "   ", "all").length === 3);
check("reading filter => only ReadStatus 1", filterBooks(books, "", "reading").length === 1);
check("finished filter => only ReadStatus 2", filterBooks(books, "", "finished").length === 1);
check("unread filter includes missing ReadStatus", filterBooks([...books, { Title: "No status field" }], "", "unread").length === 2);
check("query and status combine (AND)", filterBooks(books, "ancillary", "finished").length === 0);
check("sort by title", sortBooks(books, "title")[0].Title === "Ancillary Justice");
check("sort by author", sortBooks(books, "author")[0].Attribution === "Ann Leckie");
check("manual sort returns the same reference", sortBooks(books, "manual") === books);
check("nextReadStatus cycles 0->1->2->0", nextReadStatus(0) === 1 && nextReadStatus(1) === 2 && nextReadStatus(2) === 0 && nextReadStatus(undefined) === 1);

if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx scripts/test-library-view.mts` (from `frontend/`)
Expected: module-not-found error for `../src/lib/libraryView`.

- [ ] **Step 3: Implement `lib/libraryView.ts`**

```ts
export type LibraryBook = Record<string, unknown>;
export type StatusFilter = "all" | "unread" | "reading" | "finished";
export type SortKey = "manual" | "title" | "author";

export const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
  { value: "unread", label: "Not read" }
];

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "manual", label: "My order" },
  { value: "title", label: "Title A–Z" },
  { value: "author", label: "Author A–Z" }
];

export function filterBooks(books: LibraryBook[], query: string, status: StatusFilter): LibraryBook[] {
  const q = query.trim().toLowerCase();
  return books.filter((b) => {
    if (status !== "all") {
      const rs = b.ReadStatus;
      if (status === "reading" && rs !== 1) return false;
      if (status === "finished" && rs !== 2) return false;
      if (status === "unread" && (rs === 1 || rs === 2)) return false;
    }
    if (!q) return true;
    return String(b.Title ?? "").toLowerCase().includes(q) || String(b.Attribution ?? "").toLowerCase().includes(q);
  });
}

export function sortBooks(books: LibraryBook[], key: SortKey): LibraryBook[] {
  if (key === "manual") return books;
  const field = key === "title" ? "Title" : "Attribution";
  const sorted = [...books];
  sorted.sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")));
  return sorted;
}

export function nextReadStatus(current: unknown): number {
  if (current === 1) return 2;
  if (current === 2) return 0;
  return 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx scripts/test-library-view.mts`
Expected: `all checks passed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/libraryView.ts frontend/scripts/test-library-view.mts
git commit -m "feat(frontend): library view filter/sort/status-cycle logic with tests"
```

### Task 2: `LibraryToolbar` component

**Files:**
- Create: `frontend/src/components/LibraryToolbar.tsx`

**Interfaces:**
- Consumes: `STATUS_FILTER_OPTIONS`, `SORT_OPTIONS`, `StatusFilter`, `SortKey` from `lib/libraryView.ts` (Task 1).
- Produces: `LibraryToolbar({ query, onQueryChange, status, onStatusChange, sort, onSortChange })` — fully controlled; no internal state.

- [ ] **Step 1: Create the component**

```tsx
import { STATUS_FILTER_OPTIONS, SORT_OPTIONS, type SortKey, type StatusFilter } from "../lib/libraryView";

export function LibraryToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  sort,
  onSortChange
}: {
  query: string;
  onQueryChange: (q: string) => void;
  status: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  sort: SortKey;
  onSortChange: (k: SortKey) => void;
}) {
  const selectClass = "rounded-lg border border-(--color-border) bg-(--color-surface) px-2.5 py-2.5 text-sm";
  return (
    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search title or author…"
        aria-label="Search your library"
        className={`${selectClass} w-full sm:max-w-xs`}
      />
      <div className="flex gap-2 sm:ml-auto">
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          className={selectClass}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          aria-label="Sort books"
          className={selectClass}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/LibraryToolbar.tsx
git commit -m "feat(frontend): library toolbar component (search, status filter, sort)"
```

### Task 3: Wire the toolbar into `LibraryPage`

**Files:**
- Modify: `frontend/src/pages/LibraryPage.tsx`

**Interfaces:**
- Consumes: `LibraryToolbar` (Task 2), `filterBooks`/`sortBooks`/`StatusFilter`/`SortKey` (Task 1).

- [ ] **Step 1: Add state**

Near the other `useState` calls (~line 69):

```tsx
const [query, setQuery] = useState("");
const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
const [sortKey, setSortKey] = useState<SortKey>("manual");
```

Add `filterBooks`, `sortBooks` to the `lib/libraryView` import (new import line) and the two types.

- [ ] **Step 2: Extend the display pipeline**

Change the `displayBooks` memo (currently `orderLibraryBooks(library?.data.books ?? [], library?.data.groups ?? [])`) to:

```tsx
const ordered = useMemo(() => orderLibraryBooks(library?.data.books ?? [], library?.data.groups ?? []), [library]);
const displayBooks = useMemo(
  () => sortBooks(filterBooks(ordered, query, statusFilter), sortKey),
  [ordered, query, statusFilter, sortKey]
);
const toolbarActive = query.trim() !== "" || statusFilter !== "all" || sortKey !== "manual";
```

- [ ] **Step 3: Render toolbar + no-match state**

Immediately after the `{importError && ...}` block (~line 343), inside the `books.length > 0` flow:

```tsx
{books.length > 0 && (
  <LibraryToolbar
    query={query}
    onQueryChange={setQuery}
    status={statusFilter}
    onStatusChange={setStatusFilter}
    sort={sortKey}
    onSortChange={setSortKey}
  />
)}
```

And next to the existing grid render, change `{books.length > 0 && (<BookGrid …>` to also handle the no-match case:

```tsx
{books.length > 0 && displayBooks.length === 0 && (
  <div className="rounded-xl border-2 border-dashed border-(--color-border) py-12 text-center">
    <p className="mb-3 text-(--color-text)">No books match.</p>
    {toolbarActive && (
      <button
        onClick={() => {
          setQuery("");
          setStatusFilter("all");
          setSortKey("manual");
        }}
        className="rounded-lg border border-(--color-border) bg-(--color-surface) px-3.5 py-2.5 text-sm hover:bg-(--color-surface-hover)"
      >
        Clear search and filters
      </button>
    )}
  </div>
)}
{books.length > 0 && displayBooks.length > 0 && (
  <BookGrid style={style}>
    …existing children unchanged…
  </BookGrid>
)}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 5: Verify manually**

With a real library loaded: type a title fragment → grid narrows live; pick "Reading" → only Reading books; sort Title A–Z → series clustering is intentionally flattened (expected — sort overrides manual layout order), switching back to "My order" restores it; nonsense query shows "No books match." + Clear works; with an empty library no toolbar renders. Keyboard: Tab reaches search and both selects, labels announced. 390×844: toolbar stacks (search full-width, selects below right).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LibraryPage.tsx
git commit -m "feat(frontend): search, status filter, and sort on the library grid"
```

### Task 4: `BookDetailSheet` component

**Files:**
- Create: `frontend/src/components/BookDetailSheet.tsx`

**Interfaces:**
- Consumes: `CoverImage` (exported from `components/BookCard.tsx`), `statusLabel` (`lib/covers.ts`), `nextReadStatus` (Task 1).
- Produces: `BookDetailSheet({ book, onOpenStyle, onOpenCoverPicker, onSetStatus, onClose })` where all four callbacks take the `book` object (`onClose` takes none).

- [ ] **Step 1: Create the component**

```tsx
import { useEffect } from "react";
import { CoverImage } from "./BookCard";
import { statusLabel } from "../lib/covers";
import { nextReadStatus } from "../lib/libraryView";

export function BookDetailSheet({
  book,
  onOpenStyle,
  onOpenCoverPicker,
  onSetStatus,
  onClose
}: {
  book: Record<string, unknown>;
  onOpenStyle: (book: Record<string, unknown>) => void;
  onOpenCoverPicker: (book: Record<string, unknown>) => void;
  onSetStatus: (book: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const highlights = Array.isArray(book.highlights)
    ? (book.highlights as Array<Record<string, unknown>>).filter((h) => String(h.Text ?? "").trim() !== "")
    : [];
  const percent = typeof book.___PercentRead === "number" ? Math.round(book.___PercentRead) : null;
  const actionClass =
    "rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2.5 text-sm font-medium hover:bg-(--color-surface-hover)";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-(--color-border) bg-(--color-surface) shadow-lg sm:max-w-3xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-detail-title"
      >
        <div className="flex items-start justify-between gap-3 p-4 pb-0">
          <h3 id="book-detail-title" className="text-sm font-semibold text-(--color-text-dim)">
            Book details
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-[180px_1fr]">
          <div className="relative mx-auto aspect-[2/3] w-32 overflow-hidden rounded-lg bg-(--color-border) sm:w-full">
            <CoverImage book={book} />
          </div>

          <div className="min-w-0">
            <h2 className="text-xl font-bold">{String(book.Title ?? "Untitled")}</h2>
            <p className="mt-1 text-(--color-text-dim)">{String(book.Attribution ?? "Unknown author")}</p>
            <p className="mt-2 text-sm font-medium text-(--color-accent)">
              {statusLabel(book.ReadStatus)}
              {percent !== null && percent > 0 ? ` · ${percent}% read` : ""}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => onOpenStyle(book)} className={actionClass}>
                Style
              </button>
              <button onClick={() => onOpenCoverPicker(book)} className={actionClass}>
                Cover
              </button>
              <button onClick={() => onSetStatus(book)} className={actionClass}>
                Mark as {statusLabel(nextReadStatus(book.ReadStatus))}
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-(--color-border) p-5">
          <h3 className="mb-3 text-sm font-semibold">
            Highlights{highlights.length > 0 ? ` (${highlights.length})` : ""}
          </h3>
          {highlights.length === 0 && <p className="text-sm text-(--color-text-dim)">No highlights yet.</p>}
          <div className="flex flex-col gap-3">
            {highlights.map((h, i) => (
              <div key={String(h.BookmarkID ?? i)} className="border-l-2 border-(--color-border) pl-3">
                <p className="text-sm italic">{String(h.Text)}</p>
                {String(h.Annotation ?? "").trim() !== "" && (
                  <p className="mt-1 text-xs text-(--color-text-dim)">{String(h.Annotation)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/BookDetailSheet.tsx
git commit -m "feat(frontend): book detail sheet component"
```

### Task 5: Wire the detail sheet into `LibraryPage` + hide hover pills on touch

**Files:**
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `frontend/src/components/BookCard.tsx:323`

**Interfaces:**
- Consumes: `BookDetailSheet` (Task 4), `nextReadStatus` (Task 1), existing `saveLibrary`/`queryClient` pattern.

- [ ] **Step 1: Add state and status handler in `LibraryPage.tsx`**

```tsx
const [detailBookKey, setDetailBookKey] = useState<string | null>(null);
```

```tsx
async function handleSetBookStatus(book: Record<string, unknown>) {
  const current = queryClient.getQueryData<LibraryDocument>(["library"]);
  if (!current) return;
  const key = bookKey(book);
  const updatedBooks = current.data.books.map((b) => (bookKey(b) === key ? { ...b, ReadStatus: nextReadStatus(b.ReadStatus) } : b));
  const saved = await saveLibrary({ ...current.data, books: updatedBooks });
  queryClient.setQueryData(["library"], saved);
}
```

Add `nextReadStatus` to the `lib/libraryView` import and import `BookDetailSheet`.

- [ ] **Step 2: Make the card click open the sheet**

In the `BookCard` render (currently `onClick={() => {}}`), change to:

```tsx
onClick={() => setDetailBookKey(bookKey(book))}
```

- [ ] **Step 3: Render the sheet before the existing panels**

Immediately **before** the `{styleBook && (<PerCardStylePanel …` block so the style panel and cover picker (rendered later, same `z-50`) paint above the sheet:

```tsx
{detailBook && (
  <BookDetailSheet
    book={detailBook}
    onOpenStyle={(b) => setStyleBookKey(bookKey(b))}
    onOpenCoverPicker={(b) => setCoverBookKey(bookKey(b))}
    onSetStatus={(b) => void handleSetBookStatus(b)}
    onClose={() => setDetailBookKey(null)}
  />
)}
```

Add next to the existing `styleBook` lookup:

```tsx
const detailBook = detailBookKey ? books.find((b) => bookKey(b) === detailBookKey) : null;
```

Note the sheet must render from the same derived books list as the grid (`books`), so a status change saved through it updates the sheet live via the query cache.

- [ ] **Step 4: Hide hover pills on coarse pointers**

In `BookCard.tsx`, the pills container (line ~323, `absolute top-2.5 left-2.5 flex flex-col items-start gap-1.5 opacity-0 transition-opacity group-hover:opacity-100`) gets one added class:

```
[@media(pointer:coarse)]:hidden
```

Arbitrary-variant form is deliberate — it works on any Tailwind v4.x version without depending on the `pointer-coarse:` named variant shipping in the installed version.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 6: Verify manually**

Desktop 1440×900: click a card → sheet opens centered; Escape, Close, and backdrop click close it; highlights render with notes; "Style" from the sheet opens the per-book panel **above** the sheet and edits apply; "Cover" likewise; "Mark as Reading" changes the status, the card's label, and survives reload; select mode still suppresses the sheet (clicking toggles selection instead). 390×844: sheet docks to the bottom, drag/scroll works, action buttons comfortably tappable, hover pills gone. Keyboard: Tab reaches Close/Style/Cover/Mark-as in the sheet.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/LibraryPage.tsx frontend/src/components/BookCard.tsx
git commit -m "feat(frontend): card click opens book detail sheet with actions and highlights"
```

### Task 6: GroupsPage touch-target sweep

**Files:**
- Modify: `frontend/src/pages/GroupsPage.tsx`

**Interfaces:** none.

- [ ] **Step 1: Bump button paddings**

Open the file and locate its page-header action buttons and select-mode toolbar — search for `py-2 text-sm` (the "Select…"/"Cancel"/"Delete selected"/add-series-collection buttons) and `py-1.5` (any small header buttons). Apply the same mechanical rule as Phase 0 Task 5: `py-2` → `py-2.5`, `py-1.5` → `py-2.5`, and widen `px-3` → `px-3.5` on those buttons only. Do not touch class strings inside the book-picker modal's list items or anywhere else.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 3: Verify manually**

390×844 on `/dashboard/series`: header buttons comfortably tappable; select mode still works end-to-end (select, delete via confirm, cancel). Desktop: unchanged behavior.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/GroupsPage.tsx
git commit -m "fix(frontend): raise GroupsPage header button touch targets"
```

---

## Phase 1 exit criteria

- Typing any word of a title or author finds the book within seconds; status filter and sorts behave per tests; "My order" remains the default and round-trips the series-clustered layout.
- Clicking/tapping a card opens a detail view showing cover, status, progress, and every highlight with its note; all three actions work from it; status changes persist.
- On touch: no hover pills; all card actions reachable via the sheet. On desktop: hover pills still present and functional.
- `npm run typecheck`, `npm run lint`, `npx tsx scripts/test-library-view.mts`, and the existing `scripts/test-*.mts` suites all pass.

## Self-review

- Coverage vs. Phase 1 spec: detail sheet → Task 4/5 (D1, M5); card actions routing per D-B → Task 5 Step 4; toolbar search/filter/sort → Tasks 1–3 (D2); empty-result state → Task 3 Step 3; GroupsPage M7 leftover → Task 6. Status cycling (roadmap "toggle read status") → Tasks 1/5.
- Placeholder scan: every step has exact code or an exact mechanical replacement rule; no TBDs. Task 6's rule is grep-scoped to specific button patterns.
- Type consistency: `LibraryBook = Record<string, unknown>` used in all signatures; `filterBooks`/`sortBooks`/`nextReadStatus` names match across lib, tests, toolbar, and page wiring; `BookDetailSheet` prop names match Task 5's usage (`onOpenStyle`/`onOpenCoverPicker`/`onSetStatus`/`onClose`).
- Behavior guardrails honored: toolbar never writes to the library document (only `handleSetBookStatus` writes, via the established read-current → save → `setQueryData` pattern); select mode still suppresses card click because `BookCard` already routes `selectable` clicks to `onToggleSelect`.
