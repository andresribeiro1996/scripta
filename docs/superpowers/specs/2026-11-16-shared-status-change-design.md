# Shared reading-status change

From the 2026-11-16 architecture review (candidate 4). Changing a book's reading status is built twice, and the copies have drifted:

- **Web** `frontend/src/hooks/useBookActions.ts:45-52` always submits, even when the status is unchanged; the server answers `changed:false`. It sends `day` only for `readStatus: 2`.
- **Mobile** `mobile/src/features/library/hooks/useLibraryActions.ts:76-80` skips the save when `setReadStatus(book, status, day) === book`. It builds the change with `day` every time, but both clients send through shared `libraryChangeRequest.ts:11`, which drops `day` unless the status is 2. So the request on the wire is the same.
- **The finish prompt** is the same rule in both clients: snapshot the book, remember whether it was finished, save, then prompt when the save succeeded, the new status is 2 and the book wasn't finished. Web has it at `frontend/src/components/book/BookScreen.tsx:119-124`; mobile at `mobile/src/features/library/hooks/useChangeStatus.ts`.

Two library helpers are also copied with no drift:

- **Possible duplicates.** `[...certain, ...likely]` from `findDuplicates` (web `frontend/src/pages/LibraryPage.tsx:70-74`, mobile `mobile/src/features/library/LibraryScreen.tsx:100-104`).
- **Group search.** A group matches the search when its name matches or any book title in it does (web `frontend/src/pages/GroupsPage.tsx:109-117`, mobile `mobile/src/features/library/components/GroupsView.tsx:78-84`). The type filters before it differ: web filters by page type and selected group, mobile has an "all" option. Those stay per client.

## Decision

Everything below goes in `packages/shared/src/library/`, re-exported from `library/index.ts`.

- `libraryChange.ts` gains `statusChange(book: LibraryBook, status: ReadStatus, day: string): LibraryChange | null`. It returns `null` when `setReadStatus(book, status, day) === book`. Otherwise it returns `{ kind: "book", bookKey: bookKey(book), readStatus: 2, day }` for 2, and `{ kind: "book", bookKey, readStatus }` without `day` for 0 or 1.
- `finish.ts` gains `promptsFinish(book: LibraryBook, status: ReadStatus): boolean`, which is `status === 2 && book.ReadStatus !== 2`.
- `dedupe.ts` gains `possibleDuplicates(data: LibraryData | undefined)`, returning `[...certain, ...likely]` (or `[]`).
- `groups.ts` gains `searchGroups(groups: Group[], books: LibraryBook[], search: string): Group[]`. It applies the name-or-title match to groups that are already filtered and sorted.

The clients use them like this:

- Web `setStatus` and mobile `setStatus` both call `statusChange`. When it returns `null`, they return `false` without a request.
- Web `pickStatus` and mobile `useChangeStatus` both prompt on `saved && promptsFinish(bookBefore, status)`. They still take the snapshot before saving.
- Both library screens use `possibleDuplicates`. Both group lists use `searchGroups` after their own type filter and sort.

The visible change: picking the status a book already has sends no request on web. Today web's status menu (`BookScreen.tsx:290`) still submits the option that is already checked; mobile's `StatusSheet.tsx:32` just closes.
