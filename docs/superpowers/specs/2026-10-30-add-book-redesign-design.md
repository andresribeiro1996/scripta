# Mobile Add a book redesign

Date: 2026-10-30. Scope: the phone app only (`mobile/`). The web `AddBookModal` is untouched.

## Why

The user saw another reading app's Add Book screen and likes its UI and UX: a search card that auto-fills the form, a cover preview with Find cover / Upload, big tappable chips for format and status, and one large Add button. Scripta's form (`mobile/src/features/library/components/AddBookForm.tsx`) is a plain column: Search input + button, result rows, then Title, Author, ISBN, Publisher, a Status row and an Add button. The user wants "all of it" — the example's look **and** the information it collects (format, page count, cover, genre).

References: `2026-10-30-add-book-redesign-mockups/reference-*.jpg` (the example app) and `add-book.html` (the agreed Scripta mockup, shown in chat; open it in a browser — two phones: just opened, and after tapping a result).

## Goals

- The form looks and flows like the reference, drawn with Scripta's theme tokens (it follows whichever of the 11 themes is active, not the reference's fixed palette).
- Tapping a search result fills title, author, cover, page count (when known), genres, ISBN and publisher.
- The user can set a cover before the book exists: Find cover or Upload.
- The user can record format and page count.
- Nothing Scripta's form does today is lost: ISBN, publisher, barcode scan (including opening with the scanner on via `?scan=1`, and `?q=` prefill), the Open Library "outside" results, series line on results, auto-select when exactly one result comes back.

## Non-goals

- No change to the web add-book modal.
- Format and page count are **metadata only**: nothing displays, filters, sorts or edits them after the book is added. No book-page or library UI for them.
- No custom free-text format ("Other" is just a value).
- No rating or date-read inputs on mobile (unchanged from today).

## Anti-goals

- A required page count. Audiobooks and books not in hand must be addable with title + author alone.
- An uploaded photo left in the user's gallery after they abandon the form.
- Saving a book whose cover is a blurry thumbnail when the preview looked fine.

## The screen, top to bottom

Header stays the existing sheet header "Add a book" with its close button.

1. **Search card** — a surface card. Header row: search icon, "Search for a book", subtitle "Auto-fill title, author, pages & cover", fold chevron. Expanded body: one input (placeholder "Title, author or ISBN"), a **scan** button and a **search** button beside it, the hint "Tap a result to fill the form", then results (cover thumb, title, series line if any, byline, chevron), then the Open Library pending/failed lines. Opens expanded. After a result is tapped the card folds to its header, with the subtitle naming the book that filled the form; tapping the header expands it again with the query and results still there. The scanner, when on, shows inside the expanded card.
2. **Cover row** — a 2:3 cover preview (placeholder book icon on `accentSoft` when empty) and, beside it, "Cover image", a status line ("No cover yet" / "From search" / "Chosen" / "Uploaded"), and two outlined buttons **Find cover** and **Upload**.
3. **Title \*** and **Author \*** inputs.
4. **Format** — four chips: Hardcopy, Ebook, Audiobook, Other, each with an icon. Single choice, default **Hardcopy**.
5. **Total pages** — optional numeric input. Filled from the picked result when known; the user can change or clear it.
6. **Genre (optional)** — multi-select chips from the shared 26 `BOOK_GENRES`. Picked genres show as selected chips; an "+ Add" chip opens the full list. Filled from the picked result.
7. **Add as** — three equal chips: **Reading**, **To read**, **Finished**. Default **Reading** (today's default is Finished; the user accepted the change).
8. **More details** — a folded row; expanding shows **ISBN** and **Publisher** inputs. Filled from the picked result.
9. **Add to library** — a primary button pinned to the bottom of the sheet above the keyboard-safe area, disabled until title and author are non-blank. The save error, if any, shows just above it.

## Behaviour

- **Picking a result** (tap or the one-result auto-select) overwrites title, author, ISBN, publisher, genres and page count with the result's values (a blank result value clears that field). Format and Add as are left as the user set them. *(Claude's call:)* a cover the user chose by hand (Find cover or Upload) **survives** a result pick, a scan and an auto-select; the result's cover only replaces an empty preview or one that itself came from an earlier search result. So a result pick never deletes an upload.
- **Scanning** keeps today's behaviour (fills the query and ISBN, clears the other fields except a hand-chosen cover, runs the search).
- **Find cover** shows cover candidates for the current ISBN / title / author (the existing `FoundCovers` flow keys on exactly these) and the picked one becomes the preview. It needs at least a title or ISBN; otherwise the button explains that.
- **Upload** opens the photo library, uploads to the user's gallery immediately (existing `uploadGalleryImage`), and shows it as the preview.
- **Abandoned uploads are deleted.** Any photo uploaded from this form that does not end up as the saved book's cover is deleted from the gallery (`DELETE /gallery/:id`): when the user closes or backs out of the form without adding, and when they replace an uploaded photo with another cover before adding. A failed delete is not silent — it is reported to the user (toast), not swallowed.
- **Cover on save.** The saved book shows the cover the preview showed, at normal (not thumbnail) size. A cover that came only from the search result may instead be left to the existing cover-resolve chain if that yields the same image; the builder decides, but the anti-goal above holds.
- **Unsaved changes.** Leaving a partly filled form behaves as it does today unless the builder adds the existing `useUnsavedChangesGuard`; either way the upload clean-up above runs on every exit path that doesn't add the book (close button, Android back, swipe-down).

