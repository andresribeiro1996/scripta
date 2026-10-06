# Mural Block Kinds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put everything that depends on a mural block's type into one table in `@scripta/shared`, and route web, mobile and backend through it. That covers its label, size, minimum height, default content, whether it can be configured, the books it references, how it is re-keyed, how it is scrubbed, and the books it draws.

**Architecture:** Add a new `packages/shared/src/murals/blockKinds.ts` holding one internal `KINDS` table, typed `{ [T in BlockType]: Kind<T> }`, so a 13th block type is a compile error until every column is filled. Callers only use exported functions.
- `blockKinds.ts` imports only *types* from `murals.ts`.
- `murals.ts` imports its runtime helpers and re-exports it with `export * from "./blockKinds.js"`. That keeps the dependency one-way and makes the new functions reach web through `frontend/src/lib/murals.ts`, which re-exports the `@scripta/shared/murals/murals` subpath.

The backend's `blockRefs.ts` and `rekeyBlocks.ts` move into the table.

**Tech Stack:**
- TypeScript, with `node:test` via `tsx` for shared, backend and mobile.
- `tsx --test scripts/test-*.mts` for frontend.
- React (web), React Native/Expo (mobile), Fastify (backend).

**Spec:** `docs/superpowers/specs/2026-10-06-mural-block-kinds-design.md`

## Global Constraints

- **Shared builds to `dist/`.** Backend, frontend and mobile all import `@scripta/shared` from `packages/shared/dist`. Run `npm run build --workspace packages/shared` after every shared change, before you typecheck or test any client.
- **Run git and npm from the worktree root.** Use `--workspace <dir>`, never `cd` or `git -C`.
- **No comments in new code.** When you move a function, its existing doc comment may move with it. Delete comments that name deleted symbols, or reword them to name the new ones.
- **`blockReferences(...).bookKeys` must return exactly what `extractReferences(...).bookKeys` returns today for every live block shape.** `mural_works` is stored from it. The only allowed difference: a tier-list block's inline `tiers`/`pool` stop contributing keys.
- **No API, stored-JSON or public-payload shape changes.**
- **Every commit message ends with the line** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Stage and commit in one command** (`git add … && git commit …`). Another session can sweep staged files into its own commit otherwise.

## Review Focus

These are the inputs most likely to bite that no step tests directly. Each one has a test in the owning task.

1. **A block whose `type` is an `Object.prototype` key** (`"toString"`, `"constructor"`). The `KINDS` lookup must not find a function and call it. The pinning test is in Task 2.
2. **A known type whose fields have the wrong type** (`spotlight.bookKey: 5`, `shelf.bookKeys: "a"`, `quoteCollection.quotes: {}`). `blockReferences` must skip it, and `rekeyBlocks` must return it untouched rather than throw. The pinning test is in Task 2.
3. **A shelf that follows a collection (`collectionId` set) when a book is deleted.** It must survive the scrub untouched. The same goes for a rediscover quote with `bookKey: ""` when `""` is somehow in the key set. The pinning test is in Task 3.
4. **A quoteCollection holding two passages from the same book.** `blockBooks` must return that book once. The metadata prefetch must not fetch the same book twice across blocks. The pinning test is in Task 4.
5. **A tier list block whose tier list hasn't loaded yet** (the lookup returns `undefined`). `blockBooks` must return `[]`, not throw. The pinning test is in Task 4.

---

### Task 1: Fixed per-type facts in one table

This task creates `blockKinds.ts` with the label, size, minimum-height, configurable and default-content columns, and routes every caller through it. Two fixes land here:
- readerCard stops offering Configure.
- currentlyReading's default height becomes 6.

**Files:**
- Create: `packages/shared/src/murals/blockKinds.ts`
- Create: `packages/shared/src/murals/blockKinds.test.ts`
- Modify: `packages/shared/src/murals/murals.ts`. Delete `BLOCK_TYPE_LABELS` (:92-105), `DEFAULT_SIZE_BY_TYPE` (:168-183), `minimumHeight` (:185-187) and `defaultBlockForType` (:405-442). Rewire `muralBlockTitle`, `ensureBookBlockHeights`, `nextBlockLayout`, `addBlock` and `createBlockCandidate`.
- Modify: `frontend/src/components/murals/AddBlockMenu.tsx:5,7,77,94`
- Modify: `frontend/src/components/murals/BlockConfigPanel.tsx:18,71`
- Modify: `frontend/src/pages/MuralEditorPage.tsx:242,386,426`
- Modify: `frontend/src/components/murals/MobileMuralCanvas.tsx:401`
- Modify: `mobile/src/features/murals/BlockSheet.tsx:1,47`
- Modify: `mobile/src/features/murals/MuralCanvas.tsx:3,233,342,372`
- Modify: `mobile/src/features/murals/MuralEditorScreen.tsx:4,34,44,160,195,260,261,283`
- Modify: `mobile/src/features/murals/ContentTab.tsx:12,17-19`. Delete `CONTENTLESS` and `hasContentFields`.

**Interfaces:**
- Produces, all exported from `@scripta/shared` and from `frontend/src/lib/murals`:
  - `BLOCK_TYPES: BlockType[]`, in table order: spotlight, shelf, quote, quoteCollection, image, text, profile, currentlyReading, stats, empty, tierlist, readerCard.
  - `blockLabel(type: BlockType): string`
  - `blockSize(type: BlockType): { w: number; h: number }`
  - `minBlockHeight(type: BlockType): number`
  - `isConfigurable(type: BlockType): boolean`
  - `newBlock(id: string, type: BlockType, layout: BlockLayout): MuralBlock`
- Produces, internal to `blockKinds.ts` and extended by Tasks 2–4: `interface Kind<T extends BlockType>` and `const KINDS`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/murals/blockKinds.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "../library/merge.js";
import { BLOCK_TYPES, blockLabel, createBlockCandidate, ensureBookBlockHeights, isConfigurable, muralBlockTitle, type BlockType, type MuralBlock } from "./murals.js";

const make = (type: BlockType, extra: Record<string, unknown> = {}) => ({ ...createBlockCandidate(type, []), ...extra }) as MuralBlock;

test("every block type has a label and a default block of its own type", () => {
  assert.equal(BLOCK_TYPES.length, 12);
  for (const type of BLOCK_TYPES) {
    assert.ok(blockLabel(type));
    assert.equal(createBlockCandidate(type, []).type, type);
  }
});

test("only currentlyReading, empty and readerCard have nothing to configure", () => {
  assert.deepEqual(BLOCK_TYPES.filter((type) => !isConfigurable(type)), ["currentlyReading", "empty", "readerCard"]);
});

test("a new currentlyReading block already meets its minimum height", () => {
  const blocks = [createBlockCandidate("currentlyReading", [])];
  assert.equal(blocks[0].layout.h, 6);
  assert.equal(ensureBookBlockHeights(blocks), blocks);
});

