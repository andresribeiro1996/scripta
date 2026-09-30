# My shelf PR 4: presets and the My shelf preset. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader who opens My shelf with no shelf sees one already made from their books, and can keep it or start blank. Every preset is in English, never produces help-text blocks or empty blocks, and pickers explain why a preset is unavailable instead of creating an empty mural.

**Architecture:** All preset logic lives in `@scripta/shared/murals/presets.ts`: the preset list, `buildMuralPreset`, a new `presetAvailability`, and a new `shelfPresetSummary`. Shelf blocks gain an optional `role` that PR 5 uses to find the Finished and Favourites shelves. Both clients render the first-visit preview with their existing `MuralCanvas` and save it through their existing `useMurals` hooks and PR 3's `setShelfMural`.

**Tech Stack:** `@scripta/shared` (TypeScript, `node:test` via tsx), Expo Router + TanStack Query (mobile), React + React Router + Tailwind (web), Fastify `node:test` (backend, one test).

**Spec:** `docs/superpowers/specs/2026-09-25-my-shelf-release-1-design.md`, section "4. Presets and the My shelf preset".

**Base:** PR 3 (`feat/my-shelf-tab`, #30). Start this branch from `origin/main` after #30 merges. If #30 hasn't merged yet, branch from `origin/feat/my-shelf-tab` and rebase onto main once it lands.

## Global Constraints

- No code comments; the why goes in commit messages.
- Minimum code. Reuse `MuralCanvas`, `EmptyState`, `Button`, `Sheet`, `Toast`, the `useMurals` hooks, and `setShelfMural`/`fetchOwnProfile`. No new packages.
- Preset rules, from the spec: (1) no instruction or help-text blocks; (2) a block whose data is empty is left out; (3) text blocks span at least 6 of 12 columns.
- All preset and picker copy is English. Exact strings are in the tasks below; use them verbatim.
- Nothing publishes. Keeping the previewed shelf leaves the profile private or published exactly as it was.
- Backend tests: `DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend` from the repo root, matching CI.
- In a worktree session, run git as `/usr/bin/git …` from the worktree root. Don't run `npm install` in a linked worktree.

## Rulings made while planning

- **`best` selects ratings 4–5**, not any rating. The spec's disabled reason for it is "Needs books rated 4 or 5", and the My shelf preset's Favourites uses the same rule. It costs a reader whose only ratings are 1–3 the `best` preset.
- **Shelves in every preset hold at most 8 books**, as the existing presets already do. PR 5's `shelfAfterFinish` may push a shelf past 8, which is fine.
- **"Library order"** in the Finished rule means the order of the `books` argument. Callers building the My shelf preset pass `orderLibraryBooks(books, groups)`, so it matches the reader's order.
- **First visit drops PR 3's name matching.** PR 3's "Create your shelf" reused any mural named "My shelf". It's replaced by a per-screen ref that remembers the mural this screen created, so a retry after a partial failure reuses it without adopting a mural the reader named "My shelf" themselves.
- **Known, not changed here:** the public payload replaces a `mode: "rediscover"` quote block with a "Private passage" text block (`backend/src/modules/murals/domain/publicPayload.ts:63`). A published My shelf preset shows that to visitors. Flag it in the PR description as a follow-up; don't change it in this PR.

---

### Task 1: Shared presets

**Files:**
- Modify: `packages/shared/src/murals/murals.ts:68` (shelf variant of `MuralBlock`)
- Rewrite: `packages/shared/src/murals/presets.ts`
- Create: `packages/shared/src/murals/presets.test.ts`
- Test (backend, storage keeps `role`): `backend/src/modules/murals/service.test.ts`

**Interfaces:**
- Produces: shelf block type `{ type: "shelf"; title: string; bookKeys: string[]; collectionId?: string; role?: "finished" | "favourites" }`.
- Produces: `MURAL_PRESETS` (ids `"best" | "recent" | "next" | "shelf"`, each with `name`, `description`, `color`, `accent`), `type MuralPresetId`.
- Produces: `buildMuralPreset(id: MuralPresetId, books: Array<Record<string, unknown>>): { name: string; blocks: MuralBlock[]; bookCount: number }`.
- Produces: `presetAvailability(id: MuralPresetId, books: Array<Record<string, unknown>>): string | null`.
- Produces: `shelfPresetSummary(books: Array<Record<string, unknown>>): string`.
- All exported from `@scripta/shared` (via `murals/index.ts`, which already re-exports `presets.js`) and `@scripta/shared/murals/presets`.

- [ ] **Step 1: Add `role` to the shelf block type**

In `murals.ts`, change the shelf variant to:

```ts
  | (MuralBlockBase & { type: "shelf"; title: string; bookKeys: string[]; collectionId?: string; role?: "finished" | "favourites" })
```

- [ ] **Step 2: Write the failing tests**

Create `packages/shared/src/murals/presets.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMuralPreset, MURAL_PRESETS, presetAvailability, shelfPresetSummary } from "./presets.js";
import { updateBlock, type Mural, type MuralBlock } from "./murals.js";

const book = (title: string, fields: Record<string, unknown> = {}) => ({ Title: title, Attribution: "Author", ...fields });
const key = (title: string) => `ta:${title.toLowerCase()}|author`;
const passage = { Type: "highlight", Text: "A line worth keeping.", BookmarkID: "h1" };

const library = [
  book("Reading One", { ReadStatus: 1 }),
  book("Old Finish", { ReadStatus: 2, DateLastRead: "2024-03-01", Rating: 5 }),
  book("New Finish", { ReadStatus: 2, DateLastRead: "2026-09-01", Rating: 4, highlights: [passage] }),
  book("Undated Finish", { ReadStatus: 2, Rating: 3 }),
  book("To Read", { ReadStatus: 0, DateCreated: "2026-01-01" })
];

function shelves(blocks: MuralBlock[]) {
  return blocks.filter((block): block is Extract<MuralBlock, { type: "shelf" }> => block.type === "shelf");
}

test("every preset is in English with the spec's names and descriptions", () => {
  assert.deepEqual(MURAL_PRESETS.map(({ id, name, description }) => ({ id, name, description })), [
    { id: "best", name: "All-time favourites", description: "The books that stayed with you." },
    { id: "recent", name: "Recently finished", description: "Your last pages, newest first." },
    { id: "next", name: "Want to read", description: "Stories waiting their turn." },
    { id: "shelf", name: "My shelf", description: "What you're reading, what you've finished, and a passage to revisit." }
  ]);
});

test("no preset produces an empty block or a text block narrower than 6 columns", () => {
  for (const { id } of MURAL_PRESETS) {
    for (const block of buildMuralPreset(id, library).blocks) {
      if (block.type === "text") assert.ok(block.layout.w >= 6, `${id}: text block is ${block.layout.w} wide`);
      if (block.type === "shelf") assert.ok(block.bookKeys.length > 0, `${id}: empty shelf`);
      if (block.type === "spotlight") assert.ok(block.bookKey, `${id}: empty spotlight`);
    }
  }
});

test("best keeps only books rated 4 or 5, highest first", () => {
  const { blocks, bookCount } = buildMuralPreset("best", library);
  assert.equal(bookCount, 2);
  const spotlight = blocks.find((block) => block.type === "spotlight");
  assert.equal(spotlight?.type === "spotlight" ? spotlight.bookKey : "", key("Old Finish"));
});

test("presetAvailability explains why a preset would be empty", () => {
  assert.equal(presetAvailability("best", [book("Unrated")]), "Needs books rated 4 or 5");
  assert.equal(presetAvailability("recent", [book("Unread", { ReadStatus: 0 })]), "Needs finished books");
  assert.equal(presetAvailability("next", [book("Done", { ReadStatus: 2 })]), "Needs books on your to-read list");
  assert.equal(presetAvailability("shelf", []), "Needs books in your library");
  for (const { id } of MURAL_PRESETS) assert.equal(presetAvailability(id, library), null);
});

test("the My shelf preset stacks profile, stats, reading, finished, then passage and favourites side by side", () => {
  const { blocks } = buildMuralPreset("shelf", library);
  assert.deepEqual(blocks.map((block) => block.type), ["profile", "stats", "currentlyReading", "shelf", "quote", "shelf"]);
  const [finished, favourites] = shelves(blocks);
  assert.equal(finished.role, "finished");
  assert.equal(finished.title, "Finished");
  assert.deepEqual(finished.bookKeys, [key("New Finish"), key("Old Finish"), key("Undated Finish")]);
  assert.equal(favourites.role, "favourites");
  assert.equal(favourites.title, "Favourites");
  assert.deepEqual(favourites.bookKeys, [key("Old Finish"), key("New Finish")]);
  const quote = blocks.find((block) => block.type === "quote")!;
  assert.equal(quote.type === "quote" ? quote.mode : undefined, "rediscover");
  assert.equal(quote.layout.y, favourites.layout.y);
  assert.equal(quote.layout.w + favourites.layout.w, 12);
  const stats = blocks.find((block) => block.type === "stats")!;
  assert.deepEqual(stats.type === "stats" ? stats.metrics : [], ["totalBooks", "booksFinished", "booksInProgress"]);
});

test("the My shelf preset leaves out blocks with no data and widens a lone bottom block", () => {
  const { blocks } = buildMuralPreset("shelf", [book("Just Finished", { ReadStatus: 2, Rating: 2 })]);
  assert.deepEqual(blocks.map((block) => block.type), ["profile", "stats", "shelf"]);
  const onlyFavourite = buildMuralPreset("shelf", [book("Loved", { Rating: 5 })]).blocks.at(-1)!;
  assert.equal(onlyFavourite.type === "shelf" ? onlyFavourite.role : undefined, "favourites");
  assert.equal(onlyFavourite.layout.w, 12);
});

test("preset blocks never overlap", () => {
  for (const { id } of MURAL_PRESETS) {
    const { blocks } = buildMuralPreset(id, library);
    for (const a of blocks) for (const b of blocks) {
      if (a === b) continue;
      const overlap = a.layout.x < b.layout.x + b.layout.w && b.layout.x < a.layout.x + a.layout.w && a.layout.y < b.layout.y + b.layout.h && b.layout.y < a.layout.y + a.layout.h;
      assert.ok(!overlap, `${id}: ${a.type} overlaps ${b.type}`);
    }
  }
});

test("shelfPresetSummary counts the reader's books", () => {
  assert.equal(shelfPresetSummary(library), "Made from your 5 books: 1 you're reading and 3 you've finished. Only you can see it.");
  assert.equal(shelfPresetSummary([book("One", { ReadStatus: 1 })]), "Made from your 1 book: 1 you're reading and 0 you've finished. Only you can see it.");
});

test("editing a shelf block through updateBlock keeps its role", () => {
  const shelf = buildMuralPreset("shelf", library).blocks.find((block) => block.type === "shelf")!;
  const mural: Mural = { id: "m1", name: "My shelf", blocks: [shelf], createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null };
  const edited = shelf.type === "shelf" ? { ...shelf, title: "Read in 2026" } : shelf;
  const [saved] = updateBlock([mural], "m1", edited)[0].blocks;
  assert.equal(saved.type === "shelf" ? saved.role : undefined, "finished");
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL. `presetAvailability` and `shelfPresetSummary` aren't exported, and the names are still Portuguese.

- [ ] **Step 4: Rewrite `presets.ts`**

```ts
import { bookKey } from "../library/merge.js";
import { DEFAULT_BLOCK_STYLE, type BlockStyle } from "../library/libraryStyle.js";
import { eligiblePassages } from "./home.js";
import { ensureBookBlockHeights, newId, type BlockLayout, type MuralBlock } from "./murals.js";

export const MURAL_PRESETS = [
  { id: "best", name: "All-time favourites", description: "The books that stayed with you.", color: "#44252e", accent: "#edcd96" },
  { id: "recent", name: "Recently finished", description: "Your last pages, newest first.", color: "#233d35", accent: "#c2dbc9" },
  { id: "next", name: "Want to read", description: "Stories waiting their turn.", color: "#25364f", accent: "#c5d7f1" },
  { id: "shelf", name: "My shelf", description: "What you're reading, what you've finished, and a passage to revisit.", color: "#2b2622", accent: "#e6c79c" }
] as const;

export type MuralPresetId = typeof MURAL_PRESETS[number]["id"];

type Book = Record<string, unknown>;

const SHELF_SIZE = 8;

const UNAVAILABLE: Record<MuralPresetId, string> = {
  best: "Needs books rated 4 or 5",
  recent: "Needs finished books",
  next: "Needs books on your to-read list",
  shelf: "Needs books in your library"
};

function timestamp(value: unknown) {
  const date = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? date : 0;
}

function titledBooks(books: Book[]) {
  return [...new Map(books.filter((book) => String(book.Title ?? "").trim()).map((book) => [bookKey(book), book])).values()];
}

function favourites(books: Book[]) {
  return books.filter((book) => typeof book.Rating === "number" && book.Rating >= 4 && book.Rating <= 5)
    .sort((a, b) => Number(b.Rating) - Number(a.Rating));
}

function finishedNewestFirst(books: Book[]) {
  const finished = books.filter((book) => book.ReadStatus === 2);
  return [
    ...finished.filter((book) => timestamp(book.DateLastRead) > 0).sort((a, b) => timestamp(b.DateLastRead) - timestamp(a.DateLastRead)),
    ...finished.filter((book) => timestamp(book.DateLastRead) === 0)
  ];
}

function presetBooks(id: MuralPresetId, books: Book[]) {
  if (id === "best") return favourites(books);
  if (id === "recent") return finishedNewestFirst(books);
  if (id === "next") return books.filter((book) => book.ReadStatus === 0).sort((a, b) => timestamp(b.DateCreated) - timestamp(a.DateCreated));
  return books;
}

export function presetAvailability(id: MuralPresetId, books: Book[]): string | null {
  return presetBooks(id, titledBooks(books)).length ? null : UNAVAILABLE[id];
}

export function shelfPresetSummary(books: Book[]) {
  const library = titledBooks(books);
  const reading = library.filter((book) => book.ReadStatus === 1).length;
  const finished = library.filter((book) => book.ReadStatus === 2).length;
  return `Made from your ${library.length} ${library.length === 1 ? "book" : "books"}: ${reading} you're reading and ${finished} you've finished. Only you can see it.`;
}

export function buildMuralPreset(id: MuralPresetId, books: Book[]) {
  const preset = MURAL_PRESETS.find((item) => item.id === id)!;
  const library = titledBooks(books);
  const selected = presetBooks(id, library).slice(0, SHELF_SIZE);
  const keys = (list: Book[]) => list.map(bookKey);
  const style: BlockStyle = { ...DEFAULT_BLOCK_STYLE, backgroundColor: preset.color, textColor: "#f5f1e9", cardBorderWidth: 0, cardShadow: false, cardRadius: 16, fontFamily: "sans" };
  const accentStyle: BlockStyle = { ...style, backgroundColor: preset.accent, textColor: preset.color, fontFamily: "playfairDisplay" };
  const at = (x: number, y: number, w: number, h: number, accent = false): { id: string; layout: BlockLayout; style: BlockStyle } =>
    ({ id: newId(), layout: { x, y, w, h }, style: accent ? accentStyle : style });
  const blocks: MuralBlock[] = [];

  if (id === "shelf") {
    const reading = library.filter((book) => book.ReadStatus === 1);
    const finished = finishedNewestFirst(library).slice(0, SHELF_SIZE);
    const loved = favourites(library).slice(0, SHELF_SIZE);
    const hasPassage = eligiblePassages(library).length > 0;
    blocks.push({ ...at(0, 0, 12, 4), type: "profile", bio: "", favoriteGenres: [] });
    blocks.push({ ...at(0, 4, 12, 2), type: "stats", metrics: ["totalBooks", "booksFinished", "booksInProgress"] });
    let y = 6;
    if (reading.length) { blocks.push({ ...at(0, y, 12, 4), type: "currentlyReading" }); y += 4; }
    if (finished.length) { blocks.push({ ...at(0, y, 12, 5), type: "shelf", title: "Finished", role: "finished", bookKeys: keys(finished) }); y += 5; }
    const width = hasPassage && loved.length ? 6 : 12;
    if (hasPassage) blocks.push({ ...at(0, y, width, 5), type: "quote", bookKey: "", highlightId: "", mode: "rediscover" });
    if (loved.length) blocks.push({ ...at(12 - width, y, width, 5), type: "shelf", title: "Favourites", role: "favourites", bookKeys: keys(loved) });
    return { name: preset.name, blocks: ensureBookBlockHeights(blocks), bookCount: library.length };
  }

  const heading = id === "best"
    ? { heading: "My essential library", body: "Stories to keep.\nBooks to open again." }
    : id === "recent"
      ? { heading: "Last pages", body: "My reading diary" }
      : { heading: "The next chapter", body: "So many stories.\nOne book at a time." };
  blocks.push({ ...at(0, 0, 12, 3, true), type: "text", ...heading });
  if (id === "recent") {
    if (selected.length) blocks.push({ ...at(0, 3, 12, 8), type: "shelf", title: "Just finished", bookKeys: keys(selected) });
  } else if (selected[0]) {
    const rest = selected.slice(1);
    blocks.push({ ...at(0, 3, rest.length ? 4 : 12, 8), type: "spotlight", bookKey: bookKey(selected[0]), ...(id === "next" ? { caption: "On my list" } : {}) });
    if (rest.length) blocks.push({ ...at(4, 3, 8, 8), type: "shelf", title: id === "best" ? "Place of honour" : "On the horizon", bookKeys: keys(rest) });
  }
  return { name: preset.name, blocks: ensureBookBlockHeights(blocks), bookCount: selected.length };
}
```

If `newId` or `BlockLayout` isn't exported from `murals.ts`, export it. Both are already `export`ed as of PR 3.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: PASS, including the existing `stats.test.ts`.

- [ ] **Step 6: Backend stores `role` unchanged**

In `backend/src/modules/murals/service.test.ts`, following the file's existing `createMural`/`updateMural` tests and helpers, add:

```ts
test("updateMural stores a shelf block's role as sent", () => {
  // use the same service/fake setup as "createMural carries folderId and defaults to root"
  // create a mural, updateMural it with blocks: [{ id: "b1", type: "shelf", layout: { x: 0, y: 0, w: 12, h: 5 }, title: "Finished", bookKeys: [], role: "finished" }]
  // then read it back with the service's getter and assert.equal(blocks[0].role, "finished")
});
```

Write the body with the file's real helper names; the three comment lines describe the steps and must not stay in the code. The public payload passes blocks through untouched (`publicPayload.ts:62-70` returns `block` for shelves without `collectionId`, and spreads `rest` for those with one), so no public-payload test is needed.

Run: `DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend`
Expected: PASS.

- [ ] **Step 7: Check both editors keep `role`**

Read these call sites and confirm each builds the new block by spreading the old one (`{ ...draft, … }` / `{ ...block, … }`), so `role` survives an edit. Report the lines you checked; change nothing unless one doesn't spread:
- `frontend/src/components/murals/BlockConfigPanel.tsx`, every `setDraft({ ...draft, … })` for shelves (around `:194-262`).
- `mobile/src/features/murals/MuralEditorScreen.tsx:124-125,153`.

- [ ] **Step 8: Typecheck the consumers**

Run: `npm run typecheck --workspace mobile && npm run typecheck --workspace frontend && npm run typecheck --workspace backend`
Expected: PASS. `MURAL_PRESETS` gained an id, so any exhaustive switch over `MuralPresetId` must handle `"shelf"`.

- [ ] **Step 9: Commit**

```bash
/usr/bin/git add packages/shared/src/murals backend/src/modules/murals/service.test.ts
/usr/bin/git commit -m "Presets: English, no empty or help-text blocks, and a My shelf preset"
```

The commit body says why: the Portuguese copy and instruction notes read as unfinished on a public page; empty shelves made new murals look broken; `role` lets PR 5 find the Finished and Favourites shelves without guessing from titles; `best` now matches its "rated 4 or 5" reason.

---

### Task 2: Mobile first visit and preset pickers

**Files:**
- Create: `mobile/src/features/community/ShelfPreview.tsx`
- Modify: `mobile/src/features/community/MyShelfScreen.tsx` (the Shelf page's fallback branch, `createShelf`, and the library query)
- Modify: `mobile/src/features/murals/MuralsScreen.tsx` (`createFromPreset` at `:51-57`, empty state at `:154`, preset sheet at `:170`)

**Interfaces:**
- Consumes: `buildMuralPreset`, `presetAvailability`, `shelfPresetSummary`, `MURAL_PRESETS`, `orderLibraryBooks` from `@scripta/shared`; `setShelfMural` from `./api`; `useMurals()` (`create(name)`, `update(id, { blocks })`).
- Produces: `ShelfPreview` props `{ mural: Mural; summary: string; busy: boolean; books; groups; images; tierlists; profile; onKeep: () => void; onBlank: () => void }`.

- [ ] **Step 1: `ShelfPreview`**

```tsx
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Group, Mural, ReaderProfile } from "@scripta/shared";
import { Button, dynamicType, spacing, typography, useTheme } from "../../ui";
import type { GalleryImage } from "../gallery/api";
import { MuralCanvas } from "../murals";
import type { Tierlist } from "../tierlists/api";

