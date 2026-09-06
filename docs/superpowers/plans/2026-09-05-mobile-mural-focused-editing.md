# Mobile mural: overview and focused editing

Status: proposed implementation plan; application changes have not started.

## Objective

Make mobile mural authoring practical while preserving arbitrary placement on the existing 12-column grid. Users must be able to compose intentional gaps, align blocks and place related blocks together. A single-column sequence is not the mural's source of truth.

This is the alternative to `2026-09-05-mural-sequence-model-design.md`. It replaces the mobile interaction approach in the September 4 plan if adopted. It does not claim the sequence proposal has already been reverted or implemented.

The deliberate compromise: the overview preserves composition, while a focused view makes individual blocks readable. A wide composition cannot show every paragraph at comfortable reading size simultaneously on a narrow phone.

## Scope and constraints

- Keep `layout: { x, y, w, h }`, block identities, content and styles. No sequence migration, second persisted layout, or new backend API.
- Preserve the existing snap-to-grid and no-overlap rules. This project currently supports free placement within a grid, not overlapping or rotated objects.
- Reuse `MuralCanvas`, `BlockRenderer`, the configuration/style panels, `useMurals`, and existing layout helpers.
- No new library unless a concrete blocker makes existing code insufficient. Do not replace react-grid-layout as part of this work.
- Mobile placement uses explicit selection and tap controls. Desktop drag/resize continues to work.
- Shared pages preserve the composition and support readable block inspection.
- Optional whole-mural Read view, pinch gestures, multitouch editing, rotation, layering, grouping and an infinite canvas are deferred.
- Follow the current AGENTS.md and frontend README when implementing. No new code comments unless requested.

## Start by reconciling the baseline

The reviewed local checkout still implements a default phone zoom of 300%; the linked September 5 spec describes that zoom as removed. Before coding, inspect the current branch, relevant history and stored block schema. Do not assume this checkout is the eventual implementation baseline.

If sequence rendering has since landed, establish which fields and operations changed before applying this plan. Preserve all content and existing coordinates. Do not silently manufacture a freeform arrangement from sequence data or remove trial fields.

Capture screenshots and saved coordinates for three fixtures: a simple mural, a dense mural with small blocks, and a tall mural with deliberate gaps. Include long text, an image, a shelf and a tier list. Record current desktop behavior for regression comparison.

## Interaction contract

### Overview and reading

- Open at fit-width, with ordinary vertical page scrolling. Do not open with horizontal panning required.
- Show the actual composition, including intentional whitespace. No automatic reflow to a stack.
- In View mode, tap a block to open a readable detail sheet. Close restores scroll position and focus to that block.
- In Edit mode, tap selects a block and reveals a bottom action bar: Read, Configure, Style, Move, Resize and More. Wrap or use the existing menu for secondary actions; do not squeeze everything into one row.
- Only the selected block receives selection chrome. Remove always-present mobile grip bars and tiny resize handles.
- Add a compact block picker reachable from the editor toolbar for blocks too small to tap reliably. It selects by block ID and brings the block into view; it does not author sequence order.
- A scroll gesture must never select or place a block. Preserve underlying links/actions in the detail sheet rather than making them compete with overview selection.

### Move

1. Select a block and tap Move.
2. Keep its original location visible as a faint placeholder; render a clearly labeled draft at the proposed destination.
3. Tap anywhere on the canvas to place the draft's top-left corner at the nearest grid origin. Explain this anchor briefly in placement mode.
4. Large Left, Right, Up and Down buttons adjust the draft by one grid cell. These controls remain normal screen size at every zoom.
5. Apply commits one layout update. Cancel restores the original appearance with no write.

Tapping an occupied location produces an invalid preview and a text explanation. Disable Apply while invalid. Do not silently move neighbors, shrink the block, or search for a different drop location. Clamp destination coordinates at the left/top/right boundaries while preserving block dimensions. Allow the canvas to extend downward as the draft moves.

Nudges that would cross a boundary or collide are disabled or rejected with feedback. Keep tap previews and nudge behavior consistent and deterministic.

### Resize

- Select Resize to start a local draft anchored at the block's existing top-left corner.
- Separate Width and Height controls, each with decrement/increment buttons and the current value. One increment is one grid unit.
- Preserve current validated minimum sizes and canvas bounds. Reject overlaps without moving other blocks.
- Show a live draft and require Apply or Cancel. Content clipping is visible in the preview; do not silently rewrite typography or content to make it fit.
- Treat source image proportions according to the existing block renderer. Do not introduce a new cropping policy or fixed aspect-ratio constraint during this work.

### Add and duplicate

- Choosing a block type creates an unsaved local candidate using existing default construction logic.
- Suggest the first valid position in the visible grid rows, scanning top-to-bottom then left-to-right. If none fits, propose the first valid row below that region and reveal it visibly.
- Enter placement mode. The user can tap or nudge to another position before choosing Place.
- Place materializes an unsaved mural if necessary, then saves the candidate once. Only after successful placement open its existing configuration panel when applicable.
- Cancel creates no block and does not materialize an otherwise untouched draft mural.
- Duplicate copies content/style/dimensions with a new ID, then uses the same placement flow. Never append offscreen without revealing the candidate.
- During materialize/save, block repeated Place taps synchronously. A failed block save after successful mural creation must retry against the created mural, not create another one.

