# Shared book deletion

From the 2026-10-24 architecture review (candidate C, the old #5). Deleting books from the library is written four times, and the undo exists only on web:

- `frontend/src/pages/LibraryPage.tsx:232-239` and `frontend/src/pages/GroupsPage.tsx:272-279`, each followed by a toast whose Undo calls `restoreDeletedBooks` (`frontend/src/lib/restoreDeletedBooks.ts`, untested).
- `mobile/src/features/library/hooks/useLibraryActions.ts:101-109` (`deleteBooks`, used by `LibraryScreen`) and `mobile/src/features/library/components/GroupDetail.tsx:111-115`, inline.

Every copy is the same transform: drop the books whose `bookKey` is in the set, and `removeBooksFromAllGroups`. None of them updates `book_count`, which `restoreDeletedBooks`, `mergeDuplicateBooks` and the library change helpers all set, so a delete leaves it stale until the next merge or import.

## Decision

`packages/shared/src/library/bookDeletion.ts` exports two pure functions, re-exported from the library index:

- `deleteBooks(data: LibraryData, keys: ReadonlySet<string>): LibraryData` — the transform above, plus `book_count: books.length`. Returns `data` unchanged (same object) when `keys` is empty.
- `restoreDeletedBooks(current: LibraryData, snapshot: LibraryData, keys: ReadonlySet<string>): LibraryData` — moved verbatim from `frontend/src/lib/restoreDeletedBooks.ts`, which is deleted.

Two functions rather than one returning `{ library, restore }`: the saver re-runs the updater on a 409 with fresh data (`librarySaver.ts` `putWhole`), so the snapshot a restore needs is the `data` of the last attempt. Callers already capture it inside the updater (`snapshot = data`), and keep doing so.

All four copies call `deleteBooks`. Web keeps its toast and Undo through the shared `restoreDeletedBooks`. Mobile keeps its Alert confirm and gets no undo.

Also in this lane: the mural stats block's figure is 1.6em on web (`frontend/src/components/murals/blocks/MiscBlocks.tsx:105`) and 1.45 on mobile (`mobile/src/features/murals/MuralCanvas.tsx:131`). Mobile changes to 1.6, the web value it copies.

## Not in scope

- Undo on mobile. It needs a toast with an action and a timer, and replaces the "can't be undone" confirm; a product change for later.
- `distinctBooks` pairs that name a deleted book. They never match a live book, and a book that comes back keeps its "not a duplicate" pairing.
- A reader-card signature or highlight that names a deleted book. It stays stored server-side and is skipped on render (`publicResolver.ts` `chosenOf`).
- Mural scrubbing. Murals are separate documents; each client keeps its own `scrubBooks` call and timing.
- Confirm and copy differences between the clients.
