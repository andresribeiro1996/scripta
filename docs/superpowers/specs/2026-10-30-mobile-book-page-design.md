# Mobile book page redesign

Date: 2026-10-30. Scope: the phone app only (`mobile/`). The web book page is untouched.

## Why

The user finds the mobile book page "messy and clunky" and the text "cramped". Today (`mobile/src/features/works/BookScreen.tsx`) about ten hero items — cover carousel, title, series, author, awards, a characters sentence, a "Make a character game" button, genre chips, rating stars, stats tiles, year — sit in one column 4px apart, almost all at 12pt. Below them the reading status and "how it landed" are two half-width 44pt buttons, then an icon-only tab bar (ⓘ, 99, people) whose meaning has to be guessed.

The fix is not to cram the same things tighter but to **use the page's length**: a calm, clearly-ordered top, bigger type, and secondary material (editions, characters, the game entry point) behind rows that open sheets further down. Not everything has to be on the first screen.

## Goals

- The cover stands out and stays clean — nothing drawn on it.
- The hero reads as distinct groups with real spacing, not a 4px pile.
- Hero and section text at `body` (14) or larger — no new type token. `caption` (12) is only for small hints (e.g. the editions row's language hint). The synopsis is comfortable to read.
- Reading status is a small, tappable badge, not two big buttons.
- Editions and characters are rows that open bottom sheets with vertical lists.
- Tabs say what they are.
- A book you don't own has one obvious action, always in reach.

## Non-goals

- No change to the web page, the backend, or the `/work` API payload.
- No new data (publishers, character descriptions, etc.). Sheets show what `WorkPage` already carries.
- No new way to remove a book from the library (today that only happens from the library's multi-select; it stays that way).
- No change to the ⋮ menu's existing items (Card style, Change cover) or the share button. The cover picker gains one group (below); its other groups are unchanged.
- No change to Highlights and Community tab contents beyond what's listed below.

## Anti-goals (would be a failure even if it works)

- Anything overlaid on the cover (badges, ribbons, buttons).
- A hero so big the title block is pushed off the first screen. The user rejected a ~200pt cover as "not that big".
- Bringing back a full-width button row for status.

## The page, top to bottom (owned book)

Reference mockups were shown in chat; the final one is "mobile_book_page_full_redesign".

1. **Cover band.** The cover alone (for your own edition, your library cover including any custom one, as `EditionStrip` does today via `CoverImage`; otherwise the edition's cover), centred, about **150pt wide** (today 112×168; keep the 2:3 ratio), on the existing cover-colour wash (`WashBackdrop` / `coverWash`). The edition carousel (`EditionStrip`, dots, "Your edition · 4 of 4 ▾") is **removed**; the cover shown is the selected edition's (or the default one, as `bookScreenModel` already picks).
2. **Title block**, centred, with clear spacing between groups (e.g. `spacing.md`–`spacing.lg`, not `xs`):
   - Title — `heading` (24/30) display font, as today.
   - "by {author}" — larger than today's 14pt body (input/16 or similar).
   - **Status badge** (owned only) — a small pill, tinted with the accent soft colour, no border, e.g. "✓ Finished · All-time ▾" or "Reading ▾" or "To read ▾" (feeling only shown when finished, as today). Chevron is an icon, not "▾". Tapping opens the **status sheet**.
   - One meta line at `body`: series link (still tappable to series search, as `SeriesLine` does) · year (the selected edition's, as `model.meta` follows today) · ★ rating · rating count. Drop any part that's missing. Pages and language leave the hero (language and year stay visible per edition in the editions sheet). The separate `RatingStars` row and `meta` line merge into this. Claude's call: compose it in mobile from existing model fields; only touch `bookScreenModel` if a field is missing, and then cover it in `bookScreen.test.ts`.
   - Award pills and the author-awards line stay in the hero, below the meta line (not in the fixture, but must still render).
   - Genre chips (and dashed "Possibly …" chips) with real inner padding (≈4pt vertical, 10pt horizontal), text at `body`.
3. **Tabs with labels**: text tabs (underline or filled selected state) using `model.tabs[].label` — the same labels web shows ("About", "Highlights (n)", "Community (n)"). Icons optional beside the label; the label is required.
4. **About tab**, in order:
   - Synopsis at a larger reading size (≈15–16pt, line height ≈1.6–1.7), "Show more / Show less" as an accent text link rather than a full-width secondary button. The "About this book" heading can go — the tab already says About.
   - **"N editions" row** — a full-width bordered row (icon, "4 editions", optional short dim hint such as the languages, chevron). Shown when the work has ≥2 editions. Opens the **editions sheet**. The old inline Editions list and "Show all 4" button go.
   - **"N characters" row** — same row style. Shown when the work has any characters. Opens the **characters sheet**. The hero characters sentence and "+N more" go.
   - **"Change cover" row** — same row style, owned books only (a cover choice changes only your own copy). Opens the existing cover picker (`book/[key]/cover`, `mobile/src/features/library/components/CoverPicker.tsx`: upload, your gallery, found covers) with a new **"Other editions"** group: the covers of this work's other editions (`page.work.editions[].coverUrl`, skipping missing ones and the one already in use). Picking one saves it like a found cover (`saveBookCoverUrl`). The ⋮ menu's "Change cover" stays. Claude's call on placement — the user asked for a visible button and rejected anything on the cover.
5. **Highlights tab** — unchanged content.
6. **Community tab** — unchanged content, plus the stats tiles ("Top tier · 3 lists · Semis ›", `StatsTiles`) moved here from the hero, at the top above the reader count, still opening the stats screen. (Claude's call; the user didn't object.)

## Sheets

All use the existing `Sheet` from `mobile/src/ui/components.tsx`.

- **Status sheet** — "Your reading": the three statuses (To read, Reading, Finished) as a selectable list, and when Finished, a "How it landed" row of the five feelings (Not for me … All-time) as chips — reuse `mobile/src/features/library/components/FeelingChips.tsx`. A follow-up (`2026-10-30-six-star-rating-design.md`) replaces these chips with a six-star control everywhere, this sheet included; don't build stars here. Selecting calls the same `useChangeStatus` / `setRating` the current `OwnerRow` menus call. Picking a status closes the sheet; picking a feeling keeps it open. Choosing Finished keeps today's finish-step navigation from `useChangeStatus` — close the sheet first, then navigate, copying `ActionSheet`'s pending-until-dismissed pattern for iOS. No "Remove from library".
- **Editions sheet** — "Editions": every edition in `page.work.editions`, in a scrollable list (no cap; works can have dozens), each with a small cover thumbnail, title, and `editionLabel(edition)` (language · year · ISBN as today), "Yours" marked, and the currently selected one checked. Tapping a row selects that edition (the existing `onSelectEdition` / `editionId` state in `WorkScreen`) and closes the sheet; the page then shows that edition's cover, title, series and meta exactly as the carousel does today. A way back to your own edition is simply tapping the "Yours" row.
- **Characters sheet** — "Characters": the full list (`shown` + `more`), one per row, and at the bottom **"Make a character game"** (shown only when `canMakeGame && signedIn`, as today), opening the existing cast picker (`workCharactersPath`). This is the only entry point to character games; it leaves the hero.

## Not owned

- No status badge in the title block.
- Tabs: About and Community only (as today, Highlights needs `book`).
- A **fixed bar at the bottom** of the screen, above the app's tab bar, with one full-width primary button labelled **"Want to read"**. It stays visible while scrolling; page content gets enough bottom padding not to be hidden behind it.
- The label is always "Want to read" (the old "Add this edition" wording goes). Tapping it adds the book (the selected edition, from `model.addBook`) to the library **as To read, with no further step**, then the bar disappears and the status badge appears **in place** — the page must not blank to the full-screen skeleton (`WorkScreen.tsx:67`) or lose scroll position while the library refetches; keep the page rendered and the bar in a busy state until the book arrives. Signed out: tapping opens the existing "Sign in to add books" sheet from `AddBookSheet`.
- Errors: a failed add shows an error toast (as `AddBookSheet` does with `saveFailureMessage`) and the bar stays.
- Owning any edition of the work makes `primary` "owner" (`bookScreen.ts:108`), so the bar never shows on a work you own, whichever edition you're viewing.

## Constraints

- Tokens from `mobile/src/ui/theme.tsx` and `DESIGN.md`; no new colours. Use `minimumTouchTarget` (44) for every tappable control, including the badge (hit slop is fine) and sheet rows.
- `bookScreenModel` is shared with web (`packages/shared/src/works/bookScreen.ts`). Mobile-only presentation stays in `mobile/`. If the model changes (e.g. a combined meta line, a characters count), web must keep compiling and behaving the same, and `bookScreen.test.ts` covers the change.
- Glyph characters ("▾", "→") on this page become `Icon`s.
- Light and dark themes both.
- `BookRoute` (`book/[key]`, `page = null`, books with no work) must still render: cover band, title block with badge, Highlights content. No About/Community, no sheets.
- Android Text measuring traps apply (see the repo's notes on one-line `Text` with `lineHeight`): pills and one-line labels must not clip.

## Left to the builder

- Exact sizes within the ranges above, the tab style (underline vs filled), whether tabs carry icons, and the editions row's hint text.
- Whether the merged meta line is built in shared or mobile.
- How the fixed bottom bar is laid out relative to `Screen`'s safe area and the tab bar.

## Claude's calls (for the user to check)

1. Stats tiles ("Top tier · 3 lists") move to the top of the Community tab.
2. Tab labels follow the shared model ("Community (n)"), matching web, rather than the "People" shown in mockups.
3. The added book's badge reads "To read" (the app's existing label) though the button says "Want to read".
4. "Show more" becomes a text link; the "About this book" heading is dropped.
5. The "Change cover" row sits in About under characters; owned books only.
