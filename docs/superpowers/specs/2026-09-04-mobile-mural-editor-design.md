# Mobile mural editor — full-parity touch editing

## Context

Murals are freeform dashboards: a 12-column snap-to-grid canvas
(`react-grid-layout`) of typed blocks, arranged in the browser editor at
`pages/MuralEditorPage.tsx` / `components/murals/MuralCanvas.tsx`. On
touch devices the feature is deliberately read-only today: a
`pointer: coarse` check (`MuralEditorPage.tsx`) hides the Edit button
and shows a "read-only view" banner, because the desktop editing
interaction model assumes a mouse — hover-revealed block controls,
HTML5 drag-and-drop for tier-list ranking, and drag/resize sized for
pixel-precise pointers.

The user wants **full-parity mural editing on phones and tablets**:
everything the desktop editor can do (add/configure/style/duplicate/
delete/reorder/resize all 10 block types, tier-list ranking), from a
touch device, editing the same mural document — the backend's opaque
`blocks` JSON never changes shape.

## Decisions locked in with the user

- **Full parity editing** — not just quick tweaks; phone/tablet can
  author and arrange murals completely.
- **Phones + tablets** get one shared touch design; no separate
  tablet-specific editor.
- **Paradigm: true canvas (WYSIWYG)** — touch devices edit the real
  grid, not a reflowed list. Exact placement is a first-class mobile
  capability. (Chosen over a stacked-list editor and over reflowing
  view+edit.)
- Zoom/pan via **width-scaling**, not CSS transforms (see below).
- Tier-list ranking on touch ships via the existing per-tile ⋮ menus;
  touch drag-and-drop for tier tiles is a later add, not v1.

## Design (frontend only — no backend changes)

### Zoom/pan viewport

CSS `transform: scale()` breaks react-grid-layout: pointer coordinates
stop matching layout coordinates. Instead, **zoom by width**: the
canvas renders inside a pan viewport (`overflow: auto`,
`overscroll-behavior: contain`, `touch-action: pan-x pan-y`) and zoom
sets the inner container's width to `N ×` viewport width. RGL's
`WidthProvider` then lays out at real, unscaled pixels — drag/resize
math is untouched; native browser scroll does the panning.

- Floating zoom controls (`−` / live `%` / `+`), bottom corner of the
  canvas, thumb-reachable; double-tap the percentage to reset to
  fit-width (100%).
- Pinch gesture is a stretch goal, layered on later as another writer
  of the same width value — buttons are deterministic and don't fight
  RGL's gesture handling.
- Defaults: fit-width on tablets, ~150% on phones; zoom is editor
  state only (not persisted) in v1.
- Zoom controls and viewport apply to **edit and view mode on touch**
  — view mode is today's read-only render, just inside the pannable
  viewport. Desktop renders exactly as today (no viewport wrapper, no
  zoom UI).

### Touch gesture model

Blocks cover most of the canvas, so block-drag and viewport-pan cannot
share a one-finger gesture. Resolution:

- **Edit mode**: each block renders a compact **grip bar** at its top
  edge containing the existing ⋮ block menu (Style / Configure /
  Duplicate / Delete) — always visible on touch, replacing the
  hover-revealed cluster. Dragging from the grip bar moves the block;
  `draggableCancel` (already used for `.mural-block-controls` and
  `.mural-tierlist-editor`) carves the grip out of RGL's default
  whole-item drag surface. Everything outside grip bars pans.
- `touch-action: none` on the grip bar and the resize handle only —
  the browser must not interpret those touches as scrolls; the rest of
  the viewport keeps `pan-x pan-y`.
- **Resize handle**: existing SE corner handle, enlarged to a ~24px
  touch target.
- **View mode**: no handles, one-finger pan everywhere, no RGL
  drag/resize — same as today's read-only render.

### Block types on touch

- **Tier list**: HTML5 DnD has no touch equivalent; the per-tile ⋮ menu
  ("Move to S/A/B…", "Return to pool") is the touch ranking path —
  already built. Long-press tile dragging is a possible later add.
- **Shelf/spotlight/quote/image pickers**: click/tap-based scroll lists
  (`pickers.tsx`) — work as-is.
- **Config/style modals**: already `max-h-[85vh]` + `overflow-y-auto` —
  work as-is.
- **AddBlockMenu**: click-based dropdown — works as-is.

### Page integration

- Delete the `touchOnly` gate in `MuralEditorPage.tsx`: Edit button
  always shown; read-only banner and the `!touchOnly` guard on
  "Start building" removed.
- `editMode` stays opt-in per visit (default off) — you explicitly
  enter editing on touch, same as desktop.
- `MuralCanvas` grows a touch-mode branch (its own `pointer: coarse`
  check): viewport wrapper + zoom state (lifted to
  `MuralEditorPage`), grip bar rendering in edit mode, enlarged resize
  target. Desktop path renders exactly as today.

## Known simplifications (stated, not hidden)

- No pinch-zoom in v1 (buttons only) — deliberate: deterministic
  gesture ownership while RGL owns drags.
- No edge auto-scroll while dragging: a drag stops at the viewport
  edge; you pan, then continue the drag. Same limitation the desktop
  editor has today.
- Tier-list ranking on touch is menu-taps, not drag — functional
  parity, worse ergonomics than desktop drag; acceptable v1.
- Zoom level isn't remembered across visits.
- A tablet in landscape at 100% may still want zoom for precise
  placement — the controls exist everywhere on touch, so this is a
  default, not a limitation.

## Verification

- `cd frontend && npm run typecheck && npm run lint` (backend
  untouched).
- Manual matrix over the repo's existing LAN/HTTPS phone-testing setup:
  - Phone, edit mode: add each block type, configure, style,
    duplicate, delete; drag via grip bar (pan untouched during drag);
    resize via enlarged handle; zoom in/out/reset; empty-mural
    "Start building" flow.
  - Phone, view mode: pan/zoom, no editing affordances.
  - Tablet: same pass, defaults to fit-width.
  - Desktop regression: no zoom UI, no grip bars, hover-revealed
    controls intact, tier-list drag still works.
  - Tier-list ranking on touch via ⋮ menus persists correctly
    (same-block save path as desktop).

## Amendment (2026-09-04, later session): proportional zoom

The shipped width-only zoom scales the grid's width while `rowHeight`
(28px) and block fonts (authored px) stay fixed — blocks stretch wide
while their content stays small. Superseded sizing semantics, on touch
only:

- `scale = canvasWidth / 1200` (1200 = reference desktop canvas).
- `rowHeight = max(1, round(28 × scale))` in the touch branch; block
  inline `fontSize = style.fontSize × scale`. Rows, text, and em-based
  content scale together — a coherent miniature.
- Block view components are swept for rem-based sizing (`h-24 w-16`
  tier tiles etc.) and converted to em so they track the scaled font.
- Phone default zoom rises to 200% (≈⅔ desktop scale); range stays
  50–300%. Desktop is untouched (scale 1, rowHeight 28, authored px).

The viewport/gesture model (width-scaled container, grip bars,
stepper) is unchanged — only what zoom does to geometry.
