# Mobile Search Tab Implementation Plan

> **For agentic workers:** run each task with the `implementer` agent, then `spec-reviewer`, then `quality-reviewer` (CLAUDE.md). Device passes go to `device-checker`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile Search tab that finds your books, any catalog book, people and games, with Scan. Making that possible also means making the seeded catalog searchable, opening Games on Browse and retiring the Community screen.

**Architecture:**
- **Part A, backend (PR 1).**
  - The search index gains seeded, publisher and source-confirmed books. A `books_search` table tracks membership: a one-time backfill fills it, and the writes that add books keep it current.
  - The last word of a query matches as a prefix.
  - `GET /books/search?by=work` returns one row per work.
  - Every result carries its canonical `workId`.
  - Discover also returns games that contain a matching book, behind its own limit of 60 a minute per account.
- **Part B, mobile (PR 2).** Games opens on a Browse page. The Community screen goes, and Home's Find readers opens a People screen.
- **Part C, mobile (PR 3).**
  - Groundwork first:
    - a shared library matcher and a pure search model;
    - result rows lifted out of Browse and People;
    - an ISBN scanner lifted out of Add book;
    - Quick add extended.
  - Then the Search screen, its tab and routes, and the Scan screen.

**Tech Stack:**
- Backend: Fastify, `node:sqlite` FTS5, zod, `@fastify/rate-limit`.
- Mobile: Expo Router with React Native, TanStack Query v5, AsyncStorage, `expo-camera`, `expo-symbols`.
- Shared: `@scripta/shared`.
- Tests: `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-13-mobile-search-tab-design.md`

## Global Constraints

- **No code comments** (repo rule). The why goes in commit messages.
- **Reuse, don't rebuild:**
  - From `@scripta/shared`: `bookKey`, `canonicalIsbn`, `normalizeWords`, `looksLikeIsbnQuery`, `localDay`, `saveFailureMessage`, `personCaption`, `contentTarget`, `BookSearchResult`, `LibraryBook`.
  - From mobile: `useDebouncedValue`, `isbnFromBarcode`, `bookSearchApi`, `useLibrary`, `addBookToLibrary`, `toRecommendation`, `workPath`, `AuthorAvatar` and `openProfile`, `BookCover`, `CoverImage`, and the UI kit.
- **Text** comes from `ui/Text` in every `.tsx`, never from `react-native`. `src/ui/textImports.test.ts` fails otherwise.
- **Hrefs** use the codebase's `as never` cast.
- **Touch targets** are at least 44pt.
- **Copy is exactly as below:**
  - **Field:**
    - Tab and header "Search".
    - Placeholder "Books, people, games"; accessibility label "Search books, people and games".
    - The clear button's accessibility label is "Clear search".
  - **Scan:**
    - Button label "Scan"; accessibility label "Scan a book's barcode".
    - The screen's title is "Scan".
    - Hint: "Point at the barcode on the back cover".
  - **Scope control:** "All", "Books", "People", "Games", labelled "Search in".
  - **Before typing:**
    - "Recent", with "Clear".
    - Each row's accessibility label is "Search for <text>".
    - "Readers you might like".
    - "New games".
  - **Section headings:** "In your library", "Books", "People", "Games".
  - **Books caption:** "Tap for details, + to add".
  - **The "See all" link:** "See all".
  - **Results:**
    - "No results for “<query>”."
    - "Not here? Add it by hand"
    - "Still searching Open Library…"
    - "Couldn't reach Open Library."
    - "Nothing in the catalog yet." with the button "Search Open Library"
    - "Retry"
  - **Errors:**
    - "Couldn't load your library."
    - "Couldn't search books."
    - "Couldn't search people."
    - "Couldn't search games."
    - "Couldn't load readers."
    - "Couldn't load games."
  - **The + button:** accessibility label "Add <title>".
  - **Status chips:** "Reading", "To read", "Finished".
  - **Quick add:**
    - "Add to your library as".
    - "To read", "Reading", "Finished".
    - "See the book page first".
    - The finish step's title is "Finished".
  - **Games:**
    - Swipe tab "Browse".
    - Header button "New", accessibility label "New game".
    - Sheet "New game" with "Tournament", "Tier list", "Quiz".
  - **People screen title:** "People".
- **Git:** run it from the worktree root. Stage and commit in one command, because other sessions share the index. End every commit message with the attribution lines your session requires.
- **The backend test list is explicit** (`backend/package.json` `test`). Every backend test in this plan goes into a file already on that list.
- **Verify after every task**, with whichever of these the task touched:
  - **Backend:** `npm run typecheck --workspace backend && npm test --workspace backend`
  - **Shared:** `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace frontend`
  - **Mobile:** `EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck --workspace mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test --workspace mobile`
- **Single-file runs:**
  - Backend: `npm exec --workspace backend -- tsx --test <path from backend/>`.
  - Mobile: `EXPO_PUBLIC_API_URL=http://localhost:3000 npm exec --workspace mobile -- node --import tsx --test <path from mobile/>`.
  - Shared: `npm exec --workspace @scripta/shared -- node --import tsx --test <path from packages/shared/>`.
- **Rebuild shared** after any `packages/shared` edit; backend and mobile read its `dist/`.

## Rulings

These deviate from the spec's wording. Each keeps the intent, and was decided while planning against the code.

1. **Index membership is a `books_search` table keyed by book id, not the rowid.**
   - The spec keyed the index by rowid so that "is it indexed?" is a lookup. `books` has a TEXT primary key, so a future `VACUUM` may renumber its rowids and silently break that mapping.
   - The plan's dry run tried a `searchable` column on `books`. Filling it rewrote almost every page of `books`: on a synthetic copy the size of production's catalog, the write-ahead log peaked at 67 MB, and Litestream copies those pages again. A full volume crash-looped production on 2026-10-04.
   - A separate table writes only its own small rows and is just as fast to look up.
2. **The ISBN branch of `GET /books/search` answers from any indexed book**, the same rule text search uses. Before, it needed `data_sources` to be set.
   - Seeded books are created without sources. So scanning a seeded book's barcode would always have gone to Open Library, even though the book is in the catalog.
3. **The four scope "chips" are the kit's `Segmented` control.** DESIGN.md has no chip control (its "chips" are badges), and `Segmented` is the kit's filter control.
4. **Quick add's Finished shows "how it landed" inside the same sheet**, instead of pushing `/book/<key>/finished`.
   - Quick add is a React Native `Modal`. Presenting a native form sheet while that Modal dismisses is unreliable on iOS.
   - The user sees the same thing: the finish step with no Undo.
5. **On Browse, "New" is a framed header button**, because the floating button would cover Browse's docked search and filter. The three lists keep their floating "New".
6. **The field's clear button is an icon button beside the field.** Android text inputs have no built-in clear button, and the kit's `Input` has no trailing slot.
7. **Recent searches:** a failed read leaves the list empty, and a failed write logs a warning. That's how the theme already treats its own AsyncStorage writes.
8. **Add book's "Add book" button no longer waits for the camera to close.**
   - The scanner now owns its denial and mount-error messages, so the form can't tell a running camera from a refused one.
   - Enabling the button keeps the README's promise that manual entry works after a denied camera. A scan still fills the form and closes the camera.
9. **A scan made on the People or Games chip switches to Books.** A barcode is always a book, and the spec doesn't cover this case.

## Review Focus

1. **A new account with no saved library.**
   - `GET /library` answers 404, and `fetchLibrary` turns that into `null`.
   - Expected: Search shows network results, shows no library error, and offers no "In your library" section.
   - Pinned by Task 11's screen code, which reads `library.data?.data.books ?? []` and reports a failure only when `library.isError` and there is no data. Task 14's device pass checks it with a freshly signed-up account.
2. **Typing straight after pressing Search.**
   - The Open Library line belongs to the submitted text. New typing clears it, so stale external results never mix into a new query.
   - Pinned by Task 7's model test (the Open Library line shows only for a submitted query), the screen's external query keyed by the submitted text, and the Task 14 device pass.
3. **A catalog result for a work you own whose library copy points at an older, merged work id.**
   - `GET /library`'s `works` map and every search result are both canonical, so the result is left out of Books.
   - Pinned by Task 2's canonical-after-merge test and Task 7's owned-work test.
4. **Browse, Search and the New games list all spend Discover's limit.**
   - Expected: one person typing never hits it, and a second account isn't affected by the first.
   - Pinned by Task 3's limit test.
5. **The one-time index backfill runs on the first boot** against ~78k books.
   - Expected: it runs in one transaction, never runs again, and leaves library-only titles out.
   - Pinned by Task 1's backfill test, which adds a book between two migration runs to prove the second run does nothing. The backfill writes only new index rows and membership rows, and never rewrites `books`. The volume's free space is checked before deploying (Task 14, step 1).

**Watch item, no change:**
- About 78k books are indexed, so a query on a common word ranks most of the index. The dry run measured 85–170 ms per query, and `node:sqlite` blocks the event loop while it runs.
- Search runs two such queries per settled query: Books, and Discover's `matchWorks`.
- If the backend feels slow while people search, raise the network minimum to 3 characters or cap the scan in a follow-up.

---

## File structure

| File | Change |
|---|---|
| `backend/src/modules/books/adapters/sqlite/books.sql` | `books_search` membership table |
| `backend/src/modules/books/adapters/sqlite/connection.ts` | One-time index backfill (user_version 3) |
| `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` | Index on write; `isSearchable`; prefix matching; `aliasesOf` |
| `backend/src/modules/books/domain/ports.ts`, `domain/normalize.ts` | `isSearchable` and `aliasesOf`; work search limits |
| `backend/src/modules/books/domain/workSearch.ts` (new) | One edition per work from ranked rows |
| `backend/src/modules/books/booksService.ts`, `routes.ts` | ISBN rule; `by=work`; `workId` on results |
| `backend/src/modules/books/works.ts`, `index.ts` | `matchWorks` |
| `backend/src/modules/community/service.ts`, `routes.ts`, `plugin.ts` | Games by book; Discover's own limit |
| `backend/src/app.ts` | Wire `matchWorks` and `publishedByWorks` into community |
| `packages/shared/src/library/bookSearch.ts` | `workId?` on `BookSearchResult` |
| `packages/shared/src/library/libraryView.ts` | `matchesSearch` |
| `mobile/src/features/arena/arenaHome.ts`, `ArenaHomeScreen.tsx` | Browse first; New game sheet |
| `mobile/src/features/community/DiscoverScreen.tsx`, `mobile/src/app/arena/index.tsx` | Public Discover only |
| `mobile/src/features/community/PeopleScreen.tsx` (new), `mobile/src/app/(app)/(home)/people.tsx` (new) | People in the Home stack |
| Deleted | `(home)/community.tsx`, `(arena)/discover.tsx`, `home/CommunityScreen.tsx`, `home/communityTabs.ts` and its test |
| `mobile/src/features/community/DiscoverRow.tsx`, `PersonRow.tsx`, `useFollowToggle.ts` (new) | Rows shared by Browse, People and Search |
| `mobile/src/features/library/components/IsbnScanner.tsx` (new) | Camera, permission and first-read lock |
| `mobile/src/features/community/AddBookSheet.tsx` | Quick add |
| `mobile/src/features/search/*` (new) | Model, screen, idle and result rows, Recent, scan bridge, Scan screen |
| `mobile/src/app/(app)/(search)/*` (new) | The Search stack |
| Renamed groups | `(home,arena,library,you)` → `(home,arena,library,search,you)`; `(home,library,you)` → `(home,library,search,you)` |
| `mobile/src/app/(public)/book/[key]/{cover,finished,style}.tsx`, `work/[id]/{index,stats}.tsx` | Re-export path names the renamed group |
| `mobile/README.md`, `mobile/.maestro/login-navigation.yaml`, `.claude/agents/beta-tester.md` | Five tabs |

---

## Part A — Backend (PR 1)

### Task 1: The search index holds the catalog

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/booksService.ts` (ISBN branch only)
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`, `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- Produces:
  - Table `books_search (book_id TEXT PRIMARY KEY) WITHOUT ROWID`: the books in `books_fts`.
  - `BooksRepository.isSearchable(id: string): boolean`.
  - `export const CONFIRMED_SQL` in `sqliteBooksRepository.ts`.
  - `makeSearchable(id)` keeps its signature.

- [ ] **Step 1: Failing tests.** Append to `sqliteBooksRepository.test.ts`:

```ts
test("seeded and publisher books are searchable from the moment they are created", () => {
  const { repo } = freshRepo();
  repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272", createdBy: "seed" }, ["isbn:9780141184272"], NOW);
  repo.createBook({ title: "Ensaio sobre a Cegueira", author: "José Saramago", isbn: "9789722113002", createdBy: "publisher" }, ["isbn:9789722113002"], NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12).map((book) => book.title), ["Orlando"]);
  assert.deepEqual(repo.searchBooks(["cegueira"], 12).map((book) => book.title), ["Ensaio sobre a Cegueira"]);
});

test("a library book becomes searchable once a source returns its details, and only once", () => {
  const { db, repo } = freshRepo();
  const book = repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272" }, ["isbn:9780141184272"], NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
  repo.saveDetails(book.id, richDetails, ["openlibrary"], "openlibrary", NOW);
  repo.saveDetails(book.id, richDetails, ["isbndb"], "isbndb", NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12).map((row) => row.id), [book.id]);
  assert.equal(countOf(db, "books_fts"), 1);
});

test("a confirmed book without a title is indexed once it gets one", () => {
  const { repo } = freshRepo();
  const book = repo.createBook({ title: "", author: "", isbn: "9780141184272", createdBy: "seed" }, ["isbn:9780141184272"], NOW);
  assert.deepEqual(repo.searchBooks(["orlando"], 12), []);
  repo.fillIdentity(book.id, "Orlando", "Virginia Woolf");
  assert.deepEqual(repo.searchBooks(["orlando"], 12).map((row) => row.id), [book.id]);
});

