# Mobile Search tab — design

Phase 3 of the mobile navigation redesign. Phases 1 and 2 (Library and You tabs, the new Home) are in `2026-10-12-mobile-tabs-home-design.md`; this spec reuses its rules, notably the one about stranded cross-tab screens.

Mockups: the "Atmyshelf mobile UX" design canvas (private to the owner), boards "Search", "Search, typing", "Quick add" and "Where things go". Everything needed to build is written out here, so the canvas is not required. Where this spec and the canvas differ, this spec wins.

## Goal

- **Search that finds any book.** Today the only door to the catalog is Add book, and a result there only fills a form. A book you don't own can be opened only from a link someone else's activity happens to carry.
- **The catalog becomes searchable.** None of the ~77.8k seeded and publisher books are in the search index today. Only books someone already found through Open Library are.
- **One job per tab, as the canvas's "Where things go" sets out.**
  - Search finds your books, any book, people and games, with Scan in the field.
  - People moves from Community to Search.
  - Discover becomes the first page of Games.
  - The Community screen goes.

## Non-goals

- The web client. It benefits from the backend changes but gets no new screen.
- Indexing a book under the title its source reports. The details lookup doesn't keep that title (see Later).
- Reader counts on search results or in Quick add. The canvas's "2 readers on Atmyshelf" line is left out; the work page shows readers.
- Changing the Library screen's own search, or `filterBooks`.
- People search by anything other than username. There are no display names.
- Syncing recent searches between devices.

## Tab bar and routes

| Tab | Root screen | Icon |
|---|---|---|
| Home | `/` — HomeScreen | `home`, badge as today |
| Library | `/library` — LibraryScreen | `library` |
| Search | `/search` — new SearchScreen | `search` |
| Games | `/my-arena` — ArenaHomeScreen | `arena` |
| You | `/you` — YouScreen | `profile` |

- `search` has no filled variant on either platform. The focused tab is told apart by its tint alone.
- The new `(search)` stack declares `search` first, so the tab anchors on it (see the comment in `(library)/_layout.tsx`). It also holds `scan`.
- Every route a Search screen pushes must exist in the Search stack:
  - `(home,arena,library,you)` becomes `(home,arena,library,search,you)`: `book/*`, `work/*`, `u/*`, `murals/[id]`.
  - `(home,library,you)` becomes `(home,library,search,you)`: `add-book`, `import`.
  - The five `(public)` re-exports that name the group path change with it (`book/[key]/{cover,finished,style}`, `work/[id]/{index,stats}`).
- Route folders move with `git mv` so history follows. No URL changes except the new `/search`, `/scan` and `/people`, and the removed `/community` and Games-stack `/discover`.

## Search screen

The field and chips stay at the top while the content below scrolls.

- **Field:**
  - Placeholder "Books, people, games"; accessibility label "Search books, people and games".
  - It has a clear button, and the keyboard's return key reads Search.
  - It doesn't autofocus when the tab opens.
- **Scan:** a framed, labelled "Scan" button beside the field, accessibility label "Scan a book's barcode". Its glyph is a new `scan` entry in `ui/icon.tsx`: SF Symbol `barcode.viewfinder`, Material Symbol `barcode_scanner`. Both come through `expo-symbols`, which the app already ships, so no native release is needed.
- **Chips:** All · Books · People · Games, in a group labelled "Search in", default All.
  - A chip hides the other kinds' sections, both before and while typing.
  - Books covers both In your library and Books.
- **State:** a visited tab stays mounted, so it keeps its query and chip until the app restarts or another account signs in. Clearing the field returns to "Before typing".

### Before typing

Top to bottom:

