# Reader card enrichment A0–A2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the mobile SVG subset (A0), give every reader card a book counter and a secondary trait drawn by one shared renderer (A1), and store the owner's card style with its public choices on the backend (A2).

**Architecture:**
- **Shared (`@scripta/shared`):** the plate becomes slot-based (`composePlate`). Pure counter and trait fragments fill the slots. `readerCardFacts` computes the public numbers once, used by the server on save and by the owner's client locally.
- **Backend:** the library module stores the style in a new `reader_card_styles` table, serves it through `GET`/`PATCH /library/reader-card/style`, and attaches the public part plus resolved choices to the visitor's `readerCard`.
- **Scope:** phases A3–A6 get their own plans after A0 reports.

**Tech Stack:** TypeScript, `node:test` via tsx, Fastify + zod + `node:sqlite`, React (Vite) web, Expo / react-native-svg 15.15.4 mobile.

**Spec:** `docs/superpowers/specs/2026-10-07-reader-card-enrichment-design.md`. Mockup geometry: `docs/superpowers/specs/2026-10-07-reader-card-mockups/`.

## Global Constraints

- **Code style:**
  - No comments in code (`AGENTS.md`).
  - Search with `rg`, and run git from the worktree root.
- **Shared builds:**
  - Consumers read `packages/shared/dist`. Once per worktree, run `npm run dev:link-deps`.
  - Run `npm run build -w @scripta/shared` before any backend, frontend or mobile typecheck or test.
- **Existing output stays put:**
  - `plate()` output stays byte-identical to the committed masters in `design/reader-cards/` (`plates.test.ts`).
  - `renderPlate()` output is unchanged.
  - Every new `PublicReaderCard` field is optional, and a card without them renders exactly `renderPlate()`.
- **Rendered SVG:**
  - It contains no `<style>`, no NaN, and no `class` attribute other than the root `plate id-…`/`glyph id-…` markers.
  - Elements are limited to the allowlist in Task 6, which is what react-native-svg 15.15.4 draws.
- **Visitor payloads** never contain `leaders`, `missing`, or a highlight's `annotation`.
- **Options and defaults:**
  - `COUNTERS = ["dial", "beads", "shelf", "frame", "ring"]`
  - `TRAITS = ["both", "seal", "line", "none"]`
  - Default style is `{ counter: "dial", trait: "both", signature: null, highlight: null }`.
  - `SIGNATURE_NOTE_MAX = 60`.
- **API:**
  - `GET` and `PATCH /library/reader-card/style`, owner only, rate limited to 120/min.
  - 400 bodies are `{ error: "<sentence>" }`.
- **No new native mobile dependencies:** A1 and A2 ship over the air.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage and commit in one command.

## Review Focus

1. **A reader with no finished books, or none with a known genre:** the card renders with no counter, or a single "unknown" segment, with no NaN and no empty `d=""` path. Pinned in Task 2 ("no finished books gives an empty dial") and Task 5 ("an empty dial draws no counter").
2. **A 2,000-book library:** every counter stays finite. The frame counter stops when its band is full instead of throwing. Pinned in Task 4 ("counters stay finite for one book and for two thousand").
3. **An old payload or summary written before this change** (no `streak`, `dial`, `facts`): it renders today's plate, byte for byte. Pinned in Task 5 ("an older card … draws today's plate").
4. **A PATCH naming an unfinished book, a Kobo note, a Goodreads review, or a book the caller does not own:** answered 400, and nothing is stored. Pinned in Task 11.
5. **A chosen book or highlight that later leaves the library:** the visitor's card drops that choice instead of failing the mural. Pinned in Task 12 ("a chosen highlight whose book left the library …").

---

## Phase A0 · Spike (throwaway, not merged)

### Task 0: Mobile SVG feature probe

**Files:**
- Create (on branch `spike/reader-card-svg` only): `mobile/src/app/dev-card.tsx`
- Modify (on the feature branch, after the device pass): `docs/superpowers/specs/2026-10-07-reader-card-enrichment-design.md`, adding a section `## A0 findings`

**Interfaces:**
- Consumes: `renderPlate`, `PLATE_FONTS` from `@scripta/shared`; `cardFontFamily` from `mobile/src/ui`.
- Produces: findings only. No code from this task is merged.

- [ ] **Step 1: Branch off for the spike**

```bash
git switch -c spike/reader-card-svg
```

- [ ] **Step 2: Write the probe screen**

Create `mobile/src/app/dev-card.tsx`:

