# Reader card A4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a reader card editor on web and mobile — counter, trait, layout, signature book with a note, highlight and the glyph switch — reached from "Edit card" in their own viewer and from Settings, with the owner's saved style and choices drawn on their own card everywhere.

**Architecture:**
- **Shared (`@scripta/shared`):**
  - `bookPassages`/`searchPassages` list a reader's real Kobo highlights.
  - `ownChosen` resolves the owner's signature book and highlight from the local library, and `readerCardInputOf` takes the owner's stored style.
  - `visitorView` turns the owner's input into what visitors see.
  - `counterThumbnail` scales the dial down for editor thumbnails.
  - `saveReaderCardStyle` is the optimistic save both clients wrap.
  - `COUNTER_LABELS`/`TRAIT_LABELS`/`LAYOUT_LABELS` are the option names.
- **Clients:**
  - Each gets a style query and a save hook over `createReaderCardApi` (A2).
  - Each extracts an inline `ReaderCardTurner` out of the A3 viewer, so the editor's preview and the full-screen viewer turn the card with the same code.
  - Each builds the editor from option, choice and glyph components.
- **Backend:** unchanged. `GET`/`PATCH /library/reader-card/style` (A2) and `PUT /community/profile/feed-settings` already exist.

**Tech Stack:** TypeScript, `node:test` via tsx, React 19 + Tailwind 4 + react-router 7 + TanStack Query 5 (web, SSR tests with `react-dom/server`), Expo Router / React Native 0.86, react-native-svg 15.15.4, Reanimated 4.5, react-native-pager-view 8.0.2 (mobile).

**Spec:** `docs/superpowers/specs/2026-10-07-reader-card-enrichment-design.md`: "Clients → Editor", "Clients → Pickers", "Clients → Components" ("Owner: sees an Edit card button"), the A4 row of "Phases", and the A0 decision on thumbnails.