export function ShelfPreview({ mural, summary, busy, books, groups, images, tierlists, profile, onKeep, onBlank }: {
  mural: Mural;
  summary: string;
  busy: boolean;
  books: Array<Record<string, unknown>>;
  groups: Group[];
  images: GalleryImage[];
  tierlists: Tierlist[];
  profile?: ReaderProfile;
  onKeep: () => void;
  onBlank: () => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text {...dynamicType} style={[typography.body, { color: colors.textDim }]}>{summary}</Text>
      <View style={styles.actions}>
        <Button label="Keep this shelf" loading={busy} disabled={busy} onPress={onKeep} />
        <Button label="Start blank" variant="secondary" disabled={busy} onPress={onBlank} />
      </View>
      <MuralCanvas mural={mural} books={books} groups={groups} images={images} tierlists={tierlists} profile={profile} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, gap: spacing.md },
  actions: { gap: spacing.sm }
});
```

Match the import paths for `GalleryImage`, `Tierlist`, `Group` and `ReaderProfile` to where `MuralCanvas.tsx` imports them from.

- [ ] **Step 2: First visit in `MyShelfScreen`**

1. Keep the whole library query: `const libraryQuery = useLibrary(); const library = libraryQuery.data;`.
2. Build the preview once per library change, so the rediscover passage (seeded by block id) doesn't reshuffle on every render:

```tsx
const ordered = useMemo(() => orderLibraryBooks(books, groups), [books, groups]);
const preview = useMemo(() => buildMuralPreset("shelf", ordered), [ordered]);
const previewMural: Mural = { id: "shelf-preview", name: preview.name, blocks: preview.blocks, createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null };
const pendingShelf = useRef<string | null>(null);
```

3. Replace `createShelf` with:

```tsx
async function shelfTargetId() {
  const id = ownData.muralId ?? pendingShelf.current ?? (await murals.create("My shelf")).id;
  pendingShelf.current = id;
  return id;
}