```tsx
import { Profiler } from "react";
import { FlatList, ScrollView, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { SvgXml } from "react-native-svg";
import { PLATE_FONTS, renderPlate } from "@scripta/shared";
import { cardFontFamily } from "../ui";

const TILE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAB/0lEQVR42gXBiXfZcAAA4N+0Zmarp0WXYU/V2bWoWGWdWcuzVqtNJBJ1hpAezjoWV72WOBL80fs+QFspT32H/BCD2xZelgu2nAXt9HNet96Y4fwebwIZTdHSc5E3LPl4Rmtpf0Gx/juzYpZOSrDNzzNeUIkyvqo6Z8tLSWkNKwRbeD3Jbg+huHcJ9bDqPkgfVa5LsTYkOijZyFC46n5LHKy0zGlMep8kza8UKElK5tLOmCijQzmDZhBGlXdzajaCOfHTlHPiBEyEQrIny68JGSF71XBU8gYPN65oB66chRhvHwJ1iEbKAVxfRmhcOJnpGl/wzbyRDmUN5b2kg7CDzlYHFom+tHFM+rIRUcNaBn4eL/1o6voJ3sR6QEM+3++RGekTemcayBaal1jtsg6vjrMgq8ZuBSNIeHi3oG+/F6AUyR1ML8b+Zai6QW6+RBOBtpFTAdxJBsV3xcOpnAzX3Fnbo+EtMIcpeQLlnc++MgLimAD1rKvfFSV/kXIt1OlU0tH4ng+LYKTB8KIStLYa0XooHqS9c8u9Yby7wDCKuF3aW78ml8WzCQK6aNWTNI6jD3FWVfnIbQ/RtFl0ZSKTwyEqKOIw6GtZ4sGRtgoSTtJU8Ef8p9Tuvz+DyFr+tpUm6hQQ9N148e4pSgdG+qIr52hhzZ8i/AxP7QxSvsaM/wFSdprLyj8o5gAAAABJRU5ErkJggg==";
const COVER = "https://covers.openlibrary.org/b/isbn/9780547773742-M.jpg";
const ARC = "M56.1 97.4A78 78 0 0 1 193.9 97.4";

const probes: Array<[string, string]> = [
  ["pattern of a data: png", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="160" height="160"><defs><pattern id="t" width="16" height="16" patternUnits="userSpaceOnUse"><image href="${TILE}" width="16" height="16"/></pattern></defs><rect width="100" height="100" fill="#f1eadb"/><rect width="100" height="100" fill="url(#t)"/></svg>`],
  ["remote https image", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150" width="100" height="150"><image href="${COVER}" x="0" y="0" width="100" height="150"/></svg>`],
  ["textPath, startOffset 50%", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 140" width="250" height="140"><defs><path id="a" d="${ARC}"/></defs><path d="${ARC}" stroke="#cccccc" fill="none"/><text font-size="12" fill="#5b3b6e"><textPath href="#a" startOffset="50%" text-anchor="middle">Per libros ad astra</textPath></text></svg>`],
  ["mask from a data: png", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="160" height="160"><defs><pattern id="t2" width="16" height="16" patternUnits="userSpaceOnUse"><image href="${TILE}" width="16" height="16"/></pattern><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#ffffff"/><rect width="100" height="100" fill="url(#t2)"/></mask></defs><rect width="100" height="100" fill="#f1eadb"/><circle cx="50" cy="50" r="40" fill="#5b3b6e" mask="url(#m)"/></svg>`],
  ["blur on a group", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="160" height="160"><defs><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2"/></filter></defs><rect width="100" height="100" fill="#f1eadb"/><g filter="url(#b)"><path d="M20 50C20 20 80 20 80 50S20 80 20 50Z" fill="#5b3b6e" opacity=".4"/></g></svg>`],
];

function heavyCard(): string {
  const plate = renderPlate({ identity: "star", state: "settled", readerName: "spike", print: "paper", label: "spike" })
    .replaceAll(PLATE_FONTS.serif, cardFontFamily("playfairDisplay"))
    .replaceAll(PLATE_FONTS.sans, cardFontFamily("sans"));
  let ticks = "";
  for (let i = 0; i < 320; i++) {
    const a = (i / 320) * 2 * Math.PI;
    ticks += `M${(125 + 62.5 * Math.sin(a)).toFixed(2)} ${(134 - 62.5 * Math.cos(a)).toFixed(2)}L${(125 + 68 * Math.sin(a)).toFixed(2)} ${(134 - 68 * Math.cos(a)).toFixed(2)}`;
  }
  const filter = `<defs><filter id="lp" x="-5%" y="-5%" width="110%" height="110%"><feOffset in="SourceAlpha" dx=".5" dy=".6" result="o"/><feFlood flood-color="#ffffff" flood-opacity=".95"/><feComposite in2="o" operator="in" result="hl"/><feMerge><feMergeNode in="hl"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  const open = plate.indexOf(">") + 1;
  return `${plate.slice(0, open)}${filter}<g filter="url(#lp)">${plate.slice(open, plate.lastIndexOf("</svg>"))}<path d="${ticks}" stroke="#5b3b6e" stroke-width=".6" fill="none"/></g></svg>`;
}

const report = (id: string) => (_: string, phase: string, actual: number) => console.log(`[spike] ${id} ${phase} ${actual.toFixed(1)}ms`);

export default function DevCardScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  const heavy = heavyCard();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      {probes.map(([label, xml]) => (
        <View key={label}>
          <Text>{label}</Text>
          <SvgXml xml={xml} />
        </View>
      ))}
      <Text>heavy card: 320 ticks + letterpress filter</Text>
      <Profiler id="heavy" onRender={report("heavy")}>
        <SvgXml xml={heavy} width={250} height={350} />
      </Profiler>
      <Text>12 thumbnails of the heavy card</Text>
      <Profiler id="thumbs" onRender={report("thumbs")}>
        <FlatList horizontal data={Array.from({ length: 12 }, (_, i) => i)} keyExtractor={(i) => String(i)} renderItem={() => <SvgXml xml={heavy} width={64} height={90} />} />
      </Profiler>
    </ScrollView>
  );
}
```

- [ ] **Step 3: Typecheck and commit on the spike branch**

```bash
npm run build -w @scripta/shared && npm run typecheck -w mobile
git add mobile/src/app/dev-card.tsx && git commit -m "Spike: probe react-native-svg features for the reader card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Device pass**

Run `node scripts/dev-status.mjs --json`. If another worktree holds the emulator, stop and report back, without waiting. Otherwise dispatch `device-checker` with:
- the worktree path;
- the route `/dev-card`, opened by deep link in Expo Go;
- a screenshot directory.

Brief it to report, for each probe, whether the drawing matches its label:
- **pattern:** a grey speckle over paper;
- **remote image:** a book cover;
- **textPath:** text centred along the arc;
- **mask:** a speckled plum disc;
- **blur:** a soft plum blob;
- **heavy card:** a white highlight edge on the ink, and 320 ticks round the ring.

It also reports the `[spike]` lines from the Metro log (mount and update ms for `heavy` and `thumbs`), and whether the thumbnail row scrolls without visible stutter.

- [ ] **Step 5: Record findings on the feature branch**

```bash
git switch claude/reader-card-prominence-e20806
```

Append to the spec a `## A0 findings` section with one line per probe: works, or fails plus what was seen. Add the two timings, then the decision each finding implies, using the spec's fallbacks:
- a failed data-URI pattern means procedural textures;
- a failed remote image means the client draws the cover over a slot;
- a heavy card over 50 ms to mount means simplifying the dial in thumbnails.

```bash
git add docs/superpowers/specs/2026-10-07-reader-card-enrichment-design.md && git commit -m "Record the A0 react-native-svg findings for the reader card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The spike branch stays unmerged. Delete it after the findings commit: `git branch -D spike/reader-card-svg`.

---

## Phase A1 · Renderer core

### Task 1: `streak`, the second-strongest reading

**Files:**
- Modify: `packages/shared/src/library/readerIdentity.ts` (interface at lines 10-19, `unwritten` at line 74, the result at lines 155-164, `publicReaderCard` at lines 167-169)
- Test: `packages/shared/src/library/readerIdentity.test.ts`

**Interfaces:**
- Produces: `ReaderIdentity.streak: IdentityKey | null`. `PublicReaderCard` gains optional `streak?: IdentityKey | null`, and `publicReaderCard()` copies it.

- [ ] **Step 1: Write the failing tests** (append to `readerIdentity.test.ts`, which already defines `shelf`, `series`, `mark`)

```ts
test("a settled card names the second-strongest reading as its streak", () => {
  const books = shelf(10, (i) => (i < 3 ? { highlights: mark(7) } : {}));
  const result = readerIdentity(books, [series(books.slice(3, 7))]);
  assert.equal(result.state, "settled");
  assert.equal(result.identity, "carto");
  assert.equal(result.runnerUp, null);
  assert.equal(result.streak, "anno");
});

test("a settled card with no second reading near the threshold has no streak", () => {
  const books = shelf(10);
  const result = readerIdentity(books, [series(books.slice(0, 4))]);
  assert.equal(result.state, "settled");
  assert.equal(result.streak, null);
});

test("a tied leaning card's streak is its runner-up", () => {
  const books = shelf(10, (i) => (i < 3 ? { highlights: mark(7) } : {}));
  const result = readerIdentity(books, [series(books.slice(3, 6))]);
  assert.equal(result.state, "leaning");
  assert.equal(result.runnerUp, "anno");
  assert.equal(result.streak, "anno");
});

test("an unwritten card has no streak, and the public card carries the streak", () => {
  assert.equal(readerIdentity(shelf(3), []).streak, null);
  const books = shelf(10, (i) => (i < 3 ? { highlights: mark(7) } : {}));
  assert.equal(publicReaderCard(readerIdentity(books, [series(books.slice(3, 7))])).streak, "anno");
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: the four new tests FAIL (`streak` is `undefined`).

- [ ] **Step 3: Implement**

In `readerIdentity.ts`:

```ts
export interface ReaderIdentity {
  state: CardState;
  identity: IdentityKey | null;
  runnerUp: IdentityKey | null;
  streak: IdentityKey | null;
  signal: ReaderSignal | null;
  leaders: ReaderLeader[];
  coverage: string[];
  missing: string | null;
}
export type PublicReaderCard = Pick<ReaderIdentity, "state" | "identity" | "runnerUp" | "signal" | "coverage"> & Partial<Pick<ReaderIdentity, "streak">>;
```

`unwritten` becomes:

```ts
  const unwritten = (missing: string): ReaderIdentity => ({ state: "unwritten", identity: null, runnerUp: null, streak: null, signal: null, leaders: [], coverage, missing });
```

Replace the `shared` line near the end with:

```ts
  const streak = second && second.strength >= 0.75 - EPSILON ? second.key : null;
  const shared = { identity: best.key, signal: best.signal, leaders: best.leaders, coverage, streak };
```

And `publicReaderCard`:

```ts
export function publicReaderCard({ state, identity, runnerUp, streak, signal, coverage }: ReaderIdentity): PublicReaderCard {
  return { state, identity, runnerUp, streak, signal, coverage };
}
```

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: the new tests pass. Any existing `assert.deepEqual` on a `ReaderIdentity` or `PublicReaderCard` (for example around `readerIdentity.test.ts:123`) fails only for the missing `streak`. Add `streak: <the value the failure shows>` to that expected object, then re-run until green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/library/readerIdentity.ts packages/shared/src/library/readerIdentity.test.ts && git commit -m "Name the reader card's second-strongest reading as its streak

runnerUp is only set on a leaning tie, so a settled card had no secondary
trait to draw.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: `readerCardFacts`, the public numbers

**Files:**
- Modify: `packages/shared/src/library/libraryView.ts` (add `parseBookDate` after `localDay`)
- Modify: `packages/shared/src/murals/stats.ts` (`finishedInYear` uses `parseBookDate`; drop its private `DATE_ONLY`)
- Modify: `packages/shared/src/library/readerIdentity.ts` (export `GENRE_SIGNALS`, `GenreIdentity`, `uniqueFinished`; widen `PublicReaderCard`)
- Create: `packages/shared/src/library/readerCardFacts.ts`
- Modify: `packages/shared/src/library/index.ts` (add `export * from "./readerCardFacts.js";`)
- Test: `packages/shared/src/library/readerCardFacts.test.ts`

**Interfaces:**
- Consumes: `eligiblePassages(books)` from `murals/home.ts`, `genresForBook`, `bookKey`, `Group`.
- Produces:

```ts
export type GenreIdentity = "lamp" | "star" | "arch" | "corr";
export type DialGroup = GenreIdentity | "other" | "unknown";
export interface DialSegment { group: DialGroup; books: number; marked: number }
export interface ReaderCardFacts {
  dial: { segments: DialSegment[] };
  facts: { finished: number; highlights: number; series: number; since: number | null; edition: number };
}
export function readerCardFacts(books: Record<string, unknown>[], groups: Group[], identity: IdentityKey | null, now?: Date): ReaderCardFacts;
export function publicReaderCardOf(books: Record<string, unknown>[], groups: Group[], now?: Date): PublicReaderCard;
export function parseBookDate(raw: unknown): Date | null;
export function uniqueFinished(books: Record<string, unknown>[]): Record<string, unknown>[];
```

`PublicReaderCard` becomes `Pick<…> & Partial<Pick<ReaderIdentity, "streak">> & Partial<ReaderCardFacts>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/library/readerCardFacts.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Group } from "./groups.js";
import { bookKey } from "./merge.js";
import { publicReaderCardOf, readerCardFacts } from "./readerCardFacts.js";

type Book = Record<string, unknown>;
const book = (i: number, fields: Book = {}): Book => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, ...fields });
const mark = (n: number, type = "highlight") => Array.from({ length: n }, (_, j) => ({ Type: type, Text: `line ${j}`, BookmarkID: `h${j}` }));
const series = (books: Book[], id = "s"): Group => ({ id, type: "series", name: "S", bookKeys: books.map(bookKey), createdAt: "", updatedAt: "" });
const NOW = new Date(2026, 9, 7);

test("each finished book counts in one segment, the identity's group first", () => {
  const books = [book(1, { _genres: ["Fantasy", "Mystery"] }), book(2, { _genres: ["Mystery"] }), book(3, { _genres: ["Romance"] }), book(4)];
  assert.deepEqual(readerCardFacts(books, [], "star", NOW).dial.segments, [
    { group: "star", books: 1, marked: 0 },
    { group: "lamp", books: 1, marked: 0 },
    { group: "other", books: 1, marked: 0 },
    { group: "unknown", books: 1, marked: 0 },
  ]);
  assert.deepEqual(readerCardFacts(books, [], null, NOW).dial.segments.map((s) => [s.group, s.books]), [["lamp", 2], ["other", 1], ["unknown", 1]]);
});

test("marked counts finished books with a real Kobo highlight, and highlights counts the passages", () => {
  const books = [
    book(1, { highlights: mark(3) }),
    book(2, { highlights: mark(2, "note") }),
    book(3, { highlights: mark(1), ReadStatus: 1 }),
    book(4, { highlights: [{ Type: "highlight", Text: "  ", BookmarkID: "x" }] }),
  ];
  const { dial, facts } = readerCardFacts(books, [], null, NOW);
  assert.equal(facts.finished, 3);
  assert.equal(facts.highlights, 3);
  assert.deepEqual(dial.segments, [{ group: "unknown", books: 3, marked: 1 }]);
});

test("a duplicated book counts once", () => {
  assert.equal(readerCardFacts([book(1), book(1), book(2)], [], null, NOW).facts.finished, 2);
});

test("series counts series groups holding a finished book", () => {
  const finished = [book(1), book(2)];
  const unread = book(3, { ReadStatus: 0 });
  const collection: Group = { ...series([finished[0]!], "c"), type: "collection" };
  assert.equal(readerCardFacts([...finished, unread], [series(finished, "a"), series([unread], "b"), collection], null, NOW).facts.series, 1);
});

test("since is the earliest year a finished book was last read, and edition is this year", () => {
  const books = [book(1, { DateLastRead: "2019-05-02" }), book(2, { DateLastRead: "2016-03-01T10:00:00Z" }), book(3, { DateLastRead: "garbage" }), book(4, { DateLastRead: "2001-01-01", ReadStatus: 1 })];
  const { facts } = readerCardFacts(books, [], null, NOW);
  assert.equal(facts.since, 2016);
  assert.equal(facts.edition, 2026);
  assert.equal(readerCardFacts([book(1)], [], null, NOW).facts.since, null);
});

test("no finished books gives an empty dial", () => {
  assert.deepEqual(readerCardFacts([book(1, { ReadStatus: 0 })], [], null, NOW), {
    dial: { segments: [] },
    facts: { finished: 0, highlights: 0, series: 0, since: null, edition: 2026 },
  });
});

test("the public card carries the identity fields and the facts, never the leaders", () => {
  const books = Array.from({ length: 6 }, (_, i) => book(i, { _genres: ["Fantasy"] }));
  const card = publicReaderCardOf(books, [], NOW);
  assert.equal(card.identity, "star");
  assert.equal(card.facts?.finished, 6);
  assert.deepEqual(card.dial?.segments, [{ group: "star", books: 6, marked: 0 }]);
  assert.equal("leaders" in card, false);
  assert.equal("missing" in card, false);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./readerCardFacts.js` does not exist.

- [ ] **Step 3: Implement**

In `libraryView.ts`, after `localDay`:

```ts
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseBookDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null;
  const dateOnly = DATE_ONLY.exec(raw);
  const parsed = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
```

In `murals/stats.ts`, add `import { parseBookDate } from "../library/libraryView.js";`, delete the private `DATE_ONLY` const, and make `finishedInYear`:

```ts
function finishedInYear(book: Record<string, unknown>, year: number): boolean {
  return isFinished(book) && parseBookDate(book.DateLastRead)?.getFullYear() === year;
}
```

In `readerIdentity.ts`:

```ts
import type { ReaderCardFacts } from "./readerCardFacts.js";

export type GenreIdentity = "lamp" | "star" | "arch" | "corr";
export type PublicReaderCard = Pick<ReaderIdentity, "state" | "identity" | "runnerUp" | "signal" | "coverage"> & Partial<Pick<ReaderIdentity, "streak">> & Partial<ReaderCardFacts>;

export const GENRE_SIGNALS: Array<{ key: GenreIdentity; genres: BookGenre[]; threshold: number; words: string }> = [
  { key: "lamp", genres: ["Mystery", "Crime", "Thriller", "Horror"], threshold: 0.35, words: "mystery, crime, thriller or horror" },
  { key: "star", genres: ["Fantasy", "Science Fiction"], threshold: 0.4, words: "fantasy or science fiction" },
  { key: "arch", genres: ["History", "Biography & Memoir", "Politics"], threshold: 0.35, words: "history, biography or politics" },
  { key: "corr", genres: ["Classics", "Literary Fiction", "Poetry"], threshold: 0.4, words: "classics, literary fiction or poetry" },
];

export function uniqueFinished(books: Book[]): Book[] {
  const seen = new Set<string>();
  return books.filter(isFinishedBook).filter((book) => {
    const key = bookKey(book);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

In `readerIdentity()`, replace the inline `seenKeys` filtering with `const finished = uniqueFinished(books);`.

Create `packages/shared/src/library/readerCardFacts.ts`:

```ts
import { eligiblePassages } from "../murals/home.js";
import type { IdentityKey } from "../readerCards/plates.js";
import { genresForBook } from "./bookGenres.js";
import type { Group } from "./groups.js";
import { parseBookDate } from "./libraryView.js";
import { bookKey } from "./merge.js";
import { GENRE_SIGNALS, publicReaderCard, readerIdentity, uniqueFinished, type GenreIdentity, type PublicReaderCard } from "./readerIdentity.js";

type Book = Record<string, unknown>;

export type DialGroup = GenreIdentity | "other" | "unknown";
export interface DialSegment { group: DialGroup; books: number; marked: number }
export interface ReaderCardFacts {
  dial: { segments: DialSegment[] };
  facts: { finished: number; highlights: number; series: number; since: number | null; edition: number };
}

export function readerCardFacts(books: Book[], groups: Group[], identity: IdentityKey | null, now: Date = new Date()): ReaderCardFacts {
  const finished = uniqueFinished(books);
  const lead = GENRE_SIGNALS.find((signal) => signal.key === identity);
  const order = lead ? [lead, ...GENRE_SIGNALS.filter((signal) => signal !== lead)] : GENRE_SIGNALS;
  const tally = new Map<DialGroup, DialSegment>();
  let highlights = 0;
  let since: number | null = null;
  for (const book of finished) {
    const passages = eligiblePassages([book]).length;
    highlights += passages;
    const genres = genresForBook(book);
    const group: DialGroup = order.find((signal) => genres.some((genre) => signal.genres.includes(genre)))?.key ?? (genres.length > 0 ? "other" : "unknown");
    const segment = tally.get(group) ?? { group, books: 0, marked: 0 };
    segment.books += 1;
    if (passages > 0) segment.marked += 1;
    tally.set(group, segment);
    const year = parseBookDate(book.DateLastRead)?.getFullYear();
    if (year !== undefined && (since === null || year < since)) since = year;
  }
  const keys = new Set(finished.map(bookKey));
  const series = groups.filter((group) => group.type === "series" && group.bookKeys.some((key) => keys.has(key))).length;
  const segmentOrder: DialGroup[] = [...order.map((signal) => signal.key), "other", "unknown"];
  return {
    dial: { segments: segmentOrder.flatMap((group) => tally.get(group) ?? []) },
    facts: { finished: finished.length, highlights, series, since, edition: now.getFullYear() },
  };
}

export function publicReaderCardOf(books: Book[], groups: Group[], now: Date = new Date()): PublicReaderCard {
  const identity = readerIdentity(books, groups);
  return { ...publicReaderCard(identity), ...readerCardFacts(books, groups, identity.identity, now) };
}
```

Add `export * from "./readerCardFacts.js";` to `library/index.ts`, after the `readerIdentity.js` line.

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS, including the existing `murals/stats` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/library packages/shared/src/murals/stats.ts && git commit -m "Compute the reader card's dial segments and public facts

One parser for DateLastRead now serves the stats block and the card's
since year.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Slot-based plate composition

**Files:**
- Create: `packages/shared/src/readerCards/compose.ts`
- Modify: `packages/shared/src/readerCards/plates.ts`. Drop the local `SERIF`/`SANS` consts (lines 1-2) and import them from `compose.ts`. `PLATE_FONTS` keeps its value. `plate()` (lines 367-397) delegates to `composePlate`.
- Test: `packages/shared/src/readerCards/compose.test.ts`

**Interfaces:**
- Produces:

```ts
export const SERIF: string;
export const SANS: string;
export interface PlateFace { key: IdentityKey | "none"; emblemSvg: string; name: string; eyebrow: string; epithet: string; numeral: string; reader: string; width: number; label: string }
export interface PlateSlots { underlay?: string; frameBand?: string; corners?: string; header?: string; top?: string; rings?: string; seal?: string; trait?: string; footerLeft?: string; footerRight?: string; overlay?: string }
export function composePlate(face: PlateFace, slots?: PlateSlots): string;
```

`plate()` keeps its signature and output.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/readerCards/compose.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { composePlate, type PlateFace } from "./compose.js";

const face: PlateFace = { key: "star", emblemSvg: `<g id="emblem"/>`, name: "Stargazer", eyebrow: "THE", epithet: "lives half in other worlds", numeral: "IV", reader: "ANDRE", width: 250, label: "x" };

test("slots land in layer order", () => {
  const svg = composePlate(face, { underlay: `<g id="u"/>`, frameBand: `<g id="f"/>`, top: `<g id="t"/>`, rings: `<g id="r"/>`, seal: `<g id="s"/>`, trait: `<g id="tr"/>`, overlay: `<g id="o"/>` });
  const at = (needle: string) => svg.indexOf(needle);
  assert.ok(at(`id="u"`) < at(`x="10" y="10"`));
  assert.ok(at(`x="16" y="16"`) < at(`id="f"`) && at(`id="f"`) < at("EX LIBRIS"));
  assert.ok(at("EX LIBRIS") < at(`id="t"`) && at(`id="t"`) < at(`r="60"`));
  assert.ok(at(`r="55"`) < at(`id="r"`) && at(`id="r"`) < at(`id="emblem"`) && at(`id="emblem"`) < at(`id="s"`));
  assert.ok(at("lives half in other worlds") < at(`id="tr"`) && at(`id="tr"`) < at("M30 305H220"));
  assert.ok(at(">ANDRE<") < at(`id="o"`) && at(`id="o"`) < at("</svg>"));
});

test("a slot replaces its default, and an empty string removes it", () => {
  const svg = composePlate(face, { corners: "", header: `<text>MOTTO</text>`, footerLeft: "", footerRight: "" });
  assert.doesNotMatch(svg, /EX LIBRIS/);
  assert.doesNotMatch(svg, /PLATE IV/);
  assert.doesNotMatch(svg, />ANDRE</);
  assert.doesNotMatch(svg, /M16 11\.5/);
  assert.match(svg, /<text>MOTTO<\/text>/);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./compose.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/shared/src/readerCards/compose.ts`:

```ts
import type { IdentityKey } from "./plates.js";

export const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
export const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export interface PlateFace {
  key: IdentityKey | "none";
  emblemSvg: string;
  name: string;
  eyebrow: string;
  epithet: string;
  numeral: string;
  reader: string;
  width: number;
  label: string;
}

export interface PlateSlots {
  underlay?: string;
  frameBand?: string;
  corners?: string;
  header?: string;
  top?: string;
  rings?: string;
  seal?: string;
  trait?: string;
  footerLeft?: string;
  footerRight?: string;
  overlay?: string;
}

const DIAMONDS = [[16, 16], [234, 16], [16, 334], [234, 334]].map(([x, y]) => `M${x} ${y! - 4.5}L${x! + 4.5} ${y}L${x} ${y! + 4.5}L${x! - 4.5} ${y}Z`).join("");

export function composePlate(face: PlateFace, slots: PlateSlots = {}): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="plate id-${face.key}" viewBox="0 0 250 350" width="${face.width}" height="${+(face.width * 1.4).toFixed(2)}" role="img" aria-label="${face.label}">`,
    `<rect class="pg" width="250" height="350" rx="4"/>`,
    slots.underlay,
    `<rect class="pl" x="10" y="10" width="230" height="330" stroke-width="1.6"/>`,
    `<rect class="pl" x="16" y="16" width="218" height="318" stroke-width=".6"/>`,
    slots.frameBand,
    slots.corners ?? `<path class="pf" d="${DIAMONDS}"/>`,
    slots.header ?? `<text class="pt" x="125" y="45" text-anchor="middle" font-size="8.5" letter-spacing="3.4" font-family="${SANS}" font-weight="600">EX LIBRIS</text>`,
    slots.top,
    `<circle class="pl" cx="125" cy="134" r="60" stroke-width="1.4"/>`,
    `<circle class="pl" cx="125" cy="134" r="55" stroke-width=".6"/>`,
    slots.rings,
    face.emblemSvg,
    slots.seal,
    `<text class="pt" x="125" y="220" text-anchor="middle" font-size="8" letter-spacing="3" font-family="${SANS}" font-weight="600">${face.eyebrow}</text>`,
    `<text class="pt" x="125" y="247" text-anchor="middle" font-size="25" font-family="${SERIF}">${face.name}</text>`,
    `<path class="pl" d="M82 263H117M133 263H168" stroke-width=".8"/><circle class="pf" cx="125" cy="263" r="2"/>`,
    `<text class="pt" x="125" y="283" text-anchor="middle" font-size="11" font-style="italic" font-family="${SERIF}">${face.epithet}</text>`,
    slots.trait,
    `<path class="pl" d="M30 305H220" stroke-width=".5"/>`,
    slots.footerLeft ?? `<text class="pt" x="30" y="321" font-size="7.5" letter-spacing="1.8" font-family="${SANS}" font-weight="600">PLATE ${face.numeral}</text>`,
    slots.footerRight ?? `<text class="pt" x="220" y="321" text-anchor="end" font-size="7.5" letter-spacing="1.8" font-family="${SANS}" font-weight="600">${face.reader}</text>`,
    slots.overlay,
    `</svg>`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}
```

In `plates.ts`, replace lines 1-2 with:

```ts
import { SANS, SERIF, composePlate } from "./compose.js";
```

and replace the body of `plate()` with:

```ts
export function plate({ key, emblem = key, name, eyebrow = "THE", epithet, numeral, reader = "EXAMPLE READER", width = 250, label }: PlateOptions): string {
  return composePlate({ key, emblemSvg: emblems[emblem](), name, eyebrow, epithet, numeral, reader, width, label: label ?? `${eyebrow.toLowerCase()} ${name} identity plate` });
}
```

- [ ] **Step 4: Run the shared tests**

Run: `npm test -w @scripta/shared`
Expected: PASS. In particular, "the port reproduces every committed master byte for byte" in `plates.test.ts` still passes, and that is the proof the refactor changed no output.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards/compose.ts packages/shared/src/readerCards/compose.test.ts packages/shared/src/readerCards/plates.ts && git commit -m "Compose the reader plate from named slots

The committed masters still match byte for byte, so the default plate is
unchanged; counters, traits and later decoration fill the slots.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The five counters

**Files:**
- Create: `packages/shared/src/readerCards/seed.ts`
- Create: `packages/shared/src/readerCards/counters.ts`
- Test: `packages/shared/src/readerCards/counters.test.ts`

**Interfaces:**
- Consumes: `DialSegment`, `DialGroup` (Task 2).
- Produces:

```ts
export function seedOf(text: string): number;
export function random(seed: number): () => number;
export const COUNTERS: readonly ["dial", "beads", "shelf", "frame", "ring"];
export type Counter = (typeof COUNTERS)[number];
export const SEAL_ANGLE = 135;
export interface CounterLayer { slot: "rings" | "top" | "frameBand"; svg: string }
export interface CounterOptions { seed: number; sealGap: boolean; lead: DialGroup | null }
export function drawCounter(counter: Counter, segments: DialSegment[], options: CounterOptions): CounterLayer | null;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/readerCards/counters.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DialSegment } from "../library/readerCardFacts.js";
import { COUNTERS, SEAL_ANGLE, drawCounter, type CounterOptions } from "./counters.js";
import { seedOf } from "./seed.js";

const small: DialSegment[] = [
  { group: "star", books: 22, marked: 9 },
  { group: "corr", books: 7, marked: 3 },
  { group: "lamp", books: 8, marked: 1 },
  { group: "arch", books: 5, marked: 0 },
  { group: "other", books: 6, marked: 1 },
];
const options: CounterOptions = { seed: seedOf("andre"), sealGap: false, lead: "star" };
const ticks = (svg: string) => [...svg.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)].map(([, x1, y1, x2, y2]) => ({
  outer: Math.hypot(Number(x2) - 125, Number(y2) - 134),
  angle: (Math.atan2(Number(x1) - 125, 134 - Number(y1)) * 180 / Math.PI + 360) % 360,
}));

test("the dial draws one tick per finished book and a long tick per marked book", () => {
  const all = ticks(drawCounter("dial", small, options)!.svg);
  assert.equal(all.length, 48);
  assert.equal(all.filter((tick) => Math.abs(tick.outer - 72) < 0.05).length, 14);
});

test("the dial leaves room for the seal", () => {
  const all = ticks(drawCounter("dial", small, { ...options, sealGap: true })!.svg);
  assert.ok(all.length < 48);
  assert.ok(all.every((tick) => Math.abs(tick.angle - SEAL_ANGLE) >= 13));
});

test("each counter names the slot it draws in", () => {
  assert.deepEqual(Object.fromEntries(COUNTERS.map((counter) => [counter, drawCounter(counter, small, options)!.slot])), { dial: "rings", beads: "rings", shelf: "top", frame: "frameBand", ring: "rings" });
});

test("no finished books draws no counter", () => {
  for (const counter of COUNTERS) {
    assert.equal(drawCounter(counter, [], options), null);
    assert.equal(drawCounter(counter, [{ group: "unknown", books: 0, marked: 0 }], options), null);
  }
});

test("counters stay finite for one book and for two thousand", () => {
  for (const counter of COUNTERS) {
    for (const books of [1, 2000]) {
      const svg = drawCounter(counter, [{ group: "star", books, marked: Math.floor(books / 3) }], options)!.svg;
      assert.doesNotMatch(svg, /NaN|Infinity|d=""/);
      assert.ok(svg.length > 0);
    }
  }
});

test("output depends only on its inputs, and only the shelf uses the seed", () => {
  for (const counter of COUNTERS) assert.equal(drawCounter(counter, small, options)!.svg, drawCounter(counter, small, options)!.svg);
  assert.notEqual(drawCounter("shelf", small, options)!.svg, drawCounter("shelf", small, { ...options, seed: seedOf("other") })!.svg);
  assert.equal(drawCounter("dial", small, options)!.svg, drawCounter("dial", small, { ...options, seed: seedOf("other") })!.svg);
});

test("without a lead group no segment is drawn heavier", () => {
  assert.doesNotMatch(drawCounter("dial", small, { ...options, lead: null })!.svg, /stroke-width="1.15"/);
  assert.doesNotMatch(drawCounter("shelf", small, { ...options, lead: null })!.svg, /opacity=".5"/);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./counters.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/shared/src/readerCards/seed.ts`:

```ts
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Create `packages/shared/src/readerCards/counters.ts`:

```ts
import type { DialGroup, DialSegment } from "../library/readerCardFacts.js";
import { random } from "./seed.js";

export const COUNTERS = ["dial", "beads", "shelf", "frame", "ring"] as const;
export type Counter = (typeof COUNTERS)[number];
export const SEAL_ANGLE = 135;

export interface CounterLayer { slot: "rings" | "top" | "frameBand"; svg: string }
export interface CounterOptions { seed: number; sealGap: boolean; lead: DialGroup | null }

const SEAL_HALF_WIDTH = 13;
const RING_GAP = 7;
const DASHES = ["", "1.2 .9", ".5 1.3", "2.6 1.2", ".25 2.2", "1.8 .6 .4 .6"];
const FRAME_LEGS: Array<[number, number, number, number]> = [[125, 13, 237, 13], [237, 13, 237, 337], [237, 337, 13, 337], [13, 337, 13, 13], [13, 13, 125, 13]];
const FRAME_CORNERS = [[13, 13], [237, 13], [13, 337], [237, 337]];

const f2 = (n: number) => n.toFixed(2);
const polar = (deg: number, r: number): [number, number] => [125 + r * Math.sin((deg * Math.PI) / 180), 134 - r * Math.cos((deg * Math.PI) / 180)];
const nearSeal = (deg: number) => Math.abs(((deg - SEAL_ANGLE + 540) % 360) - 180) < SEAL_HALF_WIDTH;
const booksIn = (segments: DialSegment[]) => segments.reduce((sum, segment) => sum + segment.books, 0);
const strokes = (d: string, attrs: string) => (d ? `<path class="pl" d="${d}" ${attrs}/>` : "");

function eachBook(segments: DialSegment[], visit: (deg: number, segment: DialSegment, i: number, step: number) => void) {
  const step = (360 - RING_GAP * segments.length) / booksIn(segments);
  let angle = RING_GAP / 2;
  for (const segment of segments) {
    for (let i = 0; i < segment.books; i++) visit(angle + step * (i + 0.5), segment, i, step);
    angle += step * segment.books + RING_GAP;
  }
}

function dial(segments: DialSegment[], { sealGap, lead }: CounterOptions): string {
  let heavy = "", light = "";
  eachBook(segments, (deg, segment, i) => {
    if (sealGap && nearSeal(deg)) return;
    const [x1, y1] = polar(deg, 62.5), [x2, y2] = polar(deg, i < segment.marked ? 72 : 67.5);
    const d = `M${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}`;
    if (segment.group === lead) heavy += d;
    else light += d;
  });
  return strokes(heavy, `stroke-width="1.15" stroke-linecap="round"`) + strokes(light, `stroke-width=".6" stroke-linecap="round" opacity=".8"`);
}

function beads(segments: DialSegment[], { sealGap, lead }: CounterOptions): string {
  let out = "";
  eachBook(segments, (deg, segment, i, step) => {
    if (sealGap && nearSeal(deg)) return;
    const r = Math.min(1.7, Math.max(0.42, step * 0.2));
    const [x, y] = polar(deg, 57.5);
    const filled = i < segment.marked;
    out += filled || segment.group === lead
      ? `<circle class="pf" cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}"${filled ? "" : ` opacity=".55"`}/>`
      : `<circle class="pl" cx="${f2(x)}" cy="${f2(y)}" r="${f2(r * 0.8)}" stroke-width="${f2(Math.min(0.5, r * 0.5))}"/>`;
  });
  return out;
}

function shelf(segments: DialSegment[], { seed, lead }: CounterOptions): string {
  const next = random(seed);
  const left = 36, right = 214, base = 66, gap = 2.4;
  const pitch = (right - left - gap * (segments.length - 1)) / booksIn(segments);
  const width = Math.max(0.35, pitch * 0.78);
  let x = left, out = "";
  for (const segment of segments) {
    const faint = lead !== null && segment.group !== lead ? ` opacity=".5"` : "";
    for (let i = 0; i < segment.books; i++) {
      const height = 7 + next() * 6;
      out += `<rect class="pf" x="${f2(x)}" y="${f2(base - height)}" width="${f2(width)}" height="${f2(height)}"${faint}/>`;
      if (i < segment.marked && pitch > 2) out += `<rect class="pg" x="${f2(x)}" y="${f2(base - height + 1.6)}" width="${f2(width)}" height=".7"/>`;
      x += pitch;
    }
    x += gap;
  }
  return `${out}<path class="pl" d="M30 ${base + 0.4}H220" stroke-width=".8"/>`;
}

function framePoint(distance: number): { x: number; y: number; horizontal: boolean } | null {
  let s = distance;
  for (const [ax, ay, bx, by] of FRAME_LEGS) {
    const length = Math.hypot(bx - ax, by - ay);
    if (s <= length) return { x: ax + ((bx - ax) * s) / length, y: ay + ((by - ay) * s) / length, horizontal: ay === by };
    s -= length;
  }
  return null;
}

function frame(segments: DialSegment[], { lead }: CounterOptions): string {
  const pitch = 3.1, gap = 5;
  let s = 0, heavy = "", light = "";
  fill: for (const segment of segments) {
    for (let i = 0; i < segment.books; i++) {
      let point = framePoint(s);
      while (point && FRAME_CORNERS.some(([cx, cy]) => Math.hypot(point!.x - cx!, point!.y - cy!) < 7)) {
        s += pitch;
        point = framePoint(s);
      }
      if (!point) break fill;
      const length = i < segment.marked ? 2.6 : 1.5;
      const d = point.horizontal ? `M${f2(point.x)} ${f2(point.y - length)}V${f2(point.y + length)}` : `M${f2(point.x - length)} ${f2(point.y)}H${f2(point.x + length)}`;
      if (segment.group === lead) heavy += d;
      else light += d;
      s += pitch;
    }
    s += gap;
  }
  return strokes(heavy, `stroke-width=".9"`) + strokes(light, `stroke-width=".55" opacity=".75"`);
}

function arc(a0: number, a1: number, attrs: string): string {
  const [x0, y0] = polar(a0, 57.5), [x1, y1] = polar(a1, 57.5);
  return `<path class="pl" d="M${f2(x0)} ${f2(y0)}A57.5 57.5 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f2(x1)} ${f2(y1)}" ${attrs}/>`;
}

function ring(segments: DialSegment[], { sealGap, lead }: CounterOptions): string {
  const gap = 6, span = 360 - gap * segments.length, total = booksIn(segments);
  let angle = gap / 2, out = "";
  segments.forEach((segment, k) => {
    const isLead = segment.group === lead;
    const attrs = `stroke-width="${isLead ? 4.4 : 3.2}"${DASHES[k] ? ` stroke-dasharray="${DASHES[k]}"` : ""}${isLead ? "" : ` opacity=".8"`}`;
    const start = angle, end = angle + (span * segment.books) / total;
    const pieces: Array<[number, number]> = sealGap && start < SEAL_ANGLE + SEAL_HALF_WIDTH && end > SEAL_ANGLE - SEAL_HALF_WIDTH
      ? [[start, SEAL_ANGLE - SEAL_HALF_WIDTH], [SEAL_ANGLE + SEAL_HALF_WIDTH, end]]
      : [[start, end]];
    for (const [a0, a1] of pieces) if (a1 > a0) out += arc(a0, a1, attrs);
    angle = end + gap;
  });
  return out;
}

const DRAW: Record<Counter, [CounterLayer["slot"], (segments: DialSegment[], options: CounterOptions) => string]> = {
  dial: ["rings", dial],
  beads: ["rings", beads],
  shelf: ["top", shelf],
  frame: ["frameBand", frame],
  ring: ["rings", ring],
};

export function drawCounter(counter: Counter, segments: DialSegment[], options: CounterOptions): CounterLayer | null {
  const present = segments.filter((segment) => segment.books > 0);
  if (present.length === 0) return null;
  const [slot, draw] = DRAW[counter];
  return { slot, svg: draw(present, options) };
}
```

- [ ] **Step 4: Run the shared tests**

Run: `npm test -w @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards/seed.ts packages/shared/src/readerCards/counters.ts packages/shared/src/readerCards/counters.test.ts && git commit -m "Draw the reader card's book counter in five styles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Style model and `renderReaderCard` (front)

**Files:**
- Create: `packages/shared/src/readerCards/style.ts`
- Modify: `packages/shared/src/readerCards/render.ts`. Add `faceOf` and `renderReaderCard`. `renderPlate` goes through `faceOf` + `composePlate` with identical output.
- Modify: `packages/shared/src/readerCards/index.ts`
- Test: `packages/shared/src/readerCards/readerCard.test.ts`

**Interfaces:**
- Consumes: `composePlate`, `PlateFace`, `PlateSlots`, `SANS` (Task 3); `drawCounter`, `SEAL_ANGLE`, `COUNTERS`, `Counter` (Task 4); `PublicReaderCard` (Tasks 1-2).
- Produces:

```ts
export const TRAITS: readonly ["both", "seal", "line", "none"];
export type Trait = (typeof TRAITS)[number];
export interface ReaderCardStyle { counter: Counter; trait: Trait }
export const DEFAULT_READER_CARD_STYLE: ReaderCardStyle;
export function normalizeReaderCardStyle(value: unknown): ReaderCardStyle;
export interface ReaderCardInput { card: PublicReaderCard; style: ReaderCardStyle; readerName: string; print: PlatePrint; label: string; unwrittenLine?: string; seed: number; width?: number }
export function renderReaderCard(input: ReaderCardInput): string;
```

`readerCards/index.ts` re-exports `style.js`, `COUNTERS`/`Counter`/`drawCounter` from `counters.js`, and `seedOf` from `seed.js`.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/readerCards/readerCard.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { COUNTERS } from "./counters.js";
import { renderPlate, renderReaderCard } from "./render.js";
import { seedOf } from "./seed.js";
import { DEFAULT_READER_CARD_STYLE, TRAITS, normalizeReaderCardStyle, type ReaderCardStyle } from "./style.js";

const card = (fields: Partial<PublicReaderCard> = {}): PublicReaderCard => ({
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: [],
  dial: { segments: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 8, marked: 1 }] },
  facts: { finished: 30, highlights: 40, series: 2, since: 2014, edition: 2026 },
  ...fields,
});
const render = (fields: Partial<PublicReaderCard> = {}, style: ReaderCardStyle = DEFAULT_READER_CARD_STYLE, print: "paper" | "reversed" = "paper") =>
  renderReaderCard({ card: card(fields), style, readerName: "andre", print, label: "Reader card", seed: seedOf("andre") });