**Starting point:**
- A3 (#207) and its follow-up (#210) are merged.
- Cut the execution worktree from `origin/main` and cherry-pick this plan's commit from the local branch `claude/reader-card-a4`.

## Decisions this plan takes

The spec is silent on these or the code contradicts it. Each is final for A4.

1. **Mobile route.** The route is `mobile/src/app/reader-card.tsx` (URL `/reader-card`), at the app root like `account-security.tsx`.
   - `(app)/` is a `Tabs` layout. A file there becomes a hidden tab with the tab bar still showing, not a screen "pushed above the tabs" as the spec intends.
2. **Options offered in A4.**
   - Offered: counter (5), trait (4), layout (3), signature book with its note, highlight, glyph switch.
   - Motto, footer, corners, finish and print arrive with A5/A6, per the spec's "the editor only offers options that are already drawn".
   - The note is offered now because A2 stores it and A3 draws it.
3. **Owner's chosen items.**
   - They are resolved on the device by `ownChosen`, mirroring the server's `chosenOf` (`backend/src/modules/library/publicResolver.ts:172`).
   - `workId` is `null`, because no renderer reads it.
   - The cover is `book._coverUrl`, else the client's already-resolved catalog thumb (`peekResolvedCover`), else `null`.
4. **Thumbnails.**
   - Only the counter has thumbnails in A4.
   - The A0 "simplified dial" is `thumbnailSegments`: it scales a large dial to about 24 marks, keeps every genre and its share of highlights, and adds no renderer option.
5. **Saving.**
   - `saveReaderCardStyle` writes the merged style to the cache at once.
   - It keeps the server's answer only if nothing newer was written meanwhile, and on failure it restores the previous style only if nothing newer was written.
   - The editor toasts "Couldn't save your reader card." and the field shows the restored value.
   - A signature patch always carries `{ bookKey, note }`, because the server replaces the whole signature and a missing note clears it.
6. **Note.**
   - Typing waits 600 ms, then saves.
   - Web also saves on blur, so a click that leaves the page keeps the note. Mobile's `useDebouncedCallback` flushes on unmount.
7. **Glyph switch.**
   - It saves at once, optimistically.
   - It sends the full five-field body built from the current `["community", "own-profile"]` data.
   - It tells an unpublished owner that the glyph shows once the shelf is published (`backend/src/modules/community/domain/visibility.ts:19`).
8. **Pickers.**
   - **Web signature book:** web reuses `BookSearchList` with `books.filter(isFinishedBook)`.
   - **Mobile book picker:** mobile extracts `BookPickerList` and uses it in `GroupDetail`, `MuralEditorScreen` and the editor.
   - **Highlight (both):** it only ever offers `bookPassages` (eligible Kobo highlights), because anything else gets a 400.
9. **Dots.**
   - The turner draws white dots on the viewer's black scrim, and `--color-text` / `colors.text` dots on the editor's page.

## Global Constraints

- **Code style:**
  - No comments in code (`AGENTS.md`).
  - Search with `rg`, and run git from the worktree root.
  - Stage and commit in one command. Commit bodies say why.
- **Shared builds:**
  - Run `npm run dev:link-deps` once per worktree.
  - Run `npm run build -w @scripta/shared` before any frontend or mobile typecheck or test, because consumers read `packages/shared/dist`.
  - The shared `tsconfig` excludes `*.test.ts`. Keep test files type-correct anyway.
- **Options:**
  - `COUNTERS = ["dial", "beads", "shelf", "frame", "ring"]`, `TRAITS = ["both", "seal", "line", "none"]`, `LAYOUTS = ["faces", "book", "merged"]`.
  - `SIGNATURE_NOTE_MAX = 60`.
  - Nothing else is offered in A4.
- **Labels (shared):**
  - Counter: Dial, Beads, Shelf, Frame, Ring.
  - Trait: both "Line and seal", seal "Seal", line "Line", none "None".
  - Layout: faces "Three faces", book "Book", merged "One back".
- **Query keys:** `["reader-card", "style"]` on both clients. The glyph reads and writes `["community", "own-profile"]`.
- **Errors and timing:**
  - A failed style save toasts `Couldn't save your reader card.` through `saveFailureMessage(error, …)`.
  - A failed glyph save toasts `Couldn't save the glyph setting.`
  - The note waits `600` ms.
- **Pickers:**
  - A signature book must satisfy `isFinishedBook`.
  - A highlight comes only from `bookPassages`/`searchPassages`.
  - The empty states are `Finish a book to choose your signature book.` and `No Kobo highlights yet.`
  - A stored choice the library no longer has reads `No longer in your library.` with Remove.
- **Privacy:**
  - The Visitors preview is `visitorView(input)`. It never carries `leaders`, `missing`, or the owner's plate line.
- **Routes:**
  - Web is `/dashboard/reader-card` inside `DashboardLayout`, imported plainly, because `App.tsx` lazy-loads nothing.
  - Mobile is `/reader-card`, pushed as `router.push("/reader-card" as never)` (`typedRoutes` is on and `.expo/types` is git-ignored).
- **Web:**
  - Transitions only under `motion-safe:`.
  - The token scanners in `frontend/scripts/test-*.mts` must stay green (no `text-white` on accent or danger).
- **Mobile:**
  - `Text` only from `mobile/src/ui/Text` (`textImports.test.ts`).
  - Shared values use `.get()`/`.set()`.
  - No new native dependency, so this ships over the air.
  - `reactCompiler` is on, so follow the Rules of React.
- **Not in A4:** motto, footer, corners, finish, print, shine (A5/A6), and sub-projects B, C and D.

## Review Focus

1. **A stored choice whose book or highlight is gone:** the card shows nothing chosen, and the editor says `No longer in your library.` with Remove. Nothing crashes. Pinned in Task 2 ("a choice whose book or highlight is gone…") and Task 8 ("a stored choice the library lost…").
2. **A save that fails (400, 429, offline):** the control shows the previous value, a toast says so, and a newer edit made meanwhile is not overwritten. Pinned in Task 4 and Task 5 ("saving shows the change at once and rolls back…").
3. **A note at its edges (60 characters, whitespace only, emoji, leaving within 600 ms):** input is capped at 60, whitespace saves as no note, and a note save always resends the bookKey. Pinned in Task 8 (counter and `maxlength`) and Task 14. The leave-within-600 ms case is checked on screen in Task 17.
4. **A reader with no finished books, no Kobo highlights, or an unwritten card:** they see the two empty states and the missing line, and every option still applies. Pinned in Task 8 and Task 10.
5. **Changing layout or You/Visitors while the preview shows its last page:** the preview restarts at page 1 with no blank face. It is keyed in Task 10 and Task 16, and checked on screen in Task 17.

---

### Task 1: Passages

**Files:**
- Create: `packages/shared/src/library/passages.ts`
- Modify: `packages/shared/src/library/index.ts` (add `export * from "./passages.js";` after `export * from "./readerCardFacts.js";`)
- Test: `packages/shared/src/library/passages.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Passage { bookKey: string; highlightId: string; text: string; title: string; author: string }
export const PASSAGE_MATCH_LIMIT: number;
export function bookLabel(book: Record<string, unknown>): { title: string; author: string };
export function bookPassages(book: Record<string, unknown>): Passage[];
export function searchPassages(books: Array<Record<string, unknown>>, query: string): Passage[];
```

- [ ] **Step 1: Write the failing test**

Create `passages.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { bookKey } from "./merge.js";
import { PASSAGE_MATCH_LIMIT, bookLabel, bookPassages, searchPassages } from "./passages.js";

const mark = (id: string, text: string, type = "highlight") => ({ Type: type, Text: text, BookmarkID: id });
const earthsea = { Title: "A Wizard of Earthsea", Attribution: "Ursula K. Le Guin", ReadStatus: 2, highlights: [mark("h1", "  To light a candle is to cast a shadow.  "), mark("h2", "a note", "note"), mark("h3", "   "), { Type: "highlight", Text: "no id" }] };
const dune = { Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1, highlights: [mark("d1", "Fear is the mind-killer."), mark("d2", "The candle and the sand.")] };

test("a book's passages are its real Kobo highlights, trimmed, with the book's title and author", () => {
  assert.deepEqual(bookPassages(earthsea), [{ bookKey: bookKey(earthsea), highlightId: "h1", text: "To light a candle is to cast a shadow.", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" }]);
  assert.deepEqual(bookPassages({ Title: "No marks" }), []);
});

test("a book with no title or author is labelled the way the public card labels it", () => {
  assert.deepEqual(bookLabel({ Title: "  " }), { title: "Untitled", author: "Unknown author" });
});

test("search matches passage text across every book, ignoring case, and blank finds nothing", () => {
  assert.deepEqual(searchPassages([earthsea, dune], "CANDLE").map((passage) => passage.highlightId), ["h1", "d2"]);
  assert.deepEqual(searchPassages([earthsea, dune], "herbert"), []);
  assert.deepEqual(searchPassages([earthsea, dune], "   "), []);
});

test("search stops at the match limit", () => {
  const many = { Title: "Many", highlights: Array.from({ length: PASSAGE_MATCH_LIMIT + 5 }, (_, i) => mark(`m${i}`, `word ${i}`)) };
  assert.equal(searchPassages([many], "word").length, PASSAGE_MATCH_LIMIT);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./passages.js` does not exist.

- [ ] **Step 3: Implement**

Create `passages.ts`:

```ts
import { isEligiblePassage } from "../murals/home.js";
import { bookKey } from "./merge.js";

type Book = Record<string, unknown>;

export interface Passage { bookKey: string; highlightId: string; text: string; title: string; author: string }

export const PASSAGE_MATCH_LIMIT = 50;

export function bookLabel(book: Book): { title: string; author: string } {
  return { title: String(book.Title ?? "").trim() || "Untitled", author: String(book.Attribution ?? "").trim() || "Unknown author" };
}

export function bookPassages(book: Book): Passage[] {
  const highlights = Array.isArray(book.highlights) ? book.highlights : [];
  const key = bookKey(book);
  const { title, author } = bookLabel(book);
  return highlights.filter(isEligiblePassage).map((highlight) => ({ bookKey: key, highlightId: String(highlight.BookmarkID), text: String(highlight.Text).trim(), title, author }));
}

export function searchPassages(books: Book[], query: string): Passage[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: Passage[] = [];
  for (const book of books) {
    for (const passage of bookPassages(book)) {
      if (!passage.text.toLowerCase().includes(needle)) continue;
      matches.push(passage);
      if (matches.length === PASSAGE_MATCH_LIMIT) return matches;
    }
  }
  return matches;
}
```

Add `export * from "./passages.js";` to `library/index.ts`, after the `readerCardFacts` line.

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/library && git commit -m "List a reader's Kobo highlights as passages and search them

The editor's highlight picker must only offer what the server accepts
(isEligiblePassage), so both clients take the list from shared.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: The owner's style and choices in the render input

**Files:**
- Modify: `packages/shared/src/library/readerCardFacts.ts`
- Test: `packages/shared/src/library/readerCardFacts.test.ts`

**Interfaces:**
- Consumes: `bookLabel`, `bookPassages` (Task 1).
- Produces:

```ts
export type CoverOf = (book: Record<string, unknown>) => string | null;
export interface OwnCardStyle { style: ReaderCardStyle; coverOf: CoverOf }
export function ownChosen(books: Array<Record<string, unknown>>, style: ReaderCardStyle, coverOf: CoverOf): ReaderCardChosen;
export function readerCardInputOf(books: Array<Record<string, unknown>>, groups: Group[], readerName: string, override?: PublicReaderCard, own?: OwnCardStyle): ReaderCardBase;
export function visitorView(input: ReaderCardBase): ReaderCardBase;
```

- [ ] **Step 1: Write the failing tests**

In `readerCardFacts.test.ts`, add `visitorView` to the import from `./readerCardFacts.js`. Then append:

```ts
test("the owner's input draws their saved style and resolves their choices from the local library", () => {
  const books = Array.from({ length: 6 }, (_, i) => book(i, { _genres: ["Fantasy"], highlights: mark(2) }));
  const style = { counter: "ring", layout: "book", trait: "seal", signature: { bookKey: bookKey(books[0]!), note: "lent twice" }, highlight: { bookKey: bookKey(books[1]!), highlightId: "h1" } } as const;
  const covers: string[] = [];
  const input = readerCardInputOf(books, [], "andre", undefined, { style, coverOf: (item) => { covers.push(String(item.Title)); return "https://covers.example.org/0.jpg"; } });
  assert.deepEqual(input.style, { counter: "ring", layout: "book", trait: "seal" });
  assert.deepEqual(input.card.chosen, {
    signature: { title: "Book 0", author: "Author 0", workId: null, coverUrl: "https://covers.example.org/0.jpg", note: "lent twice" },
    highlight: { text: "line 1", title: "Book 1", author: "Author 1" },
  });
  assert.deepEqual(covers, ["Book 0"]);
  assert.equal(input.view, "owner");
});

test("a choice whose book or highlight is gone is left out, and no style means the default with nothing chosen", () => {
  const books = [book(1, { highlights: [{ Type: "note", Text: "mine", BookmarkID: "n1" }] })];
  const style = { counter: "dial", layout: "faces", trait: "both", signature: { bookKey: "isbn:gone", note: null }, highlight: { bookKey: bookKey(books[0]!), highlightId: "n1" } } as const;
  assert.deepEqual(readerCardInputOf(books, [], "andre", undefined, { style, coverOf: () => null }).card.chosen, {});
  const plain = readerCardInputOf(books, [], "andre");
  assert.equal("chosen" in plain.card, false);
  assert.deepEqual(plain.style, { counter: "dial", layout: "faces", trait: "both" });
});

test("the visitors' preview of the owner's card drops the leaders, the missing line and the owner's plate line", () => {
  const books = Array.from({ length: 2 }, (_, i) => book(i, { _genres: ["Fantasy"] }));
  const owner = readerCardInputOf(books, [], "andre", undefined, { style: { counter: "beads", layout: "merged", trait: "line", signature: null, highlight: null }, coverOf: () => null });
  const visitor = visitorView(owner);
  assert.ok(owner.missing);
  assert.equal(visitor.view, "visitor");
  assert.equal(visitor.leaders, undefined);
  assert.equal(visitor.missing, undefined);
  assert.equal(visitor.unwrittenLine, "yet to be written");
  assert.deepEqual(visitor.style, owner.style);
  assert.deepEqual(visitor.card, { ...owner.card, style: owner.style });
});
```

The file already defines `book(i, fields)`, `mark(n)` (highlights `h0…h{n-1}` with text `line 0…`), and imports `bookKey`.

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL. `visitorView` is not exported, and the fifth argument is ignored.

- [ ] **Step 3: Implement**

In `readerCardFacts.ts`, add these imports:

```ts
import { bookLabel, bookPassages } from "./passages.js";
```

and widen the style import to:

```ts
import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, publicStyle, type ReaderCardChosen, type ReaderCardStyle } from "../readerCards/style.js";
```

Replace `readerCardInputOf` with:

```ts
export type CoverOf = (book: Book) => string | null;
export interface OwnCardStyle { style: ReaderCardStyle; coverOf: CoverOf }

export function ownChosen(books: Book[], style: ReaderCardStyle, coverOf: CoverOf): ReaderCardChosen {
  const chosen: ReaderCardChosen = {};
  const { signature, highlight } = style;
  const signed = signature ? books.find((item) => bookKey(item) === signature.bookKey) : undefined;
  if (signature && signed) chosen.signature = { ...bookLabel(signed), workId: null, coverUrl: coverOf(signed), note: signature.note };
  const marked = highlight ? books.find((item) => bookKey(item) === highlight.bookKey) : undefined;
  const passage = highlight && marked ? bookPassages(marked).find((item) => item.highlightId === highlight.highlightId) : undefined;
  if (passage) chosen.highlight = { text: passage.text, title: passage.title, author: passage.author };
  return chosen;
}

export function readerCardInputOf(books: Book[], groups: Group[], readerName: string, override?: PublicReaderCard, own?: OwnCardStyle): ReaderCardBase {
  const seed = seedOf(readerName);
  if (override) {
    return { card: override, style: publicStyle(normalizeReaderCardStyle(override.style)), view: "visitor", readerName, label: readerCardLabel(override), unwrittenLine: "yet to be written", seed };
  }
  const identity = readerIdentity(books, groups);
  const card: PublicReaderCard = { ...publicReaderCard(identity), ...readerCardFacts(books, groups, identity.identity), ...(own ? { chosen: ownChosen(books, own.style, own.coverOf) } : {}) };
  return { card, style: publicStyle(own?.style ?? DEFAULT_READER_CARD_STYLE), view: "owner", leaders: identity.leaders, missing: identity.missing, readerName, label: readerCardLabel(card), unwrittenLine: readerCardPlateLine(identity.missing), seed };
}

export function visitorView(input: ReaderCardBase): ReaderCardBase {
  return readerCardInputOf([], [], input.readerName, { ...input.card, style: input.style });
}
```

- [ ] **Step 4: Run the shared tests and every consumer's typecheck**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared && npm run typecheck -w frontend && npm run typecheck -w mobile`
Expected: PASS. The existing callers pass four arguments, which still compiles.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/library && git commit -m "Draw the owner's saved style and choices on their own card

The owner's card is built on the device, so its signature book and
highlight are resolved from the local library the way the server's
chosenOf resolves them for visitors. visitorView gives the editor's
Visitors preview exactly the public card.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: Counter thumbnails and option labels

**Files:**
- Create: `packages/shared/src/readerCards/thumbnail.ts`, `packages/shared/src/readerCards/labels.ts`
- Modify: `packages/shared/src/readerCards/index.ts`
- Test: `packages/shared/src/readerCards/thumbnail.test.ts`

**Interfaces:**
- Produces:

```ts
export const THUMBNAIL_MARKS: number;
export function thumbnailSegments(segments: DialSegment[]): DialSegment[];
export function counterThumbnail(input: ReaderCardBase, counter: Counter): ReaderCardBase;
export const COUNTER_LABELS: Record<Counter, string>;
export const TRAIT_LABELS: Record<Trait, string>;
export const LAYOUT_LABELS: Record<Layout, string>;
```

- [ ] **Step 1: Write the failing test**

Create `thumbnail.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DialSegment } from "../library/readerCardFacts.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { COUNTERS } from "./counters.js";
import { COUNTER_LABELS, LAYOUT_LABELS, TRAIT_LABELS } from "./labels.js";
import { renderReaderCard, type ReaderCardBase } from "./render.js";
import { seedOf } from "./seed.js";
import { LAYOUTS, TRAITS } from "./style.js";
import { THUMBNAIL_MARKS, counterThumbnail, thumbnailSegments } from "./thumbnail.js";

const large: DialSegment[] = [{ group: "corr", books: 146, marked: 60 }, { group: "star", books: 47, marked: 20 }, { group: "lamp", books: 53, marked: 7 }, { group: "unknown", books: 12, marked: 0 }];

test("a large dial scales to about two dozen marks, keeping every genre and its share of highlights", () => {
  const scaled = thumbnailSegments(large);
  const total = scaled.reduce((sum, segment) => sum + segment.books, 0);
  assert.ok(total <= THUMBNAIL_MARKS + scaled.length, String(total));
  assert.deepEqual(scaled.map((segment) => segment.group), ["corr", "star", "lamp", "unknown"]);
  for (const segment of scaled) {
    assert.ok(segment.books >= 1);
    assert.ok(segment.marked <= segment.books);
  }
  assert.ok(scaled[0]!.books > scaled[1]!.books);
});

test("a small dial is drawn as it is", () => {
  const small: DialSegment[] = [{ group: "star", books: 8, marked: 3 }];
  assert.equal(thumbnailSegments(small), small);
});

test("a thumbnail swaps the counter and draws far fewer marks than the card", () => {
  const card: PublicReaderCard = { state: "settled", identity: "corr", runnerUp: null, signal: null, coverage: [], dial: { segments: large }, facts: { finished: 258, highlights: 300, series: 0, since: null, edition: 2026 } };
  const input: ReaderCardBase = { card, style: { counter: "dial", layout: "faces", trait: "both" }, readerName: "andre", label: "Reader card", seed: seedOf("andre"), view: "owner" };
  const thumb = counterThumbnail(input, "beads");
  assert.equal(thumb.style.counter, "beads");
  assert.equal(thumb.card.facts, card.facts);
  const marks = (svg: string) => (svg.match(/<(circle|path|rect)\b/g) ?? []).length;
  assert.ok(marks(renderReaderCard({ ...thumb, print: "paper" })) < marks(renderReaderCard({ ...input, style: thumb.style, print: "paper" })) / 2);
});

test("a card without a dial stays without one", () => {
  const card: PublicReaderCard = { state: "unwritten", identity: null, runnerUp: null, signal: null, coverage: [] };
  const input: ReaderCardBase = { card, style: { counter: "dial", layout: "faces", trait: "both" }, readerName: "andre", label: "Reader card", seed: seedOf("andre") };
  assert.equal(counterThumbnail(input, "ring").card, card);
});

test("every option has a name", () => {
  assert.deepEqual(COUNTERS.map((key) => COUNTER_LABELS[key]), ["Dial", "Beads", "Shelf", "Frame", "Ring"]);
  assert.deepEqual(TRAITS.map((key) => TRAIT_LABELS[key]), ["Line and seal", "Seal", "Line", "None"]);
  assert.deepEqual(LAYOUTS.map((key) => LAYOUT_LABELS[key]), ["Three faces", "Book", "One back"]);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./thumbnail.js` and `./labels.js` do not exist.

- [ ] **Step 3: Implement**

Create `thumbnail.ts`:

```ts
import type { DialSegment } from "../library/readerCardFacts.js";
import type { Counter } from "./counters.js";
import type { ReaderCardBase } from "./render.js";

export const THUMBNAIL_MARKS = 24;

export function thumbnailSegments(segments: DialSegment[]): DialSegment[] {
  const total = segments.reduce((sum, segment) => sum + segment.books, 0);
  if (total <= THUMBNAIL_MARKS) return segments;
  return segments.map((segment) => {
    if (!segment.books) return segment;
    const books = Math.max(1, Math.round((segment.books * THUMBNAIL_MARKS) / total));
    return { ...segment, books, marked: Math.min(books, Math.round((segment.marked * books) / segment.books)) };
  });
}

export function counterThumbnail(input: ReaderCardBase, counter: Counter): ReaderCardBase {
  const { dial } = input.card;
  return { ...input, style: { ...input.style, counter }, card: dial ? { ...input.card, dial: { segments: thumbnailSegments(dial.segments) } } : input.card };
}
```

Create `labels.ts`:

```ts
import type { Counter } from "./counters.js";
import type { Layout, Trait } from "./style.js";

export const COUNTER_LABELS: Record<Counter, string> = { dial: "Dial", beads: "Beads", shelf: "Shelf", frame: "Frame", ring: "Ring" };
export const TRAIT_LABELS: Record<Trait, string> = { both: "Line and seal", seal: "Seal", line: "Line", none: "None" };
export const LAYOUT_LABELS: Record<Layout, string> = { faces: "Three faces", book: "Book", merged: "One back" };
```

In `readerCards/index.ts`, add:

```ts
export { THUMBNAIL_MARKS, counterThumbnail, thumbnailSegments } from "./thumbnail.js";
export { COUNTER_LABELS, LAYOUT_LABELS, TRAIT_LABELS } from "./labels.js";
```

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Scale the dial down for editor thumbnails and name each option

A0 measured a heavy card at over 50 ms to mount, so a thumbnail draws
about two dozen marks in the same genre proportions instead of one per
book. The option names live in shared so web and mobile read the same.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: Optimistic style save

**Files:**
- Create: `packages/shared/src/readerCards/save.ts`
- Modify: `packages/shared/src/readerCards/index.ts`
- Test: `packages/shared/src/readerCards/save.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ReaderCardStyleCache { get(): ReaderCardStyle | undefined; set(style: ReaderCardStyle): void }
export function saveReaderCardStyle(cache: ReaderCardStyleCache, patch: ReaderCardStylePatch, update: (patch: ReaderCardStylePatch) => Promise<ReaderCardStyle>): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

Create `save.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { saveReaderCardStyle } from "./save.js";
import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, type ReaderCardStyle } from "./style.js";

function memory(initial?: ReaderCardStyle) {
  let value = initial;
  const writes: ReaderCardStyle[] = [];
  return { writes, get: () => value, set: (style: ReaderCardStyle) => { value = style; writes.push(style); } };
}

test("a change shows at once and settles on what the server stored", async () => {
  const cache = memory(DEFAULT_READER_CARD_STYLE);
  let release!: (style: ReaderCardStyle) => void;
  const saving = saveReaderCardStyle(cache, { counter: "ring" }, () => new Promise((resolve) => { release = resolve; }));
  assert.equal(cache.get()!.counter, "ring");
  release({ ...DEFAULT_READER_CARD_STYLE, counter: "ring", trait: "seal" });
  await saving;
  assert.equal(cache.get()!.trait, "seal");
});