async function keepShelf() {
  const ok = await run(async () => {
    const id = await shelfTargetId();
    await murals.update(id, { blocks: preview.blocks });
    if (ownData.muralId !== id) await setShelfMural(id);
  });
  if (ok) await queryClient.invalidateQueries({ queryKey: ["murals"] });
}

async function startBlank() {
  let id: string | null = null;
  const ok = await run(async () => {
    id = await shelfTargetId();
    if (ownData.muralId !== id) await setShelfMural(id);
  });
  if (ok && id) router.push(`/murals/${id}` as never);
}
```

These must sit after `const ownData = own.data;` or read `own.data` directly.

4. Replace the Shelf page's final `EmptyState` ("Your shelf is empty" / "Create your shelf") with:

```tsx
if (libraryQuery.isPending) return <View style={styles.tabPad}><Skeleton height={240} /></View>;
if (libraryQuery.isError) return <ErrorState body="Couldn't load your library." actionLabel="Retry" onAction={() => void libraryQuery.refetch()} />;
if (!books.length) {
  return (
    <EmptyState
      title="Start your library"
      body="Import your existing collection, or add your first book manually."
      actionLabel="Import library"
      onAction={() => router.push("/import" as never)}
      secondaryActionLabel="Add a book manually"
      onSecondaryAction={() => router.push("/add-book" as never)}
    />
  );
}
return <ShelfPreview mural={previewMural} summary={shelfPresetSummary(books)} busy={busy} books={books} groups={groups} images={images} tierlists={tierlists} profile={profile} onKeep={() => void keepShelf()} onBlank={() => void startBlank()} />;
```

The branches above it (`mural.isPending`, `mural.isError`, `hasMural && muralHasBlocks`) stay as they are. The empty-library copy and routes are the ones Home uses (`mobile/src/features/home/HomeScreen.tsx`).

5. The "Edit shelf" menu item keeps pointing at `ownData.muralId`. Remove any now-unused imports.

- [ ] **Step 3: Murals screen**

In `MuralsScreen.tsx`:

1. `createFromPreset` reports failures and reuses a mural a failed attempt already created:

```tsx
const pendingPreset = useRef<{ id: string; preset: MuralPresetId } | null>(null);
const [presetError, setPresetError] = useState<string | null>(null);

