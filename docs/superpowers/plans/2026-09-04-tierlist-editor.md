# Tier List Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the tier list editor a read-only view mode matching the mural block, ranking that actually works on touch, and a friendly multi-select way to add books to the pool.

**Architecture:** One page with a view/edit toggle. View mode renders the same `TierRow` the mural block uses; edit mode composes a shared `TierRowShell` with editing affordances, ranks books via `@dnd-kit` (the config the Library page already uses), and docks the pool at the bottom of the screen.

**Tech Stack:** React 19, TypeScript, Tailwind v4, react-router-dom v7, `@dnd-kit/core` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-09-04-tierlist-editor-design.md`

## Global Constraints

- `frontend/` has **no test runner** (no vitest/jest, no `test` script). Verification for every task is `npm run typecheck` and `npm run lint` (oxlint) from `frontend/`, plus the on-device pass in the final task. **Do not add a test framework.**
- `tsconfig.app.json` sets `noUnusedLocals` and `noUnusedParameters` — a leftover unused import fails typecheck. Remove imports you orphan.
- `verbatimModuleSyntax: true` — type-only imports must use `import type { X }`, not `import { type X }`.
- Match each touched file's existing comment density. This codebase documents *why* heavily (see `hooks/useScrollLock.ts`, `components/Sheet.tsx`); terse one-liners are out of place in it.
- Icons are always SVGs drawn on a 24×24 viewBox centred on (12,12), never Unicode glyphs — `components/Toolbar.tsx:66-69` states this rule explicitly.
- **Do not regress swap-on-tile-drop.** Dropping a book onto another tile swaps the two; dropping on a row background appends. This was a deliberate bug fix (see the comment on `DraggableTierTile`).
- The save model is unchanged: every edit commits immediately via `saveData(tierlistId, next)`. Do not introduce draft/dirty state.
- Seeded tier ladder colours, for the preset palette: `#c9482f` (S), `#d98a3d` (A), `#c9a53d` (B), `#5c9e5c` (C), `#4a7fc9` (D) — from `backend/src/modules/tierlists/service.ts:47-51`.

---

### Task 1: Extract `TierRowShell`, refactor and export `TierRow`

Pure refactor — no visual or behavioural change. Establishes the shared chrome the editor row composes in later tasks.

**Files:**
- Create: `frontend/src/components/tierlist/TierRowShell.tsx`
- Modify: `frontend/src/components/murals/blocks/BookBlocks.tsx` (the `TierRow` function, around lines 186-215)

**Interfaces:**
- Produces: `TierRowShell({ tier, colorControl, children }: { tier: TierDefinition; colorControl?: ReactNode; children: ReactNode })` — row frame, colour chip, empty state.
- Produces: `TierRow` becomes an **exported** function from `BookBlocks.tsx` (it is currently module-private), consumed by Task 2.

- [ ] **Step 1: Create the shell**

`frontend/src/components/tierlist/TierRowShell.tsx`:

```tsx
import type { ReactNode } from "react";
import type { TierDefinition } from "../../api/tierlists";

/** The chrome every tier row shares: the outer frame, the coloured label
 *  chip, and the "nothing here yet" state. Extracted because the mural
 *  block's read-only row (BookBlocks.tsx's TierRow) and the editor's own
 *  row (TierListEditorPage.tsx's TierEditorRow) had drifted into two
 *  independent copies of the same markup — same `w-[3em]` chip, same
 *  wrapping tile area, same `min-h-[4em]` empty state — which is why the
 *  editor stopped looking like the block it is supposed to preview.
 *
 *  Only the chrome is shared, not the row itself: the two need different
 *  *contents* (static tiles vs draggable ones, and an extra colour
 *  control in the chip), and bending one component to cover both would
 *  mean a pile of optional render props. `children` is the tile area;
 *  `colorControl` is an optional node the editor drops into the chip.
 *
 *  Lives here rather than in BookBlocks.tsx to keep the dependency graph
 *  one-directional: BookBlocks.tsx owns MiniBookTile, so a shared file
 *  that imported from it while it imported the row back would be a
 *  cycle. This file depends on nothing but the tier type. */
export function TierRowShell({
  tier,
  colorControl,
  children
}: {
  tier: TierDefinition;
  colorControl?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-stretch gap-2 overflow-hidden rounded-lg border border-(--color-border)">
      <div
        className="flex w-[3em] shrink-0 flex-col items-center justify-center gap-1 overflow-hidden p-1 text-center text-[0.9em] leading-tight font-bold break-words text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]"
        style={{ backgroundColor: tier.color }}
      >
        <span className="line-clamp-3">{tier.label || "—"}</span>
        {colorControl}
      </div>
      {children}
    </div>
  );
}

/** The tile area's own two states, shared for the same reason as the
 *  shell above — an empty tier reads identically in the block and in the
 *  editor, only the wording differs. */
export function TierRowEmpty({ message }: { message: string }) {
  return <div className="flex min-h-[4em] flex-1 items-center px-2 text-[0.75em] text-(--color-text-dim)">{message}</div>;
}

export function TierRowTiles({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-wrap content-start gap-1.5 p-1.5">{children}</div>;
}
```

