# Reader card A3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the reader card its back pages (chosen, record, merged), a `layout` option, and a full-screen viewer on web and mobile that turns between them.

**Architecture:**
- **Shared (`@scripta/shared`):**
  - `renderReaderCard(input, page)` draws any page from one portable SVG renderer.
  - `readerCardPages` decides which pages a reader sees.
  - `turnBy`/`turnTo` hold the turning maths both clients animate.
  - `readerCardInputOf` builds the render input for the owner and for a visitor.
  - `fit.ts` estimates text widths so titles, notes and highlights wrap and end in "…".
- **Clients:**
  - Each gets a static `ReaderCardImage` for the mural block.
  - Each gets a `ReaderCardViewer` that replaces today's reader-card detail: the `MuralBlockDetail` sheet on web, the `Sheet` on mobile.
- **Backend:** only the `layout` option joins the PATCH schema.

**Tech Stack:** TypeScript, `node:test` via tsx, React 19 + Tailwind 4 (web, SSR tests with `react-dom/server`), Expo / React Native 0.86 with react-native-svg 15.15.4, Reanimated 4.5 and react-native-pager-view 8.0.2 (mobile), Fastify + zod (backend).

**Spec:** `docs/superpowers/specs/2026-10-07-reader-card-enrichment-design.md`: "Back", "Renderer", "Clients → Components", the A3 row of "Phases", and "A0 findings". Mockup geometry: `docs/superpowers/specs/2026-10-07-reader-card-mockups/pages.ts` and `verso.ts`.

**Starting point:**
- A1 (#203) is merged. A2 (#205) is open with auto-merge.
- Cut `claude/reader-card-a3` from `origin/main` once #205 has merged.
- If it hasn't, cut it from `claude/reader-card-a2`, and retarget the PR to `main` before `--auto`.

## Global Constraints

- **Code style:**
  - No comments in code (`AGENTS.md`).
  - Search with `rg`, and run git from the worktree root.
  - Stage and commit in one command. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Shared builds:**
  - Run `npm run dev:link-deps` once per worktree.
  - Run `npm run build -w @scripta/shared` before any backend, frontend or mobile typecheck or test, because consumers read `packages/shared/dist`.
  - The shared `tsconfig` excludes `*.test.ts`, so test files are not typechecked. Keep them type-correct anyway.
- **Existing output stays put:**
  - `plate()` stays byte-identical to the masters (`plates.test.ts`). `renderPlate()` is unchanged.
  - `renderReaderCard(input)` with no page argument draws exactly today's front.
- **Rendered SVG:**
  - Elements stay inside the allowlist in `portable.test.ts`.
  - `<svg>` only as the root.
  - No `<style>`, no `NaN`/`Infinity`, and no `class` other than the root `plate id-…` and the seal's `glyph id-…`.
  - No `id=` and no `url(#…)`. Web inlines every page twice (paper and reversed), and the hidden copy is `display:none`.
  - `href` is either `data:`, or exactly one `<image>` whose URL matches `/^https:\/\/[^\s"'<>&]+$/`.
- **Text in SVG:**
  - Text nodes go through `escapeText` (`&`, `<`, `>`), and attributes through `escape`.
  - react-native-svg's `SvgXml` decodes no entities. Mobile turns `&amp;` back into `&` before drawing (Task 9).
- **Privacy:**
  - With `view: "visitor"`, no page and no summary contains `leaders`, `missing` or a highlight annotation. This holds even when the input carries them.
  - The owner's `leaders`/`missing` stay on the device.
- **Options:**
  - `LAYOUTS = ["faces", "book", "merged"]`, with `"faces"` as the default.
  - `PublicReaderCardStyle` becomes `Pick<ReaderCardStyle, "counter" | "layout" | "trait">`.
- **Text limits:**
  - Signature title: 2 lines.
  - Highlight: 4 lines, the last ending in "…".
  - Note: up to 60 characters, wrapped to 2 lines.
- **Fonts:** Courier Prime (OFL) for the record rows. The family token is `MONO = "'Courier Prime', 'Courier New', Courier, monospace"`. The files are `frontend/public/fonts/courier-prime-400.ttf` and `mobile/assets/fonts/courierPrime-400.ttf`, both registered as `"Courier Prime"` and `"courierPrime-400"`. Fetching the TTF is a download: the controller confirms with the user before Task 8.
- **Motion:**
  - Web transitions only under `motion-safe:`, so reduced motion is an instant swap.
  - Mobile timings pass `reduceMotion: ReduceMotion.System`, and skip the animation when the app's `useReducedMotion()` is true.
  - Shared values use `.get()`/`.set()`, never `.value` in JSX.
- **Mobile:** `Text` only from `mobile/src/ui/Text` (`textImports.test.ts`). No new native dependency, so this ships over the air.
- **Not in A3:**
  - The "Edit card" button, the owner's style query and the owner's chosen book and highlight (A4).
  - Shine (A6) and mottos, footers and corners (A5).

## Review Focus

1. **A highlight or title full of `"`, `&` and `<b>`:** it draws literally on web and mobile, never as markup, and never as `&amp;` on mobile. Pinned in Task 5 ("text is escaped once…") and Task 9 ("ampersands draw as themselves").
2. **A 300-character highlight and a 60-character note with long words:** the highlight stops at 4 lines ending "…", and nothing runs past the frame. Pinned in Task 2 and Task 5 ("a long highlight stops at four lines").
3. **A cover URL that is `http:`, `javascript:`, or contains `"` or `&`:** a typographic cover is drawn and no `<image>` appears. Pinned in Task 5 ("only a plain https cover becomes an image").
4. **A visitor on any page or layout:** never sees a leader, the missing line or an annotation, even if the input carries them. Pinned in Task 7.
5. **An older server card (no `style`, `dial`, `facts`, `chosen`) or a newer one (an unknown layout `"scroll"`):** the viewer falls back to faces, and the record page draws what exists with no `undefined`/`NaN`. Pinned in Task 3 ("an older or newer server style…") and Task 4 ("an older card…").

---

### Task 1: The `layout` option

**Files:**
- Modify: `packages/shared/src/readerCards/style.ts`
- Modify: `packages/shared/src/readerCards/style.test.ts`
- Modify: `backend/src/modules/library/routes.ts` (the `readerCardStylePatchSchema` near line 98)
- Modify (expected shapes): `backend/src/modules/library/routes.test.ts` (≈498, 521, 533, 600, plus the reject test), `backend/src/modules/library/publicViews.test.ts` (≈708, 755, 819, 981, 1040), `backend/src/modules/murals/home.test.ts` (≈128)

**Interfaces:**
- Produces: `LAYOUTS`, `Layout`, `ReaderCardStyle.layout`, `PublicReaderCardStyle = Pick<ReaderCardStyle, "counter" | "layout" | "trait">`, and `DEFAULT_READER_CARD_STYLE.layout === "faces"`. `publicStyle` returns `{ counter, layout, trait }`.

- [ ] **Step 1: Write the failing tests**

In `style.test.ts`, change the default test's expectation to `{ counter: "dial", layout: "faces", trait: "both", signature: null, highlight: null }`, and the public-style test's to `{ counter: "ring", layout: "faces", trait: "both" }`. Then append:

```ts
test("a layout is kept when known and falls back to faces otherwise", () => {
  assert.equal(normalizeReaderCardStyle({ layout: "book" }).layout, "book");
  assert.equal(normalizeReaderCardStyle({ layout: "scroll" }).layout, "faces");
  assert.deepEqual(publicStyle(normalizeReaderCardStyle({ layout: "merged", signature: { bookKey: "k" } })), { counter: "dial", layout: "merged", trait: "both" });
});
```

In `routes.test.ts`, add `layout: "faces"` to every default style it deep-compares (`rg -n 'trait: "both"' backend/src/modules/library/routes.test.ts`). Add `{ layout: "scroll" }` to the payload list of "PATCH reader card style rejects unknown options and unknown fields". Then append:

```ts
test("PATCH reader card style stores a known layout", async () => {
  const { app } = await setup();
  const response = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { layout: "book" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().layout, "book");
  await app.close();
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: the three style tests fail on the missing `layout`.

- [ ] **Step 3: Implement**

In `style.ts`, after `TRAITS`:

```ts
export const LAYOUTS = ["faces", "book", "merged"] as const;
export type Layout = (typeof LAYOUTS)[number];
```

Then make the interface, the public type and the default:

```ts
export interface ReaderCardStyle {
  counter: Counter;
  layout: Layout;
  trait: Trait;
  signature: ChosenSignature | null;
  highlight: ChosenHighlight | null;
}

export type PublicReaderCardStyle = Pick<ReaderCardStyle, "counter" | "layout" | "trait">;

export const DEFAULT_READER_CARD_STYLE: ReaderCardStyle = { counter: "dial", layout: "faces", trait: "both", signature: null, highlight: null };
```

`normalizeReaderCardStyle` gains `layout: oneOf(LAYOUTS, raw.layout, DEFAULT_READER_CARD_STYLE.layout),` after `counter`. `publicStyle` becomes:

```ts
export function publicStyle(style: ReaderCardStyle): PublicReaderCardStyle {
  return { counter: style.counter, layout: style.layout, trait: style.trait };
}
```

In `routes.ts`, import `LAYOUTS` with the other option lists, and add `layout: z.enum(LAYOUTS).optional(),` after `counter` in `readerCardStylePatchSchema`.

- [ ] **Step 4: Run every suite and fix the pinned shapes**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w backend && npm test -w backend`
Expected: shared passes. In the backend, each test that deep-compares a reader card `style` fails only on the missing `layout`. Add `layout: "faces"` to each of those expected objects (`rg -n 'trait: "both"' backend/src`). Keep every other field and every exact comparison as it is. Re-run until green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards/style.ts packages/shared/src/readerCards/style.test.ts backend/src/modules/library backend/src/modules/murals/home.test.ts && git commit -m "Add the reader card's layout option

The public style is now an explicit Pick of the public fields, so a field
added to the style later is private until listed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Text fitting without measurement

**Files:**
- Create: `packages/shared/src/readerCards/fit.ts`
- Test: `packages/shared/src/readerCards/fit.test.ts`

**Interfaces:**
- Produces:

```ts
export type FitFont = "serif" | "sans" | "caps" | "mono";
export interface FitOptions { font: FitFont; size: number; width: number; spacing?: number }
export function textWidth(text: string, options: Omit<FitOptions, "width">): number;
export function fitLine(text: string, options: FitOptions): string;
export function wrapLines(text: string, options: FitOptions & { lines: number }): string[];
```

- [ ] **Step 1: Write the failing tests**

Create `fit.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitLine, textWidth, wrapLines } from "./fit.js";

const body = { font: "serif", size: 11, width: 190 } as const;

test("width is characters times the font's average plus letter spacing", () => {
  assert.equal(textWidth("ABC", { font: "caps", size: 10, spacing: 2 }), 3 * 0.68 * 10 + 2 * 2);
  assert.equal(textWidth("", { font: "mono", size: 7 }), 0);
});

test("a line that fits is returned whole", () => {
  assert.equal(fitLine("A Wizard of Earthsea", body), "A Wizard of Earthsea");
});

test("a line that overflows ends in an ellipsis inside the width", () => {
  const line = fitLine("x".repeat(80), body);
  assert.ok(line.endsWith("…"));
  assert.ok(textWidth(line, body) <= body.width);
});

test("wrapping fills lines word by word and never exceeds the width", () => {
  const lines = wrapLines("No one would have believed in the last years of the nineteenth century that this world was being watched", { ...body, lines: 4 });
  assert.ok(lines.length >= 2 && lines.length <= 4);
  for (const line of lines) assert.ok(textWidth(line, body) <= body.width, line);
});

test("text longer than its lines ends the last line in an ellipsis", () => {
  const lines = wrapLines("word ".repeat(200), { ...body, lines: 4 });
  assert.equal(lines.length, 4);
  assert.ok(lines[3]!.endsWith("…"));
  assert.ok(!lines[2]!.endsWith("…"));
});

test("a sixty-character note fits two lines without an ellipsis", () => {
  const lines = wrapLines("the book I lend to everyone and never get back again, twice", { font: "serif", size: 7.5, width: 190, lines: 2 });
  assert.equal(lines.length, 2);
  assert.ok(!lines.join("").includes("…"));
});

test("one overlong word is cut, and blank text gives no lines", () => {
  const lines = wrapLines("Supercalifragilistic".repeat(10), { ...body, lines: 2 });
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.endsWith("…"));
  assert.deepEqual(wrapLines("   ", { ...body, lines: 2 }), []);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./fit.js` does not exist.

- [ ] **Step 3: Implement**

Create `fit.ts`:

```ts
export type FitFont = "serif" | "sans" | "caps" | "mono";
export interface FitOptions { font: FitFont; size: number; width: number; spacing?: number }

const EM: Record<FitFont, number> = { serif: 0.5, sans: 0.55, caps: 0.68, mono: 0.6 };

export function textWidth(text: string, { font, size, spacing = 0 }: Omit<FitOptions, "width">): number {
  const count = [...text].length;
  return count * EM[font] * size + Math.max(0, count - 1) * spacing;
}

export function fitLine(text: string, options: FitOptions): string {
  const chars = [...text];
  const spacing = options.spacing ?? 0;
  const room = Math.floor((options.width + spacing) / (EM[options.font] * options.size + spacing));
  if (chars.length <= room) return text;
  return `${chars.slice(0, Math.max(0, room - 1)).join("").trimEnd()}…`;
}

export function wrapLines(text: string, { lines, ...options }: FitOptions & { lines: number }): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < words.length && out.length < lines - 1) {
    let line = words[i]!;
    i += 1;
    while (i < words.length && textWidth(`${line} ${words[i]}`, options) <= options.width) {
      line = `${line} ${words[i]}`;
      i += 1;
    }
    out.push(fitLine(line, options));
  }
  if (i < words.length) out.push(fitLine(words.slice(i).join(" "), options));
  return out;
}
```

- [ ] **Step 4: Run the shared tests**

Run: `npm test -w @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards/fit.ts packages/shared/src/readerCards/fit.test.ts && git commit -m "Estimate reader card text widths so long text wraps and ends in an ellipsis

The renderer must work on the server and in react-native-svg, where nothing
can be measured, so widths come from per-font averages.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Render input, page list and turning

**Files:**
- Modify: `packages/shared/src/readerCards/render.ts` (`ReaderCardInput`, new `ReaderCardBase`)
- Create: `packages/shared/src/readerCards/pages.ts`
- Modify: `packages/shared/src/readerCards/index.ts`
- Modify: `packages/shared/src/library/readerCardFacts.ts` (add `readerCardInputOf`)
- Test: `packages/shared/src/readerCards/pages.test.ts`, `packages/shared/src/library/readerCardFacts.test.ts`
- Modify (test inputs only): `packages/shared/src/readerCards/readerCard.test.ts`, `packages/shared/src/readerCards/portable.test.ts`

**Interfaces:**
- Consumes: `PublicReaderCardStyle`, `Layout`, `ReaderCardChosen`, `normalizeReaderCardStyle`, `publicStyle`, `DEFAULT_READER_CARD_STYLE` (Task 1).
- Produces:

```ts
export interface ReaderCardInput { card: PublicReaderCard; style: PublicReaderCardStyle; readerName: string; print: PlatePrint; label: string; unwrittenLine?: string; seed: number; width?: number; view?: ReaderCardView; leaders?: ReaderLeader[]; missing?: string | null }
export type ReaderCardBase = Omit<ReaderCardInput, "print">;
export type ReaderCardPage = "front" | "chosen" | "record" | "merged";
export type ReaderCardStep = ReaderCardPage | [ReaderCardPage, ReaderCardPage];
export type ReaderCardView = "owner" | "visitor";
export function readerCardPages(layout: Layout, view: ReaderCardView, chosen: boolean): ReaderCardStep[];
export function hasChosen(chosen?: ReaderCardChosen): boolean;
export interface TurnState { index: number; rotation: number; faces: [number, number] }
export function startTurn(count: number): TurnState;
export function turnTo(state: TurnState, to: number, direction: 1 | -1): TurnState;
export function turnBy(state: TurnState, by: 1 | -1, count: number): TurnState;
export function readerCardInputOf(books: Record<string, unknown>[], groups: Group[], readerName: string, override?: PublicReaderCard): ReaderCardBase;
```

A missing `view` means `"visitor"` everywhere, so an input that forgets it can never leak owner data.

- [ ] **Step 1: Write the failing tests**

Create `pages.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasChosen, readerCardPages, startTurn, turnBy, turnTo } from "./pages.js";

