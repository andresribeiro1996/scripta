# Tier list editor: view mode, touch ranking, and pool UX

Covers items 1 and 2 of the enhancement list: make the tier list editor
look and feel professional, give it a read-only view mode matching the
mural tier list block, and make adding books to the pool friendly —
all optimized for mobile.

Out of scope, tracked separately: the "creating a tier list saves an
empty one" bug (item 4), Arena list-page search/filter/icons (items 5,
6), the sun-vs-gear icon (item 3), mural folders (7), mural block
visuals (8).

## Problem

`frontend/src/pages/TierListEditorPage.tsx` (417 lines) is always in
editing mode, and its editing affordances don't work on a phone:

- **Ranking is impossible on touch.** `DraggableTierTile`
  (`components/murals/blocks/BookBlocks.tsx`) uses native HTML5
  `draggable` + `dataTransfer`, which has no touch equivalent — its own
  comment says so. The documented fallback is a per-tile `⋮` menu that
  is `opacity-0 group-hover/tile:opacity-100`, and hover does not exist
  on touch, so on a phone the only ranking control is invisible.
- **No view mode.** Opening a list to look at it shows the full editing
  UI: label inputs, colour swatches, ▲/▼ buttons, Delete links.
- **The editor and the mural block have visibly drifted.**
  `TierEditorRow` (page) and `TierRow` (block) render the same thing —
  same `w-[3em]` colour chip, same `flex-1 flex-wrap` tile area, same
  `min-h-[4em]` empty state — as two independent copies.
- **Editing chrome looks unfinished:** ▲/▼ are Unicode glyphs, tier
  colour is a raw `<input type="color">`, delete is a red text link.
- **Adding books is cramped.** A small `+ Add books to pool` text link
  reveals an inline `BookSearchList` at the very bottom of a long
  scrolling page, one book per tap.
- **The pool is far from the tiers.** It renders after every tier, so on
  a phone you usually cannot see the destination tier and the pool at
  the same time — which is exactly what dragging requires.

## Decisions

- **View by default, explicit Edit/Done toggle.** Opening a tier list
  shows the clean read-only rendering. One `Edit` button reveals editing;
  `Done` returns. Same shape as the mural editor's own edit-mode toggle.
- **Mode is component state, not a route.** No URL change and no history
  entry, so edge-swipe-back keeps meaning "leave this tier list".
- **Adding books is a multi-select sheet.** Search plus a cover grid;
  tap to check several; one commit adds them all.
- **Ranking moves to `@dnd-kit`.** The app already runs it with a
  touch-friendly sensor config on the Library page; the tier list is the
  odd one out, not a new problem to solve.
- **Shared chrome, not a shared component.** The view row and the editor
  row keep separate bodies but compose one shell, so they cannot drift
  again.

## Architecture

### 1. Modes

`TierListEditorPage` gains `const [editing, setEditing] = useState(false)`.

- **View mode** — page header (back link, name, `Edit` button) and the
  tier stack rendered read-only. No pool, no per-row controls, nothing
  draggable.
- **Edit mode** — the same stack with row controls and draggable tiles,
  plus the pool dock (section 4). Header's `Edit` becomes `Done`.

Two integrations, both copying existing patterns verbatim:

- `useDismissible(() => setEditing(false), editing)` — Escape and the
  app-wide edge-swipe-back exit *editing* first and only leave the page
  on a second gesture. `useDismissible` is
  `frontend/src/hooks/useDismissible.ts`.
- Bottom nav hidden while editing, exactly as
  `pages/MuralEditorPage.tsx:89-93` does it:

```tsx
const { setNavHidden } = useOutletContext<{ setNavHidden: (hidden: boolean) => void }>();
useEffect(() => {
  setNavHidden(editing);
  return () => setNavHidden(false);
}, [editing, setNavHidden]);
```

### 2. Shared row chrome

Only the *chrome* moves, and it moves to a file that imports nothing
back from the blocks — otherwise this creates an import cycle.
`MiniBookTile` is defined in `BookBlocks.tsx:38` and is used by the
shelf and spotlight blocks as well, so it stays there; a new tier-list
file that imported it while `BookBlocks.tsx` imported the row back
would be circular.

New file `frontend/src/components/tierlist/TierRowShell.tsx`, exporting
one component and depending only on `TierDefinition`:

- `TierRowShell({ tier, colorControl, children })` — the row frame, the
  `w-[3em]` colour chip carrying `tier.label` and `tier.color`, and the
  "no books" empty state. `colorControl` is an optional node rendered
  inside the chip (edit mode passes the colour-picker trigger; view mode
  passes nothing). `children` is the tile area.

Everything else stays where it already lives, and the dependency graph
stays one-directional (`BookBlocks.tsx` → `TierRowShell`, page →
`TierRowShell`, page → `BookBlocks.tsx`):

- `TierRow` stays in `BookBlocks.tsx`, rewritten to compose
  `TierRowShell`, and is **exported** so the page's view mode renders
  the identical component the mural block does.
- `TierListBlockView` keeps its own block shell (`h-full`,
  `overflow-hidden`, `p-2.5`, title line, scrolling stack) — that shell
  is mural-block-specific and a full page does not want it.
- `TierEditorRow` stays in `TierListEditorPage.tsx`, composing
  `TierRowShell` rather than repeating its markup.

Tolerance for dangling book keys is preserved: rows walk
`tier.bookKeys` and skip keys with no matching book, as today.

### 3. Ranking with `@dnd-kit`

Mirrors `pages/LibraryPage.tsx:71` and `components/BookCard.tsx:219`.