- [ ] **Step 2: Refactor `TierRow` in `BookBlocks.tsx` to use it and export it**

Replace the whole `TierRow` function (currently `function TierRow({ tier, books }...)`, around line 186) with:

```tsx
export function TierRow({ tier, books }: { tier: TierDefinition; books: Array<Record<string, unknown>> }) {
  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));
  // Walking `tier.bookKeys` directly (not filtering to resolved books
  // first) so each tile still knows its own real bookKey string — a
  // dangling reference (book deleted some other way) is silently
  // skipped, same tolerant convention resolveShelfBooks already uses for
  // a shelf.
  const resolvedKeys = tier.bookKeys.filter((k) => byKey.has(k));
  return (
    <TierRowShell tier={tier}>
      {resolvedKeys.length === 0 ? (
        <TierRowEmpty message="No books on this tier." />
      ) : (
        <TierRowTiles>
          {resolvedKeys.map((key) => (
            <div key={key} className="h-[6em] w-[4em] shrink-0 overflow-hidden">
              <MiniBookTile book={byKey.get(key)!} showTitle={false} showAuthor={false} />
            </div>
          ))}
        </TierRowTiles>
      )}
    </TierRowShell>
  );
}
```

Keep the existing doc comment above `TierRow` — it explains why the tiles hide title/author. Add the import at the top of `BookBlocks.tsx`:

```tsx
import { TierRowEmpty, TierRowShell, TierRowTiles } from "../../tierlist/TierRowShell";
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings (13 pre-existing warnings in untouched files are expected).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/tierlist/TierRowShell.tsx frontend/src/components/murals/blocks/BookBlocks.tsx
git commit -m "refactor(frontend): share tier row chrome between block and editor"
```

---

### Task 2: View mode and the Edit/Done toggle

**Files:**
- Modify: `frontend/src/pages/TierListEditorPage.tsx` (imports, `TierListEditorPage` body, the returned JSX)

**Interfaces:**
- Consumes: `TierRow` from `../components/murals/blocks/BookBlocks` (Task 1), `useDismissible` from `../hooks/useDismissible`.

- [ ] **Step 1: Add mode state and the two integrations**

In `TierListEditorPage`, alongside the existing `useState` calls, add:

```tsx
  const [editing, setEditing] = useState(false);
```

Add these imports at the top of the file:

```tsx
import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { TierRow } from "../components/murals/blocks/BookBlocks";
import { useDismissible } from "../hooks/useDismissible";
```

(`useState` and `Link`/`useParams` are already imported — extend those lines rather than duplicating them.)

Then, immediately after the `editing` state declaration, add:

```tsx
  // Escape and the app-wide edge-swipe-back (components/EdgeSwipeBack.tsx)
  // exit editing first and only leave the page on a second gesture —
  // registering here rather than making the mode a route keeps the
  // browser's own history meaning "which tier list", not "which mode".
  useDismissible(() => setEditing(false), editing);

  // The bottom tab bar covers the pool dock and costs 3.5rem of a phone's
  // height while ranking, which is the whole activity in edit mode. Same
  // trade MuralEditorPage.tsx:89-93 already makes for its canvas.
  const { setNavHidden } = useOutletContext<{ setNavHidden: (hidden: boolean) => void }>();
  useEffect(() => {
    setNavHidden(editing);
    return () => setNavHidden(false);
  }, [editing, setNavHidden]);
```

**Important:** these hooks must be called before the `if (isLoading)` and `if (!tierlist)` early returns, or the hook order changes between renders. Move them above those guards.

- [ ] **Step 2: Add the Edit/Done button to the header**

In the `<header className="mb-6">` block, wrap the existing name element and add the button beside it. Replace the header's closing structure so the name and the button sit on one row:

```tsx
      <header className="mb-6">
        <Link to="/dashboard/arena?tab=tierlists" className="text-xs text-(--color-text-dim) hover:text-(--color-text)">
          ← Arena
        </Link>
        <div className="flex items-center justify-between gap-3">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void handleRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              aria-label="Tier list name"
              className="block min-w-0 flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-2 py-1 text-lg font-bold"
            />
          ) : (
            <button
              onClick={() => {
                setNameDraft(tierlist.name);
                setEditingName(true);
              }}
              title="Rename this tier list"
              className="block min-w-0 flex-1 truncate text-left text-lg font-bold transition-colors hover:text-(--color-accent)"
            >
              {tierlist.name}
            </button>
          )}
          <button
            onClick={() => setEditing((e) => !e)}
            className={`min-h-9 shrink-0 rounded-lg px-3 text-sm font-semibold ${
              editing
                ? "bg-(--color-accent) text-white"
                : "border border-(--color-border) bg-(--color-surface) hover:bg-(--color-surface-hover)"
            }`}
          >
            {editing ? "Done" : "Edit"}
          </button>
        </div>
      </header>
```

- [ ] **Step 3: Render view mode when not editing**

Replace the `<div className="flex flex-col gap-2">` body so the whole editing UI is gated. The view branch renders `TierRow` — the identical component the mural block uses:

```tsx
      {!editing ? (
        <div className="flex flex-col gap-2">
          {data.tiers.length === 0 ? (
            <p className="text-sm text-(--color-text-dim)">No tiers yet — tap Edit to add one.</p>
          ) : (
            data.tiers.map((tier) => <TierRow key={tier.id} tier={tier} books={books} />)
          )}
          {resolvedPool.length > 0 && (
            <p className="mt-1 text-xs text-(--color-text-dim)">
              {resolvedPool.length} {resolvedPool.length === 1 ? "book" : "books"} still unranked — tap Edit to place them.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* ...the existing editing JSX, unchanged for now: tier rows,
              + Add tier, the pool box, + Add books to pool... */}
        </div>
      )}
```

Keep the entire existing editing JSX exactly as it is inside the `editing` branch — later tasks rework it. Only the wrapping changes here.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors. (If it reports an unused `searchOpen`/`dragOverTarget`, you moved too much — those are still used by the editing branch.)