test("faces turn front, chosen, record, and a visitor with nothing chosen skips the chosen page", () => {
  assert.deepEqual(readerCardPages("faces", "visitor", true), ["front", "chosen", "record"]);
  assert.deepEqual(readerCardPages("faces", "visitor", false), ["front", "record"]);
  assert.deepEqual(readerCardPages("faces", "owner", false), ["front", "chosen", "record"]);
});

test("a book opens onto a spread, and merged has a single back", () => {
  assert.deepEqual(readerCardPages("book", "owner", false), ["front", ["chosen", "record"]]);
  assert.deepEqual(readerCardPages("book", "visitor", true), ["front", ["chosen", "record"]]);
  assert.deepEqual(readerCardPages("book", "visitor", false), ["front", "record"]);
  assert.deepEqual(readerCardPages("merged", "visitor", false), ["front", "merged"]);
});

test("something is chosen when there is a signature or a highlight", () => {
  assert.equal(hasChosen(undefined), false);
  assert.equal(hasChosen({}), false);
  assert.equal(hasChosen({ highlight: { text: "t", title: "b", author: "a" } }), true);
});

test("turning forward wraps and puts the new page on the face that comes round", () => {
  let state = startTurn(3);
  assert.deepEqual(state, { index: 0, rotation: 0, faces: [0, 1] });
  state = turnBy(state, 1, 3);
  assert.deepEqual(state, { index: 1, rotation: 180, faces: [0, 1] });
  state = turnBy(state, 1, 3);
  assert.deepEqual(state, { index: 2, rotation: 360, faces: [2, 1] });
  state = turnBy(state, 1, 3);
  assert.deepEqual(state, { index: 0, rotation: 540, faces: [2, 0] });
});

test("turning back rotates the other way, and turning to the current page does nothing", () => {
  let state = turnBy(startTurn(3), -1, 3);
  assert.deepEqual(state, { index: 2, rotation: -180, faces: [0, 2] });
  assert.equal(turnTo(state, 2, 1), state);
  state = turnTo(state, 0, -1);
  assert.deepEqual(state, { index: 0, rotation: -360, faces: [0, 2] });
});

test("a single page never turns", () => {
  const state = startTurn(1);
  assert.deepEqual(state.faces, [0, 0]);
  assert.equal(turnBy(state, 1, 1), state);
});
```

Append to `library/readerCardFacts.test.ts` (it already has `book` and `NOW`; add `readerCardInputOf` to its import from `./readerCardFacts.js`, and `import type { PublicReaderCard } from "./readerIdentity.js";`):

```ts
test("the owner's input carries leaders and facts beside a public card; a visitor's carries neither leaders nor missing", () => {
  const books = Array.from({ length: 6 }, (_, i) => book(i, { _genres: ["Fantasy"] }));
  const owner = readerCardInputOf(books, [], "andre");
  assert.equal(owner.view, "owner");
  assert.equal(owner.card.identity, "star");
  assert.equal(owner.card.facts?.finished, 6);
  assert.ok(Array.isArray(owner.leaders));
  assert.equal("leaders" in owner.card, false);
  assert.equal("missing" in owner.card, false);
  assert.deepEqual(owner.style, { counter: "dial", layout: "faces", trait: "both" });
  const visitor = readerCardInputOf([], [], "andre", { ...owner.card, style: { counter: "ring", layout: "book", trait: "seal" } });
  assert.equal(visitor.view, "visitor");
  assert.equal(visitor.leaders, undefined);
  assert.equal(visitor.missing, undefined);
  assert.deepEqual(visitor.style, { counter: "ring", layout: "book", trait: "seal" });
  assert.equal(visitor.seed, owner.seed);
});

