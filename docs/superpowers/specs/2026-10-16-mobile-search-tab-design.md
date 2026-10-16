# Mobile Search tab — design

Phase 3 of the mobile navigation redesign. Phases 1 and 2 are in [`2026-10-12-mobile-tabs-home-design.md`](2026-10-12-mobile-tabs-home-design.md); this spec assumes both have shipped.

Mockups: the "Atmyshelf mobile UX" design canvas, boards Search, Search typing, Add to library and the "Search, once you press Search" row. Everything needed to build is written out here.

## Goal

- **Find any book from one place.** Today the catalog is reachable only through Add a book, where a result fills a form. Searching your own books happens inside one Library shelf at a time.
- **People and games without a detour.** People search is two levels deep (Home → Find readers → People). Game search is Games → Browse.
- **Add a found book in one tap,** with the status picked at the same time.

## Non-goals

- Opening a catalog result's book page. Results don't carry a work id (`BookSearchResult` is title, authors, year, ISBN, publisher, cover and genres), and books created from libraries aren't in the catalog's search index. Both are backend changes; see Later.
- Recent searches. Nothing stores them today, and storing them per device would leak between accounts the same way Phase 1's shelf memory did.
- Filter chips (All · Books · People · Games). Results are already grouped by kind, and each group is short.
- Search as you type against the catalog. See "Any book" below.
- Removing Community or Games → Browse. Both stay as they are after Phase 2.
- Any backend or `@scripta/shared` API change.
- The web client.

## Tab bar

| Tab | Job | Root screen | Icon |
|---|---|---|---|
| Home | unchanged | `/` | `home` |
| Library | unchanged | `/library` | `library` |
| **Search** | Find your books, any book, people and games | `/search` — new SearchScreen | `search` (no filled variant; the tint marks it selected) |
| Games | unchanged | `/my-arena` | `arena` |
| You | unchanged | `/you` | `profile` |

Routes, following Phase 1's rule that every route a tab's screens push exists in that tab's stack:

- New group `(search)` with `search.tsx` and a `_layout.tsx` Stack, `initialRouteName "search"`, `search` declared first. In `(app)/_layout.tsx`, `Tabs.Screen name="(search)"` (title "Search") sits between `(library)` and `(arena)`.
- The shared group `(home,arena,library,you)` becomes `(home,arena,library,search,you)`. Search pushes `/book/<key>` and `/u/<username>`.
- `(home,library,you)` becomes `(home,library,search,you)`. Search pushes `/add-book`.
- The Search layout declares the same sheet screens as the You layout: `add-book`, `import`, `book/[key]/index`, and `book/[key]/style|cover|finished`.
- The five `(public)` re-exports (`book/[key]/{cover,finished,style}.tsx` and `work/[id]/{index,stats}.tsx`) point at the renamed folder. Nothing else imports a group path.
- Adding `search` changes no bare-path resolution: `arena` still sorts first in the shared group, and `home` still sorts first in `(home,library,search,you)`.
- Game results open `/vote/<code>`, `/arena/<id>` and `/play/<code>`, which are root routes outside the tabs, as they are from Discover today.

## Search screen

Top to bottom:

1. **Header.** Title "Search". No header actions.
2. **Field row.**
   - The search Input with the leading search icon, placeholder "Title, author, ISBN or username", and a clear button while editing. Return key "search". An ISBN finds your own copy only through the catalog search (step 5), because `filterBooks` matches title and author only.
   - A framed, labelled "Scan" button beside it. It opens Add a book with the camera already on (`/add-book?scan=1`). AddBookForm already runs the whole scan flow there: permission prompts, "Open Settings" when access is blocked, the ISBN lookup, auto-fill on a single result, and "No matches — fill the form in below by hand instead." The only new code is reading `scan=1` and starting the scanner on mount.
3. **Before you type** (empty field):
   - **Readers you might like:** `fetchSuggestedPeople()`. These are horizontal cards: avatar, username and `personCaption` ("You share N books" or "Recently active"), up to 3 shared-book covers, and Follow or Following. Tapping a card opens `/u/<username>`. Follow behaves exactly as in PeoplePane: `followUser` or `unfollowUser`, then invalidate `["community","people"]`. Errors go through `followFailureMessage` into a Toast. On error the section shows "Couldn't load suggestions." with Retry.
   - **New games:** the first 5 items of `fetchDiscover("all", "")`, the same call Discover makes. Rows reuse `DiscoverRow`, exported from `DiscoverPane.tsx`: name, kind and author, the `contentStatus` pill and the `contentStats` line. Tapping a row opens `contentTarget`. A tournament's "See books" opens `ArenaBooksSheet`, then `AddBookSheet`, which Search hosts the way DiscoverPane does. On failure the section shows "Couldn't load tier lists, tournaments and quizzes." with Retry.
   - While loading, each section shows Skeleton rows in its place.
   - If both sections load empty, nothing else is drawn.