- [ ] **Step 5: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/TierListEditorPage.tsx
git commit -m "feat(frontend): tier list opens in a read-only view mode"
```

---

### Task 3: Chevron icons and tier row control polish

**Files:**
- Modify: `frontend/src/components/Toolbar.tsx` (add two icons)
- Modify: `frontend/src/pages/TierListEditorPage.tsx` (`TierEditorRow`'s control row)

**Interfaces:**
- Produces: `ChevronUpIcon()` and `ChevronDownIcon()` exported from `components/Toolbar.tsx`.

- [ ] **Step 1: Add the icons**

Append to `frontend/src/components/Toolbar.tsx`, following the existing icon style in that file (same viewBox, same stroke attributes):

```tsx
/** Chevrons — move a row up or down in an ordered stack. */
export function ChevronUpIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 15 12 9 18 15" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
```

- [ ] **Step 2: Rebuild `TierEditorRow`'s control row**

In `TierListEditorPage.tsx`, replace the control row — the `<div className="flex items-center gap-2">` containing the label input, the two `▲`/`▼` buttons and the red `Delete` button (currently lines ~48-88) — with:

```tsx
      <div className="flex items-center gap-1.5">
        <input
          defaultValue={tier.label}
          onBlur={(e) => {
            const label = e.target.value;
            if (label !== tier.label) onRename(label);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = tier.label;
              e.currentTarget.blur();
            }
          }}
          placeholder="Label"
          aria-label="Tier label"
          className="min-h-9 min-w-0 flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-2.5 text-sm font-semibold"
        />
        {/* Up/down stay as direct buttons — reordering tiers is the
            frequent action. Delete goes behind the ⋮ menu: rare, and
            destructive enough that a mis-tap on a 44px target next to
            two other 44px targets is a real risk. Same consolidation
            OptionsMenu already does for mural blocks and list cards. */}
        <button
          disabled={isFirst}
          onClick={onMoveUp}
          aria-label="Move tier up"
          title="Move tier up"
          className={`${toolbarIconClass()} disabled:opacity-30`}
        >
          <ChevronUpIcon />
        </button>
        <button
          disabled={isLast}
          onClick={onMoveDown}
          aria-label="Move tier down"
          title="Move tier down"
          className={`${toolbarIconClass()} disabled:opacity-30`}
        >
          <ChevronDownIcon />
        </button>
        <OptionsMenu
          title="Tier settings"
          triggerClassName={toolbarIconClass()}
          items={[{ label: "Delete tier", onClick: onDelete, danger: true }]}
        />
      </div>
```

Add to the file's imports:

```tsx
import { ChevronDownIcon, ChevronUpIcon, toolbarIconClass } from "../components/Toolbar";
import { OptionsMenu } from "../components/OptionsMenu";
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Toolbar.tsx frontend/src/pages/TierListEditorPage.tsx
git commit -m "feat(frontend): proper icon buttons for tier row controls"
```

---

### Task 4: Tier colour preset palette

Replaces the raw `<input type="color">` swatch in the chip with a small palette sheet.

**Files:**
- Create: `frontend/src/components/tierlist/TierColorPicker.tsx`
- Modify: `frontend/src/pages/TierListEditorPage.tsx` (`TierEditorRow` passes it as `colorControl`)

**Interfaces:**
- Consumes: `TierRowShell`'s `colorControl` prop (Task 1), `Sheet` from `components/Sheet`.
- Produces: `TierColorPicker({ color, onChange }: { color: string; onChange: (color: string) => void })`.

- [ ] **Step 1: Create the picker**

`frontend/src/components/tierlist/TierColorPicker.tsx`:

```tsx
import { useState } from "react";
import { Sheet } from "../Sheet";

/** The ladder colours the backend seeds a new tier list with
 *  (backend/src/modules/tierlists/service.ts) — offered as presets so a
 *  tier a user adds by hand lands in the same palette as the S/A/B/C/D
 *  rungs it sits beside, instead of whatever the OS colour picker
 *  happened to open on. */
const PRESETS = [
  { label: "S", color: "#c9482f" },
  { label: "A", color: "#d98a3d" },
  { label: "B", color: "#c9a53d" },
  { label: "C", color: "#5c9e5c" },
  { label: "D", color: "#4a7fc9" },
  { label: "Grey", color: "#8a8580" }
];

/** The swatch inside a tier's colour chip. Opens a sheet of presets
 *  rather than the OS colour picker directly: on a phone the native
 *  picker is a full-screen modal with a colour wheel, which is a heavy
 *  detour for what is almost always "make this one red like an S rung".
 *  The custom option is still there for anyone who wants the wheel. */