async function createFromPreset(id: MuralPresetId) {
  setPresetError(null);
  try {
    const preset = buildMuralPreset(id, library?.data.books ?? []);
    const target = pendingPreset.current?.preset === id ? pendingPreset.current : { id: (await murals.create(preset.name, folderId ?? null)).id, preset: id };
    pendingPreset.current = target;
    const updated = await murals.update(target.id, { blocks: preset.blocks });
    pendingPreset.current = null;
    setPresets(false);
    router.push(`/murals/${updated.id}` as never);
  } catch {
    setPresetError("Couldn't create the mural. Try again.");
  }
}
```

2. The empty state offers presets when not searching: add `actionLabel={search ? "Clear search" : "Start from a preset"}` and `onAction={search ? clearSearch : () => setPresets(true)}`.

3. The preset sheet shows each description and any disabled reason:

```tsx
<Sheet visible={presets} title="Start from a preset" onClose={() => setPresets(false)}>
  <View style={styles.sheet}>
    {presetError ? <Toast visible message={presetError} tone="error" /> : null}
    {MURAL_PRESETS.map((preset) => {
      const reason = presetAvailability(preset.id, library?.data.books ?? []);
      return (
        <View key={preset.id} style={styles.presetRow}>
          <Button label={preset.name} variant="secondary" disabled={Boolean(reason)} onPress={() => void createFromPreset(preset.id)} />
          <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{preset.description}</Text>
          {reason ? <Text {...dynamicType} style={[typography.caption, { color: colors.textDim }]}>{reason}</Text> : null}
        </View>
      );
    })}
  </View>