test("muralBlockTitle names a block by its content and falls back to its label", () => {
  const books = [{ Title: "Dune", Attribution: "Frank Herbert" }];
  assert.equal(muralBlockTitle(make("text"), books), "Note");
  assert.equal(muralBlockTitle(make("shelf"), books), "Shelf");
  assert.equal(muralBlockTitle(make("shelf", { title: "Top 5" }), books), "Top 5");
  assert.equal(muralBlockTitle(make("spotlight", { bookKey: bookKey(books[0]) }), books), "Dune");
  assert.equal(muralBlockTitle(make("tierlist"), books, "Best of"), "Best of");
  assert.equal(muralBlockTitle(make("stats"), books), "Stats");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace packages/shared`
Expected: FAIL. `BLOCK_TYPES`, `blockLabel` and `isConfigurable` are not exported (a TypeScript/import error at load).

- [ ] **Step 3: Create `blockKinds.ts`**

```ts
import type { BlockLayout, BlockType, MuralBlock } from "./murals.js";

type Content<T extends BlockType> = Omit<Extract<MuralBlock, { type: T }>, "id" | "type" | "layout" | "style" | "expandedFrom">;

interface Kind<T extends BlockType> {
  label: string;
  size: { w: number; h: number };
  minHeight: number;
  configurable: boolean;
  content(): Content<T>;
}

const KINDS: { [T in BlockType]: Kind<T> } = {
  spotlight: { label: "Book spotlight", size: { w: 3, h: 4 }, minHeight: 0, configurable: true, content: () => ({ bookKey: "" }) },
  shelf: { label: "Shelf", size: { w: 8, h: 4 }, minHeight: 4, configurable: true, content: () => ({ title: "", bookKeys: [] }) },
  quote: { label: "Quote spotlight", size: { w: 4, h: 3 }, minHeight: 0, configurable: true, content: () => ({ bookKey: "", highlightId: "" }) },
  quoteCollection: { label: "Quote collection", size: { w: 6, h: 4 }, minHeight: 0, configurable: true, content: () => ({ title: "", quotes: [] }) },
  image: { label: "Image", size: { w: 4, h: 3 }, minHeight: 0, configurable: true, content: () => ({ imageId: "" }) },
  text: { label: "Text", size: { w: 4, h: 2 }, minHeight: 0, configurable: true, content: () => ({ heading: "", body: "" }) },
  profile: { label: "Reader profile", size: { w: 6, h: 5 }, minHeight: 0, configurable: true, content: () => ({ bio: "", favoriteGenres: [] }) },
  currentlyReading: { label: "Currently reading", size: { w: 4, h: 6 }, minHeight: 6, configurable: false, content: () => ({}) },
  stats: { label: "Stats", size: { w: 6, h: 2 }, minHeight: 0, configurable: true, content: () => ({ metrics: ["totalBooks", "booksFinished", "totalHighlights"] }) },
  empty: { label: "Empty block", size: { w: 3, h: 2 }, minHeight: 0, configurable: false, content: () => ({}) },
  tierlist: { label: "Tier list", size: { w: 10, h: 8 }, minHeight: 8, configurable: true, content: () => ({ tierlistId: "" }) },
  readerCard: { label: "Reader card", size: { w: 4, h: 6 }, minHeight: 0, configurable: false, content: () => ({}) }
};

export const BLOCK_TYPES = Object.keys(KINDS) as BlockType[];

export function blockLabel(type: BlockType): string {
  return KINDS[type].label;
}

export function blockSize(type: BlockType): { w: number; h: number } {
  return KINDS[type].size;
}

export function minBlockHeight(type: BlockType): number {
  return KINDS[type].minHeight;
}

export function isConfigurable(type: BlockType): boolean {
  return KINDS[type].configurable;
}

export function newBlock(id: string, type: BlockType, layout: BlockLayout): MuralBlock {
  return { id, type, layout, ...KINDS[type].content() } as MuralBlock;
}
```

`content` is declared with method syntax on purpose. Method parameters are bivariant, which is what lets Tasks 2–4 assign `KINDS[block.type]` to a `Kind<BlockType>`.

- [ ] **Step 4: Rewire `murals.ts`**

1. Below the existing imports, add:
   ```ts
   import { blockLabel, blockSize, minBlockHeight, newBlock } from "./blockKinds.js";

   export * from "./blockKinds.js";
   ```
2. Delete `BLOCK_TYPE_LABELS` and its doc comment. In `muralBlockTitle`, replace both `BLOCK_TYPE_LABELS[block.type]` with `blockLabel(block.type)`.
3. Delete `DEFAULT_SIZE_BY_TYPE` and the comment above it, but keep `export const GRID_COLUMNS = 12;`.
4. Delete `minimumHeight`. In `ensureBookBlockHeights`, replace both `minimumHeight(block)` with `minBlockHeight(block.type)`.
5. In `nextBlockLayout`, replace `DEFAULT_SIZE_BY_TYPE[type]` with `blockSize(type)`. In `createBlockCandidate`, do the same and replace `defaultBlockForType(newId(), type, …)` with `newBlock(newId(), type, …)`.
6. In `addBlock`, replace `defaultBlockForType(blockId, type, layout)` with `newBlock(blockId, type, layout)`. Delete `defaultBlockForType`.

- [ ] **Step 5: Run the shared tests and build**

Run: `npm test --workspace packages/shared && npm run build --workspace packages/shared`
Expected: all tests pass, including the 4 new ones, and the build is clean.

- [ ] **Step 6: Route the web callers through the table**

- `AddBlockMenu.tsx`:
  - Import `blockLabel` instead of `BLOCK_TYPE_LABELS` from `../../lib/murals`.
  - Replace `BLOCK_TYPE_LABELS[choice.type]` at :77 and :94 with `blockLabel(choice.type)`.
  - Reword the comment at :7 to name `blockLabel` instead.
- `BlockConfigPanel.tsx`: drop `BLOCK_TYPE_LABELS` from the :18 import and add `blockLabel`. At :71, use `{blockLabel(draft.type)}`.
- `MuralEditorPage.tsx`: add `isConfigurable` to the `../lib/murals` import. Then make these replacements:
  - :242 → `if (isConfigurable(type)) setConfiguringBlockId(blockId);`. Delete the comment beside it if it names the three types.
  - :386 → `if (alreadyInserted && finishedDraft.kind === "add" && isConfigurable(finishedDraft.block.type)) {`
  - :426 → `if (finishedDraft.kind === "add" && isConfigurable(finishedDraft.block.type)) {`
- `MobileMuralCanvas.tsx:401` → `...(isConfigurable(selected.type) ? [{ label: "Configure", onClick: () => onConfigureBlock?.(selected) }] : []),`. Add `isConfigurable` to its `../../lib/murals` import. **This is the readerCard fix.**

- [ ] **Step 7: Route the mobile callers through the table**

- `BlockSheet.tsx`: import `blockLabel` instead of `BLOCK_TYPE_LABELS`. Change :47 to `title={block ? blockLabel(block.type) : ""}`.
- `MuralCanvas.tsx`: swap the `BLOCK_TYPE_LABELS` import (:3) for `blockLabel`. At :233, :342 and :372, replace `BLOCK_TYPE_LABELS[block.type]` with `blockLabel(block.type)`.
- `MuralEditorScreen.tsx`:
  - Import `BLOCK_TYPES` and `blockLabel` and `isConfigurable` from `@scripta/shared`, and drop `BLOCK_TYPE_LABELS`.
  - Delete the local `const BLOCK_TYPES = …` at :44.
  - Change the `./ContentTab` import at :34 to `import { ContentTab, type PickerKind } from "./ContentTab";`.
  - Replace `hasContentFields(` with `isConfigurable(` at :160, :195 and :283.
  - Replace `BLOCK_TYPE_LABELS[type]` and `BLOCK_TYPE_LABELS[selected.type]` at :260 and :261 with `blockLabel(…)`.
- `ContentTab.tsx`: delete `CONTENTLESS` (:12) and `hasContentFields` (:17-19). Drop `BlockType` from its import if nothing else uses it.

- [ ] **Step 8: Run every check that touches these files**

Run:
```bash
npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend
```
```bash
npm run typecheck --workspace mobile && npm test --workspace mobile
```
```bash
rg -n "BLOCK_TYPE_LABELS|hasContentFields|CONTENTLESS|DEFAULT_SIZE_BY_TYPE|defaultBlockForType" frontend/src mobile/src packages/shared/src
```
Expected:
- All three suites pass.
- `rg` prints nothing, except possibly `frontend/README.md`, which is outside these paths.
- If `frontend/scripts/test-murals.mts` asserts currentlyReading's old `h: 4`, update that assertion to `6`. That change is the fix, not a regression.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/murals/blockKinds.ts packages/shared/src/murals/blockKinds.test.ts packages/shared/src/murals/murals.ts frontend/src/components/murals/AddBlockMenu.tsx frontend/src/components/murals/BlockConfigPanel.tsx frontend/src/pages/MuralEditorPage.tsx frontend/src/components/murals/MobileMuralCanvas.tsx frontend/scripts/test-murals.mts mobile/src/features/murals/BlockSheet.tsx mobile/src/features/murals/MuralCanvas.tsx mobile/src/features/murals/MuralEditorScreen.tsx mobile/src/features/murals/ContentTab.tsx && git commit -m "$(cat <<'EOF'
Keep each mural block type's fixed facts in one shared table

Label, default size, minimum height, default content and whether a
block has anything to configure were spread over shared, web and mobile,
and the copies disagreed: the web compact canvas offered Configure on a
reader card, and a new currently-reading block started below its own
minimum height.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Book references and re-keying move from the backend into the table

This task adds `valid`, `references` and `rekey` columns. It replaces backend `extractReferences` and `rekeyBlocks` with shared `blockReferences` and `rekeyBlocks`, and deletes the dead inline tier-list handling.

**Files:**
- Modify: `packages/shared/src/murals/blockKinds.ts`
- Modify: `packages/shared/src/murals/blockKinds.test.ts`
- Modify: `backend/src/modules/murals/routes.ts:29,124,302-304`
- Modify: `backend/src/modules/murals/worksSweep.ts:4,27`
- Modify: `backend/src/modules/murals/domain/publicPayload.ts:7,25`
- Modify: `backend/src/modules/murals/adapters/sqlite/sqliteMuralsRepository.ts:6,98`
- Modify: `backend/src/modules/murals/service.ts:71` (comment only)
- Modify: `backend/package.json:17`. Remove `src/modules/murals/domain/rekeyBlocks.test.ts` from the `test` list.
- Modify: `backend/README.md:115`
- Delete: `backend/src/modules/murals/domain/blockRefs.ts`, `backend/src/modules/murals/domain/rekeyBlocks.ts`, `backend/src/modules/murals/domain/rekeyBlocks.test.ts`

**Interfaces:**
- Consumes: `KINDS`, `Kind<T>` and `BLOCK_TYPES` from Task 1.
- Produces, exported from `@scripta/shared`:
  - `interface BlockReferences { bookKeys: Set<string>; collectionIds: Set<string>; highlightRefs: Array<{ bookKey: string; highlightId: string }>; imageIds: Set<string>; needsCurrentlyReading: boolean; statsMetrics: Set<string>; needsShelfTheme: boolean; needsReaderCard: boolean }`
  - `blockReferences(blocks: unknown): BlockReferences`
  - `rekeyBlocks(blocks: unknown, from: ReadonlySet<string>, to: string): unknown`
- Produces, internal to `blockKinds.ts` and used by Tasks 3–4: `kindOf(block: MuralBlock): Kind<BlockType>`.

- [ ] **Step 1: Write the failing tests**

Append to `blockKinds.test.ts`, and add `blockReferences` and `rekeyBlocks` to its `./murals.js` import:

```ts
test("blockReferences collects what each block type points at", () => {
  const refs = blockReferences([
    { id: "1", type: "spotlight", bookKey: "a" },
    { id: "2", type: "shelf", title: "", bookKeys: ["b", "", 3] },
    { id: "3", type: "shelf", title: "", bookKeys: ["ignored"], collectionId: "g1" },
    { id: "4", type: "quote", bookKey: "c", highlightId: "h1" },
    { id: "5", type: "quote", bookKey: "", highlightId: "", mode: "rediscover" },
    { id: "6", type: "quoteCollection", title: "", quotes: [{ bookKey: "d", highlightId: "h2" }, { bookKey: "e" }, null] },
    { id: "7", type: "image", imageId: "img" },
    { id: "8", type: "image", imageId: "" },
    { id: "9", type: "stats", metrics: ["totalBooks", 4] },
    { id: "10", type: "currentlyReading" },
    { id: "11", type: "profile", bio: "", favoriteGenres: [] },
    { id: "12", type: "readerCard" },
    { id: "13", type: "tierlist", tierlistId: "t" },
    { id: "14", type: "text" },
    { id: "15", type: "empty" }
  ]);
  assert.deepEqual([...refs.bookKeys], ["a", "b", "c", "d", "e"]);
  assert.deepEqual([...refs.collectionIds], ["g1"]);
  assert.deepEqual(refs.highlightRefs, [{ bookKey: "c", highlightId: "h1" }, { bookKey: "d", highlightId: "h2" }]);
  assert.deepEqual([...refs.imageIds], ["img"]);
  assert.deepEqual([...refs.statsMetrics], ["totalBooks"]);
  assert.equal(refs.needsCurrentlyReading, true);
  assert.equal(refs.needsShelfTheme, true);
  assert.equal(refs.needsReaderCard, true);
});

test("blockReferences skips anything it doesn't recognise and never throws", () => {
  const none = blockReferences([]);
  assert.deepEqual(blockReferences("nope"), none);
  assert.deepEqual(blockReferences(null), none);
  assert.deepEqual(blockReferences([
    null, 3, "x", [], { type: 7 }, { type: "toString" }, { type: "constructor" }, { type: "hologram", bookKey: "z" },
    { type: "spotlight", bookKey: 5 }, { type: "shelf", bookKeys: "a" }, { type: "quoteCollection", quotes: {} }, { type: "stats", metrics: "x" }
  ]), none);
});

test("a tier list block contributes no book keys, whatever extra fields it carries", () => {
  const refs = blockReferences([{ id: "1", type: "tierlist", tierlistId: "t", tiers: [{ id: "s", bookKeys: ["old"] }], pool: ["p"] }]);
  assert.equal(refs.bookKeys.size, 0);
});

const from = new Set(["old"]);

test("rekeyBlocks rewrites every book reference a block can hold and de-duplicates", () => {
  const blocks = [
    { id: "1", type: "spotlight", bookKey: "old" },
    { id: "2", type: "shelf", title: "", bookKeys: ["old", "new", "x"] },
    { id: "3", type: "quote", bookKey: "old", highlightId: "h1" },
    { id: "4", type: "quoteCollection", title: "", quotes: [{ bookKey: "old", highlightId: "h1" }, { bookKey: "new", highlightId: "h1" }, { bookKey: "x", highlightId: "h2" }] },
    { id: "5", type: "tierlist", tierlistId: "t" },
    { id: "6", type: "text", body: "old" }
  ];
  assert.deepEqual(rekeyBlocks(blocks, from, "new"), [
    { id: "1", type: "spotlight", bookKey: "new" },
    { id: "2", type: "shelf", title: "", bookKeys: ["new", "x"] },
    { id: "3", type: "quote", bookKey: "new", highlightId: "h1" },
    { id: "4", type: "quoteCollection", title: "", quotes: [{ bookKey: "new", highlightId: "h1" }, { bookKey: "x", highlightId: "h2" }] },
    { id: "5", type: "tierlist", tierlistId: "t" },
    { id: "6", type: "text", body: "old" }
  ]);
});

test("rekeyBlocks passes anything it doesn't recognise through untouched", () => {
  assert.equal(rekeyBlocks("nope", from, "new"), "nope");
  const odd = [null, 3, { type: "toString" }, { type: "hologram", bookKey: "old" }, { type: "spotlight", bookKey: 5 }, { type: "shelf", bookKeys: "old" }];
  assert.deepEqual(rekeyBlocks(odd, from, "new"), odd);
  const inlineTiers = [{ id: "1", type: "tierlist", tierlistId: "t", tiers: [{ id: "s", bookKeys: ["old"] }], pool: ["old"] }];
  assert.deepEqual(rekeyBlocks(inlineTiers, from, "new"), inlineTiers);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace packages/shared`
Expected: FAIL. `blockReferences` and `rekeyBlocks` are not exported.

- [ ] **Step 3: Add the columns and functions to `blockKinds.ts`**

1. Change the first import line to:
   ```ts
   import { rekeyKeys } from "../library/dedupe.js";
   import type { BlockLayout, BlockType, MuralBlock } from "./murals.js";
   ```
2. Add these above `interface Kind`:
   ```ts
   export interface BlockReferences {
     bookKeys: Set<string>;
     collectionIds: Set<string>;
     highlightRefs: Array<{ bookKey: string; highlightId: string }>;
     imageIds: Set<string>;
     needsCurrentlyReading: boolean;
     statsMetrics: Set<string>;
     needsShelfTheme: boolean;
     needsReaderCard: boolean;
   }

   type Block<T extends BlockType> = Extract<MuralBlock, { type: T }>;

   function isRecord(value: unknown): value is Record<string, unknown> {
     return typeof value === "object" && value !== null && !Array.isArray(value);
   }

   function nonEmpty(value: unknown): value is string {
     return typeof value === "string" && value.length > 0;
   }

   function addStrings(target: Set<string>, values: readonly unknown[]) {
     for (const value of values) if (nonEmpty(value)) target.add(value);
   }

   function addQuote(refs: BlockReferences, quote: unknown) {
     if (!isRecord(quote) || !nonEmpty(quote.bookKey)) return;
     refs.bookKeys.add(quote.bookKey);
     if (nonEmpty(quote.highlightId)) refs.highlightRefs.push({ bookKey: quote.bookKey, highlightId: quote.highlightId });
   }

   function rekeyQuotes(quotes: readonly unknown[], from: ReadonlySet<string>, to: string): unknown[] {
     const seen = new Set<string>();
     return quotes.flatMap((quote) => {
       if (!isRecord(quote)) return [quote];
       const next = typeof quote.bookKey === "string" && from.has(quote.bookKey) ? { ...quote, bookKey: to } : quote;
       const id = `${String(next.bookKey)}\u0000${String(next.highlightId)}`;
       if (seen.has(id)) return [];
       seen.add(id);
       return [next];
     });
   }

   const always = () => true;
   const nothing = () => {};
   const same = <B>(block: B) => block;
   ```
3. Extend `Kind<T>`. Keep method syntax:
   ```ts
   interface Kind<T extends BlockType> {
     label: string;
     size: { w: number; h: number };
     minHeight: number;
     configurable: boolean;
     content(): Content<T>;
     valid(block: Record<string, unknown>): boolean;
     references(block: Block<T>, refs: BlockReferences): void;
     rekey(block: Block<T>, from: ReadonlySet<string>, to: string): Block<T>;
   }
   ```
4. Add these properties to each `KINDS` entry, keeping the Task 1 properties:
   ```ts
   spotlight: { …, valid: (b) => typeof b.bookKey === "string",
     references: (b, refs) => { if (nonEmpty(b.bookKey)) refs.bookKeys.add(b.bookKey); },
     rekey: (b, from, to) => (from.has(b.bookKey) ? { ...b, bookKey: to } : b) },
   shelf: { …, valid: (b) => Array.isArray(b.bookKeys),
     references: (b, refs) => { if (nonEmpty(b.collectionId)) refs.collectionIds.add(b.collectionId); else addStrings(refs.bookKeys, b.bookKeys); },
     rekey: (b, from, to) => ({ ...b, bookKeys: rekeyKeys(b.bookKeys, from, to) }) },
   quote: { …, valid: (b) => typeof b.bookKey === "string",
     references: (b, refs) => { if (b.mode !== "rediscover") addQuote(refs, b); },
     rekey: (b, from, to) => (from.has(b.bookKey) ? { ...b, bookKey: to } : b) },
   quoteCollection: { …, valid: (b) => Array.isArray(b.quotes),
     references: (b, refs) => { for (const quote of b.quotes) addQuote(refs, quote); },
     rekey: (b, from, to) => ({ ...b, quotes: rekeyQuotes(b.quotes, from, to) as typeof b.quotes }) },
   image: { …, valid: (b) => typeof b.imageId === "string",
     references: (b, refs) => { if (nonEmpty(b.imageId)) refs.imageIds.add(b.imageId); }, rekey: same },
   text: { …, valid: always, references: nothing, rekey: same },
   profile: { …, valid: always, references: (_b, refs) => { refs.needsShelfTheme = true; }, rekey: same },
   currentlyReading: { …, valid: always, references: (_b, refs) => { refs.needsCurrentlyReading = true; }, rekey: same },
   stats: { …, valid: (b) => Array.isArray(b.metrics),
     references: (b, refs) => addStrings(refs.statsMetrics, b.metrics), rekey: same },
   empty: { …, valid: always, references: nothing, rekey: same },
   tierlist: { …, valid: always, references: nothing, rekey: same },
   readerCard: { …, valid: always, references: (_b, refs) => { refs.needsReaderCard = true; }, rekey: same }
   ```
   Write each entry out in full. The `…` above stands for that entry's Task 1 properties, which stay as they are.
5. Add these below `newBlock`:
   ```ts
   function kindOf(block: MuralBlock): Kind<BlockType> {
     return KINDS[block.type] as Kind<BlockType>;
   }

   function known(value: unknown): MuralBlock | undefined {
     if (!isRecord(value) || !BLOCK_TYPES.includes(value.type as BlockType)) return undefined;
     return KINDS[value.type as BlockType].valid(value) ? (value as MuralBlock) : undefined;
   }

   export function blockReferences(blocks: unknown): BlockReferences {
     const refs: BlockReferences = {
       bookKeys: new Set(),
       collectionIds: new Set(),
       highlightRefs: [],
       imageIds: new Set(),
       needsCurrentlyReading: false,
       statsMetrics: new Set(),
       needsShelfTheme: false,
       needsReaderCard: false
     };
     if (!Array.isArray(blocks)) return refs;
     for (const value of blocks) {
       const block = known(value);
       if (block) kindOf(block).references(block, refs);
     }
     return refs;
   }

   export function rekeyBlocks(blocks: unknown, from: ReadonlySet<string>, to: string): unknown {
     if (!Array.isArray(blocks)) return blocks;
     return blocks.map((value) => {
       const block = known(value);
       return block ? kindOf(block).rekey(block, from, to) : value;
     });
   }
   ```
   `BLOCK_TYPES.includes` is the guard against `"toString"`. Don't replace it with `value.type in KINDS`.

   If `tsc` rejects the `as Kind<BlockType>` cast in `kindOf`, use `as unknown as Kind<BlockType>`. That is the only cast this file should need beyond the one in `newBlock`.

- [ ] **Step 4: Run the shared tests and build**

Run: `npm test --workspace packages/shared && npm run build --workspace packages/shared`
Expected: all tests pass and the build is clean.

- [ ] **Step 5: Point the backend at the shared functions**

- `routes.ts:29` → delete the `./domain/blockRefs.js` import and add `blockReferences` to an `@scripta/shared` import. At :124, use `[...blockReferences(blocks).bookKeys]`. In the comment at :302-304, replace `extractReferences` with `blockReferences` and drop the `murals/domain/blockRefs.ts` file reference.
- `worksSweep.ts:4,27` → the same swap: `[...blockReferences(JSON.parse(mural.blocks)).bookKeys]`.
- `publicPayload.ts:7,25` → add `blockReferences` to the existing `@scripta/shared` import on line 1, delete line 7, and use `const refs = blockReferences(blocks);`.
- `sqliteMuralsRepository.ts:6` → `import { rekeyBlocks } from "@scripta/shared";`
- `service.ts:71` → in the comment, `extractReferences` becomes `blockReferences`.
- `backend/package.json:17` → remove the `src/modules/murals/domain/rekeyBlocks.test.ts ` entry from the `test` string.
- `backend/README.md:115` → change `its spotlight, shelf, quote, quote-collection and legacy tier-list blocks reference (\`extractReferences\`)` to `its spotlight, shelf, quote and quote-collection blocks reference (\`blockReferences\` in \`@scripta/shared\`)`.
- Delete the three files:
  ```bash
  git rm backend/src/modules/murals/domain/blockRefs.ts backend/src/modules/murals/domain/rekeyBlocks.ts backend/src/modules/murals/domain/rekeyBlocks.test.ts
  ```

- [ ] **Step 6: Run the backend checks**

Run:
```bash
npm run typecheck --workspace backend && npm test --workspace backend
```
```bash
rg -n "extractReferences|blockRefs|domain/rekeyBlocks" backend
```
Expected:
- typecheck is clean.
- All backend tests pass. That includes `murals/routes.test.ts`, `murals/worksSweep.test.ts`, `murals/home.test.ts` and `murals/service.test.ts`, which prove `mural_works` and the public payload did not move.
- `rg` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/murals/blockKinds.ts packages/shared/src/murals/blockKinds.test.ts backend/src/modules/murals/routes.ts backend/src/modules/murals/worksSweep.ts backend/src/modules/murals/domain/publicPayload.ts backend/src/modules/murals/adapters/sqlite/sqliteMuralsRepository.ts backend/src/modules/murals/service.ts backend/package.json backend/README.md && git commit -m "$(cat <<'EOF'
Read mural book references and rekey blocks through the shared table

The backend kept its own hand copy of the block union for the public
page, the works index and library merges. Both now dispatch per block
kind in @scripta/shared, so a new block type cannot be missed there.
Rekey is no longer type-blind: only spotlight, shelf, quote and quote
collection blocks hold book keys. The inline tier-list shape has been
dead since 2026-09-04 and is gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

The `git rm` from Step 5 is already staged, so the deletions land in this commit.

---

### Task 3: Scrubbing deleted books goes through the table

This task adds the `scrub` column, moves `scrubBooksFromMurals` into `blockKinds.ts`, and moves its tests from the frontend script into shared.

**Files:**
- Modify: `packages/shared/src/murals/blockKinds.ts`
- Modify: `packages/shared/src/murals/murals.ts`. Delete `scrubBooksFromMurals` (:497-526) and keep `scrubImageFromMurals`.
- Modify: `packages/shared/src/murals/blockKinds.test.ts`
- Modify: `frontend/scripts/test-murals.mts`. Delete sections 9, 10, 11, 13 and 18, drop `scrubBooksFromMurals` from the import, and renumber nothing.
- Modify: `frontend/README.md:274,302`

**Interfaces:**
- Consumes: `kindOf` and `Kind<T>` from Task 2.
- Produces: `scrubBooksFromMurals(murals: Mural[], keys: Iterable<string>): Mural[]`. The signature and behaviour are unchanged, and it is still exported from `@scripta/shared` and `frontend/src/lib/murals`.

- [ ] **Step 1: Write the tests**

Append to `blockKinds.test.ts`, and add `scrubBooksFromMurals` and `type Mural` to the `./murals.js` import:

```ts
const at = { x: 0, y: 0, w: 1, h: 1 };
const muralOf = (blocks: MuralBlock[]): Mural[] => [{ id: "m1", name: "M", theme: "light", blocks, createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null }];

test("scrub removes a spotlight or quote that points at a deleted book", () => {
  const [mural] = scrubBooksFromMurals(muralOf([
    { id: "b1", type: "spotlight", layout: at, bookKey: "gone" },
    { id: "b2", type: "quote", layout: at, bookKey: "gone", highlightId: "h1" },
    { id: "b3", type: "spotlight", layout: at, bookKey: "kept" }
  ]), ["gone"]);
  assert.deepEqual(mural.blocks.map((b) => b.id), ["b3"]);
});

test("scrub trims shelf and quote collection members and drops them only once empty", () => {
  const [mural] = scrubBooksFromMurals(muralOf([
    { id: "s1", type: "shelf", layout: { x: 2, y: 5, w: 8, h: 3 }, title: "Top", bookKeys: ["gone", "a", "b"] },
    { id: "s2", type: "shelf", layout: at, title: "One", bookKeys: ["gone"] },
    { id: "q1", type: "quoteCollection", layout: at, title: "Q", quotes: [{ bookKey: "gone", highlightId: "h1" }, { bookKey: "a", highlightId: "h2" }] }
  ]), ["gone"]);
  const shelf = mural.blocks.find((b) => b.id === "s1") as Extract<MuralBlock, { type: "shelf" }>;
  const quotes = mural.blocks.find((b) => b.id === "q1") as Extract<MuralBlock, { type: "quoteCollection" }>;
  assert.deepEqual(shelf.bookKeys, ["a", "b"]);
  assert.deepEqual(shelf.layout, { x: 2, y: 5, w: 8, h: 3 });
  assert.equal(mural.blocks.some((b) => b.id === "s2"), false);
  assert.deepEqual(quotes.quotes, [{ bookKey: "a", highlightId: "h2" }]);
});

test("scrub leaves survivors at their authored coordinates", () => {
  const [mural] = scrubBooksFromMurals(muralOf([
    { id: "spot", type: "spotlight", layout: { x: 0, y: 0, w: 4, h: 3 }, bookKey: "gone" },
    { id: "shelf", type: "shelf", layout: { x: 0, y: 3, w: 8, h: 3 }, title: "S", bookKeys: ["gone", "a"] }
  ]), ["gone"]);
  assert.deepEqual(mural.blocks.map((b) => [b.id, b.layout.y]), [["shelf", 3]]);
});

test("scrub never touches a collection shelf, a rediscover quote or a tier list", () => {
  const blocks: MuralBlock[] = [
    { id: "c", type: "shelf", layout: at, title: "", bookKeys: ["gone"], collectionId: "g" },
    { id: "r", type: "quote", layout: at, bookKey: "", highlightId: "", mode: "rediscover" },
    { id: "t", type: "tierlist", layout: at, tierlistId: "list" }
  ];
  const murals = muralOf(blocks);
  assert.equal(scrubBooksFromMurals(murals, ["gone", ""]), murals);
});

test("scrub returns the same array when nothing is affected or no keys are given", () => {
  const murals = muralOf([{ id: "b", type: "spotlight", layout: at, bookKey: "kept" }]);
  assert.equal(scrubBooksFromMurals(murals, ["other"]), murals);
  assert.equal(scrubBooksFromMurals(murals, []), murals);
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test --workspace packages/shared`
Expected: PASS. These tests pin today's behaviour, which the old `scrubBooksFromMurals` already has. They must pass before the move and after it.

- [ ] **Step 3: Add the `scrub` column and move the function**

1. In `blockKinds.ts`, change the type import to `import type { BlockLayout, BlockType, Mural, MuralBlock } from "./murals.js";`.
2. Add `scrub(block: Block<T>, keys: ReadonlySet<string>): Block<T> | null;` to `Kind<T>`.
3. Add these to each `KINDS` entry:
   ```ts
   spotlight: { …, scrub: (b, keys) => (keys.has(b.bookKey) ? null : b) },
   shelf: { …, scrub: (b, keys) => {
     if (b.collectionId) return b;
     const bookKeys = b.bookKeys.filter((key) => !keys.has(key));
     if (bookKeys.length === b.bookKeys.length) return b;
     return bookKeys.length ? { ...b, bookKeys } : null;
   } },
   quote: { …, scrub: (b, keys) => (b.mode !== "rediscover" && keys.has(b.bookKey) ? null : b) },
   quoteCollection: { …, scrub: (b, keys) => {
     const quotes = b.quotes.filter((quote) => !keys.has(quote.bookKey));
     if (quotes.length === b.quotes.length) return b;
     return quotes.length ? { ...b, quotes } : null;
   } },
   image: { …, scrub: same }, text: { …, scrub: same }, profile: { …, scrub: same }, currentlyReading: { …, scrub: same },
   stats: { …, scrub: same }, empty: { …, scrub: same }, tierlist: { …, scrub: same }, readerCard: { …, scrub: same }
   ```
4. Move `scrubBooksFromMurals` from `murals.ts` to `blockKinds.ts`, with its existing doc comment, and rewrite its body to:
   ```ts
   export function scrubBooksFromMurals(murals: Mural[], keys: Iterable<string>): Mural[] {
     const keySet = keys instanceof Set ? keys : new Set(keys);
     if (keySet.size === 0) return murals;
     let changed = false;
     const result = murals.map((m) => {
       const blocks = m.blocks.flatMap((b) => {
         const next = kindOf(b).scrub(b, keySet);
         return next ? [next] : [];
       });
       if (blocks.length === m.blocks.length && blocks.every((b, i) => b === m.blocks[i])) return m;
       changed = true;
       return { ...m, blocks, updatedAt: new Date().toISOString() };
     });
     return changed ? result : murals;
   }
   ```
5. In `frontend/scripts/test-murals.mts`, delete the blocks under the `console.log` headers for sections 9, 10, 11, 13 and 18, each header plus its `{ … }` block. Remove `scrubBooksFromMurals` from the import list at the top.
6. In `frontend/README.md`:
   - Line 274: replace the parenthetical `; \`scrubBooksFromMurals\`'s new \`tierlist\` case — … a book no tier references is a true no-op` (up to the closing `)`) with `)`.
   - Line 302: replace the whole paragraph with `A tier-list block stores only \`tierlistId\`, so \`scrubBooksFromMurals\` never touches it; deleting a book from the library leaves tier lists to the tier lists module.`

- [ ] **Step 4: Run the checks**

Run:
```bash
npm test --workspace packages/shared && npm run build --workspace packages/shared
```
```bash
npm run typecheck --workspace frontend && npm test --workspace frontend
```
```bash
npm run typecheck --workspace mobile && npm test --workspace mobile
```
Expected: all pass. `mobile/src/features/murals/home.test.ts:46` (the scrub no-op) still passes.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/murals/blockKinds.ts packages/shared/src/murals/blockKinds.test.ts packages/shared/src/murals/murals.ts frontend/scripts/test-murals.mts frontend/README.md && git commit -m "$(cat <<'EOF'
Scrub deleted books from murals through the shared block table

The scrub tests lived in a frontend script although the function is
shared; they move next to it and now pin that a collection shelf, a
rediscover quote and a tier list survive a book deletion untouched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: One lookup for the books a block draws

This task adds the `draws` column and exports `blockBooks`. It replaces the per-client copies of "currently reading means `ReadStatus === 1`", "a shelf resolves its keys" and "a tier list resolves work ids". One fix lands here: the web metadata prefetch now includes quote and quoteCollection books.

**Files:**
- Modify: `packages/shared/src/murals/blockKinds.ts`
- Modify: `packages/shared/src/murals/murals.ts`. Move `resolveShelfBooks` (:563-572) into `blockKinds.ts`.
- Modify: `packages/shared/src/murals/blockKinds.test.ts`
- Modify: `frontend/src/hooks/useMuralBookMetadata.ts:1-38`
- Modify: `frontend/scripts/test-book-metadata.mts:10-28`
- Modify: `frontend/src/components/murals/blocks/BookBlocks.tsx:120-122` (`CurrentlyReadingBlockView`)
- Modify: `frontend/src/components/murals/BlockRenderer.tsx:65`
- Modify: `frontend/src/components/murals/MobileBlockPreview.tsx:89-99`
- Modify: `frontend/src/components/murals/MuralBlockDetail.tsx:103-106`
- Modify: `mobile/src/features/murals/MuralCanvas.tsx:193,199,205,470-471`

**Interfaces:**
- Consumes: `kindOf`, `Kind<T>` and `Block<T>` from Task 2.
- Produces, exported from `@scripta/shared` and `frontend/src/lib/murals`:
  - `type TierlistLookup = (tierlistId: string) => Pick<TierlistData, "tiers" | "pool"> | undefined`
  - `blockBooks(block: MuralBlock, books: Array<Record<string, unknown>>, tierlist?: TierlistLookup): Array<Record<string, unknown>>`. It expects a block already passed through `resolveHomeBlock`. It returns each book once, in draw order.
  - `resolveShelfBooks`: unchanged, and now lives in `blockKinds.ts`.

- [ ] **Step 1: Write the failing test**

Append to `blockKinds.test.ts`, and add `blockBooks` to the `./murals.js` import:

```ts
test("blockBooks returns the books each block draws, each once, in draw order", () => {
  const books = ["A", "B", "C", "D"].map((Title, i) => ({ Title, Attribution: "X", ReadStatus: i === 2 ? 1 : 0, _workId: `w${i}`, highlights: [] }));
  const key = (i: number) => bookKey(books[i]);
  assert.deepEqual(blockBooks(make("spotlight", { bookKey: key(1) }), books), [books[1]]);
  assert.deepEqual(blockBooks(make("spotlight", { bookKey: "missing" }), books), []);
  assert.deepEqual(blockBooks(make("shelf", { bookKeys: [key(3), "missing", key(0)] }), books), [books[3], books[0]]);
  assert.deepEqual(blockBooks(make("quote", { bookKey: key(0), highlightId: "h" }), books), [books[0]]);
  assert.deepEqual(blockBooks(make("quoteCollection", { quotes: [{ bookKey: key(1), highlightId: "1" }, { bookKey: key(1), highlightId: "2" }, { bookKey: key(3), highlightId: "3" }] }), books), [books[1], books[3]]);
  assert.deepEqual(blockBooks(make("currentlyReading"), books), [books[2]]);
  const tiers = () => ({ tiers: [{ id: "s", label: "S", color: "red", workIds: ["w3", "missing"] }], pool: ["w0", "w3"] });
  assert.deepEqual(blockBooks(make("tierlist", { tierlistId: "t" }), books, tiers), [books[3], books[0]]);
  assert.deepEqual(blockBooks(make("tierlist", { tierlistId: "t" }), books, () => undefined), []);
  assert.deepEqual(blockBooks(make("tierlist", { tierlistId: "t" }), books), []);
  for (const type of ["image", "text", "profile", "stats", "empty", "readerCard"] as const) assert.deepEqual(blockBooks(make(type), books), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace packages/shared`
Expected: FAIL. `blockBooks` is not exported.

- [ ] **Step 3: Add the `draws` column and `blockBooks`**

1. Add these imports at the top of `blockKinds.ts`:
   ```ts
   import { bookKey } from "../library/merge.js";
   import { booksByWork } from "../library/works.js";
   import type { TierlistData } from "../tierlists/types.js";
   ```
2. Add these below the helpers:
   ```ts
   type Book = Record<string, unknown>;
   export type TierlistLookup = (tierlistId: string) => Pick<TierlistData, "tiers" | "pool"> | undefined;

   function byKeys(keys: readonly string[], books: Book[]): Book[] {
     const byKey = new Map(books.map((book) => [bookKey(book), book] as const));
     return [...new Set(keys)].flatMap((key) => byKey.get(key) ?? []);
   }

   const noBooks = (): Book[] => [];
   ```
3. Move `resolveShelfBooks` from `murals.ts` into `blockKinds.ts` with its doc comment. Make its body `return byKeys(block.bookKeys, books);`.

   Note that `byKeys` dedupes, and the old body did not. A shelf holding the same key twice now draws the book once, which is fine.
4. Add `draws(block: Block<T>, books: Book[], tierlist?: TierlistLookup): Book[];` to `Kind<T>`, and add these to each `KINDS` entry:
   ```ts
   spotlight: { …, draws: (b, books) => byKeys([b.bookKey], books) },
   shelf: { …, draws: (b, books) => resolveShelfBooks(b, books) },
   quote: { …, draws: (b, books) => byKeys([b.bookKey], books) },
   quoteCollection: { …, draws: (b, books) => byKeys(b.quotes.map((quote) => quote.bookKey), books) },
   currentlyReading: { …, draws: (_b, books) => books.filter((book) => book.ReadStatus === 1) },
   tierlist: { …, draws: (b, books, tierlist) => {
     const data = tierlist?.(b.tierlistId);
     if (!data) return [];
     const byWork = booksByWork(books);
     return [...new Set([...data.tiers.flatMap((tier) => tier.workIds), ...data.pool])].flatMap((id) => byWork.get(id) ?? []);
   } },
   image: { …, draws: noBooks }, text: { …, draws: noBooks }, profile: { …, draws: noBooks },
   stats: { …, draws: noBooks }, empty: { …, draws: noBooks }, readerCard: { …, draws: noBooks }
   ```
5. Add the export:
   ```ts
   export function blockBooks(block: MuralBlock, books: Book[], tierlist?: TierlistLookup): Book[] {
     return kindOf(block).draws(block, books, tierlist);
   }
   ```
6. Delete `resolveShelfBooks` from `murals.ts`. It is still exported through `export * from "./blockKinds.js"`. Remove `bookKey` from the `murals.ts` imports only if nothing else there uses it, which `muralBlockTitle` and `resolveQuote` do.

- [ ] **Step 4: Run the shared tests and build**

Run: `npm test --workspace packages/shared && npm run build --workspace packages/shared`
Expected: all tests pass and the build is clean.

- [ ] **Step 5: Update the metadata prefetch test for the quote fix**

In `frontend/scripts/test-book-metadata.mts`, add a quote block to `blocks` and extend both expectations:

```ts
  const blocks = [
    { ...makeBlock("spotlight"), type: "spotlight" as const, bookKey: bookKey(books[0]) },
    { ...makeBlock("shelf"), type: "shelf" as const, title: "Shelf", bookKeys: [bookKey(books[1]), bookKey(books[0]), "missing"] },
    makeBlock("currentlyReading"),
    { ...makeBlock("tierlist"), type: "tierlist" as const, tierlistId: "tiers" },
    { ...makeBlock("quoteCollection"), type: "quoteCollection" as const, title: "Q", quotes: [{ bookKey: bookKey(books[5]), highlightId: "h" }, { bookKey: bookKey(books[0]), highlightId: "h2" }] }
  ];
  assert.deepEqual(muralMetadataBooks(blocks, books).map((book) => book.Title), ["Spotlight", "Shelf", "Reading", "Unrelated"]);
  assert.deepEqual(muralMetadataBooks(blocks, books, () => ({
    name: "Tiers", tiers: [{ id: "tier", label: "A", color: "red", workIds: ["work-3"] }], pool: ["work-4"]
  })).map((book) => book.Title), ["Spotlight", "Shelf", "Reading", "Ranked", "Pool", "Unrelated"]);
```

Rename the test to `"mural preloads select only referenced books, quotes included, each once"`.

Run: `npm test --workspace frontend`
Expected: FAIL on this test, because the prefetch still skips quotes.

- [ ] **Step 6: Route the web callers through `blockBooks`**

- `useMuralBookMetadata.ts`:
  - Replace the `muralMetadataBooks` body:
    ```ts
    export function muralMetadataBooks(
      blocks: MuralBlock[],
      books: Array<Record<string, unknown>>,
      tierlistData?: (id: string) => ResolvedTierlist | undefined
    ) {
      return [...new Set(blocks.flatMap((block) => blockBooks(block, books, tierlistData)))];
    }
    ```
  - Change the imports to `import { blockBooks, type MuralBlock } from "../lib/murals";`.
  - Drop `booksByWork` and `bookKey`.
- `BookBlocks.tsx:120-122`:
  - Change the signature to `CurrentlyReadingBlockView({ block, books }: { block: Extract<MuralBlock, { type: "currentlyReading" }>; books: Array<Record<string, unknown>> })` and the body line to `const reading = blockBooks(block, books);`.
  - Import `blockBooks` from `../../../lib/murals`.
  - Reword the doc comment at :120 to `/** Auto-computed, no picker at all — whatever blockBooks says is being read. */`.
- `BlockRenderer.tsx:65` → `return <CurrentlyReadingBlockView block={block} books={books} />;`
- `MobileBlockPreview.tsx:89-99`: replace the `tierlist`/`byWork`/`resolved` lines with `const resolved = blockBooks(block, books, tierlistData);`. Import `blockBooks` from `../../lib/murals`. Drop `booksByWork` from the `@scripta/shared` import and `resolveShelfBooks` from the `lib/murals` import if they are now unused.

  The tier-list preview now also shows the pool after the ranked tiers. That is intended: every other caller already treats the pool as part of a tier list.
- `MuralBlockDetail.tsx:103-106`: replace `resolveShelfBooks(block, books)` and `books.filter((item) => item.ReadStatus === 1)` with `blockBooks(block, books)`. Leave the tier-list grouping (titled per tier) as it is, since that is UI. Import `blockBooks`, and drop `resolveShelfBooks` from the import if it's unused.

- [ ] **Step 7: Route the mobile callers through `blockBooks`**

In `mobile/src/features/murals/MuralCanvas.tsx`, import `blockBooks` from `@scripta/shared`. Drop `resolveShelfBooks` if it's unused afterwards. Then:
- :193 → `const reading = blockBooks(block, books);`
- :199 → `const selected = blockBooks(block, books);`
- :205 → `const selected = blockBooks(block, books);`
- :471 → `const selected = blockBooks(block, books);`, keeping the guard on :470 and the `slice(0, 3)` on :472.

- [ ] **Step 8: Run every check**

Run:
```bash
npm test --workspace frontend && npm run typecheck --workspace frontend && npm run lint --workspace frontend
```
```bash
npm run typecheck --workspace mobile && npm test --workspace mobile
```
```bash
npm run typecheck --workspace backend && npm test --workspace backend
```
```bash
rg -n "ReadStatus === 1" frontend/src/components/murals frontend/src/hooks mobile/src/features/murals
```
Expected:
- All suites pass, including the updated metadata test.
- `rg` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/murals/blockKinds.ts packages/shared/src/murals/blockKinds.test.ts packages/shared/src/murals/murals.ts frontend/src/hooks/useMuralBookMetadata.ts frontend/scripts/test-book-metadata.mts frontend/src/components/murals/blocks/BookBlocks.tsx frontend/src/components/murals/BlockRenderer.tsx frontend/src/components/murals/MobileBlockPreview.tsx frontend/src/components/murals/MuralBlockDetail.tsx mobile/src/features/murals/MuralCanvas.tsx && git commit -m "$(cat <<'EOF'
Find the books a mural block draws in one shared place

Web and mobile each worked out a block's books in about six places,
from the canvas to the detail sheet to the metadata prefetch, and the
prefetch skipped quote blocks, so their book details loaded late.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## After all four tasks

- Run `branch-reviewer` once against this plan and the spec.
- Then use the `ship` skill to open the PR.
- A device pass is optional. The only visible mobile change is a new currentlyReading block's height, and a tier-list preview on the web compact canvas now shows pooled books.
