# Murals as a sequence — inverting which layout is derived

## Context

A mural is a freeform 12-column `react-grid-layout` canvas of typed
blocks. Each block stores `layout: {x, y, w, h}`, and that coordinate
grid is the single source of truth for how a mural looks on every
device.

Two days of testing on a phone have shown the grid is the source of
nearly every mobile problem in the feature:

- 12 columns across a 375px viewport is a **17.6px column**, so a
  4-column block is 100px wide — about 10 characters a line for a text
  block, against ~53 on a desktop.
- The zoom control that hid this (canvas width = viewport × zoom,
  opening at 300%) meant a phone showed roughly a third of a mural and
  panned for the rest. It has since been removed at the user's
  request.
- An 8px `react-resizable` corner is unusable with a finger; the touch
  drag grip has to sit on top of block content; new blocks land below
  everything, off the visible area.

Each of those has been patched individually. They are all the same
bug: **a coordinate canvas needs precision, and a finger doesn't have
any.**

## This reverses a decision from 2026-09-04

`2026-09-04-mobile-mural-editor-design.md` locked in, with the user:

> **Paradigm: true canvas (WYSIWYG)** — touch devices edit the real
> grid, not a reflowed list. Exact placement is a first-class mobile
> capability. (Chosen over a stacked-list editor…)

That was a reasonable bet and it has now been tested in use. It held
only while zoom existed, because zoom was what made blocks
desktop-sized on a phone. With zoom gone — removed because panning
around a mural you can only see a third of is worse than the problem
it solved — "edit the real grid" resolves to "edit 100px blocks on a
17.6px column grid".

So this spec adopts the alternative that spec rejected. It is not new
information about phones; it is the same trade-off, priced after use
rather than before.

## Decisions locked in with the user

- **Invert the derivation.** The *sequence* becomes the source of
  truth, authored identically on every device. The desktop
  *composition* is derived from it, not the other way round.
- **Not two stored layouts.** Considered and rejected: it does not
  remove derivation, it relocates it to every block insertion; it
  drifts permanently, since a content change must be made twice; and
  it doubles the pure layout logic (`scrubBooksFromMurals`,
  `duplicateBlock`, `removeBlock` would each have to operate on two
  layouts and keep them consistent).
- **Freeform placement goes away, permanently.** Accepted: you will no
  longer be able to put *that* block exactly *there*. A shared `size`
  gives back most of the expressiveness at a fraction of the
  maintenance.
- **One control, honoured by both renderers** — never a
  desktop-only or phone-only layout control.

## Data model

### Order

**The blocks array order is the order.** No `order` field.

The mural document already stores `blocks` as an ordered array and the
whole array is written on every save, so an explicit index would be a
second source of truth that can disagree with array position.
Reordering is reordering the array.

### Size

`layout: {x, y, w, h}` is replaced on `MuralBlockBase` by:

```ts
size: "s" | "m" | "l"
```

One control, two meanings, both honoured:

| | phone | desktop wall |
|---|---|---|
| `s` | full width, short | one column |
| `m` | full width, medium | one column, taller |
| `l` | full width, tall | **spans both columns** |

Height per size is resolved per block type, not globally: a spotlight
is a book cover and wants a 2:3 aspect; a stats row is intrinsically
short; a tier list needs five readable rows and is much taller than
anything else (its current default `h` is 8 against everyone else's
2–4). So `sizeHeight(type, size)` is a small table in `lib/murals.ts`,
seeded from today's `DEFAULT_SIZE_BY_TYPE` heights so existing murals
keep roughly their current proportions.

Blocks with an intrinsic aspect ratio (`image`, `spotlight`) use
`aspect-ratio` at each size rather than a fixed height, so they never
letterbox.

## Rendering

### Phone (and any narrow viewport)

A single column of full-width blocks in array order. No grid, no
coordinates, no zoom. Vertical page scroll.

### Desktop wall