### Deletion and recovery

For this design, intentional whitespace is part of the composition. Change direct deletion and reference-driven block removal to preserve surviving coordinates. Remove automatic compaction from those paths and update the tests that currently require it. This is an explicit behavior change affecting desktop as well as mobile.

Keep delete Undo. Make it available only while that deletion remains the latest applicable mural edit; invalidate it after another successful mutation or an incompatible cache refresh. Do not restore an old whole-array snapshot over later work. Use the same limited last-action policy for move/resize Undo. A general history stack is unnecessary for this phase.

## Rendering and coordinate geometry

Implement the geometry as the first technical spike, before wiring persistence.

- Mobile overview renders a stable logical canvas and scales its presentation uniformly to fit width. Use the existing 1200px design reference initially; verify it against representative desktop murals before freezing it as an internal constant.
- Scale row heights, gaps, borders and content together. Do not resize the underlying grid width and independently scale a subset of typography to simulate zoom.
- Keep selection controls and hit-target UI in an unscaled overlay. A small visual block must not force a tiny control.
- Disable native RGL mobile drag/resize in this path. Use the existing layout engine to render the coordinate document, with the new interaction layer producing layout drafts.
- Give the wrapper the actual scaled content height so scrolling has neither a large blank tail nor clipped content. Include the placement draft when computing extents.
- Convert client coordinates to logical canvas coordinates using the measured canvas rectangle and actual scale. Account for padding and grid gutters; derive snapping from the same geometry used to render the grid.
- Prefer the measured canvas rectangle for scroll compensation; do not also add scroll offsets and double-count them.
- Add explicit Fit and Zoom controls only after fit-width placement works. Zoom changes viewport state, never saved coordinates. Keep the selected block visible and make Fit return to a predictable view.
- Recalculate on container resize and orientation changes. Preserve the draft's logical coordinates rather than converting its old screen position again.
- Do not assume pointer type and viewport width are interchangeable: a narrow mouse window needs usable layout, and touch-capable tablets can have a mouse. Test the breakpoint/input combinations.

Desktop keeps its existing renderer initially. Coordinate arrangement must match across devices; pixel-identical typography at all desktop widths is not a claim of this phase. If the geometry spike cannot retain recognizable composition for representative fixtures, resolve that before proceeding.

## State and persistence

Keep state close to the existing owners. `MuralEditorPage` coordinates selection, active operation, saving and undo. `MuralCanvas` measures/renders geometry and reports selection/draft destinations. Extract a hook only if the resulting page code warrants it.

Use one mutually exclusive active operation: idle/selected, move, resize, add or duplicate. The operation carries its draft and starting layout when needed. Opening Configure or Style ends a placement operation only through explicit Apply or Cancel; do not persist implicitly.

- Taps, nudges and resize increments update local state only.
- Apply validates against the freshest mural from the cache, merges only the relevant layout into the current block and saves once through `saveBlocks`.
- Preserve current content/style if another refresh changed them during placement. If the block disappeared or occupied space changed, cancel or mark the draft invalid visibly.
- Permit only one editor write at a time; disable other mutating actions until it settles. This prevents this editor's whole-array PUTs racing each other.
- Retain failure reconciliation and `revertNonce` where RGL still requires it. If refetch also fails, show the last confirmed state and an explicit retry path; do not leave a success-looking preview.
- On an ambiguous network failure, reconcile before retrying add/duplicate so the same candidate is not inserted twice.
- Leaving placement mode, exiting Edit, or switching murals clears unsaved geometry drafts without writing. Existing form draft behavior remains separately handled by those panels.
- This is not cross-device concurrency control. The existing whole-document API may still allow another tab/device to overwrite edits; do not claim that the local write guard solves that.

## Implementation phases

### 1. Geometry and selection prototype

Files: `frontend/src/components/murals/MuralCanvas.tsx`, `frontend/src/index.css`, `frontend/src/pages/MuralEditorPage.tsx`.

- [ ] Reconcile the baseline and capture fixtures.
- [ ] Implement fit-width rendering with correct scaled scroll extents.
- [ ] Add selection, unscaled action controls and the block picker.
- [ ] Implement local move preview, tap mapping and nudge controls without persistence.
- [ ] Verify on a real phone that scroll never places/selects accidentally and small blocks remain selectable.

Exit check: reproduce a side-by-side arrangement and a deliberate gap using tap/nudge controls; verify every proposed grid cell against the rendered position at fit width and at a second scale. Correct geometry and interaction problems before continuing.

### 2. Placement, resizing and safe commits

Files: `frontend/src/lib/murals.ts`, `frontend/scripts/test-murals.mts`, the page and canvas above; `frontend/src/hooks/useMurals.ts` only if needed for current-cache access.