test("the one-time backfill indexes the confirmed catalog once, keeps earlier search hits and leaves library-only books out", () => {
  const { db, repo } = freshRepo();
  const insert = db.prepare("INSERT INTO books (id, title, author, data_sources, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("seed-1", "Orlando", "Virginia Woolf", "[]", "seed", NOW);
  insert.run("confirmed-1", "Mrs Dalloway", "Virginia Woolf", '["isbndb"]', null, NOW);
  insert.run("hit-1", "To the Lighthouse", "Virginia Woolf", "[]", null, NOW);
  insert.run("both-1", "The Waves", "Virginia Woolf", '["openlibrary"]', null, NOW);
  insert.run("private-1", "My Private Manuscript", "Virginia Woolf", "[]", null, NOW);
  const fts = db.prepare("INSERT INTO books_fts (book_id, title, author) VALUES (?, ?, ?)");
  fts.run("hit-1", "To the Lighthouse", "Virginia Woolf");
  fts.run("both-1", "The Waves", "Virginia Woolf");
  db.exec("PRAGMA user_version = 2");
  applyBooksMigrations(db);
  assert.deepEqual(repo.searchBooks(["woolf"], 12).map((book) => book.id).sort(), ["both-1", "confirmed-1", "hit-1", "seed-1"]);
  assert.equal(countOf(db, "books_fts"), 4);
  assert.equal(repo.isSearchable("hit-1"), true);
  assert.equal(repo.isSearchable("private-1"), false);
  insert.run("seed-2", "Jacob's Room", "Virginia Woolf", "[]", "seed", NOW);
  applyBooksMigrations(db);
  assert.equal(countOf(db, "books_fts"), 4);
});
```

In the same file, the existing test "the ISBN-10 pass runs once" asserts the migrations stop at version 2. Change its `.user_version, 2);` to `.user_version, 3);`, because the backfill is version 3.

Append to `booksService.test.ts`, after the test "an unknown ISBN searched inside finds nothing and never calls Open Library":

```ts
test("an ISBN search answers from any book in the search index, seeded ones included", () => {
  const { calls, catalog } = recordingCatalog();
  const h = harness({ catalog });
  h.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", createdBy: "seed" }, ["isbn:9780441013593"], "2026-10-01T00:00:00.000Z");
  assert.equal(h.service.search("978-0-441-01359-3")[0]!.title, "Dune");
  assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: Run and expect FAIL.**

```bash
npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/booksService.test.ts
```

The four repository tests and the ISBN test fail, because seeded and confirmed books are not indexed. The existing test "createBook alone does not make a book searchable" must keep passing.

- [ ] **Step 3: Membership table and port.**
  - Append to `books.sql`:

```sql
CREATE TABLE IF NOT EXISTS books_search (
  book_id TEXT PRIMARY KEY
) WITHOUT ROWID;
```

  - In `domain/ports.ts` `interface BooksRepository`, after `makeSearchable(id: string): void;`, add:

```ts
  isSearchable(id: string): boolean;
```

- [ ] **Step 4: Repository.** In `sqliteBooksRepository.ts`:

  1. After `export const WORK_LOOKUP_SQL = ...;` (before `function idPage`), add:

```ts
export const CONFIRMED_SQL = "(created_by IS NOT NULL OR data_sources <> '[]')";
```

  2. Replace the `makeSearchableStmt` declaration with:

```ts
  const makeSearchableStmt = db.prepare(`
    INSERT INTO books_fts (book_id, title, author)
    SELECT id, title, author FROM books
    WHERE id = ? AND title <> '' AND NOT EXISTS (SELECT 1 FROM books_search WHERE book_id = books.id)
  `);
  const markSearchableStmt = db.prepare(`INSERT OR IGNORE INTO books_search (book_id) VALUES (?)`);
  const searchableStmt = db.prepare(`SELECT 1 FROM books_search WHERE book_id = ?`);
  const confirmedStmt = db.prepare(`SELECT 1 FROM books WHERE id = ? AND ${CONFIRMED_SQL}`);
```

  3. Directly after `function inTransaction<T>(...) { ... }` (the helper inside `createSqliteBooksRepository`), add:

```ts
  function makeSearchable(id: string) {
    inTransaction(() => {
      if (makeSearchableStmt.run(id).changes > 0) markSearchableStmt.run(id);
    });
  }

  function makeSearchableIfConfirmed(id: string) {
    if (confirmedStmt.get(id)) makeSearchable(id);
  }
```

  4. In `createBook`, replace `return byIdStmt.get(id) as unknown as BookRow;` with:

```ts
        makeSearchableIfConfirmed(id);
        return byIdStmt.get(id) as unknown as BookRow;
```

  5. Replace `fillIdentity` with:

```ts
    fillIdentity(id, title, author) {
      inTransaction(() => {
        fillIdentityStmt.run(title, author, title ? workTitleKey(title, author) : null, id);
        fillWorkIdentityStmt.run(id);
        makeSearchableIfConfirmed(id);
      });
    },
```

  6. Replace the `makeSearchable(id) { makeSearchableStmt.run(id, id); },` method with:

```ts
    makeSearchable,

    isSearchable: (id) => searchableStmt.get(id) !== undefined,
```

  7. In `saveDetails`, after the `saveDetailsStmt.run(...)` line and inside the same `inTransaction`, add:

```ts
        makeSearchableIfConfirmed(bookId);
```

- [ ] **Step 5: Migration.** In `connection.ts`:

  1. Add the import `import { CONFIRMED_SQL } from "./sqliteBooksRepository.js";`.
  2. Add `indexConfirmedBooks(db);` after `joinIsbn10Editions(db);` in `applyBooksMigrations`.
  3. Add this function after `joinIsbn10Editions`:

```ts
function indexConfirmedBooks(db: DatabaseSync): void {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version >= 3) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("INSERT OR IGNORE INTO books_search (book_id) SELECT book_id FROM books_fts");
    db.exec(`
      INSERT INTO books_fts (book_id, title, author)
      SELECT id, title, author FROM books
      WHERE title <> '' AND ${CONFIRMED_SQL} AND id NOT IN (SELECT book_id FROM books_search)
    `);
    db.exec(`INSERT OR IGNORE INTO books_search (book_id) SELECT id FROM books WHERE title <> '' AND ${CONFIRMED_SQL}`);
    db.exec("PRAGMA user_version = 3");
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
```

- [ ] **Step 6: ISBN branch.** In `booksService.ts`'s `search`, replace

```ts
        return saved && saved.data_sources !== "[]" ? [toSearchResult(saved)] : [];
```

with

```ts
        return saved && deps.repo.isSearchable(saved.id) ? [toSearchResult(saved)] : [];
```

- [ ] **Step 7: Run and expect PASS.**

```bash
npm run typecheck --workspace backend && npm test --workspace backend
```

The existing tests stay green, apart from the `user_version` expectation Step 1 changes. They include "an ISBN search ignores a saved row with no external details so the outside search can fill it in", because a library-created row is still unconfirmed, and "search never returns a book that only came from an account's library".

- [ ] **Step 8: Commit.**

```bash
git add backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/booksService.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/booksService.test.ts && git commit -m "Index the seeded catalog and confirmed books for search" -m "Only books someone had already found through Open Library were searchable, so the 77.8k seeded and publisher books never showed up. Seeded, publisher and source-confirmed books are now indexed, once by a backfill and then as they are written. Membership lives in its own table. The rowid can be renumbered by a VACUUM, and filling a column on books would rewrite nearly every page of a table whose volume has filled up before. A book only an account's library created stays out, which keeps d0087a52's privacy rule. The ISBN branch now answers from the same index, so scanning a seeded book no longer goes to Open Library."
```

---

### Task 2: Prefix matching, one row per work, and work ids

**Files:**
- Modify: `packages/shared/src/library/bookSearch.ts`
- Modify: `backend/src/modules/books/domain/normalize.ts`
- Create: `backend/src/modules/books/domain/workSearch.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/routes.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`, `backend/src/modules/books/booksService.test.ts`, `backend/src/modules/books/routes.test.ts`

**Interfaces:**
- Produces:
  - `BookSearchResult.workId?: string`.
  - `BooksService.search(query: string, options?: { byWork?: boolean }): BookSearchResult[]`.
  - `GET /books/search?q=&by=work`.
  - In `domain/workSearch.ts`:
    - `workIdsOf(rows: BookRow[]): string[]`
    - `firstEditionPerWork(rows: BookRow[], canonical: Map<string, string>): Array<{ row: BookRow; workId: string | null }>`
  - In `domain/normalize.ts`: `WORK_SEARCH_LIMIT = 20`, `WORK_SCAN_LIMIT = 100`, `MIN_PREFIX_LENGTH = 3`.

- [ ] **Step 1: Failing tests.** Append to `sqliteBooksRepository.test.ts`:

```ts
test("the last word matches as a prefix once it has three letters", () => {
  const { repo } = freshRepo();
  repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", createdBy: "seed" }, ["isbn:9780441013593"], NOW);
  assert.deepEqual(repo.searchBooks(["dun"], 12).map((book) => book.title), ["Dune"]);
  assert.deepEqual(repo.searchBooks(["du"], 12), []);
  assert.deepEqual(repo.searchBooks(["dune", "herb"], 12).map((book) => book.title), ["Dune"]);
  assert.deepEqual(repo.searchBooks(["dun", "herbert"], 12), []);
});
```

Append to `booksService.test.ts`:

```ts
test("a search by work returns one edition per work, with its canonical work id", () => {
  const h = harness();
  const at = "2026-10-01T00:00:00.000Z";
  const dune = h.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL893415W", createdBy: "seed" }, ["isbn:9780441013593"], at);
  h.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322", workKey: "OL893415W", createdBy: "seed" }, ["isbn:9780593099322"], at);
  const messiah = h.repo.createBook({ title: "Dune Messiah", author: "Frank Herbert", isbn: "9780593098233", createdBy: "seed" }, ["isbn:9780593098233"], at);
  assert.equal(h.service.search("dune").length, 3);
  assert.deepEqual(h.service.search("dune", { byWork: true }).map((result) => result.workId).sort(), [dune.work_id, messiah.work_id].sort());
  h.db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(dune.work_id, messiah.work_id);
  assert.deepEqual(h.service.search("dune", { byWork: true }).map((result) => result.workId), [dune.work_id]);
  assert.ok(h.service.search("dune").every((result) => result.workId === dune.work_id));
});

test("the inside search finds a book from the start of its last word", async () => {
  const { catalog } = recordingCatalog();
  const h = harness({ catalog });
  await h.service.searchExternal("dune");
  assert.deepEqual(h.service.search("dun").map((result) => result.title).sort(), ["Dune", "Dune Encyclopedia"]);
  assert.deepEqual(h.service.search("du"), []);
});

test("search hits saved from outside carry their canonical work id", async () => {
  const { catalog } = recordingCatalog();
  const h = harness({ catalog });
  const first = await h.service.searchExternal("dune");
  const dune = h.repo.findBookByKey("isbn:9780441013593")!;
  assert.equal(first[0]!.workId, dune.work_id);
  assert.ok(first.every((result) => typeof result.workId === "string"));
  const target = h.repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322", createdBy: "seed" }, ["isbn:9780593099322"], "2026-10-01T00:00:00.000Z");
  h.db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target.work_id, dune.work_id);
  const again = await h.service.searchExternal("dune");
  assert.equal(again[0]!.workId, target.work_id);
});
```

Append to `routes.test.ts`:

```ts
test("catalog search accepts by=work and refuses any other grouping", async () => {
  const { service } = makeService();
  assert.equal((await call(service, { method: "GET", url: "/books/search?q=dune&by=work" }, "u1")).statusCode, 200);
  assert.equal((await call(service, { method: "GET", url: "/books/search?q=dune&by=edition" }, "u1")).statusCode, 400);
});
```

- [ ] **Step 2: Run and expect FAIL.**

```bash
npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/booksService.test.ts src/modules/books/routes.test.ts
```

- [ ] **Step 3: Shared type.** In `packages/shared/src/library/bookSearch.ts`, `interface BookSearchResult` gains a last field:

```ts
  workId?: string;
```

- [ ] **Step 4: Limits.** In `domain/normalize.ts`, under `export const SEARCH_LIMIT = 12;`:

```ts
export const WORK_SEARCH_LIMIT = 20;
export const WORK_SCAN_LIMIT = 100;
export const MIN_PREFIX_LENGTH = 3;
```

- [ ] **Step 5: `domain/workSearch.ts`.**

```ts
import type { BookRow } from "./types.js";

export function workIdsOf(rows: BookRow[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.work_id ? [row.work_id] : [])))];
}

export function firstEditionPerWork(rows: BookRow[], canonical: Map<string, string>): Array<{ row: BookRow; workId: string | null }> {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const workId = row.work_id ? canonical.get(row.work_id) ?? row.work_id : null;
    if (workId !== null && seen.has(workId)) return [];
    if (workId !== null) seen.add(workId);
    return [{ row, workId }];
  });
}
```

- [ ] **Step 6: Prefix matching.** In `sqliteBooksRepository.ts`:
  - Add `MIN_PREFIX_LENGTH` to the existing `../../domain/normalize.js` import.
  - Add this module-level function after `idPage`:

```ts
function matchExpression(tokens: string[]): string {
  return tokens.map((token, index) => (index === tokens.length - 1 && token.length >= MIN_PREFIX_LENGTH ? `"${token}"*` : `"${token}"`)).join(" ");
}
```

  - Then replace the body of `searchBooks` with:

```ts
    searchBooks(tokens, limit) {
      if (tokens.length === 0) return [];
      return searchStmt.all(matchExpression(tokens), limit) as unknown as BookRow[];
    },
```

- [ ] **Step 7: Service.** In `booksService.ts`:

  1. Imports:
     - Add `WORK_SCAN_LIMIT, WORK_SEARCH_LIMIT` to the `./domain/normalize.js` import.
     - Add `import { firstEditionPerWork, workIdsOf } from "./domain/workSearch.js";`.
  2. In `interface BooksService`, change the `search` line to:

```ts
  search(query: string, options?: { byWork?: boolean }): BookSearchResult[];
```

  3. Replace `toSearchResult` and `saveHits` with:

```ts
  function toSearchResult(book: BookRow, workId: string | null): BookSearchResult {
    return {
      title: book.title,
      authors: book.author ? book.author.split(", ") : [],
      year: book.year,
      isbn: book.isbn,
      publisher: book.publisher,
      coverUrl: book.cover_image_id ? deps.publicUrlFor(book.cover_image_id, "thumb") : openLibraryThumb(book.ol_cover_id),
      genres: JSON.parse(book.genres) as BookGenre[],
      ...(workId ? { workId } : {})
    };
  }

  function withWorkIds(rows: BookRow[]): BookSearchResult[] {
    const canonical = deps.repo.canonicalWorkIds(workIdsOf(rows));
    return rows.map((row) => toSearchResult(row, row.work_id ? canonical.get(row.work_id) ?? row.work_id : null));
  }

  function saveHits(hits: CatalogSearchHit[]): BookSearchResult[] {
    const saved = hits.map(({ result, olCoverId, workKey, source }) => {
      const author = result.authors.join(", ");
      const identity = lookupIdentity({ isbn: result.isbn, title: result.title, author });
      if (!identity) return { result, book: null };
      const book = findExisting(deps.repo, identity) ?? deps.repo.createBook(
        { title: result.title, author, isbn: identity.isbn, year: result.year, publisher: result.publisher, olCoverId, workKey, genres: result.genres, sources: [source] },
        keysOf(deps.repo, identity),
        now().toISOString()
      );
      if (!book.title) deps.repo.fillIdentity(book.id, result.title, author);
      deps.repo.setWorkKey(book.id, workKey);
      deps.repo.makeSearchable(book.id);
      return { result: book.cover_image_id ? { ...result, coverUrl: deps.publicUrlFor(book.cover_image_id, "thumb") } : result, book: deps.repo.getBook(book.id) ?? book };
    });
    const canonical = deps.repo.canonicalWorkIds(workIdsOf(saved.flatMap(({ book }) => (book ? [book] : []))));
    return saved.map(({ result, book }) => (book?.work_id ? { ...result, workId: canonical.get(book.work_id) ?? book.work_id } : result));
  }
```

  4. Replace the `search` method with:

```ts
    search(query, options = {}) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      if (looksLikeIsbnQuery(trimmed)) {
        const saved = deps.repo.findBookByKey(`isbn:${canonicalIsbn(trimmed)}`);
        return saved && deps.repo.isSearchable(saved.id) ? withWorkIds([saved]) : [];
      }
      const tokens = searchTokens(trimmed);
      if (tokens.length === 0) return [];
      if (!options.byWork) return withWorkIds(deps.repo.searchBooks(tokens, SEARCH_LIMIT));
      const rows = deps.repo.searchBooks(tokens, WORK_SCAN_LIMIT);
      return firstEditionPerWork(rows, deps.repo.canonicalWorkIds(workIdsOf(rows)))
        .slice(0, WORK_SEARCH_LIMIT)
        .map(({ row, workId }) => toSearchResult(row, workId));
    },
```

- [ ] **Step 8: Route.** In `routes.ts`:
  - Under `const searchSchema = ...`, add:

```ts
const catalogSearchSchema = searchSchema.extend({ by: z.literal("work").optional() });
```

  - Replace the `/books/search` handler with:

```ts
    app.get("/books/search", { preHandler: authGuard }, async (request, reply) => {
      const parsed = catalogSearchSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Send a search query as q." });
      return reply.send({ results: service.search(parsed.data.q, { byWork: parsed.data.by === "work" }) });
    });
```

- [ ] **Step 9: Run and expect PASS.**

```bash
npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run typecheck --workspace backend && npm test --workspace backend
```

- [ ] **Step 10: Commit.**

```bash
git add packages/shared/src/library/bookSearch.ts backend/src/modules/books/domain/normalize.ts backend/src/modules/books/domain/workSearch.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/booksService.ts backend/src/modules/books/routes.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/booksService.test.ts backend/src/modules/books/routes.test.ts && git commit -m "Match the last word as a prefix, group search by work, and return work ids" -m "Search had to work as you type, and \"dun\" found nothing. It now matches the last word as a prefix from three letters. Shorter prefixes would rank most of the catalog on every keystroke. The new Search tab lists works, not editions, and opens a result's work page, so by=work returns one edition per work and every result carries its canonical workId. Without by, results stay editions for Add book."
```

---

### Task 3: Discover finds games by book, behind its own limit

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`, `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/works.ts`, `backend/src/modules/books/index.ts`
- Modify: `backend/src/modules/community/service.ts`, `routes.ts`, `plugin.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/src/modules/books/works.test.ts`, `backend/src/modules/community/service.test.ts`, `backend/src/modules/community/routes.test.ts`
- Fixtures: `backend/src/modules/community/archive.test.ts`, `backend/src/modules/community/backfill.test.ts`, `backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts`

**Interfaces:**
- Consumes: from Task 2, `firstEditionPerWork`, `workIdsOf` and `WORK_SCAN_LIMIT`.
- Produces:
  - `BooksRepository.aliasesOf(workIds: string[]): string[]`.
  - `matchWorks(query: string, limit: number): string[]`, exported from `modules/books/index.ts`.
  - `CommunityDeps.matchWorks`.
  - `publishedByWorks(workIds: string[], limit: number): Array<{ id: string }>` on each of `CommunityDeps.tierlists`, `.tournaments` and `.quizzes`.
  - `buildDiscoverRoutes(service)` in `community/routes.ts`.

- [ ] **Step 1: Failing tests.**

`works.test.ts`: add `matchWorksWith` to the `./works.js` import, then append:

```ts
test("matchWorks returns the best matching works and the works merged into them", () => {
  const { repo, db } = freshRepo();
  const at = "2026-10-04T00:00:00.000Z";
  const dune = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", createdBy: "seed" }, ["isbn:9780441013593"], at);
  const older = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322", createdBy: "seed" }, ["isbn:9780593099322"], at);
  repo.createBook({ title: "Orlando", author: "Virginia Woolf", isbn: "9780141184272", createdBy: "seed" }, ["isbn:9780141184272"], at);
  db.prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(dune.work_id, older.work_id);
  assert.deepEqual(matchWorksWith(repo, "dun", 20), [dune.work_id, older.work_id]);
  assert.deepEqual(matchWorksWith(repo, "zzz", 20), []);
  assert.deepEqual(matchWorksWith(repo, "", 20), []);
});
```

`community/service.test.ts`, in `createDeps`:

  1. After `const quizRefs = new Map<string, PublishedQuizRef>();`, add:

```ts
  const workMatches = new Map<string, string[]>();
  const gameWorks = new Map<string, string[]>();
  const byWorks = (kind: string, ids: string[]) => (workIds: string[]) => ids.filter((id) => (gameWorks.get(`${kind}:${id}`) ?? []).some((work) => workIds.includes(work))).map((id) => ({ id }));
```

  2. In the `deps` object, add the top-level property:

```ts
    matchWorks: (query) => workMatches.get(normalizeWords(query)) ?? [],
```

  3. Add a `publishedByWorks` entry to each game object:
     - In `tierlists: { ... }`: `publishedByWorks: (workIds) => byWorks("tierlist", [...tierlistRefs.keys()])(workIds),`
     - In `tournaments: { ... }`: `publishedByWorks: (workIds) => byWorks("tournament", [...tournamentRefs.keys()])(workIds),`
     - In `quizzes: { ... }`: `publishedByWorks: (workIds) => byWorks("quiz", [...quizRefs.keys()])(workIds),`

  4. Add `workMatches, gameWorks` to the object `createDeps` returns.

Then append the test:

```ts
test("a discover search also finds games that contain a matching book, once each, newest first, paged with the name matches", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tournamentRefs, workMatches, gameWorks } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  tierlistRefs.set("t3", tierRef("t3", "alice", { name: "Frankly speaking", createdAt: at(4) }));
  tierlistRefs.set("t1", tierRef("t1", "alice", { name: "Gothic classics, ranked", createdAt: at(3) }));
  tierlistRefs.set("t2", tierRef("t2", "alice", { name: "Frankenstein and friends", createdAt: at(2) }));
  tournamentRefs.set("g1", tournRef("g1", "alice", { name: "Horror bracket", createdAt: at(1) }));
  workMatches.set("frank", ["w-frankenstein"]);
  gameWorks.set("tierlist:t1", ["w-frankenstein"]);
  gameWorks.set("tierlist:t2", ["w-frankenstein"]);
  gameWorks.set("tournament:g1", ["w-dracula"]);
  const first = service.getDiscover("all", "frank", 2, 0);
  assert.deepEqual(first.items.map((item) => item.content.id), ["t3", "t1"]);
  assert.equal(first.nextOffset, 2);
  const second = service.getDiscover("all", "frank", 2, 2);
  assert.deepEqual(second.items.map((item) => item.content.id), ["t2"]);
  assert.equal(second.nextOffset, null);
  assert.deepEqual(service.getDiscover("tournament", "frank", 10, 0).items, []);
  assert.deepEqual(service.getDiscover("all", "", 10, 0).items.map((item) => item.content.id), ["t3", "t1", "t2", "g1"]);
});
```

`community/routes.test.ts`:
- Change `const { buildCommunityRoutes, buildPublicCommunityRoutes } = await import("./routes.js");` to `const { buildCommunityRoutes, buildDiscoverRoutes, buildPublicCommunityRoutes } = await import("./routes.js");`.
- In the five tests whose names start with "discover", replace `buildPublicCommunityRoutes(` with `buildDiscoverRoutes(`. Left on the public builder, the route is gone and they answer 404.
- Append:

```ts
test("discover allows 60 requests a minute per account", async () => {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildDiscoverRoutes(fakeService()));
  const as = (token: string) => app.inject({ method: "GET", url: "/community/discover", headers: { authorization: `Bearer ${token}` } });
  for (let i = 0; i < 60; i++) assert.equal((await as("alice")).statusCode, 200);
  assert.equal((await as("alice")).statusCode, 429);
  assert.equal((await as("bob")).statusCode, 200);
  await app.close();
});
```

In each `CommunityDeps` fixture, the deps object in `archive.test.ts`, `backfill.test.ts` and `adapters/sqlite/sqliteCommunityRepository.test.ts`:
- Add `matchWorks: unused,` after `searchUsernameOwners: unused,`.
- Add `publishedByWorks: unused` to the `tierlists`, `tournaments` and `quizzes` objects.

`tsx --test` doesn't typecheck. Without the third file, the tests pass and `npm run typecheck --workspace backend` fails.

- [ ] **Step 2: Run and expect FAIL.**

```bash
npm exec --workspace backend -- tsx --test src/modules/books/works.test.ts src/modules/community/service.test.ts src/modules/community/routes.test.ts
```

- [ ] **Step 3: Repository aliases.**
  - In `domain/ports.ts` `interface BooksRepository`, after `canonicalWorkIds(ids: string[]): Map<string, string>;`, add:

```ts
  aliasesOf(workIds: string[]): string[];
```

  - In `sqliteBooksRepository.ts`, next to `canonicalWorksStmt`, add:

```ts
  const aliasesOfStmt = db.prepare(`SELECT id FROM works WHERE merged_into IN (SELECT value FROM json_each(?))`);
```

  - After the `canonicalWorkIds(ids) { ... },` method, add:

```ts
    aliasesOf(workIds) {
      return (aliasesOfStmt.all(JSON.stringify(workIds)) as Array<{ id: string }>).map((row) => row.id);
    },
```

- [ ] **Step 4: `matchWorks`.**
  - In `works.ts`:
    - Change `import type { BookLookup } from "./domain/normalize.js";` to `import { searchTokens, WORK_SCAN_LIMIT, type BookLookup } from "./domain/normalize.js";`.
    - Add `import { firstEditionPerWork, workIdsOf } from "./domain/workSearch.js";`.
    - After `canonicalWorks`, add:

```ts
export function matchWorksWith(books: BooksRepository, query: string, limit: number): string[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const rows = books.searchBooks(tokens, WORK_SCAN_LIMIT);
  const works = firstEditionPerWork(rows, canonicalWorksWith(books, workIdsOf(rows)))
    .flatMap(({ workId }) => (workId ? [workId] : []))
    .slice(0, limit);
  return works.length === 0 ? [] : [...works, ...books.aliasesOf(works)];
}

export function matchWorks(query: string, limit: number): string[] {
  return matchWorksWith(booksRepository(), query, limit);
}
```

  - In `index.ts`, change the works export line to:

```ts
export { canonicalWorks, getWorkPage, matchWorks, resolveWorks } from "./works.js";
```

- [ ] **Step 5: Community service.** In `community/service.ts`:

  1. Under `const DISCOVER_SCAN_CAP = 500;`, add `const DISCOVER_BOOK_WORKS = 20;`.
  2. In `interface CommunityDeps`, add `matchWorks(query: string, limit: number): string[];` after `searchUsernameOwners`. Add `publishedByWorks(workIds: string[], limit: number): Array<{ id: string }>;` as the last member of each of `tierlists`, `tournaments` and `quizzes`.
  3. In `getDiscover`, replace everything from `const needle = normalizeWords(q);` down to and including the `const authors = deps.resolveProfiles(...)` line with:

```ts
      const needle = normalizeWords(q);
      const window = needle ? DISCOVER_SCAN_CAP : Math.min(offset + limit + 1, DISCOVER_SCAN_CAP);
      const workIds = needle ? deps.matchWorks(q, DISCOVER_BOOK_WORKS) : [];
      const byBook = <T>(kind: { publishedByWorks(workIds: string[], limit: number): Array<{ id: string }>; getPublishedMany(ids: string[]): T[] }): T[] =>
        workIds.length === 0 ? [] : kind.getPublishedMany(kind.publishedByWorks(workIds, DISCOVER_SCAN_CAP).map((game) => game.id));
      const entries = new Map<string, { kind: "tierlist" | "tournament" | "quiz"; id: string; userId: string; createdAt: string; promoted: boolean }>();
      const add = (kind: "tierlist" | "tournament" | "quiz", ref: { id: string; ownerUserId: string; createdAt: string }, promoted: boolean) => {
        entries.set(`${kind}:${ref.id}`, { kind, id: ref.id, userId: ref.ownerUserId, createdAt: ref.createdAt, promoted });
      };
      if (type === "all" || type === "tierlist") {
        for (const ref of [...deps.tierlists.discoverWindow(needle, window), ...byBook(deps.tierlists)]) add("tierlist", ref, ref.promotedAt !== null);
      }
      if (type === "all" || type === "tournament") {
        for (const ref of [...deps.tournaments.discoverWindow(needle, window), ...byBook(deps.tournaments)]) add("tournament", ref, false);
      }
      if (type === "all" || type === "quiz") {
        for (const ref of [...deps.quizzes.discoverWindow(needle, window), ...byBook(deps.quizzes)]) add("quiz", ref, false);
      }
      const authors = deps.resolveProfiles([...new Set([...entries.values()].map((e) => e.userId))]);
```

  4. In the next statement, change `const visible = entries` to `const visible = [...entries.values()]`. The rest of `getDiscover` is unchanged.

- [ ] **Step 6: Discover's own limit.** In `community/routes.ts`:
  - Delete the `app.get("/community/discover", ...)` block from `buildPublicCommunityRoutes`.
  - After `buildPublicCommunityRoutes`, add:

```ts
export function buildDiscoverRoutes(service: CommunityService) {
  return async function discoverRoutes(app: FastifyInstance) {
    await app.register(fastifyRateLimit, { max: 60, timeWindow: "1 minute", keyGenerator: rateLimitKey });
    app.get("/community/discover", async (request, reply) => {
      const parsed = discoverQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid type/q/limit/offset." });
      reply.header("Cache-Control", "no-store");
      const viewer = getOptionalAuthenticatedUser(request);
      return reply.send(service.getDiscover(parsed.data.type, parsed.data.q, parsed.data.limit, parsed.data.offset, viewer?.id));
    });
  };
}
```

In `community/plugin.ts`:
- Change the routes import to `import { buildCommunityRoutes, buildDiscoverRoutes, buildPublicCommunityRoutes } from "./routes.js";`.
- After `await app.register(buildCommunityRoutes(service));`, add:

```ts
  await app.register(buildDiscoverRoutes(service));
```

- [ ] **Step 7: Wiring.** In `backend/src/app.ts`:
  - Change the books import to `import { enqueueBookCovers, getWorkPage, matchWorks, registerBooksModule } from "./modules/books/index.js";`.
  - In the `registerCommunityModule` options, add `matchWorks,` after `searchUsernameOwners,`.
  - Add a last entry to each game object:
    - In `tierlists: { ... }`: `publishedByWorks: getTierlistsPublicApi().publishedByWorks,`
    - In `tournaments: { ... }`: `publishedByWorks: getArenaPublicApi().publishedByWorks,`
    - In `quizzes: { ... }`: `publishedByWorks: getQuizzesPublicApi().publishedByWorks,`

- [ ] **Step 8: Run and expect PASS.**

```bash
npm run typecheck --workspace backend && npm test --workspace backend
```

- [ ] **Step 9: Commit.**

```bash
git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/works.ts backend/src/modules/books/index.ts backend/src/modules/community/service.ts backend/src/modules/community/routes.ts backend/src/modules/community/plugin.ts backend/src/app.ts backend/src/modules/books/works.test.ts backend/src/modules/community/service.test.ts backend/src/modules/community/routes.test.ts backend/src/modules/community/archive.test.ts backend/src/modules/community/backfill.test.ts backend/src/modules/community/adapters/sqlite/sqliteCommunityRepository.test.ts && git commit -m "Let a Discover search find games by the books in them" -m "Searching \"frank\" should find a tier list of gothic classics with Frankenstein in it. A Discover query now also returns published games that hold one of the 20 best-matching works, and the works merged into them, as the work page does. They are deduplicated with the name matches and paged the same way. Search now calls Discover as you type, so Discover gets its own limit of 60 a minute keyed by account, instead of sharing the public scope's 30 a minute per IP."
```

PR 1 ends here. Push, open it against `main`, and let CI run. It is additive, so it can merge and deploy on its own. Before deploying, check the Railway volume's free space (Task 14, step 1).

---

## Part B — Games and People (PR 2)

### Task 4: Games opens on Browse

**Files:**
- Modify: `mobile/src/features/arena/arenaHome.ts`, `mobile/src/features/arena/ArenaHomeScreen.tsx`
- Modify: `mobile/src/features/community/DiscoverScreen.tsx`, `mobile/src/features/community/DiscoverPane.tsx` (one label), `mobile/src/app/arena/index.tsx`
- Delete: `mobile/src/app/(app)/(arena)/discover.tsx`
- Test: `mobile/src/features/arena/arenaHome.test.ts`

**Interfaces:**
- Produces:
  - `GAMES_TABS`, whose first entry is `{ value: "browse", label: "Browse" }`.
  - `type GamesTab`.
  - `NEW_GAMES: ReadonlyArray<{ tab: ArenaTab; label: string; href: string }>`.

- [ ] **Step 1: Failing test.**
  - In `arenaHome.test.ts`, add `GAMES_TABS, NEW_GAMES` to the `./arenaHome.js` import.
  - Append:

```ts
test("Games opens on Browse, with your three lists beside it, and New offers each kind", () => {
  assert.deepEqual(GAMES_TABS.map((tab) => tab.label), ["Browse", "Tournaments", "Tier lists", "Quizzes"]);
  assert.equal(GAMES_TABS[0].value, "browse");
  assert.deepEqual(NEW_GAMES.map((option) => [option.tab, option.label, option.href]), [
    ["tournaments", "Tournament", "/seed/new"],
    ["tierlists", "Tier list", "/tierlist/new"],
    ["quizzes", "Quiz", "/quiz/new"],
  ]);
});
```

- [ ] **Step 2: Run and expect FAIL** (the exports are missing).

- [ ] **Step 3: Model.** In `arenaHome.ts`, after `export type ArenaTab = ...;`:

```ts
export const GAMES_TABS = [{ value: "browse", label: "Browse" }, ...ARENA_TABS] as const;

export type GamesTab = (typeof GAMES_TABS)[number]["value"];

export const NEW_GAMES = [
  { tab: "tournaments", label: "Tournament", href: "/seed/new" },
  { tab: "tierlists", label: "Tier list", href: "/tierlist/new" },
  { tab: "quizzes", label: "Quiz", href: "/quiz/new" },
] as const satisfies ReadonlyArray<{ tab: ArenaTab; label: string; href: string }>;
```

- [ ] **Step 4: Screen.** In `ArenaHomeScreen.tsx`:

  1. Add `Sheet` to the `../../ui` import.
  2. Add `import { DiscoverPane } from "../community/DiscoverPane";`.
  3. Add `GAMES_TABS,` and `NEW_GAMES,` to the `./arenaHome` import list, and `type GamesTab,` after `type ArenaTab,`.
  4. Replace `const [tab, setTab] = useState<ArenaTab>("tournaments");` with:

```tsx
  const [tab, setTab] = useState<GamesTab>(GAMES_TABS[0].value);
  const [choosing, setChoosing] = useState(false);
```

  5. In the `Stack.Screen` options, replace the `headerRight: () => <IconButton framed accessibilityLabel="Browse games" ... />,` line with:

```tsx
        headerRight: tab === "browse" ? () => <IconButton framed accessibilityLabel="New game" label="New" name="add" onPress={() => setChoosing(true)} /> : undefined,
```

  6. Change `options={ARENA_TABS}` to `options={GAMES_TABS}`, and make `browse` the first case inside `renderPage`:

```tsx
      renderPage={(pageTab) => {
        if (pageTab === "browse") return <DiscoverPane />;
        const owned = ownedItems(pageTab, tournaments.data ?? [], tierlists.data ?? [], quizzes.data ?? []);
```

  The rest of `renderPage` is unchanged.

  7. Replace the `<Fab ... />` element with:

```tsx
    {tab === "browse" ? null : (
      <Fab
        label="New"
        accessibilityLabel={tab === "tournaments" ? "New tournament" : tab === "quizzes" ? "New quiz" : "New tier list"}
        loading={busy && !deleting}
        onPress={() => router.push(NEW_GAMES.find((option) => option.tab === tab)!.href as never)}
      />
    )}
```

  8. After the `<Dialog ...>...</Dialog>` element, add:

```tsx
    <Sheet visible={choosing} title="New game" onClose={() => setChoosing(false)}>
      <View style={styles.dialog}>
        {NEW_GAMES.map((option) => (
          <Button
            key={option.href}
            label={option.label}
            variant="secondary"
            onPress={() => {
              setChoosing(false);
              router.push(option.href as never);
            }}
          />
        ))}
      </View>
    </Sheet>
```

  9. Remove `ARENA_TABS` from the `./arenaHome` import. The swipe options were its only use in this file.

- [ ] **Step 5: Public Discover only.** Replace `mobile/src/features/community/DiscoverScreen.tsx` with:

```tsx
import { Stack } from "expo-router";
import { Screen } from "../../ui";
import { DiscoverPane } from "./DiscoverPane";

export function DiscoverScreen() {
  return (
    <Screen bottom top={false}>
      <Stack.Screen options={{ headerShown: true, title: "Discover" }} />
      <DiscoverPane linkAuthors={false} />
    </Screen>
  );
}
```

In `mobile/src/app/arena/index.tsx`, change `return <DiscoverScreen inTabs={false} />;` to `return <DiscoverScreen />;`. Then:

```bash
git rm -q "mobile/src/app/(app)/(arena)/discover.tsx"
rg -n '"/discover"|DiscoverScreen inTabs' mobile/src
```

The `rg` must print nothing.

In `DiscoverPane.tsx`, change the search field's `accessibilityLabel` from `"Search tier lists, tournaments and quizzes by name"` to `"Search tier lists, tournaments and quizzes by name or book"`. Since Task 3, Discover also matches the books in a game.

- [ ] **Step 6: Verify** (mobile commands). Every test passes.

- [ ] **Step 7: Commit.** `git rm` already staged the deleted route, so it isn't listed here; `git add` on a removed path stops with "pathspec did not match".

```bash
git add mobile/src/features/arena/arenaHome.ts mobile/src/features/arena/arenaHome.test.ts mobile/src/features/arena/ArenaHomeScreen.tsx mobile/src/features/community/DiscoverScreen.tsx mobile/src/features/community/DiscoverPane.tsx mobile/src/app/arena/index.tsx && git commit -m "Open Games on Browse, with your own lists beside it" -m "Discover lived twice, as Community's tab and behind Games' Browse button. Games now opens on Browse, and Tournaments, Tier lists and Quizzes follow it, so there is one Discover. On Browse, New is a header button that asks which kind to make, because the floating button would cover Browse's docked search and filter. The lists keep their floating New."
```

---

### Task 5: People screen; Community retires

**Files:**
- Create: `mobile/src/features/community/PeopleScreen.tsx`, `mobile/src/app/(app)/(home)/people.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Delete: `mobile/src/app/(app)/(home)/community.tsx`, `mobile/src/features/home/CommunityScreen.tsx`, `mobile/src/features/home/communityTabs.ts`, `mobile/src/features/home/communityTabs.test.ts`

- [ ] **Step 1: `PeopleScreen.tsx`.**

```tsx
import { Stack } from "expo-router";
import { Screen } from "../../ui";
import { PeoplePane } from "./PeoplePane";

export function PeopleScreen() {
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "People", headerShown: true }} />
      <PeoplePane />
    </Screen>
  );
}
```

- [ ] **Step 2: Route `(home)/people.tsx`.**

```tsx
import { PeopleScreen } from "@/features/community/PeopleScreen";

export default function PeopleRoute() {
  return <PeopleScreen />;
}
```

- [ ] **Step 3: Home.** In `HomeScreen.tsx`, change `const findReaders = () => router.push("/community?tab=people" as never);` to:

```tsx
  const findReaders = () => router.push("/people" as never);
```

- [ ] **Step 4: Delete Community.**

```bash
git rm -q "mobile/src/app/(app)/(home)/community.tsx" mobile/src/features/home/CommunityScreen.tsx mobile/src/features/home/communityTabs.ts mobile/src/features/home/communityTabs.test.ts
rg -n "CommunityScreen|communityTabs|\"/community" mobile/src
```

The `rg` must print nothing.

- [ ] **Step 5: Verify** (mobile commands).

- [ ] **Step 6: Commit.** Step 4's `git rm` already staged the four deletions.

```bash
git add mobile/src/features/community/PeopleScreen.tsx "mobile/src/app/(app)/(home)/people.tsx" mobile/src/features/home/HomeScreen.tsx && git commit -m "Retire the Community screen; Find readers opens People" -m "With Discover in Games and people search on its way to the Search tab, Community had nothing of its own left. Home's Find readers opens the People pane in the Home stack, rather than switching tabs, because a cross-tab push would land on whatever the other stack has open."
```

PR 2 ends here. Push, then open it against `main`, or stacked on PR 1 and retargeted to `main` before `--auto`.

---

## Part C — Search tab (PR 3)

Part C needs Part A's shared `workId` type. Base it on `main` after PR 1 merges, or stack it on PR 1's branch.

### Task 6: A library matcher in `@scripta/shared`

**Files:**
- Modify: `packages/shared/src/library/libraryView.ts`
- Test: `packages/shared/src/library/libraryView.test.ts`

**Interfaces:**
- Produces: `matchesSearch(book: LibraryBook, query: string): boolean`.

- [ ] **Step 1: Failing tests.**
  - Add `matchesSearch` to the `./libraryView.js` import in `libraryView.test.ts`.
  - Append:

```ts
test("a library search matches the start of any title or author word, ignoring case and accents", () => {
  const dune = { Title: "Dune", Attribution: "Frank Herbert", ISBN: "0441013597" };
  assert.equal(matchesSearch(dune, "dun"), true);
  assert.equal(matchesSearch(dune, "HERB"), true);
  assert.equal(matchesSearch(dune, "dune herb"), true);
  assert.equal(matchesSearch(dune, "une"), false);
  assert.equal(matchesSearch(dune, "dune asimov"), false);
  assert.equal(matchesSearch({ Title: "Hábitos Atómicos", Attribution: "James Clear" }, "habitos"), true);
  assert.equal(matchesSearch(dune, "   "), false);
});

test("a library search for an ISBN matches either form of the book's ISBN", () => {
  const dune = { Title: "Dune", Attribution: "Frank Herbert", ISBN: "0441013597" };
  assert.equal(matchesSearch(dune, "978-0-441-01359-3"), true);
  assert.equal(matchesSearch(dune, "0441013597"), true);
  assert.equal(matchesSearch(dune, "9780441013594"), false);
  assert.equal(matchesSearch({ Title: "No ISBN" }, "9780441013593"), false);
});
```

- [ ] **Step 2: Run and expect FAIL.** `npm exec --workspace @scripta/shared -- node --import tsx --test src/library/libraryView.test.ts`

- [ ] **Step 3: Implement.** At the top of `libraryView.ts`:

```ts
import { canonicalIsbn, normalizeWords } from "./bookMatch.js";
import { looksLikeIsbnQuery } from "./bookSearch.js";
```

After `filterBooks`:

```ts
export function matchesSearch(book: LibraryBook, query: string): boolean {
  const trimmed = query.trim();
  if (looksLikeIsbnQuery(trimmed)) return canonicalIsbn(trimmed) === canonicalIsbn(book.ISBN);
  const words = normalizeWords(trimmed).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const candidates = normalizeWords(`${String(book.Title ?? "")} ${String(book.Attribution ?? "")}`).split(" ").filter(Boolean);
  return words.every((word) => candidates.some((candidate) => candidate.startsWith(word)));
}
```

- [ ] **Step 4: Run and expect PASS** (shared commands, then mobile typecheck).

- [ ] **Step 5: Commit.**

```bash
git add packages/shared/src/library/libraryView.ts packages/shared/src/library/libraryView.test.ts && git commit -m "Add a word-start, accent-blind library matcher" -m "Search's \"In your library\" section matches the start of any title or author word, folds accents like the catalog does, and matches a scanned ISBN in either form. filterBooks keeps its substring match for the Library screen."
```

---

### Task 7: The search model

**Files:**
- Create: `mobile/src/features/search/searchModel.ts`, `mobile/src/features/search/searchModel.test.ts`

**Interfaces:**
- Produces, all from `searchModel.ts`:
  - **Scopes:**
    - `SEARCH_SCOPES`, `type SearchScope`.
    - `type ResultSection = "library" | "books" | "people" | "games"`.
    - `SCOPE_OF: Record<ResultSection, SearchScope>`.
  - **Copy and limits:** `SECTION_TITLES`, `SECTION_ERRORS`, `SECTION_PREVIEW = 3`, `RECENT_LIMIT = 8`, `NEW_GAMES = 5`.
  - **Rules:**
    - `isNetworkQuery(query): boolean`.
    - `idleSections(scope): { readers: boolean; newGames: boolean }`.
  - **Rows:**
    - `interface SectionState<T> { rows: T[]; loading: boolean; failed: boolean }`.
    - `interface ResultsInput`.
    - `type SearchRow`.
    - `searchRows(input: ResultsInput): SearchRow[]`.
  - **Books:**
    - `libraryStatus(book)`.
    - `interface OwnedBooks`.
    - `ownedBooks(books, works?)`.
    - `mergeBookResults(catalog, outside, owned)`.
  - **Recent:** `recentSearchesKey(userId)`, `readRecentSearches(raw)`, `recordRecentSearch(list, query)`.

- [ ] **Step 1: Failing tests.** Create `searchModel.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookSearchResult } from "@scripta/shared";
import type { DiscoverItem, PersonResult } from "@scripta/shared/community";
import { idleSections, libraryStatus, mergeBookResults, ownedBooks, readRecentSearches, recentSearchesKey, recordRecentSearch, searchRows, type ResultsInput, type SearchRow } from "./searchModel.js";

const result = (title: string, workId?: string, isbn: string | null = null): BookSearchResult => ({ title, authors: ["Author"], year: 2001, isbn, publisher: null, coverUrl: null, genres: [], ...(workId ? { workId } : {}) });
const person = (userId: string) => ({ user: { userId, username: userId, avatarUrl: null }, followerCount: 0, private: false }) as unknown as PersonResult;
const game = (id: string) => ({ author: { username: "bob", avatarUrl: null }, content: { kind: "tierlist", id, name: id } }) as unknown as DiscoverItem;
const done = <T>(rows: T[]) => ({ rows, loading: false, failed: false });
const input = (overrides: Partial<ResultsInput> = {}): ResultsInput => ({
  scope: "all",
  query: "frank",
  submitted: false,
  library: done([]),
  books: done([]),
  people: done([]),
  games: done([]),
  openLibrary: "idle",
  ...overrides,
});
const kinds = (rows: SearchRow[]) => rows.map((row) => (row.kind === "header" || row.kind === "loading" || row.kind === "failed" ? `${row.kind}:${row.section}` : row.kind));
const header = (rows: SearchRow[], section: string) => rows.find((row) => row.kind === "header" && row.section === section);

test("below two characters only your own matches show, with no No results line", () => {
  assert.deepEqual(kinds(searchRows(input({ query: "f", library: done([{ Title: "Frankenstein" }]) }))), ["header:library", "library"]);
  assert.deepEqual(searchRows(input({ query: "f" })), []);
});

test("All shows each section's first three rows in order, with See all when there are more", () => {
  const rows = searchRows(input({
    library: done([{ Title: "Frankenstein" }]),
    books: done([result("1", "w1"), result("2", "w2"), result("3", "w3"), result("4", "w4")]),
    people: done([person("p1")]),
    games: done([game("g1")]),
  }));
  assert.deepEqual(kinds(rows), ["header:library", "library", "header:books", "book", "book", "book", "addByHand", "header:people", "person", "header:games", "game"]);
  assert.deepEqual(header(rows, "books"), { kind: "header", key: "header:books", section: "books", seeAll: true });
  assert.deepEqual(header(rows, "people"), { kind: "header", key: "header:people", section: "people", seeAll: false });
});

test("a kind's chip shows only that kind, every row", () => {
  const people = ["p0", "p1", "p2", "p3", "p4"].map(person);
  assert.deepEqual(kinds(searchRows(input({ scope: "people", people: done(people), books: done([result("1", "w1")]) }))), ["header:people", "person", "person", "person", "person", "person"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "books", library: done([{ Title: "Frankenstein" }]), books: done([result("1", "w1")]), people: done(people) }))), ["header:library", "library", "header:books", "book", "addByHand"]);
});

test("Books offers Open Library until the query is submitted, then follows it", () => {
  assert.deepEqual(kinds(searchRows(input({ scope: "books" }))), ["header:books", "catalogEmpty", "addByHand"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "books", openLibrary: "pending" }))), ["header:books", "catalogEmpty", "addByHand"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "books", submitted: true, openLibrary: "pending" }))), ["header:books", "openLibrary", "addByHand"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "books", submitted: true, books: done([result("1", "w1")]), openLibrary: "failed" }))), ["header:books", "book", "openLibrary", "addByHand"]);
});

test("No results shows once every section is done and empty, with Add it by hand where books are searched", () => {
  assert.deepEqual(kinds(searchRows(input({ submitted: true }))), ["noResults", "addByHand"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "people" }))), ["noResults"]);
});

test("a loading or failed section keeps its heading", () => {
  assert.deepEqual(kinds(searchRows(input({ scope: "people", people: { rows: [], loading: true, failed: false } }))), ["header:people", "loading:people"]);
  assert.deepEqual(kinds(searchRows(input({ scope: "games", games: { rows: [], loading: false, failed: true } }))), ["header:games", "failed:games"]);
});

test("before typing, readers and new games follow the chip", () => {
  assert.deepEqual(idleSections("all"), { readers: true, newGames: true });
  assert.deepEqual(idleSections("books"), { readers: false, newGames: false });
  assert.deepEqual(idleSections("people"), { readers: true, newGames: false });
  assert.deepEqual(idleSections("games"), { readers: false, newGames: true });
});

test("a library row's chip reads its shelf", () => {
  assert.deepEqual(libraryStatus({ ReadStatus: 1 }), { label: "Reading", tone: "accent" });
  assert.deepEqual(libraryStatus({ ReadStatus: 2 }), { label: "Finished", tone: "success" });
  assert.deepEqual(libraryStatus({}), { label: "To read", tone: "neutral" });
});

test("Open Library results merge into Books by work, and works you own are left out", () => {
  const owned = ownedBooks([{ Title: "Mine", ISBN: "0441013597" }], { "isbn:9780441013593": "w-owned" });
  const catalog = [result("Dune", "w-dune"), result("Owned", "w-owned")];
  const outside = [result("Dune again", "w-dune"), result("New", "w-new"), result("Owned by ISBN", undefined, "9780441013593"), result("Loose", undefined, "9781234567897")];
  assert.deepEqual(mergeBookResults(catalog, outside, owned).map((book) => book.title), ["Dune", "New", "Loose"]);
});

test("recent searches keep the newest eight, once each, ignoring case and surrounding spaces", () => {
  let list: string[] = [];
  for (const query of ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]) list = recordRecentSearch(list, query);
  assert.deepEqual(list, ["nine", "eight", "seven", "six", "five", "four", "three", "two"]);
  assert.deepEqual(recordRecentSearch(list, "  SEVEN "), ["SEVEN", "nine", "eight", "six", "five", "four", "three", "two"]);
  assert.deepEqual(recordRecentSearch(list, "   "), list);
  assert.equal(recentSearchesKey("u1"), "search.recent.u1");
});

test("stored recent searches are read back safely", () => {
  assert.deepEqual(readRecentSearches(null), []);
  assert.deepEqual(readRecentSearches("not json"), []);
  assert.deepEqual(readRecentSearches('["dune", 3, "frank"]'), ["dune", "frank"]);
  assert.deepEqual(readRecentSearches('{"a":1}'), []);
});
```

- [ ] **Step 2: Run and expect FAIL** (module not found).

- [ ] **Step 3: Implement** `searchModel.ts`:

```ts
import { bookKey, canonicalIsbn, type BookSearchResult, type LibraryBook } from "@scripta/shared";
import type { DiscoverItem, PersonResult } from "@scripta/shared/community";

export const SEARCH_SCOPES = [
  { value: "all", label: "All" },
  { value: "books", label: "Books" },
  { value: "people", label: "People" },
  { value: "games", label: "Games" },
] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number]["value"];
export type ResultSection = "library" | "books" | "people" | "games";

export const SECTION_PREVIEW = 3;
export const RECENT_LIMIT = 8;
export const NEW_GAMES = 5;
const MIN_NETWORK_QUERY = 2;

export const SECTION_TITLES: Record<ResultSection, string> = { library: "In your library", books: "Books", people: "People", games: "Games" };
export const SECTION_ERRORS: Record<ResultSection, string> = {
  library: "Couldn't load your library.",
  books: "Couldn't search books.",
  people: "Couldn't search people.",
  games: "Couldn't search games.",
};
export const SCOPE_OF: Record<ResultSection, SearchScope> = { library: "books", books: "books", people: "people", games: "games" };

const SECTIONS_IN: Record<SearchScope, readonly ResultSection[]> = {
  all: ["library", "books", "people", "games"],
  books: ["library", "books"],
  people: ["people"],
  games: ["games"],
};

export function isNetworkQuery(query: string): boolean {
  return query.trim().length >= MIN_NETWORK_QUERY;
}

export function idleSections(scope: SearchScope): { readers: boolean; newGames: boolean } {
  return { readers: scope === "all" || scope === "people", newGames: scope === "all" || scope === "games" };
}

export interface SectionState<T> {
  rows: T[];
  loading: boolean;
  failed: boolean;
}

export interface ResultsInput {
  scope: SearchScope;
  query: string;
  submitted: boolean;
  library: SectionState<LibraryBook>;
  books: SectionState<BookSearchResult>;
  people: SectionState<PersonResult>;
  games: SectionState<DiscoverItem>;
  openLibrary: "idle" | "pending" | "failed";
}

export type SearchRow =
  | { kind: "header"; key: string; section: ResultSection; seeAll: boolean }
  | { kind: "library"; key: string; book: LibraryBook }
  | { kind: "book"; key: string; result: BookSearchResult }
  | { kind: "person"; key: string; person: PersonResult }
  | { kind: "game"; key: string; item: DiscoverItem }
  | { kind: "loading"; key: string; section: ResultSection }
  | { kind: "failed"; key: string; section: ResultSection }
  | { kind: "catalogEmpty"; key: string }
  | { kind: "openLibrary"; key: string; state: "pending" | "failed" }
  | { kind: "addByHand"; key: string }
  | { kind: "noResults"; key: string };

export function searchRows(input: ResultsInput): SearchRow[] {
  const network = isNetworkQuery(input.query);
  const cap = input.scope === "all" ? SECTION_PREVIEW : Number.POSITIVE_INFINITY;
  const rows = SECTIONS_IN[input.scope]
    .filter((section) => network || section === "library")
    .flatMap((section) => sectionRows(section, input, cap));
  if (rows.length > 0 || !network) return rows;
  const noResults: SearchRow = { kind: "noResults", key: "noResults" };
  return SECTIONS_IN[input.scope].includes("books") ? [noResults, { kind: "addByHand", key: "addByHand" }] : [noResults];
}

function sectionRows(section: ResultSection, input: ResultsInput, cap: number): SearchRow[] {
  const state = input[section];
  const header = (seeAll: boolean): SearchRow => ({ kind: "header", key: `header:${section}`, section, seeAll });
  if (state.loading) return [header(false), { kind: "loading", key: `loading:${section}`, section }];
  if (state.failed) return [header(false), { kind: "failed", key: `failed:${section}`, section }];
  const items = itemRows(section, input, cap);
  const seeAll = state.rows.length > cap;
  if (section !== "books") return items.length > 0 ? [header(seeAll), ...items] : [];
  const addByHand: SearchRow = { kind: "addByHand", key: "addByHand" };
  const openLibrary: SearchRow[] = input.submitted && input.openLibrary !== "idle" ? [{ kind: "openLibrary", key: "openLibrary", state: input.openLibrary }] : [];
  if (items.length > 0 || openLibrary.length > 0) return [header(seeAll), ...items, ...openLibrary, addByHand];
  return input.submitted ? [] : [header(false), { kind: "catalogEmpty", key: "catalogEmpty" }, addByHand];
}

function itemRows(section: ResultSection, input: ResultsInput, cap: number): SearchRow[] {
  switch (section) {
    case "library":
      return input.library.rows.slice(0, cap).map((book): SearchRow => ({ kind: "library", key: `library:${bookKey(book)}`, book }));
    case "books":
      return input.books.rows.slice(0, cap).map((result, index): SearchRow => ({ kind: "book", key: `book:${result.workId ?? index}`, result }));
    case "people":
      return input.people.rows.slice(0, cap).map((person): SearchRow => ({ kind: "person", key: `person:${person.user.userId}`, person }));
    case "games":
      return input.games.rows.slice(0, cap).map((item): SearchRow => ({ kind: "game", key: `game:${item.content.kind}:${item.content.id}`, item }));
  }
}

export function libraryStatus(book: LibraryBook): { label: string; tone: "accent" | "neutral" | "success" } {
  if (book.ReadStatus === 1) return { label: "Reading", tone: "accent" };
  if (book.ReadStatus === 2) return { label: "Finished", tone: "success" };
  return { label: "To read", tone: "neutral" };
}

export interface OwnedBooks {
  workIds: Set<string>;
  isbns: Set<string>;
}

export function ownedBooks(books: LibraryBook[], works: Record<string, string> = {}): OwnedBooks {
  return {
    workIds: new Set(Object.values(works)),
    isbns: new Set(books.flatMap((book) => {
      const isbn = canonicalIsbn(book.ISBN);
      return isbn ? [isbn] : [];
    })),
  };
}

export function mergeBookResults(catalog: BookSearchResult[], outside: BookSearchResult[], owned: OwnedBooks): BookSearchResult[] {
  const works = new Set<string>();
  const isbns = new Set<string>();
  return [...catalog, ...outside].filter((result) => {
    const isbn = canonicalIsbn(result.isbn);
    if (result.workId ? owned.workIds.has(result.workId) : isbn !== "" && owned.isbns.has(isbn)) return false;
    if ((result.workId && works.has(result.workId)) || (isbn && isbns.has(isbn))) return false;
    if (result.workId) works.add(result.workId);
    if (isbn) isbns.add(isbn);
    return true;
  });
}

export function recentSearchesKey(userId: string): string {
  return `search.recent.${userId}`;
}

export function readRecentSearches(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) return [];
    throw err;
  }
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_LIMIT) : [];
}

export function recordRecentSearch(list: string[], query: string): string[] {
  const text = query.trim();
  if (!text) return list;
  const same = text.toLowerCase();
  return [text, ...list.filter((entry) => entry.toLowerCase() !== same)].slice(0, RECENT_LIMIT);
}
```

- [ ] **Step 4: Run and expect PASS** (mobile commands).

- [ ] **Step 5: Commit.**

```bash
git add mobile/src/features/search/searchModel.ts mobile/src/features/search/searchModel.test.ts && git commit -m "Add the Search tab's model" -m "The rules for which sections show live in one tested function: the per-chip sections, All's three-row previews, Books holding its place until the query is submitted, and the No results line. The same file holds merging Open Library results into Books by work, leaving out works you own, and Recent searches."
```

---

### Task 8: Rows shared by Browse, People and Search

No behaviour change in Browse or People.

**Files:**
- Create: `mobile/src/features/community/DiscoverRow.tsx`, `PersonRow.tsx`, `useFollowToggle.ts`
- Modify: `mobile/src/features/community/DiscoverPane.tsx`, `PeoplePane.tsx`

**Interfaces:**
- Produces:
  - `DiscoverRow({ item, linkAuthor, onPreviewBooks?, onOpen? })`. "See books" shows only when `onPreviewBooks` is passed.
  - `StatusBadge({ label, tone })`.
  - `PersonRow({ person, busy, onToggleFollow, onOpen? })`.
  - `useFollowToggle(): { busyId: string | null; error: string | null; toggle: (person: PersonResult) => Promise<void> }`.

- [ ] **Step 1: `DiscoverRow.tsx`.**
  - Move these out of `DiscoverPane.tsx` unchanged:
    - the functions `StatusBadge`, `FanThumb`, `TournamentThumb` and `Cover`;
    - the constants from `THUMB_WIDTH` through `VERSUS_WIDTH`;
    - these style entries: `shrink`, `strong`, `row`, `metaRow`, `nameRow`, `metaName`, `statusRow`, `rowAction`, `badge`, `thumb`, `ladder`, `cover`, `versus`, `versusText`.
    - Copy `grow` into `DiscoverRow.tsx` as well. Both files use it.
  - Export `StatusBadge`.
  - `DiscoverRow` changes its signature and two spots:

```tsx
export function DiscoverRow({ item, linkAuthor, onPreviewBooks, onOpen }: { item: DiscoverItem; linkAuthor: boolean; onPreviewBooks?: (tournament: { id: string; name: string }) => void; onOpen?: () => void }) {
```

  - Its outer `Pressable` gets:

```tsx
    <Pressable accessibilityRole="link" accessibilityLabel={`Open ${content.name}`} onPress={() => { onOpen?.(); router.push(contentTarget(content) as never); }}>
```

  - Its "See books" condition becomes:

```tsx
              {content.kind === "tournament" && onPreviewBooks ? (
```

  - The file's imports are:

```tsx
import { router } from "expo-router";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { DEFAULT_TIER_PRESET, readerGlyphLabel } from "@scripta/shared";
import { dynamicType, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../ui";
import type { ContentTone, DiscoverItem, PublishedContent } from "@scripta/shared/community";
import { contentKindLabel, contentStats, contentStatus, contentTarget } from "./communityHome";
import { openProfile } from "./AuthorAvatar";
import { ReaderGlyph } from "./ReaderGlyph";
```

  - `DiscoverPane.tsx`:
    - Keeps its list, dock and sheets, and its own `grow`, `page`, `list`, `dock`, `searchField` and `cycle` styles.
    - Imports `DiscoverRow` from `./DiscoverRow`.
    - Renders `<DiscoverRow item={item} onPreviewBooks={setPreview} linkAuthor={linkAuthors} />`, as before.
    - Drops every import that only the moved code used.

- [ ] **Step 2: `useFollowToggle.ts`.** This is `PeoplePane`'s `toggle`, moved:

```ts
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { followFailureMessage, type PersonResult } from "@scripta/shared/community";
import { followUser, unfollowUser } from "./api";

export function useFollowToggle() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(person: PersonResult) {
    setBusyId(person.user.userId);
    setError(null);
    try {
      if (person.viewerFollows) {
        await unfollowUser(person.user.userId);
      } else {
        await followUser(person.user.userId);
      }
      await queryClient.invalidateQueries({ queryKey: ["community", "people"] });
    } catch (reason) {
      setError(followFailureMessage(reason, "Couldn't update who you follow."));
    } finally {
      setBusyId(null);
    }
  }

  return { busyId, error, toggle };
}
```

- [ ] **Step 3: `PersonRow.tsx`.** This is the body of `PeoplePane`'s `renderItem`, moved:

```tsx
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { readerGlyphLabel } from "@scripta/shared";
import { Button, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { personCaption, type PersonResult, type SuggestedReader } from "@scripta/shared/community";
import { BookCover } from "../arena/BookCover";
import { AuthorAvatar, openProfile } from "./AuthorAvatar";
import { ReaderGlyph } from "./ReaderGlyph";

export function PersonRow({ person, busy, onToggleFollow, onOpen }: { person: PersonResult | SuggestedReader; busy: boolean; onToggleFollow: () => void; onOpen?: () => void }) {
  const { colors } = useTheme();
  const glyphLabel = readerGlyphLabel(person.user.readerGlyph);
  const suggestion = "sharedCount" in person ? person : null;
  const caption = personCaption(person);
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[`Open ${person.user.username}'s profile`, glyphLabel, caption].filter(Boolean).join(", ")}
        onPress={() => {
          onOpen?.();
          openProfile(person.user.username);
        }}
        style={[styles.actorRow, styles.grow]}
      >
        <AuthorAvatar username={person.user.username} avatarUrl={person.user.avatarUrl} />
        <View style={styles.grow}>
          <View style={styles.nameRow}>
            <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, styles.metaName, { color: colors.text }]}>
              {person.user.username}
            </Text>
            <ReaderGlyph identity={person.user.readerGlyph} />
          </View>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>
            {caption}
          </Text>
        </View>
        {suggestion?.sharedBooks.length ? (
          <View style={styles.covers}>
            {suggestion.sharedBooks.slice(0, 3).map((book, index) => (
              <View key={`${index}:${book.coverUrl}`} style={index > 0 ? styles.overlap : undefined}>
                <BookCover cover={book.coverUrl} title={book.title} width={24} height={36} />
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
      {person.private ? null : (
        <Button label={person.viewerFollows ? "Following" : "Follow"} variant={person.viewerFollows ? "secondary" : "primary"} loading={busy} onPress={onToggleFollow} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  actorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metaName: { flexShrink: 1 },
  covers: { flexDirection: "row", alignItems: "center" },
  overlap: { marginLeft: -6 },
});
```

  - `PeoplePane.tsx`:
    - Replaces its `toggle`, `busyId`, `error` and `queryClient` with `const { busyId, error, toggle } = useFollowToggle();`.
    - Its `renderItem` becomes:

```tsx
          renderItem={({ item }) => <PersonRow person={item} busy={busyId === item.user.userId} onToggleFollow={() => void toggle(item)} />}
```

    - Drops the styles and imports only the moved code used. It keeps only `page`, `list` and `suggestionsCaption`; `grow` moves with the row.

- [ ] **Step 3b: Check the moves.** Confirm nothing outside the new files and the two panes still refers to the moved code:

```bash
rg -n "function (DiscoverRow|StatusBadge|FanThumb|TournamentThumb|Cover)\b|function toggle\b" mobile/src/features/community
```

  This must print only `DiscoverRow.tsx`, plus `useFollowToggle.ts` for `toggle`.

- [ ] **Step 4: Verify** (mobile commands).

- [ ] **Step 5: Commit.**

```bash
git add mobile/src/features/community/DiscoverRow.tsx mobile/src/features/community/PersonRow.tsx mobile/src/features/community/useFollowToggle.ts mobile/src/features/community/DiscoverPane.tsx mobile/src/features/community/PeoplePane.tsx && git commit -m "Lift Browse's and People's rows out of their panes" -m "The Search tab shows the same game and person rows. A row can now report that it was opened, which Search uses to remember the query, and Browse's \"See books\" shows only where a pane hands it a books sheet."
```

---

### Task 9: An ISBN scanner Add book and Search both use

**Files:**
- Create: `mobile/src/features/library/components/IsbnScanner.tsx`
- Modify: `mobile/src/features/library/components/AddBookForm.tsx`

**Interfaces:**
- Produces: `IsbnScanner({ hint, onIsbn }: { hint: string; onIsbn: (isbn: string) => void })`.
  - It asks for the camera once per mount.
  - It shows the denial messages and "Open Settings".
  - It only runs the camera while focused and while the app is active.
  - It passes on the first ISBN it reads.

- [ ] **Step 1: `IsbnScanner.tsx`.**

```tsx
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useIsFocused } from "expo-router/react-navigation";
import { Text } from "../../../ui/Text";
import { Button } from "../../../ui/components";
import { radii, spacing, typography, useTheme } from "../../../ui/theme";
import { isbnFromBarcode } from "../lib/isbnBarcode";

export function IsbnScanner({ hint, onIsbn }: { hint: string; onIsbn: (isbn: string) => void }) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const focused = useIsFocused();
  const asked = useRef(false);
  const consumed = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!permission || permission.granted || asked.current) return;
    asked.current = true;
    setRequesting(true);
    requestPermission()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't access the camera. Type the ISBN instead."))
      .finally(() => setRequesting(false));
  }, [permission, requestPermission]);

  if (error) return <Text selectable accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>{error}</Text>;
  if (!permission || requesting) return <View style={styles.pending}><ActivityIndicator accessibilityLabel="Starting the camera" color={colors.accent} /></View>;
  if (!permission.granted) {
    return (
      <View style={styles.message}>
        <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>
          {permission.canAskAgain
            ? "Allow camera access to scan a book, or type the ISBN instead."
            : "Camera access is disabled. Enable it in Settings, or type the ISBN instead."}
        </Text>
        {permission.canAskAgain ? null : (
          <Button label="Open Settings" variant="secondary" onPress={() => {
            void Linking.openSettings().catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't open Settings."));
          }} />
        )}
      </View>
    );
  }
  return (
    <View style={styles.scanner}>
      <View style={[styles.frame, { backgroundColor: colors.surface }]}>
        {focused && appActive ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "code128"] }}
            onBarcodeScanned={({ data }) => {
              if (consumed.current || AppState.currentState !== "active") return;
              const isbn = isbnFromBarcode(data);
              if (!isbn) return;
              consumed.current = true;
              onIsbn(isbn);
            }}
            onMountError={({ message }) => {
              consumed.current = true;
              setError(message || "Couldn't start the camera. Type the ISBN instead.");
            }}
          />
        ) : null}
      </View>
      <Text style={[typography.caption, { color: colors.textDim }]}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scanner: { gap: spacing.sm },
  frame: { aspectRatio: 4 / 3, borderRadius: radii.lg, overflow: "hidden" },
  pending: { padding: spacing.lg, alignItems: "center" },
  message: { gap: spacing.sm },
});
```

- [ ] **Step 2: `AddBookForm.tsx` uses it.**

  1. **Imports:**
     - `react-native` loses `Linking`.
     - Delete the `expo-camera` and `expo-router/react-navigation` imports.
     - `../../../ui/theme` loses `radii`.
     - Replace `import { isbnFromBarcode } from "../lib/isbnBarcode";` with `import { IsbnScanner } from "./IsbnScanner";`.
  2. **State:** delete `permission`/`requestPermission`, `requestingCamera`, `scanError`, `scanRun`, `scanConsumed`, `focused` and `appActive`. Keep `scanning`.
  3. **Effects:** replace the `useFocusEffect` cleanup and the `AppState` effect with:

```tsx
  useFocusEffect(useCallback(() => () => {
    searchRun.current++;
    setScanning(false);
    setSearching(false);
    setOutsidePending(false);
  }, []));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") setScanning(false);
    });
    return () => subscription.remove();
  }, []);
