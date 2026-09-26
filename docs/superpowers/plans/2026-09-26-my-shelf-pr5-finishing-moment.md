# My shelf PR 5: the finishing moment. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a reader moves a book to Finished and the save succeeds, a short sheet marks the moment. The reader can rate the book with five named chips, keep a thought, and weigh the book against their favourite. The shelf made from the My shelf preset updates itself, and a mis-tap can be undone.

**Architecture:** Pure helpers live in `@scripta/shared`: `library/finish.ts` holds the book changes (rating, reader note, snapshot/restore, finish-day formatting), and `murals/finish.ts` holds the shelf changes (`shelfAfterFinish`, `favouriteOpponent`, `promoteFavourite`), keyed on PR 4's shelf `role`. Mobile opens a `book/[key]/finished` sheet route. Web opens a `FinishSheet` from `LibraryPage`. Both open it only after the status save resolves successfully.

**Tech Stack:** `@scripta/shared` (`node:test` via tsx), Expo Router + TanStack Query (mobile), React + Tailwind + TanStack Query (web).

**Spec:** `docs/superpowers/specs/2026-09-25-my-shelf-release-1-design.md`, section "5. The finishing moment", including "Carried over from PR 1's final review".

**Base:** `origin/main` after PR 4 (#31) merges.

## Global Constraints

- No code comments; the why goes in commit messages.
- Minimum code. Reuse `Sheet`, `Button`, `Toast`, `CoverImage`/`BookCover`, `useLibraryActions`/`updateLibrary`, `useMurals`, `fetchOwnProfile`. No new packages.
- `FINISH_FEELINGS`: 1 "Not for me", 2 "Fine", 3 "Good", 4 "Loved it", 5 "All-time". Use these strings verbatim.
- The moment opens **only** after the reader moves a book to Finished with the status control **and the save succeeds**. Never for imports, merges or bulk edits, and never when the book was already Finished.
- The moment publishes and shares nothing, and never mentions followers.
- Blank or hand-made shelves are never modified. Only a shelf with a `role: "finished"` shelf block is touched.
- `DateLastRead` is parsed as a local date (`new Date(y, m - 1, d)`), never `new Date("YYYY-MM-DD")`.
- Exact copy: eyebrow `Finished · <date>`; button `Done`; rows `How did it land?`, `A thought to keep.`, `Against your favourite.`; rating confirmation `Saved as your rating`; duel buttons `This one` and `Still <title>`; footers `Added to Finished on your shelf` and `Added to Finished on your shelf, and to Favourites`; undo link `Not finished? Undo`; book sheet row `How it landed`.
- Backend tests: `DOTENV_CONFIG_PATH=/nonexistent/.env npm test --workspace backend`. In a worktree session, run git as `/usr/bin/git …` from the worktree root, and don't run `npm install` in a linked worktree.

## Rulings made while planning

- **Rating re-runs the shelf update.** The spec runs `shelfAfterFinish` when the moment opens, but at that point the book usually has no rating yet, so "…and to Favourites" could never appear for a newly loved book. The sheet also runs it again when a rating chip is tapped. The helper is idempotent (the key is already at the front of Finished, and Favourites is appended only when none exists). The client keeps the union of every call's `landed`. The cost is one extra mural save per rating tap.
- **Undo.** The spec asks the Done/undo design to account for a mis-tap overwriting `DateLastRead` and progress. The sheet gets a `Not finished? Undo` link:
  - it restores the book's `ReadStatus`, `DateLastRead` and `___PercentRead` from a snapshot taken before the status save;
  - it puts back the shelf blocks as they were before the moment, if the moment changed them;
  - it closes without saving the note.

  A rating set during the moment stays, because it's a separate choice.
- **Mobile passes the snapshot through the route.** The snapshot goes as a `before` search param holding `encodeURIComponent(JSON.stringify(snapshot))`, because the sheet is its own route.
- **Favourites already present.** When a Favourites shelf already exists, a 4–5 rating doesn't add the book on its own. The "Against your favourite." duel is how it gets in, as the spec lays out.

---

### Task 1: Shared finish helpers

**Files:**
- Create: `packages/shared/src/library/finish.ts`, `packages/shared/src/library/finish.test.ts`
- Create: `packages/shared/src/murals/finish.ts`, `packages/shared/src/murals/finish.test.ts`
- Modify: `packages/shared/src/library/index.ts` (add `export * from "./finish.js";`), `packages/shared/src/murals/index.ts` (add `export * from "./finish.js";`)

**Interfaces:**
- Produces (library): `FINISH_FEELINGS: readonly { rating: 1|2|3|4|5; label: string }[]`; `type FinishRating = 1|2|3|4|5`; `setRating(book, rating: FinishRating): Record<string, unknown>`; `addReaderNote(book, text: string, day: string, id: string): Record<string, unknown>`; `type ReadSnapshot = { ReadStatus?: unknown; DateLastRead?: unknown; ___PercentRead?: unknown }`; `readSnapshot(book): ReadSnapshot`; `restoreReadState(book, before: ReadSnapshot): Record<string, unknown>`; `formatFinishDay(day: string, locale?: string): string`.
- Produces (murals): `shelfAfterFinish(blocks: MuralBlock[], key: string, rating: number | null): { blocks: MuralBlock[]; landed: ("finished" | "favourites")[] }`; `favouriteOpponent(blocks: MuralBlock[], key: string): string | null`; `promoteFavourite(blocks: MuralBlock[], key: string): MuralBlock[]`.
- All exported from `@scripta/shared`.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/library/finish.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.TZ = "America/Sao_Paulo";
const { FINISH_FEELINGS, addReaderNote, formatFinishDay, readSnapshot, restoreReadState, setRating } = await import("./finish.js");

test("the five feelings map to ratings 1 through 5", () => {
  assert.deepEqual(FINISH_FEELINGS.map(({ rating, label }) => [rating, label]), [
    [1, "Not for me"], [2, "Fine"], [3, "Good"], [4, "Loved it"], [5, "All-time"]
  ]);
});

test("setRating sets Rating and returns the same object when unchanged", () => {
  const book = { Title: "A", Rating: 3 };
  assert.deepEqual(setRating(book, 5), { Title: "A", Rating: 5 });
  assert.equal(setRating(book, 3), book);
});

test("addReaderNote appends a review-shaped highlight", () => {
  const book = { Title: "A", ContentID: "c1", highlights: [{ BookmarkID: "h1", Type: "highlight", Text: "x" }] };
  const next = addReaderNote(book, "Stayed with me.", "2026-09-26", "n1");
  assert.equal((next.highlights as unknown[]).length, 2);
  assert.deepEqual((next.highlights as unknown[])[1], {
    BookmarkID: "note:n1", VolumeID: "c1", Text: "Stayed with me.", Annotation: "", Type: "review",
    DateCreated: "2026-09-26", DateModified: null, ChapterProgress: null
  });
  assert.deepEqual((addReaderNote({ Title: "B" }, "Hm.", "2026-09-26", "n2").highlights as Array<Record<string, unknown>>)[0]!.VolumeID, null);
});

test("restoreReadState puts back exactly the snapshot, removing fields that were absent", () => {
  const before = readSnapshot({ Title: "A", ReadStatus: 1, ___PercentRead: 40 });
  const finished = { Title: "A", ReadStatus: 2, DateLastRead: "2026-09-26", ___PercentRead: 100 };
  assert.deepEqual(restoreReadState(finished, before), { Title: "A", ReadStatus: 1, ___PercentRead: 40 });
});

test("formatFinishDay reads a date-only day in local time", () => {
  assert.equal(formatFinishDay("2027-01-01", "en-US"), "January 1, 2027");
});
```

`packages/shared/src/murals/finish.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { favouriteOpponent, promoteFavourite, shelfAfterFinish } from "./finish.js";
import type { MuralBlock } from "./murals.js";

const shelf = (id: string, role: "finished" | "favourites" | undefined, bookKeys: string[], y: number): MuralBlock =>
  ({ id, type: "shelf", title: id, bookKeys, layout: { x: 0, y, w: 12, h: 5 }, ...(role ? { role } : {}) });
const text: MuralBlock = { id: "t", type: "text", heading: "Hi", layout: { x: 0, y: 0, w: 12, h: 3 } };

function keysOf(blocks: MuralBlock[], role: "finished" | "favourites") {
  const block = blocks.find((b) => b.type === "shelf" && b.role === role);
  return block?.type === "shelf" ? block.bookKeys : undefined;
}

test("a blank or hand-made shelf is never modified", () => {
  const blocks = [text, shelf("mine", undefined, ["a"], 3)];
  const result = shelfAfterFinish(blocks, "b", 5);
  assert.equal(result.blocks, blocks);
  assert.deepEqual(result.landed, []);
});

test("the finished book moves to the front of Finished, deduped", () => {
  const blocks = [text, shelf("f", "finished", ["a", "b", "c"], 3)];
  const result = shelfAfterFinish(blocks, "b", null);
  assert.deepEqual(keysOf(result.blocks, "finished"), ["b", "a", "c"]);
  assert.deepEqual(result.landed, ["finished"]);
});

test("a 4 or 5 with no Favourites shelf appends one below the lowest block", () => {
  const blocks = [text, shelf("f", "finished", ["a"], 3)];
  const result = shelfAfterFinish(blocks, "b", 4);
  assert.deepEqual(keysOf(result.blocks, "favourites"), ["b"]);
  const favourites = result.blocks.at(-1)!;
  assert.equal(favourites.layout.y, 8);
  assert.equal(favourites.layout.w, 12);
  assert.deepEqual(result.landed, ["finished", "favourites"]);
});

test("a 3 or an existing Favourites shelf adds nothing to Favourites", () => {
  assert.equal(keysOf(shelfAfterFinish([shelf("f", "finished", [], 0)], "b", 3).blocks, "favourites"), undefined);
  const withFavourites = [shelf("f", "finished", [], 0), shelf("v", "favourites", ["x"], 5)];
  const result = shelfAfterFinish(withFavourites, "b", 5);
  assert.deepEqual(keysOf(result.blocks, "favourites"), ["x"]);
  assert.deepEqual(result.landed, ["finished"]);
});

test("running it twice is stable", () => {
  const once = shelfAfterFinish([shelf("f", "finished", ["a"], 0)], "b", 5).blocks;
  const twice = shelfAfterFinish(once, "b", 5).blocks;
  assert.deepEqual(twice.map((b) => b.type === "shelf" ? b.bookKeys : []), once.map((b) => b.type === "shelf" ? b.bookKeys : []));
});

test("favouriteOpponent returns the first favourite that isn't the book", () => {
  const blocks = [shelf("v", "favourites", ["b", "x", "y"], 0)];
  assert.equal(favouriteOpponent(blocks, "b"), "x");
  assert.equal(favouriteOpponent([shelf("v", "favourites", ["b"], 0)], "b"), null);
  assert.equal(favouriteOpponent([text], "b"), null);
});

test("promoteFavourite moves or inserts the book at the front of Favourites", () => {
  assert.deepEqual(keysOf(promoteFavourite([shelf("v", "favourites", ["x", "b"], 0)], "b"), "favourites"), ["b", "x"]);
  assert.deepEqual(keysOf(promoteFavourite([shelf("v", "favourites", ["x"], 0)], "b"), "favourites"), ["b", "x"]);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement `library/finish.ts`**

```ts
export const FINISH_FEELINGS = [
  { rating: 1, label: "Not for me" },
  { rating: 2, label: "Fine" },
  { rating: 3, label: "Good" },
  { rating: 4, label: "Loved it" },
  { rating: 5, label: "All-time" }
] as const;

export type FinishRating = (typeof FINISH_FEELINGS)[number]["rating"];

type Book = Record<string, unknown>;

export function setRating(book: Book, rating: FinishRating): Book {
  return book.Rating === rating ? book : { ...book, Rating: rating };
}

export function addReaderNote(book: Book, text: string, day: string, id: string): Book {
  const note = { BookmarkID: `note:${id}`, VolumeID: book.ContentID ?? null, Text: text, Annotation: "", Type: "review", DateCreated: day, DateModified: null, ChapterProgress: null };
  return { ...book, highlights: [...(Array.isArray(book.highlights) ? book.highlights : []), note] };
}

const READ_FIELDS = ["ReadStatus", "DateLastRead", "___PercentRead"] as const;

export type ReadSnapshot = Partial<Record<(typeof READ_FIELDS)[number], unknown>>;

export function readSnapshot(book: Book): ReadSnapshot {
  return Object.fromEntries(READ_FIELDS.filter((field) => book[field] !== undefined).map((field) => [field, book[field]]));
}

export function restoreReadState(book: Book, before: ReadSnapshot): Book {
  const next = { ...book };
  for (const field of READ_FIELDS) {
    if (before[field] === undefined) delete next[field];
    else next[field] = before[field];
  }
  return next;
}

export function formatFinishDay(day: string, locale?: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}
```

- [ ] **Step 4: Implement `murals/finish.ts`**

```ts
import { newId, type MuralBlock } from "./murals.js";

type Shelf = Extract<MuralBlock, { type: "shelf" }>;
type Landing = "finished" | "favourites";

function shelfWithRole(blocks: MuralBlock[], role: Landing) {
  return blocks.find((block): block is Shelf => block.type === "shelf" && block.role === role);
}

function toFront(shelf: Shelf, key: string): Shelf {
  return { ...shelf, bookKeys: [key, ...shelf.bookKeys.filter((item) => item !== key)] };
}

export function shelfAfterFinish(blocks: MuralBlock[], key: string, rating: number | null): { blocks: MuralBlock[]; landed: Landing[] } {
  const finished = shelfWithRole(blocks, "finished");
  if (!finished) return { blocks, landed: [] };
  const next: MuralBlock[] = blocks.map((block) => (block === finished ? toFront(finished, key) : block));
  const landed: Landing[] = ["finished"];
  if (rating !== null && rating >= 4 && !shelfWithRole(blocks, "favourites")) {
    const y = Math.max(...blocks.map((block) => block.layout.y + block.layout.h));
    next.push({ id: newId(), type: "shelf", title: "Favourites", role: "favourites", bookKeys: [key], layout: { x: 0, y, w: 12, h: 5 }, ...(finished.style ? { style: finished.style } : {}) });
    landed.push("favourites");
  }
  return { blocks: next, landed };
}

export function favouriteOpponent(blocks: MuralBlock[], key: string): string | null {
  return shelfWithRole(blocks, "favourites")?.bookKeys.find((item) => item !== key) ?? null;
}

export function promoteFavourite(blocks: MuralBlock[], key: string): MuralBlock[] {
  const favourites = shelfWithRole(blocks, "favourites");
  return favourites ? blocks.map((block) => (block === favourites ? toFront(favourites, key) : block)) : blocks;
}
```

- [ ] **Step 5: Export and run**

Add the two `export * from "./finish.js";` lines. Then run `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`.
Expected: PASS, including the existing tests.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add packages/shared/src
/usr/bin/git commit -m "Shared helpers for the finishing moment"
```

The commit body says why: the helpers are pure so both clients share one tested behaviour; shelf changes key on `role` so hand-made shelves are never touched; the snapshot and restore exist for the mis-tap undo.

---

### Task 2: Mobile finishing moment

**Files:**
- Modify: `mobile/src/features/library/hooks/useLibraryActions.ts` (`setStatus` returns the save result; add `setRating`, `addNote`, `restoreRead`)
- Create: `mobile/src/features/library/components/FeelingChips.tsx`
- Create: `mobile/src/features/library/FinishedScreen.tsx`
- Create: `mobile/src/app/(app)/(home,library)/book/[key]/finished.tsx`
- Modify: `mobile/src/app/(app)/(home,library)/book/[key]/index.tsx` (open the moment after a successful save)
- Modify: `mobile/src/app/(app)/(home)/_layout.tsx` and `mobile/src/app/(app)/(library)/_layout.tsx` (declare `book/[key]/finished` as a sheet, title `Finished`, in **both**)
- Modify: `mobile/src/features/library/components/BookDetail.tsx` (the "How it landed" row for finished books)

**Interfaces:**
- Consumes: everything Task 1 produces. `useMurals()` (`update(id, { blocks })`), `fetchMural(id)` (`mobile/src/features/murals/api.ts`), `fetchOwnProfile` (`mobile/src/features/community/api.ts`), `bookKey`, `localDay`, `newId` from `@scripta/shared`.
- Produces: `FeelingChips({ value, onChange }: { value: number | null; onChange: (rating: FinishRating) => void })`.

- [ ] **Step 1: Actions**

In `useLibraryActions.ts`:
- `setStatus` already returns `run(...)` (a `Promise<boolean>`) when the status changes and `undefined` when it doesn't. Leave that as it is. Callers treat `undefined` as "nothing happened".
- Add:

```ts
    setRating: (book: Record<string, unknown>, rating: FinishRating) => {
      if (setRating(book, rating) === book) return Promise.resolve(true);
      return run(mapBook(bookKey(book), (b) => setRating(b, rating)), "Couldn't save the rating.");
    },

    addNote: (book: Record<string, unknown>, text: string) =>
      run(mapBook(bookKey(book), (b) => addReaderNote(b, text, localDay(), newId())), "Couldn't save your note."),

    restoreRead: (book: Record<string, unknown>, before: ReadSnapshot) =>
      run(mapBook(bookKey(book), (b) => restoreReadState(b, before)), "Couldn't undo the status change."),
```

Import `setRating`, `addReaderNote`, `restoreReadState`, `newId`, `type FinishRating` and `type ReadSnapshot` from `@scripta/shared`. The local `setRating` property shadows the import inside the object literal, so import the helper as `setRating as rateBook` and call `rateBook`.

- [ ] **Step 2: `FeelingChips`**

```tsx
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FINISH_FEELINGS, type FinishRating } from "@scripta/shared";
import { dynamicType, radii, spacing, typography, useTheme } from "../../../ui/theme";

export function FeelingChips({ value, onChange }: { value: number | null; onChange: (rating: FinishRating) => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={styles.row}>
      {FINISH_FEELINGS.map(({ rating, label }) => {
        const selected = value === rating;
        return (
          <Pressable
            key={rating}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(rating)}
            style={[styles.chip, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}
          >
            <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.label, { color: selected ? colors.accent : colors.text }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  label: { fontWeight: "700" }
});
```

`numberOfLines={1}` follows PR 3's fix for shrink-wrapped pill labels. Match the import paths for `dynamicType`/`radii` to where `OwnLibraryPane.tsx` gets them.

- [ ] **Step 3: Open the moment only after a successful save**

In `book/[key]/index.tsx`, replace `onSetStatus={setStatus}` with:

```tsx
onSetStatus={async (current, status) => {
  const before = readSnapshot(current);
  const wasFinished = current.ReadStatus === 2;
  const saved = await setStatus(current, status);
  if (saved && status === 2 && !wasFinished) to(`finished?before=${encodeURIComponent(JSON.stringify(before))}`);
}}
```

Import `readSnapshot` from `@scripta/shared`. `BookDetail`'s `onSetStatus` type becomes `(book, status: ReadStatus) => void | Promise<void>`.

- [ ] **Step 4: Declare the route in both stacks**

In **both** `(home)/_layout.tsx` and `(library)/_layout.tsx`, next to the other `book/[key]/*` screens:

```tsx
<Stack.Screen name="book/[key]/finished" options={{ ...sheet, title: "Finished" }} />
```

Without the Home declaration, the route opens as a plain pushed screen instead of a sheet (PR 2's review).

- [ ] **Step 5: The route file**

`mobile/src/app/(app)/(home,library)/book/[key]/finished.tsx`:

```tsx
import { router, useLocalSearchParams } from "expo-router";
import type { ReadSnapshot } from "@scripta/shared";
import { FinishedScreen } from "@/features/library/FinishedScreen";
import { useBook } from "@/features/library/hooks/useBook";
import { ErrorState, Screen, Skeleton } from "@/ui";

export default function FinishedRoute() {
  const { key, before } = useLocalSearchParams<{ key: string; before?: string }>();
  const { book, loading } = useBook(key);
  const snapshot: ReadSnapshot = before ? JSON.parse(decodeURIComponent(before)) : {};
  return (
    <Screen top={false}>
      {loading ? <Skeleton height={180} /> : !book ? (
        <ErrorState title="Book not found" body="It may have been removed from your library." actionLabel="Close" onAction={() => router.back()} />
      ) : <FinishedScreen book={book} before={snapshot} onClose={() => router.back()} />}
    </Screen>
  );
}
```

- [ ] **Step 6: `FinishedScreen`**

Its behaviour, top to bottom:

1. **Header row:** eyebrow `Finished · {formatFinishDay(String(book.DateLastRead ?? localDay()))}` on the left, and a `Done` button on the right that's always visible (put it in the content's first row, not only in the navigator header).
2. Cover (`CoverImage`), title and author.
3. **How did it land?** `FeelingChips` with `value={typeof book.Rating === "number" ? book.Rating : null}`. A tap calls `setRating(book, rating)`. When that resolves `true`, show `Saved as your rating` under the chips, then call `updateShelf(rating)` (below).
4. **A thought to keep.** A multiline `Input` bound to local state.
5. **Against your favourite.** Show it only when `opponent` (below) isn't null and no choice has been made yet. Show the two covers side by side with `This one` (→ `promoteFavourite(blocks, key)`, then save the mural) and `Still {opponentTitle}` (no change). After either choice, hide the row.
6. **Footer:** from the union of `landed`. `["finished"]` gives `Added to Finished on your shelf`, and one including `"favourites"` gives `Added to Finished on your shelf, and to Favourites`. Show nothing when `landed` is empty.
7. `Not finished? Undo` as a secondary text button at the bottom.

The shelf state:

```tsx
const key = bookKey(book);
const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
const murals = useMurals();
const queryClient = useQueryClient();
const [shelf, setShelf] = useState<{ id: string; original: MuralBlock[]; blocks: MuralBlock[] } | null>(null);
const [landed, setLanded] = useState<Array<"finished" | "favourites">>([]);
const [shelfError, setShelfError] = useState<string | null>(null);

async function saveShelf(id: string, blocks: MuralBlock[]) {
  try {
    await murals.update(id, { blocks });
    await queryClient.invalidateQueries({ queryKey: ["murals", id] });
  } catch {
    setShelfError("Couldn't update your shelf.");
  }
}

async function updateShelf(rating: number | null) {
  const muralId = own.data?.muralId;
  if (!muralId) return;
  const current = shelf ?? { id: muralId, original: (await queryClient.fetchQuery({ queryKey: ["murals", muralId], queryFn: () => fetchMural(muralId) })).blocks, blocks: [] };
  const base = shelf ? shelf.blocks : current.original;
  const result = shelfAfterFinish(base, key, rating);
  setLanded((prev) => [...new Set([...prev, ...result.landed])]);
  setShelf({ ...current, blocks: result.blocks });
  if (result.blocks !== base) await saveShelf(muralId, result.blocks);
}
```

- Run `updateShelf(typeof book.Rating === "number" ? book.Rating : null)` once, when `own.data` first arrives (a `useEffect` keyed on `own.data?.muralId`, guarded by a ref so it runs once).
- If fetching the mural throws, `setShelfError("Couldn't update your shelf.")`. That shows as a `Toast`, and the rest of the sheet still works.
- `opponent = shelf ? favouriteOpponent(shelf.blocks, key) : null`. The opponent's title comes from the library's books (`useLibrary()`), matched with `bookKey`.

Note and close:

```tsx
const note = useRef("");
const settled = useRef(false);

function finish() {
  if (settled.current) return;
  settled.current = true;
  const text = note.current.trim();
  if (text) void addNote(book, text);
}
useEffect(() => finish, []);
```

- `Done` calls `finish()` then `onClose()`.
- Dismissing the sheet unmounts the screen, and the cleanup calls `finish()`, so the note saves either way.
- `onChangeText` updates both the state and `note.current`.

Undo:

```tsx
async function undo() {
  settled.current = true;
  const restored = await restoreRead(book, before);
  if (shelf && shelf.blocks !== shelf.original) await saveShelf(shelf.id, shelf.original);
  if (restored) onClose();
}
```

`restoreRead` already raises an `Alert` on failure, so the sheet stays open to retry.

- [ ] **Step 7: "How it landed" in the book sheet**

In `BookDetail.tsx`, add an `onSetRating: (book, rating: FinishRating) => void` prop. For finished books (`book.ReadStatus === 2`), render under the status control:

```tsx
{book.ReadStatus === 2 ? (
  <View style={{ gap: spacing.sm }}>
    <Text style={[typography.title, { color: colors.text }]}>How it landed</Text>
    <FeelingChips value={typeof book.Rating === "number" ? book.Rating : null} onChange={(rating) => onSetRating(book, rating)} />
  </View>
) : null}
```

In the book route, pass `onSetRating={(b, rating) => void setRating(b, rating)}`. Search `mobile/src` for other `<BookDetail` renders and pass the same prop there.

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck --workspace mobile && npm test --workspace mobile`
Expected: PASS.

```bash
/usr/bin/git add mobile/src
/usr/bin/git commit -m "Mobile: the finishing moment"
```

---

### Task 3: Web finishing moment

**Files:**
- Create: `frontend/src/components/FeelingChips.tsx`, `frontend/src/components/FinishSheet.tsx`
- Modify: `frontend/src/pages/LibraryPage.tsx` (`handleSetBookStatus` returns success; open the sheet; rating, note and undo handlers)
- Modify: `frontend/src/components/BookDetailSheet.tsx` (the "How it landed" row)

**Interfaces:**
- Consumes: Task 1's exports. `useMurals()` (`data`, `saveBlocks(id, blocks)`), `fetchOwnProfile` (`../api/community`), `updateLibrary`/`toast` as `LibraryPage` already uses them.

- [ ] **Step 1: `handleSetBookStatus` reports success**

Change it to `async function handleSetBookStatus(book, status): Promise<boolean>`. Return `false` when there's no cached library or when `updateLibrary` throws (keep the toast), and `true` after a successful save. Add state `const [finishing, setFinishing] = useState<{ key: string; before: ReadSnapshot } | null>(null);`, and pass `BookDetailSheet`:

```tsx
onSetStatus={async (b, status) => {
  const before = readSnapshot(b);
  const wasFinished = b.ReadStatus === 2;
  if ((await handleSetBookStatus(b, status)) && status === 2 && !wasFinished) setFinishing({ key: bookKey(b), before });
}}
```

- [ ] **Step 2: Library handlers**

Next to `handleSetBookStatus`, add three handlers. Each uses the same `updateLibrary` + `toast` shape and returns `Promise<boolean>`:
- `handleSetRating(book, rating)` maps the matching book through `setRating`. Toast: `Couldn't save the rating.`
- `handleAddNote(book, text)` maps through `addReaderNote(b, text, localDay(), newId())`. Toast: `Couldn't save your note.`
- `handleRestoreRead(book, before)` maps through `restoreReadState(b, before)`. Toast: `Couldn't undo the status change.`

- [ ] **Step 3: `FeelingChips` (web)**

```tsx
import { FINISH_FEELINGS, type FinishRating } from "@scripta/shared";

export function FeelingChips({ value, onChange }: { value: number | null; onChange: (rating: FinishRating) => void }) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {FINISH_FEELINGS.map(({ rating, label }) => {
        const selected = value === rating;
        return (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(rating)}
            className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${selected ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) bg-(--color-surface) hover:bg-(--color-surface-hover)"}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: `FinishSheet`**

`FinishSheet({ book, books, before, onSetRating, onAddNote, onRestoreRead, onClose })`, built on the existing `Sheet` (`title="Finished"`). It has the same content and behaviour as mobile Task 2 Step 6:
- the eyebrow with `formatFinishDay`, `Done` at the top right of the content, the cover (reuse the component `BookDetailSheet` uses for its cover), title and author;
- `FeelingChips` plus `Saved as your rating`, the `A thought to keep.` textarea, the `Against your favourite.` duel, the footer from the union of `landed`, and `Not finished? Undo`.

The shelf differs from mobile:
- It reads the own profile with `useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile })`.
- It takes the shelf mural's blocks from `useMurals().data?.find((m) => m.id === muralId)?.blocks`, and saves with `saveBlocks`.
- It keeps `{ id, original, blocks }` and the `landed` union exactly as mobile does, runs `shelfAfterFinish` once when the own profile and murals have loaded, and runs it again on each rating tap.
- A failed save shows `Couldn't update your shelf.` in the sheet.

Close:
- The note saves when the sheet closes by `Done`, the `Sheet`'s own close, or Escape/backdrop. All of them route through one `close()` that calls `onAddNote(book, text)` when the trimmed text isn't empty, then `onClose()`.
- Undo calls `onRestoreRead(book, before)`. When that resolves `true`, it restores the original shelf blocks if they changed, then calls `onClose()` without saving the note.

Render it in `LibraryPage` when `finishing` is set and its book exists: `<FinishSheet book={…} books={books} before={finishing.before} … onClose={() => setFinishing(null)} />`. It sits above the book sheet (check the z-index against `BookDetailSheet`'s `z-50`).

- [ ] **Step 5: "How it landed" in the book sheet**

Add an `onSetRating` prop to `BookDetailSheet`. When `book.ReadStatus === 2`, render under the status group:

```tsx
<div className="mt-4">
  <p className="text-sm font-semibold">How it landed</p>
  <div className="mt-2"><FeelingChips value={typeof book.Rating === "number" ? book.Rating : null} onChange={(rating) => onSetRating(book, rating)} /></div>
</div>
```

`LibraryPage` passes `onSetRating={(b, rating) => void handleSetRating(b, rating)}`.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: PASS, with no new lint warnings in touched files (baseline 16).

```bash
/usr/bin/git add frontend/src
/usr/bin/git commit -m "Web: the finishing moment"
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

- [ ] **Step 2: Device check (mobile)**

Run `node scripts/dev-status.mjs --json` once. If a stack slot and an emulator are free, run `node scripts/dev-emulator.mjs` from the worktree; otherwise say so and skip, without waiting. Don't change emulator settings or delete account data. If the account's shelf isn't from the My shelf preset, create a preset shelf the way PR 4's device check did (Murals → Start from a preset → My shelf, then Switch shelf mural…). At the end, switch back and delete only what you created.

Check, with screenshots:
- **From Home:** open a Reading book from Home → Finished. The moment opens **as a sheet over the book sheet**, and back returns to the book sheet and then Home.
- **From My shelf → Library:** the same book flow opens as a sheet there too.
- **Shelf moves:** the eyebrow shows today's date. The Finished shelf on My shelf now leads with that book, and the footer reads `Added to Finished on your shelf`.
- **Rating:** tapping `Loved it` shows `Saved as your rating`. With no Favourites shelf, the footer gains `, and to Favourites` and the shelf gains a Favourites block.
- **The duel:** with a Favourites shelf that has another book, `Against your favourite.` shows two covers. `This one` moves the book to the front of Favourites.
- **The note:** typing a note and dismissing the sheet by swipe saves it, and it appears under Highlights in the book sheet.
- **Undo:** `Not finished? Undo` on another book restores its previous status and progress, and the shelf is as it was.
- **How it landed:** a finished book's sheet shows the row, and changing the chip saves.
- **Not a trigger:** the moment does **not** open when choosing Finished on an already-finished book, or for Reading and To read.
- **Failed save:** stop your own stack's backend (only the port your slot claimed; check `node scripts/dev-status.mjs --json`), tap Finished on a Reading book, and confirm an error shows, the moment does **not** open, and the control shows the book's real status after the failed save. Restart the stack before continuing.

Run `npm run dev:release` at the end.

- [ ] **Step 3: Report**

List every check with pass/fail and counts, the screenshot paths, and anything left open. iOS isn't available here; say that the native iOS picker's behaviour after a failed save is unverified.

---

## Self-review

- Spec coverage:
  - `FINISH_FEELINGS`, `setRating`, `addReaderNote` (review shape; Rediscover ignores it because `Type !== "highlight"`), `shelfAfterFinish`, `favouriteOpponent`, `promoteFavourite`, and their unit tests are in Task 1.
  - Opening only after a successful save, never for imports or merges or when already finished: Task 2 Step 3 and Task 3 Step 1.
  - The shelf update on open (plus on rating, by ruling): Task 2 Step 6 and Task 3 Step 4.
  - Layout, Done, the three rows, the footer from `landed`, and the "How it landed" row: Tasks 2 and 3.
  - Privacy (nothing shared, no mention of followers): Global Constraints.
  - The mobile route declared in both stacks: Task 2 Step 4.
  - Local date parsing: `formatFinishDay`, tested in Sao Paulo time.
  - Mis-tap undo: the ruling, plus Task 2 Step 6 and Task 3 Step 4.
  - A failed save in the device pass: Task 4.
- Types: `FinishRating`, `ReadSnapshot`, `readSnapshot`, `restoreReadState`, `shelfAfterFinish(...).landed`, and `FeelingChips({ value, onChange })` carry the same names in every task.