test("a failed change goes back to what was there and the error reaches the caller", async () => {
  const cache = memory({ ...DEFAULT_READER_CARD_STYLE, counter: "beads" });
  await assert.rejects(saveReaderCardStyle(cache, { counter: "ring" }, async () => { throw new Error("400"); }), /400/);
  assert.equal(cache.get()!.counter, "beads");
});

test("a newer change is never overwritten by an older answer", async () => {
  const cache = memory(DEFAULT_READER_CARD_STYLE);
  let failFirst!: (error: Error) => void;
  let answerFirst!: (style: ReaderCardStyle) => void;
  const first = saveReaderCardStyle(cache, { counter: "ring" }, () => new Promise((_, reject) => { failFirst = reject; }));
  void saveReaderCardStyle(cache, { trait: "none" }, () => new Promise(() => {}));
  failFirst(new Error("boom"));
  await assert.rejects(first);
  assert.equal(cache.get()!.trait, "none");
  const third = saveReaderCardStyle(cache, { layout: "book" }, () => new Promise((resolve) => { answerFirst = resolve; }));
  void saveReaderCardStyle(cache, { layout: "merged" }, () => new Promise(() => {}));
  answerFirst({ ...DEFAULT_READER_CARD_STYLE, layout: "book" });
  await third;
  assert.equal(cache.get()!.layout, "merged");
});

test("an empty cache starts from the default style, and a choice is normalised like the server does", async () => {
  const cache = memory();
  await saveReaderCardStyle(cache, { signature: { bookKey: "k", note: "  lent  " } }, async (patch) => normalizeReaderCardStyle({ ...DEFAULT_READER_CARD_STYLE, ...patch }));
  assert.deepEqual(cache.writes[0]!.signature, { bookKey: "k", note: "lent" });
  assert.equal(cache.writes[0]!.counter, "dial");
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./save.js` does not exist.

- [ ] **Step 3: Implement**

Create `save.ts`:

```ts
import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, type ReaderCardStyle, type ReaderCardStylePatch } from "./style.js";

export interface ReaderCardStyleCache { get(): ReaderCardStyle | undefined; set(style: ReaderCardStyle): void }

export async function saveReaderCardStyle(cache: ReaderCardStyleCache, patch: ReaderCardStylePatch, update: (patch: ReaderCardStylePatch) => Promise<ReaderCardStyle>): Promise<void> {
  const before = cache.get() ?? DEFAULT_READER_CARD_STYLE;
  const optimistic = normalizeReaderCardStyle({ ...before, ...patch });
  cache.set(optimistic);
  try {
    const saved = await update(patch);
    if (cache.get() === optimistic) cache.set(saved);
  } catch (error) {
    if (cache.get() === optimistic) cache.set(before);
    throw error;
  }
}
```

In `readerCards/index.ts`, add:

```ts
export { saveReaderCardStyle, type ReaderCardStyleCache } from "./save.js";
```

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Save reader card style changes optimistically

The editor redraws on every click, so the merged style goes into the
cache at once, the server's answer replaces it only if nothing newer was
written, and a failure restores the previous style on the same terms.
Both clients wrap this one function.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5: Web style query, save hook and the owner's card

**Files:**
- Create: `frontend/src/api/readerCard.ts`, `frontend/src/hooks/useReaderCardStyle.ts`
- Modify: `frontend/src/hooks/useReaderCard.ts`
- Test: `frontend/scripts/test-reader-card-style.mts`

**Interfaces:**
- Consumes: `createReaderCardApi` (A2), `saveReaderCardStyle` (Task 4), `readerCardInputOf(…, own)`, `CoverOf` (Task 2), `peekResolvedCover` (`frontend/src/api/covers.ts:31`), `coverParamsFor` (`frontend/src/components/BookCard.tsx:57`).
- Produces:
  - `READER_CARD_STYLE_KEY`
  - `useReaderCardStyle(enabled?: boolean)`
  - `useSaveReaderCardStyle(): (patch: ReaderCardStylePatch) => Promise<void>`
  - `coverOf: CoverOf`, exported from `hooks/useReaderCard.ts`
  - `useReaderCard(books, groups, readerName, override?)`, which now draws the owner's stored style.

- [ ] **Step 1: Write the failing test**

Create `frontend/scripts/test-reader-card-style.mts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_READER_CARD_STYLE, bookKey, type ReaderCardBase, type ReaderCardStyle } from "@scripta/shared";
import { useReaderCard } from "../src/hooks/useReaderCard";
import { READER_CARD_STYLE_KEY, useSaveReaderCardStyle } from "../src/hooks/useReaderCardStyle";

const books = [{ Title: "A Wizard of Earthsea", Attribution: "Ursula K. Le Guin", ReadStatus: 2, _coverUrl: "https://covers.example.org/e.jpg" }];
const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