```

  4. **Toggle:** replace `toggleScanner` with:

```tsx
  function toggleScanner() {
    if (scanning) {
      setScanning(false);
      return;
    }
    Keyboard.dismiss();
    searchRun.current++;
    setSearching(false);
    setOutsidePending(false);
    setOutsideFailed(false);
    setSearchError(null);
    setResults(null);
    setScanning(true);
  }
```

  5. **Search:** in `runSearch`, replace `scanConsumed.current = true;\n    setScanning(false);` with `setScanning(false);`.
  6. **Render:** replace the scan button, the two `scanError` blocks and the `scanning && focused && appActive && (...)` camera block with:

```tsx
        <Button label={scanning ? "Stop scanning" : "Scan ISBN with camera"} variant="secondary" disabled={saving} onPress={toggleScanner} />
        {scanning && (
          <IsbnScanner
            hint="Point at the ISBN barcode on the back cover."
            onIsbn={(scannedIsbn) => {
              setQuery(scannedIsbn);
              setIsbn(scannedIsbn);
              setTitle("");
              setAuthor("");
              setPublisher("");
              setGenres([]);
              setSaveError(null);
              void runSearch(scannedIsbn);
            }}
          />
        )}
```

  7. **Add book:** its `disabled` becomes `disabled={title.trim() === "" || author.trim() === ""}`.
     - The scanner now shows its own denial and mount-error messages, so `scanning` stays true while they are on screen. Keeping `scanning ||` would leave Add book disabled after a denied camera.
     - `mobile/README.md` promises that manual entry stays available in that case.

- [ ] **Step 3: Verify** (mobile commands).

- [ ] **Step 4: Commit.**

```bash
git add mobile/src/features/library/components/IsbnScanner.tsx mobile/src/features/library/components/AddBookForm.tsx && git commit -m "Move the ISBN camera into its own component" -m "The Search tab's Scan screen needs the same camera that Add book has: the permission prompt and its two denial messages, Open Settings, no camera while unfocused or in the background, and only the first ISBN read. Add book keeps its behaviour and still stops scanning when the app goes to the background."
```

---

### Task 10: Quick add

**Files:**
- Modify: `mobile/src/features/community/AddBookSheet.tsx`

**Interfaces:**
- Produces:
  - `AddBookSheet` accepts `book.year?: number | null` and `book.workId?: string`.
  - The link to the work page shows only when the caller passes `workId`. Today's callers don't.

- [ ] **Step 1: Replace `AddBookSheet.tsx`'s component and styles.**
  - `STATUS_OPTIONS` stays.
  - Keep the signed-out block exactly as it is.
  - Imports:

```tsx
import { useState } from "react";
import { router, useGlobalSearchParams, usePathname, useSegments } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import { bookKey, localDay, saveFailureMessage } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Sheet, Toast, dynamicType, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { FinishedScreen } from "../library/FinishedScreen";
import { addBookToLibrary } from "../library/api/client";
import { useLibrary } from "../library/hooks/useLibrary";
import { toRecommendation } from "../library/lib/recommendation";
import { pathWithQuery } from "../auth/navigation";
import { workPath } from "../works/workPath";
```

Component:

```tsx
export function AddBookSheet({
  book,
  onClose,
}: {
  book: { title: string; author: string; isbn?: string | null; coverUrl?: string | null; year?: number | null; workId?: string };
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const segments = useSegments();
  const library = useLibrary({ enabled: false });
  const [busyStatus, setBusyStatus] = useState<0 | 1 | 2 | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [finished, setFinished] = useState<Record<string, unknown> | null>(null);

  if (!user) {
    return (
      <Sheet visible title="Add to library" onClose={onClose}>
        <View style={styles.signedOut}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim, textAlign: "center" }]}>Sign in to add books to your library.</Text>
          <Button label="Sign in" onPress={() => router.push({ pathname: "/(public)/login", params: { returnTo: pathWithQuery(pathname, params) } } as never)} />
        </View>
      </Sheet>
    );
  }

  async function handleAdd(readStatus: 0 | 1 | 2) {
    setBusyStatus(readStatus);
    setToast(null);
    try {
      const { key, updated } = await addBookToLibrary({ ...toRecommendation(book, readStatus), day: localDay() });
      if (readStatus === 2) {
        const { data } = await library.refetch();
        const added = data?.data.books.find((entry) => bookKey(entry) === key);
        if (added) {
          setFinished(added);
          return;
        }
      }
      setToast({ message: updated ? "Updated in your library." : "Added to your library.", tone: "success" });
      setTimeout(onClose, 1600);
    } catch (error) {
      setToast({ message: saveFailureMessage(error, "Could not add the book."), tone: "error" });
    } finally {
      setBusyStatus(null);
    }
  }

  if (finished) {
    return (
      <Sheet visible title="Finished" onClose={onClose}>
        <FinishedScreen book={finished} before={null} onClose={onClose} />
      </Sheet>
    );
  }

  const workId = book.workId;
  return (
    <Sheet visible title="Add to library" onClose={onClose}>
      <View style={styles.book}>
        <BookCover cover={book.coverUrl ?? null} title={book.title} width={96} height={138} />
        <View style={styles.text}>
          <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{book.title}</Text>
          <Text numberOfLines={2} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{[book.author, book.year].filter(Boolean).join(" · ")}</Text>
        </View>
      </View>
      <Text {...dynamicType} style={[typography.caption, styles.strong, { color: colors.textDim }]}>Add to your library as</Text>
      <View style={styles.actions}>
        {STATUS_OPTIONS.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            variant="secondary"
            loading={busyStatus === option.value}
            disabled={busyStatus !== null}
            onPress={() => void handleAdd(option.value)}
          />
        ))}
      </View>
      {workId ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            onClose();
            router.push(workPath(workId, segments) as never);
          }}
          style={styles.link}
        >
          <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text, textDecorationLine: "underline" }]}>See the book page first</Text>
        </Pressable>
      ) : null}
      {toast ? <Toast visible message={toast.message} tone={toast.tone} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  signedOut: { gap: spacing.md, paddingVertical: spacing.lg },
  book: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md },
  text: { flex: 1, gap: spacing.xs, justifyContent: "center" },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
  strong: { fontWeight: "700" },
  link: { minHeight: minimumTouchTarget, justifyContent: "center", alignSelf: "flex-start" },
});
```

- [ ] **Step 2: Verify** (mobile commands).

- [ ] **Step 3: Commit.**

```bash
git add mobile/src/features/community/AddBookSheet.tsx && git commit -m "Ask how a book landed when it is added as Finished" -m "Adding a book as Finished from another reader's shelf, a tournament, a tier list or the Search tab now opens the finish step in the same sheet, once the library has reloaded with the book. It opens without Undo, because the book has no earlier state. The step stays in the sheet because Quick add is a React Native Modal, and stacking a native form sheet on a closing Modal is unreliable on iOS. The sheet also shows the year and offers the work page when the caller knows the work."
```

---

### Task 11: The Search screen

The screen is built and tested by typecheck here. Task 12 gives it a route.

**Files:**
- Create: `mobile/src/features/search/SearchScreen.tsx`, `SearchIdle.tsx`, `SearchResultRow.tsx`, `useRecentSearches.ts`
- Modify: `mobile/src/features/library/api/search.ts`, `mobile/src/ui/icon.tsx`
- Modify: `mobile/src/features/library/components/AddBookForm.tsx` and `mobile/src/app/(app)/(home,library,you)/add-book.tsx` (the `?q=` prefill)

**Interfaces:**
- Consumes:
  - Task 6: `matchesSearch`.
  - Task 7: the model.
  - Task 8: `DiscoverRow`, `StatusBadge`, `PersonRow`, `useFollowToggle`.
  - Task 10: `AddBookSheet` with `year` and `workId`.
- Produces:
  - `SearchScreen()`.
  - `searchCatalogWorks(query): Promise<BookSearchResult[]>`.
  - `useRecentSearches(): { searches: string[]; record(query: string): void; clear(): void }`.
  - Glyph `recent`.
  - `AddBookForm` prop `initialQuery?: string`.

- [ ] **Step 1: Glyph.** In `ui/icon.tsx` `GLYPHS`, after `search`, add:

```ts
  recent: { ios: "clock.arrow.circlepath", android: "history" },
