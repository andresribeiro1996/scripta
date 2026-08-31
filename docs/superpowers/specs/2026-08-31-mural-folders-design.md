# Mural folders — file-tree organization for the Murals page

## Context

A mural is a freeform dashboard built from blocks (see
`frontend/src/lib/murals.ts`). The account's murals live as rows in the
backend `murals` module and are browsed on `MuralsListPage.tsx`
(`/dashboard/murals`) as a flat card grid with search/sort — no grouping
of any kind. As a personal library's mural count grows, a flat grid stops
scaling: the user wants to organize murals into **nested folders**,
browsed **file-tree fashion in a left panel**, the way a file manager
splits a folder tree (left) from the current folder's contents (right).

This is the first hierarchical organization in the app (Series/
Collections are flat lists of book keys inside the library document), and
the first change to the `murals` module's schema since murals moved off
the library blob.

## Decisions locked in with the user

- The tree organizes the **murals list** (folders of murals) — not a
  layers/outline panel of one mural's blocks, and not a nested
  content tree inside blocks.
- **Real nested folders**, arbitrarily deep — backend work, not a
  client-side-only grouping.
- **Split view on the Murals page** (Finder/VS Code style): folder tree
  in a left panel, the existing cover-card grid on the right showing the
  selected folder's murals, breadcrumb in between. The global dashboard
  sidebar is untouched.
- Moving murals and folders is a **"Move to…" menu picker only** — no
  drag-and-drop in the first pass.
- Data model: **adjacency list** — a `mural_folders` table plus a
  nullable `folder_id` on `murals`. (Rejected alternatives: a path string
  per mural, which makes rename an N-row rewrite and can't represent an
  empty folder; folder-as-mural, which poisons the mural type for every
  existing consumer.)
- Deleting a folder **splices, never cascades**: its direct child folders
  and its murals move up to the deleted folder's own parent. Deleting a
  folder never deletes a mural.
- New murals are created **inside the currently selected folder**.

## Backend design (`backend/src/modules/murals/`)

### Schema & migration

In `adapters/sqlite/schema.sql`, alongside the existing `murals` table:

- `mural_folders(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT
  NOT NULL, parent_id TEXT, created_at TEXT NOT NULL DEFAULT …, updated_at
  TEXT NOT NULL DEFAULT …)` + `idx_mural_folders_user_id`. No FK on
  `parent_id` — same "user_id is an opaque string, ownership enforced in
  the service" convention the module's schema comment already documents.
- `murals` gains `folder_id TEXT` (NULL = root).

Because `CREATE TABLE IF NOT EXISTS` is a no-op against an existing
`murals` table, the new column ships via the module's startup-migration
path (`runStartupMigrations.ts`): a `PRAGMA table_info` guard +
`ALTER TABLE murals ADD COLUMN folder_id TEXT`, idempotent by
construction. Existing murals default to NULL (root); no data moves.

### Domain & service

- `MuralFolder {id, name, parentId, createdAt, updatedAt}`; the `Mural`
  domain/row type gains `folderId: string | null`.
- Service operations (ownership misses return `undefined`/`false` → 404
  at the routes, same convention as every existing murals operation):
  - `listFolders(userId)` — the caller's folders, `created_at ASC`
    (insertion order is the tree's display order; no sorting UI in this
    pass).
  - `createFolder(userId, name, parentId?)` — validates the parent
    exists and is owned by `userId`, else 400 (a *bad reference*, not a
    miss).
  - `renameFolder(userId, id, name)`.
  - `moveFolder(userId, id, newParentId | null)` — rejects moving a
    folder into **itself or any of its descendants** (400), checked with
    an in-memory walk over the user's folders — personal scale, no
    recursive CTE needed.
  - `deleteFolder(userId, id)` — two UPDATEs: child folders with
    `parent_id = id` get `parent_id = deleted.parentId`; murals with
    `folder_id = id` get `folder_id = deleted.parentId`. No recursion —
    grandchildren were already pointing at their own parents.
  - `updateMural(…)` accepts `folderId: string | null` as a third
    updatable field; a non-null value must reference a folder the caller
    owns, else 400. `null` moves the mural to root.
  - `createMural(userId, name, folderId?)` — same ownership validation.

### Routes (all in the authenticated CRUD scope, existing rate-limit treatment)

| Route | Purpose |
|---|---|
| `GET /murals/folders` | `{folders: MuralFolder[]}` |
| `POST /murals/folders` | `{name, parentId?}` → `201` folder |
| `PUT /murals/folders/:id` | `{name? \| parentId?}` at least one; `parentId: null` = root → folder |
| `DELETE /murals/folders/:id` | `204`; children spliced up |
| `POST /murals` | existing, + optional `folderId` |
| `PUT /murals/:id` | existing, + `folderId: string \| null` |