const plain = renderPlate({ identity: "star", state: "settled", readerName: "andre", print: "paper", label: "Reader card" });

test("the default card draws the dial, the streak line and the streak's seal", () => {
  const svg = render();
  assert.match(svg, />WITH A STREAK OF THE LAMPLIGHTER</);
  assert.match(svg, /class="glyph id-lamp/);
  assert.match(svg, /stroke-width="1.15"/);
});

test("the trait setting picks line, seal, both or neither", () => {
  const traits = Object.fromEntries(TRAITS.map((trait) => {
    const svg = render({}, { ...DEFAULT_READER_CARD_STYLE, trait });
    return [trait, [/WITH A STREAK/.test(svg), /glyph id-lamp/.test(svg)]];
  }));
  assert.deepEqual(traits, { both: [true, true], seal: [false, true], line: [true, false], none: [false, false] });
});

test("a card with no streak draws no trait", () => {
  const svg = render({ streak: null });
  assert.doesNotMatch(svg, /WITH A STREAK/);
  assert.doesNotMatch(svg, /class="glyph/);
});

test("an older card without streak, dial or facts draws today's plate", () => {
  assert.equal(render({ streak: undefined, dial: undefined, facts: undefined }), plain);
});

test("an empty dial draws no counter", () => {
  assert.equal(render({ streak: null, dial: { segments: [] } }), plain);
});

test("an unwritten card keeps its counter but never a trait", () => {
  const svg = render({ state: "unwritten", identity: null, streak: "lamp" });
  assert.match(svg, />Unwritten</);
  assert.doesNotMatch(svg, /WITH A STREAK/);
  assert.match(svg, /stroke-width=".6" stroke-linecap="round" opacity=".8"/);
});

test("every counter, trait and print renders fully inlined", () => {
  for (const counter of COUNTERS) for (const trait of TRAITS) for (const print of ["paper", "reversed"] as const) {
    const svg = render({}, { counter, trait }, print);
    assert.doesNotMatch(svg, / class="\w+"/);
    assert.doesNotMatch(svg, /<style>|NaN/);
  }
});

test("normalising keeps known options and falls back field by field", () => {
  assert.deepEqual(normalizeReaderCardStyle(null), DEFAULT_READER_CARD_STYLE);
  assert.deepEqual(normalizeReaderCardStyle({ counter: "shelf", trait: "sparkle", extra: 1 }), { ...DEFAULT_READER_CARD_STYLE, counter: "shelf" });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./style.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/shared/src/readerCards/style.ts`:

```ts
import { COUNTERS, type Counter } from "./counters.js";

export const TRAITS = ["both", "seal", "line", "none"] as const;
export type Trait = (typeof TRAITS)[number];

export interface ReaderCardStyle {
  counter: Counter;
  trait: Trait;
}

export const DEFAULT_READER_CARD_STYLE: ReaderCardStyle = { counter: "dial", trait: "both" };

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

export function normalizeReaderCardStyle(value: unknown): ReaderCardStyle {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    counter: oneOf(COUNTERS, raw.counter, DEFAULT_READER_CARD_STYLE.counter),
    trait: oneOf(TRAITS, raw.trait, DEFAULT_READER_CARD_STYLE.trait),
  };
}
```

In `render.ts`, add these imports:

```ts
import type { DialGroup } from "../library/readerCardFacts.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { composePlate, SANS, type PlateFace, type PlateSlots } from "./compose.js";
import { drawCounter, SEAL_ANGLE } from "./counters.js";
import { emblems } from "./plates.js";
import type { ReaderCardStyle } from "./style.js";
```

(`emblems` joins the existing `./plates.js` import.) Then replace `renderPlate` with `faceOf` + `renderPlate` + `renderReaderCard`:

```ts
function faceOf({ identity, state, readerName, label, unwrittenLine, width = 250 }: RenderPlateOptions): { face: PlateFace; ink: IdentityKey | "graph" } {
  const reader = escape(truncateName(readerName).toUpperCase());
  const safeLabel = escape(label);
  if (state === "unwritten" || !identity) {
    return { ink: "graph", face: { key: "none", emblemSvg: emblems.none(), name: "Unwritten", eyebrow: "NOT YET", epithet: escape(unwrittenLine ?? "five finished books to begin"), numeral: "—", reader, width, label: safeLabel } };
  }
  const p = PLATES.find((item) => item.key === identity)!;
  return { ink: identity, face: { key: identity, emblemSvg: emblems[identity](), name: p.name, eyebrow: state === "leaning" ? "LEANING TOWARD" : "THE", epithet: p.epithet, numeral: p.numeral, reader, width, label: safeLabel } };
}

export function renderPlate(options: RenderPlateOptions): string {
  const { face, ink } = faceOf(options);
  return withStyle(composePlate(face), inks(ink, options.print));
}

export interface ReaderCardInput {
  card: PublicReaderCard;
  style: ReaderCardStyle;
  readerName: string;
  print: PlatePrint;
  label: string;
  unwrittenLine?: string;
  seed: number;
  width?: number;
}

const GENRE_LEADS: ReadonlySet<string> = new Set(["lamp", "star", "arch", "corr"]);
const SEAL_SIZE = 26;
const SEAL_RADIUS = 64;

function sealSlot(streak: IdentityKey, print: PlatePrint): string {
  const rad = (SEAL_ANGLE * Math.PI) / 180;
  const cx = 125 + SEAL_RADIUS * Math.sin(rad), cy = 134 - SEAL_RADIUS * Math.cos(rad);
  const glyphSvg = renderGlyph(streak, SEAL_SIZE, print).replace("<svg ", `<svg x="${(cx - SEAL_SIZE / 2).toFixed(2)}" y="${(cy - SEAL_SIZE / 2).toFixed(2)}" `);
  return `<circle class="pg" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${SEAL_SIZE / 2 + 2.5}"/>${glyphSvg}`;
}

function traitLine(streak: IdentityKey): string {
  const name = PLATES.find((item) => item.key === streak)!.name.toUpperCase();
  return `<text class="pt" x="125" y="297" text-anchor="middle" font-size="5.6" letter-spacing="1.5" font-family="${SANS}" font-weight="600">WITH A STREAK OF THE ${name}</text>`;
}

export function renderReaderCard(input: ReaderCardInput): string {
  const { card, style, print, seed } = input;
  const { face, ink } = faceOf({ ...input, identity: card.identity, state: card.state });
  const streak = card.state === "unwritten" ? null : card.streak ?? null;
  const seal = streak !== null && (style.trait === "both" || style.trait === "seal");
  const line = streak !== null && (style.trait === "both" || style.trait === "line");
  const lead = card.identity && GENRE_LEADS.has(card.identity) ? (card.identity as DialGroup) : null;
  const slots: PlateSlots = {};
  const counter = card.dial ? drawCounter(style.counter, card.dial.segments, { seed, sealGap: seal, lead }) : null;
  if (counter) slots[counter.slot] = counter.svg;
  if (streak && seal) slots.seal = sealSlot(streak, print);
  if (streak && line) slots.trait = traitLine(streak);
  return withStyle(composePlate(face, slots), inks(ink, print));
}
```

`renderGlyph` is already defined in `render.ts`, so call it directly. The `plate` import from `./plates.js` is no longer used by `render.ts`; remove it from that import.

`readerCards/index.ts` becomes:

```ts
export { PLATES as READER_PLATES, INKS as PLATE_INKS, PLATE_FONTS, type IdentityKey } from "./plates.js";
export * from "./render.js";
export * from "./card.js";
export * from "./style.js";
export { COUNTERS, drawCounter, type Counter, type CounterLayer } from "./counters.js";
export { seedOf } from "./seed.js";
```

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS. The existing `plates.test.ts` `renderPlate` tests stay green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Render the reader card front with its counter and streak

renderPlate keeps today's output, so the landing page and any caller
without card data are unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Portability guard and contact sheet

**Files:**
- Create: `packages/shared/src/readerCards/portable.test.ts`
- Create: `packages/shared/scripts/contact-sheet.ts`
- Modify: `packages/shared/package.json` (add the `sheet` script)

**Interfaces:**
- Consumes: `renderReaderCard`, `COUNTERS`, `TRAITS`, `DEFAULT_READER_CARD_STYLE`, `READER_PLATES`, `seedOf`, `PublicReaderCard`, `DialSegment`.
- Produces: `npm run sheet -w @scripta/shared [outDir]`, which writes `counters.html` and `traits.html`. A5 and A6 add dimensions to its `dimensions` map, and their options to the matrix in `portable.test.ts`.

- [ ] **Step 1: Write the guard test**

Create `packages/shared/src/readerCards/portable.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DialSegment } from "../library/readerCardFacts.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { COUNTERS } from "./counters.js";
import { PLATES, type IdentityKey } from "./plates.js";
import { renderReaderCard } from "./render.js";
import { seedOf } from "./seed.js";
import { TRAITS } from "./style.js";

const ELEMENTS = new Set(["svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath", "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "image", "filter", "feOffset", "feFlood", "feComposite", "feMerge", "feMergeNode", "feGaussianBlur", "feColorMatrix", "feBlend", "feDropShadow"]);

function portabilityProblems(svg: string): string[] {
  const problems: string[] = [];
  for (const [, name, attrs] of svg.matchAll(/<([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    if (!ELEMENTS.has(name!)) problems.push(`<${name}>`);
    for (const [, attr, value] of attrs!.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      if (attr === "class" && !/^(plate|glyph) id-/.test(value!)) problems.push(`class="${value}"`);
      if (attr === "style" && value!.includes("mix-blend-mode")) problems.push("mix-blend-mode");
      if ((attr === "href" || attr === "xlink:href") && !value!.startsWith("data:")) problems.push(`${attr}="${value!.slice(0, 40)}"`);
    }
  }
  if (/NaN|Infinity/.test(svg)) problems.push("NaN");
  return problems;
}

const dials: Record<string, DialSegment[]> = {
  empty: [],
  small: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 8, marked: 1 }, { group: "unknown", books: 3, marked: 0 }],
  large: [{ group: "corr", books: 146, marked: 60 }, { group: "star", books: 47, marked: 20 }, { group: "lamp", books: 53, marked: 7 }, { group: "arch", books: 33, marked: 0 }, { group: "other", books: 41, marked: 7 }, { group: "unknown", books: 12, marked: 0 }],
};
const identities: Array<IdentityKey | null> = [...PLATES.map((plate) => plate.key), null];

test("every counter, trait, print, state and identity stays inside react-native-svg's subset", () => {
  for (const identity of identities) for (const state of identity ? (["settled", "leaning"] as const) : (["unwritten"] as const)) {
    for (const [size, segments] of Object.entries(dials)) for (const counter of COUNTERS) for (const trait of TRAITS) for (const print of ["paper", "reversed"] as const) {
      const card: PublicReaderCard = { state, identity, runnerUp: null, streak: identity === "lamp" ? "star" : "lamp", signal: null, coverage: [], dial: { segments }, facts: { finished: 0, highlights: 0, series: 0, since: null, edition: 2026 } };
      const svg = renderReaderCard({ card, style: { counter, trait }, readerName: "andre", print, label: "x", seed: seedOf("andre") });
      assert.deepEqual(portabilityProblems(svg), [], `${identity}/${state}/${size}/${counter}/${trait}/${print}`);
    }
  }
});
```

- [ ] **Step 2: Run it**

Run: `npm test -w @scripta/shared`
Expected: PASS. A failure names the combination and the offending element. Fix the fragment that produced it in `counters.ts` or `render.ts`; do not widen `ELEMENTS`.

- [ ] **Step 3: Write the contact sheet**

Create `packages/shared/scripts/contact-sheet.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DialSegment, PublicReaderCard } from "../src/library/index.js";
import { COUNTERS, DEFAULT_READER_CARD_STYLE, READER_PLATES, TRAITS, renderReaderCard, seedOf, type PlatePrint, type ReaderCardStyle } from "../src/readerCards/index.js";

const out = process.argv[2] ?? join(tmpdir(), "reader-card-sheet");
const SEGMENTS: DialSegment[] = [
  { group: "star", books: 22, marked: 9 },
  { group: "corr", books: 7, marked: 3 },
  { group: "lamp", books: 8, marked: 1 },
  { group: "arch", books: 5, marked: 0 },
  { group: "other", books: 6, marked: 1 },
];
const PRINTS: PlatePrint[] = ["paper", "reversed"];

const dimensions: Record<string, Array<[string, ReaderCardStyle]>> = {
  counters: COUNTERS.map((counter) => [counter, { ...DEFAULT_READER_CARD_STYLE, counter }]),
  traits: TRAITS.map((trait) => [trait, { ...DEFAULT_READER_CARD_STYLE, trait }]),
};

const cardOf = (index: number): PublicReaderCard => ({
  state: "settled",
  identity: READER_PLATES[index]!.key,
  runnerUp: null,
  streak: READER_PLATES[(index + 1) % READER_PLATES.length]!.key,
  signal: null,
  coverage: [],
  dial: { segments: SEGMENTS },
  facts: { finished: 48, highlights: 140, series: 12, since: 2014, edition: 2026 },
});

mkdirSync(out, { recursive: true });
for (const [name, options] of Object.entries(dimensions)) {
  const rows = options.map(([label, style]) => {
    const cards = READER_PLATES.flatMap((plate, index) => PRINTS.map((print) => renderReaderCard({ card: cardOf(index), style, readerName: "example reader", print, label: plate.name, seed: seedOf(plate.key), width: 120 })));
    return `<h2>${label}</h2><div class="row">${cards.join("")}</div>`;
  });
  writeFileSync(join(out, `${name}.html`), `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{font:14px system-ui;background:#8a8a8a;margin:16px}.row{display:flex;flex-wrap:wrap;gap:8px}</style>${rows.join("")}`);
}
console.log(out);
```

In `packages/shared/package.json` `scripts`, add:

```json
"sheet": "node --import tsx scripts/contact-sheet.ts"
```

- [ ] **Step 4: Run the sheet and look at it**

Run: `npm run sheet -w @scripta/shared`
Expected: it prints a directory containing `counters.html` and `traits.html`. Open `counters.html` in the preview browser and check four things:
- each row shows 16 cards;
- the shelf sits under EX LIBRIS without touching it;
- the dial and ring leave a gap where the seal sits;
- the frame ticks avoid the corner diamonds.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards/portable.test.ts packages/shared/scripts/contact-sheet.ts packages/shared/package.json && git commit -m "Guard the reader card to react-native-svg's subset and add a contact sheet

react-native-svg 15.15.4 stubs feTurbulence, feDisplacementMap and feImage
and has no SMIL or blend modes; the test fails on any of them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Store the dial and facts on save

**Files:**
- Modify: `backend/src/modules/library/service.ts:146-154` (`readerCardOf`) and its `@scripta/shared` import (line 6)
- Modify: `backend/src/modules/library/domain/constants.ts:1` (`LIBRARY_DERIVED_VERSION = 2`)
- Test: `backend/src/modules/library/service.test.ts`
- Modify (expected shapes only): `backend/src/modules/murals/home.test.ts` (~120-126, ~151) and `backend/src/modules/library/publicViews.test.ts` (~689, ~737, ~798, ~820, ~870)

**Interfaces:**
- Consumes: `publicReaderCardOf` (Task 2).
- Produces: `library_summary.reader_card` JSON now carries `streak`, `dial` and `facts`. A2 reads it.

- [ ] **Step 1: Write the failing tests** (append to `service.test.ts`, which has `setup`, `changeLibrary`, `keyOf`, `rowsInDb`)

```ts
test("a saved library's reader card carries the streak, the dial and the facts", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", changeLibrary());
  const card = JSON.parse(rowsInDb(db, "u1").summary.reader_card as string);
  assert.equal(card.facts.finished, 10);
  assert.equal(card.facts.series, 1);
  assert.ok(Array.isArray(card.dial.segments));
  assert.ok("streak" in card);
  assert.equal("leaders" in card, false);
});

test("finishing or unfinishing a book recomputes the stored facts", () => {
  const { db, service } = setup();
  service.saveLibrary("u1", changeLibrary());
  service.applyChange("u1", { kind: "book", bookKey: keyOf(3), readStatus: 0 });
  assert.equal(JSON.parse(rowsInDb(db, "u1").summary.reader_card as string).facts.finished, 9);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build -w @scripta/shared && npm exec -w backend -- tsx --test src/modules/library/service.test.ts`
Expected: the two new tests FAIL (`card.facts` is undefined).

- [ ] **Step 3: Implement**

In `service.ts`, change `readerCardOf`:

```ts
export function readerCardOf(parts: { allBooks: Record<string, unknown>[]; groupRecords: Record<string, unknown>[] }, report: ReportSkippedRow): string | null {
  try {
    return JSON.stringify(publicReaderCardOf(parts.allBooks, toReaderGroups(parts.groupRecords)));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    report(error, "no reader card");
    return null;
  }
}
```

Add `publicReaderCardOf` to the `@scripta/shared` import on line 6, and drop `publicReaderCard` from it if nothing else in the file uses it (`readerIdentity` is still used at line 56).

In `domain/constants.ts`: `export const LIBRARY_DERIVED_VERSION = 2;`. Bumping it drops `library_derived` at boot, so `backfillLibraryDerived` sees every user as stale and `setRows` rewrites each `reader_card` once.

- [ ] **Step 4: Run the backend suite and fix pinned shapes**

Run: `npm run typecheck -w backend && npm test -w backend`
Expected: the new tests pass. Tests that `assert.deepEqual` a whole `readerCard` fail on the new fields: `murals/home.test.ts` around 120-126 and 151, and `library/publicViews.test.ts` around 689, 737, 798, 820 and 870.

Fix each by comparing without the volatile parts, keeping every field it already checked:

```ts
const { dial, facts, ...identity } = payload.readerCard!;
assert.deepEqual(identity, expectedIdentity);
assert.ok(dial && facts);
```

Here `expectedIdentity` is the object the test already compared, plus `streak` with the value the failure prints. Do not deep-compare `facts`, because `facts.edition` is the current year. Re-run until green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/library backend/src/modules/murals/home.test.ts && git commit -m "Store the reader card's streak, dial and facts with the library summary

LIBRARY_DERIVED_VERSION moves to 2 so the boot backfill rewrites every
stored card once.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Draw the new front on web and mobile

**Files:**
- Modify: `frontend/src/hooks/useReaderCard.ts`
- Modify: `frontend/src/components/murals/blocks/ReaderCardBlock.tsx` (`ReaderCardPlate`)
- Modify: `mobile/src/features/murals/ReaderCardBlock.tsx`

**Interfaces:**
- Consumes: `renderReaderCard`, `readerCardFacts`, `DEFAULT_READER_CARD_STYLE`, `seedOf`.
- Produces: the owner's card carries locally computed `dial`/`facts`, and a visitor's card uses the server's. A3 replaces these components with `ReaderCardImage` and `ReaderCardViewer`.

- [ ] **Step 1: Web hook**

`frontend/src/hooks/useReaderCard.ts`:

```ts
import { useMemo } from "react";
import { readerCardFacts, readerIdentity, type Group, type PublicReaderCard } from "@scripta/shared";

export function useReaderCard(books: Array<Record<string, unknown>>, groups: Group[], override?: PublicReaderCard) {
  const own = useMemo(() => (override ? null : readerIdentity(books, groups)), [books, groups, override]);
  const card = useMemo<PublicReaderCard>(() => override ?? { ...own!, ...readerCardFacts(books, groups, own!.identity) }, [override, own, books, groups]);
  return { card, own };
}
```

- [ ] **Step 2: Web plate**

In `ReaderCardBlock.tsx`, the import line becomes:

```ts
import { DEFAULT_READER_CARD_STYLE, READER_PLATES, readerCardLabel, readerCardPlateLine, renderReaderCard, seedOf, type Group, type PublicReaderCard, type ReaderIdentity } from "@scripta/shared";
```

and the memo in `ReaderCardPlate`:

```ts
  const { paper, reversed } = useMemo(() => {
    const base = { card, style: DEFAULT_READER_CARD_STYLE, readerName, label, unwrittenLine, seed: seedOf(readerName) };
    return { paper: renderReaderCard({ ...base, print: "paper" }), reversed: renderReaderCard({ ...base, print: "reversed" }) };
  }, [card, readerName, label, unwrittenLine]);
```

Run `rg -n "ReaderCardPlate|useReaderCard" frontend/src` and confirm that every `card` handed to `ReaderCardPlate` comes from `useReaderCard` or a server `readerCardOverride`.

- [ ] **Step 3: Mobile block**

In `mobile/src/features/murals/ReaderCardBlock.tsx`, the import becomes:

```ts
import { DEFAULT_READER_CARD_STYLE, PLATE_FONTS, READER_PLATES, readerCardFacts, readerCardLabel, readerCardPlateLine, readerIdentity, renderReaderCard, seedOf, type Group, type PublicReaderCard } from "@scripta/shared";
```

Replace the `card` line and the `xml` memo with:

```ts
  const card = useMemo<PublicReaderCard>(() => publicCard ?? { ...own!, ...readerCardFacts(books, groups, own!.identity) }, [publicCard, own, books, groups]);
  const label = readerCardLabel(card);
  const unwrittenLine = own ? readerCardPlateLine(own.missing) : "yet to be written";
  const xml = useMemo(() => {
    const svg = renderReaderCard({ card, style: DEFAULT_READER_CARD_STYLE, readerName, print: mode === "dark" ? "reversed" : "paper", label, unwrittenLine, seed: seedOf(readerName) });
    return svg.replaceAll(PLATE_FONTS.serif, cardFontFamily("playfairDisplay")).replaceAll(PLATE_FONTS.sans, cardFontFamily("sans"));
  }, [card, readerName, mode, label, unwrittenLine]);
```

- [ ] **Step 4: Verify every package**

Run:

```bash
npm run build -w @scripta/shared && npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend && npm run typecheck -w mobile && npm test -w mobile
```

Expected: all PASS.

**Web check:** start the fixture stack as `docs/dev-workflow.md` describes, sign in to the seeded account, and open your own shelf, `/community/u/<username>`, with its reader card block. Screenshot the card: a dial round the emblem, "WITH A STREAK OF THE …" under the epithet, and a seal at the ring's lower right, in both the light and the dark theme.

**Mobile check:** after `node scripts/dev-status.mjs --json` shows the emulator free, dispatch `device-checker` for the My shelf tab, Shelf sub-tab, with the same expectations in light and dark mode. Tapping the card still opens today's sheet.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useReaderCard.ts frontend/src/components/murals/blocks/ReaderCardBlock.tsx mobile/src/features/murals/ReaderCardBlock.tsx && git commit -m "Draw the reader card's counter and streak on web and mobile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Ship A1**

1. Run `branch-reviewer` with this plan and the spec.
2. Push, and open PR "Reader card A1: counter and streak" against `main` with `--auto`.
3. Cut the A2 branch from this one: `git switch -c claude/reader-card-a2`.

---

## Phase A2 · Backend style and public choices

### Task 9: Choices in the style, rekeying, and the API factory

**Files:**
- Modify: `packages/shared/src/readerCards/style.ts`
- Modify: `packages/shared/src/library/readerIdentity.ts` (`PublicReaderCard` gains `style?`, `chosen?`)
- Create: `packages/shared/src/readerCards/api.ts`
- Modify: `packages/shared/src/readerCards/index.ts` (add `export * from "./api.js";`)
- Test: `packages/shared/src/readerCards/style.test.ts`, `packages/shared/src/readerCards/api.test.ts`

**Interfaces:**
- Produces:

```ts
export const SIGNATURE_NOTE_MAX = 60;
export interface ChosenSignature { bookKey: string; note: string | null }
export interface ChosenHighlight { bookKey: string; highlightId: string }
export interface ReaderCardStyle { counter: Counter; trait: Trait; signature: ChosenSignature | null; highlight: ChosenHighlight | null }
export type ReaderCardStylePatch = Partial<ReaderCardStyle>;
export type PublicReaderCardStyle = Omit<ReaderCardStyle, "signature" | "highlight">;
export interface ReaderCardChosen {
  signature?: { title: string; author: string; workId: string | null; coverUrl: string | null; note: string | null };
  highlight?: { text: string; title: string; author: string };
}
export function publicStyle(style: ReaderCardStyle): PublicReaderCardStyle;
export function rekeyReaderCardStyle(style: ReaderCardStyle, fromKeys: readonly string[], toKey: string): ReaderCardStyle;
export function createReaderCardApi(request: ApiRequest): { fetchReaderCardStyle(): Promise<ReaderCardStyle>; updateReaderCardStyle(patch: ReaderCardStylePatch): Promise<ReaderCardStyle> };
```

`PublicReaderCard` adds `& { style?: PublicReaderCardStyle; chosen?: ReaderCardChosen }`. `renderReaderCard` takes a `style` typed `Pick<ReaderCardStyle, "counter" | "trait">`, so both full and public styles render.

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/readerCards/style.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, publicStyle, rekeyReaderCardStyle } from "./style.js";

test("the default style chooses no book and no highlight", () => {
  assert.deepEqual(DEFAULT_READER_CARD_STYLE, { counter: "dial", trait: "both", signature: null, highlight: null });
});

test("a signature needs a book key; its note is trimmed, capped at 60 and empty means none", () => {
  assert.equal(normalizeReaderCardStyle({ signature: { note: "x" } }).signature, null);
  assert.deepEqual(normalizeReaderCardStyle({ signature: { bookKey: "k", note: "  why  " } }).signature, { bookKey: "k", note: "why" });
  assert.deepEqual(normalizeReaderCardStyle({ signature: { bookKey: "k", note: "   " } }).signature, { bookKey: "k", note: null });
  assert.equal(normalizeReaderCardStyle({ signature: { bookKey: "k", note: "a".repeat(80) } }).signature?.note?.length, 60);
});

test("a highlight needs both its book key and its id", () => {
  assert.equal(normalizeReaderCardStyle({ highlight: { bookKey: "k" } }).highlight, null);
  assert.deepEqual(normalizeReaderCardStyle({ highlight: { bookKey: "k", highlightId: "h" } }).highlight, { bookKey: "k", highlightId: "h" });
});

test("the public style drops the private references", () => {
  const style = normalizeReaderCardStyle({ counter: "ring", signature: { bookKey: "k" }, highlight: { bookKey: "k", highlightId: "h" } });
  assert.deepEqual(publicStyle(style), { counter: "ring", trait: "both" });
});

test("rekeying moves choices on merged books and leaves the rest", () => {
  const style = normalizeReaderCardStyle({ signature: { bookKey: "old" }, highlight: { bookKey: "other", highlightId: "h" } });
  const next = rekeyReaderCardStyle(style, ["old"], "kept");
  assert.equal(next.signature?.bookKey, "kept");
  assert.equal(next.highlight?.bookKey, "other");
  assert.equal(rekeyReaderCardStyle(DEFAULT_READER_CARD_STYLE, ["old"], "kept").signature, null);
});
```

Create `packages/shared/src/readerCards/api.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createReaderCardApi } from "./api.js";

test("the reader card API reads and patches the owner's style", async () => {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const api = createReaderCardApi((async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return {};
  }) as ApiRequest);
  await api.fetchReaderCardStyle();
  await api.updateReaderCardStyle({ counter: "shelf" });
  assert.deepEqual(calls, [
    { path: "/library/reader-card/style", init: { auth: "required" } },
    { path: "/library/reader-card/style", init: { method: "PATCH", body: { counter: "shelf" }, auth: "required" } },
  ]);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because the new exports and `./api.js` do not exist.

- [ ] **Step 3: Implement**

`style.ts` becomes:

```ts
import { COUNTERS, type Counter } from "./counters.js";

export const TRAITS = ["both", "seal", "line", "none"] as const;
export type Trait = (typeof TRAITS)[number];
export const SIGNATURE_NOTE_MAX = 60;

export interface ChosenSignature { bookKey: string; note: string | null }
export interface ChosenHighlight { bookKey: string; highlightId: string }

export interface ReaderCardStyle {
  counter: Counter;
  trait: Trait;
  signature: ChosenSignature | null;
  highlight: ChosenHighlight | null;
}

export type ReaderCardStylePatch = Partial<ReaderCardStyle>;
export type PublicReaderCardStyle = Omit<ReaderCardStyle, "signature" | "highlight">;

export interface ReaderCardChosen {
  signature?: { title: string; author: string; workId: string | null; coverUrl: string | null; note: string | null };
  highlight?: { text: string; title: string; author: string };
}

export const DEFAULT_READER_CARD_STYLE: ReaderCardStyle = { counter: "dial", trait: "both", signature: null, highlight: null };

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

const key = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);
const record = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : null);

function signatureOf(value: unknown): ChosenSignature | null {
  const raw = record(value);
  const bookKey = key(raw?.bookKey);
  if (!bookKey) return null;
  const note = typeof raw?.note === "string" ? raw.note.trim().slice(0, SIGNATURE_NOTE_MAX) : "";
  return { bookKey, note: note || null };
}

function highlightOf(value: unknown): ChosenHighlight | null {
  const raw = record(value);
  const bookKey = key(raw?.bookKey), highlightId = key(raw?.highlightId);
  return bookKey && highlightId ? { bookKey, highlightId } : null;
}

export function normalizeReaderCardStyle(value: unknown): ReaderCardStyle {
  const raw = record(value) ?? {};
  return {
    counter: oneOf(COUNTERS, raw.counter, DEFAULT_READER_CARD_STYLE.counter),
    trait: oneOf(TRAITS, raw.trait, DEFAULT_READER_CARD_STYLE.trait),
    signature: signatureOf(raw.signature),
    highlight: highlightOf(raw.highlight),
  };
}

export function publicStyle(style: ReaderCardStyle): PublicReaderCardStyle {
  return { counter: style.counter, trait: style.trait };
}

export function rekeyReaderCardStyle(style: ReaderCardStyle, fromKeys: readonly string[], toKey: string): ReaderCardStyle {
  const from = new Set(fromKeys);
  return {
    ...style,
    signature: style.signature && from.has(style.signature.bookKey) ? { ...style.signature, bookKey: toKey } : style.signature,
    highlight: style.highlight && from.has(style.highlight.bookKey) ? { ...style.highlight, bookKey: toKey } : style.highlight,
  };
}
```

In `render.ts`, change `ReaderCardInput.style` to `Pick<ReaderCardStyle, "counter" | "trait">`. In `readerCard.test.ts`, change the `style` parameter type of `render` to `Pick<ReaderCardStyle, "counter" | "trait">` as well. `publicStyle` lists each public field by name, and every later phase that adds a public option adds it there. The Task 5 test `normalising keeps known options …` now expects `{ ...DEFAULT_READER_CARD_STYLE, counter: "shelf" }`, which includes the two nulls, so it still holds.

In `readerIdentity.ts`:

```ts
import type { PublicReaderCardStyle, ReaderCardChosen } from "../readerCards/style.js";

export type PublicReaderCard = Pick<ReaderIdentity, "state" | "identity" | "runnerUp" | "signal" | "coverage"> & Partial<Pick<ReaderIdentity, "streak">> & Partial<ReaderCardFacts> & { style?: PublicReaderCardStyle; chosen?: ReaderCardChosen };
```

Create `packages/shared/src/readerCards/api.ts`:

```ts
import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { ReaderCardStyle, ReaderCardStylePatch } from "./style.js";

export function createReaderCardApi(request: ApiRequest) {
  return {
    fetchReaderCardStyle(): Promise<ReaderCardStyle> {
      return request<ReaderCardStyle>(apiPath`/library/reader-card/style`, { auth: "required" });
    },
    updateReaderCardStyle(patch: ReaderCardStylePatch): Promise<ReaderCardStyle> {
      return request<ReaderCardStyle>(apiPath`/library/reader-card/style`, { method: "PATCH", body: patch, auth: "required" });
    },
  };
}

export type ReaderCardApi = ReturnType<typeof createReaderCardApi>;
```

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src && git commit -m "Add the reader card's chosen book and highlight to its style

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Store the style per user

**Files:**
- Modify: `backend/src/modules/library/adapters/sqlite/schema.sql` (append the table)
- Modify: `backend/src/modules/library/domain/ports.ts` (two methods)
- Modify: `backend/src/modules/library/adapters/sqlite/sqliteLibraryRepository.ts` (statements, methods, eraser line)
- Test: `backend/src/modules/library/adapters/sqlite/sqliteLibraryRepository.test.ts`

**Interfaces:**
- Produces on `LibraryRepository`:

```ts
getReaderCardStyle(userId: string): string | undefined;
setReaderCardStyle(userId: string, style: string): void;
```

`deleteUserData` also clears `reader_card_styles`.

- [ ] **Step 1: Write the failing tests** (append; the file already imports `applyLibrarySchema`, `createSqliteLibraryRepository`, `DatabaseSync`)

```ts
test("a reader card style is stored per user, replaced on write and erased with the user", () => {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const repo = createSqliteLibraryRepository(db);
  assert.equal(repo.getReaderCardStyle("u1"), undefined);
  repo.setReaderCardStyle("u1", `{"counter":"shelf"}`);
  repo.setReaderCardStyle("u1", `{"counter":"ring"}`);
  repo.setReaderCardStyle("u2", `{"counter":"dial"}`);
  assert.equal(repo.getReaderCardStyle("u1"), `{"counter":"ring"}`);
  repo.deleteUserData("u1");
  assert.equal(repo.getReaderCardStyle("u1"), undefined);
  assert.equal(repo.getReaderCardStyle("u2"), `{"counter":"dial"}`);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm exec -w backend -- tsx --test src/modules/library/adapters/sqlite/sqliteLibraryRepository.test.ts`
Expected: FAIL, because `repo.getReaderCardStyle is not a function`.

- [ ] **Step 3: Implement**

Append to `schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS reader_card_styles (
  user_id    TEXT PRIMARY KEY,
  style      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

In `ports.ts`, inside `LibraryRepository`:

```ts
  getReaderCardStyle(userId: string): string | undefined;
  setReaderCardStyle(userId: string, style: string): void;
```

In `sqliteLibraryRepository.ts`, next to `getStmt` at the top of the factory:

```ts
  const getStyleStmt = db.prepare(`SELECT style FROM reader_card_styles WHERE user_id = ?`);
  const setStyleStmt = db.prepare(`
    INSERT INTO reader_card_styles (user_id, style, updated_at)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(user_id) DO UPDATE SET style = excluded.style, updated_at = excluded.updated_at
  `);
```

In the returned object:

```ts
    getReaderCardStyle(userId) {
      return (getStyleStmt.get(userId) as { style: string } | undefined)?.style;
    },
    setReaderCardStyle(userId, style) {
      setStyleStmt.run(userId, style);
    },
```

And inside `deleteUserData`'s transaction, after the `library_summary` line:

```ts
        db.prepare("DELETE FROM reader_card_styles WHERE user_id = ?").run(userId);
```

- [ ] **Step 4: Run the library backend tests**

Run: `npm run build -w @scripta/shared && npm run typecheck -w backend && npm exec -w backend -- tsx --test src/modules/library/adapters/sqlite/sqliteLibraryRepository.test.ts src/modules/library/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/library && git commit -m "Store each reader's card style in the library database

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Read and change the style over the API

**Files:**
- Modify: `backend/src/modules/library/domain/errors.ts` (new error)
- Modify: `backend/src/modules/library/service.ts` (`LibraryService` interface at line 267, factory at line 301)
- Modify: `backend/src/modules/library/routes.ts` (schema near line 96; a new scope inside `libraryRoutes`)
- Test: `backend/src/modules/library/routes.test.ts`

**Interfaces:**
- Consumes: `normalizeReaderCardStyle`, `COUNTERS`, `TRAITS`, `SIGNATURE_NOTE_MAX`, `eligiblePassages`, `bookKey`, `isFinishedBook` from `@scripta/shared`; `repo.getReaderCardStyle` and `repo.setReaderCardStyle` (Task 10).
- Produces on `LibraryService`:

```ts
getReaderCardStyle(userId: string): ReaderCardStyle;
patchReaderCardStyle(userId: string, patch: ReaderCardStylePatch): ReaderCardStyle;
```

Also `InvalidReaderCardChoiceError`.

- [ ] **Step 1: Write the failing tests** (append to `routes.test.ts`, whose `setup()` returns `{ app, service, … }` and whose bearer token is the user id)

```ts
const { bookKey } = await import("@scripta/shared");

const styleUrl = "/library/reader-card/style";
const asUser = (user: string) => ({ authorization: `Bearer ${user}` });
const wizard = { Title: "A Wizard of Earthsea", Attribution: "Ursula K. Le Guin", ReadStatus: 2, highlights: [
  { Type: "highlight", Text: "To light a candle", BookmarkID: "h1" },
  { Type: "note", Text: "mine", Annotation: "private", BookmarkID: "n1" },
  { Type: "review", Text: "five stars", BookmarkID: "goodreads-review:1" },
] };
const unread = { Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1 };

test("GET reader card style returns the default before any change", async () => {
  const { app } = await setup();
  const response = await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { counter: "dial", trait: "both", signature: null, highlight: null });
  await app.close();
});

test("PATCH reader card style merges each change into the stored style", async () => {
  const { app } = await setup();
  await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { counter: "shelf" } });
  const response = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { trait: "seal" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { counter: "shelf", trait: "seal", signature: null, highlight: null });
  await app.close();
});

test("PATCH reader card style rejects unknown options and unknown fields", async () => {
  const { app } = await setup();
  for (const payload of [{ counter: "spiral" }, { trait: 3 }, { motto: "x" }, { signature: { bookKey: "k", note: "a".repeat(61) } }]) {
    const response = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.equal(typeof response.json().error, "string");
  }
  await app.close();
});

test("a signature must be a finished book in the caller's own library", async () => {
  const { app, service } = await setup();
  service.saveLibrary("u1", { books: [wizard, unread], groups: [] });
  const patch = (user: string, key: string) => app.inject({ method: "PATCH", url: styleUrl, headers: asUser(user), payload: { signature: { bookKey: key, note: "  why  " } } });
  assert.equal((await patch("u1", bookKey(unread))).statusCode, 400);
  assert.equal((await patch("u2", bookKey(wizard))).statusCode, 400);
  const ok = await patch("u1", bookKey(wizard));
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().signature, { bookKey: bookKey(wizard), note: "why" });
  await app.close();
});

test("a highlight must be one of the caller's Kobo highlights, not a note or a review", async () => {
  const { app, service } = await setup();
  service.saveLibrary("u1", { books: [wizard], groups: [] });
  const patch = (highlightId: string) => app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { highlight: { bookKey: bookKey(wizard), highlightId } } });
  assert.equal((await patch("n1")).statusCode, 400);
  assert.equal((await patch("goodreads-review:1")).statusCode, 400);
  assert.equal((await patch("h1")).statusCode, 200);
  const stored = await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") });
  assert.deepEqual(stored.json().highlight, { bookKey: bookKey(wizard), highlightId: "h1" });
  await app.close();
});