A two-column CSS grid at `≥1024px`, one column below it. Row spans are
computed from `sizeHeight`, so blocks of different heights tile without
a masonry library; `l` blocks take `grid-column: span 2`.

Deliberately **not** `grid-auto-flow: dense` and **not** CSS
`columns`: both reflow blocks out of sequence, and sequence is now the
thing the user authored. A gap at the foot of a column is the honest
cost of preserving order.

### Share pages

`SharedMuralPage` renders through the same `MuralCanvas` /
`BlockRenderer` as the editor and inherits this for free — that
sharing is what makes the desktop wall worth keeping at all.

## Migration

**Normalise on read, in the backend murals module** — the pattern
`5775c6c` already established for tier-list documents, rather than a
destructive migration script.

For a block that has `layout` and no `size`:

1. **Order** — sort the mural's blocks by `(layout.y, layout.x)`.
   Reading order: top to bottom, then left to right. Lossless *as an
   ordering*.
2. **Size** — from `layout.h`, bucketed against the type's own default
   height: below it → `s`, at it → `m`, above → `l`.
3. `layout` is dropped from the block on the next save.

Old documents keep rendering until they are next written, and no
existing mural needs a maintenance window.

**What migration does not preserve: adjacency.** Two blocks
deliberately placed side by side become two consecutive blocks in the
sequence. On the desktop wall they will often still land side by side,
because the wall is two columns and they are adjacent in order — but
that is a coincidence of the wall, not a guarantee.

## Operations that get simpler

| operation | today | after |
|---|---|---|
| add | `nextLayoutBelow` finds a free y | append to array |
| duplicate | places the copy below everything | insert directly after the original |
| delete | `compactBlocksVertically` closes the gap | remove from array — a list has no gaps |
| scrub on book delete | removes, then compacts | removes |
| reorder | drag on a coordinate grid | `@dnd-kit` sortable (already a dependency) |
| resize | 8px drag corner | pick `s`/`m`/`l` |

## What this deletes

- `react-grid-layout` (548K) and `react-resizable`.
- Most of `MuralCanvas.tsx` (228 lines): grid props, `draggableCancel`,
  the touch grip, resize-handle CSS.
- `nextLayoutBelow`, `nextBlockLayout`, `layoutsOverlap`,
  `compactBlocksVertically`, and the `BlockLayout` type.
- **`revertNonce`.** It exists only because RGL keeps internal layout
  state that a deep-equal controlled prop cannot dislodge, so a failed
  save left a block where you dropped it. A sortable list is fully
  controlled; the failure mode disappears with the library.

## Testing

Everything decisive here is a pure function over data, so it is tested
in `scripts/test-murals.mts` without a DOM, alongside the existing 63:

- `normalizeBlocks` — the migration. The risky one, and it gets the
  most cases: a plain stack, side-by-side pairs, deliberate gaps, a
  single block, and blocks sharing a `y`. Assert reading order and
  that a second normalise is a no-op.
- `sizeHeight(type, size)` — every type × every size resolves, and
  aspect-ratio types return a ratio rather than a height.
- `moveBlock(blocks, from, to)` — reorder, including the ends.
- The existing scrub/duplicate/add tests, updated for the new shape;
  the compaction assertions in sections 12–14 are deleted rather than
  rewritten, since gaps cannot occur.

## Open questions for review

1. **Two-column desktop wall, or one?** One column everywhere (wider
   and centred on desktop) is simpler and needs no row-span maths. The
   two-column wall is what keeps a mural feeling like a composed wall
   rather than a long feed.
2. **Is `s`/`m`/`l` enough?** A fourth step, or a per-type override,
   can be added later; it is additive.
3. **Should share pages render the wall or the phone stack?** The wall
   is proposed, on the grounds that a shared link is usually opened to
   be looked at rather than scrolled.

## Out of scope

- Block content editing — configure/style panels are untouched.
- Tier-list ranking, which is its own resource and its own editor.
- Long-press-to-pick-up and other gesture polish: worth doing, but
  after the model lands.