```

- [ ] **Step 2: Catalog API.** In `mobile/src/features/library/api/search.ts`, append:

```ts
export async function searchCatalogWorks(query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return (await apiClient.request<{ results: BookSearchResult[] }>(`/books/search?${new URLSearchParams({ q: trimmed, by: "work" })}`, { auth: true })).results;
}
```

- [ ] **Step 3: `useRecentSearches.ts`.**

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../core/auth";
import { readRecentSearches, recentSearchesKey, recordRecentSearch } from "./searchModel";

export function useRecentSearches() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["search", "recent", user?.id ?? ""];
  const key = recentSearchesKey(user?.id ?? "");
  const recent = useQuery({ queryKey, queryFn: async () => readRecentSearches(await AsyncStorage.getItem(key)), enabled: !!user, retry: false });

  function save(next: string[]) {
    queryClient.setQueryData(queryKey, next);
    AsyncStorage.setItem(key, JSON.stringify(next)).catch((err: unknown) => {
      console.warn("Couldn't save recent searches on this device.", err);
    });
  }

  return {
    searches: recent.data ?? [],
    record: (query: string) => save(recordRecentSearch(queryClient.getQueryData<string[]>(queryKey) ?? [], query)),
    clear: () => save([]),
  };
}
```

- [ ] **Step 4: `SearchResultRow.tsx`.**