test("an older or newer server style still draws: missing fields and unknown options fall back", () => {
  const card: PublicReaderCard = { state: "settled", identity: "star", runnerUp: null, signal: null, coverage: [] };
  assert.deepEqual(readerCardInputOf([], [], "x", card).style, { counter: "dial", layout: "faces", trait: "both" });
  assert.equal(readerCardInputOf([], [], "x", { ...card, style: { counter: "dial", layout: "scroll" as never, trait: "both" } }).style.layout, "faces");
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./pages.js` and `readerCardInputOf` do not exist.

- [ ] **Step 3: Implement**

Create `pages.ts`:

```ts
import type { Layout, ReaderCardChosen } from "./style.js";

export type ReaderCardPage = "front" | "chosen" | "record" | "merged";
export type ReaderCardStep = ReaderCardPage | [ReaderCardPage, ReaderCardPage];
export type ReaderCardView = "owner" | "visitor";

export function hasChosen(chosen?: ReaderCardChosen): boolean {
  return Boolean(chosen?.signature || chosen?.highlight);
}

export function readerCardPages(layout: Layout, view: ReaderCardView, chosen: boolean): ReaderCardStep[] {
  if (layout === "merged") return ["front", "merged"];
  if (view === "visitor" && !chosen) return ["front", "record"];
  return layout === "book" ? ["front", ["chosen", "record"]] : ["front", "chosen", "record"];
}

export interface TurnState { index: number; rotation: number; faces: [number, number] }

export function startTurn(count: number): TurnState {
  return { index: 0, rotation: 0, faces: [0, count > 1 ? 1 : 0] };
}

export function turnTo(state: TurnState, to: number, direction: 1 | -1): TurnState {
  if (to === state.index) return state;
  const rotation = state.rotation + direction * 180;
  const showing = (((rotation / 180) % 2) + 2) % 2;
  const faces: [number, number] = [state.faces[0], state.faces[1]];
  faces[showing] = to;
  return { index: to, rotation, faces };
}

export function turnBy(state: TurnState, by: 1 | -1, count: number): TurnState {
  return turnTo(state, (state.index + by + count) % count, by);
}
```

In `render.ts`:
- Add `import type { PublicReaderCard, ReaderLeader } from "../library/readerIdentity.js";`, replacing the existing `PublicReaderCard` type import.
- Add `import type { ReaderCardView } from "./pages.js";`.
- Change the style import to `import type { PublicReaderCardStyle } from "./style.js";`.
- The input becomes:

```ts
export interface ReaderCardInput {
  card: PublicReaderCard;
  style: PublicReaderCardStyle;
  readerName: string;
  print: PlatePrint;
  label: string;
  unwrittenLine?: string;
  seed: number;
  width?: number;
  view?: ReaderCardView;
  leaders?: ReaderLeader[];
  missing?: string | null;
}

export type ReaderCardBase = Omit<ReaderCardInput, "print">;
```

In `library/readerCardFacts.ts`, add the imports below. Then append the function:

```ts
import { readerCardLabel, readerCardPlateLine } from "../readerCards/card.js";
import type { ReaderCardBase } from "../readerCards/render.js";
import { seedOf } from "../readerCards/seed.js";
import { DEFAULT_READER_CARD_STYLE, normalizeReaderCardStyle, publicStyle } from "../readerCards/style.js";

export function readerCardInputOf(books: Book[], groups: Group[], readerName: string, override?: PublicReaderCard): ReaderCardBase {
  const seed = seedOf(readerName);
  if (override) {
    return { card: override, style: publicStyle(normalizeReaderCardStyle(override.style)), view: "visitor", readerName, label: readerCardLabel(override), unwrittenLine: "yet to be written", seed };
  }
  const own = readerIdentity(books, groups);
  const card: PublicReaderCard = { ...publicReaderCard(own), ...readerCardFacts(books, groups, own.identity) };
  return { card, style: publicStyle(DEFAULT_READER_CARD_STYLE), view: "owner", leaders: own.leaders, missing: own.missing, readerName, label: readerCardLabel(card), unwrittenLine: readerCardPlateLine(own.missing), seed };
}
```

In `readerCards/index.ts`, add:

```ts
export { hasChosen, readerCardPages, startTurn, turnBy, turnTo, type ReaderCardPage, type ReaderCardStep, type ReaderCardView, type TurnState } from "./pages.js";
```

In `readerCard.test.ts`, type the `render` helper's `style` parameter as `PublicReaderCardStyle`, and spread `DEFAULT_READER_CARD_STYLE` wherever a test builds `{ counter, trait }`. In `portable.test.ts`, make the style `{ ...DEFAULT_READER_CARD_STYLE, counter, trait }`, importing `DEFAULT_READER_CARD_STYLE` from `./style.js`.

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared && npm run typecheck -w frontend && npm run typecheck -w mobile`
Expected: PASS. Web and mobile pass `DEFAULT_READER_CARD_STYLE` (a full style) to `renderReaderCard`, which still satisfies `PublicReaderCardStyle`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src && git commit -m "Describe which reader card pages a reader sees and how the card turns

Both clients build their render input with one shared function, so the
owner's leaders and missing line travel beside the public card instead of
inside it, and a visitor's input never carries them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The page frame and the record page

**Files:**
- Modify: `packages/shared/src/readerCards/compose.ts` (shared frame helpers, `composePage`, `MONO`)
- Modify: `packages/shared/src/readerCards/plates.ts` (`PLATE_FONTS` gains `mono`)
- Create: `packages/shared/src/readerCards/svgText.ts`
- Modify: `packages/shared/src/readerCards/render.ts` (import `escape`; record dispatch)
- Modify: `packages/shared/src/readerCards/pages.ts` (rows, legends, `recordBody`)
- Test: `packages/shared/src/readerCards/recordPage.test.ts`

**Interfaces:**
- Consumes: `fitLine`, `textWidth`, `wrapLines` (Task 2), `ReaderCardInput` (Task 3).
- Produces:

```ts
export const MONO: string;
export function composePage(face: PlateFace, body: string, slots?: PlateSlots): string;
export const escape: (s: string) => string;
export const escapeText: (s: string) => string;
export function svgText(x: number, y: number, content: string, options: TextOptions): string;
export function rule(y: number, width?: number, extra?: string): string;
export const GROUP_LABELS: Record<DialGroup, string>;
export function recordRows(input: ReaderCardInput, compact: boolean): Row[];
export function rowsSvg(rows: Row[], top: number, bottom: number, size: number): string;
export function coverageLines(coverage: string[]): string;
export function recordBody(input: ReaderCardInput): string;
export function renderReaderCard(input: ReaderCardInput, page?: "front" | "record"): string;
```

- [ ] **Step 1: Write the failing tests**

Create `recordPage.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { renderReaderCard, type ReaderCardInput } from "./render.js";
import { seedOf } from "./seed.js";

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp",
  signal: { counted: 22, of: 44, label: "22 of 44 finished books with known genres are fantasy or science fiction" },
  coverage: ["genres known for 44 of 48 finished books"],
  dial: { segments: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 8, marked: 1 }, { group: "unknown", books: 4, marked: 0 }] },
  facts: { finished: 34, highlights: 40, series: 2, since: 2014, edition: 2026 },
};
const input = (fields: Partial<ReaderCardInput> = {}): ReaderCardInput => ({ card, style: { counter: "dial", layout: "faces", trait: "both" }, readerName: "andre", print: "paper", label: "Reader card", seed: seedOf("andre"), view: "visitor", ...fields });
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]!);

test("the record lists finished, each genre segment with the lead's share, highlights and the runner-up", () => {
  const svg = renderReaderCard(input(), "record");
  const all = texts(svg);
  for (const expected of ["READER’S RECORD", "THE STARGAZER · PLATE IV", "Finished", "34", "Fantasy & SF", "22 · 65%", "Mystery & crime", "8", "Genre unknown", "4", "With highlights", "10", "Runner-up", "Lamplighter", "the dial: one mark per finished book;", "genres known for 44 of 48 finished books"]) {
    assert.ok(all.includes(expected), expected);
  }
  assert.match(svg, /Courier Prime/);
});

test("the legend follows the counter", () => {
  assert.ok(texts(renderReaderCard(input({ style: { counter: "ring", layout: "faces", trait: "both" } }), "record")).includes("the ring: one arc per genre,"));
});

test("only the owner sees the leaders and, when leaning, the missing line", () => {
  const leaning: PublicReaderCard = { ...card, state: "leaning" };
  const owner = { card: leaning, view: "owner" as const, leaders: [{ label: "Earthsea", count: 4 }], missing: "Close between the Stargazer and the Lamplighter" };
  const mine = texts(renderReaderCard(input(owner), "record"));
  assert.ok(mine.includes("◇ Earthsea"));
  assert.ok(mine.some((line) => line.startsWith("◇ Close between")));
  const theirs = renderReaderCard(input({ ...owner, view: "visitor" }), "record");
  assert.doesNotMatch(theirs, /Earthsea|Close between/);
  assert.doesNotMatch(renderReaderCard(input({ ...owner, view: undefined }), "record"), /Earthsea|Close between/);
});

test("an older card without dial, facts or streak draws a record with no counter legend and nothing undefined", () => {
  const svg = renderReaderCard(input({ card: { state: "settled", identity: "star", runnerUp: null, signal: null, coverage: [] } }), "record");
  assert.ok(texts(svg).includes("READER’S RECORD"));
  assert.doesNotMatch(svg, /undefined|NaN|the dial/);
});

test("row text is escaped and cut to its width", () => {
  const svg = renderReaderCard(input({ view: "owner", leaders: [{ label: "<b>Fire & Blood</b>", count: 2 }, { label: "A".repeat(80), count: 1 }] }), "record");
  assert.match(svg, /&lt;b&gt;Fire &amp; Blood/);
  assert.doesNotMatch(svg, /<b>/);
  assert.ok(texts(svg).some((line) => line.startsWith("◇ AAAA") && line.endsWith("…")));
});

test("the front is unchanged when no page is named", () => {
  assert.equal(renderReaderCard(input()), renderReaderCard(input(), "front"));
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL. There is no record page, so the front is drawn and the record texts are missing.

- [ ] **Step 3: Implement the frame**

In `compose.ts`:
- Add `export const MONO = "'Courier Prime', 'Courier New', Courier, monospace";` after `SANS`.
- Extract the parts `composePlate` shares with a back page.
- Keep the strings and their order exactly as they are, so the masters still match.

```ts
const openSvg = (face: PlateFace) => `<svg xmlns="http://www.w3.org/2000/svg" class="plate id-${face.key}" viewBox="0 0 250 350" width="${face.width}" height="${+(face.width * 1.4).toFixed(2)}" role="img" aria-label="${face.label}">`;
const GROUND = `<rect class="pg" width="250" height="350" rx="4"/>`;
const FRAME = [`<rect class="pl" x="10" y="10" width="230" height="330" stroke-width="1.6"/>`, `<rect class="pl" x="16" y="16" width="218" height="318" stroke-width=".6"/>`];
const corners = (slots: PlateSlots) => slots.corners ?? `<path class="pf" d="${DIAMONDS}"/>`;
const footer = (face: PlateFace, slots: PlateSlots) => [
  `<path class="pl" d="M30 305H220" stroke-width=".5"/>`,
  slots.footerLeft ?? `<text class="pt" x="30" y="321" font-size="7.5" letter-spacing="1.8" font-family="${SANS}" font-weight="600">PLATE ${face.numeral}</text>`,
  slots.footerRight ?? `<text class="pt" x="220" y="321" text-anchor="end" font-size="7.5" letter-spacing="1.8" font-family="${SANS}" font-weight="600">${face.reader}</text>`,
];
const join = (parts: Array<string | undefined>) => parts.filter((line): line is string => Boolean(line)).join("\n");
```

`composePlate` becomes:

```ts
export function composePlate(face: PlateFace, slots: PlateSlots = {}): string {
  return join([
    openSvg(face),
    GROUND,
    slots.underlay,
    ...FRAME,
    slots.frameBand,
    corners(slots),
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
    ...footer(face, slots),
    slots.overlay,
    `</svg>`,
  ]);
}

export function composePage(face: PlateFace, body: string, slots: PlateSlots = {}): string {
  return join([openSvg(face), GROUND, slots.underlay, ...FRAME, corners(slots), body, ...footer(face, slots), slots.overlay, `</svg>`]);
}
```

Before relying on this, compare it line by line with today's `composePlate` and keep any byte that differs. `plates.test.ts` "the port reproduces every committed master byte for byte" is the proof.

In `plates.ts`, import `MONO` with `SANS`/`SERIF`, and make `export const PLATE_FONTS = { serif: SERIF, sans: SANS, mono: MONO };`.

Create `svgText.ts`:

```ts
import { MONO, SANS, SERIF } from "./compose.js";

export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type TextFont = "serif" | "sans" | "mono";
export interface TextOptions { size: number; font?: TextFont; anchor?: "start" | "middle" | "end"; spacing?: number; weight?: number; italic?: boolean; opacity?: number; cls?: "pt" | "pg" }

const FAMILIES: Record<TextFont, string> = { serif: SERIF, sans: SANS, mono: MONO };
const n2 = (value: number) => +value.toFixed(2);

export function svgText(x: number, y: number, content: string, { size, font = "sans", anchor = "middle", spacing, weight, italic, opacity, cls = "pt" }: TextOptions): string {
  return `<text class="${cls}" x="${n2(x)}" y="${n2(y)}" text-anchor="${anchor}" font-size="${n2(size)}"${spacing ? ` letter-spacing="${spacing}"` : ""} font-family="${FAMILIES[font]}"${weight ? ` font-weight="${weight}"` : ""}${italic ? ` font-style="italic"` : ""}${opacity !== undefined ? ` opacity="${opacity}"` : ""}>${escapeText(content)}</text>`;
}

export function rule(y: number, width = 0.5, extra = ""): string {
  return `<path class="pl" d="M30 ${n2(y)}H220" stroke-width="${width}"${extra}/>`;
}
```

In `render.ts`:
- Delete the local `escape` const, and add `import { escape } from "./svgText.js";`.
- Import `composePage` with `composePlate`.
- Add `import { recordBody } from "./pages.js";`.

`renderReaderCard` gains the page argument:

```ts
export function renderReaderCard(input: ReaderCardInput, page: "front" | "record" = "front"): string {
  const { card, style, print, seed } = input;
  const { face, ink } = faceOf({ ...input, identity: card.identity, state: card.state });
  if (page === "record") return withStyle(composePage({ ...face, label: `${face.label}, reader’s record` }, recordBody(input)), inks(ink, print));
```

The rest of the function is unchanged.

- [ ] **Step 4: Implement the record page**

Append to `pages.ts`, adding these imports at the top:

```ts
import type { DialGroup } from "../library/readerCardFacts.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import type { Counter } from "./counters.js";
import { fitLine, textWidth, wrapLines } from "./fit.js";
import { PLATES, type IdentityKey } from "./plates.js";
import type { ReaderCardInput } from "./render.js";
import { rule, svgText } from "./svgText.js";
```

```ts
const OWN = "◇";

export const GROUP_LABELS: Record<DialGroup, string> = { lamp: "Mystery & crime", star: "Fantasy & SF", arch: "History & memoir", corr: "Classics & literary", other: "Other genres", unknown: "Genre unknown" };

const LEGENDS: Record<Counter, [string, string]> = {
  dial: ["the dial: one mark per finished book;", "long marks carry highlights"],
  beads: ["the beads: one per finished book;", "filled beads carry highlights"],
  shelf: ["the shelf: one spine per finished book;", "banded spines carry highlights"],
  frame: ["the frame: one tick per finished book;", "long ticks carry highlights"],
  ring: ["the ring: one arc per genre,", "sized by its share of the books"],
};

const nameOf = (key: IdentityKey) => PLATES.find((plate) => plate.key === key)!.name;

export interface Row { label: string; value: string; own: boolean }

export function recordRows(input: ReaderCardInput, compact: boolean): Row[] {
  const { card } = input;
  const segments = card.dial?.segments ?? [];
  const finished = card.facts?.finished ?? segments.reduce((sum, segment) => sum + segment.books, 0);
  const rows: Row[] = [];
  if (card.facts || segments.length) rows.push({ label: "Finished", value: String(finished), own: false });
  for (const segment of compact ? segments.slice(0, 1) : segments) {
    const share = segment.group === card.identity && finished > 0 ? ` · ${Math.round((segment.books / finished) * 100)}%` : "";
    rows.push({ label: GROUP_LABELS[segment.group], value: `${segment.books}${share}`, own: false });
  }
  if (segments.length) rows.push({ label: "With highlights", value: String(segments.reduce((sum, segment) => sum + segment.marked, 0)), own: false });
  const second = card.state === "unwritten" ? null : card.streak ?? card.runnerUp;
  if (second) rows.push({ label: "Runner-up", value: nameOf(second), own: false });
  if (input.view === "owner") for (const leader of input.leaders ?? []) rows.push({ label: `${OWN} ${leader.label}`, value: String(leader.count), own: true });
  return rows;
}

export function rowsSvg(rows: Row[], top: number, bottom: number, size: number): string {
  const pitch = rows.length > 1 ? Math.min(16, (bottom - top) / (rows.length - 1)) : 0;
  return rows.map((row, i) => {
    const y = top + i * pitch;
    const opacity = row.own ? 0.7 : undefined;
    const value = fitLine(row.value, { font: "mono", size, width: 70 });
    const label = fitLine(row.label, { font: "mono", size, width: 182 - textWidth(value, { font: "mono", size }) });
    return svgText(30, y, label, { size, font: "mono", anchor: "start", opacity })
      + svgText(220, y, value, { size, font: "mono", anchor: "end", opacity })
      + rule(y + 4, 0.4, ` stroke-dasharray=".6 1.8" opacity=".6"`);
  }).join("");
}

export function coverageLines(coverage: string[]): string {
  if (!coverage.length) return "";
  const lines = wrapLines(coverage.join("; "), { font: "serif", size: 6, width: 190, lines: 2 });
  return lines.map((line, i) => svgText(125, 298 - (lines.length - 1 - i) * 8, line, { size: 6, font: "serif", italic: true, opacity: 0.75 })).join("");
}

function subtitle(card: PublicReaderCard): string {
  if (card.state === "unwritten" || !card.identity) return "UNWRITTEN";
  const plate = PLATES.find((item) => item.key === card.identity)!;
  return `${card.state === "leaning" ? "LEANING TOWARD" : "THE"} ${plate.name.toUpperCase()} · PLATE ${plate.numeral}`;
}

export function recordBody(input: ReaderCardInput): string {
  const { card } = input;
  let out = svgText(125, 40, "READER’S RECORD", { size: 8.5, spacing: 3.2, weight: 600 })
    + svgText(125, 52, fitLine(subtitle(card), { font: "caps", size: 5.8, width: 190, spacing: 1.6 }), { size: 5.8, spacing: 1.6, weight: 600, opacity: 0.8 })
    + rule(59, 0.9) + rule(61.5, 0.4);
  let top = 80;
  if (card.signal) {
    const lines = wrapLines(card.signal.label, { font: "serif", size: 6.6, width: 190, lines: 2 });
    out += lines.map((line, i) => svgText(125, 73 + i * 8, line, { size: 6.6, font: "serif", italic: true })).join("");
    top = 73 + lines.length * 8 + 10;
  }
  const missing = input.view === "owner" && card.state === "leaning" && input.missing ? wrapLines(`${OWN} ${input.missing}`, { font: "serif", size: 6.4, width: 190, lines: 2 }) : [];
  const bottom = 250 - (missing.length ? missing.length * 8 + 6 : 0);
  out += rowsSvg(recordRows(input, false), top, bottom, 7.2);
  out += missing.map((line, i) => svgText(30, bottom + 12 + i * 8, line, { size: 6.4, font: "serif", italic: true, anchor: "start", opacity: 0.7 })).join("");
  if (card.dial?.segments.length) out += LEGENDS[input.style.counter].map((line, i) => svgText(125, 268 + i * 9, line, { size: 6.2, font: "serif", italic: true })).join("");
  return out + coverageLines(card.coverage);
}
```

- [ ] **Step 5: Run the shared tests**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS, including `plates.test.ts` (the masters) and `readerCard.test.ts` (the front).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Draw the reader card's record page

The record carries what the old detail sheet listed: the evidence, the
coverage and, for the owner only, the leaders and the missing line.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The chosen page

**Files:**
- Modify: `packages/shared/src/readerCards/pages.ts` (`cover`, blocks, `chosenBody`)
- Modify: `packages/shared/src/readerCards/render.ts` (chosen dispatch)
- Test: `packages/shared/src/readerCards/chosenPage.test.ts`

**Interfaces:**
- Consumes: `svgText`, `rule`, `wrapLines`, `fitLine` (Tasks 2 and 4), and `ReaderCardChosen` (A2).
- Produces: `COVER_URL: RegExp`, `cover(signature, x, y, w, h): string`, `chosenBody(input): string`, and `renderReaderCard(input, page?: "front" | "record" | "chosen")`.

- [ ] **Step 1: Write the failing tests**

Create `chosenPage.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { renderReaderCard, type ReaderCardInput } from "./render.js";
import { seedOf } from "./seed.js";
import type { ReaderCardChosen } from "./style.js";

const signature = { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: "https://covers.example.org/earthsea.jpg", note: "the one I lend to everyone" };
const highlight = { text: "To light a candle is to cast a shadow.", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" };
const card = (chosen: ReaderCardChosen): PublicReaderCard => ({ state: "settled", identity: "star", runnerUp: null, signal: null, coverage: [], chosen });
const page = (chosen: ReaderCardChosen, view: "owner" | "visitor" = "visitor") => renderReaderCard({ card: card(chosen), style: { counter: "dial", layout: "faces", trait: "both" }, readerName: "andre", print: "paper", label: "Reader card", seed: seedOf("andre"), view } as ReaderCardInput, "chosen");
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]!);

test("with both chosen, the page shows the book, its note, a divider and the highlight", () => {
  const svg = page({ signature, highlight });
  const all = texts(svg);
  for (const expected of ["SIGNATURE BOOK", "A Wizard of Earthsea", "URSULA K. LE GUIN", "“the one I lend to everyone”", "URSULA K. LE GUIN · A WIZARD OF EARTHSEA"]) assert.ok(all.includes(expected), expected);
  assert.ok(all.some((line) => line.startsWith("“To light a candle")));
  assert.equal(svg.match(/<image /g)?.length, 1);
  assert.match(svg, /href="https:\/\/covers\.example\.org\/earthsea\.jpg"/);
});

test("only a plain https cover becomes an image", () => {
  for (const coverUrl of ["http://covers.example.org/a.jpg", "javascript:alert(1)", "https://x.example/a\"onload=\"b", "https://x.example/a?b=1&c=2", null]) {
    const svg = page({ signature: { ...signature, coverUrl } });
    assert.doesNotMatch(svg, /<image/, String(coverUrl));
    assert.ok(texts(svg).includes("A WIZARD OF"), String(coverUrl));
  }
});

test("text is escaped once, and quotes stay as typed", () => {
  const svg = page({ highlight: { ...highlight, text: "He said \"<b>A & B</b>\"" } });
  assert.match(svg, /He said "&lt;b&gt;A &amp; B&lt;\/b&gt;"/);
  assert.doesNotMatch(svg, /<b>|&quot;/);
});

test("a long highlight stops at four lines, and a long title at two", () => {
  const long = page({ signature: { ...signature, title: "The Hitchhiker’s Guide to the Galaxy, The Restaurant at the End of the Universe, Life, the Universe and Everything" }, highlight: { ...highlight, text: "word ".repeat(80) } });
  const all = texts(long);
  const quote = all.findIndex((line) => line.startsWith("“word"));
  assert.ok(all[quote + 3]!.endsWith("…"));
  assert.ok(!all[quote + 4]!.startsWith("word"));
  assert.ok(!all.some((line) => line.includes("Everything")));
});

test("one choice takes the whole page", () => {
  const book = texts(page({ signature }));
  assert.ok(book.includes("SIGNATURE BOOK"));
  assert.ok(!book.some((line) => line.startsWith("“To light")));
  const quote = texts(page({ highlight }));
  assert.ok(!quote.includes("SIGNATURE BOOK"));
  assert.ok(quote.some((line) => line.startsWith("“To light")));
});

test("with nothing chosen the owner sees an invitation and a visitor sees an empty page", () => {
  assert.ok(texts(page({}, "owner")).includes("Pick a signature book and a"));
  assert.ok(!texts(page({}, "visitor")).includes("Pick a signature book and a"));
});

test("an annotation smuggled into the highlight is never drawn", () => {
  assert.doesNotMatch(page({ highlight: { ...highlight, annotation: "SECRET-NOTE" } as never }), /SECRET-NOTE/);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL. `"chosen"` is not a page yet, so the front is drawn.

- [ ] **Step 3: Implement**

Append to `pages.ts`, importing `type ReaderCardChosen` from `./style.js`:

```ts
export const COVER_URL = /^https:\/\/[^\s"'<>&]+$/;

type Signature = NonNullable<ReaderCardChosen["signature"]>;
type Highlight = NonNullable<ReaderCardChosen["highlight"]>;

export function cover(signature: Signature, x: number, y: number, w: number, h: number): string {
  const frame = `<rect class="pl" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" stroke-width=".4"/>`;
  if (signature.coverUrl && COVER_URL.test(signature.coverUrl)) {
    return `<image href="${signature.coverUrl}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>${frame}`;
  }
  const s = w / 52;
  const title = wrapLines(signature.title.toUpperCase(), { font: "caps", size: 4.6 * s, width: w - 8, lines: 4 });
  const author = fitLine((signature.author.trim().split(/\s+/).pop() ?? "").toUpperCase(), { font: "caps", size: 3.6 * s, width: w - 8 });
  return `<rect class="pf" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2"/><rect class="pgs" x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" stroke-width=".4" opacity=".6"/>`
    + title.map((line, i) => svgText(x + w / 2, y + 20 * s + i * 6.5 * s, line, { size: 4.6 * s, weight: 700, cls: "pg" })).join("")
    + svgText(x + w / 2, y + h - 8 * s, author, { size: 3.6 * s, cls: "pg" });
}

function signatureBlock(signature: Signature, top: number, big: boolean): { svg: string; bottom: number } {
  const [w, h] = big ? [76, 112] : [52, 77];
  let svg = svgText(125, top, "SIGNATURE BOOK", { size: 6.5, spacing: 2.6, weight: 600 }) + cover(signature, 125 - w / 2, top + 10, w, h);
  let y = top + 10 + h + 16;
  const title = wrapLines(signature.title, { font: "serif", size: 12, width: 190, lines: 2 });
  svg += title.map((line, i) => svgText(125, y + i * 14, line, { size: 12, font: "serif" })).join("");
  y += (title.length - 1) * 14 + 12;
  svg += svgText(125, y, fitLine(signature.author.toUpperCase(), { font: "caps", size: 5.8, width: 190, spacing: 1.4 }), { size: 5.8, spacing: 1.4, weight: 600 });
  if (signature.note) {
    const note = wrapLines(`“${signature.note}”`, { font: "serif", size: 7.5, width: 190, lines: 2 });
    svg += note.map((line, i) => svgText(125, y + 13 + i * 10, line, { size: 7.5, font: "serif", italic: true })).join("");
    y += 13 + (note.length - 1) * 10;
  }
  return { svg, bottom: y };
}

function highlightBlock(highlight: Highlight, top: number, size: number): string {
  const lines = wrapLines(`“${highlight.text}”`, { font: "serif", size, width: 190, lines: 4 });
  const attribution = top + (lines.length - 1) * (size + 4) + 14;
  return lines.map((line, i) => svgText(125, top + i * (size + 4), line, { size, font: "serif", italic: true })).join("")
    + svgText(125, attribution, fitLine(`${highlight.author} · ${highlight.title}`.toUpperCase(), { font: "caps", size: 5.2, width: 190, spacing: 1.2 }), { size: 5.2, spacing: 1.2, weight: 600, opacity: 0.85 });
}

const divider = (y: number) => `<path class="pl" d="M82 ${y}H117M133 ${y}H168" stroke-width=".8"/><circle class="pf" cx="125" cy="${y}" r="2"/>`;

const INVITATION = ["Pick a signature book and a", "highlight, and they show here", "for everyone who opens", "your card."];

export function chosenBody(input: ReaderCardInput): string {
  const { signature, highlight } = input.card.chosen ?? {};
  if (signature && highlight) {
    const book = signatureBlock(signature, 38, false);
    const y = book.bottom + 12;
    return book.svg + divider(y) + highlightBlock(highlight, y + 26, 11);
  }
  if (signature) return signatureBlock(signature, 52, true).svg;
  if (highlight) return svgText(125, 120, "“", { size: 40, font: "serif", opacity: 0.3 }) + highlightBlock(highlight, 150, 13);
  if (input.view !== "owner") return "";
  return svgText(125, 40, "CHOSEN BY THE READER", { size: 6.5, spacing: 2.6, weight: 600 })
    + INVITATION.map((line, i) => svgText(125, 150 + i * 15, line, { size: 11, font: "serif", italic: true })).join("");
}
```

In `render.ts`, import `chosenBody`, widen the page type to `"front" | "record" | "chosen"`, and add after the record line:

```ts
  if (page === "chosen") return withStyle(composePage({ ...face, label: `${face.label}, chosen by the reader` }, chosenBody(input)), inks(ink, print));
```

- [ ] **Step 4: Run the shared tests**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Draw the reader card's chosen page

Only a plain https cover is drawn as an image; anything else gets a
typographic cover, so a stored cover URL can never become markup.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The merged page

**Files:**
- Modify: `packages/shared/src/readerCards/pages.ts` (`mergedBody`)
- Modify: `packages/shared/src/readerCards/render.ts` (merged dispatch, full page type)
- Test: `packages/shared/src/readerCards/mergedPage.test.ts`

**Interfaces:**
- Consumes: `cover`, `recordRows`, `rowsSvg`, `coverageLines` (Tasks 4 and 5).
- Produces: `mergedBody(input): string`, and `renderReaderCard(input: ReaderCardInput, page?: ReaderCardPage): string`.

- [ ] **Step 1: Write the failing tests**

Create `mergedPage.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { renderReaderCard, type ReaderCardInput } from "./render.js";
import { seedOf } from "./seed.js";

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: ["genres known for 34 of 34 finished books"],
  dial: { segments: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 12, marked: 1 }] },
  facts: { finished: 34, highlights: 40, series: 2, since: 2014, edition: 2026 },
  chosen: { signature: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: null }, highlight: { text: "To light a candle is to cast a shadow.", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" } },
};
const merged = (fields: Partial<ReaderCardInput> = {}) => renderReaderCard({ card, style: { counter: "dial", layout: "merged", trait: "both" }, readerName: "andre", print: "paper", label: "Reader card", seed: seedOf("andre"), view: "visitor", ...fields }, "merged");
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]!);