- One `DndContext` wraps the edit-mode tier stack and the pool dock.
- Sensors: `useSensor(PointerSensor, { activationConstraint: { delay: 150, tolerance: 5 } })` plus `KeyboardSensor`, the same pair and the
  same constants LibraryPage uses — long-press to drag on touch,
  immediate on mouse.
- Each tile is a `useDraggable` with the book key as its id. Each tier
  row and the pool dock are `useDroppable`. Each tile is *also* a drop
  target, as today.
- `onDragEnd` maps `over.id` to the existing `MoveDestination` shape and
  calls the existing `moveBook(key, destination)`. That function, and
  its `locate`/`replaceAt` helpers, are reused unchanged.
- **Swap-on-tile-drop must not regress.** Dropping a book directly onto
  another tile swaps the two; dropping on a row's background appends.
  This was a deliberate fix (see the comment on `DraggableTierTile`) for
  a reported bug where the dragged book slid sideways instead of trading
  places.
- The `⋮` fallback menu stays, but becomes always-visible on coarse
  pointers instead of hover-only. Detect with the same
  `window.matchMedia("(pointer: coarse)")` check `MuralCanvas.tsx:94`
  already uses for its `touchMode`.

`DraggableTierTile` stays in `BookBlocks.tsx` where it is today (it
needs `MiniBookTile` from that file), rewritten from HTML5 drag to
`useDraggable`.

### 4. Pool dock

In edit mode the pool renders as a sticky bottom dock instead of a
block at the end of the page:

- Fixed to the bottom above `env(safe-area-inset-bottom)`, occupying the
  space freed by the hidden bottom nav.
- A header row: `Pool — N books`, a collapse toggle, and an
  `Add books` button.
- Body: pool tiles in a single horizontally scrolling strip
  (`overflow-x-auto`, `overscroll-contain`), so height stays fixed
  regardless of pool size.
- Collapsed state keeps the header bar only, and is remembered for the
  session (component state, not persisted).
- The whole dock is a drop target: dragging a ranked book onto it
  returns the book to the pool.

The tier stack gets bottom padding equal to the dock's height so the
last tier is never hidden behind it.

View mode renders no dock at all.

### 5. Add-books sheet

New file `components/tierlist/AddBooksSheet.tsx`, built on the shared `Sheet`
(`components/Sheet.tsx`, already dismiss-stack aware, so Escape and
edge-swipe close it).

- Receives the library's books already filtered to exclude anything
  currently in the pool or on a tier — the same exclusion the page
  computes today.
- Renders its own cover grid — a `MiniBookTile` per book with a
  selected-state ring and checkmark — not `BookSearchList`.
  `BookSearchList` is a text list of `Title — Author` rows, and a tier
  list is an entirely cover-driven UI where recognising a book by its
  cover is the whole point. `pickers.tsx`'s own comment sets the
  precedent: when the surrounding chrome differs, a small separate copy
  beats threading extra props through a shared picker. The search filter
  is the same three-line title/author match `BookSearchList` uses.
- Selection is a `Set<string>` of book keys held by the sheet.
- Footer button reads `Add N books`, disabled at zero, and commits every
  selected key to the pool in one `saveData` call.
- Cancelling discards the selection and adds nothing.

`BookSearchList` is left untouched by this work.

### 6. Tier control polish

- ▲/▼ Unicode glyphs become SVG chevron icon buttons on 44px targets.
  `components/Toolbar.tsx` has no chevron yet — add `ChevronUpIcon` /
  `ChevronDownIcon` there, drawn on the same 24×24 viewBox centred on
  (12,12) as every other icon in that file, per its own comment about
  never using Unicode glyphs.
- The red `Delete` text link moves into a `⋮` `OptionsMenu` on the row,
  as `danger: true`. Move up/down stay as direct buttons — frequent
  actions — while delete is rare and destructive.
- The raw `<input type="color">` becomes a swatch button in the chip
  that opens a preset palette: the backend's seeded ladder colours
  (`backend/src/modules/tierlists/service.ts:47-51`) — `#c9482f`,
  `#d98a3d`, `#c9a53d`, `#5c9e5c`, `#4a7fc9` — plus a "Custom…" entry
  falling back to a native colour input.
- The tier label input is restyled as a proper field rather than a bare
  bordered input, keeping its current commit-on-blur / Enter / Escape
  behaviour.

### 7. Unchanged

The save model. Every edit still commits immediately through
`saveData(tierlistId, next)`; there is no draft or dirty state. The
"creating a tier list immediately saves an empty one" complaint is about
*creation* on the Arena list page and is a separate piece of work.

## Testing

`frontend/` has no test runner (no vitest/jest, no `test` script), so
verification is:

- `npm run typecheck` and `npm run lint` from `frontend/`.
- On-device via `npm run dev:mobile`, which is the only way to judge the
  parts that matter here: long-press drag actually picking a tile up,
  the dock and a target tier being visible simultaneously, the `⋮`
  fallback being visible without hover, and the add-books sheet on a
  real keyboard-overlapping viewport.

Specific on-device checks:

1. Open a tier list — it renders read-only, no controls, matching the
   mural block's look.
2. `Edit` reveals controls and the dock; the bottom tab bar disappears.
3. Long-press a pool tile and drag it onto a tier — it ranks.
4. Drop a tile directly onto another tile — the two swap, they do not
   shift.
5. Drag a ranked book onto the dock — it returns to the pool.
6. The `⋮` menu is visible without hovering, and still moves a book.
7. `Add books` opens the sheet; select several; one commit adds them all.
8. Escape / edge-swipe once exits edit mode; again leaves the page.