export function TierColorPicker({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Tier color"
        aria-label="Tier color"
        className="h-3 w-6 shrink-0 rounded-sm ring-1 ring-white/70"
        style={{ backgroundColor: color }}
      />
      {open && (
        <Sheet title="Tier color" onClose={() => setOpen(false)}>
          <div className="flex flex-wrap gap-2 p-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.color}
                onClick={() => {
                  onChange(preset.color);
                  setOpen(false);
                }}
                aria-label={preset.label}
                title={preset.label}
                className={`h-11 w-11 rounded-lg ring-2 ${preset.color === color ? "ring-(--color-accent)" : "ring-transparent"}`}
                style={{ backgroundColor: preset.color }}
              />
            ))}
            <label className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-(--color-border) text-[10px] font-semibold text-(--color-text-dim)">
              Custom
              <input
                type="color"
                defaultValue={color}
                onChange={(e) => {
                  onChange(e.target.value);
                  setOpen(false);
                }}
                className="sr-only"
              />
            </label>
          </div>
        </Sheet>
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire it into the editor row**

In `TierListEditorPage.tsx`'s `TierEditorRow`, the row currently renders its own chip markup. Replace that markup with `TierRowShell`, passing the picker:

```tsx
      <TierRowShell tier={tier} colorControl={<TierColorPicker color={tier.color} onChange={onRecolor} />}>
        {resolvedKeys.length === 0 ? (
          <TierRowEmpty message="Drag a book here from the pool." />
        ) : (
          <TierRowTiles>
            {/* the existing DraggableTierTile map, unchanged */}
          </TierRowTiles>
        )}
      </TierRowShell>
```

The old `<div {...dropZoneProps} className="flex shrink-0 items-stretch gap-2 ...">` wrapper and its inner chip `<div>` both go away — `TierRowShell` renders that frame now. `dropZoneProps` moves onto `TierRowShell`'s wrapper in Task 5; until then, spread it on a plain wrapping `<div>` around `TierRowShell` so drag-and-drop keeps working.

Add imports:

```tsx
import { TierRowEmpty, TierRowShell, TierRowTiles } from "../components/tierlist/TierRowShell";
import { TierColorPicker } from "../components/tierlist/TierColorPicker";
```

Remove the now-unused `isDragOver` border styling from the row if it moved — but keep the `isDragOver` prop itself, Task 5 uses it.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/tierlist/TierColorPicker.tsx frontend/src/pages/TierListEditorPage.tsx
git commit -m "feat(frontend): tier colors from a preset palette sheet"
```

---

### Task 5: Rank books with `@dnd-kit`

The core fix: ranking currently cannot be done at all on a touch device.

**Files:**
- Modify: `frontend/src/components/murals/blocks/BookBlocks.tsx` (`DraggableTierTile`)
- Modify: `frontend/src/pages/TierListEditorPage.tsx` (`DndContext`, drop targets, `onDragEnd`)

**Interfaces:**
- Consumes: `moveBook(key, destination)` and its `MoveDestination` type — both already in `TierListEditorPage.tsx`, reused unchanged.
- Produces: `DraggableTierTile` keeps its exported name and its `book`/`bookKeyStr`/`menuItems` props; `isDragOver`/`dropProps` are replaced by internal `useDraggable`/`useDroppable`.

- [ ] **Step 1: Convert `DraggableTierTile` to `@dnd-kit`**

Replace the component body in `BookBlocks.tsx`. Keep its existing doc comment but update the paragraph that describes HTML5 drag — it currently says native drag "has no real touch equivalent", which is exactly what this change fixes.

```tsx
export function DraggableTierTile({
  book,
  bookKeyStr,
  menuItems
}: {
  book: Record<string, unknown>;
  bookKeyStr: string;
  menuItems: OptionsMenuItem[];
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: bookKeyStr });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: bookKeyStr });
  const setRefs = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };
  // Coarse pointers get the ⋮ menu permanently. It used to be
  // hover-only, and hover does not exist on touch — so on a phone the
  // one control that could rank a book without dragging was invisible.
  const coarse = typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
  return (
    <div
      ref={setRefs}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined}
      title="Drag to a tier, or use the ⋮ menu"
      className={`group/tile relative h-[6em] w-[4em] shrink-0 cursor-grab touch-none overflow-hidden rounded-lg active:cursor-grabbing ${
        isOver && !isDragging ? "ring-2 ring-(--color-accent)" : ""
      } ${isDragging ? "opacity-50" : ""}`}
    >
      <MiniBookTile book={book} showTitle={false} showAuthor={false} />
      <div className={`absolute top-0.5 right-0.5 transition-opacity ${coarse ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100"}`}>
        <OptionsMenu
          items={menuItems}
          title="Move this book"
          triggerClassName="flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(10,8,6,0.72)] text-white backdrop-blur-xs"
        />
      </div>
    </div>
  );
}
```

`touch-none` is required: without it the browser scrolls the page instead of letting the sensor start a drag.

Add to `BookBlocks.tsx` imports:

```tsx
import { useDraggable, useDroppable } from "@dnd-kit/core";
```

- [ ] **Step 2: Make tier rows and the pool drop targets**

In `TierListEditorPage.tsx`, add a small droppable wrapper component near `TierEditorRow`:

```tsx
/** A tier row or the pool as a drop target. `id` is what onDragEnd reads
 *  back: the literal string "pool", or a tier's id. */
function DropZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`rounded-lg transition-colors ${isOver ? "bg-(--color-accent-soft)" : ""}`}>
      {children}
    </div>
  );
}
```

Wrap each `TierRowShell` in `<DropZone id={tier.id}>` and the pool container in `<DropZone id="pool">`. Delete `dropZoneProps`, `tileDropProps`, `dragOverTarget`, `dragOverTileKey` and their `useState` calls — `@dnd-kit` owns that state now.

- [ ] **Step 3: Add the `DndContext` and `onDragEnd`**

In `TierListEditorPage`, add the sensors — the same pair and the same constants `LibraryPage.tsx:70-73` uses, so touch requires a 150ms long-press before a drag starts and a plain tap still opens the ⋮ menu:

```tsx
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const key = String(e.active.id);
    const overId = String(e.over.id);
    if (overId === key) return;
    // Dropping onto another TILE swaps the two (beforeKey); dropping onto
    // a row or the pool background appends. The swap is deliberate — see
    // DraggableTierTile's comment; an earlier version re-inserted instead,
    // which slid every book between the two spots over by one.
    const overIsTile = data.pool.includes(overId) || data.tiers.some((t) => t.bookKeys.includes(overId));
    if (overIsTile) {
      const dest = locate(overId);
      if (!dest) return;
      moveBook(key, dest.type === "pool" ? { type: "pool", beforeKey: overId } : { type: "tier", tierId: dest.tierId, beforeKey: overId });
      return;
    }
    moveBook(key, overId === "pool" ? { type: "pool" } : { type: "tier", tierId: overId });
  }
```

Wrap the whole editing branch's content in:

```tsx
<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
  {/* tier rows, add tier, pool */}
</DndContext>
```

Add imports:

```tsx
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors. Any error about `isDragOver`/`dropProps` means a `DraggableTierTile` call site still passes the removed props — remove them at both call sites (tier tiles and pool tiles).

- [ ] **Step 5: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/murals/blocks/BookBlocks.tsx frontend/src/pages/TierListEditorPage.tsx
git commit -m "feat(frontend): rank tier list books by touch drag via dnd-kit"
```

---

### Task 6: Multi-select add-books sheet

**Files:**
- Create: `frontend/src/components/tierlist/AddBooksSheet.tsx`
- Modify: `frontend/src/pages/TierListEditorPage.tsx` (replace the inline `BookSearchList`)

**Interfaces:**
- Produces: `AddBooksSheet({ books, onAdd, onClose }: { books: Array<Record<string, unknown>>; onAdd: (keys: string[]) => void; onClose: () => void })`.
- Consumes: `addBooksToPool(keys: string[])` — a new bulk version of the page's existing single-book `addBookToPool`.

- [ ] **Step 1: Create the sheet**

`frontend/src/components/tierlist/AddBooksSheet.tsx`:

```tsx
import { useMemo, useState } from "react";
import { MiniBookTile } from "../murals/blocks/BookBlocks";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useDismissible } from "../../hooks/useDismissible";
import { bookKey } from "../../lib/merge";