1. **Recent.** Header "Recent", with a "Clear" action that removes them all.
   - Up to 8 searches, newest first, each a 44pt row with a clock glyph. Tapping one fills the field and submits it.
   - A search is recorded when it is submitted (the keyboard's Search key, Search Open Library, or a Recent row), when a result is opened from it, or when Scan reads an ISBN.
   - Recording the same text again (ignoring case and surrounding spaces) moves it to the top.
   - Stored on the device in AsyncStorage, under a key that includes the account id.
   - Hidden when empty.
2. **Readers you might like.** `GET /community/people/suggested`.
   - Horizontal cards: avatar, @username, `personCaption`, and Follow (hidden on private profiles).
   - Tapping a card opens `/u/<username>`.
   - Shown under All and People.
3. **New games.** The first 5 items of `GET /community/discover` with no query. Same rows as Browse, and tapping one opens it as Browse does. Shown under All and Games.

### While typing

- **In your library** updates on every keystroke from the loaded library, with no network.
- **Books, People and Games** query the server once the trimmed query has 2 or more characters, 300 ms after typing stops. That is the debounce People and Discover already use.
  - Each section keeps its last results until the new ones arrive.
  - Below 2 characters, only In your library's matches show, and nothing else, not even "No results".
- **Section order:** In your library, Books, People, Games.
  - A section that is done and has nothing hides. Books is the exception until the query is submitted; see Open Library.
  - When every section is done and empty: "No results for “<query>”.", followed under All and Books by "Not here? Add it by hand".
- **Under All,** each section shows its first 3 rows. Its header gets "See all" when it has more, and See all selects that kind's chip. There is no navigation.
- **Under a chip,** the whole list shows:
  - In your library: every match.
  - Books: up to 20 works, plus Open Library's.
  - People: up to 20.
  - Games: pages of 20, loading more on scroll as Browse does.
- **Books ends with,** in order: its rows, the Open Library line when there is one, then "Not here? Add it by hand" (see Results).

### Open Library

- Typing searches only Atmyshelf's catalog. Submitting also calls `GET /books/search/external`, as Add book does today. Its results merge into Books by work id.
  - While it runs, Books ends with "Still searching Open Library…".
  - If it fails, that line becomes "Couldn't reach Open Library." with Retry, and the catalog results stay.
- When the catalog has no books for the query and it hasn't been submitted, Books reads "Nothing in the catalog yet." with a "Search Open Library" button, which submits. Once submitted, an empty Books hides like any other section.
- **Why not as you type:** the external search is throttled to 1 request a second for the whole server, and every hit it returns is saved as a catalog book. Partial words would fill the catalog with junk.

### Scan

- **The `scan` screen** is titled "Scan" and reads "Point at the barcode on the back cover". It sits in the Search stack, with a back chevron.
- **The camera code** moves out of `AddBookForm` into a shared scanner component that both screens use. That covers permission, the focus and app-state guards, and the first-read lock. Add book's behaviour doesn't change.
- **The first ISBN read** returns to Search with the ISBN as a submitted query and records it in Recent.
- **Unchanged from today:** non-ISBN barcodes are ignored, and a denied permission shows the message and "Open Settings".

## Results

Rows are at least 44pt tall. Covers use `CoverImage` for your own books, and `BookCover` with the result's `coverUrl` otherwise.

### In your library

- **Matching:** each word of the query must start some word of the title or of the author, ignoring case and accents ("dun" finds Dune, "herb" finds Frank Herbert, "dune herb" finds both words). A query that looks like an ISBN matches a book whose ISBN is the same, as 10 or 13 digits.
  - This is a new matcher in `@scripta/shared`, next to `filterBooks`.
- **Rows:** in shelf order. Each has the cover, title, author and a status chip: "Reading", "To read" or "Finished".
- **Tap:** opens `/book/<key>`, which goes on to the work page as today.

### Books

- **Header:** "Books", with "Tap for details, + to add" on the right.
- **Rows:** one per work, with the cover, title, "author · year" and a + button. The button's accessibility label is "Add <title>".
- **Tap:** opens `/work/<workId>`. A result without a `workId` (an Open Library hit that couldn't be saved) opens Quick add instead.
- **Works you own are left out,** since they're already under In your library. A work counts as owned when its id is in the library's `works` map, or when it has no id and its ISBN matches one of your books.

### People

- **Rows:** PeoplePane's rows: avatar, @username, `personCaption`, and Follow / Following (hidden on private profiles).
- **Tap:** opens `/u/<username>`.

### Games

- **Rows:** Browse's rows: covers, name, kind and author, and status.
- **Tap:** opens the game through `contentTarget`, as Browse does.

### Quick add

The + on a Books row opens today's `AddBookSheet`, extended:

- **Contents:**
  - The cover, title and "author · year".
  - Then "Add to your library as", with To read · Reading · Finished.
  - Then a "See the book page first" link when the result has a `workId`. It closes the sheet and opens `/work/<workId>`.
- **Finished** saves with today's date, then opens the finish sheet (`/book/<key>/finished`) in the current stack, once the library has reloaded with the new book.
  - It is opened without `before`, so "Not finished? Undo" doesn't show. The book has no earlier state to restore.
  - This applies everywhere the sheet is used: the work page, other people's shelves, a tournament's book list and tier-list voting.
- **To read and Reading** save and close as today.
- **A failed save** keeps the sheet open with today's error toast.

### Add it by hand

Opens `/add-book` with the query filled in.

## Games tab

- **Swipe tabs:** Browse · Tournaments · Tier lists · Quizzes, opening on Browse.
  - Browse is `DiscoverPane` with author links, unchanged.
  - The other three are today's lists.
- **Removed:** the header's Browse button and the `(arena)/discover` route. The public `/arena` page keeps `DiscoverScreen`.
- **New:** works as today on the three lists. On Browse it opens a sheet titled "New game" with "Tournament", "Tier list" and "Quiz", which go to `/seed/new`, `/tierlist/new` and `/quiz/new`. Its accessibility label on Browse is "New game".

## People and Community

- `/community`, `CommunityScreen`, `communityTabs` and its test are deleted.
- Home's "Find readers" buttons (the feed header and the empty feed) open a new `/people` screen in the Home stack. It is titled "People" and is `PeoplePane` on its own: suggestions, then search.
- Find readers doesn't switch to the Search tab. A cross-tab push lands on top of whatever the Search stack has open, which is the same reason Home has no "See all" into Library.

## Backend

### Search index

`books_fts` holds:

- every book with `created_by` set (seed or publisher);
- every book saved from an external search hit (today's `saveHits` path);
- every other book once ISBNdb or Open Library has returned details for it (`data_sources` is not `'[]'`, the rule the ISBN search already uses). This is how a library-created book becomes searchable.
  - It is indexed under the title and author stored for it.

A book that exists only because an account's library created it, and that no source has confirmed, stays out. That keeps the guarantee from `d0087a52`: sideloaded documents and hand-typed titles never reach another account's search.

Keeping it current:

- **A one-time rebuild** from every qualifying row, on the first boot of the new backend. It doesn't repeat on later boots.
- **Indexing on write:** when a seed or publisher book is created, when a search hit is saved, when `saveDetails` first gives a book its sources, and when `fillIdentity` gives a qualifying book its title.
- **Keyed by the book's rowid,** so "is it indexed?" is a lookup. Today's `NOT EXISTS` on the unindexed `book_id` column scans the whole index, which is fine at hundreds of rows and not at ~80k.

### Matching

- **Words:** every word must match, as today, folded the same way (`normalizeWords` plus `remove_diacritics 2`).
  - The last word also matches as a prefix once it has 3 or more characters ("dun" finds Dune).
  - Earlier words, and a last word of 1–2 characters, match whole words only. A shorter prefix would rank most of the catalog on every keystroke.
- **`GET /books/search?q=&by=work`** returns one result per work, its best-ranked edition, up to 20.
- **Without `by`:** results stay editions, up to 12, for Add book. Add book does gain prefix matching and the wider index.
- **The ISBN branch** is unchanged.

### Work ids

- `BookSearchResult` gains an optional `workId`: the canonical work id, with merged works resolved.
  - `GET /books/search` and `GET /books/search/external` both set it.
  - A hit that couldn't be saved has none.
- The change is additive. Older clients ignore the field.

### Games by book

- **With a query, `GET /community/discover?q=`** also returns published games that contain one of the 20 best-ranked works matching `q`. It uses the same index and matching as Books, and the `publishedByWorks` lookups the work page already uses.
  - These games join the name matches, deduplicated and newest first. They page by `offset`, as today, and honour `type`.
- **Without a query,** Discover is unchanged.
- Web's Discover gets the same results.

### Limits

- `/community/discover` gets its own limit: 60 a minute, keyed by account when signed in and by IP otherwise.
  - Today it shares the public community scope's 30 a minute per IP, and Search now calls it as you type.
  - The rest of that scope keeps 30 a minute per IP.
- `/books/search*` (300 a minute per IP) and `/community/people` (60 a minute per account) are unchanged.

## Data

| Part | Reads |
|---|---|
| In your library | `useLibrary()`: the books, and the `works` map for owned work ids |
| Books | `GET /books/search?q=&by=work`; `GET /books/search/external?q=` when submitted |
| People | `GET /community/people?q=` |
| Games | `GET /community/discover?q=` |
| Readers you might like | `GET /community/people/suggested` |
| New games | `GET /community/discover?limit=5` |
| Recent | AsyncStorage, per account |

Reuse `searchInsideOutside`'s split (catalog first, external on submit), `looksLikeIsbnQuery`, `canonicalIsbn`, `normalizeWords`, `bookKey`, `personCaption`, `contentTarget`, `useDebouncedValue`, `isbnFromBarcode`, and PeoplePane's and DiscoverPane's rows. No other `@scripta/shared` logic changes.

## Error handling

- **Each network section fails on its own.** It shows an ErrorState with Retry in place of its rows, and the other sections carry on:
  - "Couldn't search books."
  - "Couldn't search people."
  - "Couldn't search games."
  - "Couldn't load readers."
  - "Couldn't load games."
  - A 429 is shown the same way.
- **The library failed to load:** In your library shows "Couldn't load your library." with Retry.
- **Open Library fails:** see Open Library.
- **Quick add fails:** see Quick add.
- **Scan:** see Scan.
- **Recent's storage** fails the way the existing AsyncStorage users (theme, saved looks) handle it.

## Testing

- **Backend** (`npm test --workspace backend`):
  - **Index membership:**
    - Found: seeded, publisher, search hit, and a confirmed library-created book.
    - Not found: an unconfirmed library-created book. The existing test stays.
  - **Indexing:** the rebuild runs once; `saveDetails` and `fillIdentity` index a book.
  - **Matching:** "dun" finds Dune, "du" doesn't, and accents fold.
  - **Work ids:** `by=work` gives one row per work, and `workId` is canonical after a merge, on both endpoints.
  - **Discover:** returns a game that contains a matching book alongside name matches, pages through both, and leaves an empty query unchanged.
  - **Limits:** Discover's per-account keying.
- **Shared** (`npm test --workspace @scripta/shared`): the library matcher, covering word starts, accents, ISBN-10 vs ISBN-13, and a mismatch.
- **Mobile** (`npm test --workspace mobile`, pure models):
  - which sections show for each chip and query length;
  - All's 3-row cap and See all;
  - Recent: recording, deduping, the cap of 8, newest first, per account, and Clear;
  - merging Open Library results by work id, and leaving out owned works;
  - the Games tabs, opening on Browse.
- **Checks:**
  - typecheck and lint in every touched package;
  - `npx expo-doctor` in `mobile/`;
  - the full CI sequence.
- **Device pass** (`device-checker`, Android emulator):
  - Search before typing and while typing; chips and See all.
  - A Books row opening a work page in the Search stack, with a back chevron.
  - Quick add with To read, and with Finished opening the finish sheet without Undo.
  - Add it by hand.
  - Games opening on Browse, and New's chooser.
  - Find readers opening People in the Home stack.
  - No Community screen anywhere.
  - Scan needs a real camera, so the owner checks it on a phone.
- **Docs and tooling that name the tabs:**
  - `mobile/README.md`: the tab list and the route table.
  - The Maestro flow `mobile/.maestro/login-navigation.yaml`.
  - The beta-tester agent's tab list.

## Delivery

Three PRs, in order:

1. **Backend:** the index, prefix matching, `by=work`, `workId`, games by book, and Discover's limit.
   - It is additive and goes live on its own.
   - Before deploying, check the Railway volume's free space. The plan estimates the index's size from a local rebuild of the seeded catalog.
2. **Games and People:** Games opens on Browse, Community goes, and `/people` arrives. It doesn't depend on PR 1.
3. **The Search tab:** the routes, the screen, Recent, the shared scanner and Quick add.
   - It ships over the air.
   - It is useful once PR 1 is live in production. Until then, Books rows have no `workId` and open Quick add.

## Later

- **The web:** a search page, and the phone bar.
- **Indexing under the source's title:** needs the details lookup to keep the title it found.
- **Reader counts:** on Books rows and in Quick add.
- **The Library screen's search:** adopting the new matcher.
- **Carried over from the Phase 1–2 spec:**
  - "See all" from Home into the Library's Reading shelf.
  - Anchoring the post-sign-in redirect.
