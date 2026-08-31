# Phase 2 — Reorder Parity (Touch + Keyboard) & Murals Touch Guard Implementation Plan

**Goal:** Replace the Library grid's HTML5 drag-to-reorder with `@dnd-kit` (pointer sensor with long-press activation, keyboard sensor, drop-target highlight) so reordering works with mouse, finger, and keyboard — with identical block semantics — and make mural editing view-only on touch devices with an "edit on desktop" hint.

**Architecture:** `lib/libraryOrder.ts`'s `reorderOnDrop(draggedKey, targetKey)` stays the single order authority — it is already key-based and unit-tested (16 checks in `scripts/test-library-order.mts`); only the *event source* changes. dnd-kit hooks live inside `BookCard` (activated only when a new `reorderable` prop is set, which only `LibraryPage` passes); `LibraryPage` owns the `DndContext`, sensors, and the existing optimistic-save + View-Transition settle. Mural touch-guard is a small conditional in `MuralEditorPage.tsx` (`editMode` can never turn on when the pointer is coarse → `MuralCanvas` already renders read-only when `editMode={false}`).

**Tech Stack:** React 19 + Vite + TS, Tailwind v4, NEW dependency `@dnd-kit/core` (decision D-C, confirmed; ~11 kB gz).

**Spec:** `docs/superpowers/plans/2026-08-31-ux-enhancements-roadmap.md` (Phase 2; decisions D-C and D-D confirmed). Findings addressed: M6 (library part + murals part), D10 (drop feedback via highlight + existing settle animation).

## Global Constraints

- `npm run typecheck` and `npm run lint` (from `frontend/`) after every task; both must pass with no new warnings.
- `npm run build` must pass after Task 1 (new dependency import).
- No comments in code. Existing comments that describe REMOVED behavior get deleted along with the code they describe; all other existing comments stay untouched.
- `scripts/test-library-order.mts` must pass UNMODIFIED — `reorderOnDrop` semantics are not changing.
- Manual verification at 390×844 (touch emulation), 1440×900 (mouse + keyboard) after every task.
- Known trade accepted by this plan (do not "fix"): drop feedback is a target highlight + the existing View-Transitions settle animation, NOT a live insertion gap — a gap preview would misrepresent series-block moves (only the dragged card would shift, not its whole series).

---

### Task 1: dnd-kit reorder on the Library grid

**Files:**
- Modify: `frontend/package.json` (via npm install)
- Modify: `frontend/src/components/BookCard.tsx`
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `frontend/README.md` (drag-mechanism sentences only)
- Test: existing `frontend/scripts/test-library-order.mts` (unmodified, must stay green)

**Interfaces:**
- Consumes: `reorderOnDrop(books, groups, draggedKey, targetKey)` from `lib/libraryOrder.ts` (unchanged); `updateWithViewTransition` already in `LibraryPage.tsx` (unchanged).
- Produces: `BookCard` prop change — `draggable`/`onReorder` are REMOVED, replaced by `reorderable?: boolean`. No other call site passes the old props (verified: `LibraryPage.tsx:427-428` is the only wiring; Series/Collections/style-preview never passed them).

- [ ] **Step 1: Install the dependency**

From `frontend/`:

```bash
npm install @dnd-kit/core
```

Record the installed version from `package.json`.

- [ ] **Step 2: Edit `BookCard.tsx` — swap HTML5 DnD for dnd-kit hooks**

Read the file first. Changes:

a) Add imports at the top:

```tsx
import { CSS, useDraggable, useDroppable } from "@dnd-kit/core";
```

b) In the props type and destructure: remove `draggable = false` and `onReorder` (the prop and its doc comment describing the old dataTransfer callback — the whole comment goes since the callback is gone); add `reorderable = false` in the same spot. Nothing else about the props signature changes.

c) Delete the `const [dragOver, setDragOver] = useState(false);` line.

d) After the existing state lines (next to `hasCover`), add:

```tsx
const key = bookKey(book);
const dragEnabled = reorderable && !selectable;
const { attributes, listeners, setNodeRef: setDragNodeRef, transform, isDragging } = useDraggable({ id: key, disabled: !dragEnabled });
const { setNodeRef: setDropNodeRef, isOver } = useDroppable({ id: key, disabled: !reorderable });
const dropTarget = isOver && !isDragging;
const setRefs = (el: HTMLDivElement | null) => {
  setDragNodeRef(el);
  setDropNodeRef(el);
};
```

e) On the root div: delete the entire `draggable={...}`, `onDragStart={...}`, `onDragOver={...}`, `onDragLeave={...}`, `onDrop={...}` props (the five conditional blocks and their stale comment). Add, as the FIRST props on the element:

```tsx
ref={setRefs}
{...(dragEnabled ? { ...attributes, ...listeners } : {})}
```

f) In the root `style` object: replace the `outline:` line with:

```tsx
outline: selected ? "3px solid var(--color-accent)" : dropTarget ? "2px solid var(--color-accent)" : undefined,
```

and add after `viewTransitionName`:

```tsx
transform: isDragging ? CSS.Translate.toString(transform) : undefined,
zIndex: isDragging ? 10 : undefined,
```

g) In the root `className` template: add two conditional segments:

```tsx
${dragEnabled ? "select-none" : ""} ${isDragging ? "touch-none opacity-60" : ""}
```

(append them inside the existing template literal; keep every existing class).

h) The `viewTransitionName` const above the return changes from `draggable ? ... : undefined` to:

```tsx
const viewTransitionName = reorderable ? `book-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined;
```

(`key` from step d; if the old line computed `bookKey(book)` inline, replace that usage too.)

- [ ] **Step 3: Edit `LibraryPage.tsx` — DndContext, sensors, key-based handler**

a) Add import:

```tsx
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
```

b) Inside `LibraryPage()`, near the existing `useRef(fileInputRef)`, add:

```tsx
const suppressClickAfterDragRef = useRef(false);
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  useSensor(KeyboardSensor)
);
```

c) Change `handleReorder`'s signature from `(draggedKey: string, targetBook: Record<string, unknown>)` to `(draggedKey: string, targetKey: string)` and delete its `const targetKey = bookKey(targetBook);` line. Everything else in the function (no-op guard, `reorderOnDrop`, optimistic cache write via `updateWithViewTransition`, background save, rollback) stays exactly as is.

d) Add below it:

```tsx
function handleDragEnd(e: DragEndEvent) {
  if (e.over && String(e.over.id) !== String(e.active.id)) {
    handleReorder(String(e.active.id), String(e.over.id));
  }
  if (e.activatorEvent instanceof KeyboardEvent) suppressClickAfterDragRef.current = true;
}
```

(The suppress flag exists because a keyboard drag ends with the same Space keyup that fires the card's click — without this, dropping via keyboard would immediately open the detail sheet. Mouse drags suppress their own click via dnd-kit's pointer capture, so only keyboard activations set the flag.)

e) In the `BookCard` render: replace `draggable={!selectionMode}` and `onReorder={handleReorder}` with:

```tsx
reorderable={!selectionMode}
```

and wrap the click so a just-suppressed click is eaten and the flag reset:

```tsx
onClick={() => {
  if (suppressClickAfterDragRef.current) {
    suppressClickAfterDragRef.current = false;
    return;
  }
  setDetailBookKey(bookKey(book));
}}
```

f) Wrap the grid: change `{books.length > 0 && displayBooks.length > 0 && (<BookGrid style={style}>…</BookGrid>)}` to:

```tsx
{books.length > 0 && displayBooks.length > 0 && (
  <DndContext
    sensors={sensors}
    collisionDetection={closestCenter}
    onDragEnd={handleDragEnd}
    onDragCancel={() => {
      suppressClickAfterDragRef.current = true;
    }}
  >
    <BookGrid style={style}>
      …existing children unchanged…
    </BookGrid>
  </DndContext>
)}
```

(`onDragCancel` fires on Escape mid-drag — always a keyboard gesture, so always set the flag.)

- [ ] **Step 4: Verify mechanically**

From `frontend/`:

```bash
npm run typecheck
npm run lint
npm run build
npx tsx scripts/test-library-order.mts
npx tsx scripts/test-library-view.mts
```

All must pass; lint with no new warnings; test-library-order unchanged and green.

- [ ] **Step 5: Verify manually**

Desktop 1440×900, real browser, backend running with a library containing at least one series:
1. Click a card (no hold) → detail sheet opens (activation delay did not eat clicks).
2. Press-and-hold 150ms, then drag a standalone book onto another → whole-drag visual (dim + translate), target highlights 2px accent, drop → cards settle with the existing View-Transition animation; reload → order persisted.
3. Drag any book of a series onto a standalone book → the WHOLE series moves as a block, still `SeriesNumber`-ordered.
4. Drop a series book onto another book of the same series → nothing happens (no-op path).
5. Keyboard: Tab to a card (it now carries `role="button"` from dnd-kit attributes), Space to lift, arrow keys to move, Space to drop → reorder commits and the detail sheet does NOT open; Escape mid-drag cancels cleanly.
6. Kill the backend, drag a card → optimistic move visibly rolls back (console error expected; user-facing toast is Phase 3).
7. Enter select mode → cards no longer draggable (cursor/drag dead), click toggles selection as before.

Touch emulation at 390×844 (devtools, touch on): tap opens sheet; press-hold ~150ms then move → drag follows finger, page does not scroll mid-drag; release → order commits.

- [ ] **Step 6: Update `frontend/README.md` drag mechanism**

In the "Library grid order" section, the `reorderOnDrop()`/drag description references HTML5 drag-and-drop mechanics. Update only the mechanism sentences: reordering is driven by `@dnd-kit` (pointer press-hold 150ms — so touch works — plus Space/arrows keyboard dragging), while `reorderOnDrop()` semantics (unit moves, series-as-block, no-op within a unit) are unchanged. Leave the rest of the section intact.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/BookCard.tsx frontend/src/pages/LibraryPage.tsx frontend/README.md
git commit -m "feat(frontend): dnd-kit reorder with touch and keyboard support"
```