- [ ] Reuse/export existing overlap checks and add the minimum candidate validation and placement helpers.
- [ ] Add resize drafts, Apply/Cancel and single-write guarding.
- [ ] Implement candidate add/duplicate flows and draft mural materialization handling.
- [ ] Preserve surviving coordinates on direct delete and book/image scrubs.
- [ ] Implement bounded Undo without stale snapshot restoration over subsequent work.
- [ ] Verify save failure, refetch failure, cancellation and reload behavior.

Exit check: add, move, resize, duplicate and delete all work from mobile, persist on confirmation only, and retain intentional gaps after reload.

### 3. Readable details and public sharing

Files: `frontend/src/components/murals/BlockRenderer.tsx`, `BlockConfigPanel.tsx`, `BlockStylePanel.tsx`, the concrete block renderers, `frontend/src/pages/SharedMuralPage.tsx`; add a focused-view component only where reuse justifies it.

- [ ] Reuse existing sheet/modal primitives, scroll locking and dismissal behavior.
- [ ] Render selected block details at readable screen size with content-driven height where possible. Do not inherit the miniature canvas font scale or fixed overview clipping.
- [ ] Inspect every block type: long text/quotes, multi-book shelves, images, stats, currently-reading content and tier lists. Keep tier-list resource editing in its existing editor.
- [ ] Ensure Configure/Style fit the phone width and remain usable with the software keyboard open. Reuse their fields and save semantics.
- [ ] Restore focus and overview scroll position after closing details.
- [ ] Provide the same overview/detail interaction on public pages using only the data already exposed by the public endpoint. Do not fetch private library/gallery data to fill missing details.
- [ ] Preserve public link behavior and existing safe rendering of content.

Exit check: every block type is readable from a phone, and recipients can see the composition and inspect its content without signing in.

### 4. Device validation and refinement

- [ ] Add optional zoom controls if the placement trials show they help. Fit remains the initial state.
- [ ] Validate keyboard selection, named controls, visible focus, dialog focus containment/return and Escape cancellation.
- [ ] Use approximately 44px touch controls and readable form text; handle safe-area insets without covering the last canvas row or Apply/Cancel.
- [ ] Test 320px, 375px and 430px widths, tablet, landscape and desktop with mouse/keyboard. Test a real iOS Safari device and Android Chrome where available; record unavailable devices explicitly.
- [ ] Update the frontend README and document intentional deletion/Undo behavior changes.

## Verification

Run after changes in the frontend package:

```sh
cd frontend
npm run typecheck
npm run lint
npx tsx scripts/test-murals.mts
npx tsx scripts/test-mural-stats.mts
```

Use the existing test runner setup; add no new framework merely for this feature. Add meaningful pure-function coverage for collision/boundary rules, gutter-aware screen-to-grid conversion at multiple scales, visible-area insertion, duplicate identity, and preserving gaps after deletion/scrubbing. Update prior compaction expectations explicitly. Validate rendered behavior in a browser and on a real phone; pure functions cannot establish usability.

Required interaction checks:

| Scenario | Expected result |
|---|---|
| Scroll starting on a block | Scrolls without selecting, dragging or placing |
| Select a very small block | Picker or reliable visible target selects the correct ID |
| Place into occupied space | Invalid preview, explanation, Apply disabled; neighbors unchanged |
| Resize against right edge | Width cannot exceed bounds; original x remains unchanged |
| Move far down a tall mural | Canvas extends and draft stays reachable |
| Rotate or resize during placement | Same logical draft coordinates; overlay remains aligned |
| Cancel move/resize/add/duplicate | No block write; original composition retained |
| Rapid double Apply/Place | One save/insertion; no duplicate mural creation |
| Save response lost | Reconcile with server before retry; no duplicate insertion |
| Delete with deliberate gaps | Only target disappears; survivor layouts unchanged |
| Delete, then another edit, then old Undo | Old undo unavailable/no-op; later work preserved |
| Focus a long quote or tier list | Full readable content with usable scrolling |
| Public detail view | No owner-only request, data or editing action |
| Desktop drag/resize | Existing controls, collisions and save recovery continue working |

## Usability decision before rollout

Use the same mural and tasks to compare the old mobile editor with the prototype:

1. Put a quote beside a book cover with a one-cell gap.
2. Make the quote taller without making it wider.
3. Move a block to another part of a tall mural.
4. Read a long quote and return to the same place.
5. Add a block, cancel another addition, and recover from a mistaken deletion.

Record task completion, accidental actions, retries and where people need explanation. Start with the owner and, if available, two or three people unfamiliar with the controls. These are formative checks, not statistical proof.

Ship when users can complete the spatial tasks without assistance, the arrangement survives saves/reloads/sharing, and scrolling does not produce unintended changes. If tap placement remains confusing, iterate on the anchor/preview/controls before revisiting the data model. If overview-plus-detail feels too fragmented for reading, evaluate the optional derived Read view as a separate follow-up.

## Rollout and rollback

Implement and validate on an isolated branch or preview deployment. No persisted experiment setting is required. Land the completed phases together once the interaction checks pass; do not replace the production editor with an unfinished placement flow.

The stored schema remains compatible. Reverting the UI can render layouts authored by the new editor without a data migration. It does not undo user edits. A full code revert would restore prior deletion compaction behavior for future deletions; distinguish that from restoring historical positions.
