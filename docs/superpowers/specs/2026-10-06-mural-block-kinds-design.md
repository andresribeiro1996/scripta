# Mural block kinds: one table in `@scripta/shared`

Date: 2026-10-06
Status: draft, from the architecture review (candidate #1). The grill answers are recorded below.

## Problem

There are 12 mural block types. What each type *is* (its label, default size, minimum height, default content, whether it has anything to configure) and which books it references are written separately in about a dozen places across shared, web, mobile and backend. The copies already disagree:

- `MobileMuralCanvas.tsx:401` offers Configure for readerCard. The panel it opens says "Nothing to configure". The other four "nothing to configure" checks leave readerCard out.
- currentlyReading's default height is 4, but its minimum is 6. `ensureBookBlockHeights` patches it after the fact.
- The web metadata prefetch (`useMuralBookMetadata`) skips quote and quoteCollection books, so their details load late.
- The backend's `blockRefs.ts` and `rekeyBlocks.ts` still handle an inline tier-list shape (`tiers`/`pool` on the block) that no client has written since 2026-09-04.
- `blockRefs.ts` duplicates the client union by hand and says, wrongly now, that no shared package exists.

Adding a 13th block type means finding every copy. Missing one fails silently: a public page renders the block empty, or a book delete leaves a dangling key.

## Decisions

| Question | Answer |
|---|---|
| Scope | Book references, the fixed per-type facts, **and** how clients find the books a block draws |
| Behaviour | Fix freely where copies disagree. The fixes are listed below |
| Interface | Exported functions over one internal table. Callers never index by type |
| Malformed blocks | Tolerant. Shared functions take `unknown` where the backend does, skip or pass through anything they don't recognise, and never throw |
| Inline `tiers`/`pool` | Delete it |
| Public shared-mural pages | Included for free. Both rebuild the private book shape (web `buildReconstructedBooks`, mobile `reconstructBooks`) and draw through the same canvas |

## Design

### Module

There is a new file, `packages/shared/src/murals/blockKinds.ts`, with one internal table. It imports only types from `murals.ts`, so there is no runtime import cycle. `murals.ts` re-exports its public functions, because web's `frontend/src/lib/murals.ts` re-exports the `@scripta/shared/murals/murals` subpath.

```ts
const KINDS = { spotlight: {…}, shelf: {…}, … } satisfies Record<BlockType, Kind>;
```

Each `Kind` holds:

| Column | Replaces |
|---|---|
| `label` | `BLOCK_TYPE_LABELS` |
| `size` `{ w, h }` | `DEFAULT_SIZE_BY_TYPE` |
| `minHeight` | `minimumHeight` |
| `configurable` | mobile `CONTENTLESS`/`hasContentFields`, `MuralEditorPage.tsx:242,386,426`, `MobileMuralCanvas.tsx:401` |
| `create()` | the per-type `switch` in `defaultBlockForType` |
| `valid(record)` | the per-field `isRecord`/`typeof` guards in `blockRefs.ts` |
| `references(block, refs)` | the per-type `case`s in backend `extractReferences` |
| `rekey(block, from, to)` | backend `rekeyBlocks`, which is type-blind today |
| `scrub(block, keys)` | the per-type branches in `scrubBooksFromMurals` |
| `draws(block, ctx)` | the per-type book lookups in web `BookBlocks`, `MobileBlockPreview`, `MuralBlockDetail`, `muralMetadataBooks`, and mobile `MuralCanvas.tsx:193-205,471` |

`satisfies` makes a 13th type a compile error until every column is filled.

### Exports

The table itself stays unexported. Callers use these functions:

- `BLOCK_TYPES`: an ordered list for the add-block menus.
- `blockLabel(type)`.
- `defaultBlockForType(type)` (same name, now reads the table).
- `isConfigurable(type)`.
- `muralBlockTitle` (unchanged signature, reads `blockLabel`).
- `ensureBookBlockHeights` (unchanged, reads `minHeight`).
- `blockReferences(blocks: unknown)`: today's `extractReferences` and its `ExtractedReferences` shape, moved from the backend.
- `rekeyBlocks(blocks: unknown, from, to): unknown`: moved from the backend.
- `scrubBooksFromMurals(murals, keys)` (unchanged signature).
- `blockBooks(block, books, tierlist?)`: the books a block draws, after `resolveHomeBlock`.
  - `tierlist` is a lookup returning the tier list's `{ tiers: { workIds }[], pool }` from shared `TierlistData`. Web and mobile shapes both reduce to that.
  - quote and quoteCollection return their books too, which is how the prefetch fix lands.

`BLOCK_TYPE_LABELS`, `DEFAULT_SIZE_BY_TYPE`, `minimumHeight`, `hasContentFields`/`CONTENTLESS` and backend `domain/blockRefs.ts` and `domain/rekeyBlocks.ts` are deleted.

### Malformed input

`blockReferences` and `rekeyBlocks` take `unknown`. Each element goes through `isRecord`, then a known `type`, then `KINDS[type].valid(element)`:

- **Fails any check:**
  - `blockReferences` skips the element.
  - `rekeyBlocks` returns it untouched.
- **Passes:** the kind's typed function runs.

Client-side functions take `MuralBlock` and skip the guard.

Behaviour change: `rekeyBlocks` is type-blind today. It rewrites `bookKey`, `bookKeys` and `quotes` on any record. After this change it rewrites only the kinds that hold book keys: spotlight, shelf, quote and quoteCollection. A block of an unknown type passes through untouched.

### Deliberate splits that stay

"Books a block needs" and "keys a block stores" are different questions, and two cases keep answering them differently:

- **A shelf with `collectionId`:**
  - `references` adds the group, not the keys.
  - `scrub` leaves it alone.
  - `rekey` rewrites its `bookKeys`, which are `[]` in practice.
- **A rediscover quote:**
  - `references` skips it.
  - `scrub` leaves it alone.
  - `rekey` rewrites `bookKey`, which is `""` in practice.

`publicPayload.ts` keeps its rewrites (collection shelf to plain shelf, rediscover quote to "Private passage", tier-list books by work id) and calls `blockReferences`.

### Fixes that ride along

1. readerCard no longer offers Configure anywhere, because `isConfigurable` is the only gate.
2. currentlyReading's default size becomes `{ w: 4, h: 6 }`.
3. The web metadata prefetch includes quote and quoteCollection books, because it calls `blockBooks`.
4. Delete the inline `tiers`/`pool` handling:
   - in `blockRefs` and `rekeyBlocks`
   - its case in `rekeyBlocks.test.ts`
   - the stale text at `frontend/README.md:274,302` and `backend/README.md:115`
   - the stale `blockRefs.ts` header, which goes with the file

   `test-murals.mts` section 18 tests today's id-only tier-list block, so it moves to shared with the other scrub cases.

### What does not change

- What `blockReferences(...).bookKeys` returns for every live block shape. `mural_works` is filled from it on PUT, by the works sweep and on rekey. The only difference is dead inline tier blocks, which stop contributing keys.
- The stored mural JSON, the API, and the public payload shape. No migration and no client/server ordering. Mobile can take the change over the air.
- Per-client rendering switches (`BlockRenderer`, `MobileBlockPreview`, `MuralBlockDetail`, `BlockConfigPanel`, mobile `MuralCanvas`, `ContentTab`, `MuralPresetPicker`). They are UI and stay per client.
- Add/duplicate placement (candidate #6) and the duplicated public-book reconstruction (candidate #3).

## Tests

There is a new `packages/shared/src/murals/blockKinds.test.ts`, run with `node --test`:

- `blockReferences` per type. That includes quoteCollection, image, stats and currentlyReading, which have no direct coverage today. It also covers non-array input, non-record elements, unknown types, and known types with wrong field types.
- `rekeyBlocks` per kind, plus pass-through of unknown and invalid elements and quote dedupe. These move from `rekeyBlocks.test.ts`, minus the inline-tier case.
- `scrubBooksFromMurals`. These move from `frontend/scripts/test-murals.mts` sections 9–11, 13 and 18. The deliberate splits are pinned.
- `blockBooks` per type, including tier lists by work id and quotes.
- `isConfigurable` and `defaultBlockForType(type).layout` sizes, including the two fixes.

The backend route, sweep and home tests stay as they are and must stay green. They are the check that `mural_works` and the public payload didn't move.

## Verification

- `packages/shared`: `npm run build`, `npm test`.
- `backend`: `npm run typecheck`, `npm test` (with the env preamble).
- `frontend`: `npm run typecheck`, `npm run lint`, `npm test`.
- `mobile`: `npm run typecheck`, `npm test`.

A device pass is optional. The only visible mobile change is the default height of a newly added currentlyReading block.