```tsx
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { bookKey, type BookSearchResult, type LibraryBook } from "@scripta/shared";
import { Text } from "../../ui/Text";
import { Button, ErrorState, IconButton, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { BookCover } from "../arena/BookCover";
import { DiscoverRow, StatusBadge } from "../community/DiscoverRow";
import { PersonRow } from "../community/PersonRow";
import type { useFollowToggle } from "../community/useFollowToggle";
import { CoverImage } from "../library/components/CoverImage";
import { SCOPE_OF, SECTION_ERRORS, SECTION_TITLES, libraryStatus, type ResultSection, type SearchRow, type SearchScope } from "./searchModel";

export type ResultActions = {
  query: string;
  follow: ReturnType<typeof useFollowToggle>;
  onOpen: () => void;
  onAdd: (result: BookSearchResult) => void;
  onSeeAll: (scope: SearchScope) => void;
  onRetry: (section: ResultSection) => void;
  onSearchOpenLibrary: () => void;
  onRetryOpenLibrary: () => void;
};

export function SearchResultRow({ row, actions }: { row: SearchRow; actions: ResultActions }) {
  const { colors } = useTheme();
  switch (row.kind) {
    case "header":
      return (
        <SectionTitle
          title={SECTION_TITLES[row.section]}
          caption={row.section === "books" ? "Tap for details, + to add" : undefined}
          action={row.seeAll ? { label: "See all", onPress: () => actions.onSeeAll(SCOPE_OF[row.section]) } : undefined}
        />
      );
    case "library":
      return <LibraryResultRow book={row.book} onOpen={actions.onOpen} />;
    case "book":
      return <BookResultRow result={row.result} onOpen={actions.onOpen} onAdd={actions.onAdd} />;
    case "person":
      return (
        <View style={styles.pad}>
          <PersonRow person={row.person} busy={actions.follow.busyId === row.person.user.userId} onToggleFollow={() => void actions.follow.toggle(row.person)} onOpen={actions.onOpen} />
        </View>
      );
    case "game":
      return <DiscoverRow item={row.item} linkAuthor onOpen={actions.onOpen} />;
    case "loading":
      return <View style={styles.pad}><Skeleton height={60} /></View>;
    case "failed":
      return <View style={styles.pad}><ErrorState body={SECTION_ERRORS[row.section]} actionLabel="Retry" onAction={() => actions.onRetry(row.section)} /></View>;
    case "catalogEmpty":
      return (
        <View style={[styles.pad, styles.stack]}>
          <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>Nothing in the catalog yet.</Text>
          <Button label="Search Open Library" variant="secondary" onPress={actions.onSearchOpenLibrary} />
        </View>
      );
    case "openLibrary":
      return row.state === "pending" ? (
        <Text {...dynamicType} style={[typography.caption, styles.pad, styles.line, { color: colors.textDim }]}>Still searching Open Library…</Text>
      ) : (
        <View style={[styles.pad, styles.stack]}>
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>Couldn't reach Open Library.</Text>
          <Button label="Retry" variant="secondary" onPress={actions.onRetryOpenLibrary} />
        </View>
      );
    case "addByHand":
      return (
        <Pressable accessibilityRole="link" onPress={() => router.push(`/add-book?q=${encodeURIComponent(actions.query)}` as never)} style={[styles.pad, styles.link]}>
          <Text {...dynamicType} style={[typography.body, styles.strong, { color: colors.text, textDecorationLine: "underline" }]}>Not here? Add it by hand</Text>
        </Pressable>
      );
    case "noResults":
      return <Text {...dynamicType} style={[typography.body, styles.pad, styles.line, { color: colors.textDim }]}>No results for “{actions.query}”.</Text>;
  }
}

export function SectionTitle({ title, caption, action }: { title: string; caption?: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useTheme();
  return (
    <View style={styles.title}>
      <Text accessibilityRole="header" {...dynamicType} numberOfLines={1} style={[typography.body, styles.strong, styles.shrink, { color: colors.text }]}>{title}</Text>
      {caption ? <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.shrink, styles.right, { color: colors.textDim }]}>{caption}</Text> : null}
      {action ? (
        <Pressable accessibilityRole="button" hitSlop={12} onPress={action.onPress} style={caption ? undefined : styles.right}>
          <Text {...dynamicType} style={[typography.body, { color: colors.accent }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LibraryResultRow({ book, onOpen }: { book: LibraryBook; onOpen: () => void }) {
  const { colors } = useTheme();
  const title = String(book.Title ?? "Untitled");
  const author = String(book.Attribution ?? "Unknown author");
  const status = libraryStatus(book);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} by ${author}, ${status.label}`}
      onPress={() => {
        onOpen();
        router.push(`/book/${encodeURIComponent(bookKey(book))}` as never);
      }}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
    >
      <View style={[styles.cover, { backgroundColor: colors.border }]}><CoverImage book={book} /></View>
      <View style={styles.grow}>
        <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{title}</Text>
        <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{author}</Text>
      </View>
      <StatusBadge label={status.label} tone={status.tone} />
    </Pressable>
  );
}

