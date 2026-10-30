# Library share image

Date: 2026-10-30. Scope: phone app only (`mobile/`), plus `@scripta/shared` if a pure helper is needed by it.

## Why

The library's Share action only makes a public link. Tier lists, monthly recaps and murals can already be shared as a picture to post in stories and group chats. The user wants the library to be shareable as an image too, and considers four different pictures of a library all worth having, chosen at share time.

## Goals

- Tapping **Share** on the Library tab opens `ContentShareSheet` (`mobile/src/features/sharing/ContentShareSheet.tsx`), the sheet tier lists, recaps and murals use. Its "Share as image" choice leads to a preview with Save image / Send image.
- The existing link behaviour is kept inside that same sheet: create link (`onEnableLink`), Send link, QR code, Stop sharing link (`onDisableLink`). Today's link-only screen goes away.
- Above the image preview (`previewControls`), four layout buttons switch the picture: **Wall · Summary · Reading · This shelf**. Switching redraws the preview and disables Save/Send until the new layout's covers have loaded (`imageReady`), the same way the tier list sheet's "My ranking / Community" toggle works (`mobile/src/features/tierlists/TierlistEditorScreen.tsx:177`).
- Every layout has the library name as its title (falling back to "Library", as `share.tsx` does today) and ends with the "Created with: Atmyshelf" footer used by `TierlistShareImage.tsx`.

### The four layouts

Mockup reference: `library-image-options.html` shown in the brainstorm session (A wall, B summary, C reading, D this shelf). Visual styling beyond what's below is the builder's choice, matching `TierlistShareImage`'s look (theme colours, `typography`, `spacing`).

1. **Wall** — every book in the library, all three shelves, in library order (`orderLibraryBooks(books, groups)`, `packages/shared/src/library/libraryOrder.ts`), as a tight grid of small covers. Subtitle: the book count. No cap on count: around 500 books must still come out sharp; above roughly 1,000 the existing `snapshotSize` (`mobile/src/features/sharing/shareImage.ts`) downscales and covers get softer — accepted, the export must not fail.
2. **Summary** — fixed-size card regardless of library size:
   - a fan of 4 overlapping covers: the 4 most recently finished books (`ReadStatus` 2, newest `DateLastRead` first via `parseBookDate`); fewer if fewer are finished, and if none are finished, the first books in library order;
   - three counts: books, finished, reading (`statusCounts`, `packages/shared/src/library/libraryView.ts`);
   - top 3 genres by name (`calculateShelfTheme(books, 3)`, `packages/shared/src/library/bookGenres.ts:133`). The helper returns names, not counts, so the genres are a ranked list, not bars (Claude's call). Omit the genre section when it returns none.
3. **Reading** — two sections: "Reading now" with every `ReadStatus` 1 book, then "Recently finished" with the 5 newest finished books by `DateLastRead`. A section with no books is omitted; if both are empty, show a short line saying nothing is being read or has been finished yet.
4. **This shelf** — exactly the book list the Library tab is showing when Share is tapped: the active shelf tab (Finished / Reading / To read), the search query and the sort, i.e. `sortBooks(filterBooks(ordered, query, status), sortKey)` as at `mobile/src/features/library/LibraryScreen.tsx:272`. Drawn with the user's library style: `resolveLibraryStyle` + `effectiveCardStyle` per card, the grid gap/row gap/background/padding, and title/author overlay — what `BookCard` and `LibraryGrid` apply on screen. Subtitle names the shelf (and the search query when there is one) and the count. Not offered while the Collections tab is active (Claude's call — collections aren't a book list); if the shelf has no books, the option is still shown and the preview says the shelf is empty with Save/Send disabled.

Default layout when the image view opens: **This shelf** when available, otherwise **Wall** (Claude's call — it's what the user was looking at).

## Non-goals

- No website version. Image export exists nowhere on the website and building it is a separate project; deferred by the user.
- No new backend endpoint or data. Everything comes from the library document already in the react-query cache.
- No per-layout settings (column count, which counts to show, how many recent books). The numbers above are fixed.
- No change to how the public share link works or what it shows.

## Anti-goals

- Sharing an image must not change the library's visibility or create a link. `ContentShareSheet` already says so ("Sharing an image keeps your visibility unchanged").
- Save/Send must never capture a half-loaded picture: every cover in the current layout has either loaded or settled to its no-cover fallback before `imageReady` is true.
- Losing the link controls: create, send, QR and stop sharing must all still work after the swap.

## Constraints and known facts

- `ContentShareSheet` is a `BottomSheet` with `isPresented`; every current user mounts it in the owning screen with local `visible` state. `/share` is a form-sheet route (`mobile/src/app/(app)/(library)/_layout.tsx:28`), so mounting the sheet inside it would stack a sheet on a sheet, and the route can't see `LibraryScreen`'s filter state (all local `useState`, `LibraryScreen.tsx:62-69`). Hosting the sheet on `LibraryScreen` is the obvious fit; the builder decides, and if `/share` and `ShareSheetBody` (`mobile/src/features/library/components/ShareSheet.tsx`) end up unused they are deleted along with the route entry.
- Cover readiness: `CoverImage` (`mobile/src/features/library/components/CoverImage.tsx:33`) takes `onLoadEnd`, which fires on display and when there's no cover once resolving has settled, and turns off polling. `BookCard` doesn't forward it today (`BookCard.tsx:89`). The readiness pattern to copy is `TierlistShareImage`'s loaded-set (`TierlistShareImage.tsx:22-27`).
- The capture view lives in a `ScrollView` with `removeClippedSubviews={false}`, so a wall of N books mounts N covers at once. The 24-book dev fixture can't exercise that, so the wall's cells stay light (a bare `CoverImage` at a fixed small size, not a full `BookCard`).
- Genres arrive asynchronously (`useGenreEnrichment` copies catalog genres into `_genres`); a Summary built before they arrive just has fewer or no genres. Accepted.
- Books are `Record<string, unknown>`: `ReadStatus` 0/1/2, `DateLastRead`, cover via `_coverUrl` or the backend resolver.
- "Newest finished" (Summary fan, Reading's "Recently finished"): finished books with no parseable `DateLastRead` sort after all dated ones, so they only fill leftover slots (Claude's call).
- "Stop sharing link" in `ContentShareSheet` unshares immediately, without today's "Stop sharing this link?" confirm. Accepted: adding a confirm would change the tier list, mural and arena sheets too (Claude's call).
- Repo rules apply: reuse `@scripta/shared` helpers above rather than new ones; a new shared helper only if both it's pure and genuinely needed; tests for any new pure logic (e.g. picking the recently-finished books, choosing the layout's book list).

## Left to the builder

- Component split (one component per layout or one with a switch), file locations under `mobile/src/features/library/`.
- Wall column count and cover size, fan geometry, section headings' wording beyond what's named above.
- Whether the layout buttons are `Button`s like the tier list toggle or another existing control.
- Accessibility labels for the layout buttons (selected state exposed).

## Done

- Share on the Library tab opens the new sheet; link create/send/QR/stop all work.
- All four layouts render, switch, wait for covers, save to Photos and send through the share sheet on the Android emulator, for the dev fixture library (24 books) — screenshots of each layout.
- `npm run typecheck` and `npm test` in `mobile/` pass, plus shared build/test if shared changed.