test("a rejected choice stores nothing, and null clears a choice", async () => {
  const { app, service } = await setup();
  service.saveLibrary("u1", { books: [wizard, unread], groups: [] });
  await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { signature: { bookKey: bookKey(wizard) } } });
  await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { counter: "ring", signature: { bookKey: bookKey(unread) } } });
  const afterReject = (await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") })).json();
  assert.equal(afterReject.counter, "dial");
  assert.equal(afterReject.signature.bookKey, bookKey(wizard));
  const cleared = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { signature: null } });
  assert.equal(cleared.json().signature, null);
  await app.close();
});

test("the reader card style needs a signed-in user", async () => {
  const { app } = await setup();
  assert.equal((await app.inject({ method: "GET", url: styleUrl })).statusCode, 401);
  await app.close();
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build -w @scripta/shared && npm exec -w backend -- tsx --test src/modules/library/routes.test.ts`
Expected: the new tests FAIL with 404 (no route).

- [ ] **Step 3: Implement**

`domain/errors.ts`:

```ts
export class InvalidReaderCardChoiceError extends LibraryError {
  constructor(readonly choice: "signature" | "highlight") {
    super(choice === "signature" ? "The signature book has to be a finished book in your library." : "The highlight has to be one of your Kobo highlights.");
  }
}
```

In `service.ts`:
- Add `eligiblePassages, normalizeReaderCardStyle, type ReaderCardStyle, type ReaderCardStylePatch` to the `@scripta/shared` import. (`bookKey` and `isFinishedBook` are already imported.)
- Import `InvalidReaderCardChoiceError` from `./domain/errors.js`.

`LibraryService` gains:

```ts
  getReaderCardStyle(userId: string): ReaderCardStyle;
  patchReaderCardStyle(userId: string, patch: ReaderCardStylePatch): ReaderCardStyle;
```

Inside `createLibraryService`, before the returned object:

```ts
  const storedStyle = (userId: string): ReaderCardStyle => {
    const raw = repo.getReaderCardStyle(userId);
    return normalizeReaderCardStyle(raw === undefined ? null : JSON.parse(raw));
  };
```

And in the returned object:

```ts
    getReaderCardStyle(userId) {
      return storedStyle(userId);
    },

    patchReaderCardStyle(userId, patch) {
      const next = normalizeReaderCardStyle({ ...storedStyle(userId), ...patch });
      if (patch.signature || patch.highlight) {
        const row = repo.getDocument(userId);
        const books = row ? parseStoredLibrary(row).books.filter(isRecord) : [];
        const signature = next.signature;
        if (patch.signature && !(signature && books.some((book) => isFinishedBook(book) && bookKey(book) === signature.bookKey))) throw new InvalidReaderCardChoiceError("signature");
        const highlight = next.highlight;
        if (patch.highlight && !(highlight && eligiblePassages(books).some((ref) => ref.bookKey === highlight.bookKey && ref.highlightId === highlight.highlightId))) throw new InvalidReaderCardChoiceError("highlight");
      }
      repo.setReaderCardStyle(userId, JSON.stringify(next));
      return next;
    },
```

In `routes.ts`:
- Import `COUNTERS, SIGNATURE_NOTE_MAX, TRAITS` from `@scripta/shared`.
- Add `InvalidReaderCardChoiceError` to the errors import.
- Below `bookKeySchema`, add:

```ts
const readerCardStylePatchSchema = z.object({
  counter: z.enum(COUNTERS).optional(),
  trait: z.enum(TRAITS).optional(),
  signature: z.object({ bookKey: bookKeySchema, note: z.string().trim().max(SIGNATURE_NOTE_MAX).nullable().default(null) }).strict().nullable().optional(),
  highlight: z.object({ bookKey: bookKeySchema, highlightId: z.string().min(1).max(200) }).strict().nullable().optional(),
}).strict();
```

Inside `libraryRoutes`, after the `changes` scope:

```ts
    await app.register(async (cards) => {
      await cards.register(fastifyRateLimit, { max: 120, timeWindow: "1 minute", keyGenerator: rateLimitKey });

      cards.get("/library/reader-card/style", { preHandler: authGuard }, async (request) => service.getReaderCardStyle(request.user.id));

      cards.patch("/library/reader-card/style", { preHandler: authGuard }, async (request, reply) => {
        const parsed = readerCardStylePatchSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: "Expected a reader card style change with known options." });
        try {
          return reply.send(service.patchReaderCardStyle(request.user.id, parsed.data));
        } catch (error) {
          if (error instanceof InvalidReaderCardChoiceError) return reply.code(400).send({ error: error.message });
          throw error;
        }
      });
    });