### Task 2: Murals view-only on touch devices

**Files:**
- Modify: `frontend/src/pages/MuralEditorPage.tsx`
- Modify: `frontend/README.md` (murals section, one sentence)

**Interfaces:** none (page-internal conditional; `MuralCanvas` already renders read-only when `editMode={false}`).

- [ ] **Step 1: Add the coarse-pointer guard**

In `MuralEditorPage()`, after the `mural` lookup, add:

```tsx
const [touchOnly] = useState(
  () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches)
);
```

(Computed once — a pointer type doesn't change mid-session for our purposes.)

- [ ] **Step 2: Gate the edit affordances**

a) The header's Edit/Done button (`{editMode ? "Done editing" : "Edit"}`): wrap it in `{!touchOnly && (…)}` so it doesn't render on touch. The `Share` button stays.

b) The empty-state "Start building" button (visible when `!editMode`): change its condition to `{!editMode && !touchOnly && (…)}`.

c) After the `</header>` close, add:

```tsx
{touchOnly && (
  <p className="mb-4 rounded-lg bg-(--color-accent-soft) px-3 py-2 text-sm text-(--color-accent)">
    Editing murals works best on a desktop — this is a read-only view.
  </p>
)}
```

`editMode` can now never become true on touch, so `AddBlockMenu` (rendered only when `editMode`) and the canvas drag/resize handles (`isDraggable={editMode}` / `isResizable={editMode}` in `MuralCanvas`) are inert automatically. Rename (inline input) and Share keep working.

- [ ] **Step 3: Verify**

From `frontend/`: `npm run typecheck && npm run lint` — pass, no new warnings.

Manual — touch emulation at 390×844 on `/dashboard/murals/:id`: chip visible, no Edit button, blocks not draggable/resizable, rename and Share still work. Desktop 1440×900: Edit toggle and building flow work exactly as before; no chip.

- [ ] **Step 4: README sentence**

In `frontend/README.md`'s murals section (search for `MuralEditorPage` / "View/Edit"), add one sentence: mural editing is desktop-only for now — on touch devices the editor renders the mural read-only with an "edit on desktop" hint (decision D-D in the UX roadmap).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/MuralEditorPage.tsx frontend/README.md
git commit -m "feat(frontend): murals view-only on touch devices with edit-on-desktop hint"
```

---

## Phase 2 exit criteria

- Reordering works with mouse, touch (long-press), and keyboard (Tab/Space/arrows/Escape); series still move as whole blocks; same-unit drops still no-op; rollback still works; `scripts/test-library-order.mts` passes unmodified.
- Plain clicks/taps still open the detail sheet; a keyboard drag-drop does not.
- On touch: murals render view-only with the hint chip; on desktop mural editing is unchanged.
- `typecheck`, `lint`, `build`, and all existing suites pass.

## Self-review

- Coverage vs. Phase 2 spec: dnd-kit adoption → Task 1 (D-C); keyboard sensors → Task 1 Steps 2b/3b; touch activation → Task 1 Steps 3b + g (`touch-none` while dragging); murals guard → Task 2 (D-D). D10's insertion-gap idea is consciously traded down to highlight + settle (documented in Global Constraints).
- Placeholder scan: every step carries exact code or an exact before→after rule; README edits are scoped to named sentences with the new wording given.
- Type consistency: `reorderable` used in BookCard's props, hooks, and viewTransitionName; `handleReorder(draggedKey: string, targetKey: string)` matches `reorderOnDrop`'s existing parameter order; `DragEndEvent`/`DragCancelEvent` handler shapes match @dnd-kit/core's API.
- Risk noted for implementers: dnd-kit spreads `attributes` that include `tabIndex`/`role="button"` onto cards — this is desired (keyboard access) and lands fully in Phase 4's a11y pass.