function BookResultRow({ result, onOpen, onAdd }: { result: BookSearchResult; onOpen: () => void; onAdd: (result: BookSearchResult) => void }) {
  const { colors } = useTheme();
  const byline = [result.authors.join(", "), result.year].filter(Boolean).join(" · ");
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={byline ? `${result.title}, ${byline}` : result.title}
        onPress={() => {
          onOpen();
          if (result.workId) router.push(`/work/${result.workId}` as never);
          else onAdd(result);
        }}
        style={styles.bookOpen}
      >
        <BookCover cover={result.coverUrl} title={result.title} width={40} height={60} />
        <View style={styles.grow}>
          <Text numberOfLines={2} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{result.title}</Text>
          {byline ? <Text numberOfLines={1} {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{byline}</Text> : null}
        </View>
      </Pressable>
      <IconButton framed name="add" accessibilityLabel={`Add ${result.title}`} onPress={() => onAdd(result)} />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  strong: { fontWeight: "700" },
  pad: { paddingHorizontal: spacing.lg },
  line: { paddingVertical: spacing.sm },
  stack: { gap: spacing.sm, paddingVertical: spacing.sm },
  link: { minHeight: 44, justifyContent: "center" },
  title: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  right: { marginLeft: "auto" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  bookOpen: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60 },
  cover: { width: 40, aspectRatio: 2 / 3, borderRadius: radii.sm, overflow: "hidden" },
});
```

- [ ] **Step 5: `SearchIdle.tsx`.**

```tsx
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { personCaption, type SuggestedReader } from "@scripta/shared/community";
import { Text } from "../../ui/Text";
import { Button, ErrorState, Icon, Skeleton, dynamicType, radii, spacing, typography, useTheme } from "../../ui";
import { AuthorAvatar, openProfile } from "../community/AuthorAvatar";
import { DiscoverRow } from "../community/DiscoverRow";
import { fetchDiscover, fetchSuggestedPeople } from "../community/api";
import type { useFollowToggle } from "../community/useFollowToggle";
import { NEW_GAMES, idleSections, type SearchScope } from "./searchModel";
import { SectionTitle } from "./SearchResultRow";