```

- [ ] **Step 4: Run the library backend tests**

Run: `npm run typecheck -w backend && npm exec -w backend -- tsx --test src/modules/library/routes.test.ts src/modules/library/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/library && git commit -m "Let the owner read and change their reader card style

PATCH merges partial changes so an older client never wipes a field it
does not know; choices must name a finished book or a real Kobo highlight.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: The visitor's card carries the public style and resolved choices

**Files:**
- Modify: `backend/src/modules/library/publicResolver.ts` (statement cache at lines ~89-116, `resolvePublicLibraryData` at line 166)
- Test: `backend/src/modules/library/publicViews.test.ts`
- Modify (expected shapes only): the `readerCard` deep-equals touched in Task 7, which now also get `style` and `chosen`

**Interfaces:**
- Consumes: `normalizeReaderCardStyle`, `publicStyle`, `ReaderCardChosen`, `ReaderCardStyle` (Task 9); `toPublicBooks` and `highlightStmt` (existing).
- Produces: whenever `needsReaderCard` is set, `PublicLibraryData.readerCard` has `style` (public part) and `chosen` (`{}` when nothing is chosen or nothing resolves).

- [ ] **Step 1: Write the failing tests** (append; the file already builds `service` on `openLibraryDb()`; add imports for `resolvePublicLibraryData` from `./publicResolver.js` and `bookKey` from `@scripta/shared` if missing)