`/murals/folders` vs `/murals/:id` never collide: `:id` is
UUID-validated and `shared/:token` already established the
literal-segment precedent. The public `GET /murals/shared/:token` route
is untouched — folders are private organization and never appear in the
redacted public shape.

## Frontend design

**New files:**

- `src/lib/muralFolders.ts` — pure helpers: `buildTree(folders)`,
  `folderPath(folders, id)` (breadcrumb segments),
  `isDescendant(folders, ancestorId, folderId)`. Pure-logic-in-`lib/`
  convention, same home as `lib/groups.ts`.
- `src/hooks/useMuralFolders.ts` — `["muralFolders"]` query +
  mutate-then-cache-set helpers (`create`, `rename`, `move`, `remove`),
  same shape as `useMurals.ts`. `remove` applies the splice semantics to
  the cache (children reparented, folder dropped) rather than refetching.
  `useMurals.ts` gains `move(id, folderId | null)` alongside `rename`.
- `src/components/murals/MuralFolderTree.tsx` — the left panel. A root
  row ("All murals") then folder rows with chevron/indent. Row hover
  reveals `+` (new subfolder) and the same ⚙ `OptionsMenu` component the
  mural cards use (Rename / Move to… / Delete). Rename is an inline
  input, same as mural-card rename. Expand/collapse is local `useState`
  with all folders expanded by default; no persistence.
- `src/components/murals/MoveToFolderModal.tsx` — the picker (modal
  pattern of `CoverPickerModal`): "Root" plus the folder tree as
  selectable indented rows; when moving a *folder*, itself and its
  descendants render disabled (the client-side mirror of the backend
  cycle guard).

**Changed files:**

- `src/api/murals.ts` — folder fetch/create/update/delete wrappers;
  `updateMuralApi` gains `folderId`; `createMuralApi` gains optional
  `folderId`.

- `src/pages/MuralsListPage.tsx` — becomes the two-pane layout:
  - Left: `MuralFolderTree`, fixed `w-56` (matches the dashboard
    sidebar's width so the two rails read as one system).
  - Right: the existing controls and cover-card grid, now filtered to
    `folderId === selectedFolderId` (null = root). `selectedFolderId` is
    local state.
  - Breadcrumb above the grid (`All murals / …`), each segment clickable.
  - Search goes **global across all folders** when non-empty (a filter
    that only searched the open folder would hide things for no reason);
    sort unchanged, applied to whatever set is showing.
  - The `+ New mural` tile creates inside the selected folder.
  - Folder delete gets a `ConfirmDialog` stating murals move up a level,
    nothing is deleted.
  - Below `md`: the tree hides; navigation collapses to the breadcrumb
    plus a flattened-path `<select>` (`"Parent / Child"` options) over
    the same `selectedFolderId` state.
- `MuralEditorPage.tsx` is untouched (its back-link stays `← Murals`);
  folders appear nowhere outside the Murals page in this pass.

## Known simplifications (worth stating explicitly, not hidden)

- No drag-and-drop — moves go through the picker only. Can be added
  later without schema changes.
- No folder sort/ordering controls — display order is insertion order;
  no rename-triggered re-sorting.
- Folder names are not uniqueness-checked, same as mural names are not —
  siblings may share a name; ids disambiguate.
- Expanded/collapsed tree state is per-mount, not persisted.
- Search results don't display each match's folder path in this pass
  (just the card); the breadcrumb only reflects the selected folder.
- No mural-count badges on folder rows (can be added trivially later
  from the murals cache).
- Folders never surface on the public share view, in share links, or on
  any other page.

## Verification

- Backend: `cd backend && npm run typecheck && npm test` — the murals
  folder suite follows `arena/service.test.ts`'s pattern (`node:test`
  against an in-memory repository fake): folder CRUD, ownership 404s,
  cycle rejection, delete-splice (children up one level, murals
  preserved), mural move/create `folderId` validation (unknown or
  foreign folder → 400), migration idempotency (run twice → no error,
  no data change). `npm test`'s file list extends to include the new
  murals test file.
- Frontend: `cd frontend && npm run typecheck && npm run lint`; then in
  the browser — create folders/nested subfolders, create murals inside
  the selected folder, move a mural and a folder via the picker
  (including the disabled-self/descendant rows), rename inline, delete a
  mid-level folder and confirm its contents spliced up without loss,
  search across folders, and walk the same flows at a mobile width via
  the collapsed breadcrumb + select.
