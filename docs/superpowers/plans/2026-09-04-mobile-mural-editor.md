# Mobile Mural Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-parity mural editing on touch devices (phones + tablets) — the real react-grid-layout canvas, made touch-usable via a width-scaled zoom/pan viewport and grip-bar dragging.

**Architecture:** All changes live in `MuralCanvas.tsx` (grows a `pointer: coarse` branch: pan viewport, explicit-width `GridLayout`, zoom controls, grip bars), one CSS block in `index.css` scoped under `.mural-touch`, and pure deletion of the `touchOnly` gate in `MuralEditorPage.tsx`. Desktop DOM/behavior is byte-identical to today. No backend changes; the mural `blocks` JSON shape never changes.

**Tech Stack:** React 19, react-grid-layout 1.5.x, Tailwind 4, oxlint, tsc.

**Spec:** `docs/superpowers/specs/2026-09-04-mobile-mural-editor-design.md`

## Global Constraints

- Frontend only. No backend file is touched.
- `GRID_COLUMNS = 12` and `ROW_HEIGHT = 28` unchanged; mural document (`blocks` JSON) unchanged.
- Desktop path renders exactly as today: no viewport wrapper, no zoom UI, no grip bar, hover-revealed `⋮` controls, whole-block drag.
- Every touch-only CSS rule is scoped under `.mural-touch` (the viewport) or `.mural-grip` — never global.
- Zoom implementation is width-scaling (explicit `width` prop to RGL), never CSS `transform: scale()`.
- `noUnusedLocals`/`noUnusedParameters` are ON — every declared binding must be used within the same task that declares it.
- After every task: `cd frontend && npm run typecheck && npm run lint` — both must pass.
- **TDD deviation (acknowledged):** the frontend has no unit-test harness (backend `npm test` covers two backend modules only). Each task's test cycle is typecheck + lint + the manual verification steps stated in the task. Do not claim done on a task whose manual steps you did not perform or defer explicitly.
- No comments in code unless a comment already exists at the edit site and the edit keeps it true.

## File Structure

- Modify `frontend/src/components/murals/MuralCanvas.tsx` — owns everything touch: detection, viewport measurement, zoom state + controls, grip bar, per-mode `draggableCancel`, body wrapper.
- Modify `frontend/src/index.css` — scoped `.mural-touch` / `.mural-grip` rules (resize handle size, touch-action, overscroll).
- Modify `frontend/src/pages/MuralEditorPage.tsx` — delete the `touchOnly` gate (state, banner, two `!touchOnly` guards).
- `frontend/src/pages/SharedMuralPage.tsx` — **not modified**: it renders `MuralCanvas` with `editMode={false}` and inherits the touch viewport/zoom automatically.

**Design refinement, called out:** the spec sketched zoom state lifted to `MuralEditorPage`; the plan keeps it inside `MuralCanvas` instead (nothing on the page needs it, and the public shared page gets pan/zoom for free with zero changes). Same observable behavior.

## Interfaces