</Sheet>
```

Add `presetRow: { gap: spacing.xs }` to the styles. The ⋯ menu's existing "Start from a preset…" item stays.

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add mobile/src/features/community mobile/src/features/murals/MuralsScreen.tsx
/usr/bin/git commit -m "Mobile: My shelf starts from a preview of your books"
```

The body says why the name-matched reuse went (it could adopt the reader's own "My shelf" mural) and what replaced it.

---

### Task 3: Web first visit and preset picker

**Files:**
- Modify: `frontend/src/components/OwnShelfView.tsx` (`createShelf` at `:74-86`, the Mural tab's empty state at `:163-177`)
- Modify: `frontend/src/components/murals/MuralPresetPicker.tsx`
- Modify: `frontend/src/pages/MuralsListPage.tsx:194-200` (empty state)

**Interfaces:**
- Consumes: `buildMuralPreset`, `presetAvailability`, `shelfPresetSummary`, `MURAL_PRESETS`, `orderLibraryBooks` (from `@scripta/shared` or the `../lib/*` re-exports the file already uses); `useMurals()` (`create(name)`, `saveBlocks(id, blocks)`); `setShelfMural` from `../api/community`.

- [ ] **Step 1: First visit in `OwnShelfView`**

1. Keep the library query's state: `const libraryQuery = useLibrary(); const library = libraryQuery.data;`.
2. Build the preview once per library change (`useMemo` over `orderLibraryBooks(books, groups)`, then `buildMuralPreset("shelf", ordered)`), the same as Task 2 Step 2.2, with `previewMural` shaped as a `Mural` (`id: "shelf-preview"`, empty `createdAt`/`updatedAt`, `shareToken: null`, `shareUrl: null`, `folderId: null`), and `const pendingShelf = useRef<string | null>(null);`.

Because hooks can't follow the early returns, put the `useMemo` calls above `if (own.isPending || murals.isLoading)`, computing `books`/`groups` from `library` there.

3. Replace `createShelf` with:

```tsx
async function shelfTargetId() {
  const id = own.data?.muralId ?? pendingShelf.current ?? (await murals.create("My shelf")).id;
  pendingShelf.current = id;
  return id;
}

async function keepShelf() {
  await run(async () => {
    const id = await shelfTargetId();
    await murals.saveBlocks(id, preview.blocks);
    if (own.data?.muralId !== id) await setShelfMural(id);
  });
}

async function startBlank() {
  let id: string | null = null;
  const ok = await run(async () => {
    id = await shelfTargetId();
    if (own.data?.muralId !== id) await setShelfMural(id);
  });
  if (ok && id) navigate(`/dashboard/murals/${id}`);
}
```

`saveBlocks` already writes the saved mural into the murals cache, so the Mural tab renders the kept shelf once `run` has refreshed own-profile.

4. In the Mural tab, replace the "Your shelf is empty" `EmptyState` with:

```tsx
libraryQuery.isLoading ? (
  <SkeletonCardGrid count={2} label="Loading your library" tileClassName="min-h-[120px]" />
) : libraryQuery.isError ? (
  <EmptyState title="Library unavailable." body="Couldn't load your library." action={<button onClick={() => void libraryQuery.refetch()} className="rounded-lg border border-(--color-border) px-3 py-1.5 text-sm hover:border-(--color-accent)">Retry</button>} />
) : books.length === 0 ? (
  <EmptyState
    icon={MuralsIcon}
    title="Start your library"
    body="Import your existing collection, or add your first book manually."
    action={
      <div className="flex flex-wrap justify-center gap-2">
        <Link to="/dashboard/library?action=import" className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-white">Import library</Link>
        <Link to="/dashboard/library?action=add" className="rounded-lg border border-(--color-border) px-3 py-2 text-sm">Add a book manually</Link>
      </div>
    }
  />
) : (
  <div className="space-y-4">
    <p className="text-sm text-(--color-text-dim)">{shelfPresetSummary(books)}</p>
    <div className="flex flex-wrap gap-2">
      <button onClick={() => void keepShelf()} disabled={busy} className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Keep this shelf</button>
      <button onClick={() => void startBlank()} disabled={busy} className="rounded-lg border border-(--color-border) px-3 py-2 text-sm disabled:opacity-50">Start blank</button>
    </div>
    <MuralCanvas mural={previewMural} editMode={false} groups={groups} books={books} images={images} profile={profile} />
  </div>
)
```

Match the prop names `MuralCanvas` and `EmptyState` actually take in this file (it already renders both). Import `Link` from `react-router-dom`.

- [ ] **Step 2: `MuralPresetPicker` in English, with reasons**

- Sheet title: `Start from a preset`.
- Intro: `Filled from your library. Every block can be moved and edited.`
- Save error: `Couldn't save the preset. Choose the same option again to finish the mural.`
- Library error: `Couldn't load your library. Reopen presets to try again.`
- For each preset, `const reason = presetAvailability(preset.id, books);`. Disable the button when `reason` is set, alongside its existing conditions.
- Footer line: `busy ? "Saving…" : isLoading ? "Loading library…" : reason ?? \`${built.bookCount} ${built.bookCount === 1 ? "book" : "books"} · Use preset →\``.
- The description line stays (`preset.description`, now English).

- [ ] **Step 3: Murals list empty state offers presets**

In `MuralsListPage.tsx`, give the "No murals yet." `EmptyState` an action:

```tsx
action={<button onClick={() => setPresetsOpen(true)} className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-white">Start from a preset</button>}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS, with no new lint warnings in touched files.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add frontend/src
/usr/bin/git commit -m "Web: My shelf starts from a preview of your books"
```

---

### Task 4: Full verification and device check

- [ ] **Step 1: Merge main and run everything**

```bash
/usr/bin/git fetch origin && /usr/bin/git merge --no-edit origin/main
npm run build --workspace @scripta/shared
npm test --workspace @scripta/shared
npm run typecheck --workspace backend
DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend
npm run typecheck --workspace frontend
npm run lint --workspace frontend
npm test --workspace frontend
npm run typecheck --workspace mobile
npm test --workspace mobile
cd mobile && npx expo-doctor
```

Expected: all pass.

- [ ] **Step 2: Device check (mobile)**

Run `node scripts/dev-status.mjs --json` once. If a stack slot and an emulator are free, run `node scripts/dev-emulator.mjs` from the worktree; otherwise say so and skip, without waiting. The dev account has 24 books (Reading 7, Finished 11, To read 6). Check, with screenshots:
- My shelf → Shelf with no shelf mural shows the preview: the summary line ("Made from your 24 books: 7 you're reading and 11 you've finished. Only you can see it."), Keep this shelf, Start blank, and the preview canvas. Profile, stats, Currently reading and Finished render. Nothing overlaps, and no text breaks mid-word.
- Keep this shelf → the Shelf page renders the saved shelf, and the chip still reads what it did before.
- Switch shelf mural… to an empty mural → the preview shows again. Start blank → the editor opens on that mural.
- Murals with no murals (or a search that clears to empty) → "Start from a preset" opens the sheet. Each preset shows its description. A preset with no data is disabled and shows its reason.
- In the editor, open the kept shelf's Finished block, change its title, save, and confirm it still renders.

Run `npm run dev:release` at the end.

- [ ] **Step 3: Report**

List every check with pass/fail and counts, the screenshot paths, and anything left open.

---

## Self-review

- Spec coverage: `role` on shelf blocks and storage/editor retention (Task 1 Steps 1, 6, 7). Preset rules 1–3 (Task 1 tests). English names, descriptions and headings (Task 1). `presetAvailability` and the pickers' disabled reasons (Task 1; Task 2 Step 3; Task 3 Step 2). `buildMuralPreset("shelf")` order, conditions, side-by-side bottom row and heights via `ensureBookBlockHeights` (Task 1). First visit: preview, summary, Keep this shelf, Start blank, empty library (Task 2 Step 2; Task 3 Step 1). Murals empty state "Start from a preset" (Task 2 Step 3; Task 3 Step 3). Web picker copy in English (Task 3 Step 2).
- Types: `MuralPresetId` gains `"shelf"`; `presetAvailability(id, books): string | null`, `shelfPresetSummary(books): string`, and `buildMuralPreset(...).blocks` are used with the same names in Tasks 2 and 3.