export function SearchIdle({ scope, recent, onRecent, onClearRecent, follow }: {
  scope: SearchScope;
  recent: string[];
  onRecent: (query: string) => void;
  onClearRecent: () => void;
  follow: ReturnType<typeof useFollowToggle>;
}) {
  const { colors } = useTheme();
  const show = idleSections(scope);
  const readers = useQuery({ queryKey: ["community", "people", "suggested"], queryFn: fetchSuggestedPeople, enabled: show.readers, retry: false });
  const games = useInfiniteQuery({
    queryKey: ["community", "discover", "all", ""],
    queryFn: ({ pageParam }) => fetchDiscover("all", "", pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: show.newGames,
    retry: false,
  });
  const newGames = games.data?.pages[0]?.items.slice(0, NEW_GAMES) ?? [];

  return (
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}>
      {recent.length > 0 ? (
        <View>
          <SectionTitle title="Recent" action={{ label: "Clear", onPress: onClearRecent }} />
          {recent.map((text) => (
            <Pressable
              key={text}
              accessibilityRole="button"
              accessibilityLabel={`Search for ${text}`}
              onPress={() => onRecent(text)}
              style={({ pressed }) => [styles.recent, { backgroundColor: pressed ? colors.surfacePressed : "transparent" }]}
            >
              <Icon name="recent" size={18} color={colors.textDim} />
              <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.grow, { color: colors.text }]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {show.readers && (readers.isError || readers.isPending || readers.data.length > 0) ? (
        <View>
          <SectionTitle title="Readers you might like" />
          {readers.isError ? (
            <View style={styles.pad}><ErrorState body="Couldn't load readers." actionLabel="Retry" onAction={() => void readers.refetch()} /></View>
          ) : readers.isPending ? (
            <View style={styles.pad}><Skeleton height={150} /></View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.readers}>
              {readers.data.map((person) => (
                <ReaderCard key={person.user.userId} person={person} busy={follow.busyId === person.user.userId} onToggleFollow={() => void follow.toggle(person)} />
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
      {show.newGames && (games.isError || games.isPending || newGames.length > 0) ? (
        <View>
          <SectionTitle title="New games" />
          {games.isError ? (
            <View style={styles.pad}><ErrorState body="Couldn't load games." actionLabel="Retry" onAction={() => void games.refetch()} /></View>
          ) : games.isPending ? (
            <View style={styles.pad}><Skeleton height={120} /></View>
          ) : (
            newGames.map((item) => <DiscoverRow key={`${item.content.kind}:${item.content.id}`} item={item} linkAuthor />)
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

function ReaderCard({ person, busy, onToggleFollow }: { person: SuggestedReader; busy: boolean; onToggleFollow: () => void }) {
  const { colors } = useTheme();
  const caption = personCaption(person);
  return (
    <View style={[styles.reader, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${person.user.username}'s profile, ${caption}`} onPress={() => openProfile(person.user.username)} style={styles.readerOpen}>
        <AuthorAvatar username={person.user.username} avatarUrl={person.user.avatarUrl} size={44} />
        <Text numberOfLines={1} {...dynamicType} style={[typography.body, styles.strong, { color: colors.text }]}>{person.user.username}</Text>
        <Text numberOfLines={2} {...dynamicType} style={[typography.caption, styles.center, { color: colors.textDim }]}>{caption}</Text>
      </Pressable>
      {person.private ? null : <Button label={person.viewerFollows ? "Following" : "Follow"} variant="secondary" loading={busy} onPress={onToggleFollow} />}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  strong: { fontWeight: "700" },
  center: { textAlign: "center" },
  pad: { paddingHorizontal: spacing.lg },
  list: { paddingBottom: spacing.huge },
  recent: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44, paddingHorizontal: spacing.lg },
  readers: { gap: spacing.md, paddingHorizontal: spacing.lg },
  reader: { width: 136, gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderRadius: radii.lg },
  readerOpen: { alignItems: "center", gap: spacing.xs },
});
```

- [ ] **Step 6: `SearchScreen.tsx`.**

```tsx
import { useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { looksLikeIsbnQuery, matchesSearch, type BookSearchResult } from "@scripta/shared";
import { IconButton, Input, Screen, Segmented, Skeleton, Toast, spacing } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import { fetchDiscover, searchPeople } from "../community/api";
import { useFollowToggle } from "../community/useFollowToggle";
import { bookSearchApi, searchCatalogWorks } from "../library/api/search";
import { useLibrary } from "../library/hooks/useLibrary";
import { useDebouncedValue } from "../library/lib/debounce";
import { SearchIdle } from "./SearchIdle";
import { SearchResultRow, type ResultActions } from "./SearchResultRow";
import { SEARCH_SCOPES, isNetworkQuery, mergeBookResults, ownedBooks, searchRows, type ResultSection, type SearchScope } from "./searchModel";
import { useRecentSearches } from "./useRecentSearches";

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [adding, setAdding] = useState<BookSearchResult | null>(null);
  const recent = useRecentSearches();
  const follow = useFollowToggle();
  const library = useLibrary();
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 300);
  const needle = submitted ?? debounced;
  const network = isNetworkQuery(needle);
  const wantsBooks = network && (scope === "all" || scope === "books");
  const wantsPeople = network && (scope === "all" || scope === "people");
  const wantsGames = network && (scope === "all" || scope === "games");

  const catalog = useQuery({ queryKey: ["search", "books", needle], queryFn: () => searchCatalogWorks(needle), enabled: wantsBooks, placeholderData: keepPreviousData, retry: false });
  const external = useQuery({
    queryKey: ["search", "external", submitted],
    queryFn: () => bookSearchApi.outside(submitted ?? ""),
    enabled: wantsBooks && submitted !== null && (!looksLikeIsbnQuery(submitted) || (catalog.isSuccess && !catalog.isPlaceholderData && catalog.data.length === 0)),
    retry: false,
  });
  const people = useQuery({ queryKey: ["community", "people", "search", needle], queryFn: () => searchPeople(needle), enabled: wantsPeople, placeholderData: keepPreviousData, retry: false });
  const games = useInfiniteQuery({
    queryKey: ["community", "discover", "all", needle],
    queryFn: ({ pageParam }) => fetchDiscover("all", needle, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: wantsGames,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const books = library.data?.data.books ?? [];
  const bookRows = mergeBookResults(catalog.data ?? [], external.data ?? [], ownedBooks(books, library.data?.works));
  const gameRows = games.data?.pages.flatMap((page) => page.items) ?? [];
  const rows = searchRows({
    scope,
    query: needle,
    submitted: submitted !== null,
    library: { rows: books.filter((book) => matchesSearch(book, trimmed)), loading: library.isLoading, failed: library.isError && !library.data },
    books: { rows: bookRows, loading: catalog.isLoading && bookRows.length === 0, failed: catalog.isError && bookRows.length === 0 },
    people: { rows: people.data ?? [], loading: people.isLoading, failed: people.isError && !people.data },
    games: { rows: gameRows, loading: games.isLoading, failed: games.isError && gameRows.length === 0 },
    openLibrary: external.isError ? "failed" : external.isFetching ? "pending" : "idle",
  });

  function submit(text: string) {
    const next = text.trim();
    if (!next) return;
    setQuery(text);
    setSubmitted(next);
    recent.record(next);
  }

  const retries: Record<ResultSection, () => unknown> = { library: library.refetch, books: catalog.refetch, people: people.refetch, games: games.refetch };
  const actions: ResultActions = {
    query: needle,
    follow,
    onOpen: () => recent.record(trimmed),
    onAdd: setAdding,
    onSeeAll: setScope,
    onRetry: (section) => void retries[section](),
    onSearchOpenLibrary: () => submit(query),
    onRetryOpenLibrary: () => void external.refetch(),
  };

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Search", headerShown: true, headerLargeTitleEnabled: false }} />
      <View style={styles.top}>
        <View style={styles.field}>
          <View style={styles.grow}>
            <Input
              icon="search"
              accessibilityLabel="Search books, people and games"
              placeholder="Books, people, games"
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                setSubmitted(null);
              }}
              onSubmitEditing={() => submit(query)}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          {query ? (
            <IconButton
              name="close"
              accessibilityLabel="Clear search"
              onPress={() => {
                setQuery("");
                setSubmitted(null);
              }}
            />
          ) : null}
        </View>
        <Segmented accessibilityLabel="Search in" options={SEARCH_SCOPES} value={scope} onChange={setScope} />
      </View>
      {trimmed ? (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          onEndReached={() => {
            if (scope === "games" && games.hasNextPage && !games.isFetchingNextPage && !games.isFetchNextPageError) void games.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={scope === "games" && games.isFetchingNextPage ? <View style={styles.footer}><Skeleton height={80} /></View> : null}
          renderItem={({ item }) => <SearchResultRow row={item} actions={actions} />}
        />
      ) : (
        <SearchIdle scope={scope} recent={recent.searches} onRecent={submit} onClearRecent={recent.clear} follow={follow} />
      )}
      {follow.error ? <Toast visible message={follow.error} tone="error" /> : null}
      {adding ? (
        <AddBookSheet
          book={{ title: adding.title, author: adding.authors.join(", "), isbn: adding.isbn, coverUrl: adding.coverUrl, year: adding.year, workId: adding.workId }}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  top: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  field: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  list: { paddingBottom: spacing.huge },
  footer: { padding: spacing.lg },
});
```

- [ ] **Step 7: Add it by hand prefills.**
  - In `AddBookForm.tsx`:
    - The props gain `initialQuery = ""` (type `initialQuery?: string`).
    - `const [query, setQuery] = useState("");` becomes `useState(initialQuery)`.
  - In `(app)/(home,library,you)/add-book.tsx`:
    - Import `useLocalSearchParams` from `expo-router`.
    - Read `const { q } = useLocalSearchParams<{ q?: string }>();`.
    - Pass `initialQuery={q ?? ""}` to `AddBookForm`.

- [ ] **Step 8: Verify** (mobile commands, including `src/ui/textImports.test.ts`).

- [ ] **Step 9: Commit.**

```bash
git add mobile/src/ui/icon.tsx mobile/src/features/library/api/search.ts mobile/src/features/search mobile/src/features/library/components/AddBookForm.tsx "mobile/src/app/(app)/(home,library,you)/add-book.tsx" && git commit -m "Build the Search screen" -m "Before you type, the screen shows Recent, readers you might like and new games. As you type, your own books filter on every keystroke. Books, people and games come from the server 300 ms after you stop, once you've typed two characters. Pressing Search also asks Open Library, which is throttled for the whole server and saves every hit, so it never runs on partial words. Recent searches are kept per account on the device. Add it by hand carries the query into Add book."
```

---

### Task 12: The Search tab and its routes

**Files:**
- Rename: `mobile/src/app/(app)/(home,arena,library,you)` → `(home,arena,library,search,you)`; `(home,library,you)` → `(home,library,search,you)`
- Modify: the five `(public)` re-exports
- Create: `mobile/src/app/(app)/(search)/_layout.tsx`, `mobile/src/app/(app)/(search)/search.tsx`
- Modify: `mobile/src/app/(app)/_layout.tsx`
- Docs: `mobile/README.md`, `mobile/.maestro/login-navigation.yaml`, `.claude/agents/beta-tester.md`

These land in one task. Naming `search` in an array group before the `(search)` stack exists would make Expo Router treat that group's routes as extra tabs.

- [ ] **Step 1: Rename the shared groups.**

```bash
git mv "mobile/src/app/(app)/(home,arena,library,you)" "mobile/src/app/(app)/(home,arena,library,search,you)"
git mv "mobile/src/app/(app)/(home,library,you)" "mobile/src/app/(app)/(home,library,search,you)"
```

In each of these five files, replace `(home,arena,library,you)` with `(home,arena,library,search,you)`:
- `mobile/src/app/(public)/book/[key]/cover.tsx`
- `.../finished.tsx`
- `.../style.tsx`
- `mobile/src/app/(public)/work/[id]/index.tsx`
- `.../stats.tsx`

Then:

```bash
rg -n "\(home,arena,library,you\)|\(home,library,you\)" mobile/src
```

It must print nothing.

- [ ] **Step 2: The Search stack.** `(search)/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { useScreenOptions, useSheetOptions } from "@/ui/navigation";

export const unstable_settings = {
  initialRouteName: "search",
};

export default function SearchStackLayout() {
  const sheet = useSheetOptions();
  return (
    <Stack screenOptions={useScreenOptions()}>
      <Stack.Screen name="search" />
      <Stack.Screen name="add-book" options={{ ...sheet, title: "Add a book" }} />
      <Stack.Screen name="import" options={{ ...sheet, title: "Import library" }} />
      <Stack.Screen name="book/[key]/index" options={{ title: "" }} />
      <Stack.Screen name="book/[key]/style" options={{ ...sheet, title: "Card style" }} />
      <Stack.Screen name="book/[key]/cover" options={{ ...sheet, title: "Cover" }} />
      <Stack.Screen name="book/[key]/finished" options={{ ...sheet, title: "Finished" }} />
    </Stack>
  );
}
```

`(search)/search.tsx`:

```tsx
import { SearchScreen } from "@/features/search/SearchScreen";

export default function SearchRoute() {
  return <SearchScreen />;
}
```

- [ ] **Step 3: The tab.** In `(app)/_layout.tsx`, between the `(library)` and `(arena)` `Tabs.Screen` lines, add:

```tsx
        <Tabs.Screen name="(search)" options={{ title: "Search", tabBarIcon: ({ color, focused, size }) => <Icon name="search" filled={focused} color={color} size={size} /> }} />
```

`search` has no `FILLED` entry, so `filled` changes nothing and the tint marks the focused tab.

- [ ] **Step 4: Docs.**
  - `mobile/README.md`: change "auth-guarded tab shell (Home, Library, Games, You)" to "auth-guarded tab shell (Home, Library, Search, Games, You)". The README's route table stays as it is: no web route maps to Search.
  - `.claude/agents/beta-tester.md`: change "Then each tab (Home, Library, Games, You)" to "Then each tab (Home, Library, Search, Games, You)".
  - `mobile/.maestro/login-navigation.yaml`: before `- tapOn: "Games"`, add:

```yaml
- tapOn: "Search"
- assertVisible: "All"
```

- [ ] **Step 5: Verify** (mobile commands).

- [ ] **Step 6: Commit.**

```bash
git add -A "mobile/src/app" mobile/README.md mobile/.maestro/login-navigation.yaml .claude/agents/beta-tester.md && git commit -m "Add the Search tab between Library and Games" -m "Every route a Search screen pushes has to exist in the Search stack, or the push jumps tabs and loses its back chevron. So the shared book, work, profile and mural-editor routes, and Add book and Import, now belong to the Search stack too. The rename and the new stack land together: naming search in an array group before the (search) stack exists turns its routes into extra tabs."
```

---

### Task 13: Scan

**Files:**
- Create: `mobile/src/features/search/scanBridge.ts`, `scanBridge.test.ts`, `ScanScreen.tsx`, `mobile/src/app/(app)/(search)/scan.tsx`
- Modify: `mobile/src/app/(app)/(search)/_layout.tsx`, `mobile/src/features/search/SearchScreen.tsx`, `mobile/src/ui/icon.tsx`

**Interfaces:**
- Produces: `receiveScans(receiver: (isbn: string) => void): () => void` and `sendScan(isbn: string): void`.

- [ ] **Step 1: Failing test** `scanBridge.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { receiveScans, sendScan } from "./scanBridge.js";

test("a scan reaches the screen listening for it, and nobody once it stops", () => {
  const seen: string[] = [];
  const stop = receiveScans((isbn) => seen.push(isbn));
  sendScan("9780441013593");
  stop();
  sendScan("9780141184272");
  assert.deepEqual(seen, ["9780441013593"]);
});

test("a newer listener replaces the older one, and the older one's stop leaves it alone", () => {
  const first: string[] = [];
  const second: string[] = [];
  const stopFirst = receiveScans((isbn) => first.push(isbn));
  const stopSecond = receiveScans((isbn) => second.push(isbn));
  stopFirst();
  sendScan("9780441013593");
  stopSecond();
  assert.deepEqual(first, []);
  assert.deepEqual(second, ["9780441013593"]);
});
```

- [ ] **Step 2: Run and expect FAIL.**

- [ ] **Step 3: `scanBridge.ts`.**

```ts
let receiver: ((isbn: string) => void) | null = null;

export function receiveScans(next: (isbn: string) => void): () => void {
  receiver = next;
  return () => {
    if (receiver === next) receiver = null;
  };
}

export function sendScan(isbn: string): void {
  receiver?.(isbn);
}
```

- [ ] **Step 4: Glyph.** In `ui/icon.tsx` `GLYPHS`, after `recent`, add:

```ts
  scan: { ios: "barcode.viewfinder", android: "barcode_scanner" },
```

- [ ] **Step 5: `ScanScreen.tsx`.**

```tsx
import { Stack, router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Screen, spacing } from "../../ui";
import { IsbnScanner } from "../library/components/IsbnScanner";
import { sendScan } from "./scanBridge";

export function ScanScreen() {
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Scan" }} />
      <View style={styles.body}>
        <IsbnScanner
          hint="Point at the barcode on the back cover"
          onIsbn={(isbn) => {
            sendScan(isbn);
            router.back();
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg },
});
```

Create the route `(search)/scan.tsx`:

```tsx
import { ScanScreen } from "@/features/search/ScanScreen";

export default function ScanRoute() {
  return <ScanScreen />;
}
```

In `(search)/_layout.tsx`, after `<Stack.Screen name="search" />`, add:

```tsx
      <Stack.Screen name="scan" options={{ title: "Scan" }} />
```

- [ ] **Step 6: Search listens.** In `SearchScreen.tsx`:
  - Change `import { useState } from "react";` to `import { useEffect, useRef, useState } from "react";`.
  - Change `import { Stack } from "expo-router";` to `import { Stack, router } from "expo-router";`.
  - Add `import { receiveScans } from "./scanBridge";`.
  - After the `submit` function, add:

```tsx
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => receiveScans((isbn) => {
    setScope((current) => (current === "people" || current === "games" ? "books" : current));
    submitRef.current(isbn);
  }), []);
```

A scan is always a book. On the People or Games chip it would otherwise end at "No results for “978…”", so the receiver switches to Books.

  - In the field row, after the clear button, add:

```tsx
          <IconButton framed name="scan" label="Scan" accessibilityLabel="Scan a book's barcode" onPress={() => router.push("/scan" as never)} />
```

- [ ] **Step 7: Verify** (mobile commands).

- [ ] **Step 8: Commit.**

```bash
git add mobile/src/features/search/scanBridge.ts mobile/src/features/search/scanBridge.test.ts mobile/src/features/search/ScanScreen.tsx mobile/src/features/search/SearchScreen.tsx "mobile/src/app/(app)/(search)/scan.tsx" "mobile/src/app/(app)/(search)/_layout.tsx" mobile/src/ui/icon.tsx && git commit -m "Scan a barcode from Search" -m "Scan opens the camera on its own screen in the Search stack, with a back chevron. The first ISBN it reads returns to Search as a submitted query and joins Recent, so a book you own shows under In your library and anything else goes to the catalog, then Open Library. The ISBN travels back through a one-listener bridge rather than route params, which would need a nonce to tell two scans of the same ISBN apart."
```

---

### Task 14: Checks and the device pass

- [ ] **Step 1: Backend deploy check** before PR 1 deploys.
  - Ask the user to run `railway volume list --json` and `railway ssh -- ls -l /data/covers.sqlite`. Production reads are the user's to run.
  - **The backfill's writes:**
    - It writes one index entry and one membership row per indexed book, about 78k of each.
    - The plan's dry run measured 13 MB of file growth on a synthetic catalog that size, mostly the index. The membership table adds a few MB on top.
    - The write-ahead log grows by about as much again during the transaction, and Litestream copies those pages once more.
  - **Required headroom:** at least 100 MB free, and at least half the size of `covers.sqlite`. If either is short, resize the volume before deploying. A full volume crash-loops the backend at boot; see the `railway-volume-500mb` memory.

- [ ] **Step 2: Phase checks.**

```bash
cd mobile && npx expo-doctor
```

- [ ] **Step 3: Device pass.**
  - First run `node scripts/dev-status.mjs --json`, and skip if another worktree holds the emulator.
  - Dispatch `device-checker` with the worktree path, a screenshot directory and these checks. The fixture account is seeded with books and a social graph.
  - Moving books between shelves through the UI is fine. Writing the database directly is not.

  1. **Tabs.**
     - The bar reads Home · Library · Search · Games · You.
     - Search has a field, a framed Scan button and All · Books · People · Games.
     - The field doesn't autofocus.
  2. **Before typing.**
     - Readers you might like shows cards with Follow.
     - New games lists at most five games.
     - Recent is hidden on a fresh install.
  3. **Typing.**
     - Type the first three letters of a fixture book's title. In your library shows it with its status chip.
     - Books lists catalog works with "Tap for details, + to add" and + buttons.
     - All shows at most three rows per section, with See all. See all switches the chip.
  4. **Opening.**
     - A Books row opens its work page inside the Search stack, and back returns to Search.
     - An In your library row opens the book.
     - The query now appears under Recent after clearing the field.
  5. **Quick add.**
     - + then To read shows "Added to your library." and closes.
     - On another result, + then Finished shows the finish step titled "Finished", without "Not finished? Undo".
  6. **Open Library.**
     - Type a nonsense word, wait, and see "Nothing in the catalog yet." with Search Open Library.
     - Pressing the keyboard's Search key shows "Still searching Open Library…".
     - Typing again clears it.
  7. **Add it by hand.**
     - It opens Add book with the query in its search field.
     - On Add book, tap "Scan ISBN with camera" and deny the camera. Revoke it first with `adb shell pm revoke host.exp.exponent android.permission.CAMERA` if it was granted.
     - The denial message shows, and typing a title and author still enables "Add book".
  8. **Games.**
     - Games opens on Browse, and the header shows New. New offers Tournament, Tier list and Quiz.
     - On Tournaments, the floating New is back.
  9. **People.**
     - Home's Find readers opens People in the Home stack, with a back chevron.
     - No screen titled Community exists anywhere.
  10. **A new account.**
      - Sign up a throwaway account on the local backend through the app, as the beta-tester agent's first run does.
      - Open Search and type a word. Expected: no library error, no "In your library" section, and Books, People and Games still answer.
      - Sign back in to the fixture account afterwards.
  11. **Scan** needs a real camera. Leave it to the owner on a phone. Report it as NOT CHECKED.

- [ ] **Step 4: Whole-branch review.** Run `branch-reviewer` once for each PR before it merges, then the `ship` skill.