4. **While you type.** Each section shows when it has results, and shows its error with Retry when its search fails:
   - **In your library:** `filterBooks(books, query, "all")`, run locally with no debounce. Rows show cover, title, author and the status as a pill (To read / Reading / Finished). Up to 5 rows show, then "Show all N" expands the list in place, never jumping to the Library tab. A row opens `/book/<key>`.
   - **Any book:** one row reading "Search the catalog for “<query>”". Tapping it, or pressing the keyboard's Search key, runs `searchInsideOutside` once for that query. Catalog search is not run per keystroke: every search costs two requests against a 300/min per-IP limit, and Open Library calls are spaced a second apart server-side. Editing the query after a catalog search clears its results and brings the row back.
   - **People:** `searchPeople(query)` on a 300ms `useDebouncedValue`, showing the first 5. Rows show avatar, username and `personCaption` ("N followers" or "Private"), and Follow or Following unless the person is private. On failure: "Couldn't search." with Retry, as in PeoplePane.
   - **Games:** the first 5 items of `fetchDiscover("all", query)`, on the same debounce, with the same rows and error as before you type.
   - Library results update as you type. People and games wait for the debounce.
5. **After a catalog search.** "Any book" replaces its row with the results:
   - Each row shows cover, title and "author · year", plus a 44pt "+" button. Tapping the row or the "+" opens the existing `AddBookSheet` (see "Adding a result").
   - A result that is already in your library shows its status pill instead of "+", and the row opens `/book/<key>`. "Already in your library" means `bookKey({ ISBN: isbn, Title: title, Attribution: authors.join(", ") })` equals a library book's `bookKey`. That is the record shape AddBookForm builds, and the key the library dedupes on. A copy the rule misses still shows "+". Adding it is safe: the server matches the existing book, and the sheet says "Updated in your library."
   - While searching, the row reads "Searching the catalog…". If the outside search fails behind inside results, "Couldn't reach Open Library" shows under them, as in AddBookForm.
   - Under the results: "Not here? Add it by hand", which opens `/add-book?q=<query>`. `q` prefills the Title field; no search runs.
   - If the search fails, its error message (for example "Search is unavailable right now — try again.") shows in an `ErrorState` inside the section, with Retry. The other sections stay.
6. **Nothing at all.** Shown when, after a catalog search, every search has succeeded and every section is empty: "Nothing matches “<query>”." with the body "Not in your library, the catalog, people or games. Try the author's name, or scan the barcode." and an "Add it by hand" button (as above). If a search failed, its section shows its error instead, and this message doesn't appear.

## Adding a result

Search reuses `AddBookSheet` (`features/community/AddBookSheet.tsx`) as it is. It is already the app's "Add to library" sheet in Discover, a work page, public libraries, tournaments and tier-list votes.

- It shows cover, title and author, then To read / Reading / Finished as buttons. It saves through `addBookToLibrary` with today's local day, toasts "Added to your library." or "Updated in your library.", and closes. On failure it toasts the error and stays open.
- Search passes `{ title, author: authors.join(", "), isbn, coverUrl }` from the result.
- `addBookToLibrary` doesn't go through the library cache. So when the sheet closes, Search refetches the library (`useLibrary().refetch()`), and the result row turns into its status pill.
- Finished adds the book as Finished and opens nothing else, as everywhere else the sheet is used.
- The mockup's "N readers on Atmyshelf" line and "See the book page first" link are left out; both need a work id.

## What does not change

- The Library screen's own search. It filters the shelf you're on, which Search does not replace.
- `AddBookSheet`, and everywhere it is used.
- Add a book, apart from reading `scan=1` (start the scanner on mount) and `q` (prefill Title).
- Community (Discover · People after Phase 2) and Games → Browse.
- Home's "Find readers" still opens `/community?tab=people`.

## Testing

- **Mobile unit tests** (`node:test`): a pure search model that decides:
  - which sections show, for an empty field, a typed query, and after a catalog search
  - the library cap of 5 and "Show all N"
  - the catalog state: not run, searching, results, outside failed, error, empty
  - when a catalog result counts as already in the library
  - when "Nothing matches" shows (never while a search has failed)
- `scan=1` starts the scanner, and `q` prefills Title. If the scanner start can't be tested as pure logic, it goes to the device pass.
- **Checks:** `npm run typecheck --workspace mobile`, `npm test --workspace mobile`, and `npx expo-doctor` in `mobile/`.
- **Device pass** (`device-checker`):
  - the five tabs
  - Search before typing, while typing, and after a catalog search
  - adding a catalog result, then the row showing its status pill
  - Scan → Add a book
  - a library result opening the book with a back chevron to Search
  - a person opening their profile inside Search
- **Docs and tooling:**
  - `mobile/README.md`: tab list and route table.
  - The beta-tester agent's tab list.
  - The Maestro flow only taps Games and You, so it keeps working. Add a step that taps Search and asserts "Scan". It doesn't assert "Readers you might like", which depends on the account's data.

## Later

- **Book page from a catalog result:** `BookSearchResult` needs the work id (the server already has `CatalogSearchHit.workKey`), and books created from libraries need to be in `books_fts`. Then the result row opens `/work/<id>`, and the add sheet can link to it.
- **Retire Community:** once Home's "Find readers" can open the Search tab's people results without pushing a second Search screen (the same cross-tab problem as Phase 2's "See all").
- **Recent searches,** stored per account and cleared on sign-out.