## Data

- Format and page count are stored on the library record next to the existing underscore keys (`_genres`, `_coverUrl`), e.g. `_format` (`"hardcopy" | "ebook" | "audiobook" | "other"`) and `_pages` (positive integer or absent). They travel through `buildManualBook` in `@scripta/shared` (extend `ManualBookFields`) and the passthrough `POST /library/books/add`. No `library_books` column, no migration — they are not queried.
- *(Claude's call)* **Adding a book that's already in the library** (the add merges via `mergeBookPair` in `packages/shared/src/library/merge.ts`): `_format` and `_pages` follow incoming-if-present, else existing — the same rule `merge.ts` applies to `_coverUrl`. The form always sends a format (it has a default), so re-adding sets the format the form showed; that is accepted. A blank page count sends no `_pages`, so an existing one survives. In dedupe (`dedupe.ts` `combineBooks`) the same rule: keep whichever copy has a value, preferring the newer.
- Covers on the record use the existing setters: an upload → `setBookCover(book, imageId, url)`; a Find-cover pick → `setBookCoverUrl(book, url)` (which clears any stale `_coverImageId`).
- Page count reaches search results by adding an optional `pages` to `BookSearchResult`: catalog results from `books.pages` (`backend/src/modules/books/booksService.ts` `toSearchResult`), Open Library results from the doc's page-count field if its search API returns one (otherwise absent).
- Genres are already carried on results and on the record (`_genres`, `_genresFrom: "catalog"`). *(Claude's call)* When the user edits genres in the form, `_genresFrom` is left off, so the catalog genre refresh (`withCatalogGenres`) treats them as the user's own and never overwrites them. Genres taken unedited from a result stay tagged `"catalog"` as today.

## Constraints

- Phone only; reuse `mobile/src/ui` components (`Input`, `Button`, `SheetHeader`, `Segmented` if it fits) and `features/library/components/StyleControls.tsx` (`Chip`, `SelectRow`). A genre multi-select already exists inline in `mobile/src/features/murals/ContentTab.tsx` — extract or reuse rather than write a third.
- Another session is redesigning the mobile book page and adds a group to the existing `CoverPicker` (spec `2026-10-30-mobile-book-page-design.md`). Reuse `FoundCovers` / `covers.ts` here without changing `CoverPicker`'s layout, to avoid colliding.
- Theme tokens only, no hard-coded colours; must look right in a dark theme too.
- Android text measuring and native `Menu` quirks noted in the repo's memory apply (one-line labels can clip).

## Left to the builder

- Component split, state management, icons, exact spacing.
- Whether Format and Add as use `Segmented` or chips (chips match the mockup; four format labels may not fit a segmented control).
- How the folded search card animates, if at all.
- Tests: shared `buildManualBook` with the new fields, `mapOpenLibraryDoc`/`toSearchResult` pages, and the upload clean-up logic as a pure unit where possible.

## Calls Claude made (user to check)

- Page count optional (the reference marks it required).
- "Other" format is a plain value, no free text.
- Genres as multi-select chips, not the reference's single dropdown.
- Scan button beside the search box; ISBN and Publisher folded under "More details".
- Default Add as = Reading (user said "looks ok").
- A replaced upload is deleted too, not only on cancel.
- A hand-chosen cover survives a later result pick or scan.
- Re-adding an owned book overwrites its format with the form's value.
- When two copies are merged by dedupe, the surviving copy's format/pages win and the other only fills blanks (the existing `combineBooks` rule), not "newer wins".
- A cover that came only from a search result is preview-only and not written to the book; the saved book gets its cover from the normal resolve chain (full size), which may pick a different image than the preview for Open Library results.
- Find cover may create a catalog row for the typed title/ISBN even if the form is then abandoned — the same thing cover resolving already does.