test("the merged back has the chosen book and highlight above compact rows with only the lead genre", () => {
  const all = texts(merged());
  for (const expected of ["SIGNATURE BOOK", "Finished", "34", "Fantasy & SF", "22 · 65%", "With highlights", "10", "Runner-up", "Lamplighter", "genres known for 34 of 34 finished books"]) assert.ok(all.includes(expected), expected);
  assert.ok(all.some((line) => line.startsWith("“To light")));
  assert.ok(!all.includes("Mystery & crime"));
});

test("only the owner's merged back shows the leaders", () => {
  const owner = { view: "owner" as const, leaders: [{ label: "Earthsea", count: 4 }] };
  assert.ok(texts(merged(owner)).includes("◇ Earthsea"));
  assert.doesNotMatch(merged({ ...owner, view: "visitor" }), /Earthsea/);
});

test("with nothing chosen a visitor's merged back starts with the record header", () => {
  const all = texts(merged({ card: { ...card, chosen: {} } }));
  assert.ok(all.includes("READER’S RECORD"));
  assert.ok(!all.includes("SIGNATURE BOOK"));
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `pages.ts`:

```ts
export function mergedBody(input: ReaderCardInput): string {
  const { signature, highlight } = input.card.chosen ?? {};
  let out = "";
  let y: number;
  if (signature || highlight) {
    let top = 30;
    if (signature) {
      out += cover(signature, 30, 30, 40, 59) + svgText(80, 44, "SIGNATURE BOOK", { size: 5.4, spacing: 2, weight: 600, anchor: "start" });
      const title = wrapLines(signature.title, { font: "serif", size: 11, width: 140, lines: 2 });
      out += title.map((line, i) => svgText(80, 60 + i * 13, line, { size: 11, font: "serif", anchor: "start" })).join("");
      out += svgText(80, 60 + title.length * 13, fitLine(signature.author.toUpperCase(), { font: "caps", size: 5.4, width: 140, spacing: 1.3 }), { size: 5.4, spacing: 1.3, weight: 600, anchor: "start" });
      top = 104;
    }
    if (highlight) {
      const lines = wrapLines(`“${highlight.text}”`, { font: "serif", size: 9, width: 190, lines: 2 });
      out += lines.map((line, i) => svgText(125, top + 8 + i * 13, line, { size: 9, font: "serif", italic: true })).join("");
      const at = top + 8 + lines.length * 13 + 2;
      out += svgText(125, at, fitLine(`${highlight.author} · ${highlight.title}`.toUpperCase(), { font: "caps", size: 5, width: 190, spacing: 1.2 }), { size: 5, spacing: 1.2, weight: 600, opacity: 0.85 });
      top = at + 4;
    }
    y = top + 10;
  } else if (input.view === "owner") {
    out += ["Pick a signature book and a highlight,", "and they show here for everyone."].map((line, i) => svgText(125, 44 + i * 12, line, { size: 9, font: "serif", italic: true })).join("");
    y = 70;
  } else {
    out += svgText(125, 40, "READER’S RECORD", { size: 8.5, spacing: 3.2, weight: 600 });
    y = 52;
  }
  return out + rule(y, 0.9) + rule(y + 2.5, 0.4) + rowsSvg(recordRows(input, true), y + 18, 284, 7) + coverageLines(input.card.coverage);
}
```

In `render.ts`:
- Import `mergedBody` and `type ReaderCardPage` from `./pages.js`.
- Type the page parameter `page: ReaderCardPage = "front"`.
- Add:

```ts
  if (page === "merged") return withStyle(composePage({ ...face, label: `${face.label}, back` }, mergedBody(input)), inks(ink, print));
```

- [ ] **Step 4: Run the shared tests**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Draw the reader card's merged back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Summary, privacy and portability for every page, and a pages sheet

**Files:**
- Modify: `packages/shared/src/readerCards/pages.ts` (`readerCardSummary`)
- Modify: `packages/shared/src/readerCards/index.ts` (export `readerCardSummary`)
- Test: `packages/shared/src/readerCards/summary.test.ts`
- Modify: `packages/shared/src/readerCards/portable.test.ts` (guard rules and a back-page matrix)
- Modify: `packages/shared/scripts/contact-sheet.ts` (writes `pages.html`)

**Interfaces:**
- Produces: `readerCardSummary(input: ReaderCardBase): string[]`.

- [ ] **Step 1: Write the failing tests**

Create `summary.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { readerCardSummary } from "./pages.js";
import type { ReaderCardBase } from "./render.js";
import { seedOf } from "./seed.js";

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp",
  signal: { counted: 22, of: 34, label: "22 of 34 finished books with known genres are fantasy or science fiction" },
  coverage: ["genres known for 34 of 34 finished books"],
  dial: { segments: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 12, marked: 1 }] },
  facts: { finished: 34, highlights: 40, series: 2, since: 2014, edition: 2026 },
  chosen: { signature: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: "lent twice" }, highlight: { text: "To light a candle", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" } },
};
const base = (fields: Partial<ReaderCardBase> = {}): ReaderCardBase => ({ card, style: { counter: "dial", layout: "faces", trait: "both" }, readerName: "andre", label: "Reader card", seed: seedOf("andre"), view: "visitor", ...fields });

test("the summary reads the card in order: plate, streak, evidence, choices, coverage", () => {
  assert.deepEqual(readerCardSummary(base()), [
    "The Stargazer, plate IV: lives half in other worlds.",
    "With a streak of the Lamplighter.",
    "22 of 34 finished books with known genres are fantasy or science fiction.",
    "34 finished books: 22 fantasy & sf, 12 mystery & crime. 10 with highlights.",
    "Signature book: A Wizard of Earthsea by Ursula K. Le Guin, “lent twice”.",
    "Highlight: “To light a candle”, Ursula K. Le Guin, A Wizard of Earthsea.",
    "genres known for 34 of 34 finished books",
  ]);
});

test("only the owner's summary names the leaders and the missing line", () => {
  const owner = { card: { ...card, state: "leaning" as const }, leaders: [{ label: "Earthsea", count: 4 }], missing: "Close between the Stargazer and the Lamplighter" };
  const mine = readerCardSummary(base({ ...owner, view: "owner" }));
  assert.ok(mine.includes("Only you see: Earthsea (4)."));
  assert.ok(mine.includes("Only you see: Close between the Stargazer and the Lamplighter."));
  assert.doesNotMatch(readerCardSummary(base({ ...owner, view: "visitor" })).join(" "), /Earthsea \(4\)|Close between/);
});

test("an unwritten card says so", () => {
  assert.equal(readerCardSummary(base({ card: { state: "unwritten", identity: null, runnerUp: null, signal: null, coverage: [] } }))[0], "An unwritten reader card.");
});
```

In `portable.test.ts`:
- Allow `<image href>` only for a plain https URL, and at most one per page.
- Reject `id` and `url(#`.
- Add a back-page test.

Replace the `href` line in `portabilityProblems` with:

```ts
      if ((attr === "href" || attr === "xlink:href") && !value!.startsWith("data:") && !(name === "image" && /^https:\/\/[^\s"'<>&]+$/.test(value!))) problems.push(`${attr}="${value!.slice(0, 40)}"`);
      if (attr === "id") problems.push(`id="${value}"`);
```

After the element loop, add:

```ts
  if ((svg.match(/<image href="https:/g) ?? []).length > 1) problems.push("more than one remote image");
  if (/url\(#/.test(svg)) problems.push("url(#…)");
```

Then append, adding `import type { ReaderCardChosen } from "./style.js";` and `import type { ReaderCardPage } from "./pages.js";`:

```ts
const chosenSets: Record<string, ReaderCardChosen> = {
  none: {},
  book: { signature: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: "https://covers.example.org/earthsea.jpg", note: "lent twice" } },
  quote: { highlight: { text: "To light a candle is to cast a shadow.", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" } },
  both: { signature: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: null }, highlight: { text: "word ".repeat(90), title: "T", author: "A" } },
};

test("every back page, view, choice and print stays inside the subset, and a visitor's never shows owner data", () => {
  const secrets = { leaders: [{ label: "SECRET-LEADER", count: 3 }], missing: "SECRET-MISSING" };
  for (const [index, identity] of identities.entries()) for (const state of identity ? (["settled", "leaning"] as const) : (["unwritten"] as const)) {
    for (const [size, segments] of Object.entries({ empty: dials.empty!, large: dials.large! })) for (const [set, chosen] of Object.entries(chosenSets)) {
      const smuggled: ReaderCardChosen = chosen.highlight ? { ...chosen, highlight: { ...chosen.highlight, annotation: "SECRET-NOTE" } as never } : chosen;
      const card: PublicReaderCard = { state, identity, runnerUp: null, streak: PLATES[(index + 1) % PLATES.length]!.key, signal: null, coverage: ["c"], dial: { segments }, facts: { finished: 0, highlights: 0, series: 0, since: null, edition: 2026 }, chosen: smuggled };
      for (const page of ["chosen", "record", "merged"] as ReaderCardPage[]) for (const view of ["owner", "visitor"] as const) for (const print of ["paper", "reversed"] as const) {
        const svg = renderReaderCard({ card, style: { ...DEFAULT_READER_CARD_STYLE, layout: "faces" }, readerName: "andre", print, label: "x", seed: seedOf("andre"), view, ...secrets }, page);
        const where = `${identity}/${state}/${size}/${set}/${page}/${view}/${print}`;
        assert.deepEqual(portabilityProblems(svg), [], where);
        assert.doesNotMatch(svg, /SECRET-NOTE/, where);
        if (view === "visitor") assert.doesNotMatch(svg, /SECRET-LEADER|SECRET-MISSING/, where);
      }
    }
  }
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: `summary.test.ts` fails, because `readerCardSummary` does not exist. The portable test should already pass. If it fails, fix the page code, not the guard.

- [ ] **Step 3: Implement the summary**

Append to `pages.ts`, importing `type ReaderCardBase` from `./render.js`:

```ts
export function readerCardSummary(input: ReaderCardBase): string[] {
  const { card } = input;
  const plate = card.identity && card.state !== "unwritten" ? PLATES.find((item) => item.key === card.identity) : undefined;
  const lines = [plate ? `${card.state === "leaning" ? "Leaning toward the" : "The"} ${plate.name}, plate ${plate.numeral}: ${plate.epithet}.` : "An unwritten reader card."];
  const second = card.state === "unwritten" ? null : card.streak ?? null;
  if (second) lines.push(`With a streak of the ${nameOf(second)}.`);
  if (card.signal) lines.push(`${card.signal.label}.`);
  const segments = card.dial?.segments ?? [];
  if (card.facts) {
    const groups = segments.map((segment) => `${segment.books} ${GROUP_LABELS[segment.group].toLowerCase()}`).join(", ");
    const marked = segments.reduce((sum, segment) => sum + segment.marked, 0);
    lines.push(`${card.facts.finished} finished ${card.facts.finished === 1 ? "book" : "books"}${groups ? `: ${groups}` : ""}. ${marked} with highlights.`);
  }
  const { signature, highlight } = card.chosen ?? {};
  if (signature) lines.push(`Signature book: ${signature.title} by ${signature.author}${signature.note ? `, “${signature.note}”` : ""}.`);
  if (highlight) lines.push(`Highlight: “${highlight.text}”, ${highlight.author}, ${highlight.title}.`);
  if (input.view === "owner") {
    if (input.leaders?.length) lines.push(`Only you see: ${input.leaders.map((leader) => `${leader.label} (${leader.count})`).join(", ")}.`);
    if (card.state === "leaning" && input.missing) lines.push(`Only you see: ${input.missing}.`);
  }
  return [...lines, ...card.coverage];
}
```

In `index.ts`, add `readerCardSummary` to the `./pages.js` export list.

- [ ] **Step 4: Add the pages sheet**

In `scripts/contact-sheet.ts`:
- Import `type ReaderCardChosen`, `type ReaderCardPage` and `type ReaderCardView` from `../src/readerCards/index.js`. Export `ReaderCardChosen` from `style.js` there if it isn't already reachable; it is, through `export * from "./style.js"`.
- Before `console.log(out);`, add:

```ts
const CHOSEN: ReaderCardChosen = {
  signature: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: "the one I lend to everyone" },
  highlight: { text: "To light a candle is to cast a shadow, and a long passage like this one wraps over several lines.", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" },
};
const pageRows: Array<[string, ReaderCardPage, ReaderCardView, ReaderCardChosen]> = [
  ["record · owner", "record", "owner", CHOSEN],
  ["record · visitor", "record", "visitor", CHOSEN],
  ["chosen · both", "chosen", "visitor", CHOSEN],
  ["chosen · book only", "chosen", "visitor", { signature: CHOSEN.signature }],
  ["chosen · highlight only", "chosen", "visitor", { highlight: CHOSEN.highlight }],
  ["chosen · owner, nothing chosen", "chosen", "owner", {}],
  ["merged · owner", "merged", "owner", CHOSEN],
  ["merged · visitor, nothing chosen", "merged", "visitor", {}],
];
const pageHtml = pageRows.map(([label, page, view, chosen]) => {
  const cards = READER_PLATES.flatMap((plate, index) => PRINTS.map((print) => renderReaderCard({ card: { ...cardOf(index), chosen }, style: DEFAULT_READER_CARD_STYLE, readerName: "example reader", print, label: plate.name, seed: seedOf(plate.key), width: 160, view, leaders: [{ label: "Earthsea", count: 4 }, { label: "Discworld", count: 3 }], missing: null }, page)));
  return `<h2>${label}</h2><div class="row">${cards.join("")}</div>`;
});
writeFileSync(join(out, "pages.html"), `<!doctype html><meta charset="utf-8"><title>pages</title><style>body{font:14px system-ui;background:#8a8a8a;margin:16px}.row{display:flex;flex-wrap:wrap;gap:8px}</style>${pageHtml.join("")}`);
```

- [ ] **Step 5: Run the tests and the sheet**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared && npm run sheet -w @scripta/shared`
Expected: tests PASS, and the sheet prints a directory that holds `pages.html`. The controller looks at it.

- [ ] **Step 6: Commit**

```bash
git add packages/shared && git commit -m "Summarise the reader card as text and guard every back page

The guard now also rejects ids and url(#) references, because each page is
inlined twice on the web and the hidden print would break them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Web image and viewer

**Files:**
- Create: `frontend/public/fonts/courier-prime-400.ttf`, `frontend/public/fonts/licenses/courierPrime.txt`
- Modify: `frontend/src/index.css` (an `@font-face` after the Inter face)
- Modify: `frontend/src/hooks/useReaderCard.ts`
- Create: `frontend/src/components/readerCard/ReaderCardImage.tsx`, `frontend/src/components/readerCard/ReaderCardViewer.tsx`
- Modify: `frontend/src/components/murals/blocks/ReaderCardBlock.tsx`, `frontend/src/components/murals/MuralBlockDetail.tsx`, `frontend/src/components/murals/BlockRenderer.tsx` (line ≈71), `frontend/src/components/murals/MobileBlockPreview.tsx` (line ≈60), `frontend/src/pages/MuralEditorPage.tsx` (the `groups ?? []` at ≈610, 642, 658)
- Test: `frontend/scripts/test-reader-card.mts`

**Interfaces:**
- Consumes: `readerCardInputOf`, `ReaderCardBase`, `ReaderCardPage`, `ReaderCardStep`, `renderReaderCard`, `readerCardPages`, `hasChosen`, `readerCardSummary`, `startTurn`, `turnBy`, `turnTo` (Tasks 3-7). It also uses `useScrollLock`, `useDismissible` (`frontend/src/hooks`) and `keepTabInside` (`frontend/src/lib/keepTabInside.ts`).
- Produces:
  - `useReaderCard(books, groups, readerName, override?): ReaderCardBase`
  - `NO_GROUPS: Group[]`
  - `<ReaderCardImage input page? className? />`
  - `<ReaderCardViewer input onClose />`

- [ ] **Step 1: Add the font**

Only after the controller has the user's OK for the download:
- `curl -fL -o frontend/public/fonts/courier-prime-400.ttf https://github.com/google/fonts/raw/main/ofl/courierprime/CourierPrime-Regular.ttf`
- `curl -fL -o frontend/public/fonts/licenses/courierPrime.txt https://github.com/google/fonts/raw/main/ofl/courierprime/OFL.txt`

Then add to `frontend/src/index.css`, after the Inter `@font-face`:

```css
@font-face {
  font-family: "Courier Prime";
  src: url("/fonts/courier-prime-400.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/scripts/test-reader-card.mts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readerCardInputOf, type Layout, type PublicReaderCard } from "@scripta/shared";
import { ReaderCardImage } from "../src/components/readerCard/ReaderCardImage";
import { ReaderCardViewer } from "../src/components/readerCard/ReaderCardViewer";

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: ["genres known for 3 of 3 finished books"],
  dial: { segments: [{ group: "star", books: 3, marked: 1 }] },
  facts: { finished: 3, highlights: 2, series: 0, since: 2020, edition: 2026 },
  style: { counter: "dial", layout: "faces", trait: "both" },
  chosen: { highlight: { text: "To light a candle", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" } },
};
const visitor = (layout: Layout, fields: Partial<PublicReaderCard> = {}) => readerCardInputOf([], [], "andre", { ...card, ...fields, style: { counter: "dial", layout, trait: "both" } });
const viewer = (input: ReturnType<typeof visitor>) => renderToString(createElement(ReaderCardViewer, { input, onClose: () => undefined }));

test("the image draws both prints, each hidden by the other theme", () => {
  const html = renderToString(createElement(ReaderCardImage, { input: visitor("faces") }));
  assert.equal(html.match(/<svg /g)?.length, 2);
  assert.match(html, /dark:hidden/);
  assert.match(html, /hidden h-full w-full dark:block/);
});

test("the viewer is a modal dialog that announces its page and carries the card as text", () => {
  const html = viewer(visitor("faces"));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-live="polite"[^>]*>Page 1 of 3</);
  assert.match(html, /To light a candle/);
  assert.equal(html.match(/aria-label="Page \d"/g)?.length, 3);
});

test("merged has two faces, and a visitor with nothing chosen skips the chosen page", () => {
  assert.match(viewer(visitor("merged")), />Page 1 of 2</);
  assert.match(viewer(visitor("faces", { chosen: {} })), />Page 1 of 2</);
});

test("a book on a narrow screen is a pager of every page", () => {
  const html = viewer(visitor("book"));
  assert.match(html, />Page 1 of 3</);
  assert.match(html, /snap-x/);
});
```

Run: `npm run build -w @scripta/shared && npm test -w frontend`
Expected: FAIL, because the components do not exist.

- [ ] **Step 3: Hook and image**

`frontend/src/hooks/useReaderCard.ts` becomes:

```ts
import { useMemo } from "react";
import { readerCardInputOf, type Group, type PublicReaderCard } from "@scripta/shared";

export const NO_GROUPS: Group[] = [];

export function useReaderCard(books: Array<Record<string, unknown>>, groups: Group[], readerName: string, override?: PublicReaderCard) {
  return useMemo(() => readerCardInputOf(books, groups, readerName, override), [books, groups, readerName, override]);
}
```

Create `frontend/src/components/readerCard/ReaderCardImage.tsx`:

```tsx
import { useMemo } from "react";
import { renderReaderCard, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";

export function ReaderCardImage({ input, page = "front", className = "" }: { input: ReaderCardBase; page?: ReaderCardPage; className?: string }) {
  const { paper, reversed } = useMemo(() => ({ paper: renderReaderCard({ ...input, print: "paper" }, page), reversed: renderReaderCard({ ...input, print: "reversed" }, page) }), [input, page]);
  return (
    <span className={`block aspect-[5/7] ${className}`}>
      <span className="block h-full w-full dark:hidden [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: paper }} />
      <span className="hidden h-full w-full dark:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: reversed }} />
    </span>
  );
}
```

- [ ] **Step 4: Viewer**

Create `frontend/src/components/readerCard/ReaderCardViewer.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { hasChosen, readerCardPages, readerCardSummary, startTurn, turnBy, turnTo, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";
import { useDismissible } from "../../hooks/useDismissible";
import { useScrollLock } from "../../hooks/useScrollLock";
import { keepTabInside } from "../../lib/keepTabInside";
import { ReaderCardImage } from "./ReaderCardImage";

const TURN = "motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]";
const CARD_WIDTH = "w-[min(88vw,calc((100dvh-10rem)*5/7))]";
const wideScreen = () => typeof window !== "undefined" && window.innerWidth >= 768 && !window.matchMedia?.("(pointer: coarse)").matches;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function ReaderCardViewer({ input, onClose }: { input: ReaderCardBase; onClose: () => void }) {
  useScrollLock();
  useDismissible(onClose);
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

  useEffect(() => {
    const previous = document.activeElement;
    focusRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const left = turn.index * element.clientWidth;
    if (Math.abs(element.scrollLeft - left) > 1) element.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [turn.index]);

  const go = (by: 1 | -1) => setTurn((state) => turnBy(state, by, count));
  const goTo = (to: number) => setTurn((state) => turnTo(state, to, to > state.index ? 1 : -1));
  const setFocus = (element: HTMLElement | null) => { focusRef.current = element; };

  let card;
  if (spread) {
    const open = turn.index === 1;
    card = (
      <button ref={setFocus} type="button" aria-label={open ? "Close the card" : "Open the card"} onClick={() => go(1)} className={`relative aspect-[10/7] w-[min(92vw,calc((100dvh-10rem)*10/7))] [perspective:2400px] ${TURN}`} style={{ transform: open ? "none" : "translateX(-25%)" }}>
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
        onScroll={(event) => { const element = event.currentTarget; const index = Math.round(element.scrollLeft / element.clientWidth); setTurn((state) => (state.index === index ? state : { ...state, index })); }}
        className={`flex ${CARD_WIDTH} snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]`}
      >
        {pages.map((page, i) => <div key={i} aria-hidden="true" className="w-full shrink-0 snap-center"><ReaderCardImage input={input} page={page} className="w-full" /></div>)}
      </div>
    );
  } else {
    card = (
      <button ref={setFocus} type="button" aria-label={`Turn the card, page ${turn.index + 1} of ${count}`} onClick={() => go(1)} className={`relative aspect-[5/7] ${CARD_WIDTH} [perspective:1600px]`}>
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
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reader card"
        className="flex flex-col items-center gap-3"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          keepTabInside(event);
          if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
          if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
        }}
      >
        <button type="button" onClick={onClose} className="h-11 self-end rounded-full bg-(--color-surface) px-4 text-(--color-text)">Close</button>
        {card}
        <p className="sr-only" aria-live="polite">{`Page ${turn.index + 1} of ${count}`}</p>
        <ul className="sr-only">{summary.map((line) => <li key={line}>{line}</li>)}</ul>
        <div className="flex" role="group" aria-label="Pages">
          {Array.from({ length: count }, (_, i) => (
            <button key={i} type="button" aria-label={`Page ${i + 1}`} aria-current={i === turn.index ? "true" : undefined} onClick={() => goTo(i)} className="flex h-11 w-11 items-center justify-center">
              <span className={`block h-2 w-2 rounded-full ${i === turn.index ? "bg-(--color-surface)" : "bg-(--color-surface)/40"}`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the block and the detail**

`frontend/src/components/murals/blocks/ReaderCardBlock.tsx` becomes:

```tsx
import type { Group, PublicReaderCard } from "@scripta/shared";
import { useReaderCard } from "../../../hooks/useReaderCard";
import { ReaderCardImage } from "../../readerCard/ReaderCardImage";

export function ReaderCardBlockView({ books, groups, readerCardOverride, readerName }: { books: Array<Record<string, unknown>>; groups: Group[]; readerCardOverride?: PublicReaderCard; readerName: string }) {
  const input = useReaderCard(books, groups, readerName, readerCardOverride);
  return <ReaderCardImage input={input} className="mx-auto h-full max-w-full" />;
}
```

In `MuralBlockDetail.tsx`:
- Delete `ReaderCardDetailSheet`.
- Drop the `ReaderCardDetail, ReaderCardPlate` import, and any import that becomes unused (for example `READER_PLATES`).
- Import `ReaderCardViewer` and `NO_GROUPS`, and add:

```tsx
function ReaderCardDetailViewer({ books, groups, readerCardOverride, readerName, onClose }: { books: Array<Record<string, unknown>>; groups: Group[]; readerCardOverride?: PublicReaderCard; readerName: string; onClose: () => void }) {
  const input = useReaderCard(books, groups, readerName, readerCardOverride);
  return <ReaderCardViewer input={input} onClose={onClose} />;
}
```

The reader-card branch becomes:

```tsx
  if (block.type === "readerCard") {
    return <ReaderCardDetailViewer books={books} groups={libraryGroups ?? NO_GROUPS} readerCardOverride={readerCardOverride} readerName={profile?.username || "reader"} onClose={onClose} />;
  }
```

Use the local variable name the branch uses today. The Explore report quotes `libraryGroups`.

In `BlockRenderer.tsx`, `MobileBlockPreview.tsx` and `MuralEditorPage.tsx`, replace each `groups ?? []` that reaches the reader card with `groups ?? NO_GROUPS`, imported from `../../hooks/useReaderCard` (adjust the path per file). A fresh `[]` makes the card recompute on every render.

- [ ] **Step 6: Verify the frontend**

Run: `npm run build -w @scripta/shared && npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend`
Expected: all PASS, including `test-reader-card.mts`, `test-on-accent-text.mts` and `test-motion-css.mts`.

- [ ] **Step 7: Commit**

```bash
git add frontend && git commit -m "Open the web reader card in a full-screen viewer that turns its pages

The viewer replaces the detail sheet: the record page now carries what the
sheet listed, and the faces, book and merged layouts turn by tap, arrow
keys or dots, instantly when reduced motion is on.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Mobile image and viewer

**Files:**
- Create: `mobile/assets/fonts/courierPrime-400.ttf` (the same file as on web), `mobile/assets/fonts/licenses/courierPrime.txt`
- Modify: `mobile/src/ui/fontAssets.ts`, `mobile/src/ui/fontAssets.test.ts`
- Create: `mobile/src/features/murals/readerCardXml.ts`, `mobile/src/features/murals/readerCardXml.test.ts`
- Create: `mobile/src/features/murals/ReaderCardImage.tsx`, `mobile/src/features/murals/ReaderCardViewer.tsx`
- Modify: `mobile/src/features/murals/ReaderCardBlock.tsx`, `mobile/src/features/murals/MuralCanvas.tsx` (the `groups ?? []` at ≈236 and the `groups = []` defaults at ≈353 and ≈396), `mobile/src/features/community/MyShelfScreen.tsx` (≈61), `mobile/src/features/murals/MuralEditorScreen.tsx` (≈106)

**Interfaces:**
- Consumes: the shared functions from Tasks 3-7; and from `mobile/src/ui`: `Icon` (`name="close"`), `cardFontFamily`, `minimumTouchTarget`, `radii`, `spacing`, `useReducedMotion`, `useTheme`.
- Produces:
  - `readerCardXml(svg, fonts): string`
  - `CARD_MONO_FAMILY = "courierPrime-400"`
  - `PLATE_RATIO`
  - `<ReaderCardImage input page? width />`
  - `<ReaderCardViewer input onClose />` (mounted only while open)
  - `NO_GROUPS`, exported from `MuralCanvas.tsx`

- [ ] **Step 1: Add the font**

Copy `frontend/public/fonts/courier-prime-400.ttf` to `mobile/assets/fonts/courierPrime-400.ttf`, and the licence to `mobile/assets/fonts/licenses/courierPrime.txt`. In `fontAssets.ts`, add `"courierPrime-400": require("../../assets/fonts/courierPrime-400.ttf"),` to `FONT_ASSETS`, and `export const CARD_MONO_FAMILY = "courierPrime-400";` below it. Append to `fontAssets.test.ts`:

```ts
test("the reader card's typewriter font is bundled", () => {
  const source = readFileSync("src/ui/fontAssets.ts", "utf8");
  assert.ok(source.includes(`"courierPrime-400": require("../../assets/fonts/courierPrime-400.ttf")`));
  assert.ok(existsSync("assets/fonts/courierPrime-400.ttf"));
});
```

Use whatever `readFileSync`/`existsSync` imports the file already has, and add them if missing.

- [ ] **Step 2: Write the failing XML test**

Create `mobile/src/features/murals/readerCardXml.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { PLATE_FONTS, readerCardInputOf, renderReaderCard, type PublicReaderCard } from "@scripta/shared";
import { readerCardXml } from "./readerCardXml";

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: ["c"],
  dial: { segments: [{ group: "star", books: 3, marked: 1 }] },
  facts: { finished: 3, highlights: 1, series: 0, since: null, edition: 2026 },
  chosen: { signature: { title: "Fire & Blood", author: "George R. R. Martin", workId: null, coverUrl: null, note: null }, highlight: { text: "a & b", title: "Fire & Blood", author: "George R. R. Martin" } },
};
const fonts = { serif: "SERIF-X", sans: "SANS-X", mono: "MONO-X" };

test("every card font becomes a bundled family and ampersands draw as themselves", () => {
  const input = readerCardInputOf([], [], "andre", card);
  for (const page of ["front", "chosen", "record", "merged"] as const) {
    const xml = readerCardXml(renderReaderCard({ ...input, print: "paper" }, page), fonts);
    for (const family of Object.values(PLATE_FONTS)) assert.equal(xml.includes(family), false, `${page}: ${family}`);
    assert.doesNotMatch(xml, /&amp;/, page);
  }
  assert.match(readerCardXml(renderReaderCard({ ...input, print: "paper" }, "chosen"), fonts), />Fire & Blood</);
});
```

Run: `npm run build -w @scripta/shared && npm test -w mobile`
Expected: FAIL, because `./readerCardXml` does not exist.

- [ ] **Step 3: Implement the XML helper and the image**

Create `mobile/src/features/murals/readerCardXml.ts`:

```ts
import { PLATE_FONTS } from "@scripta/shared";

export interface CardFonts { serif: string; sans: string; mono: string }

export function readerCardXml(svg: string, fonts: CardFonts): string {
  return svg.replaceAll(PLATE_FONTS.serif, fonts.serif).replaceAll(PLATE_FONTS.sans, fonts.sans).replaceAll(PLATE_FONTS.mono, fonts.mono).replaceAll("&amp;", "&");
}
```

Create `mobile/src/features/murals/ReaderCardImage.tsx`:

```tsx
import { useMemo } from "react";
import { SvgXml } from "react-native-svg";
import { renderReaderCard, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";
import { cardFontFamily, useTheme } from "../../ui";
import { CARD_MONO_FAMILY } from "../../ui/fontAssets";
import { readerCardXml } from "./readerCardXml";

export const PLATE_RATIO = 350 / 250;

export function ReaderCardImage({ input, page = "front", width }: { input: ReaderCardBase; page?: ReaderCardPage; width: number }) {
  const { mode } = useTheme();
  const xml = useMemo(
    () => readerCardXml(renderReaderCard({ ...input, print: mode === "dark" ? "reversed" : "paper" }, page), { serif: cardFontFamily("playfairDisplay"), sans: cardFontFamily("sans"), mono: CARD_MONO_FAMILY }),
    [input, page, mode],
  );
  return <SvgXml xml={xml} width={width} height={width * PLATE_RATIO} />;
}
```

- [ ] **Step 4: Viewer**

Create `mobile/src/features/murals/ReaderCardViewer.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import PagerView from "react-native-pager-view";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hasChosen, readerCardPages, readerCardSummary, startTurn, turnBy, turnTo, type ReaderCardBase } from "@scripta/shared";
import { MOTION } from "@scripta/shared/themes";
import { Icon, minimumTouchTarget, radii, spacing, useReducedMotion, useTheme } from "../../ui";
import { PLATE_RATIO, ReaderCardImage } from "./ReaderCardImage";

const EASE = Easing.bezier(MOTION.ease[0], MOTION.ease[1], MOTION.ease[2], MOTION.ease[3]);
const TURN_MS = 450;

export function ReaderCardViewer({ input, onClose }: { input: ReaderCardBase; onClose: () => void }) {
  const { colors } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const pages = useMemo(() => readerCardPages(input.style.layout, input.view ?? "visitor", hasChosen(input.card.chosen)).flat(), [input]);
  const summary = useMemo(() => readerCardSummary(input).join(" "), [input]);
  const [turn, setTurn] = useState(() => startTurn(pages.length));
  const rotation = useSharedValue(0);
  const pager = useRef<PagerView>(null);
  const announced = useRef(false);
  const isPager = input.style.layout === "book";
  const width = Math.max(0, Math.min(screenWidth - spacing.xl * 2, (screenHeight - insets.top - insets.bottom - 160) / PLATE_RATIO));

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

  return (
    <Modal animationType={reduced ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent transparent visible>
      <View style={[styles.backdrop, { backgroundColor: colors.scrim, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Pressable accessibilityLabel="Close reader card" accessibilityRole="button" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.content}>
          <Pressable accessibilityLabel="Close reader card" accessibilityRole="button" hitSlop={8} onPress={onClose} style={[styles.close, { backgroundColor: colors.surface }]}>
            <Icon name="close" color={colors.text} />
          </Pressable>
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
                <View style={[styles.dotMark, { backgroundColor: colors.surface, opacity: i === turn.index ? 1 : 0.4 }]} />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { alignItems: "center", gap: spacing.md },
  close: { alignSelf: "flex-end", minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  face: { ...StyleSheet.absoluteFillObject, backfaceVisibility: "hidden" },
  dots: { flexDirection: "row" },
  dot: { width: minimumTouchTarget, height: minimumTouchTarget, alignItems: "center", justifyContent: "center" },
  dotMark: { width: 8, height: 8, borderRadius: radii.full },
});
```

- [ ] **Step 5: Wire the block**

Rewrite `mobile/src/features/murals/ReaderCardBlock.tsx` around the new pieces. Keep its props, its `onLayout` box sizing and its `editable` handling as they are today:

```tsx
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { readerCardInputOf, type Group, type PublicReaderCard } from "@scripta/shared";
import { PLATE_RATIO, ReaderCardImage } from "./ReaderCardImage";
import { ReaderCardViewer } from "./ReaderCardViewer";

export function ReaderCardBlock({ books, groups, readerName, publicCard, editable }: { books: Array<Record<string, unknown>>; groups: Group[]; readerName: string; publicCard?: PublicReaderCard; editable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, publicCard), [books, groups, readerName, publicCard]);
  const width = Math.max(0, Math.min(box.width, box.height / PLATE_RATIO));
  const image = width > 0 ? <ReaderCardImage input={input} width={width} /> : null;
  return (
    <>
      <View pointerEvents={editable ? "none" : "auto"} onLayout={(event) => setBox(event.nativeEvent.layout)} style={styles.plateBox}>
        {editable ? image : <Pressable accessibilityRole="button" accessibilityLabel={input.label} accessibilityHint="Opens the reader card" onPress={() => setOpen(true)} style={{ width, height: width * PLATE_RATIO }}>{image}</Pressable>}
      </View>
      {open ? <ReaderCardViewer input={input} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({ plateBox: { flex: 1, alignItems: "center", justifyContent: "center" } });
```

In `MuralCanvas.tsx`, add `export const NO_GROUPS: Group[] = [];`. Use it for `groups ?? []` in `BlockContent` and for the `groups = []` parameter defaults. In `MyShelfScreen.tsx` and `MuralEditorScreen.tsx`, replace the `?? []` fallback that feeds `groups` with `NO_GROUPS`, imported from `MuralCanvas`.

- [ ] **Step 6: Verify mobile**

Run: `npm run build -w @scripta/shared && npm run typecheck -w mobile && npm test -w mobile && (cd mobile && npx expo-doctor)`
Expected: all PASS, including `textImports.test.ts`, `fontAssets.test.ts` and `readerCardXml.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add mobile && git commit -m "Open the mobile reader card in a full-screen viewer that turns its pages

SvgXml decodes no entities, so the card's XML is handed over with its
ampersands restored; Courier Prime is bundled for the record rows.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Check it on screen and ship A3

**Files:** none. This task verifies and opens the PR.

- [ ] **Step 1: Contact sheet**

Run: `npm run sheet -w @scripta/shared -- <scratch dir>`. Rasterise or open `pages.html`, and check every row across 8 plates × 2 prints:
- nothing crosses the frame or the footer rule at y 305;
- the record's ◇ rows appear only in the owner rows;
- the typographic cover's title is legible;
- the merged back's rows clear the coverage line.

- [ ] **Step 2: Web check**

1. Run `npm run dev:claim`.
2. Seed the fixture with its community graph:

```bash
node --input-type=module -e 'const m = await import("./scripts/devFixtureSetup.mjs"); m.seedDevAccount(false, console.log); m.seedFixtureUsers(console.log); m.seedCommunityGraph(console.log);'
```

3. Start an `api-dev` launch entry that runs `npm run backend` with `devDataDirEnv()` merged into its env (see the dev-account memory), then `web`.
4. Sign in with `scripts/fixtures/account.json`.
5. Open a profile whose shelf has a reader card block. Check `/community/u/scripta_dev` first (owner), then a fixture user's profile (visitor).
6. Open the card:
   - it turns by click, ArrowRight/ArrowLeft and the dots;
   - Esc closes it and focus returns to the block;
   - the record page shows ◇ rows only on your own profile;
   - check it in both the light and the dark theme;
   - with reduced motion emulated, the turn is instant.

If no seeded mural has a reader card block, say so. Do not create or save a mural through the UI to get one.

- [ ] **Step 3: Device pass**

Run `node scripts/dev-status.mjs --json` once. If no other worktree holds the emulator, dispatch `device-checker` for My shelf → the reader card:
- tap opens the full-screen viewer;
- taps turn front → chosen (an invitation on your own card) → record → front, with dots;
- the record rows are in a typewriter face and show ◇ rows;
- the close button and Android back close it;
- light and dark;
- with "Remove animations" on, the turn is instant.

If another worktree holds it, skip the pass and record that it gates the merge.

- [ ] **Step 4: Ship**

1. Run `branch-reviewer` with this plan and the spec.
2. Push. Open PR "Reader card A3: pages and viewer" against `main`, or against `claude/reader-card-a2` if #205 has not merged, in which case retarget the PR to `main` before `--auto`.
3. Enable `--auto`.
4. **Deploy note for the PR:** the owner's chosen page shows an invitation with no way to act until A4 adds "Edit card", so A3 and A4 should reach production together. Deploying is the owner's call.