/** Picks several books into a tier list's pool in one trip.
 *
 *  A cover grid rather than pickers.tsx's BookSearchList (a text list of
 *  "Title — Author" rows): a tier list is an entirely cover-driven UI,
 *  and the book you are looking for is one you recognise by its spine,
 *  not by reading a list. Same reasoning pickers.tsx already gives for
 *  keeping its gallery grid separate instead of threading layout props
 *  through one shared picker.
 *
 *  Multi-select with an explicit commit, not add-on-tap: the whole
 *  complaint this replaces was that seeding a pool meant one round trip
 *  per book. Selecting ten and committing once is the point, and it also
 *  leaves room to undo a mis-tap before anything is saved. */
export function AddBooksSheet({
  books,
  onAdd,
  onClose
}: {
  books: Array<Record<string, unknown>>;
  onAdd: (keys: string[]) => void;
  onClose: () => void;
}) {
  useScrollLock();
  useDismissible(onClose);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) => String(b.Title ?? "").toLowerCase().includes(q) || String(b.Attribution ?? "").toLowerCase().includes(q)
    );
  }, [books, search]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-(--color-border) bg-(--color-surface) shadow-lg sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add books to the pool"
      >
        <div className="shrink-0 border-b border-(--color-border) p-3">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your library…"
            aria-label="Search your library"
            className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-(--color-text-dim)">No books match.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {filtered.map((book, i) => {
                const key = bookKey(book);
                const isSelected = selected.has(key);
                return (
                  <button
                    key={String(book.ContentID ?? i)}
                    onClick={() => toggle(key)}
                    aria-pressed={isSelected}
                    className={`relative h-[6.5em] overflow-hidden rounded-lg ring-2 transition-shadow ${
                      isSelected ? "ring-(--color-accent)" : "ring-transparent"
                    }`}
                  >
                    <MiniBookTile book={book} showTitle={false} showAuthor={false} />
                    {isSelected && (
                      <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-(--color-accent) text-white">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-(--color-border) p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <button onClick={onClose} className="min-h-11 rounded-lg px-3 text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Cancel
          </button>
          <button
            onClick={() => {
              onAdd([...selected]);
              onClose();
            }}
            disabled={selected.size === 0}
            className="min-h-11 rounded-lg bg-(--color-accent) px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add {selected.size > 0 ? selected.size : ""} {selected.size === 1 ? "book" : "books"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the page**

In `TierListEditorPage.tsx`, add a bulk add alongside the existing `addBookToPool`:

```tsx
  function addBooksToPool(keys: string[]) {
    const taken = new Set([...data.pool, ...data.tiers.flatMap((t) => t.bookKeys)]);
    const fresh = keys.filter((k) => !taken.has(k));
    if (fresh.length === 0) return;
    commit({ ...data, pool: [...data.pool, ...fresh] });
  }
```

Delete the now-unused single-book `addBookToPool` and the inline `BookSearchList` block inside the pool container, along with the `searchOpen` conditional around it. Replace the `+ Add books to pool` button's `onClick` with `() => setAddingBooks(true)`, rename the `searchOpen` state to `addingBooks`, and render the sheet:

```tsx
      {addingBooks && (
        <AddBooksSheet
          books={books.filter((b) => {
            const key = bookKey(b);
            return !data.pool.includes(key) && !data.tiers.some((t) => t.bookKeys.includes(key));
          })}
          onAdd={addBooksToPool}
          onClose={() => setAddingBooks(false)}
        />
      )}
```

Remove the `BookSearchList` import if nothing else in the file uses it (`noUnusedLocals` will fail otherwise).

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/tierlist/AddBooksSheet.tsx frontend/src/pages/TierListEditorPage.tsx
git commit -m "feat(frontend): add books to a tier list pool in one multi-select trip"
```

---

### Task 7: Pool as a sticky bottom dock

**Files:**
- Modify: `frontend/src/pages/TierListEditorPage.tsx` (pool rendering in the editing branch)

**Interfaces:**
- Consumes: `DropZone` (Task 5), `AddBooksSheet` (Task 6).

- [ ] **Step 1: Replace the pool block with a dock**

Remove the existing pool container and the standalone `+ Add books to pool` button from the editing branch's flow, and render this as the last child of the `DndContext` instead:

```tsx
        {/* Pinned to the bottom rather than sitting after the last tier.
            Ranking means dragging pool → tier, which needs both on screen
            at once; as a page-flow block at the end of a long list of
            tiers, the pool was almost never visible at the same time as
            the tier being aimed at. The bottom nav is hidden in edit mode
            (see setNavHidden above), so this occupies space that is
            otherwise unused. */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-(--color-border) bg-(--color-surface) pb-[env(safe-area-inset-bottom,0px)]">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <button
              onClick={() => setPoolCollapsed((c) => !c)}
              aria-expanded={!poolCollapsed}
              className="flex min-h-9 items-center gap-1.5 text-xs font-semibold text-(--color-text-dim) hover:text-(--color-text)"
            >
              {poolCollapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
              Pool — {resolvedPool.length} {resolvedPool.length === 1 ? "book" : "books"}
            </button>
            <button
              onClick={() => setAddingBooks(true)}
              className="min-h-9 shrink-0 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-sm font-semibold hover:bg-(--color-surface-hover)"
            >
              Add books
            </button>
          </div>
          {!poolCollapsed && (
            <DropZone id="pool">
              <div className="flex min-h-[7em] items-start gap-1.5 overflow-x-auto overscroll-contain px-3 pb-3">
                {resolvedPool.length === 0 ? (
                  <p className="py-4 text-xs text-(--color-text-dim)">
                    Pool is empty — every book is ranked. Drag one back here to unrank it.
                  </p>
                ) : (
                  resolvedPool.map((key) => (
                    <DraggableTierTile
                      key={key}
                      book={byKey.get(key)!}
                      bookKeyStr={key}
                      menuItems={data.tiers.map((t) => ({
                        label: `Move to ${t.label || "Untitled tier"}`,
                        onClick: () => moveBook(key, { type: "tier", tierId: t.id })
                      }))}
                    />
                  ))
                )}
              </div>
            </DropZone>
          )}
        </div>
```

Add the state beside the other `useState` calls:

```tsx
  const [poolCollapsed, setPoolCollapsed] = useState(false);
```

- [ ] **Step 2: Keep the last tier clear of the dock**

Add bottom padding to the editing branch's tier stack so the dock never covers the final row. On the `<div className="flex flex-col gap-2">` that holds the tier rows in the editing branch:

```tsx
<div className="flex flex-col gap-2 pb-[13rem]">
```

`13rem` covers the dock's header row plus a `7em` tile strip plus the safe-area inset, with margin. When collapsed the extra space is harmless.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TierListEditorPage.tsx
git commit -m "feat(frontend): dock the tier list pool to the bottom while editing"
```

---

### Task 8: Verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: 0 type errors; only the 13 pre-existing lint warnings, none in files this branch touched.

- [ ] **Step 2: Confirm the mural block did not regress**

`TierRow` and `DraggableTierTile` are shared with the mural tier list block. Open a mural containing a tierlist block and confirm it renders exactly as before — same chip, same tiles, same empty state.

- [ ] **Step 3: On-device pass**

Serve to a phone (`npm run dev:mobile` in `frontend/`, backend running per its README) and verify:

1. Opening a tier list shows the read-only view — no label inputs, no chevrons, no colour swatches, no pool.
2. `Edit` reveals controls and the dock; the bottom tab bar disappears. `Done` restores both.
3. Long-press a pool tile and drag it onto a tier — it ranks. A short tap does not start a drag.
4. Drop a tile directly onto another tile — the two **swap**; they do not shift by one.
5. Drag a ranked book down onto the dock — it returns to the pool.
6. The ⋮ menu on a tile is visible without hovering, and still moves a book.
7. `Add books` opens the sheet; select several; one commit adds them all to the pool.
8. Collapsing the dock leaves only its header bar; the last tier is never hidden behind it.
9. Edge-swipe (or Escape) once exits edit mode; a second one leaves the page.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(frontend): tier list editor on-device fixes"
```

(Skip if step 3 needed no changes.)
