# Merged book screen — design

Piece 1 of 3. Piece 2 (community rating + Stats page) and piece 3 (tier and tournament stats) get their own specs.

## Goal

Tapping a book today opens a "Book details" sheet (mobile `BookDetail`, web `BookDetailSheet`) whose actions are three equal buttons (Style / Cover / About this book, plus two admin buttons on web), with the status shown twice and the rarely used tools sitting between status and highlights. "About this book" then opens a second screen, the work page (mobile `WorkScreen`, web `WorkPageView`), that repeats the cover and title.

Replace both with one book screen: a hero, the one or two controls used often, three tabs (About, Highlights, Community), and the rare tools behind "⋯". Show genres and the Open Library rating. Drop the reading percentage.

## Non-goals

- Themes. No source exists; genres only.
- Community rating, Stats page, average tier, tournament placements (pieces 2 and 3).
- Swipe between tabs.
- Changes to the Card style, Cover picker or finish flows themselves.

## Routing

- `/work/:id` (web and mobile, signed in and public) renders the merged screen. It keeps its canonical-id redirect.
- Mobile library entry points (`LibraryScreen`, `HomeScreen`, `GroupDetail`, `OwnLibraryPane`) keep pushing `/book/<key>`; that route replaces itself with `/work/<workId>` when `library.works[bookKey]` is set. Web entry points (`LibraryPage` cards, `HomePage`) navigate straight to `/work/<workId>`, else to the new signed-in web route `/book/:key`.
- `/book/<key>` with a resolved work id redirects (replace) to `/work/<workId>`. Unresolved, it renders the merged screen in library-only mode: hero from the library book, owner controls, Highlights tab only, no About details or Community.
- Mobile: a pushed full screen, not a sheet. Web: a page; `BookDetailSheet` and the library's modal state go away.
- `/book/<key>/style`, `/cover`, `/finished` stay as they are; the merged screen links to them using `mine.bookKey`. On mobile the `book/[key]` folder moves from `(home,library)` to `(home,arena,library)` so a book opened from the Arena tab reaches them in its own stack.
- Web has no `/book/<key>/…` routes today: Style and Cover open as modals from `LibraryPage` state (`styleBookKey`, `CoverPickerModal`). The web screen needs the same actions reachable from `/work/:id`; the plan decides whether that is a route or the existing picker components mounted by the page.

## Data

`GET /works/:id` → `WorkPage.work` gains four fields, all derived from the work's editions in `works/service.ts`:

| Field | Type | Rule |
|---|---|---|
| `genres` | `string[]` | Union of every edition's stored genres, normalised with `normalizeBookGenres` (`@scripta/shared`), ordered by how many editions carry each, max 3 |
| `rating` | `{ value: number; count: number } \| null` | The edition with the highest `rating_count` and a `validBookRating` value |
| `year` | `number \| null` | Earliest edition `year` |
| `pages` | `number \| null` | The viewer's edition's `pages`, else the first edition with `pages` |

`CatalogWorkPage.editions` (and `workPageRows`) gain `genres`, `rating`, `ratingCount`, `pages` from the `books` table; they are not exposed per edition in `WorkPage`.

Fields are filled lazily by `/books/details`, so any of them can be empty. Empty means the UI omits it — no placeholder.

The owner's status, rating, highlights and notes still come from the library document, found by `mine.bookKey`.

## Who sees what

| Viewer | Primary control | Tabs | ⋯ menu |
|---|---|---|---|
| Owns the book | Status button; feeling button when finished | About · Highlights · Community | Card style, Change cover |
| Signed in, not owned | Add to library | About · Community | Admin items only (web) |
| Signed out | Add to library → sign-in | About · Community | — |
| Owns it, work unresolved (`/book/<key>`) | Status button; feeling button when finished | Highlights | Card style, Change cover |

Admins on web also get Wrong cover and Replace cover in ⋯ regardless of ownership. ⋯ is hidden when it would be empty.

This decision lives in one pure function in `@scripta/shared` (e.g. `bookScreenModel(page, libraryBook, { signedIn, isAdmin })`) returning the control, the tab list with counts, the ⋯ items' keys, the meta line and the editions preview. Web and mobile render from it.

## Layout

Top to bottom (mobile; web narrow is the same):

1. **Header** — back; right side: Share (existing behaviour), ⋯.
2. **Hero** — centred cover (not tappable), title, author, up to 3 genre chips (not tappable), one meta line `★ 4.1 · 2.3k ratings · 2020 · 245 pages` with missing parts dropped and the line hidden when all are missing.
3. **Primary row**
   - Owned: status button showing the current status, opening a menu with the three `statusLabel` values (To read / Reading / Finished) with a check on the current one. Picking Finished from another status runs the existing finish flow (`/book/<key>/finished?before=…`). When finished, a feeling button beside it opens the five `FINISH_FEELINGS`; unset it reads "How did it land?".
   - Not owned: full-width "Add to library" → existing `AddBookSheet`.
4. **Tab switch** — icon-only: About (info), Highlights (quote), Community (people). No visible text; each tab's accessible name is its label with the count, "Highlights (n)" / "Community (n)" (also the web tooltip), and the selected tab is exposed as pressed/selected. Always opens on About (Highlights when it is the only tab). Tab content renders below in the same scroll.
5. **About** — summary with the existing `summaryPreview` and Show more; "Editions" listing the first 3 (`editionLabel`, "Yours" marker) and "Show all N" expanding in place.
6. **Highlights** — the current list unchanged: quote, annotation, Delete on notes with the existing confirm.
7. **Community** — counts line, "People you follow", "Others" (current rows, privacy and profile links), then "Games" (moved from the work page) with its current empty copy.

Web wide (`sm` and up): two columns — left column holds cover and hero and stays in view; right column holds the primary row, tab switch and tab content.

## Components

- Mobile: `Menu`/`MenuItem` (native) for status, feeling and ⋯; a row of `Icon` toggle buttons as the tab switch (the native segmented controls take text labels only); `IconButton` + `HeaderActions` in the header; existing `ContentShareSheet`, `AddBookSheet`, `ReaderGlyph`, `AuthorAvatar`.
- Web: `OptionsMenu` for the three menus — it only has a gear trigger today, so it gains a way to pass the trigger content; tab switch as plain icon buttons matching the current status group styling; existing `AddBookSheet`, `useConfirm`, share code from `WorkPage`.
- Deleted: mobile `BookDetail`, the mobile `book/[key]/index.tsx` body (becomes the redirect/fallback), web `BookDetailSheet`, web `WorkPageView`, mobile `workScreenModel` (folded into the shared model). `BookSummary` and `FeelingChips` stay (murals and finish flow use them).
- Removed from the UI: reading percentage, always-visible status segmented control, inline feeling chips, "Book details" header bar, "Your copy" card.

## Error handling

- Work fetch errors keep today's behaviour: permanent → "Book unavailable" with Back, transient → Retry.
- Status, feeling and note-delete failures surface through the existing library-action error paths; nothing new is swallowed.
- Web admin cover failures keep the inline `role="alert"` message, shown under the hero.

## Testing

- Backend: `works/service` tests for `genres`, `rating`, `year`, `pages` — mixed editions, all-empty editions, viewer edition preferred for pages, invalid ratings ignored, genre cap and ordering.
- Shared: `bookScreenModel` tests for every row of the "who sees what" table, tab counts, meta line assembly, editions preview.
- Web: typecheck, lint, tests; browser check of owned, not-owned and signed-out views at narrow and wide widths.
- Mobile: typecheck, tests; emulator pass (device-checker) on owned, not-owned and unresolved books, status and feeling menus on Android, before merge.