test("the owner's card draws the stored style and choice; a visitor's card never reads it", () => {
  const client = queryClient();
  const style: ReaderCardStyle = { ...DEFAULT_READER_CARD_STYLE, counter: "ring", signature: { bookKey: bookKey(books[0]!), note: "lent" } };
  client.setQueryData(READER_CARD_STYLE_KEY, style);
  let owner!: ReaderCardBase;
  let visitor!: ReaderCardBase;
  function Probe() {
    owner = useReaderCard(books, [], "andre");
    visitor = useReaderCard(books, [], "andre", { state: "unwritten", identity: null, runnerUp: null, signal: null, coverage: [] });
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  assert.equal(owner.style.counter, "ring");
  assert.equal(owner.card.chosen?.signature?.coverUrl, "https://covers.example.org/e.jpg");
  assert.equal(owner.card.chosen?.signature?.note, "lent");
  assert.equal(visitor.view, "visitor");
  assert.equal(visitor.style.counter, "dial");
});

test("saving shows the change at once and rolls back when the server refuses", async () => {
  const client = queryClient();
  client.setQueryData(READER_CARD_STYLE_KEY, DEFAULT_READER_CARD_STYLE);
  let save!: ReturnType<typeof useSaveReaderCardStyle>;
  function Probe() { save = useSaveReaderCardStyle(); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  const originalFetch = globalThis.fetch;
  let seen: ReaderCardStyle | undefined;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.method, "PATCH");
      assert.deepEqual(JSON.parse(String(init.body)), { layout: "book" });
      seen = client.getQueryData<ReaderCardStyle>(READER_CARD_STYLE_KEY);
      return Response.json({ error: "Expected a reader card style change with known options." }, { status: 400 });
    };
    await assert.rejects(save({ layout: "book" }));
    assert.equal(seen?.layout, "book");
    assert.equal(client.getQueryData<ReaderCardStyle>(READER_CARD_STYLE_KEY)?.layout, "faces");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run build -w @scripta/shared && npm test -w frontend`
Expected: FAIL, because `useReaderCardStyle` does not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/api/readerCard.ts`:

```ts
import { createReaderCardApi } from "@scripta/shared";
import { request } from "./request";

export const { fetchReaderCardStyle, updateReaderCardStyle } = createReaderCardApi(request);
```

Create `frontend/src/hooks/useReaderCardStyle.ts`:

```ts
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { saveReaderCardStyle, type ReaderCardStyle, type ReaderCardStylePatch } from "@scripta/shared";
import { fetchReaderCardStyle, updateReaderCardStyle } from "../api/readerCard";

export const READER_CARD_STYLE_KEY = ["reader-card", "style"] as const;

export function useReaderCardStyle(enabled = true) {
  return useQuery({ queryKey: READER_CARD_STYLE_KEY, queryFn: fetchReaderCardStyle, enabled });
}

export function useSaveReaderCardStyle() {
  const client = useQueryClient();
  return useCallback(async (patch: ReaderCardStylePatch) => {
    await client.cancelQueries({ queryKey: READER_CARD_STYLE_KEY });
    await saveReaderCardStyle({ get: () => client.getQueryData<ReaderCardStyle>(READER_CARD_STYLE_KEY), set: (style) => client.setQueryData(READER_CARD_STYLE_KEY, style) }, patch, updateReaderCardStyle);
  }, [client]);
}
```

`frontend/src/hooks/useReaderCard.ts` becomes:

```ts
import { useMemo } from "react";
import { readerCardInputOf, type CoverOf, type Group, type PublicReaderCard } from "@scripta/shared";
import { peekResolvedCover } from "../api/covers";
import { coverParamsFor } from "../components/BookCard";
import { useReaderCardStyle } from "./useReaderCardStyle";

export const NO_GROUPS: Group[] = [];

export const coverOf: CoverOf = (book) => (typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : peekResolvedCover(coverParamsFor(book), "thumb") ?? null);

export function useReaderCard(books: Array<Record<string, unknown>>, groups: Group[], readerName: string, override?: PublicReaderCard) {
  const { data: style } = useReaderCardStyle(!override);
  return useMemo(() => readerCardInputOf(books, groups, readerName, override, override || !style ? undefined : { style, coverOf }), [books, groups, readerName, override, style]);
}
```

- [ ] **Step 4: Verify the frontend**

Run: `npm run build -w @scripta/shared && npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend`
Expected: all PASS, including the existing `test-reader-card.mts`.

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "Draw the owner's saved reader card style on web

The owner's mural block and viewer read the style the editor saves, and
visitors' cards (with a server card) never ask for it.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6: Web inline turner and "Edit card"

**Files:**
- Create: `frontend/src/components/readerCard/ReaderCardTurner.tsx`
- Modify: `frontend/src/components/readerCard/ReaderCardViewer.tsx`, `frontend/src/components/murals/MuralBlockDetail.tsx` (`ReaderCardDetailViewer`)
- Test: `frontend/scripts/test-reader-card.mts`

**Interfaces:**
- Produces:
  - `<ReaderCardTurner input cardWidth spreadWidth onScrim? autoFocus? />`
  - `<ReaderCardViewer input onClose onEdit? />`, which shows "Edit card" only when `input.view === "owner"` and `onEdit` is given.

- [ ] **Step 1: Write the failing tests**

In `test-reader-card.mts`, add `import { ReaderCardTurner } from "../src/components/readerCard/ReaderCardTurner";`. Then append:

```ts
test("the turner is inline: no dialog, and off the scrim its dots take the page's text colour", () => {
  const html = renderToString(createElement(ReaderCardTurner, { input: visitor("faces"), cardWidth: "w-64", spreadWidth: "w-full" }));
  assert.doesNotMatch(html, /role="dialog"/);
  assert.match(html, />Page 1 of 3</);
  const dots = html.slice(html.indexOf('aria-label="Pages"'));
  assert.match(dots, /bg-\(--color-text\)/);
  assert.doesNotMatch(dots, /bg-white/);
});

test("only the owner's viewer offers Edit card, and only when it can go somewhere", () => {
  const owner = readerCardInputOf([], [], "andre");
  const noop = () => undefined;
  assert.match(renderToString(createElement(ReaderCardViewer, { input: owner, onClose: noop, onEdit: noop })), />Edit card</);
  assert.doesNotMatch(renderToString(createElement(ReaderCardViewer, { input: owner, onClose: noop })), /Edit card/);
  assert.doesNotMatch(renderToString(createElement(ReaderCardViewer, { input: visitor("faces"), onClose: noop, onEdit: noop })), /Edit card/);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build -w @scripta/shared && npm test -w frontend`
Expected: FAIL, because `ReaderCardTurner` does not exist.

- [ ] **Step 3: Extract the turner**

Create `frontend/src/components/readerCard/ReaderCardTurner.tsx`. It holds everything of today's viewer except the overlay, the dialog, scroll lock, dismissal and the focus restore:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { hasChosen, readerCardPages, readerCardSummary, startTurn, turnBy, turnTo, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";
import { ReaderCardImage } from "./ReaderCardImage";

const TURN = "motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]";
const wideScreen = () => typeof window !== "undefined" && window.innerWidth >= 768 && !window.matchMedia?.("(pointer: coarse)").matches;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function ReaderCardTurner({ input, cardWidth, spreadWidth, onScrim = false, autoFocus = false }: { input: ReaderCardBase; cardWidth: string; spreadWidth: string; onScrim?: boolean; autoFocus?: boolean }) {
  const [wide] = useState(wideScreen);
  const steps = useMemo(() => readerCardPages(input.style.layout, input.view ?? "visitor", hasChosen(input.card.chosen)), [input]);
  const spread = wide && steps.some(Array.isArray) ? (steps[1] as [ReaderCardPage, ReaderCardPage]) : null;
  const pages = useMemo(() => steps.flat(), [steps]);
  const count = spread ? 2 : pages.length;
  const pager = input.style.layout === "book" && !spread;
  const [turn, setTurn] = useState(() => startTurn(count));
  const summary = useMemo(() => readerCardSummary(input), [input]);
  const focusRef = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (autoFocus) focusRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const left = turn.index * element.clientWidth;
    if (Math.abs(element.scrollLeft - left) > 1) element.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [turn.index]);

  useEffect(() => () => clearTimeout(settle.current), []);

  const syncIndex = (element: HTMLElement) => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const index = Math.round(element.scrollLeft / element.clientWidth);
      setTurn((state) => (state.index === index ? state : { ...state, index }));
    }, 100);
  };
  const go = (by: 1 | -1) => setTurn((state) => turnBy(state, by, count));
  const goTo = (to: number) => setTurn((state) => turnTo(state, to, to > state.index ? 1 : -1));
  const setFocus = (element: HTMLElement | null) => { focusRef.current = element; };
  const dot = (current: boolean) => (onScrim ? (current ? "bg-white" : "bg-white/40") : current ? "bg-(--color-text)" : "bg-(--color-text)/40");

  let card;
  if (spread) {
    const open = turn.index === 1;
    card = (
      <button ref={setFocus} type="button" aria-label={open ? "Close the card" : "Open the card"} onClick={() => go(1)} className={`relative aspect-[10/7] ${spreadWidth} [perspective:2400px] ${TURN}`} style={{ transform: open ? "none" : "translateX(-25%)" }}>
        <span aria-hidden="true" className="absolute inset-y-0 right-0 w-1/2"><ReaderCardImage input={input} page={spread[1]} className="h-full w-full" /></span>
        <span aria-hidden="true" className={`absolute inset-y-0 right-0 w-1/2 origin-left [transform-style:preserve-3d] ${TURN}`} style={{ transform: open ? "rotateY(-180deg)" : "rotateY(0deg)" }}>
          <span className="absolute inset-0 [backface-visibility:hidden]"><ReaderCardImage input={input} page="front" className="h-full w-full" /></span>
          <span className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]"><ReaderCardImage input={input} page={spread[0]} className="h-full w-full" /></span>
        </span>
      </button>
    );
  } else if (pager) {
    card = (
      <div
        ref={(element) => { scroller.current = element; setFocus(element); }}
        role="region"
        aria-label="Reader card pages"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); go(1); } }}
        onScroll={(event) => syncIndex(event.currentTarget)}
        className={`flex ${cardWidth} snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]`}
      >
        {pages.map((page, i) => <div key={i} aria-hidden="true" className="w-full shrink-0 snap-center"><ReaderCardImage input={input} page={page} className="w-full" /></div>)}
      </div>
    );
  } else {
    card = (
      <button ref={setFocus} type="button" aria-label={`Turn the card, page ${turn.index + 1} of ${count}`} onClick={() => go(1)} className={`relative aspect-[5/7] ${cardWidth} [perspective:1600px]`}>
        <span className={`absolute inset-0 [transform-style:preserve-3d] ${TURN}`} style={{ transform: `rotateY(${-turn.rotation}deg)` }}>
          {([0, 1] as const).map((face) => (
            <span key={face} aria-hidden="true" className="absolute inset-0 [backface-visibility:hidden]" style={face === 1 ? { transform: "rotateY(180deg)" } : undefined}>
              <ReaderCardImage input={input} page={pages[turn.faces[face]]!} className="h-full w-full" />
            </span>
          ))}
        </span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Reader card"
      className="flex flex-col items-center gap-3"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
      }}
    >
      {card}
      <p className="sr-only" aria-live="polite">{`Page ${turn.index + 1} of ${count}`}</p>
      <ul className="sr-only">{summary.map((line) => <li key={line}>{line}</li>)}</ul>
      <div className="flex" role="group" aria-label="Pages">
        {Array.from({ length: count }, (_, i) => (
          <button key={i} type="button" aria-label={`Page ${i + 1}`} aria-current={i === turn.index ? "true" : undefined} onClick={() => goTo(i)} className="flex h-11 w-11 items-center justify-center">
            <span className={`block h-2 w-2 rounded-full ${dot(i === turn.index)}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
```

`ReaderCardViewer.tsx` becomes:

```tsx
import { useEffect, useState } from "react";
import type { ReaderCardBase } from "@scripta/shared";
import { useDismissible } from "../../hooks/useDismissible";
import { useScrollLock } from "../../hooks/useScrollLock";
import { keepTabInside } from "../../lib/keepTabInside";
import { ReaderCardTurner } from "./ReaderCardTurner";

const CARD_WIDTH = "w-[min(88vw,calc((100dvh-10rem)*5/7))]";
const SPREAD_WIDTH = "w-[min(92vw,calc((100dvh-10rem)*10/7))]";
const PILL = "h-11 rounded-full bg-(--color-surface) px-4 text-(--color-text)";

export function ReaderCardViewer({ input, onClose, onEdit }: { input: ReaderCardBase; onClose: () => void; onEdit?: () => void }) {
  useScrollLock();
  useDismissible(onClose);
  const [previous] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
  useEffect(() => () => {
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
  }, [previous]);

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Reader card" className="flex flex-col items-center gap-3" onClick={(event) => event.stopPropagation()} onKeyDown={keepTabInside}>
        <div className="flex gap-2 self-end">
          {onEdit && input.view === "owner" ? <button type="button" onClick={onEdit} className={PILL}>Edit card</button> : null}
          <button type="button" onClick={onClose} className={PILL}>Close</button>
        </div>
        <ReaderCardTurner input={input} cardWidth={CARD_WIDTH} spreadWidth={SPREAD_WIDTH} onScrim autoFocus />
      </div>
    </div>
  );
}
```

The previous focus is captured during the first render (the `useState` initialiser). Child effects run before the viewer's own effects, so an effect would capture the card the turner just focused.

In `MuralBlockDetail.tsx`, add `useNavigate` to the `react-router-dom` import. `ReaderCardDetailViewer` becomes:

```tsx
function ReaderCardDetailViewer({ books, groups, readerCardOverride, readerName, onClose }: { books: Array<Record<string, unknown>>; groups: Group[]; readerCardOverride?: PublicReaderCard; readerName: string; onClose: () => void }) {
  const input = useReaderCard(books, groups, readerName, readerCardOverride);
  const navigate = useNavigate();
  return <ReaderCardViewer input={input} onClose={onClose} onEdit={readerCardOverride ? undefined : () => navigate("/dashboard/reader-card")} />;
}
```

- [ ] **Step 4: Verify the frontend**

Run: `npm run build -w @scripta/shared && npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend`
Expected: all PASS. The A3 viewer tests stay unchanged: dialog, live region, three dots, white dots on the scrim, `snap-x`.

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "Turn the web reader card inline, and offer Edit card in the owner's viewer

The editor's preview needs the viewer's turning without its overlay,
scroll lock and focus trap, so the card, dots and live region move into
ReaderCardTurner and the viewer wraps it.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7: Web option controls

**Files:**
- Create: `frontend/src/components/readerCard/ReaderCardOptions.tsx`
- Test: `frontend/scripts/test-reader-card-editor.mts`

**Interfaces:**
- Consumes: `counterThumbnail`, `COUNTER_LABELS`, `TRAIT_LABELS`, `LAYOUT_LABELS` (Task 3), `ReaderCardImage` (A3).
- Produces:
  - `<Segmented label options labels value onChange />`
  - `<ReaderCardOptions input onChange={(patch: ReaderCardStylePatch) => void} />`

- [ ] **Step 1: Write the failing test**

Create `frontend/scripts/test-reader-card-editor.mts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DEFAULT_READER_CARD_STYLE, readerCardInputOf } from "@scripta/shared";
import { ReaderCardOptions } from "../src/components/readerCard/ReaderCardOptions";

const books = Array.from({ length: 6 }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, _genres: ["Fantasy"] }));
const owner = readerCardInputOf(books, [], "andre", undefined, { style: { ...DEFAULT_READER_CARD_STYLE, counter: "beads", trait: "seal", layout: "book" }, coverOf: () => null });

test("five counter thumbnails, with only the chosen one checked", () => {
  const html = renderToString(createElement(ReaderCardOptions, { input: owner, onChange: () => undefined }));
  assert.equal(html.match(/role="radio"/g)?.length, 5);
  assert.equal(html.match(/aria-checked="true"/g)?.length, 1);
  assert.match(html, /aria-checked="true"[^>]*>(?:(?!<\/button>).)*Beads/s);
  for (const name of ["Dial", "Beads", "Shelf", "Frame", "Ring"]) assert.match(html, new RegExp(`>${name}<`));
});

test("trait and layout show their names and press the current one", () => {
  const html = renderToString(createElement(ReaderCardOptions, { input: owner, onChange: () => undefined }));
  for (const name of ["Line and seal", "Seal", "Line", "None", "Three faces", "Book", "One back"]) assert.match(html, new RegExp(`>${name}<`));
  assert.match(html, /aria-pressed="true"[^>]*>Seal</);
  assert.match(html, /aria-pressed="true"[^>]*>Book</);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run build -w @scripta/shared && npm test -w frontend`
Expected: FAIL, because `ReaderCardOptions` does not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/components/readerCard/ReaderCardOptions.tsx`:

```tsx
import { useMemo } from "react";
import { COUNTERS, COUNTER_LABELS, LAYOUTS, LAYOUT_LABELS, TRAITS, TRAIT_LABELS, counterThumbnail, type ReaderCardBase, type ReaderCardStylePatch } from "@scripta/shared";
import { ReaderCardImage } from "./ReaderCardImage";

export function Segmented<T extends string>({ label, options, labels, value, onChange }: { label: string; options: readonly T[]; labels: Record<T, string>; value: T; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
      {options.map((option, i) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`flex min-h-11 flex-1 items-center justify-center px-3 text-sm font-semibold ${i > 0 ? "border-l border-(--color-border)" : ""} ${value === option ? "bg-(--color-accent-soft) text-(--color-accent)" : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

export function ReaderCardOptions({ input, onChange }: { input: ReaderCardBase; onChange: (patch: ReaderCardStylePatch) => void }) {
  const { counter, trait, layout } = input.style;
  const thumbnails = useMemo(() => COUNTERS.map((option) => ({ option, input: counterThumbnail(input, option) })), [input]);
  return (
    <>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Counter</h3>
        <div role="radiogroup" aria-label="Counter" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {thumbnails.map(({ option, input: thumbnail }) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={counter === option}
              onClick={() => onChange({ counter: option })}
              className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 text-xs font-semibold ${counter === option ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}
            >
              <span aria-hidden="true" className="block w-full"><ReaderCardImage input={thumbnail} className="w-full" /></span>
              {COUNTER_LABELS[option]}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Second trait</h3>
        <Segmented label="Second trait" options={TRAITS} labels={TRAIT_LABELS} value={trait} onChange={(next) => onChange({ trait: next })} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Layout</h3>
        <Segmented label="Layout" options={LAYOUTS} labels={LAYOUT_LABELS} value={layout} onChange={(next) => onChange({ layout: next })} />
      </section>
    </>
  );
}
```

- [ ] **Step 4: Verify the frontend**

Run: `npm run build -w @scripta/shared && npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "Add the web reader card editor's counter, trait and layout controls

Each counter is previewed on the owner's own card, scaled down so five
thumbnails stay cheap to draw.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 8: Web signature book, note and highlight

**Files:**
- Create: `frontend/src/components/readerCard/ReaderCardChoices.tsx`
- Test: `frontend/scripts/test-reader-card-editor.mts`

**Interfaces:**
- Consumes:
  - `bookPassages`, `searchPassages`, `Passage` (Task 1)
  - `BookSearchList` (`frontend/src/components/murals/pickers.tsx:19`)
  - `isFinishedBook`, `bookKey`, `SIGNATURE_NOTE_MAX` (shared)
- Produces:
  - `type SaveStyle = (patch: ReaderCardStylePatch) => Promise<boolean>`
  - `<SignatureChoice books signature chosen onChange={SaveStyle} />`
  - `<HighlightChoice books highlight chosen onChange={SaveStyle} />`

- [ ] **Step 1: Write the failing tests**

In `test-reader-card-editor.mts`, add `import { HighlightChoice, SignatureChoice } from "../src/components/readerCard/ReaderCardChoices";` and `bookKey` to the `@scripta/shared` import. Then append:

```ts
const save = async () => true;
const finished = { Title: "A Wizard of Earthsea", Attribution: "Ursula K. Le Guin", ReadStatus: 2, highlights: [{ Type: "highlight", Text: "To light a candle", BookmarkID: "h1" }] };

test("a reader with no finished books is told how to get a signature book", () => {
  assert.match(renderToString(createElement(SignatureChoice, { books: [{ Title: "Reading", ReadStatus: 1 }], signature: null, onChange: save })), /Finish a book to choose your signature book\./);
});

test("the chosen signature book shows with its note, capped at sixty characters", () => {
  const html = renderToString(createElement(SignatureChoice, { books: [finished], signature: { bookKey: bookKey(finished), note: "lent twice" }, chosen: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: "lent twice" }, onChange: save }));
  assert.match(html, /A Wizard of Earthsea/);
  assert.match(html, /value="lent twice"/);
  assert.match(html, /maxLength="60"/i);
  assert.match(html, />10\/60</);
  assert.match(html, />Change</);
  assert.match(html, />Remove</);
});

test("a stored choice the library lost says so and can be removed", () => {
  const book = renderToString(createElement(SignatureChoice, { books: [finished], signature: { bookKey: "isbn:gone", note: null }, onChange: save }));
  assert.match(book, /No longer in your library\./);
  assert.match(book, />Remove</);
  const quote = renderToString(createElement(HighlightChoice, { books: [finished], highlight: { bookKey: "isbn:gone", highlightId: "x" }, onChange: save }));
  assert.match(quote, /No longer in your library\./);
});

test("a reader with no Kobo highlights is told so; a chosen highlight shows as a quote", () => {
  assert.match(renderToString(createElement(HighlightChoice, { books: [{ Title: "Notes only", highlights: [{ Type: "note", Text: "mine", BookmarkID: "n1" }] }], highlight: null, onChange: save })), /No Kobo highlights yet\./);
  const html = renderToString(createElement(HighlightChoice, { books: [finished], highlight: { bookKey: bookKey(finished), highlightId: "h1" }, chosen: { text: "To light a candle", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" }, onChange: save }));
  assert.match(html, /“To light a candle”/);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build -w @scripta/shared && npm test -w frontend`
Expected: FAIL, because `ReaderCardChoices` does not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/components/readerCard/ReaderCardChoices.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { SIGNATURE_NOTE_MAX, bookKey, bookPassages, isFinishedBook, searchPassages, type ChosenHighlight, type ChosenSignature, type Passage, type ReaderCardChosen, type ReaderCardStylePatch } from "@scripta/shared";
import { BookSearchList } from "../murals/pickers";

export type SaveStyle = (patch: ReaderCardStylePatch) => Promise<boolean>;
type Book = Record<string, unknown>;

const NOTE_DELAY_MS = 600;
const LINK = "text-xs font-semibold text-(--color-accent)";
const DIM = "text-sm text-(--color-text-dim)";

function NoteField({ signature, onChange }: { signature: ChosenSignature; onChange: SaveStyle }) {
  const [draft, setDraft] = useState(signature.note ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = (value: string) => {
    clearTimeout(timer.current);
    const note = value.trim() || null;
    if (note === signature.note) return;
    void onChange({ signature: { bookKey: signature.bookKey, note } }).then((saved) => { if (!saved) setDraft(signature.note ?? ""); });
  };
  return (
    <label className="mt-3 block text-xs text-(--color-text-dim)">
      Note
      <input
        value={draft}
        maxLength={SIGNATURE_NOTE_MAX}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => save(value), NOTE_DELAY_MS);
        }}
        onBlur={() => save(draft)}
        className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text)"
      />
      <span className="mt-1 block text-right">{`${draft.length}/${SIGNATURE_NOTE_MAX}`}</span>
    </label>
  );
}

export function SignatureChoice({ books, signature, chosen, onChange }: { books: Book[]; signature: ChosenSignature | null; chosen?: ReaderCardChosen["signature"]; onChange: SaveStyle }) {
  const finished = useMemo(() => books.filter(isFinishedBook), [books]);
  const [picking, setPicking] = useState(false);
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Signature book</h3>
      {signature && chosen ? <p className="text-sm">{chosen.title} <span className="text-(--color-text-dim)">— {chosen.author}</span></p> : null}
      {signature && !chosen ? <p className={DIM}>No longer in your library.</p> : null}
      {!signature && finished.length === 0 ? <p className={DIM}>Finish a book to choose your signature book.</p> : null}
      <div className="mt-2 flex gap-4">
        {finished.length > 0 ? <button type="button" className={LINK} onClick={() => setPicking((open) => !open)}>{picking ? "Cancel" : signature ? "Change" : "Choose"}</button> : null}
        {signature ? <button type="button" className={LINK} onClick={() => void onChange({ signature: null })}>Remove</button> : null}
      </div>
      {picking ? (
        <div className="mt-2">
          <BookSearchList
            books={finished}
            isSelected={(book) => bookKey(book) === signature?.bookKey}
            onSelect={(book) => {
              const key = bookKey(book);
              setPicking(false);
              void onChange({ signature: { bookKey: key, note: key === signature?.bookKey ? signature.note : null } });
            }}
          />
        </div>
      ) : null}
      {signature && chosen ? <NoteField key={signature.bookKey} signature={signature} onChange={onChange} /> : null}
    </section>
  );
}

export function HighlightChoice({ books, highlight, chosen, onChange }: { books: Book[]; highlight: ChosenHighlight | null; chosen?: ReaderCardChosen["highlight"]; onChange: SaveStyle }) {
  const withPassages = useMemo(() => books.filter((book) => bookPassages(book).length > 0), [books]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState<Book | null>(null);
  const matches = useMemo(() => searchPassages(books, query), [books, query]);
  const close = () => { setPicking(false); setBrowsing(null); setQuery(""); };
  const choose = (passage: Passage) => { close(); void onChange({ highlight: { bookKey: passage.bookKey, highlightId: passage.highlightId } }); };
  const list = (passages: Passage[]) => (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-(--color-border)">
      {passages.map((passage) => (
        <button key={`${passage.bookKey}:${passage.highlightId}`} type="button" onClick={() => choose(passage)} className="block w-full px-3 py-2 text-left text-sm hover:bg-(--color-surface-hover)">
          “{passage.text}” <span className="text-(--color-text-dim)">— {passage.title}</span>
        </button>
      ))}
    </div>
  );
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Highlight</h3>
      {highlight && chosen ? <p className="text-sm italic">“{chosen.text}” <span className="not-italic text-(--color-text-dim)">— {chosen.title}</span></p> : null}
      {highlight && !chosen ? <p className={DIM}>No longer in your library.</p> : null}
      {withPassages.length === 0 ? <p className={DIM}>No Kobo highlights yet.</p> : null}
      <div className="mt-2 flex gap-4">
        {withPassages.length > 0 ? <button type="button" className={LINK} onClick={() => (picking ? close() : setPicking(true))}>{picking ? "Cancel" : highlight ? "Change" : "Choose"}</button> : null}
        {highlight ? <button type="button" className={LINK} onClick={() => void onChange({ highlight: null })}>Remove</button> : null}
      </div>
      {picking ? (
        <div className="mt-2 space-y-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your highlights…" aria-label="Search your highlights" className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm" />
          {query.trim() ? (matches.length ? list(matches) : <p className={DIM}>No highlights match.</p>) : browsing ? (
            <>
              <button type="button" className={LINK} onClick={() => setBrowsing(null)}>Back to books</button>
              {list(bookPassages(browsing))}
            </>
          ) : (
            <BookSearchList books={withPassages} onSelect={setBrowsing} />
          )}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Verify the frontend**

Run: `npm run build -w @scripta/shared && npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "Add the web editor's signature book, note and highlight pickers

Only finished books and real Kobo highlights are offered, because the
server refuses anything else; a note save always resends its book,
because the server replaces the whole signature.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 9: Web glyph setting

**Files:**
- Create: `frontend/src/components/ToggleSwitch.tsx`, `frontend/src/components/readerCard/ReaderGlyphSetting.tsx`
- Modify:
  - `frontend/src/components/SocialsSection.tsx`: move `ToggleSwitch` (with its doc comment) out to the new file, exported, and import it back.
  - `frontend/src/components/OwnShelfView.tsx`: drop the glyph row.
- Test: `frontend/scripts/test-reader-card-editor.mts`

**Interfaces:**
- Consumes: `fetchOwnProfile`, `updateFeedSettings` (`frontend/src/api/community.ts`), `ownGlyphPreview`, `readerIdentity`, `ReaderGlyph`.
- Produces:
  - `<ToggleSwitch checked disabled? label onChange />`
  - `<ReaderGlyphSetting username books groups />`

- [ ] **Step 1: Write the failing tests**

In `test-reader-card-editor.mts`, add these imports:

```ts
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { ReaderGlyphSetting } from "../src/components/readerCard/ReaderGlyphSetting";
import { ToastProvider } from "../src/components/Toaster";
```

Then append:

```ts
test("the glyph switch reads the profile and says it waits for a published shelf", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(["community", "own-profile"], { muralId: null, published: false, feedSettings: { ...DEFAULT_FEED_SETTINGS, readerGlyph: true } });
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(ReaderGlyphSetting, { username: "andre", books: [], groups: [] }))));
  assert.match(html, /role="switch"[^>]*aria-checked="true"/);
  assert.match(html, /It shows once your shelf is published\./);
});

test("the glyph switch is gone from the shelf's profile sheet", () => {
  assert.doesNotMatch(readFileSync("src/components/OwnShelfView.tsx", "utf8"), /readerGlyph/);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build -w @scripta/shared && npm test -w frontend`
Expected: FAIL. `ReaderGlyphSetting` is missing, and `OwnShelfView.tsx` still contains `readerGlyph`.

- [ ] **Step 3: Implement**

Move the `ToggleSwitch` function, with its doc comment, from `SocialsSection.tsx` to a new `frontend/src/components/ToggleSwitch.tsx`, and add `export`. `SocialsSection.tsx` then imports it: `import { ToggleSwitch } from "./ToggleSwitch";`.

Create `frontend/src/components/readerCard/ReaderGlyphSetting.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ownGlyphPreview, readerIdentity, saveFailureMessage, type Group } from "@scripta/shared";
import { DEFAULT_FEED_SETTINGS, type OwnProfile } from "@scripta/shared/community";
import { fetchOwnProfile, updateFeedSettings } from "../../api/community";
import { ReaderGlyph } from "../ReaderGlyph";
import { useToast } from "../Toaster";
import { ToggleSwitch } from "../ToggleSwitch";

const OWN_PROFILE_KEY = ["community", "own-profile"] as const;
const LABEL = "Show my reader glyph next to my name";

export function ReaderGlyphSetting({ username, books, groups }: { username: string; books: Array<Record<string, unknown>>; groups: Group[] }) {
  const client = useQueryClient();
  const toast = useToast();
  const { data: profile } = useQuery({ queryKey: OWN_PROFILE_KEY, queryFn: fetchOwnProfile });
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => ownGlyphPreview(readerIdentity(books, groups)), [books, groups]);
  const settings = profile?.feedSettings ?? DEFAULT_FEED_SETTINGS;

  const toggle = async (readerGlyph: boolean) => {
    if (!profile) return;
    setBusy(true);
    client.setQueryData<OwnProfile>(OWN_PROFILE_KEY, { ...profile, feedSettings: { ...settings, readerGlyph } });
    try {
      await updateFeedSettings({ ...settings, readerGlyph });
      void client.invalidateQueries({ queryKey: ["community", "profile", username] });
    } catch (error) {
      client.setQueryData<OwnProfile>(OWN_PROFILE_KEY, profile);
      toast({ message: saveFailureMessage(error, "Couldn't save the glyph setting."), kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{LABEL}</h3>
        <ToggleSwitch checked={settings.readerGlyph ?? false} disabled={!profile || busy} label={LABEL} onChange={(next) => void toggle(next)} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-(--color-text-dim)">
        <span aria-hidden="true"><ReaderGlyph identity={preview.glyph ?? undefined} /></span>
        {preview.line}
      </p>
      {profile && !profile.published ? <p className="mt-1 text-xs text-(--color-text-dim)">It shows once your shelf is published.</p> : null}
    </section>
  );
}
```

In `OwnShelfView.tsx`, inside `OwnerControls`:
- Delete the glyph `<button>` (`aria-pressed={next.readerGlyph ?? false}`) and the `<p>` with `<ReaderGlyph …/>` and `{glyphPreview.line}`.
- Delete the `glyphPreview` `useMemo`, then the `const { data: library } = useLibrary();` line if nothing else in `OwnerControls` uses `library`.
- Remove every import that is now unused (`ownGlyphPreview`, `readerIdentity`, `ReaderGlyph`, and `useLibrary` if the file no longer uses it). Check each with `rg` in the file.
- `next` still starts from `feedSettings`, so "Save feed settings" keeps sending the stored `readerGlyph`.

- [ ] **Step 4: Verify the frontend**

Run: `npm run build -w @scripta/shared && npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "Move the web glyph switch into the reader card editor

It saves at once with the full feed-settings body, because the server
writes false for a missing readerGlyph, and it says the glyph only
shows once the shelf is published, which the old row never did.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 10: Web editor page, route and Settings entry

**Files:**
- Create: `frontend/src/pages/ReaderCardPage.tsx`
- Modify:
  - `frontend/src/App.tsx`: import the page, and add the route next to `/dashboard/settings`.
  - `frontend/src/pages/SettingsPage.tsx`: a "Reader card" section before `<AccountSecuritySection />`.
  - `frontend/README.md`: a row in "Pages at a glance", after `/dashboard/style`.
- Test: `frontend/scripts/test-reader-card-editor.mts`

**Interfaces:**
- Consumes: everything in Tasks 2–9.

- [ ] **Step 1: Write the failing test**

Append to `test-reader-card-editor.mts`:

```ts
test("the editor has its route and a way in from Settings", () => {
  assert.match(readFileSync("src/App.tsx", "utf8"), /path="\/dashboard\/reader-card" element={<ReaderCardPage \/>}/);
  assert.match(readFileSync("src/pages/SettingsPage.tsx", "utf8"), /to="\/dashboard\/reader-card"/);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -w frontend`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `frontend/src/pages/ReaderCardPage.tsx`:

```tsx
import { useMemo, useState } from "react";
import { hasChosen, readerCardInputOf, saveFailureMessage, visitorView, type ReaderCardStylePatch } from "@scripta/shared";
import { useAuth } from "../auth/AuthContext";
import { HighlightChoice, SignatureChoice } from "../components/readerCard/ReaderCardChoices";
import { ReaderCardOptions, Segmented } from "../components/readerCard/ReaderCardOptions";
import { ReaderCardTurner } from "../components/readerCard/ReaderCardTurner";
import { ReaderGlyphSetting } from "../components/readerCard/ReaderGlyphSetting";
import { useToast } from "../components/Toaster";
import { useLibrary } from "../hooks/useLibrary";
import { NO_GROUPS, coverOf } from "../hooks/useReaderCard";
import { useReaderCardStyle, useSaveReaderCardStyle } from "../hooks/useReaderCardStyle";

const NO_BOOKS: Array<Record<string, unknown>> = [];
const AUDIENCES = ["you", "visitors"] as const;
const AUDIENCE_LABELS = { you: "You", visitors: "Visitors" };

export function ReaderCardPage() {
  const { session } = useAuth();
  const readerName = session?.user.username ?? "reader";
  const { data: library } = useLibrary();
  const books = library?.data.books ?? NO_BOOKS;
  const groups = library?.data.groups ?? NO_GROUPS;
  const { data: style, isPending, isError, refetch } = useReaderCardStyle();
  const save = useSaveReaderCardStyle();
  const toast = useToast();
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>("you");
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, undefined, style ? { style, coverOf } : undefined), [books, groups, readerName, style]);
  const preview = useMemo(() => (audience === "you" ? input : visitorView(input)), [audience, input]);

  const change = async (patch: ReaderCardStylePatch) => {
    try {
      await save(patch);
      return true;
    } catch (error) {
      toast({ message: saveFailureMessage(error, "Couldn't save your reader card."), kind: "error" });
      return false;
    }
  };

  if (isPending) return <p className="px-5 py-8 text-sm text-(--color-text-dim)">Loading your reader card…</p>;
  if (isError || !style) {
    return (
      <div className="px-5 py-8">
        <button type="button" onClick={() => void refetch()} className="text-sm font-semibold text-(--color-accent)">Couldn't load your reader card. Try again</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-5 sm:py-8">
      <h2 className="mb-6 text-lg font-bold">Reader card</h2>
      <div className="lg:grid lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-8">
        <div className="mb-6 flex flex-col items-center gap-3 lg:sticky lg:top-6 lg:mb-0 lg:self-start">
          <div className="w-full max-w-[18rem]">
            <Segmented label="Preview as" options={AUDIENCES} labels={AUDIENCE_LABELS} value={audience} onChange={setAudience} />
          </div>
          <ReaderCardTurner key={`${preview.view}-${preview.style.layout}-${hasChosen(preview.card.chosen)}`} input={preview} cardWidth="w-[min(100%,18rem)]" spreadWidth="w-full" />
          {input.card.state === "unwritten" && input.missing ? <p className="text-sm text-(--color-text-dim)">{input.missing}</p> : null}
        </div>
        <div className="space-y-6">
          <ReaderCardOptions input={input} onChange={(patch) => void change(patch)} />
          <SignatureChoice books={books} signature={style.signature} chosen={input.card.chosen?.signature} onChange={change} />
          <HighlightChoice books={books} highlight={style.highlight} chosen={input.card.chosen?.highlight} onChange={change} />
          <ReaderGlyphSetting username={readerName} books={books} groups={groups} />
        </div>
      </div>
    </div>
  );
}
```

In `App.tsx`:
- Add `import { ReaderCardPage } from "./pages/ReaderCardPage";` in the alphabetical import block.
- Add `<Route path="/dashboard/reader-card" element={<ReaderCardPage />} />` next to the `/dashboard/settings` route.

In `SettingsPage.tsx`:
- Add `import { Link } from "react-router-dom";`.
- Before `<AccountSecuritySection />`, add:

```tsx
      <section className="mt-5 rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
        <h3 className="mb-1 text-sm font-semibold">Reader card</h3>
        <p className="mb-3 text-xs text-(--color-text-dim)">Choose your card's counter, layout, signature book and highlight.</p>
        <Link to="/dashboard/reader-card" className="text-xs font-semibold text-(--color-accent)">Edit card</Link>
      </section>
```

In `frontend/README.md`'s "Pages at a glance" table, after the `/dashboard/style` row, add:

```markdown
| `/dashboard/reader-card` | `ReaderCardPage.tsx` | the reader card editor: counter, trait, layout, signature book and note, highlight, glyph; reached from "Edit card" in your own card's viewer and from Settings |
```

- [ ] **Step 4: Verify the frontend**

Run: `npm run build -w @scripta/shared && npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "Add the web reader card editor at /dashboard/reader-card

The preview turns like the real viewer, as you or as visitors see it,
and restarts on its first page when the layout or audience changes,
because the page list changes with them.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 11: Mobile style query, save hook and the owner's card

**Files:**
- Create: `mobile/src/features/readerCard/api.ts`, `mobile/src/features/readerCard/useReaderCardStyle.ts`
- Modify:
  - `mobile/src/features/library/components/CoverImage.tsx`: export `coverParamsFor`.
  - `mobile/src/features/murals/ReaderCardBlock.tsx`.

**Interfaces:**
- Consumes: `createReaderCardApi`, `saveReaderCardStyle`, `readerCardInputOf(…, own)`, `CoverOf`, `peekResolvedCover` (`mobile/src/features/library/api/covers.ts:30`).
- Produces:
  - `READER_CARD_STYLE_KEY`
  - `useReaderCardStyle(enabled?)`
  - `useSaveReaderCardStyle()`
  - `coverOf: CoverOf`, all from `features/readerCard/useReaderCardStyle.ts`.

There is no React Native renderer in the mobile tests. The logic here is pinned by Tasks 2 and 4 in shared, and the screen is checked in Task 17.

- [ ] **Step 1: Implement**

Create `mobile/src/features/readerCard/api.ts`:

```ts
import { createReaderCardApi } from "@scripta/shared";
import { request } from "../../core/api";

export const { fetchReaderCardStyle, updateReaderCardStyle } = createReaderCardApi(request);
```

In `CoverImage.tsx`, change `function coverParamsFor(` to `export function coverParamsFor(`.

Create `mobile/src/features/readerCard/useReaderCardStyle.ts`:

```ts
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { saveReaderCardStyle, type CoverOf, type ReaderCardStyle, type ReaderCardStylePatch } from "@scripta/shared";
import { peekResolvedCover } from "../library/api/covers";
import { coverParamsFor } from "../library/components/CoverImage";
import { fetchReaderCardStyle, updateReaderCardStyle } from "./api";

export const READER_CARD_STYLE_KEY = ["reader-card", "style"] as const;

export const coverOf: CoverOf = (book) => (typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : peekResolvedCover(coverParamsFor(book), "thumb") ?? null);

export function useReaderCardStyle(enabled = true) {
  return useQuery({ queryKey: READER_CARD_STYLE_KEY, queryFn: fetchReaderCardStyle, enabled });
}

export function useSaveReaderCardStyle() {
  const client = useQueryClient();
  return useCallback(async (patch: ReaderCardStylePatch) => {
    await client.cancelQueries({ queryKey: READER_CARD_STYLE_KEY });
    await saveReaderCardStyle({ get: () => client.getQueryData<ReaderCardStyle>(READER_CARD_STYLE_KEY), set: (style) => client.setQueryData(READER_CARD_STYLE_KEY, style) }, patch, updateReaderCardStyle);
  }, [client]);
}
```

In `ReaderCardBlock.tsx`:
- Import `coverOf` and `useReaderCardStyle` from `../readerCard/useReaderCardStyle`.
- Replace the `input` line with:

```tsx
  const { data: style } = useReaderCardStyle(!publicCard);
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, publicCard, publicCard || !style ? undefined : { style, coverOf }), [books, groups, readerName, publicCard, style]);
```

- [ ] **Step 2: Verify mobile**

Run: `npm run build -w @scripta/shared && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add mobile && git commit -m "Draw the owner's saved reader card style on mobile

The owner's mural block reads the style the editor saves; visitors'
cards keep the server's card and never ask for it.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 12: Mobile inline turner and "Edit card"

**Files:**
- Create: `mobile/src/features/murals/ReaderCardTurner.tsx`
- Modify: `mobile/src/features/murals/ReaderCardViewer.tsx`, `mobile/src/features/murals/ReaderCardBlock.tsx`

**Interfaces:**
- Produces:
  - `<ReaderCardTurner input width onScrim? />`
  - `<ReaderCardViewer input onClose onEdit? />`, with "Edit card" only for `input.view === "owner"` with `onEdit`.

- [ ] **Step 1: Extract the turner**

Create `mobile/src/features/murals/ReaderCardTurner.tsx`. It takes the turning state, effects, faces, pager and dots out of today's viewer unchanged:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import PagerView from "react-native-pager-view";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { hasChosen, readerCardPages, readerCardSummary, startTurn, turnBy, turnTo, type ReaderCardBase } from "@scripta/shared";
import { MOTION } from "@scripta/shared/themes";
import { minimumTouchTarget, radii, spacing, useReducedMotion, useTheme } from "../../ui";
import { PLATE_RATIO, ReaderCardImage } from "./ReaderCardImage";

const EASE = Easing.bezier(MOTION.ease[0], MOTION.ease[1], MOTION.ease[2], MOTION.ease[3]);
const TURN_MS = 450;
const DOT_ON_SCRIM = "#ffffff";

export function ReaderCardTurner({ input, width, onScrim = false }: { input: ReaderCardBase; width: number; onScrim?: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const pages = useMemo(() => readerCardPages(input.style.layout, input.view ?? "visitor", hasChosen(input.card.chosen)).flat(), [input]);
  const summary = useMemo(() => readerCardSummary(input).join(" "), [input]);
  const [turn, setTurn] = useState(() => startTurn(pages.length));
  const rotation = useSharedValue(0);
  const pager = useRef<PagerView>(null);
  const announced = useRef(false);
  const isPager = input.style.layout === "book";

  useEffect(() => {
    rotation.set(reduced ? turn.rotation : withTiming(turn.rotation, { duration: TURN_MS, easing: EASE, reduceMotion: ReduceMotion.System }));
  }, [turn.rotation, reduced, rotation]);

  useEffect(() => {
    if (!isPager || !pager.current) return;
    if (reduced) pager.current.setPageWithoutAnimation(turn.index);
    else pager.current.setPage(turn.index);
  }, [turn.index, isPager, reduced]);

  useEffect(() => {
    if (!announced.current) {
      announced.current = true;
      return;
    }
    AccessibilityInfo.announceForAccessibility(`Page ${turn.index + 1} of ${pages.length}`);
  }, [turn.index, pages.length]);

  const faceA = useAnimatedStyle(() => ({ transform: [{ perspective: 1600 }, { rotateY: `${-rotation.get()}deg` }] }));
  const faceB = useAnimatedStyle(() => ({ transform: [{ perspective: 1600 }, { rotateY: `${180 - rotation.get()}deg` }] }));
  const size = { width, height: width * PLATE_RATIO };
  const dotColor = onScrim ? DOT_ON_SCRIM : colors.text;

  return (
    <View style={styles.turner}>
      {isPager ? (
        <PagerView ref={pager} initialPage={0} onPageSelected={(event) => { const index = event.nativeEvent.position; setTurn((state) => (state.index === index ? state : { ...state, index })); }} style={size}>
          {pages.map((page, i) => (
            <View key={i} collapsable={false} accessible accessibilityRole="image" accessibilityLabel={i === 0 ? `${summary} Page 1 of ${pages.length}.` : `Page ${i + 1} of ${pages.length}`}>
              <ReaderCardImage input={input} page={page} width={width} />
            </View>
          ))}
        </PagerView>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`${summary} Page ${turn.index + 1} of ${pages.length}.`} accessibilityHint="Turns the card" onPress={() => setTurn((state) => turnBy(state, 1, pages.length))} style={size}>
          <Animated.View style={[styles.face, faceA]}><ReaderCardImage input={input} page={pages[turn.faces[0]]!} width={width} /></Animated.View>
          <Animated.View style={[styles.face, faceB]}><ReaderCardImage input={input} page={pages[turn.faces[1]]!} width={width} /></Animated.View>
        </Pressable>
      )}
      <View style={styles.dots}>
        {pages.map((_, i) => (
          <Pressable key={i} accessibilityLabel={`Page ${i + 1}`} accessibilityRole="button" accessibilityState={{ selected: i === turn.index }} onPress={() => setTurn((state) => turnTo(state, i, i > state.index ? 1 : -1))} style={styles.dot}>
            <View style={[styles.dotMark, { backgroundColor: dotColor, opacity: i === turn.index ? 1 : 0.4 }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  turner: { alignItems: "center", gap: spacing.md },
  face: { ...StyleSheet.absoluteFill, backfaceVisibility: "hidden" },
  dots: { flexDirection: "row" },
  dot: { width: minimumTouchTarget, height: minimumTouchTarget, alignItems: "center", justifyContent: "center" },
  dotMark: { width: spacing.sm, height: spacing.sm, borderRadius: radii.full },
});
```

`ReaderCardViewer.tsx` becomes:

```tsx
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReaderCardBase } from "@scripta/shared";
import { Icon, minimumTouchTarget, radii, spacing, typography, useReducedMotion, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { PLATE_RATIO } from "./ReaderCardImage";
import { ReaderCardTurner } from "./ReaderCardTurner";

const BACKDROP = "rgba(0, 0, 0, 0.7)";

export function ReaderCardViewer({ input, onClose, onEdit }: { input: ReaderCardBase; onClose: () => void; onEdit?: () => void }) {
  const { colors } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const width = Math.max(0, Math.min(screenWidth - spacing.xl * 2, (screenHeight - insets.top - insets.bottom - 160) / PLATE_RATIO));

  return (
    <Modal animationType={reduced ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent transparent visible>
      <View style={[styles.backdrop, { backgroundColor: BACKDROP, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Pressable accessible={false} importantForAccessibility="no" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.content}>
          <View style={[styles.bar, { width }]}>
            {onEdit && input.view === "owner" ? (
              <Pressable accessibilityRole="button" onPress={onEdit} style={[styles.pill, { backgroundColor: colors.surface }]}>
                <Text style={[typography.body, { color: colors.text }]}>Edit card</Text>
              </Pressable>
            ) : <View />}
            <Pressable accessibilityLabel="Close reader card" accessibilityRole="button" hitSlop={8} onPress={onClose} style={[styles.close, { backgroundColor: colors.surface }]}>
              <Icon name="close" color={colors.text} />
            </Pressable>
          </View>
          <ReaderCardTurner input={input} width={width} onScrim />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { alignItems: "center", gap: spacing.md },
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pill: { minHeight: minimumTouchTarget, paddingHorizontal: spacing.lg, borderRadius: radii.full, justifyContent: "center" },
  close: { minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
});
```

"Edit card" shares the close button's row, so the 160 pt height reserve is unchanged.

In `ReaderCardBlock.tsx`, add `import { router } from "expo-router";` and change the viewer line to:

```tsx
      {open ? <ReaderCardViewer input={input} onClose={() => setOpen(false)} onEdit={publicCard ? undefined : () => { setOpen(false); router.push("/reader-card" as never); }} /> : null}
```

This closes, then pushes, in one handler, the same way `arena/DuelSideRow.tsx:20` does.

- [ ] **Step 2: Verify mobile**

Run: `npm run build -w @scripta/shared && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile`
Expected: PASS, including `textImports.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add mobile && git commit -m "Turn the mobile reader card inline, and offer Edit card in the owner's viewer

The editor's preview needs the viewer's turning without its Modal, so
the card and dots move into ReaderCardTurner; off the black scrim the
dots take the theme's text colour.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 13: Mobile book picker

**Files:**
- Create: `mobile/src/features/library/components/BookPickerList.tsx`
- Modify:
  - `mobile/src/features/library/components/GroupDetail.tsx`: `BookPickerSheet`, around 240-283.
  - `mobile/src/features/murals/MuralEditorScreen.tsx`: the book step of the content sheet, around 306-322.

**Interfaces:**
- Produces: `<BookPickerList books onSelect isSelected? label? />`, which renders inside a parent `ScrollView`.

- [ ] **Step 1: Implement the list**

Create `BookPickerList.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { bookKey } from "@scripta/shared";
import { Input, minimumTouchTarget, radii, spacing, typography, useTheme } from "../../../ui";
import { Text } from "../../../ui/Text";

type Book = Record<string, unknown>;

export function BookPickerList({ books, onSelect, isSelected, label = "Search your library" }: { books: Book[]; onSelect: (book: Book) => void; isSelected?: (book: Book) => boolean; label?: string }) {
  const { colors } = useTheme();
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? books.filter((book) => String(book.Title ?? "").toLowerCase().includes(needle) || String(book.Attribution ?? "").toLowerCase().includes(needle)) : books;
  }, [books, search]);
  return (
    <View style={styles.list}>
      <Input label={label} value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
      {filtered.length === 0 ? <Text style={[typography.body, { color: colors.textDim }]}>No books match.</Text> : null}
      {filtered.map((book, i) => {
        const selected = isSelected?.(book) ?? false;
        return (
          <Pressable
            key={`${bookKey(book)}:${i}`}
            accessibilityRole={isSelected ? "checkbox" : "button"}
            accessibilityState={isSelected ? { checked: selected } : undefined}
            accessibilityLabel={String(book.Title ?? "Untitled")}
            onPress={() => onSelect(book)}
            style={[styles.row, { backgroundColor: selected ? colors.accentSoft : "transparent" }]}
          >
            <Text style={[typography.body, styles.grow, { color: colors.text }]} numberOfLines={1}>
              {String(book.Title ?? "Untitled")} — <Text style={{ color: colors.textDim }}>{String(book.Attribution ?? "Unknown author")}</Text>
            </Text>
            <Text style={{ color: colors.accent, fontWeight: "700" }}>{selected ? "✓" : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: minimumTouchTarget, paddingHorizontal: spacing.sm, borderRadius: radii.md },
  grow: { flex: 1 },
});
```

- [ ] **Step 2: Use it in GroupDetail**

In `BookPickerSheet`:
- Keep the `Sheet` and its `ScrollView`.
- Replace the `Input`, the "No books match." line and the `filtered.map(…)` with:

```tsx
        <BookPickerList books={allBooks} isSelected={(book) => memberKeys.has(bookKey(book))} onSelect={(book) => onToggle(book, memberKeys.has(bookKey(book)))} />
```

- Delete the `search` state, `needle`, `filtered`, and the `pickerRow` style if nothing else uses them.
- Remove imports that become unused.

- [ ] **Step 3: Use it in MuralEditorScreen**

In the content sheet, replace the book step's `<Input label="Search books" … />` and `filteredBooks.map(…)` with:

```tsx
<BookPickerList
  books={books}
  label="Search books"
  isSelected={selected?.type === "shelf" ? (book) => selected.bookKeys.includes(bookKey(book)) : undefined}
  onSelect={(book) => {
    if (selected?.type === "quote" || selected?.type === "quoteCollection") { setQuoteBook(book); return; }
    updateSelected((block) => {
      const key = bookKey(book);
      if (block.type === "spotlight") return { ...block, bookKey: key };
      if (block.type === "shelf") return { ...block, collectionId: undefined, bookKeys: block.bookKeys.includes(key) ? block.bookKeys.filter((item) => item !== key) : [...block.bookKeys, key] };
      return block;
    });
    if (selected?.type !== "shelf") setPicking(null);
  }}
/>
```

That `onSelect` body is today's `onPress` body, unchanged.
- Delete `search`/`setSearch`, `needle` and `filteredBooks`.
- In the empty-state condition, change `(picking === "book" && filteredBooks.length === 0)` to `(picking === "book" && books.length === 0)`.
- Check with `rg -n 'setSearch|filteredBooks|needle' src/features/murals/MuralEditorScreen.tsx` that nothing else used them.

- [ ] **Step 4: Verify mobile**

Run: `npm run build -w @scripta/shared && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile && git commit -m "Extract one mobile book picker for groups, murals and the reader card

GroupDetail and the mural editor each carried their own search-and-list
copy; the reader card editor needs a third, so all three share one.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 14: Mobile option controls and choices

**Files:**
- Create: `mobile/src/features/readerCard/ReaderCardOptions.tsx`, `mobile/src/features/readerCard/ReaderCardChoices.tsx`

**Interfaces:**
- Consumes:
  - `counterThumbnail` and the option labels (Task 3); `bookPassages`, `searchPassages` (Task 1)
  - `BookPickerList` (Task 13); `Section`, `Tile` (`mobile/src/features/library/components/StyleControls.tsx`)
  - `Segmented`, `Sheet`, `Input`, `Button` (`mobile/src/ui`); `useDebouncedCallback` (`mobile/src/features/library/lib/debounce.ts`)
- Produces:
  - `type SaveStyle = (patch: ReaderCardStylePatch) => Promise<boolean>`
  - `<ReaderCardOptions input onChange />`
  - `<SignatureChoice books signature chosen onChange />`
  - `<HighlightChoice books highlight chosen onChange />`

- [ ] **Step 1: Options**

Create `ReaderCardOptions.tsx`:

```tsx
import { useMemo } from "react";
import { FlatList, StyleSheet } from "react-native";
import { COUNTERS, COUNTER_LABELS, LAYOUTS, LAYOUT_LABELS, TRAITS, TRAIT_LABELS, counterThumbnail, type ReaderCardBase, type ReaderCardStylePatch } from "@scripta/shared";
import { Segmented, spacing } from "../../ui";
import { Section, Tile } from "../library/components/StyleControls";
import { ReaderCardImage } from "../murals/ReaderCardImage";

const THUMB_WIDTH = 72;
const TRAIT_OPTIONS = TRAITS.map((value) => ({ value, label: TRAIT_LABELS[value] }));
const LAYOUT_OPTIONS = LAYOUTS.map((value) => ({ value, label: LAYOUT_LABELS[value] }));

export function ReaderCardOptions({ input, onChange }: { input: ReaderCardBase; onChange: (patch: ReaderCardStylePatch) => void }) {
  const { counter, trait, layout } = input.style;
  const thumbnails = useMemo(() => COUNTERS.map((option) => ({ option, input: counterThumbnail(input, option) })), [input]);
  return (
    <>
      <Section title="Counter">
        <FlatList
          horizontal
          data={thumbnails}
          keyExtractor={(item) => item.option}
          initialNumToRender={3}
          windowSize={3}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          renderItem={({ item }) => (
            <Tile label={COUNTER_LABELS[item.option]} selected={counter === item.option} onPress={() => onChange({ counter: item.option })}>
              <ReaderCardImage input={item.input} width={THUMB_WIDTH} />
            </Tile>
          )}
        />
      </Section>
      <Section title="Second trait">
        <Segmented accessibilityLabel="Second trait" options={TRAIT_OPTIONS} value={trait} onChange={(next) => onChange({ trait: next })} />
      </Section>
      <Section title="Layout">
        <Segmented accessibilityLabel="Layout" options={LAYOUT_OPTIONS} value={layout} onChange={(next) => onChange({ layout: next })} />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({ row: { gap: spacing.sm } });
```

- [ ] **Step 2: Choices**

Create `ReaderCardChoices.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SIGNATURE_NOTE_MAX, bookKey, bookPassages, isFinishedBook, searchPassages, type ChosenHighlight, type ChosenSignature, type Passage, type ReaderCardChosen, type ReaderCardStylePatch } from "@scripta/shared";
import { Button, Input, Sheet, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { BookPickerList } from "../library/components/BookPickerList";
import { Section } from "../library/components/StyleControls";
import { useDebouncedCallback } from "../library/lib/debounce";

export type SaveStyle = (patch: ReaderCardStylePatch) => Promise<boolean>;
type Book = Record<string, unknown>;

const NOTE_DELAY_MS = 600;

function NoteField({ signature, onChange }: { signature: ChosenSignature; onChange: SaveStyle }) {
  const [draft, setDraft] = useState(signature.note ?? "");
  const { schedule } = useDebouncedCallback((value: string) => {
    const note = value.trim() || null;
    if (note === signature.note) return;
    void onChange({ signature: { bookKey: signature.bookKey, note } }).then((saved) => { if (!saved) setDraft(signature.note ?? ""); });
  }, NOTE_DELAY_MS);
  return <Input label="Note" value={draft} maxLength={SIGNATURE_NOTE_MAX} hint={`${draft.length}/${SIGNATURE_NOTE_MAX}`} onChangeText={(value) => { setDraft(value); schedule(value); }} />;
}

export function SignatureChoice({ books, signature, chosen, onChange }: { books: Book[]; signature: ChosenSignature | null; chosen?: ReaderCardChosen["signature"]; onChange: SaveStyle }) {
  const { colors } = useTheme();
  const finished = useMemo(() => books.filter(isFinishedBook), [books]);
  const [picking, setPicking] = useState(false);
  return (
    <Section title="Signature book">
      {signature && chosen ? <Text style={[typography.body, { color: colors.text }]}>{chosen.title} <Text style={{ color: colors.textDim }}>— {chosen.author}</Text></Text> : null}
      {signature && !chosen ? <Text style={[typography.body, { color: colors.textDim }]}>No longer in your library.</Text> : null}
      {!signature && finished.length === 0 ? <Text style={[typography.body, { color: colors.textDim }]}>Finish a book to choose your signature book.</Text> : null}
      <View style={styles.actions}>
        {finished.length > 0 ? <Button label={signature ? "Change" : "Choose"} variant="secondary" onPress={() => setPicking(true)} /> : null}
        {signature ? <Button label="Remove" variant="secondary" onPress={() => void onChange({ signature: null })} /> : null}
      </View>
      {signature && chosen ? <NoteField key={signature.bookKey} signature={signature} onChange={onChange} /> : null}
      <Sheet visible={picking} title="Choose your signature book" onClose={() => setPicking(false)}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
          <BookPickerList
            books={finished}
            isSelected={(book) => bookKey(book) === signature?.bookKey}
            onSelect={(book) => {
              const key = bookKey(book);
              setPicking(false);
              void onChange({ signature: { bookKey: key, note: key === signature?.bookKey ? signature.note : null } });
            }}
          />
        </ScrollView>
      </Sheet>
    </Section>
  );
}

export function HighlightChoice({ books, highlight, chosen, onChange }: { books: Book[]; highlight: ChosenHighlight | null; chosen?: ReaderCardChosen["highlight"]; onChange: SaveStyle }) {
  const { colors } = useTheme();
  const withPassages = useMemo(() => books.filter((book) => bookPassages(book).length > 0), [books]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState<Book | null>(null);
  const matches = useMemo(() => searchPassages(books, query), [books, query]);
  const close = () => { setPicking(false); setBrowsing(null); setQuery(""); };
  const choose = (passage: Passage) => { close(); void onChange({ highlight: { bookKey: passage.bookKey, highlightId: passage.highlightId } }); };
  const list = (passages: Passage[]) => passages.map((passage) => (
    <Pressable key={`${passage.bookKey}:${passage.highlightId}`} accessibilityRole="button" onPress={() => choose(passage)} style={styles.passage}>
      <Text style={[typography.body, { color: colors.text }]}>“{passage.text}” <Text style={{ color: colors.textDim }}>— {passage.title}</Text></Text>
    </Pressable>
  ));
  return (
    <Section title="Highlight">
      {highlight && chosen ? <Text style={[typography.body, styles.quote, { color: colors.text }]}>“{chosen.text}” <Text style={{ color: colors.textDim }}>— {chosen.title}</Text></Text> : null}
      {highlight && !chosen ? <Text style={[typography.body, { color: colors.textDim }]}>No longer in your library.</Text> : null}
      {withPassages.length === 0 ? <Text style={[typography.body, { color: colors.textDim }]}>No Kobo highlights yet.</Text> : null}
      <View style={styles.actions}>
        {withPassages.length > 0 ? <Button label={highlight ? "Change" : "Choose"} variant="secondary" onPress={() => setPicking(true)} /> : null}
        {highlight ? <Button label="Remove" variant="secondary" onPress={() => void onChange({ highlight: null })} /> : null}
      </View>
      <Sheet visible={picking} title="Choose a highlight" onClose={close}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
          <Input label="Search your highlights" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
          {query.trim() ? (matches.length ? list(matches) : <Text style={[typography.body, { color: colors.textDim }]}>No highlights match.</Text>) : browsing ? (
            <>
              <Button label="Back to books" variant="secondary" onPress={() => setBrowsing(null)} />
              {list(bookPassages(browsing))}
            </>
          ) : (
            <BookPickerList books={withPassages} onSelect={setBrowsing} />
          )}
        </ScrollView>
      </Sheet>
    </Section>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm },
  sheet: { gap: spacing.sm, paddingBottom: spacing.xl },
  passage: { minHeight: minimumTouchTarget, justifyContent: "center", paddingVertical: spacing.xs },
  quote: { fontStyle: "italic" },
});
```

If `Button` stretches to full width so the two actions don't fit side by side, change `actions` to `{ gap: spacing.sm }` (stacked). Check `Button`'s style in `mobile/src/ui/components.tsx:175` first.

- [ ] **Step 3: Verify mobile**

Run: `npm run build -w @scripta/shared && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile`
Expected: PASS, including `textImports.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add mobile && git commit -m "Add the mobile reader card editor's options and pickers

Counter thumbnails sit in a lazy horizontal list, because A0 measured a
row of heavy cards at 1.6 s to mount; pickers offer only finished books
and real Kobo highlights, as on web.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 15: Mobile glyph setting

**Files:**
- Create: `mobile/src/features/readerCard/ReaderGlyphSetting.tsx`
- Modify: `mobile/src/features/community/FeedSettingsDialog.tsx`

**Interfaces:**
- Consumes: `fetchOwnProfile`, `updateFeedSettings` (`mobile/src/features/community/api.ts`), `ReaderGlyph` (`mobile/src/features/community/ReaderGlyph.tsx`), `ToggleSwitch`, `Toast`.
- Produces: `<ReaderGlyphSetting username books groups />`.

- [ ] **Step 1: Implement**

Create `ReaderGlyphSetting.tsx`:

```tsx
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ownGlyphPreview, readerIdentity, saveFailureMessage, type Group } from "@scripta/shared";
import { DEFAULT_FEED_SETTINGS, type OwnProfile } from "@scripta/shared/community";
import { Toast, ToggleSwitch, minimumTouchTarget, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { fetchOwnProfile, updateFeedSettings } from "../community/api";
import { ReaderGlyph } from "../community/ReaderGlyph";

const OWN_PROFILE_KEY = ["community", "own-profile"] as const;
const LABEL = "Show my reader glyph next to my name";

export function ReaderGlyphSetting({ username, books, groups }: { username: string; books: Array<Record<string, unknown>>; groups: Group[] }) {
  const { colors } = useTheme();
  const client = useQueryClient();
  const { data: profile } = useQuery({ queryKey: OWN_PROFILE_KEY, queryFn: fetchOwnProfile });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => ownGlyphPreview(readerIdentity(books, groups)), [books, groups]);
  const settings = profile?.feedSettings ?? DEFAULT_FEED_SETTINGS;
  const on = settings.readerGlyph ?? false;

  const toggle = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    client.setQueryData<OwnProfile>(OWN_PROFILE_KEY, { ...profile, feedSettings: { ...settings, readerGlyph: !on } });
    try {
      await updateFeedSettings({ ...settings, readerGlyph: !on });
      void client.invalidateQueries({ queryKey: ["community", "profile", username] });
    } catch (reason) {
      client.setQueryData<OwnProfile>(OWN_PROFILE_KEY, profile);
      setError(saveFailureMessage(reason, "Couldn't save the glyph setting."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <Text style={[typography.body, styles.grow, { color: colors.text }]}>{LABEL}</Text>
        <ToggleSwitch accessibilityLabel={LABEL} value={on} disabled={!profile || busy} onValueChange={() => void toggle()} />
      </View>
      <View accessible accessibilityLabel={preview.line} style={styles.preview}>
        <ReaderGlyph identity={preview.glyph ?? undefined} />
        <Text style={[typography.caption, styles.grow, { color: colors.textDim }]}>{preview.line}</Text>
      </View>
      {profile && !profile.published ? <Text style={[typography.caption, { color: colors.textDim }]}>It shows once your shelf is published.</Text> : null}
      {error ? <Toast visible message={error} tone="error" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: minimumTouchTarget },
  preview: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  grow: { flex: 1 },
});
```

In `FeedSettingsDialog.tsx`:
- Delete the "Reader glyph" `SettingRow` and the preview `View` below it.
- Delete the `preview` `useMemo`, the `useLibrary` call, and the imports that become unused (`ownGlyphPreview`, `readerIdentity`, `useLibrary`, `ReaderGlyph`, `useMemo`).
- Delete the `previewRow`/`previewLine` styles.
- `local` still starts from `settings`, so "Save" keeps the stored `readerGlyph`.

- [ ] **Step 2: Verify mobile**

Run: `npm run build -w @scripta/shared && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add mobile && git commit -m "Move the mobile glyph switch into the reader card editor

It saves at once with the full feed-settings body and says the glyph
only shows once the shelf is published.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 16: Mobile editor screen, route and Settings entry

**Files:**
- Create: `mobile/src/features/readerCard/ReaderCardEditorScreen.tsx`, `mobile/src/app/reader-card.tsx`
- Modify: `mobile/src/features/settings/SettingsScreen.tsx`

**Interfaces:**
- Consumes: Tasks 2 and 11–15, plus `useLibrary` (`mobile/src/features/library/hooks/useLibrary.ts`), `NO_GROUPS` (`mobile/src/features/murals/MuralCanvas.tsx`) and `useAuth` (`mobile/src/core/auth`).

- [ ] **Step 1: Implement**

Create `ReaderCardEditorScreen.tsx`:

```tsx
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { hasChosen, readerCardInputOf, saveFailureMessage, visitorView, type ReaderCardStylePatch } from "@scripta/shared";
import { useAuth } from "../../core/auth";
import { Button, Segmented, Toast, spacing, typography, useTheme } from "../../ui";
import { Text } from "../../ui/Text";
import { useLibrary } from "../library/hooks/useLibrary";
import { NO_GROUPS } from "../murals/MuralCanvas";
import { ReaderCardTurner } from "../murals/ReaderCardTurner";
import { HighlightChoice, SignatureChoice } from "./ReaderCardChoices";
import { ReaderCardOptions } from "./ReaderCardOptions";
import { ReaderGlyphSetting } from "./ReaderGlyphSetting";
import { coverOf, useReaderCardStyle, useSaveReaderCardStyle } from "./useReaderCardStyle";

const NO_BOOKS: Array<Record<string, unknown>> = [];
const PREVIEW_MAX = 280;
const AUDIENCES = [{ value: "you", label: "You" }, { value: "visitors", label: "Visitors" }] as const;

export function ReaderCardEditorScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const readerName = user?.username ?? "reader";
  const { width: windowWidth } = useWindowDimensions();
  const { data: library } = useLibrary();
  const books = library?.data.books ?? NO_BOOKS;
  const groups = library?.data.groups ?? NO_GROUPS;
  const { data: style, isPending, isError, refetch } = useReaderCardStyle();
  const save = useSaveReaderCardStyle();
  const [audience, setAudience] = useState<"you" | "visitors">("you");
  const [error, setError] = useState<string | null>(null);
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, undefined, style ? { style, coverOf } : undefined), [books, groups, readerName, style]);
  const preview = useMemo(() => (audience === "you" ? input : visitorView(input)), [audience, input]);
  const width = Math.min(windowWidth - spacing.xl * 2, PREVIEW_MAX);

  const change = async (patch: ReaderCardStylePatch) => {
    setError(null);
    try {
      await save(patch);
      return true;
    } catch (reason) {
      setError(saveFailureMessage(reason, "Couldn't save your reader card."));
      return false;
    }
  };

  if (isPending) return <Text style={[typography.body, styles.pad, { color: colors.textDim }]}>Loading your reader card…</Text>;
  if (isError || !style) return <View style={styles.pad}><Button label="Couldn't load your reader card. Try again" onPress={() => void refetch()} /></View>;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      <Segmented accessibilityLabel="Preview as" options={AUDIENCES} value={audience} onChange={setAudience} />
      <ReaderCardTurner key={`${preview.view}-${preview.style.layout}-${hasChosen(preview.card.chosen)}`} input={preview} width={width} />
      {input.card.state === "unwritten" && input.missing ? <Text style={[typography.body, { color: colors.textDim }]}>{input.missing}</Text> : null}
      {error ? <Toast visible message={error} tone="error" /> : null}
      <ReaderCardOptions input={input} onChange={(patch) => void change(patch)} />
      <SignatureChoice books={books} signature={style.signature} chosen={input.card.chosen?.signature} onChange={change} />
      <HighlightChoice books={books} highlight={style.highlight} chosen={input.card.chosen?.highlight} onChange={change} />
      <ReaderGlyphSetting username={readerName} books={books} groups={groups} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.huge },
  pad: { padding: spacing.xl },
});
```

Create `mobile/src/app/reader-card.tsx`:

```tsx
import { Redirect, Stack } from "expo-router";
import { useAuth } from "../core/auth";
import { ReaderCardEditorScreen } from "../features/readerCard/ReaderCardEditorScreen";
import { Screen } from "../ui";

export default function ReaderCardRoute() {
  const { user, ready } = useAuth();
  if (ready && !user) return <Redirect href={{ pathname: "/login", params: { returnTo: "/reader-card" } }} />;
  return (
    <Screen top={false} bottom>
      <Stack.Screen options={{ headerShown: true, title: "Reader card" }} />
      <ReaderCardEditorScreen />
    </Screen>
  );
}
```

In `SettingsScreen.tsx`, before the "Open gallery" button, add:

```tsx
      <Button label="Reader card" variant="secondary" onPress={() => router.push("/reader-card" as never)} />
```

- [ ] **Step 2: Verify mobile**

Run: `npm run build -w @scripta/shared && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile && (cd mobile && npx expo-doctor)`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add mobile && git commit -m "Add the mobile reader card editor at /reader-card

It sits at the app root like account-security, so it pushes above the
tabs; a route under (app) would have become a hidden tab.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 17: Check it on screen and ship A4

**Files:** none. This task verifies and opens the PR.

- [ ] **Step 1: Web check**

1. Run `npm run dev:claim`.
2. Seed the fixture with its community graph:

```bash
node --input-type=module -e 'const m = await import("./scripts/devFixtureSetup.mjs"); m.seedDevAccount(false, console.log); m.seedFixtureUsers(console.log); m.seedCommunityGraph(console.log);'
```

3. Start a launch entry that runs `npm run backend` with `devDataDirEnv()` merged into its env, then `web`.
   - `npm run backend` itself runs `dev:claim`. Confirm the backend listens on this worktree's slot port before using it.
4. Sign in as `scripta_dev`. In auto mode the classifier refuses to let the agent read `scripts/fixtures/account.json`, so ask the user to sign in once in the preview pane, or to add a permission rule.
5. Open `/dashboard/reader-card` and check:
   - **Counter:** clicking a thumbnail changes the preview.
   - **Trait and layout:** they change the preview, and the preview restarts on page 1.
   - **Signature book:** choose one. The chosen page shows it. Then type a note and click away within 600 ms; reload, and the note is kept.
   - **Highlight:** search, browse a book, choose a highlight.
   - **Remove** clears both choices.
   - **Visitors:** the record shows no ◇ rows.
   - **Glyph switch:** it toggles and survives a reload.
   - **Viewer:** from the own shelf, "Edit card" in the viewer opens the editor, and the mural block shows the new style.
   - **Settings:** it has the "Reader card" link.
   - **Themes:** check light and dark.

- [ ] **Step 2: Device pass**

Run `node scripts/dev-status.mjs --json` once. If no other worktree holds the emulator, dispatch `device-checker` for:
- **Settings:** "Reader card" opens the editor above the tabs, with a back button.
- **Options:** counter thumbnails scroll sideways and pick. Trait and layout segments change the preview.
- **Signature book:** the picker sheet chooses a book. A note typed then left within 600 ms is kept.
- **Highlight:** search and browse choose a highlight.
- **Remove:** it clears.
- **Visitors preview:** no ◇ rows.
- **Glyph switch:** it saves.
- **Owner's viewer:** from My shelf, "Edit card" closes the viewer and opens the editor. On return, the block shows the new style.
- **Themes:** light and dark.

If another worktree holds the emulator, skip the pass and record that it gates the merge.

- [ ] **Step 3: Ship**

1. Run the `security-review` skill. The branch moves the glyph visibility switch and adds the visitors preview.
2. Run `branch-reviewer` with this plan and the spec.
3. Push, and open the PR "Reader card A4: editor" against `main`.
4. Enable `--auto` only after the device pass, or after recording that it was skipped.
5. Add a deploy note to the PR: A3 and A4 reach production together. Deploying is the owner's call.