```ts
const cardRequest = { bookKeys: [], highlightRefs: [], needsCurrentlyReading: false, statsMetrics: [], needsReaderCard: true };
const earthsea = { Title: "A Wizard of Earthsea", Attribution: "Ursula K. Le Guin", ReadStatus: 2, highlights: [{ Type: "highlight", Text: "To light a candle", Annotation: "my private note", BookmarkID: "h1" }] };

test("a visitor's reader card carries the public style and the resolved choices, never the annotation", () => {
  const owner = "card-choices";
  service.saveLibrary(owner, { books: [earthsea], groups: [] });
  service.patchReaderCardStyle(owner, { counter: "shelf", signature: { bookKey: bookKey(earthsea), note: "why" }, highlight: { bookKey: bookKey(earthsea), highlightId: "h1" } });
  const result = resolvePublicLibraryData(owner, cardRequest);
  const card = result.readerCard!;
  assert.deepEqual(card.style, { counter: "shelf", trait: "both" });
  assert.equal(card.chosen?.signature?.title, "A Wizard of Earthsea");
  assert.equal(card.chosen?.signature?.author, "Ursula K. Le Guin");
  assert.equal(card.chosen?.signature?.note, "why");
  assert.deepEqual(card.chosen?.highlight, { text: "To light a candle", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" });
  assert.doesNotMatch(JSON.stringify(result), /my private note/);
  assert.deepEqual(result.books, []);
});

test("a chosen highlight whose book left the library drops out of the visitor's card", () => {
  const owner = "card-gone";
  service.saveLibrary(owner, { books: [earthsea], groups: [] });
  service.patchReaderCardStyle(owner, { signature: { bookKey: bookKey(earthsea), note: null }, highlight: { bookKey: bookKey(earthsea), highlightId: "h1" } });
  service.saveLibrary(owner, { books: [{ Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 2 }], groups: [] });
  assert.deepEqual(resolvePublicLibraryData(owner, cardRequest).readerCard?.chosen, {});
});

test("a reader who never styled their card gets the default public style and no choices", () => {
  const owner = "card-plain";
  service.saveLibrary(owner, { books: [earthsea], groups: [] });
  const card = resolvePublicLibraryData(owner, cardRequest).readerCard!;
  assert.deepEqual(card.style, { counter: "dial", trait: "both" });
  assert.deepEqual(card.chosen, {});
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm exec -w backend -- tsx --test src/modules/library/publicViews.test.ts`
Expected: the three new tests FAIL (`card.style` is undefined).

