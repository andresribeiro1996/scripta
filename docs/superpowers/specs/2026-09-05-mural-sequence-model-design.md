# Murals as a sequence — inverting which layout is derived

> **PROVISIONAL — this is a trial and may be rolled back.**
>
> It replaces the mural layout model, so it is the kind of change that
> is normally one-way. It is deliberately built not to be. Every
> decision below that could destroy the old model has been taken the
> other way: `layout` is **never removed** from a stored block, the old
> coordinates stay valid the whole time, and reverting is a code revert
> with no data migration and nothing lost. See **Rolling this back**.
>
> Read the rest of this spec with that in mind — some of it is more
> conservative than it would be if this were permanent, and that is the
> point.

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
- **Two-column desktop wall**, not one column everywhere. A mural
  should still read as a composed wall on a big screen; a single
  centred column would make it a feed.
- **Four size steps**, not three (see below).
- **Share pages render the phone stack**, at every viewport. A shared
  link is the one view whose author cannot see how it landed, so it
  renders the same everywhere rather than reflowing into a wall the
  author never looked at.
- **Provisional.** This is a trial. Nothing in it may destroy the
  freeform coordinates it replaces.

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
size: "s" | "m" | "l" | "xl"
```

One control, two meanings, both honoured. The first three steps are
height within a single column; only `xl` changes width, which keeps
"how tall" and "how wide" from fighting over one control:

| | phone | desktop wall |
|---|---|---|
| `s` | full width, short | one column, short |
| `m` | full width, medium | one column, medium |
| `l` | full width, tall | one column, tall |
| `xl` | full width, tallest | **spans both columns** |

Four steps rather than three because with only `s`/`m`/`l` the last one
had to carry both "tall" and "full width", so a block could not be tall
on the phone without also going double-width on the desktop.

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
a masonry library; `xl` blocks take `grid-column: span 2`.

Deliberately **not** `grid-auto-flow: dense` and **not** CSS
`columns`: both reflow blocks out of sequence, and sequence is now the
thing the user authored. A gap at the foot of a column is the honest
cost of preserving order.

### Share pages

**The single-column stack, at every viewport** — not the wall.

`SharedMuralPage` renders through the same `MuralCanvas` /
`BlockRenderer` as the editor, so this is a prop rather than a second
renderer.

The reasoning is that a shared mural is the one view whose author never
sees how it landed. Authoring now happens in the sequence; rendering
that sequence back as a two-column wall for a recipient means the thing
you sent is arranged by a rule you did not watch run. A stack is what
you composed, in the order you composed it, on any device the link is
opened on.

## Migration

**Normalise on read, in the backend murals module** — the pattern
`5775c6c` already established for tier-list documents, rather than a
destructive migration script.

For a block that has `layout` and no `size`:

1. **Order** — sort the mural's blocks by `(layout.y, layout.x)`.
   Reading order: top to bottom, then left to right. Lossless *as an
   ordering*.
2. **Size** — from `layout.h`, bucketed against the type's own default
   height: well below → `s`, at or near it → `m`, above → `l`, and
   `xl` only where the block was also full-bleed wide (`w ≥ 10` of 12),
   since that is the one case where the author asked for the width.
3. **`layout` is left exactly as it is.** It is not rewritten and not
   removed — see below.

Old documents keep rendering until they are next written, and no
existing mural needs a maintenance window.

### `layout` is never removed

The obvious tidy-up — drop `layout` once `size` exists — is the one
thing that would make this trial one-way. A block keeps both fields:
`size` is what the new renderers read, `layout` is dead weight they
ignore.

That costs a little document size and one stale field. It buys a
rollback that is a code revert and nothing else: every mural still
carries the exact coordinates it was arranged with, so reverting
restores the freeform canvas with each block back where the user put
it. Deleting `layout` would make a rollback restore murals to
*nothing* — every block at a default position, every arrangement lost.

Reordering on the phone therefore does **not** rewrite `y`. The
sequence lives in the array; the coordinates are a frozen snapshot of
the last freeform arrangement.

**What migration does not preserve: adjacency.** Two blocks
deliberately placed side by side become two consecutive blocks in the
sequence. On the desktop wall they will often still land side by side,
because the wall is two columns and they are adjacent in order — but
that is a coincidence of the wall, not a guarantee.

## Operations that get simpler

| operation | today | during the trial |
|---|---|---|
| add | `nextLayoutBelow` finds a free y | append to array — **and still assign a `layout`** |
| duplicate | places the copy below everything | insert directly after the original |
| delete | `compactBlocksVertically` closes the gap | remove from array — the list has no gaps, **but still compact the shadow coordinates** |
| scrub on book delete | removes, then compacts | unchanged |
| reorder | drag on a coordinate grid | `@dnd-kit` sortable (already a dependency) |
| resize | 8px drag corner | pick `s`/`m`/`l`/`xl` |

The two "still" entries are the price of reversibility. During the
trial the coordinate model is **maintained as a shadow, not
abandoned**: a block added now gets a `layout` so a rollback finds it
positioned rather than defaulted, and a deletion still closes the gap
it leaves so the pre-trial arrangement stays coherent. Neither affects
what any renderer draws.

## What this removes — and when

Two stages, and the split matters: the renderer simplification is safe
to take now, the data-model simplification is the **reward for
confirming the trial**, not something available on day one.

**Now, while the trial runs** (all reversible by code revert):

- `react-grid-layout` (548K) and `react-resizable` leave the bundle.
- Most of `MuralCanvas.tsx` (228 lines): grid props, `draggableCancel`,
  the touch grip, resize-handle CSS.
- **`revertNonce`.** It exists only because RGL keeps internal layout
  state that a deep-equal controlled prop cannot dislodge, so a failed
  save left a block where you dropped it. A sortable list is fully
  controlled; the failure mode disappears with the library.

**Only once the trial is confirmed** (this is what makes it one-way):

- `nextLayoutBelow`, `nextBlockLayout`, `layoutsOverlap`,
  `compactBlocksVertically`, and the `BlockLayout` type.
- The `layout` field itself, dropped from stored blocks.

So the headline simplification is real but deferred. Day one is
mostly a *renderer* change carrying a shadow of the old model.

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
- The existing scrub/duplicate/add tests keep their compaction
  assertions **unchanged**. Sections 12–14 assert that gaps close in
  the coordinate model, and that model is still being maintained — they
  are now the regression test for reversibility, and they only get
  deleted if the trial is confirmed.
- One test specific to the trial: adding, deleting and reordering
  blocks must leave every remaining block with a valid `layout`. That
  is the invariant a rollback depends on, and it is the one thing no
  renderer would notice was broken.

## Rolling this back

The trial is reversible by design, and this is the checklist:

1. Revert the code. There is no data step.
2. Every mural still has its `layout` on every block, untouched since
   before the trial, so the freeform canvas comes back with each block
   exactly where it was arranged.
3. `size` values are left behind as a stale field. Harmless, and they
   are what a second attempt would start from.

The one thing lost on a rollback is any *sequencing* done during the
trial: a mural reordered on a phone reverts to its pre-trial
arrangement, because reordering never touched the coordinates. That is
the deliberate trade — a rollback loses trial work rather than
pre-trial work.

What would break reversibility, and so must not happen during the
trial: removing `layout`, rewriting `layout` from the sequence, or
adding a block type that has no coordinate representation.

## Out of scope

- Block content editing — configure/style panels are untouched.
- Tier-list ranking, which is its own resource and its own editor.
- Long-press-to-pick-up and other gesture polish: worth doing, but
  after the model lands.
