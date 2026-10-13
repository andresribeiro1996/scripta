# Mobile tabs and Home — design

Phases 1 and 2 of the mobile navigation redesign. Phase 3 (a Search tab that finds any book) and the web's phone layout get their own specs.

Mockups: the "Atmyshelf mobile UX" design canvas (private to the owner). Everything needed to build is written out here, so the canvas is not required.

## Goal

- **Library one tap from anywhere.** Today it is My shelf → ⋯ → Manage library…. The My shelf tab opens on the public shelf mural instead. Its Library swipe tab (`OwnLibraryPane`) is a second, lighter library whose filters are ordered differently from the real one.
- **A Home worth opening.** Today it shows:
  - Reading now: every Reading book as an untitled 72pt cover with no action.
  - Up next: the first 10 books of the whole to-read pile, in shelf order.
  - Rediscover, then 3 activity rows, with Community as a header button.
  - Atmyshelf is not the e-reader, so the only useful actions on a current book are "I finished it" and "pick the next one". The feed is the content that changes most, and it is the part pushed off the screen.
- **One job per tab.** The target bar is Home · Library · Search · Games · You. Murals and Settings stop taking two of five tabs.

## Non-goals

- Reading progress anywhere: no percentages, progress bars or "last read" lines.
- The Search tab, people search outside Community, and opening a catalog result's book page. That is phase 3, and it needs search results to carry a work id.
- The web client. Its phone bar keeps Home · Library · Series · Collections · More for now.
- The Library header layout. The library name stays a page heading and Add stays in the header, as DESIGN.md prescribes. The mockup's floating Add button and name-in-the-bar are not part of this spec.
- Any change to `buildDashboardCards`, `upNextPair` or other `@scripta/shared` logic the web Home also reads.
- Where your own profile opens. `/u/<your username>` keeps rendering My shelf inside whichever tab pushed it, as today.
- The Games tab layout, and the finish sheet itself.

## Tab bar

| Tab | Job | Root screen | Icon |
|---|---|---|---|
| Home | Your current books and what the people you follow did | `/` — HomeScreen | `home`, badge = personal new count (as today) |
| Library | Your books | `/library` — LibraryScreen | `library` |
| Games | Unchanged | `/my-arena` — ArenaHomeScreen | `arena` |
| You | Your page and what you make | `/you` — new YouScreen | `profile` (gains a filled variant) |

Search joins between Library and Games in phase 3. Until then the bar has four tabs.

- My shelf, Murals and Settings stop being tabs.
- Their URLs (`/me`, `/murals`, `/murals/<id>`, `/settings`) do not change. Expo Router group folders aren't part of a URL, so deep links and the `dashboard/*` redirects keep working.
- Every route a You-stack screen pushes must exist in the You stack, the way book routes already sit in the shared `(home,arena,library)` group. Otherwise a push jumps tabs or lands with no back chevron, which is the "stranded cross-tab screen" bug fixed in PR #196. So:
  - The shared group becomes `(home,arena,library,you)` and holds `book/*`, `work/*`, `u/*` and the mural editor `murals/[id]`. My shelf can render in any of those four stacks through `/u/<your username>`, and its "Edit shelf" pushes the editor.
  - `add-book` and `import` move to `(home,library,you)`, because My shelf's empty state pushes them.
  - The `dashboard/murals/<id>`, `dashboard/murals` and `dashboard/settings` redirects land in the You stack with the hub beneath (`withAnchor`). Without it, a cold deep link leaves Murals or Settings alone in the stack, with no way back to the hub.

## Phase 1 — Library and You tabs

### Library

- The tab opens LibraryScreen, not MyShelfScreen.
- Shelves read Reading · To read · Finished, then Collections.
- It opens on the shelf last used in this app session. That is kept in memory, the way My shelf keeps its tab. The first open of a session lands on Reading.
- Nothing else on the screen changes: heading, Add, ⋯ menu, search, sort, duplicates, selection.

### You

A hub that links to screens that already exist. Top to bottom:

1. **Header.** Title "You". On the right, a framed, labelled "Settings" button that opens `/settings`.
2. **Profile row.** Avatar (`AuthorAvatar`), `@username`, and one line reading "Published" or "Private". The line comes from the own-profile query My shelf already uses. It is left out while that loads or if it fails; My shelf, one tap away, shows that error with Retry.
3. **Rows.** Each is a full-width target at least 52pt tall, with a chevron:
   - Your shelf → `/me`
   - Murals → `/murals`
   - Reader card → `/reader-card`
   - Gallery → `/gallery`

Changes to existing screens:

- **My shelf (`/me`)** keeps its header (Published chip and ⋯).
  - It loses its Library swipe tab, so it becomes Shelf · Activity.
  - It loses "Manage library…" from ⋯.
  - `OwnLibraryPane` is deleted.
- **Settings** loses its "Reader card" and "Open gallery" buttons, which are now rows in You.

## Phase 2 — Home

Top to bottom:

1. **Header.** Brand mark and "Home". The Community button is removed.

2. **Empty library.** Today's empty state (Import library / Add a book manually), unchanged. Sections 3–5 are hidden. The feed (6) still shows below it.
   - While the library loads, a spinner takes the place of sections 2–5.
   - If the library fails to load, today's "Couldn't load your home." error with Retry takes their place.
   - In both cases the feed still loads and shows.