- [ ] **Step 3: Implement**

In `publicResolver.ts`:
- Extend the `@scripta/shared` import with `normalizeReaderCardStyle, publicStyle, type ReaderCardChosen, type ReaderCardStyle`.
- Add `styleStmt: Statement` to the `cached` type, and to the object built in `getStatements()`:

```ts
      styleStmt: db.prepare(`SELECT style FROM reader_card_styles WHERE user_id = ?`),
```

Add these helpers above `resolvePublicLibraryData`:

```ts
function readerCardStyleOf(userId: string): ReaderCardStyle {
  const row = getStatements().styleStmt.get(userId) as { style: string } | undefined;
  return normalizeReaderCardStyle(row ? JSON.parse(row.style) : null);
}

function chosenOf(userId: string, style: ReaderCardStyle, byKey: Map<string, BookRowRecord>): ReaderCardChosen {
  const chosen: ReaderCardChosen = {};
  const signatureRow = style.signature ? byKey.get(style.signature.bookKey) : undefined;
  if (style.signature && signatureRow) {
    const [book] = toPublicBooks([signatureRow]);
    chosen.signature = { title: book!.title, author: book!.author, workId: book!.workId ?? null, coverUrl: book!.coverUrl, note: style.signature.note };
  }
  const highlightRow = style.highlight ? byKey.get(style.highlight.bookKey) : undefined;
  if (style.highlight && highlightRow) {
    const found = getStatements().highlightStmt.get(userId, highlightRow.position, style.highlight.highlightId) as { text: string | null } | undefined;
    if (found?.text) chosen.highlight = { text: found.text, title: highlightRow.title || "Untitled", author: highlightRow.author || "Unknown author" };
  }
  return chosen;
}
```