- `MuralCanvas` existing props are unchanged; it gains no required props. Zoom is internal, uncontrolled state.
- New CSS hooks other code may rely on: `.mural-touch` (viewport), `.mural-grip` (drag strip), `.mural-block-body` (content wrapper, only in touch edit mode).
- `draggableCancel` value: touch mode `".mural-block-controls, .mural-tierlist-editor, .mural-block-body"`; desktop `".mural-block-controls, .mural-tierlist-editor"` (today's value).

---

### Task 1: Touch viewport — width-scaled canvas + zoom controls

**Files:**
- Modify: `frontend/src/components/murals/MuralCanvas.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Produces: internal `touchMode` detection, `zoom` state, `viewportWidth` measurement inside `MuralCanvas`; in touch mode the grid renders as `<GridLayout ... width={canvasWidth}>` (plain, non-WidthProvider component) inside an `overflow-x-auto` scroller with class `mural-touch`, with a `− / % / +` stepper below it (clamped [0.5, 3], 0.25 steps, double-tap `%` resets to 1).

- [ ] **Step 1: Add touch detection, zoom state, viewport measurement, and zoom helpers**

At the top of `MuralCanvas.tsx`, add to the existing react import (or add the line if absent):

```tsx
import { useEffect, useRef, useState } from "react";
```

Then inside `export function MuralCanvas(...) {`, directly above the existing `const layout = mural.blocks.map(...)`, add:

```tsx
  const [touchMode] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches)
  );
  const [zoom, setZoom] = useState(() => (typeof window !== "undefined" && window.innerWidth < 700 ? 1.5 : 1));
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const lastTapRef = useRef(0);

  useEffect(() => {
    if (!touchMode) return;
    const el = viewportRef.current;
    if (!el) return;
    function measure() {
      setViewportWidth(el.clientWidth);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [touchMode]);

  const canvasWidth = Math.round(viewportWidth * zoom);

  function setZoomBy(delta: number) {
    setZoom((z) => Math.min(3, Math.max(0.5, Math.round((z + delta) * 100) / 100)));
  }

  function handlePercentTap() {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setZoom(1);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }
```

- [ ] **Step 2: Render the touch branch (scroller + explicit-width GridLayout + zoom stepper)**

Replace the entire `return (...)` JSX (from `return (` through the closing `);` ending with `</ResponsiveGridLayout>`) with:

```tsx
  const gridProps = {
    layout,
    cols: GRID_COLUMNS,
    rowHeight: ROW_HEIGHT,
    isDraggable: editMode,
    isResizable: editMode,
    compactType: null as const,
    preventCollision: true,
    draggableCancel: touchMode
      ? ".mural-block-controls, .mural-tierlist-editor, .mural-block-body"
      : ".mural-block-controls, .mural-tierlist-editor",
    onDragStop: handleGestureEnd,
    onResizeStop: handleGestureEnd
  };

  const blockNodes = mural.blocks.map((block) => {
    const style = resolveBlockStyle(block.style);
    return (
      <div
        key={block.id}
        className={`group relative overflow-hidden ${style.cardShadow ? "shadow-sm" : ""} ${style.cardHoverEffect ? "transition-transform hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-lg" : ""}`}
        style={{
          borderRadius: `${style.cardRadius}px`,
          opacity: style.cardOpacity / 100,
          backgroundColor: style.backgroundColor ?? "var(--color-surface)",
          borderTopWidth: `${style.cardBorderSides.top ? style.cardBorderWidth : 0}px`,
          borderRightWidth: `${style.cardBorderSides.right ? style.cardBorderWidth : 0}px`,
          borderBottomWidth: `${style.cardBorderSides.bottom ? style.cardBorderWidth : 0}px`,
          borderLeftWidth: `${style.cardBorderSides.left ? style.cardBorderWidth : 0}px`,
          borderStyle: style.cardBorderWidth > 0 ? style.cardBorderStyle : "none",
          borderColor: resolveBorderColor(style.cardBorderColor, style.cardBorderOpacity),
          fontFamily: style.codeStyle ? blockFontFamilyCss("jetbrainsMono") : blockFontFamilyCss(style.fontFamily),
          fontSize: `${style.fontSize}px`,
          fontWeight: style.bold ? 700 : undefined,
          fontStyle: style.italic ? "italic" : undefined,
          color: style.textColor ?? undefined
        }}
      >
        <BlockRenderer block={block} books={books} images={images} editMode={editMode} onUpdateBlock={onUpdateBlock} statsOverride={statsOverride} />
        {editMode && (
          <div className="mural-block-controls absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <OptionsMenu
              title="Block settings"
              items={[
                { label: "Style", onClick: () => onStyleBlock?.(block) },
                { label: "Configure", onClick: () => onConfigureBlock?.(block) },
                { label: "Duplicate", onClick: () => onDuplicateBlock?.(block.id) },
                { label: "Delete", onClick: () => onDeleteBlock?.(block.id), danger: true }
              ]}
            />
          </div>
        )}
      </div>
    );
  });

  if (touchMode) {
    return (
      <div className="relative">
        <div ref={viewportRef} className="mural-touch overflow-x-auto">
          {viewportWidth > 0 && (
            <div style={{ width: canvasWidth }}>
              <GridLayout {...gridProps} width={canvasWidth}>
                {blockNodes}
              </GridLayout>
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1">
          <button
            onClick={() => setZoomBy(-0.25)}
            className="h-10 w-10 rounded-lg border border-(--color-border) bg-(--color-surface) text-lg font-semibold"
          >
            −
          </button>
          <button
            onClick={handlePercentTap}
            className="h-10 min-w-14 rounded-lg border border-(--color-border) bg-(--color-surface) px-2 text-sm font-semibold"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => setZoomBy(0.25)}
            className="h-10 w-10 rounded-lg border border-(--color-border) bg-(--color-surface) text-lg font-semibold"
          >
            +
          </button>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveGridLayout {...gridProps}>
      {blockNodes}
    </ResponsiveGridLayout>
  );
```

Note: the existing inline style-prop comments inside the block `<div>` (the long ones about font inheritance, borders, `.mural-block-controls`, etc.) are preserved verbatim in the real file — keep them attached to the same props/elements when moving this code; the excerpt above omits them for brevity only. **Do not actually delete them.**

- [ ] **Step 3: Add the viewport CSS**

Append to `frontend/src/index.css`:

```css
/* Mobile mural editor (spec: docs/superpowers/specs/2026-09-04-mobile-mural-editor-design.md).
   .mural-touch is the zoom/pan viewport that wraps the canvas on pointer:coarse
   devices; every touch-only override is scoped under it so desktop rendering
   is untouched. */
.mural-touch {
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.mural-touch .react-resizable-handle {
  width: 24px;
  height: 24px;
  touch-action: none;
}
.mural-grip {
  touch-action: none;
}
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run typecheck && npm run lint` — both pass.
Manual (Chrome DevTools device emulation, which reports `pointer: coarse`): open a mural — canvas is horizontally pannable; `+`/`−` step 25%, clamped at 50%/300%; double-tap `%` snaps back to 100% and the grid re-lays out instantly; phone-width emulation defaults to 150%, tablet-width to 100%. Desktop (no emulation): layout identical to before — no scroller wrapper, no zoom stepper.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/murals/MuralCanvas.tsx frontend/src/index.css
git commit -m "feat(frontend): width-scaled zoom/pan viewport with zoom controls for mural canvas on touch"
```

---

### Task 2: Grip bar — touch drag handle + always-visible block controls

**Files:**
- Modify: `frontend/src/components/murals/MuralCanvas.tsx`

**Interfaces:**
- Consumes: `.mural-block-body` in `draggableCancel` (Task 1's touch value).
- Produces: in touch edit mode, each block renders `.mural-grip` (drag strip, top edge) containing a `⠿` pill and the `OptionsMenu` (wrapped in `.mural-block-controls`); `BlockRenderer` output wrapped in `.mural-block-body`.

- [ ] **Step 1: Add the grip bar and body wrapper to the block node**

In `MuralCanvas.tsx`, inside `blockNodes`'s block `<div>`, make three changes:

(a) Wrap the `BlockRenderer` line — replace:

```tsx
        <BlockRenderer block={block} books={books} images={images} editMode={editMode} onUpdateBlock={onUpdateBlock} statsOverride={statsOverride} />
```

with:

```tsx
        {touchMode && editMode ? (
          <div className="mural-block-body h-full">
            <BlockRenderer block={block} books={books} images={images} editMode={editMode} onUpdateBlock={onUpdateBlock} statsOverride={statsOverride} />
          </div>
        ) : (
          <BlockRenderer block={block} books={books} images={images} editMode={editMode} onUpdateBlock={onUpdateBlock} statsOverride={statsOverride} />
        )}
```

(b) Make the desktop `⋮` controls touch-aware — replace:

```tsx
        {editMode && (
          <div className="mural-block-controls absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100">
```

with:

```tsx
        {editMode && !touchMode && (
          <div className="mural-block-controls absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100">
```

(c) Add the grip bar immediately after the block `<div>`'s opening tag (before the `BlockRenderer` section added in (a)):

```tsx
        {touchMode && editMode && (
          <div className="mural-grip absolute inset-x-0 top-0 z-10 flex items-center justify-between px-1.5 py-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(10,8,6,0.72)] text-sm text-white select-none">⠿</span>
            <span className="mural-block-controls">
              <OptionsMenu
                title="Block settings"
                items={[
                  { label: "Style", onClick: () => onStyleBlock?.(block) },
                  { label: "Configure", onClick: () => onConfigureBlock?.(block) },
                  { label: "Duplicate", onClick: () => onDuplicateBlock?.(block.id) },
                  { label: "Delete", onClick: () => onDeleteBlock?.(block.id), danger: true }
                ]}
              />
            </span>
          </div>
        )}
```

- [ ] **Step 2: Verify**

Run: `cd frontend && npm run typecheck && npm run lint` — both pass.
Manual (touch emulation): `editMode` can't be reached on touch yet (gate removed in Task 3) — temporarily flip `MuralCanvas`'s `touchMode` initializer to `true` in dev to test, then revert before committing. Verify: grip strip + `⠿`/`⋮` pills visible at top of every block; dragging from the strip moves the block (layout persists on drop via the existing `onDragStop` path); dragging from block *content* pans/scrolls instead of moving the block; `⋮` menu opens without starting a drag; `.mural-grip { touch-action: none }` from Task 1 applies to the strip.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/murals/MuralCanvas.tsx
git commit -m "feat(frontend): grip-bar block dragging with always-visible controls on touch"
```

---

### Task 3: Remove the touch gate in MuralEditorPage

**Files:**
- Modify: `frontend/src/pages/MuralEditorPage.tsx` (gate state ~lines 31-33; Edit-button guard ~167-176; banner ~180-184; empty-state guard ~190)

**Interfaces:**
- Consumes: nothing new — MuralCanvas self-detects touch.
- Produces: Edit button always rendered; empty-mural "Start building" always rendered when not editing; read-only banner gone.

- [ ] **Step 1: Delete the gate**

Three deletions in `MuralEditorPage.tsx`:

(a) The state:

```tsx
  const [touchOnly] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches)
  );
```

(b) The Edit button guard — replace:

```tsx
          {!touchOnly && (
            <button
              onClick={() => setEditMode((e) => !e)}
```

with:

```tsx
          <button
            onClick={() => setEditMode((e) => !e)}
```

and remove the matching `)}` that closed the `{!touchOnly && (...)}` expression after that button's closing `</button>`.

(c) The banner — delete:

```tsx
      {touchOnly && (
        <p className="mb-4 rounded-lg bg-(--color-accent-soft) px-3 py-2 text-sm text-(--color-accent)">
          Editing murals works best on a desktop — this is a read-only view.
        </p>
      )}
```

and the empty-state guard — replace:

```tsx
          {!editMode && !touchOnly && (
            <button onClick={() => setEditMode(true)} className="rounded-lg bg-(--color-accent) px-4 py-2 font-semibold text-white">
              Start building
            </button>
          )}
```

with:

```tsx
          {!editMode && (
            <button onClick={() => setEditMode(true)} className="rounded-lg bg-(--color-accent) px-4 py-2 font-semibold text-white">
              Start building
            </button>
          )}
```

- [ ] **Step 2: Verify**

Run: `cd frontend && npm run typecheck && npm run lint` — both pass.
Manual (touch emulation, no forced flags this time): mural editor shows the Edit button; tapping it reveals grip bars and `+ Add block`; "Start building" appears on an empty mural; Done editing returns to clean view. Desktop: unchanged.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/MuralEditorPage.tsx
git commit -m "feat(frontend): enable mural editing on touch devices"
```

---

### Task 4: Full verification matrix

**Files:** none modified.

- [ ] **Step 1: Automated gates**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build` — all pass (build catches anything the emulated checks miss).

- [ ] **Step 2: Manual matrix (phone over the repo's LAN setup — `npm run dev:mobile` — or DevTools emulation)**

Phone, edit mode: add each of the 10 block types; configure, style, duplicate, delete via `⋮`; grip-drag a block (page must not pan during the drag); resize via the enlarged corner handle; zoom −/+ /double-tap-reset; empty-mural "Start building".
Phone, view mode: pan, zoom, no editing affordances, `⋮` absent.
Tablet (768px+ emulation): defaults to 100%; same edit pass.
Desktop regression: no zoom UI, no grip bars, hover-revealed `⋮` intact, whole-block drag still works, tier-list tile drag still works.
Shared mural page on phone (`/murals/shared/:token`): renders inside the pan viewport, zoom controls work, nothing editable.

- [ ] **Step 3: Note deviations, if any**

Record anything that diverged from the spec in this plan file's bottom "Execution notes" section (create it) — no silent scope changes.

---

## Self-Review (already performed)

- Spec coverage: viewport/zoom (Task 1), gesture model incl. `draggableCancel` carve-outs and resize target (Tasks 1-2 + CSS), always-visible controls (Task 2), block types "work as-is" (verified: pickers/modals/AddBlockMenu are tap-based; tier list keeps its per-tile `⋮` menus — no code needed), gate removal + touch branch placement (Tasks 1, 3), verification matrix (Task 4). Backend: untouched, per spec.
- Known spec deviation, deliberate and stated in File Structure: zoom state lives in `MuralCanvas`, not `MuralEditorPage`.
- `noUnusedLocals` factored in: every binding introduced in Task 1 is used within Task 1 (zoom → `canvasWidth`, `setZoom` → helpers, stepper uses all three).
- Type consistency: `zoom`/`setZoom`/`touchMode`/`viewportWidth`/`canvasWidth` names used identically across tasks.
- Placeholder scan: none; every code step is complete. One intentional excerpt: Task 1 Step 2 omits the file's existing inline style-prop comments for readability — the instruction explicitly says to keep them.