3. **Continue reading.** Shown when any book is Reading.
   - The header reads "Continue reading" and the count.
   - One card per Reading book, in shelf order, in a sideways scroll sized so the next card peeks in.
   - There is no cap and no "See all". A cap would hide books behind a jump to another tab. "Move to To read" in ⋯ is how a stale Reading book leaves.
   - Each card has a 72×108 cover, the title (display font, up to 2 lines), the author, a secondary "Finished" button and a ⋯ menu.
   - **Finished** does the same as the book screen's status menu → Finished: it saves status 2 with today's date, then opens `/book/<key>/finished?before=…`. If the save fails, nothing opens; the save has already alerted.
   - **⋯** offers "Move to To read" (saves status 0) and "Open book".
   - Tapping the cover or the title opens the book.

4. **What's next?** Shown when nothing is Reading and at least 2 books are To read.
   - This is today's "Pick your next read" sheet, inline as a card:
     - Title: "What's next?"
     - Body: "Two from your to-read pile. Starting one moves it to Continue reading."
     - Two covers with titles, each with "Start this one", then "Another pair".
   - "Start this one" saves status 1 and no date, as today. The card then gives way to Continue reading.
   - The Up next row, its count, the "Can't choose?" link and the `PickNextSheet` component are removed.

5. **From your highlights.** Today's Rediscover card. The heading becomes "From your highlights" and "Show another" becomes "Another".

6. **From people you follow.** The whole digest from `GET /community/dashboard`, not 3 rows. The list itself is Home's scroll.
   - **Header:** "From people you follow". It shows the new count as today (`· N new`) when the personal new count is above 0, and has "Find readers" on the right, which opens `/community?tab=people`.
   - **Rows:** today's `FeedRow`, unchanged, with new dots.
   - **Loading:** more pages load as you scroll. Pull to refresh refreshes both the library and the feed.
   - **Empty:** "Nothing here yet. Follow readers to see what they finish and publish." with a "Find readers" button.
   - **Errors:** today's ErrorState with Retry, in place of the rows. A failed next page shows it at the end of the list instead.
   - **Seen marker** (`POST /community/dashboard/seen`): sent at most once each time Home gains focus. It goes out when a feed row is first on screen, with loaded data, no error and nothing fetching. A failure leaves the badge and is tried again on the next focus.

7. **Community screen (`/community`).**
   - The Activity tab is removed. The screen becomes Discover · People and opens on People unless `?tab=discover`.
   - It no longer sends the seen marker; Home does.
   - It stays until phase 3 moves people search into the Search tab.

## Data

- No backend or API changes.
- In `@scripta/shared`, only the order of `LIBRARY_STATUS_TABS` changes. Its one consumer is the mobile Library screen; a shared test checks its labels, not their order.
- Each Home section comes from today's `buildDashboardCards` output:
  - Continue reading: the `currentlyReading` keys.
  - What's next?: the `upNext` keys, paired with `upNextPair`.
  - The highlight: the `rediscover` card.
- The feed is `useDashboardFeed()`, as today. The Home tab badge keeps reading `personalNewCount`.

## Error handling

- Status saves go through `useLibraryActions().setStatus`. It alerts on failure and resolves `false` (`attemptUpdate`), and returns `undefined` when the status is unchanged. The finish sheet opens only after a successful save that moved the book to Finished.
- Feed load and next-page errors keep today's ErrorState with Retry. The refetch-error toast stays.
- A failed seen marker is not surfaced. The badge stays and the next focus retries.

## Testing

- **Mobile unit tests** (`node:test`, `npm test --workspace mobile`):
  - A pure Home model deciding which sections show for: an empty library; nothing Reading; one and several books Reading; 0, 1 and 2 books To read; with and without a highlight.
  - The seen-marker rule: focused, a row on screen, loaded, no error, nothing fetching, not yet sent.
  - Community tabs without Activity, including the `?tab=` fallback.
  - Library shelf order and the opening shelf.
- **Checks:** `npm run typecheck --workspace mobile` and `npx expo-doctor` in `mobile/`.
- **Device pass** (`device-checker`, Android emulator) after each phase:
  - Phase 1: tabs, the Library landing shelf, the You rows, back chevrons inside You, and the murals editor.
  - Phase 2: Home's sections, Finished → finish sheet, the duel, the feed's paging and badge clearing, and Find readers.
- **Docs and tooling that name today's tabs:**
  - `mobile/README.md`: the tab list and the route table.
  - The Maestro flow `mobile/.maestro/login-navigation.yaml`.
  - The emulator-verify skill's wait text: "My shelf" becomes "Library".
  - The beta-tester agent's tab list.

## Later

- **Search tab (phase 3):** your books, any book, people and games, with Scan. Opening a catalog result's book page needs search results to carry a work id, and library-created editions to be searchable.
- **Actions on feed rows** ("Rank it", "Vote", "Play"): dashboard rows don't carry `viewerVoted` today, so an action would still offer "Rank it" after you ranked. It needs that field added to the dashboard response (an additive backend change).
- **"See all" from Home into the Library's Reading shelf:** needs a jump to another tab's root that doesn't push a second Library screen when that tab has a screen open.
- **Your own profile:** whether `/u/<your username>` should open in the You tab.
- **Library header compaction:** the name in the bar and Add as a floating button. This is a DESIGN.md change.
- **The web phone bar.**