In `resolvePublicLibraryData`, read the style before `wantedKeys`, and add its keys to the lookup only (not to `referenced`):

```ts
  const style = req.needsReaderCard ? readerCardStyleOf(userId) : null;
  const choiceKeys = [style?.signature?.bookKey, style?.highlight?.bookKey].filter((key): key is string => Boolean(key));
  const wantedKeys = [...new Set([...req.bookKeys, ...Object.values(collectionCandidates).flat(), ...req.highlightRefs.map((ref) => ref.bookKey), ...choiceKeys])];
```

Replace the `readerCard` spread in the return with:

```ts
    ...(req.needsReaderCard ? { readerCard: { ...(JSON.parse(summary.reader_card as string) as PublicReaderCard), style: publicStyle(style!), chosen: chosenOf(userId, style!, byKey) } } : {}),
```

- [ ] **Step 4: Run the backend suite and update pinned shapes**

Run: `npm run typecheck -w backend && npm test -w backend`
Expected: the new tests pass. The `readerCard` deep-equals adjusted in Task 7 now also fail on `style` and `chosen`. Add `style: { counter: "dial", trait: "both" }, chosen: {}` to their expected identity objects, or to the destructured remainder, and re-run until green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/library backend/src/modules/murals/home.test.ts && git commit -m "Send visitors the reader card's public style and chosen book and highlight

The highlight's annotation stays private, and a choice whose book left
the library is dropped instead of failing the mural.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Merging duplicates keeps the card's choices

**Files:**
- Modify: `backend/src/modules/library/service.ts` (`mergeBooks`, lines 462-476; a helper in the factory)
- Test: `backend/src/modules/library/service.test.ts`

**Interfaces:**
- Consumes: `rekeyReaderCardStyle` (Task 9), `storedStyle` (Task 11), `repo.setReaderCardStyle` (Task 10).
- Produces: after `mergeBooks(userId, keep, merge, …)`, a style whose `signature` or `highlight` named a merged-away key names `keep`.

- [ ] **Step 1: Write the failing test** (append; `owned` and `setup` exist; import `bookKey` from `@scripta/shared` if the file does not already)

```ts
test("merging duplicates moves the reader card's chosen book and highlight to the kept copy", () => {
  const { service } = setup();
  const kept = owned(1);
  const copy = { ...owned(1), ISBN: "9780441569595", highlights: [{ Type: "highlight", Text: "line", BookmarkID: "h1" }] };
  const saved = service.saveLibrary("u1", { books: [kept, copy], groups: [] });
  service.patchReaderCardStyle("u1", { signature: { bookKey: bookKey(copy), note: null }, highlight: { bookKey: bookKey(copy), highlightId: "h1" } });
  service.mergeBooks("u1", bookKey(kept), [bookKey(kept), bookKey(copy)], saved.updatedAt);
  const style = service.getReaderCardStyle("u1");
  assert.equal(style.signature?.bookKey, bookKey(kept));
  assert.equal(style.highlight?.bookKey, bookKey(kept));
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm exec -w backend -- tsx --test src/modules/library/service.test.ts`
Expected: FAIL, because the style still names `bookKey(copy)`.

- [ ] **Step 3: Implement**

Add `rekeyReaderCardStyle` to the `@scripta/shared` import in `service.ts`. Inside `createLibraryService`, below `storedStyle`:

```ts
  const rekeyStyle = (userId: string, fromKeys: string[], toKey: string) => {
    if (repo.getReaderCardStyle(userId) === undefined) return;
    const style = storedStyle(userId);
    const next = rekeyReaderCardStyle(style, fromKeys, toKey);
    if (next.signature !== style.signature || next.highlight !== style.highlight) repo.setReaderCardStyle(userId, JSON.stringify(next));
  };
```

In `mergeBooks`, directly after `if (fromKeys.length > 0 && rekeyBooks) rekeyBooks(userId, fromKeys, keep);`:

```ts
      if (fromKeys.length > 0) rekeyStyle(userId, fromKeys, keep);
```

- [ ] **Step 4: Run the backend suite**

Run: `npm run typecheck -w backend && npm test -w backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/library && git commit -m "Keep the reader card's choices when duplicate books merge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Ship A2**

1. Run the `security-review` skill. A2 decides what visitors see: the highlight text and the signature book.
2. Run `branch-reviewer` with this plan and the spec.
3. Push `claude/reader-card-a2` and open PR "Reader card A2: stored style and public choices" based on the A1 branch.
4. When A1 has merged, retarget the PR to `main` and then enable `--auto`. Auto-merge on a PR based on a non-main branch merges with no checks.
5. Deploying is the owner's call.
