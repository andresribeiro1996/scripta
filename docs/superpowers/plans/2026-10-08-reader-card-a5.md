# Reader card A5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner decorate the reader card: a motto in 12 looks, a footer value for each corner (12 + 12, including the reader number), 12 corner ornaments and a fixed or theme-following print. Every choice is drawn on web and mobile, previewed in the editor, and shown to visitors.

**Architecture:**
- **Shared (`@scripta/shared`):**
  - `style.ts` gains the option lists and the `motto`/`footer`/`corners`/`print` fields, and `labels.ts` names them.
  - New pure modules each return SVG fragments in the existing classes:
    - `numerals.ts`: `roman`, `nameParts`, `displayName`
    - `corners.ts`: `cornersSlot`
    - `footer.ts`: `footerSlots`
    - `mottos.ts`: `mottoSlots`
  - `render.ts` hands those fragments to the existing compose slots, on the front and the back pages.
  - Defaults produce byte-identical markup, so the committed plate masters and the landing page do not change.
  - `thumbnail.ts` and a `crop` on the render input draw editor thumbnails.
- **Backend:**
  - The PATCH schema accepts the new fields.
  - Auth exposes `readerNumberOf`.
  - The public resolver adds `facts.readerNumber` only when the owner chose that footer.
  - A new owner endpoint returns the owner's own number.
- **Clients:**
  - Pinyon Script is bundled on both clients.
  - `ReaderCardImage` honours a fixed print and a crop.
  - A `useOwnCardStyle` hook feeds the owner's style and reader number into the owner's card.
  - The editor gains Motto, Footer, Corners and Print sections.
  - A shared-shape `DraftField` (one per client) replaces the hand-rolled note field and also drives the motto text.

**Tech Stack:** TypeScript, `node:test` via tsx, Fastify + zod + node:sqlite (backend), React 19 + Tailwind 4 + TanStack Query 5 (web, SSR tests), Expo Router / React Native 0.86 + react-native-svg 15.15.4 (mobile).

**Spec:** `docs/superpowers/specs/2026-10-07-reader-card-enrichment-design.md`: "Front" (Motto, Footer, Corners, Print), "Data → Style", "API", "Public numbers → Reader number", "Renderer", "Clients → Editor", the A5 row of "Phases", "Risks" and "A0 findings".

**Starting point:**
- A4 (#212) is merged to `main` as 09e44a9b.
- Cut the execution worktree from `origin/main`, then cherry-pick this plan's commit from the local branch `claude/reader-card-a5`.

## Decisions this plan takes

The spec is silent on these, the code contradicts it, or the owner decided them while the plan was written (2026-10-08). Each is final for A5.

1. **One plan and one PR for all of A5.** The owner chose this over splitting it in two.

2. **Name parts.**
   - The card's name is the username (`[a-zA-Z0-9_.]{3,30}`), and there is no real-name field.
   - `nameParts` splits the username on `.` and `_`:
     - `andre.ribeiro` → first `ANDRE`, last `RIBEIRO`.
     - A single part has no last name, so `firstName`, `lastName`, `firstInitial`, `initials` and `catalog` fall back to the default `name`, as the spec says for single-word names.
   - `displayName` capitalises each part (`Andre Ribeiro`). `nameItalic` and `signature` draw it.
   - The owner chose this split.

3. **Sash follows the mockup.**
   - Every motto look lifts EX LIBRIS to the small line above it, except `bannerBelow` and `sash`. The owner chose this, overriding the spec's "every look except bannerBelow".
   - The sash band is pre-clipped to the inner frame as a polygon, so it needs no `clipPath`, `id` or `url(#…)`.

4. **Arc text.**
   - `arc` and `wavyRibbon` draw their text on a `<textPath>`, with `startOffset` computed from `fit.ts`'s width estimate. They never use `text-anchor` (A0 finding).
   - Their path `id` is `rc-<look>-<seed>-<print>`: unique per look and print, and identical for identical cards.
   - The portable guard allows exactly those ids, and an `href="#…"` only on `<textPath>` pointing at an id defined in the same SVG. `url(#…)` stays forbidden.

5. **Defaults are byte-identical.**
   - Each module returns `undefined` for the default option, so the compose defaults draw. The defaults are motto `null`, footer `plate`/`name`, corners `diamonds` and print `auto`.
   - `plates.test.ts` (committed masters) and `readerCard.test.ts` ("the default card equals `renderPlate`") keep passing unchanged.

6. **Footer fallback and room.**
   - An unavailable value draws the corner's default. That covers no finish dates, zero highlights or series, a non-genre or unwritten identity, and no reader number.
   - The right value is fitted to at most 100 units. The left value gets the rest of the 190-unit footer, minus a 12-unit gap, and never less than 40.
   - Numbers above 3999 print in Arabic numerals.

7. **Footer patch.** `footer` is always patched whole (`{ left, right }`). The client always sends both corners, so the server's top-level merge is enough.

8. **Reader number.**
   - `readerNumberOf(userId)` lives in `auth/publicProfile.ts` with the other cross-module reads. It counts the users created earlier, breaking same-millisecond ties by `rowid`, and returns `undefined` for an unknown id.
   - The public resolver attaches it to `facts` only when `footer.left === "readerNumber"`.
   - The owner's card is computed on the device, so the owner reads the number from a new `GET /library/reader-card/number` (`{ readerNumber: number | null }`). The client fetches it only while that footer is chosen.

9. **Print.**
   - `resolvePrint(print, dark)` is shared. Mobile uses it.
   - Web keeps rendering both prints for `auto`, toggled by CSS, and renders a single copy for a fixed print.

10. **Thumbnails.**
    - `styleThumbnail(input, patch, crop?)` generalises `counterThumbnail`, including its scaled-down dial.
    - Motto thumbnails use the crop `30 18 190 210`. Corner thumbnails use `0 0 100 100`.
    - Footer options are text chips, not thumbnails: the live preview shows them.

11. **Editor sections.**
    - **Motto:** a 28-character field plus 12 look thumbnails. A look picked while the field is empty is remembered locally and saved with the first text.
    - **Footer:** two rows of 12 chips.
    - **Corners:** 12 cropped thumbnails.
    - **Print:** 3 segments.
    - The web option groups use `role="radio"`, so the A4 editor test now counts radios per group.

12. **Script font.**
    - Pinyon Script (OFL) is downloaded once from `google/fonts`, which the owner approved.
    - It is bundled as `frontend/public/fonts/pinyon-script-400.ttf` and `mobile/assets/fonts/pinyonScript-400.ttf`, with `OFL.txt` as each client's licence file.

13. **Not in A5:** finishes, the shine layer and texture tiles (A6), and sub-projects B, C and D. The trait and the signature note listed in the spec's A5 row already shipped in A1–A4.

## Global Constraints

- **Code style:**
  - No comments in code (`AGENTS.md`).
  - Search with `rg`, and run git from the worktree root.
  - Stage and commit in one command. Commit bodies say why.
- **Shared builds:**
  - Run `npm run dev:link-deps` once per worktree.
  - Run `npm run build -w @scripta/shared` before any backend, frontend or mobile typecheck or test, because consumers read `packages/shared/dist`.
- **Options (exact, in this order):**
  - `MOTTO_LOOKS = ["ribbon", "scroll", "arc", "cartouche", "rule", "bannerBelow", "wavyRibbon", "titleRules", "dropCap", "sash", "script", "plaque"]`, `MOTTO_MAX = 28`
  - `FOOTER_LEFTS = ["plate", "plateName", "since", "est", "volumes", "highlights", "series", "genre", "edition", "readerNumber", "glyph", "none"]`
  - `FOOTER_RIGHTS = ["name", "firstName", "lastName", "firstInitial", "initials", "catalog", "handle", "nameItalic", "signature", "monogram", "monogramDiamond", "none"]`
  - `CORNER_STYLES = ["diamonds", "deco", "fleuron", "photo", "stars", "laurel", "knot", "volute", "meander", "rosette", "register", "none"]`
  - `CARD_PRINTS = ["auto", "paper", "reversed"]`
- **Defaults:** motto `null`, footer `{ left: "plate", right: "name" }`, corners `"diamonds"`, print `"auto"`.
- **Labels:** exactly as in Task 1's `labels.ts`.
- **Card geometry:**
  - viewBox `0 0 250 350`.
  - Footer baseline y = 321, left x = 30, right x = 220.
  - Inner frame corners: (16,16), (234,16), (16,334) and (234,334).
- **Escaping:** every user string reaches the SVG through `svgText`/`escapeText`. The motto text is public free text with no moderation.
- **Privacy:**
  - The reader number reaches visitors only when the owner chose the `readerNumber` footer.
  - `leaders`, `missing` and annotations stay owner-only, as before.
- **Portability:** react-native-svg 15.15.4. Never use `<style>`, SMIL, `feTurbulence`/`feDisplacementMap`/`feImage`, `foreignObject`, `mix-blend-mode`, a leftover `class` or a nested `<svg>`.
- **Web:**
  - Transitions only under `motion-safe:`.
  - The token scanners in `frontend/scripts/test-*.mts` stay green.
- **Mobile:**
  - `Text` only from `mobile/src/ui/Text`.
  - Rules of React (reactCompiler).
  - No new native dependency, so it ships over the air.
- **Backend tests:** keep the env preamble (`process.env.*` before imports). `backend/package.json` lists its test files, so check that a new test file is listed.

## Review Focus

1. **A motto at its limits:** 28 wide letters, emoji, or `<b>&`. It shrinks to its look's slot (size never below 5), is cut with "…" past that, and is escaped. Pinned in Task 7 ("a long motto stays inside every look…" and "motto text is escaped").
2. **A footer value with nothing behind it:** no finish dates, zero highlights or series, an annotator (non-genre) identity, an unwritten card, or no reader number. That corner draws its default, never an empty "0" value. Pinned in Task 6 ("an unavailable value falls back…").
3. **Unusual usernames:** no separator (`andre`), separators at the ends (`_andre_`), doubled separators (`a..b`), or 30 characters. The name parts fall back correctly and long values are cut. Pinned in Task 3 and Task 6 ("a 30-character handle is cut…").
4. **A fixed print against the theme:** `reversed` on a light theme and `paper` on a dark one draw that print. Web draws only one copy, and mobile ignores the theme. `auto` behaves as before. Pinned in Task 1 (`resolvePrint`), Task 10 ("a fixed print draws one copy") and Task 12.
5. **Older stored styles and older clients:** a stored style without the new fields reads as the defaults. A visitor sees the reader number only when the owner chose it. Pinned in Task 1 (normalising) and Task 9 ("the reader number reaches visitors only…").

---

### Task 1: Style options, defaults and labels

**Files:**
- Modify: `packages/shared/src/readerCards/style.ts`, `packages/shared/src/readerCards/labels.ts`, `packages/shared/src/readerCards/index.ts`
- Test: `packages/shared/src/readerCards/style.test.ts`
- Modify the tests that build or compare a whole style. They are listed in Step 5.

**Interfaces:**
- Produces (all exported from `@scripta/shared`):

```ts
export const MOTTO_LOOKS: readonly [...]; export type MottoLook;
export const MOTTO_MAX = 28;
export const FOOTER_LEFTS: readonly [...]; export type FooterLeft;
export const FOOTER_RIGHTS: readonly [...]; export type FooterRight;
export const CORNER_STYLES: readonly [...]; export type CornerStyle;
export const CARD_PRINTS: readonly [...]; export type CardPrint;
export interface CardMotto { text: string; look: MottoLook }
export interface CardFooter { left: FooterLeft; right: FooterRight }
export function resolvePrint(print: CardPrint, dark: boolean): PlatePrint;
// ReaderCardStyle and PublicReaderCardStyle gain motto, footer, corners, print
export const MOTTO_LOOK_LABELS, FOOTER_LEFT_LABELS, FOOTER_RIGHT_LABELS, CORNER_LABELS, PRINT_LABELS;
```

- [ ] **Step 1: Write the failing tests**

In `style.test.ts`:
- Replace the first test (`"the default style chooses no book and no highlight"`) with the first test below.
- Change the two `publicStyle` `deepEqual`s at the old lines 26 and 47 to the second and third tests below.
- Add the rest.
- Add `CARD_PRINTS, CORNER_STYLES, FOOTER_LEFTS, FOOTER_RIGHTS, MOTTO_LOOKS, resolvePrint` to the `./style.js` import, and add `import { CORNER_LABELS, FOOTER_LEFT_LABELS, FOOTER_RIGHT_LABELS, MOTTO_LOOK_LABELS, PRINT_LABELS } from "./labels.js";`.

```ts
const PUBLIC_DEFAULTS = { motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto" };

test("the default style chooses no book, no highlight and no motto, and keeps today's footer, corners and print", () => {
  assert.deepEqual(DEFAULT_READER_CARD_STYLE, { counter: "dial", layout: "faces", trait: "both", ...PUBLIC_DEFAULTS, signature: null, highlight: null });
});

test("the public style drops the private references", () => {
  const style = normalizeReaderCardStyle({ counter: "ring", signature: { bookKey: "k" }, highlight: { bookKey: "k", highlightId: "h" } });
  assert.deepEqual(publicStyle(style), { counter: "ring", layout: "faces", trait: "both", ...PUBLIC_DEFAULTS });
});

test("a layout is kept when known and falls back to faces otherwise", () => {
  assert.equal(normalizeReaderCardStyle({ layout: "book" }).layout, "book");
  assert.equal(normalizeReaderCardStyle({ layout: "scroll" }).layout, "faces");
  assert.deepEqual(publicStyle(normalizeReaderCardStyle({ layout: "merged", signature: { bookKey: "k" } })), { counter: "dial", layout: "merged", trait: "both", ...PUBLIC_DEFAULTS });
});

test("a motto is trimmed and capped at 28 characters, an empty one means none, and an unknown look becomes a ribbon", () => {
  assert.deepEqual(normalizeReaderCardStyle({ motto: { text: "  Per libros ad astra  ", look: "arc" } }).motto, { text: "Per libros ad astra", look: "arc" });
  assert.equal(normalizeReaderCardStyle({ motto: { text: "   ", look: "arc" } }).motto, null);
  assert.equal(normalizeReaderCardStyle({ motto: { text: "a".repeat(40), look: "rule" } }).motto?.text.length, 28);
  assert.equal([...normalizeReaderCardStyle({ motto: { text: "🦉".repeat(30), look: "rule" } }).motto!.text].length, 28);
  assert.deepEqual(normalizeReaderCardStyle({ motto: { text: "x", look: "neon" } }).motto, { text: "x", look: "ribbon" });
  assert.equal(normalizeReaderCardStyle({ motto: "x" }).motto, null);
  assert.equal(normalizeReaderCardStyle({ motto: { look: "arc" } }).motto, null);
});

test("each footer corner, the corners and the print fall back to their default on their own", () => {
  assert.deepEqual(normalizeReaderCardStyle({ footer: { left: "since", right: "neon" } }).footer, { left: "since", right: "name" });
  assert.deepEqual(normalizeReaderCardStyle({ footer: { left: 3, right: "handle" } }).footer, { left: "plate", right: "handle" });
  assert.deepEqual(normalizeReaderCardStyle({ footer: "x" }).footer, { left: "plate", right: "name" });
  assert.equal(normalizeReaderCardStyle({ corners: "laurel" }).corners, "laurel");
  assert.equal(normalizeReaderCardStyle({ corners: "neon" }).corners, "diamonds");
  assert.equal(normalizeReaderCardStyle({ print: "reversed" }).print, "reversed");
  assert.equal(normalizeReaderCardStyle({ print: "neon" }).print, "auto");
});

test("a style stored before A5 reads as the defaults for every new field", () => {
  const old = normalizeReaderCardStyle({ counter: "shelf", layout: "book", trait: "seal", signature: null, highlight: null });
  assert.deepEqual(old, { ...DEFAULT_READER_CARD_STYLE, counter: "shelf", layout: "book", trait: "seal" });
});

test("auto print follows the theme and a fixed print ignores it", () => {
  assert.equal(resolvePrint("auto", false), "paper");
  assert.equal(resolvePrint("auto", true), "reversed");
  assert.equal(resolvePrint("paper", true), "paper");
  assert.equal(resolvePrint("reversed", false), "reversed");
});

test("every decoration option has a name", () => {
  assert.deepEqual(MOTTO_LOOKS.map((key) => MOTTO_LOOK_LABELS[key]), ["Ribbon", "Scroll", "Arc", "Cartouche", "Rule", "Banner below", "Wavy ribbon", "Title rules", "Drop cap", "Sash", "Script", "Plaque"]);
  assert.deepEqual(FOOTER_LEFTS.map((key) => FOOTER_LEFT_LABELS[key]), ["Plate", "Plate and name", "Reader since", "Established", "Volumes", "Highlights", "Series", "Genre", "Edition", "Reader number", "Glyph", "None"]);
  assert.deepEqual(FOOTER_RIGHTS.map((key) => FOOTER_RIGHT_LABELS[key]), ["Name", "First name", "Last name", "First name, initial", "Initials", "Catalogue", "Handle", "Name in italics", "Signature", "Monogram", "Diamond monogram", "None"]);
  assert.deepEqual(CORNER_STYLES.map((key) => CORNER_LABELS[key]), ["Diamonds", "Art deco", "Fleuron", "Photo corners", "Stars", "Laurel", "Knot", "Volute", "Meander", "Rosette", "Register mark", "None"]);
  assert.deepEqual(CARD_PRINTS.map((key) => PRINT_LABELS[key]), ["Follow theme", "Paper", "Reversed"]);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL. The lists, `resolvePrint` and the labels do not exist.

- [ ] **Step 3: Implement**

In `style.ts`, add `import type { PlatePrint } from "./render.js";` after the counters import. Insert this after the `noteToSend` function:

```ts
export const MOTTO_LOOKS = ["ribbon", "scroll", "arc", "cartouche", "rule", "bannerBelow", "wavyRibbon", "titleRules", "dropCap", "sash", "script", "plaque"] as const;
export type MottoLook = (typeof MOTTO_LOOKS)[number];
export const MOTTO_MAX = 28;
export const FOOTER_LEFTS = ["plate", "plateName", "since", "est", "volumes", "highlights", "series", "genre", "edition", "readerNumber", "glyph", "none"] as const;
export type FooterLeft = (typeof FOOTER_LEFTS)[number];
export const FOOTER_RIGHTS = ["name", "firstName", "lastName", "firstInitial", "initials", "catalog", "handle", "nameItalic", "signature", "monogram", "monogramDiamond", "none"] as const;
export type FooterRight = (typeof FOOTER_RIGHTS)[number];
export const CORNER_STYLES = ["diamonds", "deco", "fleuron", "photo", "stars", "laurel", "knot", "volute", "meander", "rosette", "register", "none"] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];
export const CARD_PRINTS = ["auto", "paper", "reversed"] as const;
export type CardPrint = (typeof CARD_PRINTS)[number];

export interface CardMotto { text: string; look: MottoLook }
export interface CardFooter { left: FooterLeft; right: FooterRight }
```

Replace `ReaderCardStyle`, `PublicReaderCardStyle` and `DEFAULT_READER_CARD_STYLE` with:

```ts
export interface ReaderCardStyle {
  counter: Counter;
  layout: Layout;
  trait: Trait;
  motto: CardMotto | null;
  footer: CardFooter;
  corners: CornerStyle;
  print: CardPrint;
  signature: ChosenSignature | null;
  highlight: ChosenHighlight | null;
}

export type ReaderCardStylePatch = Partial<ReaderCardStyle>;
export type PublicReaderCardStyle = Pick<ReaderCardStyle, "counter" | "layout" | "trait" | "motto" | "footer" | "corners" | "print">;
```

(Keep `ReaderCardChosen` as it is, between the types and the default.)

```ts
export const DEFAULT_READER_CARD_STYLE: ReaderCardStyle = { counter: "dial", layout: "faces", trait: "both", motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto", signature: null, highlight: null };
```

Add these after `highlightOf`:

```ts
function mottoOf(value: unknown): CardMotto | null {
  const raw = record(value);
  const text = typeof raw?.text === "string" ? [...raw.text.trim()].slice(0, MOTTO_MAX).join("").trim() : "";
  return text ? { text, look: oneOf(MOTTO_LOOKS, raw?.look, "ribbon") } : null;
}

function footerOf(value: unknown): CardFooter {
  const raw = record(value);
  return { left: oneOf(FOOTER_LEFTS, raw?.left, DEFAULT_READER_CARD_STYLE.footer.left), right: oneOf(FOOTER_RIGHTS, raw?.right, DEFAULT_READER_CARD_STYLE.footer.right) };
}
```

`normalizeReaderCardStyle` returns:

```ts
  return {
    counter: oneOf(COUNTERS, raw.counter, DEFAULT_READER_CARD_STYLE.counter),
    layout: oneOf(LAYOUTS, raw.layout, DEFAULT_READER_CARD_STYLE.layout),
    trait: oneOf(TRAITS, raw.trait, DEFAULT_READER_CARD_STYLE.trait),
    motto: mottoOf(raw.motto),
    footer: footerOf(raw.footer),
    corners: oneOf(CORNER_STYLES, raw.corners, DEFAULT_READER_CARD_STYLE.corners),
    print: oneOf(CARD_PRINTS, raw.print, DEFAULT_READER_CARD_STYLE.print),
    signature: signatureOf(raw.signature),
    highlight: highlightOf(raw.highlight),
  };
```

`publicStyle` becomes:

```ts
export function publicStyle(style: ReaderCardStyle): PublicReaderCardStyle {
  return { counter: style.counter, layout: style.layout, trait: style.trait, motto: style.motto, footer: style.footer, corners: style.corners, print: style.print };
}

export function resolvePrint(print: CardPrint, dark: boolean): PlatePrint {
  return print === "auto" ? (dark ? "reversed" : "paper") : print;
}
```

`labels.ts` becomes:

```ts
import type { Counter } from "./counters.js";
import type { CardPrint, CornerStyle, FooterLeft, FooterRight, Layout, MottoLook, Trait } from "./style.js";

export const COUNTER_LABELS: Record<Counter, string> = { dial: "Dial", beads: "Beads", shelf: "Shelf", frame: "Frame", ring: "Ring" };
export const TRAIT_LABELS: Record<Trait, string> = { both: "Line and seal", seal: "Seal", line: "Line", none: "None" };
export const LAYOUT_LABELS: Record<Layout, string> = { faces: "Three faces", book: "Book", merged: "One back" };
export const MOTTO_LOOK_LABELS: Record<MottoLook, string> = { ribbon: "Ribbon", scroll: "Scroll", arc: "Arc", cartouche: "Cartouche", rule: "Rule", bannerBelow: "Banner below", wavyRibbon: "Wavy ribbon", titleRules: "Title rules", dropCap: "Drop cap", sash: "Sash", script: "Script", plaque: "Plaque" };
export const FOOTER_LEFT_LABELS: Record<FooterLeft, string> = { plate: "Plate", plateName: "Plate and name", since: "Reader since", est: "Established", volumes: "Volumes", highlights: "Highlights", series: "Series", genre: "Genre", edition: "Edition", readerNumber: "Reader number", glyph: "Glyph", none: "None" };
export const FOOTER_RIGHT_LABELS: Record<FooterRight, string> = { name: "Name", firstName: "First name", lastName: "Last name", firstInitial: "First name, initial", initials: "Initials", catalog: "Catalogue", handle: "Handle", nameItalic: "Name in italics", signature: "Signature", monogram: "Monogram", monogramDiamond: "Diamond monogram", none: "None" };
export const CORNER_LABELS: Record<CornerStyle, string> = { diamonds: "Diamonds", deco: "Art deco", fleuron: "Fleuron", photo: "Photo corners", stars: "Stars", laurel: "Laurel", knot: "Knot", volute: "Volute", meander: "Meander", rosette: "Rosette", register: "Register mark", none: "None" };
export const PRINT_LABELS: Record<CardPrint, string> = { auto: "Follow theme", paper: "Paper", reversed: "Reversed" };
```

In `index.ts`, the labels line becomes:

```ts
export { CORNER_LABELS, COUNTER_LABELS, FOOTER_LEFT_LABELS, FOOTER_RIGHT_LABELS, LAYOUT_LABELS, MOTTO_LOOK_LABELS, PRINT_LABELS, TRAIT_LABELS } from "./labels.js";
```

(`style.js` is already re-exported with `export *`.)

- [ ] **Step 4: Run the shared tests**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared`
Expected: `style.test.ts` passes. Other suites that compare or build a whole style may now fail. Step 5 fixes them.

- [ ] **Step 5: Bring every whole-style literal up to date**

Find them with:

```bash
rg -n 'trait: "(both|seal|line|none)"' packages/shared/src backend/src frontend/scripts mobile/src --type ts
```

For each hit, decide what kind it is and change it:
- **Compares a whole stored style** (`DEFAULT_READER_CARD_STYLE` shape, e.g. `backend/src/modules/library/routes.test.ts` responses): add `motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto"` beside the existing fields.
- **Compares or builds a public style** (`{ counter, layout, trait }` only, e.g. `publicViews.test.ts` `card.style`, `readerCardFacts.test.ts`, `thumbnail.test.ts`, `recordPage.test.ts`, `backend/src/modules/murals/home.test.ts`, `frontend/scripts/test-reader-card.mts`): spread `publicStyle(DEFAULT_READER_CARD_STYLE)` first, e.g. `{ ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "ring", layout: "book", trait: "seal" }`. Import `publicStyle` and `DEFAULT_READER_CARD_STYLE` from the same module the file already imports shared names from.
- **Already spreads `DEFAULT_READER_CARD_STYLE`** (`save.test.ts`): leave it unchanged.

Change nothing else in those tests.

- [ ] **Step 6: Verify every package that reads the style**

Run:

```bash
npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared
npm run typecheck -w backend && npm test -w backend
npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile
```

Expected: all PASS. The renderer does not read the new fields yet.

- [ ] **Step 7: Commit**

```bash
git add packages backend frontend mobile && git commit -m "Add the reader card's motto, footer, corners and print options

The A5 decorations need a place in the stored style before anything
draws them. Each field falls back to its default on its own, so a style
saved before A5, or by an older client, keeps drawing today's card.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: The server accepts the new options

**Files:**
- Modify: `backend/src/modules/library/routes.ts`
- Test: `backend/src/modules/library/routes.test.ts`

**Interfaces:**
- Consumes: `MOTTO_LOOKS`, `MOTTO_MAX`, `FOOTER_LEFTS`, `FOOTER_RIGHTS`, `CORNER_STYLES`, `CARD_PRINTS` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append to the reader card style section of `routes.test.ts`, after `"PATCH reader card style stores a known layout"`:

```ts
test("PATCH reader card style stores a motto, both footer corners, the corners and the print", async () => {
  const { app } = await setup();
  const payload = { motto: { text: "  Per libros ad astra ", look: "arc" }, footer: { left: "since", right: "initials" }, corners: "laurel", print: "reversed" };
  const response = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.motto, { text: "Per libros ad astra", look: "arc" });
  assert.deepEqual(body.footer, { left: "since", right: "initials" });
  assert.equal(body.corners, "laurel");
  assert.equal(body.print, "reversed");
  const cleared = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { motto: null } });
  assert.equal(cleared.json().motto, null);
  assert.equal(cleared.json().corners, "laurel");
  await app.close();
});

test("PATCH reader card style rejects a bad motto, half a footer and unknown decorations", async () => {
  const { app } = await setup();
  for (const payload of [
    { motto: { text: "a".repeat(29), look: "arc" } },
    { motto: { text: "   ", look: "arc" } },
    { motto: { text: "x", look: "neon" } },
    { motto: { text: "x", look: "arc", colour: "red" } },
    { footer: { left: "since" } },
    { footer: { left: "since", right: "neon" } },
    { corners: "neon" },
    { print: "dark" },
  ]) {
    const response = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
  await app.close();
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build -w @scripta/shared && npm test -w backend`
Expected: FAIL. The strict schema rejects `motto`, `footer`, `corners` and `print`.

- [ ] **Step 3: Implement**

In `routes.ts`, the shared import becomes:

```ts
import { CARD_PRINTS, CORNER_STYLES, COUNTERS, FOOTER_LEFTS, FOOTER_RIGHTS, LAYOUTS, MOTTO_LOOKS, MOTTO_MAX, SIGNATURE_NOTE_MAX, TRAITS, type LibraryChange } from "@scripta/shared";
```

Add these lines inside `readerCardStylePatchSchema`, after `trait`:

```ts
  motto: z.object({ text: z.string().trim().min(1).max(MOTTO_MAX), look: z.enum(MOTTO_LOOKS) }).strict().nullable().optional(),
  footer: z.object({ left: z.enum(FOOTER_LEFTS), right: z.enum(FOOTER_RIGHTS) }).strict().optional(),
  corners: z.enum(CORNER_STYLES).optional(),
  print: z.enum(CARD_PRINTS).optional(),
```

The service is unchanged: `normalizeReaderCardStyle({ ...stored, ...patch })` already merges and normalises.

- [ ] **Step 4: Verify the backend**

Run: `npm run build -w @scripta/shared && npm run typecheck -w backend && npm test -w backend`
Expected: PASS. That includes the existing test that rejects `{ motto: "x" }`.

- [ ] **Step 5: Commit**

```bash
git add backend && git commit -m "Accept the reader card's motto, footer, corners and print

The schema is built from the shared option lists, so the server and the
editor offer exactly the same choices; the footer is patched whole and
the motto text is trimmed and capped at 28.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: Numerals, name parts and shrinking text

**Files:**
- Create: `packages/shared/src/readerCards/numerals.ts`
- Modify: `packages/shared/src/readerCards/fit.ts`
- Test: `packages/shared/src/readerCards/numerals.test.ts`, `packages/shared/src/readerCards/fit.test.ts`

**Interfaces:**
- Produces:

```ts
export function roman(n: number): string;
export interface NameParts { first: string; last: string | null }
export function nameParts(readerName: string): NameParts;
export function displayName(readerName: string): string;
export function fitSize(text: string, options: FitOptions & { min: number }): number;
```

- [ ] **Step 1: Write the failing tests**

Create `numerals.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { displayName, nameParts, roman } from "./numerals.js";

test("roman numerals up to 3999, and Arabic beyond or below", () => {
  assert.deepEqual([1, 4, 9, 14, 42, 48, 140, 2014, 2026, 3999].map(roman), ["I", "IV", "IX", "XIV", "XLII", "XLVIII", "CXL", "MMXIV", "MMXXVI", "MMMCMXCIX"]);
  assert.equal(roman(4000), "4000");
  assert.equal(roman(0), "0");
  assert.equal(roman(2.5), "2.5");
});

test("a username splits into first and last on dots and underscores", () => {
  assert.deepEqual(nameParts("andre.ribeiro"), { first: "andre", last: "ribeiro" });
  assert.deepEqual(nameParts("ana_maria_silva"), { first: "ana", last: "silva" });
  assert.deepEqual(nameParts("a..b"), { first: "a", last: "b" });
});

test("a single-part username has no last name", () => {
  assert.deepEqual(nameParts("andre"), { first: "andre", last: null });
  assert.deepEqual(nameParts("_andre_"), { first: "andre", last: null });
});

test("the display name capitalises each part", () => {
  assert.equal(displayName("andre.ribeiro"), "Andre Ribeiro");
  assert.equal(displayName("scripta_dev"), "Scripta Dev");
  assert.equal(displayName("andre"), "Andre");
});
```

Append to `fit.test.ts` (add `fitSize` to its `./fit.js` import):

```ts
test("fitSize keeps a size that fits and shrinks one that does not, never below the minimum", () => {
  assert.equal(fitSize("Per libros", { font: "serif", size: 8, width: 100, min: 5 }), 8);
  const shrunk = fitSize("W".repeat(28), { font: "serif", size: 8, width: 100, spacing: 0.6, min: 5 });
  assert.ok(shrunk < 8 && shrunk >= 5, String(shrunk));
  assert.ok(textWidth("W".repeat(28), { font: "serif", size: shrunk, spacing: 0.6 }) <= 100);
  assert.equal(fitLine("W".repeat(28), { font: "serif", size: shrunk, width: 100, spacing: 0.6 }), "W".repeat(28));
  assert.equal(fitSize("W".repeat(200), { font: "serif", size: 8, width: 100, min: 5 }), 5);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./numerals.js` and `fitSize` do not exist.

- [ ] **Step 3: Implement**

Create `numerals.ts`:

```ts
const ROMAN: Array<[number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  let out = "";
  let rest = n;
  for (const [value, letters] of ROMAN) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
  }
  return out;
}

export interface NameParts { first: string; last: string | null }

const partsOf = (readerName: string) => readerName.split(/[._]+/).filter(Boolean);

export function nameParts(readerName: string): NameParts {
  const parts = partsOf(readerName);
  if (parts.length < 2) return { first: parts[0] ?? readerName, last: null };
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

export function displayName(readerName: string): string {
  const parts = partsOf(readerName);
  return (parts.length ? parts : [readerName]).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
```

In `fit.ts`, add after `textWidth`:

```ts
export function fitSize(text: string, { font, size, width, spacing = 0, min }: FitOptions & { min: number }): number {
  if (textWidth(text, { font, size, spacing }) <= width) return size;
  const count = [...text].length;
  const room = width - Math.max(0, count - 1) * spacing;
  return Math.max(min, Math.floor((room / (count * EM[font])) * 100) / 100);
}
```

Letter-spacing does not scale with the font size, so the shrunk size comes from the room left after the spacing. A text shrunk this way then passes `fitLine` whole.

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Add roman numerals, username parts and text shrinking for the card

The footer prints years and counts in roman numerals and splits the
username into name parts on dots and underscores, since readers have
no real-name field; mottos shrink to their look's slot.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: The script font on both clients

**Files:**
- Modify: `packages/shared/src/readerCards/compose.ts`, `plates.ts`, `svgText.ts`, `fit.ts`
- Create: `frontend/public/fonts/pinyon-script-400.ttf`, `frontend/public/fonts/licenses/pinyonScript.txt`, `mobile/assets/fonts/pinyonScript-400.ttf`, `mobile/assets/fonts/licenses/pinyonScript.txt`
- Modify: `frontend/src/index.css`, `mobile/src/ui/fontAssets.ts`, `mobile/src/features/murals/readerCardXml.ts`, `mobile/src/features/murals/ReaderCardImage.tsx`
- Test: `mobile/src/ui/fontAssets.test.ts`, `mobile/src/features/murals/readerCardXml.test.ts`, `frontend/scripts/test-reader-card.mts`, `packages/shared/src/readerCards/fit.test.ts`

**Interfaces:**
- Produces:
  - `SCRIPT` (compose) and `PLATE_FONTS.script`
  - `TextFont` and `FitFont` both gain `"script"`
  - `CardFonts.script` (mobile)
  - `CARD_SCRIPT_FAMILY = "pinyonScript-400"` (mobile)

- [ ] **Step 1: Download the font (approved by the owner)**

```bash
curl -fL -o mobile/assets/fonts/pinyonScript-400.ttf https://github.com/google/fonts/raw/main/ofl/pinyonscript/PinyonScript-Regular.ttf
curl -fL -o mobile/assets/fonts/licenses/pinyonScript.txt https://github.com/google/fonts/raw/main/ofl/pinyonscript/OFL.txt
cp mobile/assets/fonts/pinyonScript-400.ttf frontend/public/fonts/pinyon-script-400.ttf
cp mobile/assets/fonts/licenses/pinyonScript.txt frontend/public/fonts/licenses/pinyonScript.txt
file mobile/assets/fonts/pinyonScript-400.ttf && head -3 mobile/assets/fonts/licenses/pinyonScript.txt
```

Expected: `TrueType Font data`, and the OFL header ("Copyright … The Pinyon Script Project Authors"). If either URL 404s, stop and report. Do not substitute another font.

- [ ] **Step 2: Write the failing tests**

Append to `mobile/src/ui/fontAssets.test.ts`:

```ts
test("the reader card's script font is bundled", () => {
  const source = readFileSync("src/ui/fontAssets.ts", "utf8");
  assert.ok(source.includes(`"pinyonScript-400": require("../../assets/fonts/pinyonScript-400.ttf")`));
  assert.ok(existsSync("assets/fonts/pinyonScript-400.ttf"));
  assert.ok(existsSync("assets/fonts/licenses/pinyonScript.txt"));
});
```

In `mobile/src/features/murals/readerCardXml.test.ts`, change `fonts` to `{ serif: "SERIF-X", sans: "SANS-X", mono: "MONO-X", script: "SCRIPT-X" }`, then append:

```ts
test("the script family becomes the bundled script font", () => {
  assert.equal(readerCardXml(`<text font-family="${PLATE_FONTS.script}">A</text>`, fonts), `<text font-family="SCRIPT-X">A</text>`);
});
```

Append to `frontend/scripts/test-reader-card.mts` (add `import { existsSync, readFileSync } from "node:fs";`):

```ts
test("the script font is served and declared", () => {
  assert.match(readFileSync("src/index.css", "utf8"), /font-family: "Pinyon Script";\s*src: url\("\/fonts\/pinyon-script-400\.ttf"\) format\("truetype"\);/);
  assert.ok(existsSync("public/fonts/pinyon-script-400.ttf"));
  assert.ok(existsSync("public/fonts/licenses/pinyonScript.txt"));
});
```

Append to `packages/shared/src/readerCards/fit.test.ts`:

```ts
test("script text is estimated narrower than the serif", () => {
  assert.ok(textWidth("Andre Ribeiro", { font: "script", size: 12 }) < textWidth("Andre Ribeiro", { font: "serif", size: 12 }));
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared; EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile; npm test -w frontend`
Expected: FAIL in all three.

- [ ] **Step 4: Implement**

- **`compose.ts`:** add after `MONO`:

  ```ts
  export const SCRIPT = "'Pinyon Script', 'Snell Roundhand', cursive";
  ```

- **`plates.ts`:** import `SCRIPT` beside the other font constants. `PLATE_FONTS` becomes `{ serif: SERIF, sans: SANS, mono: MONO, script: SCRIPT }`.
- **`svgText.ts`:** import `SCRIPT`, change `TextFont` to `"serif" | "sans" | "mono" | "script"`, and add `script: SCRIPT` to `FAMILIES`.
- **`fit.ts`:** `FitFont` becomes `"serif" | "sans" | "caps" | "mono" | "script"`, and `EM` gains `script: 0.42`.
- **`frontend/src/index.css`:** add after the Courier Prime `@font-face`:

  ```css
  @font-face {
    font-family: "Pinyon Script";
    src: url("/fonts/pinyon-script-400.ttf") format("truetype");
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }
  ```

- **`mobile/src/ui/fontAssets.ts`:** add `"pinyonScript-400": require("../../assets/fonts/pinyonScript-400.ttf"),` after `courierPrime-400`, and `export const CARD_SCRIPT_FAMILY = "pinyonScript-400";` after `CARD_MONO_FAMILY`.
- **`mobile/src/features/murals/readerCardXml.ts`:**

  ```ts
  export interface CardFonts { serif: string; sans: string; mono: string; script: string }

  export function readerCardXml(svg: string, fonts: CardFonts): string {
    return svg.replaceAll(PLATE_FONTS.serif, fonts.serif).replaceAll(PLATE_FONTS.sans, fonts.sans).replaceAll(PLATE_FONTS.mono, fonts.mono).replaceAll(PLATE_FONTS.script, fonts.script).replaceAll("&lt;", "<![CDATA[<]]>").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  }
  ```

- **`mobile/src/features/murals/ReaderCardImage.tsx`:** import `CARD_SCRIPT_FAMILY` beside `CARD_MONO_FAMILY`, and add `script: CARD_SCRIPT_FAMILY` to the fonts object.

- [ ] **Step 5: Verify all three packages**

Run:

```bash
npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared
npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend
EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src frontend/public/fonts frontend/src/index.css frontend/scripts mobile/assets/fonts mobile/src && git commit -m "Bundle Pinyon Script for the reader card's script lettering

The script motto and the signature footer need a calligraphic face that
draws the same on web and Android, which has no system script font; the
SVG names it once and mobile maps it to the bundled asset.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5: Corner ornaments

**Files:**
- Create: `packages/shared/src/readerCards/corners.ts`
- Modify: `packages/shared/src/readerCards/render.ts`
- Test: `packages/shared/src/readerCards/corners.test.ts`

**Interfaces:**
- Produces: `cornersSlot(corners: CornerStyle): string | undefined`. It returns `undefined` for `diamonds` (the compose default) and `""` for `none`.
- `render.ts` gains a `decorations(input, print): PlateSlots` that `renderReaderCard` uses on the front and every back page. Task 6 extends it.

- [ ] **Step 1: Write the failing tests**

Create `corners.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { cornersSlot } from "./corners.js";
import { renderReaderCard } from "./render.js";
import { seedOf } from "./seed.js";
import { CORNER_STYLES, DEFAULT_READER_CARD_STYLE, publicStyle, type CornerStyle } from "./style.js";

const card: PublicReaderCard = { state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: [], dial: { segments: [{ group: "star", books: 8, marked: 2 }] }, facts: { finished: 8, highlights: 2, series: 0, since: 2014, edition: 2026 } };
const render = (corners: CornerStyle, page: "front" | "record" = "front") => renderReaderCard({ card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), corners }, readerName: "andre", print: "paper", label: "x", seed: seedOf("andre") }, page);

test("diamonds draw today's corners and none draws no corners", () => {
  assert.equal(cornersSlot("diamonds"), undefined);
  assert.equal(cornersSlot("none"), "");
  assert.match(render("diamonds"), /M16 11\.5L20\.5 16L16 20\.5L11\.5 16Z/);
  assert.doesNotMatch(render("none"), /M16 11\.5/);
});

test("every ornament draws in all four corners, mirrored", () => {
  for (const corners of CORNER_STYLES.filter((key) => key !== "diamonds" && key !== "none")) {
    const svg = cornersSlot(corners)!;
    assert.ok(svg.length > 0, corners);
    assert.doesNotMatch(svg, /NaN|undefined/, corners);
  }
  assert.match(cornersSlot("deco")!, /M22 38V22H38M26 32V26H32.*M228 38V22H212M224 32V26H218.*M22 312V328H38.*M228 312V328H212/s);
  assert.match(cornersSlot("photo")!, /M10 10L38 10L10 38Z.*M240 10L212 10L240 38Z.*M10 340L38 340L10 312Z.*M240 340L212 340L240 312Z/s);
  assert.match(cornersSlot("register")!, /M8 16H24M16 8V24.*M226 16H242M234 8V24.*M8 334H24M16 326V342.*M226 334H242M234 326V342/s);
  assert.match(cornersSlot("laurel")!, /M46 19Q21 21 19 46.*M204 19Q229 21 231 46/s);
  assert.equal(cornersSlot("rosette")!.match(/<ellipse /g)?.length, 32);
});

test("a chosen ornament replaces the diamonds on the front and on the back pages", () => {
  for (const page of ["front", "record"] as const) {
    const svg = render("laurel", page);
    assert.doesNotMatch(svg, /M16 11\.5/, page);
    assert.match(svg, /M46 19Q21 21 19 46/, page);
  }
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./corners.js` does not exist.

- [ ] **Step 3: Implement**

Create `corners.ts`:

```ts
import type { CornerStyle } from "./style.js";

type Draw = (sx: number, sy: number, cx: number, cy: number) => string;

const n = (value: number) => +value.toFixed(2);
const CORNERS: ReadonlyArray<readonly [number, number, number, number]> = [[16, 16, 1, 1], [234, 16, -1, 1], [16, 334, 1, -1], [234, 334, -1, -1]];
const at = (draw: Draw) => CORNERS.map(([cx, cy, sx, sy]) => draw(sx, sy, cx, cy)).join("");
const star4 = (x: number, y: number, r: number, k = 0.24) => `M${n(x)} ${n(y - r)}L${n(x + r * k)} ${n(y - r * k)}L${n(x + r)} ${n(y)}L${n(x + r * k)} ${n(y + r * k)}L${n(x)} ${n(y + r)}L${n(x - r * k)} ${n(y + r * k)}L${n(x - r)} ${n(y)}L${n(x - r * k)} ${n(y - r * k)}Z`;

const DRAW: Record<Exclude<CornerStyle, "diamonds" | "none">, Draw> = {
  deco: (sx, sy, cx, cy) => `<path class="pl" d="M${cx + 6 * sx} ${cy + 22 * sy}V${cy + 6 * sy}H${cx + 22 * sx}M${cx + 10 * sx} ${cy + 16 * sy}V${cy + 10 * sy}H${cx + 16 * sx}" stroke-width=".9"/><rect class="pf" x="${cx + (sx > 0 ? 2 : -5)}" y="${cy + (sy > 0 ? 2 : -5)}" width="3" height="3"/>`,
  fleuron: (sx, sy, cx, cy) => `<circle class="pf" cx="${cx + 7 * sx}" cy="${cy + 7 * sy}" r="2.6"/><path class="pf" d="M${cx + 10 * sx} ${cy + 7 * sy}Q${cx + 20 * sx} ${cy + 3 * sy} ${cx + 26 * sx} ${cy + 8 * sy}Q${cx + 18 * sx} ${cy + 11 * sy} ${cx + 10 * sx} ${cy + 7 * sy}ZM${cx + 7 * sx} ${cy + 10 * sy}Q${cx + 3 * sx} ${cy + 20 * sy} ${cx + 8 * sx} ${cy + 26 * sy}Q${cx + 11 * sx} ${cy + 18 * sy} ${cx + 7 * sx} ${cy + 10 * sy}Z" opacity=".85"/>`,
  photo: (sx, sy) => {
    const x0 = sx > 0 ? 10 : 240, y0 = sy > 0 ? 10 : 340;
    return `<path class="pf" d="M${x0} ${y0}L${x0 + 28 * sx} ${y0}L${x0} ${y0 + 28 * sy}Z"/><path class="pgs" d="M${x0 + 22 * sx} ${n(y0 + 2.5 * sy)}L${n(x0 + 2.5 * sx)} ${y0 + 22 * sy}" stroke-width=".7"/>`;
  },
  stars: (sx, sy, cx, cy) => `<path class="pf" d="${star4(cx, cy, 7)}"/><path class="pf" d="${star4(cx + 14 * sx, cy, 2.6)}${star4(cx, cy + 14 * sy, 2.6)}"/>`,
  laurel: (sx, sy, cx, cy) => {
    const A = [cx + 30 * sx, cy + 3 * sy], C = [cx + 5 * sx, cy + 5 * sy], B = [cx + 3 * sx, cy + 30 * sy];
    const q = (t: number, k: 0 | 1) => (1 - t) ** 2 * A[k]! + 2 * (1 - t) * t * C[k]! + t * t * B[k]!;
    const dq = (t: number, k: 0 | 1) => 2 * (1 - t) * (C[k]! - A[k]!) + 2 * t * (B[k]! - C[k]!);
    let leaves = "";
    for (const t of [0.12, 0.26, 0.4, 0.6, 0.74, 0.88]) {
      const x = n(q(t, 0)), y = n(q(t, 1)), angle = (Math.atan2(dq(t, 1), dq(t, 0)) * 180) / Math.PI;
      for (const side of [-1, 1]) leaves += `<ellipse class="pf" cx="${x}" cy="${y}" rx="3" ry="1.15" transform="rotate(${(angle + side * 38).toFixed(1)} ${x} ${y}) translate(2.4 0)"/>`;
    }
    return `<path class="pl" d="M${A[0]} ${A[1]}Q${C[0]} ${C[1]} ${B[0]} ${B[1]}" stroke-width=".7"/>${leaves}<circle class="pf" cx="${cx}" cy="${cy}" r="1.6"/>`;
  },
  knot: (sx, sy, cx, cy) => {
    const x = cx + 5 * sx, y = cy + 5 * sy;
    return `<circle class="pg" cx="${cx}" cy="${cy}" r="9"/><ellipse class="pl" cx="${x}" cy="${y}" rx="8" ry="3.2" transform="rotate(45 ${x} ${y})" stroke-width="1"/><ellipse class="pl" cx="${x}" cy="${y}" rx="8" ry="3.2" transform="rotate(-45 ${x} ${y})" stroke-width="1"/><circle class="pf" cx="${x}" cy="${y}" r="1.3"/>`;
  },
  volute: (sx, sy, cx, cy) => {
    const p = (u: number, v: number) => `${n(cx + u * sx)} ${n(cy + v * sy)}`;
    const sweep = sx * sy > 0 ? 0 : 1;
    return `<path class="pl" d="M${p(28, 3)}Q${p(10, 3)} ${p(8, 8)}A4 4 0 1 ${sweep} ${p(13, 11)}A2 2 0 1 ${sweep} ${p(10, 8.5)}M${p(3, 28)}Q${p(3, 10)} ${p(8, 8)}" stroke-width=".9" stroke-linecap="round"/>`;
  },
  meander: (sx, sy, cx, cy) => {
    const p = (u: number, v: number) => `${cx + u * sx} ${cy + v * sy}`;
    return `<path class="pl" d="M${p(2, 26)}V${cy + 2 * sy}H${cx + 26 * sx}M${p(6, 22)}V${cy + 6 * sy}H${cx + 22 * sx}V${cy + 14 * sy}H${cx + 14 * sx}V${cy + 10 * sy}H${cx + 18 * sx}" stroke-width=".8" stroke-linejoin="miter"/>`;
  },
  rosette: (_sx, _sy, cx, cy) => {
    let petals = "";
    for (let k = 0; k < 8; k++) petals += `<ellipse class="pf" cx="${n(cx + 3.6)}" cy="${cy}" rx="3.2" ry="1.25" transform="rotate(${k * 45} ${cx} ${cy})"/>`;
    return `<circle class="pg" cx="${cx}" cy="${cy}" r="7.6"/>${petals}<circle class="pg" cx="${cx}" cy="${cy}" r="1.3"/>`;
  },
  register: (_sx, _sy, cx, cy) => `<circle class="pgl" cx="${cx}" cy="${cy}" r="5.5" stroke-width=".7"/><circle class="pl" cx="${cx}" cy="${cy}" r="2.4" stroke-width=".5"/><path class="pl" d="M${cx - 8} ${cy}H${cx + 8}M${cx} ${cy - 8}V${cy + 8}" stroke-width=".5"/>`,
};

export function cornersSlot(corners: CornerStyle): string | undefined {
  if (corners === "diamonds") return undefined;
  if (corners === "none") return "";
  return at(DRAW[corners]);
}
```

In `render.ts`:
- Import `cornersSlot` from `./corners.js`.
- Add this before `renderReaderCard`:

```ts
function decorations(input: ReaderCardInput, _print: PlatePrint): PlateSlots {
  const corners = cornersSlot(input.style.corners);
  return corners === undefined ? {} : { corners };
}
```

In `renderReaderCard`:
- Pass `decorations(input, print)` as the third argument of each of the three `composePage(...)` calls.
- Change `const slots: PlateSlots = {};` to `const slots: PlateSlots = decorations(input, print);`.

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS. This includes the byte-identity tests in `readerCard.test.ts` and `plates.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Draw the reader card's corner ornaments

Eleven ornaments mirrored into the four frame corners, on the front and
the back pages; diamonds stays the compose default so a card that keeps
it is byte-identical to before.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6: Footer values

**Files:**
- Create: `packages/shared/src/readerCards/footer.ts`
- Modify: `packages/shared/src/readerCards/render.ts`, `packages/shared/src/library/readerCardFacts.ts`, `packages/shared/src/readerCards/index.ts`
- Test: `packages/shared/src/readerCards/footer.test.ts`, `packages/shared/src/library/readerCardFacts.test.ts`

**Interfaces:**
- Consumes: `roman`, `nameParts`, `displayName` (Task 3), `SCRIPT` (Task 4), `GROUP_LABELS` (`pages.ts`).
- Produces:

```ts
export const GENRE_LEADS: ReadonlySet<string>;          // moved from render.ts
export const truncateName: (name: string) => string;     // moved from render.ts
export interface FooterContext { card: PublicReaderCard; readerName: string; glyph: (key: IdentityKey, x: number, y: number, size: number) => string }
export function footerSlots(footer: CardFooter, ctx: FooterContext): Pick<PlateSlots, "footerLeft" | "footerRight">;
// ReaderCardFacts.facts gains readerNumber?: number
// OwnCardStyle gains readerNumber?: number | null
```

- [ ] **Step 1: Write the failing tests**

Create `footer.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { footerSlots, type FooterContext } from "./footer.js";
import { renderReaderCard } from "./render.js";
import { seedOf } from "./seed.js";
import { DEFAULT_READER_CARD_STYLE, publicStyle, type CardFooter, type FooterLeft, type FooterRight } from "./style.js";

const card = (fields: Partial<PublicReaderCard> = {}): PublicReaderCard => ({
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: [],
  dial: { segments: [{ group: "star", books: 40, marked: 9 }, { group: "lamp", books: 8, marked: 1 }] },
  facts: { finished: 48, highlights: 140, series: 12, since: 2014, edition: 2026, readerNumber: 42 },
  ...fields,
});
const ctx = (fields: Partial<PublicReaderCard> = {}, readerName = "andre.ribeiro"): FooterContext => ({ card: card(fields), readerName, glyph: (key, x, y, size) => `<g data-glyph="${key} ${x} ${y} ${size}"/>` });
const left = (value: FooterLeft, fields: Partial<PublicReaderCard> = {}) => footerSlots({ left: value, right: "name" }, ctx(fields, "andre")).footerLeft;
const right = (value: FooterRight, readerName = "andre.ribeiro") => footerSlots({ left: "plate", right: value }, ctx({}, readerName)).footerRight;
const text = (svg: string | undefined) => svg?.match(/>([^<]*)<\/text>/)?.[1];

test("the default corners leave the compose defaults in place", () => {
  assert.deepEqual(footerSlots({ left: "plate", right: "name" }, ctx()), {});
});

test("each left value prints its fact", () => {
  assert.equal(text(left("plateName")), "IV · STARGAZER");
  assert.equal(text(left("since")), "READER SINCE 2014");
  assert.equal(text(left("est")), "EST. MMXIV");
  assert.equal(text(left("volumes")), "XLVIII VOLUMES");
  assert.equal(text(left("volumes", { facts: { finished: 1, highlights: 0, series: 0, since: null, edition: 2026 } })), "I VOLUME");
  assert.equal(text(left("highlights")), "CXL HIGHLIGHTS");
  assert.equal(text(left("series")), "XII SERIES");
  assert.equal(text(left("genre")), "FANTASY &amp; SF");
  assert.equal(text(left("edition")), "EDITION MMXXVI");
  assert.equal(text(left("readerNumber")), "Nº XLII");
  assert.equal(left("glyph"), `<g data-glyph="star 29 310.5 14"/>`);
  assert.equal(left("none"), "");
});

test("an unavailable value falls back to the corner's default", () => {
  const none = { facts: { finished: 0, highlights: 0, series: 0, since: null, edition: 2026 } };
  for (const value of ["since", "est", "volumes", "highlights", "series", "readerNumber"] as const) assert.equal(left(value, none), undefined, value);
  assert.equal(left("genre", { identity: "anno" }), undefined);
  assert.equal(left("genre", { dial: { segments: [{ group: "lamp", books: 3, marked: 0 }] } }), undefined);
  for (const value of ["plateName", "glyph", "genre"] as const) assert.equal(left(value, { state: "unwritten", identity: null }), undefined, value);
  assert.equal(left("edition", { facts: undefined }), undefined);
});

test("each right value prints the username's parts", () => {
  assert.equal(text(right("firstName")), "ANDRE");
  assert.equal(text(right("lastName")), "RIBEIRO");
  assert.equal(text(right("firstInitial")), "ANDRE R.");
  assert.equal(text(right("initials")), "A. R.");
  assert.equal(text(right("catalog")), "RIBEIRO, A.");
  assert.equal(text(right("handle")), "@ANDRE.RIBEIRO");
  assert.match(right("nameItalic")!, /font-style="italic" font-family="'Playfair Display'[^"]*">Andre Ribeiro</);
  assert.match(right("signature")!, /font-family="'Pinyon Script'[^"]*">Andre Ribeiro</);
  assert.match(right("monogram")!, /<circle class="pl" cx="214" cy="318" r="7.5".*>AR<\/text>/);
  assert.match(right("monogramDiamond")!, /M214 309L223 318L214 327L205 318Z.*>AR<\/text>/);
  assert.equal(right("none"), "");
});

test("a single-part username falls back to the name for its missing parts", () => {
  for (const value of ["firstName", "lastName", "firstInitial", "initials", "catalog"] as const) assert.equal(right(value, "andre"), undefined, value);
  assert.match(right("monogram", "andre")!, />A<\/text>/);
  assert.equal(text(right("handle", "andre")), "@ANDRE");
});

test("a 30-character handle is cut to its corner and the left value gives way to a wide right", () => {
  const handle = text(right("handle", "a".repeat(30)))!;
  assert.ok(handle.endsWith("…"), handle);
  const slots = footerSlots({ left: "edition", right: "handle" }, ctx({}, "a".repeat(30)));
  assert.ok(text(slots.footerLeft)!.endsWith("…"));
});

test("the chosen footer draws on the front and on every back page", () => {
  const footer: CardFooter = { left: "since", right: "initials" };
  for (const page of ["front", "chosen", "record", "merged"] as const) {
    const svg = renderReaderCard({ card: card(), style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), footer }, readerName: "andre.ribeiro", print: "paper", label: "x", seed: seedOf("andre"), view: "owner" }, page);
    assert.match(svg, />READER SINCE 2014</, page);
    assert.match(svg, />A\. R\.</, page);
    assert.doesNotMatch(svg, />PLATE IV</, page);
  }
});

test("the glyph footer is the identity's glyph, inked like the seal", () => {
  const svg = renderReaderCard({ card: card(), style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), footer: { left: "glyph", right: "name" } }, readerName: "andre", print: "paper", label: "x", seed: seedOf("andre") });
  assert.match(svg, /<g class="glyph id-star" transform="translate\(29.00 310.50\) scale\(0.2917\)">/);
});
```

Append to `packages/shared/src/library/readerCardFacts.test.ts`:

```ts
test("the owner's reader number joins the facts only when given", () => {
  const books = Array.from({ length: 6 }, (_, i) => book(i, { _genres: ["Fantasy"] }));
  const style = { ...DEFAULT_READER_CARD_STYLE, footer: { left: "readerNumber", right: "name" } } as const;
  assert.equal(readerCardInputOf(books, [], "andre", undefined, { style, coverOf: () => null, readerNumber: 42 }).card.facts?.readerNumber, 42);
  assert.equal("readerNumber" in readerCardInputOf(books, [], "andre", undefined, { style, coverOf: () => null }).card.facts!, false);
  assert.equal("readerNumber" in readerCardInputOf(books, [], "andre", undefined, { style, coverOf: () => null, readerNumber: null }).card.facts!, false);
});
```

(Add `DEFAULT_READER_CARD_STYLE` to that file's imports if it is not already there.)

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `./footer.js` does not exist and `readerNumber` is ignored.

- [ ] **Step 3: Implement**

Create `footer.ts`:

```ts
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { SANS, SCRIPT, SERIF, type PlateSlots } from "./compose.js";
import { fitLine, textWidth } from "./fit.js";
import { displayName, nameParts, roman } from "./numerals.js";
import { GROUP_LABELS } from "./pages.js";
import { PLATES, type IdentityKey } from "./plates.js";
import type { CardFooter, FooterLeft, FooterRight } from "./style.js";
import { escapeText } from "./svgText.js";

export const GENRE_LEADS: ReadonlySet<string> = new Set(["lamp", "star", "arch", "corr"]);
export const truncateName = (name: string) => (name.length > 16 ? `${name.slice(0, 16)}…` : name);

export interface FooterContext { card: PublicReaderCard; readerName: string; glyph: (key: IdentityKey, x: number, y: number, size: number) => string }

const ROOM = 190;
const GAP = 12;
const MIN_LEFT = 40;
const MAX_RIGHT = 100;
const CAPS = { font: "caps", size: 7.5, spacing: 1.8 } as const;

const caps = (text: string, x: number, end: boolean, width: number) =>
  `<text class="pt" x="${x}" y="321"${end ? ` text-anchor="end"` : ""} font-size="7.5" letter-spacing="1.8" font-family="${SANS}" font-weight="600">${escapeText(fitLine(text, { ...CAPS, width }))}</text>`;
const plateOf = (card: PublicReaderCard) => (card.state !== "unwritten" && card.identity ? PLATES.find((plate) => plate.key === card.identity) : undefined);
const counted = (n: number | undefined, one: string, many: string) => (n ? `${roman(n)} ${n === 1 ? one : many}` : null);
const initial = (word: string) => [...word][0] ?? "";

function leftText(value: FooterLeft, card: PublicReaderCard): string | null {
  const facts = card.facts;
  const plate = plateOf(card);
  switch (value) {
    case "plateName": return plate ? `${plate.numeral} · ${plate.name.toUpperCase()}` : null;
    case "since": return facts?.since ? `READER SINCE ${facts.since}` : null;
    case "est": return facts?.since ? `EST. ${roman(facts.since)}` : null;
    case "volumes": return counted(facts?.finished, "VOLUME", "VOLUMES");
    case "highlights": return counted(facts?.highlights, "HIGHLIGHT", "HIGHLIGHTS");
    case "series": return counted(facts?.series, "SERIES", "SERIES");
    case "genre": {
      const lead = plate && GENRE_LEADS.has(plate.key) ? card.dial?.segments.find((segment) => segment.group === plate.key) : undefined;
      return lead ? GROUP_LABELS[lead.group].toUpperCase() : null;
    }
    case "edition": return facts?.edition ? `EDITION ${roman(facts.edition)}` : null;
    case "readerNumber": return facts?.readerNumber ? `Nº ${roman(facts.readerNumber)}` : null;
    default: return null;
  }
}

function leftSlot(value: FooterLeft, ctx: FooterContext, width: number): string | undefined {
  if (value === "none") return "";
  if (value === "glyph") {
    const plate = plateOf(ctx.card);
    return plate ? ctx.glyph(plate.key, 29, 310.5, 14) : undefined;
  }
  const text = leftText(value, ctx.card);
  return text ? caps(text, 30, false, width) : undefined;
}

interface Right { svg?: string; width: number }

function rightSlot(value: FooterRight, readerName: string): Right {
  const { first, last } = nameParts(readerName);
  const F = first.toUpperCase();
  const L = last?.toUpperCase() ?? null;
  const monogram = escapeText(`${initial(F)}${L ? initial(L) : ""}`);
  const text = (content: string): Right => {
    const shown = fitLine(content, { ...CAPS, width: MAX_RIGHT });
    return { svg: caps(shown, 220, true, MAX_RIGHT), width: textWidth(shown, CAPS) };
  };
  switch (value) {
    case "firstName": if (L) return text(F); break;
    case "lastName": if (L) return text(L); break;
    case "firstInitial": if (L) return text(`${F} ${initial(L)}.`); break;
    case "initials": if (L) return text(`${initial(F)}. ${initial(L)}.`); break;
    case "catalog": if (L) return text(`${L}, ${initial(F)}.`); break;
    case "handle": return text(`@${readerName.toUpperCase()}`);
    case "nameItalic": {
      const shown = fitLine(displayName(readerName), { font: "serif", size: 9, width: MAX_RIGHT });
      return { svg: `<text class="pt" x="220" y="321" text-anchor="end" font-size="9" font-style="italic" font-family="${SERIF}">${escapeText(shown)}</text>`, width: textWidth(shown, { font: "serif", size: 9 }) };
    }
    case "signature": {
      const shown = fitLine(displayName(readerName), { font: "script", size: 12, width: MAX_RIGHT });
      return { svg: `<text class="pt" x="221" y="323" text-anchor="end" font-size="12" font-family="${SCRIPT}">${escapeText(shown)}</text>`, width: textWidth(shown, { font: "script", size: 12 }) };
    }
    case "monogram": return { svg: `<circle class="pl" cx="214" cy="318" r="7.5" stroke-width=".8"/><circle class="pl" cx="214" cy="318" r="6" stroke-width=".35"/><text class="pt" x="214" y="320.4" text-anchor="middle" font-size="6.4" font-family="${SERIF}">${monogram}</text>`, width: 16 };
    case "monogramDiamond": return { svg: `<path class="pl" d="M214 309L223 318L214 327L205 318Z" stroke-width=".8"/><text class="pt" x="214" y="320.3" text-anchor="middle" font-size="6" font-family="${SERIF}">${monogram}</text>`, width: 18 };
    case "none": return { svg: "", width: 0 };
  }
  return { width: textWidth(truncateName(readerName).toUpperCase(), CAPS) };
}

export function footerSlots(footer: CardFooter, ctx: FooterContext): Pick<PlateSlots, "footerLeft" | "footerRight"> {
  const right = rightSlot(footer.right, ctx.readerName);
  const left = leftSlot(footer.left, ctx, Math.max(MIN_LEFT, ROOM - right.width - GAP));
  return { ...(left === undefined ? {} : { footerLeft: left }), ...(right.svg === undefined ? {} : { footerRight: right.svg }) };
}
```

In `render.ts`:
- Import `footerSlots, GENRE_LEADS, truncateName` from `./footer.js`.
- Delete the local `truncateName` and `GENRE_LEADS` definitions.
- Replace `sealSlot` and `decorations` with:

```ts
function glyphAt(key: IdentityKey, x: number, y: number, size: number, print: PlatePrint): string {
  return `<g class="glyph id-${key}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(size / 48).toFixed(4)})">${withStyle(glyphBody(key), inks(key, print))}</g>`;
}

function sealSlot(streak: IdentityKey, print: PlatePrint): string {
  const rad = (SEAL_ANGLE * Math.PI) / 180;
  const cx = 125 + SEAL_RADIUS * Math.sin(rad), cy = 134 - SEAL_RADIUS * Math.cos(rad);
  return `<circle class="pg" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${SEAL_SIZE / 2 + 2.5}"/>${glyphAt(streak, cx - SEAL_SIZE / 2, cy - SEAL_SIZE / 2, SEAL_SIZE, print)}`;
}

function decorations(input: ReaderCardInput, print: PlatePrint): PlateSlots {
  const corners = cornersSlot(input.style.corners);
  const footer = footerSlots(input.style.footer, { card: input.card, readerName: input.readerName, glyph: (key, x, y, size) => glyphAt(key, x, y, size, print) });
  return { ...(corners === undefined ? {} : { corners }), ...footer };
}
```

In `packages/shared/src/library/readerCardFacts.ts`:
- In `ReaderCardFacts`, `facts` becomes `{ finished: number; highlights: number; series: number; since: number | null; edition: number; readerNumber?: number }`.
- `OwnCardStyle` becomes `export interface OwnCardStyle { style: ReaderCardStyle; coverOf: CoverOf; readerNumber?: number | null }`.
- In `readerCardInputOf`'s owner branch, replace the `card` line with:

```ts
  const facts = readerCardFacts(books, groups, identity.identity);
  const card: PublicReaderCard = { ...publicReaderCard(identity), ...facts, ...(own?.readerNumber ? { facts: { ...facts.facts, readerNumber: own.readerNumber } } : {}), ...(own ? { chosen: ownChosen(books, own.style, own.coverOf) } : {}) };
```

In `readerCards/index.ts`, add `export { roman, nameParts, displayName } from "./numerals.js";`.

- [ ] **Step 4: Run the shared tests and every consumer's typecheck**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared && npm run typecheck -w frontend && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile`
Expected: PASS. The seal markup is unchanged: `readerCard.test.ts` still matches `translate(157.25 166.25) scale(0.5417)`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src && git commit -m "Draw the reader card's chosen footer values

Each corner prints its fact in the card's capitals, or the glyph or a
monogram, and falls back to its default when the fact is missing; the
right value is fitted first and the left gets what is left of the line.
The owner's reader number joins the locally computed facts.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7: Mottos

**Files:**
- Create: `packages/shared/src/readerCards/mottos.ts`
- Modify: `packages/shared/src/readerCards/compose.ts`, `render.ts`, `pages.ts` (`readerCardSummary`), `portable.test.ts`
- Test: `packages/shared/src/readerCards/mottos.test.ts`, `compose.test.ts`, `summary.test.ts`, `portable.test.ts`

**Interfaces:**
- Consumes: `fitSize` (Task 3), `SCRIPT`/`"script"` (Task 4), `svgText` (`svgText.ts`).
- Produces:
  - `EX_LIBRIS` (compose, the default header string)
  - `PlateSlots.banner` (drawn after the seal)
  - `LIFTED_EX_LIBRIS`
  - `mottoSlots(motto: CardMotto | null, id: string): Pick<PlateSlots, "header" | "banner">`
  - The motto element id is `rc-<look>-<seed>-<print>`.

- [ ] **Step 1: Write the failing tests**

Create `mottos.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { EX_LIBRIS } from "./compose.js";
import { LIFTED_EX_LIBRIS, mottoSlots } from "./mottos.js";
import { renderReaderCard } from "./render.js";
import { seedOf } from "./seed.js";
import { DEFAULT_READER_CARD_STYLE, MOTTO_LOOKS, publicStyle, type MottoLook } from "./style.js";

const WORDS = "Per libros ad astra";
const card: PublicReaderCard = { state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: [], dial: { segments: [{ group: "star", books: 8, marked: 2 }] }, facts: { finished: 8, highlights: 2, series: 0, since: 2014, edition: 2026 } };
const front = (look: MottoLook, text = WORDS) => renderReaderCard({ card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), motto: { text, look } }, readerName: "andre", print: "paper", label: "x", seed: seedOf("andre") });
const sizes = (svg: string) => [...svg.matchAll(/font-size="([\d.]+)"/g)].map((match) => Number(match[1]));

test("no motto keeps today's header", () => {
  assert.deepEqual(mottoSlots(null, "rc-x-1-paper"), {});
});

test("every look but the banner and the sash lifts EX LIBRIS above the motto", () => {
  for (const look of MOTTO_LOOKS) {
    const slots = mottoSlots({ text: WORDS, look }, `rc-${look}-1-paper`);
    if (look === "bannerBelow") {
      assert.equal(slots.header, undefined);
      assert.ok(slots.banner!.length > 0);
    } else if (look === "sash") {
      assert.ok(slots.header!.startsWith(EX_LIBRIS));
    } else {
      assert.ok(slots.header!.startsWith(LIFTED_EX_LIBRIS), look);
    }
  }
});

test("every look prints the motto on the front", () => {
  for (const look of MOTTO_LOOKS) {
    const svg = front(look);
    if (look === "titleRules") assert.match(svg, />PER LIBROS AD ASTRA</, look);
    else if (look === "dropCap") assert.match(svg, />P<\/text>.*>er libros ad astra</s, look);
    else assert.match(svg, />Per libros ad astra</, look);
  }
});

test("arc and wavy ribbon put the text on a path whose id is unique to the look and print, centred by offset", () => {
  for (const look of ["arc", "wavyRibbon"] as const) {
    const slots = mottoSlots({ text: WORDS, look }, `rc-${look}-7-reversed`);
    assert.match(slots.header!, new RegExp(`<path id="rc-${look}-7-reversed" d="M`));
    assert.match(slots.header!, new RegExp(`<textPath href="#rc-${look}-7-reversed" startOffset="[\\d.]+">Per libros ad astra</textPath>`));
    assert.doesNotMatch(slots.header!, /text-anchor="middle"><textPath|<textPath[^>]*text-anchor/);
  }
  const paper = front("arc");
  assert.match(paper, new RegExp(`id="rc-arc-${seedOf("andre")}-paper"`));
});

test("a long motto stays inside every look: it shrinks, never below 5, then cuts", () => {
  for (const look of MOTTO_LOOKS) {
    const slots = mottoSlots({ text: "W".repeat(28), look }, `rc-${look}-1-paper`);
    const svg = `${slots.header ?? ""}${slots.banner ?? ""}`;
    assert.ok(sizes(svg).every((size) => size >= 5), look);
    assert.doesNotMatch(svg, /NaN|undefined/, look);
  }
});

test("motto text is escaped", () => {
  for (const look of MOTTO_LOOKS) {
    const slots = mottoSlots({ text: `<b>"x" & y</b>`, look }, `rc-${look}-1-paper`);
    const svg = `${slots.header ?? ""}${slots.banner ?? ""}`;
    assert.doesNotMatch(svg, /<b>|<\/b>/, look);
    assert.match(svg, /&lt;|&amp;/, look);
  }
});

test("the banner draws below the emblem, after the seal", () => {
  const svg = front("bannerBelow");
  assert.ok(svg.indexOf("M80 197.5H170V210.5H80Z") > svg.indexOf(`class="glyph id-lamp`));
  assert.match(svg, />EX LIBRIS</);
});
```

In `compose.test.ts`, extend `"slots land in layer order"`:
- Add `banner: \`<g id="b"/>\`` to the slots object.
- Add the assertion `assert.ok(at(\`id="s"\`) < at(\`id="b"\`) && at(\`id="b"\`) < at(">THE<"));`.

Append to `summary.test.ts`:

```ts
test("the motto is read out after the plate", () => {
  const lines = readerCardSummary(base({ style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), motto: { text: "Per libros ad astra", look: "arc" } } }));
  assert.equal(lines[1], "Motto: “Per libros ad astra”.");
});
```

(Import `DEFAULT_READER_CARD_STYLE` and `publicStyle` in `summary.test.ts` if they are not already imported. `base` is that file's input builder.)

In `portable.test.ts`, replace the `id` and `href` checks in `portabilityProblems`, and add the textPath reference rule:

```ts
function portabilityProblems(svg: string): string[] {
  const problems: string[] = [];
  let remoteImages = 0;
  const ids = [...svg.matchAll(/ id="([^"]*)"/g)].map((match) => match[1]!);
  if (new Set(ids).size !== ids.length) problems.push("duplicate id");
  for (const [, name, attrs] of svg.matchAll(/<([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    if (!ELEMENTS.has(name!)) problems.push(`<${name}>`);
    for (const [, attr, value] of attrs!.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      if (attr === "class" && !/^(plate|glyph) id-/.test(value!)) problems.push(`class="${value}"`);
      if (attr === "style" && value!.includes("mix-blend-mode")) problems.push("mix-blend-mode");
      const remote = (attr === "href" || attr === "xlink:href") && name === "image" && /^https:\/\/[^\s"'<>&\\]+$/.test(value!);
      const local = attr === "href" && name === "textPath" && value!.startsWith("#") && ids.includes(value!.slice(1));
      if (remote) remoteImages++;
      if ((attr === "href" || attr === "xlink:href") && !value!.startsWith("data:") && !remote && !local) problems.push(`${attr}="${value!.slice(0, 40)}"`);
      if (attr === "id" && !/^rc-[a-zA-Z]+-\d+-(paper|reversed)$/.test(value!)) problems.push(`id="${value}"`);
    }
  }
  if ((svg.match(/<svg\b/g) ?? []).length !== 1) problems.push("nested <svg>");
  if (remoteImages > 1) problems.push("more than one remote image");
  if (/url\(\s*['"]?#/.test(svg)) problems.push("url(#…)");
  if (/NaN|Infinity/.test(svg)) problems.push("NaN");
  return problems;
}
```

Append to `portable.test.ts`:

```ts
test("the guard allows only card ids and textPath references to them", () => {
  const ok = `<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="rc-arc-1-paper" d="M0 0"/></defs><text><textPath href="#rc-arc-1-paper">a</textPath></text></svg>`;
  assert.deepEqual(portabilityProblems(ok), []);
  assert.deepEqual(portabilityProblems(ok.replace(`href="#rc-arc-1-paper"`, `href="#elsewhere"`)), [`href="#elsewhere"`]);
  assert.ok(portabilityProblems(ok.replaceAll("rc-arc-1-paper", "x")).includes(`id="x"`));
  assert.ok(portabilityProblems(ok.replace("</defs>", `<path id="rc-arc-1-paper" d="M1 1"/></defs>`)).includes("duplicate id"));
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL. `./mottos.js`, `EX_LIBRIS`, the banner slot and the summary line do not exist.

- [ ] **Step 3: Implement**

In `compose.ts`:
- Add after the font constants:

  ```ts
  export const EX_LIBRIS = `<text class="pt" x="125" y="45" text-anchor="middle" font-size="8.5" letter-spacing="3.4" font-family="${SANS}" font-weight="600">EX LIBRIS</text>`;
  ```

- Add `banner?: string;` to `PlateSlots` after `seal`.
- In `composePlate`, change `slots.header ?? \`<text …>EX LIBRIS</text>\`` to `slots.header ?? EX_LIBRIS`, and add `slots.banner,` on the line after `slots.seal,`.

Create `mottos.ts`:

```ts
import { EX_LIBRIS, SANS, SERIF, type PlateSlots } from "./compose.js";
import { fitLine, fitSize, textWidth, type FitFont } from "./fit.js";
import type { CardMotto, MottoLook } from "./style.js";
import { escapeText, svgText } from "./svgText.js";

export const LIFTED_EX_LIBRIS = `<text class="pt" x="125" y="31" text-anchor="middle" font-size="6" letter-spacing="3.4" font-family="${SANS}" font-weight="600">EX LIBRIS</text>`;

const MIN_SIZE = 5;
const ARC_PATH = "M56.1 97.4A78 78 0 0 1 193.9 97.4";
const ARC_LENGTH = 168.8;
const WAVE_PATH = "M72 53C87 47 102 59 125 53S163 47 178 53";
const WAVE_LENGTH = 110;

const n2 = (value: number) => +value.toFixed(2);

function fitted(text: string, font: FitFont, size: number, width: number, spacing = 0): { text: string; size: number } {
  const shrunk = fitSize(text, { font, size, width, spacing, min: MIN_SIZE });
  return { text: fitLine(text, { font, size: shrunk, width, spacing }), size: shrunk };
}

function italic(text: string, y: number, size: number, width: number, cls: "pt" | "pg" = "pt", spacing = 0.6): string {
  const line = fitted(text, "serif", size, width, spacing);
  return svgText(125, y, line.text, { size: line.size, font: "serif", italic: true, spacing, cls });
}

function onPath(text: string, id: string, d: string, length: number, size: number, spacing: number): string {
  const line = fitted(text, "serif", size, length - 12, spacing);
  const offset = n2((length - textWidth(line.text, { font: "serif", size: line.size, spacing })) / 2);
  return `<defs><path id="${id}" d="${d}"/></defs><text class="pt" font-size="${line.size}" font-style="italic" font-family="${SERIF}" letter-spacing="${spacing}"><textPath href="#${id}" startOffset="${offset}">${escapeText(line.text)}</textPath></text>`;
}

type Draw = (text: string, id: string) => Pick<PlateSlots, "header" | "banner">;

const LOOKS: Record<MottoLook, Draw> = {
  ribbon: (text) => ({ header: LIFTED_EX_LIBRIS + `<path class="pf" d="M62 41H72V57H62L66 49ZM188 41H178V57H188L184 49Z" opacity=".85"/><path class="pgl" d="M70 38H180V54H70Z" stroke-width="1"/><path class="pf" d="M70 54L74 58V54M180 54L176 58V54"/>` + italic(text, 49.5, 8, 100) }),
  scroll: (text) => ({ header: LIFTED_EX_LIBRIS + `<path class="pgl" d="M74 39H176V55H74Z" stroke-width=".9"/>` + [72, 178].map((x) => `<ellipse class="pgl" cx="${x}" cy="47" rx="4" ry="9" stroke-width=".9"/><ellipse class="pl" cx="${x}" cy="47" rx="1.6" ry="4.5" stroke-width=".6"/>`).join("") + italic(text, 50.5, 8, 94) }),
  arc: (text, id) => ({ header: LIFTED_EX_LIBRIS + onPath(text, id, ARC_PATH, ARC_LENGTH, 8.5, 1) }),
  cartouche: (text) => ({ header: LIFTED_EX_LIBRIS + `<rect class="pgl" x="76" y="37" width="98" height="21" rx="10.5" stroke-width="1"/><rect class="pl" x="79" y="40" width="92" height="15" rx="7.5" stroke-width=".45"/><circle class="pf" cx="73" cy="47.5" r="1.4"/><circle class="pf" cx="177" cy="47.5" r="1.4"/>` + italic(text, 50.5, 7.6, 86) }),
  rule: (text) => ({ header: LIFTED_EX_LIBRIS + `<path class="pl" d="M58 47.5H84M166 47.5H192" stroke-width=".7"/><path class="pf" d="M58 45.3L60.2 47.5L58 49.7L55.8 47.5ZM192 45.3L194.2 47.5L192 49.7L189.8 47.5Z"/>` + italic(text, 50.5, 8.4, 78) }),
  bannerBelow: (text) => ({ banner: `<path class="pf" d="M70 200H82V214H70L74 207ZM180 200H168V214H180L176 207Z" opacity=".85"/><path class="pgl" d="M80 197.5H170V210.5H80Z" stroke-width="1"/>` + italic(text, 206.6, 7.2, 84) }),
  wavyRibbon: (text, id) => ({ header: LIFTED_EX_LIBRIS + `<path class="pf" d="M62 46L70 44V57L62 59L66 52ZM188 46L180 44V57L188 59L184 52Z" opacity=".85"/><path class="pgl" d="M70 44C85 38 100 50 125 44S165 38 180 44V57C165 51 150 63 125 57S85 51 70 57Z" stroke-width=".9"/>` + onPath(text, id, WAVE_PATH, WAVE_LENGTH, 7.6, 0.5) }),
  titleRules: (text) => {
    const line = fitted(text.toUpperCase(), "caps", 6.8, 150, 2.4);
    return { header: LIFTED_EX_LIBRIS + `<path class="pl" d="M48 36.5H202M48 38.6H202M48 55.4H202M48 57.5H202" stroke-width=".55"/>` + svgText(125, 49.6, line.text, { size: line.size, spacing: 2.4, weight: 600 }) };
  },
  dropCap: (text) => {
    const [first = "", ...rest] = [...text];
    const tail = fitted(rest.join(""), "serif", 8.6, 112);
    return { header: LIFTED_EX_LIBRIS + `<rect class="pl" x="72" y="36" width="18" height="20" stroke-width=".9"/><rect class="pl" x="74" y="38" width="14" height="16" stroke-width=".4"/>` + svgText(81, 51.5, first.toUpperCase(), { size: 15, font: "serif" }) + (tail.text ? svgText(94, 50.5, tail.text, { size: tail.size, font: "serif", italic: true, anchor: "start" }) : "") };
  },
  sash: (text) => {
    const line = fitted(text, "serif", 6.8, 80);
    return { header: EX_LIBRIS + `<path class="pf" d="M156.1 16L175.9 16L234 74.1L234 93.9Z"/><path class="pgs" d="M159.21 16L234 90.79M172.79 16L234 77.21" stroke-width=".4"/><g transform="rotate(45 200 50)">${svgText(200, 52.6, line.text, { size: line.size, font: "serif", italic: true, cls: "pg" })}</g>` };
  },
  script: (text) => {
    const line = fitted(text, "script", 12.5, 116);
    return { header: LIFTED_EX_LIBRIS + svgText(125, 51, line.text, { size: line.size, font: "script" }) + `<path class="pl" d="M72 56.5Q125 62.5 178 55" stroke-width=".7" stroke-linecap="round"/>` };
  },
  plaque: (text) => ({ header: LIFTED_EX_LIBRIS + `<path class="pf" d="M71 37H179L182 40V52L179 55H71L68 52V40Z"/><path class="pgs" d="M72.5 39H177.5L180 41.5V50.5L177.5 53H72.5L70 50.5V41.5Z" stroke-width=".4"/>` + italic(text, 49.3, 8, 100, "pg", 0.5) }),
};

export function mottoSlots(motto: CardMotto | null, id: string): Pick<PlateSlots, "header" | "banner"> {
  return motto ? LOOKS[motto.look](motto.text, id) : {};
}
```

In `render.ts`:
- Import `mottoSlots` from `./mottos.js`.
- In `renderReaderCard`'s front branch, change `const slots: PlateSlots = decorations(input, print);` to:

```ts
  const slots: PlateSlots = { ...decorations(input, print), ...mottoSlots(style.motto, `rc-${style.motto?.look ?? "none"}-${seed}-${print}`) };
```

In `pages.ts` `readerCardSummary`, add this after the first `lines` declaration:

```ts
  if (input.style.motto) lines.push(`Motto: “${input.style.motto.text}”.`);
```

- [ ] **Step 4: Run the shared tests and typecheck**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared`
Expected: PASS, including the plate masters and the default-card byte identity.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Draw the reader card's motto in twelve looks

Every look shrinks its text to its slot and escapes it; arc and wavy
ribbon run on a textPath centred by a computed offset, because
react-native-svg ignores text-anchor there, with ids unique to look and
print; the sash is pre-clipped to the frame so it needs no clipPath.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 8: Thumbnails, crops, combination tests and the contact sheet

**Files:**
- Modify: `packages/shared/src/readerCards/compose.ts`, `render.ts`, `thumbnail.ts`, `index.ts`, `packages/shared/scripts/contact-sheet.ts`
- Test: `packages/shared/src/readerCards/thumbnail.test.ts`, `portable.test.ts`

**Interfaces:**
- Produces:

```ts
export type CardCrop = "motto" | "corner";
export const CARD_CROPS: Record<CardCrop, readonly [number, number, number, number]>;
export function cardRatio(crop?: CardCrop): number;               // height / width
// ReaderCardInput gains crop?: CardCrop; PlateFace gains viewBox?: readonly [number, number, number, number]
export function styleThumbnail(input: ReaderCardBase, patch: Partial<PublicReaderCardStyle>, crop?: CardCrop): ReaderCardBase;
```

- [ ] **Step 1: Write the failing tests**

Append to `thumbnail.test.ts` (add `styleThumbnail` to the `./thumbnail.js` import, `cardRatio`/`CARD_CROPS` to the `./render.js` import, and `CORNER_STYLES, DEFAULT_READER_CARD_STYLE, publicStyle` to the `./style.js` import):

```ts
test("a style thumbnail swaps any option, scales the dial and can crop to a region", () => {
  const card: PublicReaderCard = { state: "settled", identity: "corr", runnerUp: null, signal: null, coverage: [], dial: { segments: large }, facts: { finished: 258, highlights: 300, series: 0, since: null, edition: 2026 } };
  const input: ReaderCardBase = { card, style: publicStyle(DEFAULT_READER_CARD_STYLE), readerName: "andre", label: "Reader card", seed: seedOf("andre"), view: "owner" };
  const thumb = styleThumbnail(input, { corners: "laurel" }, "corner");
  assert.equal(thumb.style.corners, "laurel");
  assert.equal(thumb.crop, "corner");
  assert.ok(thumb.card.dial!.segments.reduce((sum, s) => sum + s.books, 0) <= THUMBNAIL_MARKS + 4);
  const svg = renderReaderCard({ ...thumb, print: "paper", width: 64 });
  assert.match(svg, /viewBox="0 0 100 100" width="64" height="64"/);
  assert.equal(styleThumbnail(input, { counter: "ring" }).crop, undefined);
});

test("crop ratios", () => {
  assert.equal(cardRatio(), 1.4);
  assert.equal(cardRatio("corner"), 1);
  assert.equal(cardRatio("motto"), CARD_CROPS.motto[3] / CARD_CROPS.motto[2]);
});
```

Append to `portable.test.ts` (add `MOTTO_LOOKS, FOOTER_LEFTS, FOOTER_RIGHTS, CORNER_STYLES, CARD_PRINTS, publicStyle, type PublicReaderCardStyle` to the style import and `random` to the seed import):

```ts
const LONG = "W".repeat(28);
const decorationsOf: Array<[string, Partial<PublicReaderCardStyle>]> = [
  ...MOTTO_LOOKS.flatMap((look): Array<[string, Partial<PublicReaderCardStyle>]> => [[`motto ${look}`, { motto: { text: "Per libros ad astra", look } }], [`long motto ${look}`, { motto: { text: LONG, look } }]]),
  ...FOOTER_LEFTS.map((left): [string, Partial<PublicReaderCardStyle>] => [`left ${left}`, { footer: { left, right: "name" } }]),
  ...FOOTER_RIGHTS.map((right): [string, Partial<PublicReaderCardStyle>] => [`right ${right}`, { footer: { left: "plate", right } }]),
  ...CORNER_STYLES.map((corners): [string, Partial<PublicReaderCardStyle>] => [`corners ${corners}`, { corners }]),
];

test("every motto, footer and corner stays inside the subset on every plate and print, and draws the same twice", () => {
  for (const [index, identity] of identities.entries()) for (const [name, patch] of decorationsOf) for (const print of ["paper", "reversed"] as const) {
    const card: PublicReaderCard = { state: identity ? "settled" : "unwritten", identity, runnerUp: null, streak: PLATES[(index + 1) % PLATES.length]!.key, signal: null, coverage: ["c"], dial: { segments: dials.small! }, facts: { finished: 48, highlights: 140, series: 12, since: 2014, edition: 2026, readerNumber: 42 } };
    const input = { card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), ...patch }, readerName: "andre.ribeiro", print, label: "x", seed: seedOf("andre.ribeiro"), view: "owner" as const };
    for (const page of ["front", "record"] as const) {
      const svg = renderReaderCard(input, page);
      assert.deepEqual(portabilityProblems(svg), [], `${identity}/${name}/${print}/${page}`);
      assert.equal(renderReaderCard(input, page), svg, `${identity}/${name}/${print}/${page} is deterministic`);
    }
  }
});

test("fifty seeded combinations of every dimension stay inside the subset", () => {
  const next = random(seedOf("reader-card-combinations"));
  const pick = <T,>(options: readonly T[]) => options[Math.floor(next() * options.length)]!;
  for (let i = 0; i < 50; i++) {
    const identity = pick(identities);
    const card: PublicReaderCard = { state: identity ? pick(["settled", "leaning"] as const) : "unwritten", identity, runnerUp: null, streak: pick(PLATES).key, signal: null, coverage: ["c"], dial: { segments: pick(Object.values(dials)) }, facts: { finished: 48, highlights: pick([0, 140]), series: 12, since: pick([null, 2014]), edition: 2026 }, chosen: pick(Object.values(chosenSets)) };
    const style: PublicReaderCardStyle = { counter: pick(COUNTERS), layout: "faces", trait: pick(TRAITS), motto: pick([null, { text: pick(["Per libros ad astra", LONG, "x"]), look: pick(MOTTO_LOOKS) }]), footer: { left: pick(FOOTER_LEFTS), right: pick(FOOTER_RIGHTS) }, corners: pick(CORNER_STYLES), print: pick(CARD_PRINTS) };
    for (const page of ["front", "chosen", "record", "merged"] as const) for (const print of ["paper", "reversed"] as const) {
      const svg = renderReaderCard({ card, style, readerName: pick(["andre", "andre.ribeiro", "a".repeat(30)]), print, label: "x", seed: seedOf(String(i)), view: pick(["owner", "visitor"] as const) }, page);
      assert.deepEqual(portabilityProblems(svg), [], `combination ${i}/${page}/${print}`);
    }
  }
});
```

(`seed.ts` already re-exports `mulberry32` as `random`. Add `random` to the existing `./seed.js` import.)

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL, because `styleThumbnail`, `crop`, `cardRatio` and `CARD_CROPS` do not exist. The portable tests may also fail on any look or corner that breaks the subset. Fix the drawing in Tasks 5–7's modules, not the guard.

- [ ] **Step 3: Implement**

In `compose.ts`:
- Add `viewBox?: readonly [number, number, number, number];` to `PlateFace`.
- `openSvg` becomes:

```ts
const openSvg = (face: PlateFace) => {
  const [x, y, w, h] = face.viewBox ?? [0, 0, 250, 350];
  const height = face.viewBox ? +((face.width * h) / w).toFixed(2) : +(face.width * 1.4).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="plate id-${face.key}" viewBox="${x} ${y} ${w} ${h}" width="${face.width}" height="${height}" role="img" aria-label="${face.label}">`;
};
```

In `render.ts`:
- Add after `PlatePrint`:

```ts
export type CardCrop = "motto" | "corner";
export const CARD_CROPS: Record<CardCrop, readonly [number, number, number, number]> = { motto: [30, 18, 190, 210], corner: [0, 0, 100, 100] };
export function cardRatio(crop?: CardCrop): number {
  if (!crop) return 1.4;
  const [, , w, h] = CARD_CROPS[crop];
  return h / w;
}
```

- Add `crop?: CardCrop;` to `RenderPlateOptions` and to `ReaderCardInput`.
- In `faceOf`, destructure `crop` and add `...(crop ? { viewBox: CARD_CROPS[crop] } : {})` to both returned `face` objects.

`thumbnail.ts` becomes:

```ts
import type { DialSegment } from "../library/readerCardFacts.js";
import type { Counter } from "./counters.js";
import type { CardCrop, ReaderCardBase } from "./render.js";
import type { PublicReaderCardStyle } from "./style.js";

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

export function styleThumbnail(input: ReaderCardBase, patch: Partial<PublicReaderCardStyle>, crop?: CardCrop): ReaderCardBase {
  const { dial } = input.card;
  return { ...input, ...(crop ? { crop } : {}), style: { ...input.style, ...patch }, card: dial ? { ...input.card, dial: { segments: thumbnailSegments(dial.segments) } } : input.card };
}

export function counterThumbnail(input: ReaderCardBase, counter: Counter): ReaderCardBase {
  return styleThumbnail(input, { counter });
}
```

In `index.ts`, the thumbnail line becomes `export { THUMBNAIL_MARKS, counterThumbnail, styleThumbnail, thumbnailSegments } from "./thumbnail.js";`. (`render.js` is already `export *`.)

In `packages/shared/scripts/contact-sheet.ts`:
- Import `CORNER_STYLES, FOOTER_LEFTS, FOOTER_RIGHTS, MOTTO_LOOKS` from the readerCards index.
- Change `dimensions` to:

```ts
const dimensions: Record<string, Array<[string, ReaderCardStyle]>> = {
  counters: COUNTERS.map((counter) => [counter, { ...DEFAULT_READER_CARD_STYLE, counter }]),
  traits: TRAITS.map((trait) => [trait, { ...DEFAULT_READER_CARD_STYLE, trait }]),
  mottos: MOTTO_LOOKS.map((look) => [look, { ...DEFAULT_READER_CARD_STYLE, motto: { text: "Per libros ad astra", look } }]),
  "long-mottos": MOTTO_LOOKS.map((look) => [look, { ...DEFAULT_READER_CARD_STYLE, motto: { text: "The owl of Minerva flies late", look } }]),
  "footer-left": FOOTER_LEFTS.map((left) => [left, { ...DEFAULT_READER_CARD_STYLE, footer: { left, right: "name" } }]),
  "footer-right": FOOTER_RIGHTS.map((right) => [right, { ...DEFAULT_READER_CARD_STYLE, footer: { left: "plate", right } }]),
  corners: CORNER_STYLES.map((corners) => [corners, { ...DEFAULT_READER_CARD_STYLE, corners }]),
};
```

- In `cardOf`, add `readerNumber: 42` to `facts`.
- Change both `readerName: "example reader"` to `readerName: "andre.ribeiro"`.

- [ ] **Step 4: Run the shared tests, typecheck and the sheet**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared && npm run sheet -w @scripta/shared`
Expected: tests PASS, and the sheet prints its directory containing `mottos.html`, `long-mottos.html`, `footer-left.html`, `footer-right.html` and `corners.html`. Open `mottos.html` and `corners.html` in the preview browser. Check them against the spec's "Risks" collisions:
- `sash` with corners
- `shelf` with lifted mottos
- `frame` with corners
- `bannerBelow` with the seal

Report what collides in the task report. Collisions the spec already lists are accepted. Anything else is a defect to fix here.

- [ ] **Step 5: Commit**

```bash
git add packages/shared && git commit -m "Thumbnail any reader card option, crop it, and test every combination

The editor previews mottos and corners as cropped thumbnails of the
owner's own card; every option on every plate and print, and fifty
seeded full combinations, are checked against react-native-svg's subset
and for determinism. The contact sheet gains one page per decoration.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 9: The reader number on the server

**Files:**
- Modify: `backend/src/modules/auth/publicProfile.ts`, `backend/src/modules/auth/index.ts`, `backend/src/modules/library/publicResolver.ts`, `backend/src/modules/library/routes.ts`, `packages/shared/src/readerCards/api.ts`
- Test: `backend/src/modules/auth/publicProfile.test.ts`, `backend/src/modules/library/publicViews.test.ts`, `backend/src/modules/library/routes.test.ts`, `packages/shared/src/readerCards/api.test.ts`

**Interfaces:**
- Produces:
  - `readerNumberOf(userId: string): number | undefined` (auth index)
  - `GET /library/reader-card/number` → `{ readerNumber: number | null }` (owner only)
  - `fetchReaderNumber(): Promise<number | null>` on `createReaderCardApi`

- [ ] **Step 1: Write the failing tests**

In `publicProfile.test.ts`:
- Add `readerNumberOf` to the `./publicProfile.js` import.
- After the four `insertUser.run(...)` lines, add:

```ts
db.prepare(`INSERT INTO users (id, email, username, auth_version, created_at) VALUES (?, ?, ?, 0, ?)`).run("u0", "first@test.dev", "first", "2020-01-01T00:00:00.000Z");
```

Then append:

```ts
test("readerNumberOf ranks accounts by creation, ties by insertion, and knows no stranger", () => {
  assert.equal(readerNumberOf("u0"), 1);
  assert.deepEqual(["u1", "u2", "u3", "u4"].map(readerNumberOf), [2, 3, 4, 5]);
  assert.equal(readerNumberOf("missing"), undefined);
});
```

Append to `publicViews.test.ts`:

```ts
test("the reader number reaches visitors only when the owner chose that footer", async () => {
  const { openAuthDb } = await import("../auth/adapters/sqlite/connection.js");
  const owner = "card-number";
  openAuthDb().prepare(`INSERT INTO users (id, email, username, auth_version, created_at) VALUES (?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(owner, "number@test.dev", "numbered");
  service.saveLibrary(owner, { books: [earthsea], groups: [] });
  assert.equal("readerNumber" in (resolvePublicLibraryData(owner, cardRequest).readerCard!.facts ?? {}), false);
  service.patchReaderCardStyle(owner, { footer: { left: "readerNumber", right: "name" } });
  const card = resolvePublicLibraryData(owner, cardRequest).readerCard!;
  assert.equal(typeof card.facts?.readerNumber, "number");
  assert.ok(card.facts!.readerNumber! >= 1);
  assert.deepEqual(card.style?.footer, { left: "readerNumber", right: "name" });
  service.patchReaderCardStyle(owner, { footer: { left: "since", right: "name" } });
  assert.equal("readerNumber" in (resolvePublicLibraryData(owner, cardRequest).readerCard!.facts ?? {}), false);
});
```

Append to `routes.test.ts`:

```ts
test("GET reader card number answers the owner's rank, or null without an account row", async () => {
  const { app } = await setup();
  const { openAuthDb } = await import("../auth/adapters/sqlite/connection.js");
  const before = await app.inject({ method: "GET", url: "/library/reader-card/number", headers: asUser("ranked") });
  assert.deepEqual(before.json(), { readerNumber: null });
  openAuthDb().prepare(`INSERT INTO users (id, email, username, auth_version, created_at) VALUES (?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run("ranked", "ranked@test.dev", "ranked");
  const after = await app.inject({ method: "GET", url: "/library/reader-card/number", headers: asUser("ranked") });
  assert.equal(after.statusCode, 200);
  assert.ok(after.json().readerNumber >= 1);
  const anonymous = await app.inject({ method: "GET", url: "/library/reader-card/number" });
  assert.equal(anonymous.statusCode, 401);
  await app.close();
});
```

In `packages/shared/src/readerCards/api.test.ts`, append:

```ts
test("the reader card API reads the owner's reader number", async () => {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const api = createReaderCardApi((async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return { readerNumber: 42 };
  }) as ApiRequest);
  assert.equal(await api.fetchReaderNumber(), 42);
  assert.deepEqual(calls, [{ path: "/library/reader-card/number", init: { auth: "required" } }]);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared; npm test -w backend`
Expected: FAIL. `readerNumberOf`, the route, the resolver field and `fetchReaderNumber` do not exist.

- [ ] **Step 3: Implement**

In `publicProfile.ts`:
- Add `joined` and `rank` to `CachedStatements`:

```ts
  joined: ReturnType<DatabaseSync["prepare"]>;
  rank: ReturnType<DatabaseSync["prepare"]>;
```

- Add to the `cached = { … }` object:

```ts
      joined: db.prepare("SELECT created_at, rowid FROM users WHERE id = ?"),
      rank: db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at < ? OR (created_at = ? AND rowid <= ?)"),
```

- Add the function:

```ts
export function readerNumberOf(userId: string): number | undefined {
  const row = statements().joined.get(userId) as { created_at: string; rowid: number } | undefined;
  if (!row) return undefined;
  return (statements().rank.get(row.created_at, row.created_at, row.rowid) as { n: number }).n;
}
```

In `auth/index.ts`, add `readerNumberOf` to the `./publicProfile.js` export list.

In `publicResolver.ts`:
- Import `readerNumberOf` from `"../auth/index.js"`.
- Add above `resolvePublicLibraryData`:

```ts
function publicCardOf(userId: string, stored: string, style: ReaderCardStyle, byKey: Map<string, BookRowRecord>): PublicReaderCard {
  const card = JSON.parse(stored) as PublicReaderCard;
  const readerNumber = style.footer.left === "readerNumber" ? readerNumberOf(userId) : undefined;
  return { ...card, ...(readerNumber && card.facts ? { facts: { ...card.facts, readerNumber } } : {}), style: publicStyle(style), chosen: chosenOf(userId, style, byKey) };
}
```

- Change the `readerCard` spread in the return to:

```ts
    ...(req.needsReaderCard ? { readerCard: publicCardOf(userId, summary.reader_card as string, style!, byKey) } : {}),
```

In `library/routes.ts`:
- Import `readerNumberOf` beside `authGuard, rateLimitKey` from `"../auth/index.js"`.
- In the `cards` scope, after the `GET /library/reader-card/style` line, add:

```ts
      cards.get("/library/reader-card/number", { preHandler: authGuard }, async (request) => ({ readerNumber: readerNumberOf(request.user.id) ?? null }));
```

In `packages/shared/src/readerCards/api.ts`, add to the returned object:

```ts
    fetchReaderNumber(): Promise<number | null> {
      return request<{ readerNumber: number | null }>(apiPath`/library/reader-card/number`, { auth: "required" }).then((body) => body.readerNumber);
    },
```

- [ ] **Step 4: Verify**

Run: `npm run build -w @scripta/shared && npm test -w @scripta/shared && npm run typecheck -w @scripta/shared && npm run typecheck -w backend && npm test -w backend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src backend/src && git commit -m "Serve the reader number to visitors who see that footer and to the owner

The number is the account's rank by creation, ties broken by insertion,
and reveals sign-up order, which the owner accepted; so the public card
carries it only when the owner chose the readerNumber footer, and the
owner reads their own from an authenticated endpoint.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 10: Web: fixed print, crops and the owner's reader number

**Files:**
- Modify: `frontend/src/api/readerCard.ts`, `frontend/src/hooks/useReaderCard.ts`, `frontend/src/components/readerCard/ReaderCardImage.tsx`, `frontend/src/pages/ReaderCardPage.tsx`
- Test: `frontend/scripts/test-reader-card.mts`, `frontend/scripts/test-reader-card-style.mts`

**Interfaces:**
- Consumes: `fetchReaderNumber` (Task 9), `OwnCardStyle.readerNumber` (Task 6), `cardRatio` and `crop` (Task 8).
- Produces:
  - `READER_NUMBER_KEY = ["reader-card", "number"]`
  - `useOwnCardStyle(enabled?: boolean): OwnCardStyle | undefined`, exported from `hooks/useReaderCard.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test-reader-card.mts`:

```ts
test("a fixed print draws one copy whatever the theme, and auto draws both", () => {
  const fixed = renderToString(createElement(ReaderCardImage, { input: visitor("faces", { style: { ...card.style!, print: "reversed" } }) }));
  assert.equal(fixed.match(/<svg /g)?.length, 1);
  assert.doesNotMatch(fixed, /dark:hidden|dark:block/);
  assert.match(fixed, /#efe5d1/);
  assert.equal(renderToString(createElement(ReaderCardImage, { input: visitor("faces") })).match(/<svg /g)?.length, 2);
});

test("a cropped image keeps the crop's proportions", () => {
  const html = renderToString(createElement(ReaderCardImage, { input: { ...visitor("faces"), crop: "corner" } }));
  assert.match(html, /aspect-ratio:1/);
  assert.match(html, /viewBox="0 0 100 100"/);
});
```

Note: the `visitor` helper overrides `style` with `{ …, layout }`. Change it so a passed `style` field wins: `(layout, fields = {}) => readerCardInputOf([], [], "andre", { ...card, style: { ...card.style!, layout }, ...fields })`.

Append to `test-reader-card-style.mts` (add `READER_NUMBER_KEY` to the `useReaderCard` import line, which becomes `import { READER_NUMBER_KEY, useReaderCard } from "../src/hooks/useReaderCard";`):

```ts
test("the owner's card carries the reader number while that footer is chosen", () => {
  const client = queryClient();
  client.setQueryData(READER_CARD_STYLE_KEY, { ...DEFAULT_READER_CARD_STYLE, footer: { left: "readerNumber", right: "name" } });
  client.setQueryData(READER_NUMBER_KEY, 42);
  let owner!: ReaderCardBase;
  function Probe() { owner = useReaderCard(books, [], "andre"); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  assert.equal(owner.card.facts?.readerNumber, 42);
  client.setQueryData(READER_CARD_STYLE_KEY, DEFAULT_READER_CARD_STYLE);
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  assert.equal(owner.card.facts?.readerNumber, undefined);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build -w @scripta/shared && npm test -w frontend`
Expected: FAIL.

- [ ] **Step 3: Implement**

`frontend/src/api/readerCard.ts`:

```ts
export const { fetchReaderCardStyle, updateReaderCardStyle, fetchReaderNumber } = createReaderCardApi(request);
```

`frontend/src/hooks/useReaderCard.ts` becomes:

```ts
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { readerCardInputOf, type CoverOf, type Group, type OwnCardStyle, type PublicReaderCard } from "@scripta/shared";
import { fetchReaderNumber } from "../api/readerCard";
import { peekResolvedCover } from "../api/covers";
import { coverParamsFor } from "../components/BookCard";
import { useReaderCardStyle } from "./useReaderCardStyle";

export const NO_GROUPS: Group[] = [];
export const READER_NUMBER_KEY = ["reader-card", "number"] as const;

export const coverOf: CoverOf = (book) => (typeof book._coverUrl === "string" && book._coverUrl ? book._coverUrl : peekResolvedCover(coverParamsFor(book), "thumb") ?? null);

export function useOwnCardStyle(enabled = true): OwnCardStyle | undefined {
  const { data: style } = useReaderCardStyle(enabled);
  const { data: readerNumber } = useQuery({ queryKey: READER_NUMBER_KEY, queryFn: fetchReaderNumber, enabled: enabled && style?.footer.left === "readerNumber", staleTime: Infinity });
  return useMemo(() => (style ? { style, coverOf, readerNumber: style.footer.left === "readerNumber" ? readerNumber : null } : undefined), [style, readerNumber]);
}

export function useReaderCard(books: Array<Record<string, unknown>>, groups: Group[], readerName: string, override?: PublicReaderCard) {
  const own = useOwnCardStyle(!override);
  return useMemo(() => readerCardInputOf(books, groups, readerName, override, override ? undefined : own), [books, groups, readerName, override, own]);
}
```

(If `OwnCardStyle` is not exported from the shared library index, add `type OwnCardStyle` to the `readerCardFacts` exports in `packages/shared/src/library/index.ts`.)

`ReaderCardImage.tsx` becomes:

```tsx
import { useMemo } from "react";
import { cardRatio, renderReaderCard, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";

const SVG = "block h-full w-full [&>svg]:h-full [&>svg]:w-full";

export function ReaderCardImage({ input, page = "front", className = "" }: { input: ReaderCardBase; page?: ReaderCardPage; className?: string }) {
  const fixed = input.style.print === "auto" ? null : input.style.print;
  const { paper, reversed } = useMemo(() => ({ paper: renderReaderCard({ ...input, print: fixed ?? "paper" }, page), reversed: fixed ? null : renderReaderCard({ ...input, print: "reversed" }, page) }), [input, page, fixed]);
  return (
    <span className={`block ${input.crop ? "" : "aspect-[5/7]"} ${className}`} style={input.crop ? { aspectRatio: String(1 / cardRatio(input.crop)) } : undefined}>
      {reversed === null ? (
        <span className={SVG} dangerouslySetInnerHTML={{ __html: paper }} />
      ) : (
        <>
          <span className={`${SVG} dark:hidden`} dangerouslySetInnerHTML={{ __html: paper }} />
          <span className="hidden h-full w-full dark:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: reversed }} />
        </>
      )}
    </span>
  );
}
```

`ReaderCardPage.tsx`:
- Import `useOwnCardStyle` from `../hooks/useReaderCard` beside `NO_GROUPS` (drop `coverOf` from that import if nothing else uses it).
- Add `const own = useOwnCardStyle();`.
- `input` becomes `useMemo(() => readerCardInputOf(books, groups, readerName, undefined, own), [books, groups, readerName, own])`.

- [ ] **Step 4: Verify the frontend**

Run: `npm run build -w @scripta/shared && npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend`
Expected: PASS, including the A3 "draws both prints" test.

- [ ] **Step 5: Commit**

```bash
git add frontend packages/shared/src && git commit -m "Draw a fixed print, crops and the owner's reader number on web

A card printed paper or reversed looks the same in every theme, so it
renders one copy; the owner's card fetches its reader number only while
that footer is chosen.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 11: Web editor: motto, footer, corners and print

**Files:**
- Create: `frontend/src/components/readerCard/DraftField.tsx`
- Modify: `frontend/src/components/readerCard/ReaderCardChoices.tsx` (NoteField uses DraftField), `frontend/src/components/readerCard/ReaderCardOptions.tsx`, `frontend/src/pages/ReaderCardPage.tsx`
- Test: `frontend/scripts/test-reader-card-editor.mts`

**Interfaces:**
- Consumes: `styleThumbnail`, the labels (Tasks 1 and 8), `MOTTO_MAX`, `noteToSend`.
- Produces:
  - `<DraftField label initial max onSave={(value: string | null) => Promise<boolean>} />`
  - `ReaderCardOptions`'s `onChange` becomes `SaveStyle` (`(patch) => Promise<boolean>`)

- [ ] **Step 1: Write the failing tests**

In `test-reader-card-editor.mts`:
- Replace the first two tests with these, which count per group.
- Add the new tests.
- Change every `onChange: () => undefined` passed to `ReaderCardOptions` into `onChange: async () => true`.
- Add `MOTTO_MAX` to the `@scripta/shared` import.

```ts
const group = (html: string, label: string) => {
  const start = html.indexOf(`aria-label="${label}"`);
  return html.slice(start, html.indexOf("</div>", start));
};
const options = (style = {}) => renderToString(createElement(ReaderCardOptions, { input: readerCardInputOf(books, [], "andre.ribeiro", undefined, { style: { ...DEFAULT_READER_CARD_STYLE, counter: "beads", trait: "seal", layout: "book", ...style }, coverOf: () => null }), onChange: async () => true }));

test("five counter thumbnails, with only the chosen one checked", () => {
  const counters = group(options(), "Counter");
  assert.equal(counters.match(/role="radio"/g)?.length, 5);
  assert.equal(counters.match(/aria-checked="true"/g)?.length, 1);
  assert.match(counters, /aria-checked="true"[^>]*>(?:(?!<\/button>).)*Beads/s);
});

test("trait and layout show their names and press the current one", () => {
  const html = options();
  for (const name of ["Line and seal", "Seal", "Line", "None", "Three faces", "Book", "One back"]) assert.match(html, new RegExp(`>${name}<`));
  assert.match(html, /aria-pressed="true"[^>]*>Seal</);
  assert.match(html, /aria-pressed="true"[^>]*>Book</);
});

test("twelve motto looks, checked on the stored one, under a 28-character field", () => {
  const html = options({ motto: { text: "Per libros", look: "arc" } });
  const looks = group(html, "Motto look");
  assert.equal(looks.match(/role="radio"/g)?.length, 12);
  assert.match(looks, /aria-checked="true"[^>]*>(?:(?!<\/button>).)*Arc/s);
  assert.match(html, new RegExp(`maxLength="${MOTTO_MAX}"`, "i"));
  assert.match(html, /value="Per libros"/);
});

test("both footer corners offer twelve chips and check the stored ones", () => {
  const html = options({ footer: { left: "since", right: "initials" } });
  for (const [label, checked] of [["Footer left", "Reader since"], ["Footer right", "Initials"]] as const) {
    const chips = group(html, label);
    assert.equal(chips.match(/role="radio"/g)?.length, 12, label);
    assert.match(chips, new RegExp(`aria-checked="true"[^>]*>${checked}<`), label);
  }
});

test("twelve corner thumbnails and the three prints", () => {
  const html = options({ corners: "laurel", print: "reversed" });
  const corners = group(html, "Corners");
  assert.equal(corners.match(/role="radio"/g)?.length, 12);
  assert.match(corners, /aria-checked="true"[^>]*>(?:(?!<\/button>).)*Laurel/s);
  assert.match(corners, /viewBox="0 0 100 100"/);
  assert.match(html, /aria-pressed="true"[^>]*>Reversed</);
  for (const name of ["Follow theme", "Paper"]) assert.match(html, new RegExp(`>${name}<`));
});
```

The existing note tests (`maxLength="60"`, `>10/60<`, `value="lent twice"`) must keep passing unchanged after the DraftField extraction.

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build -w @scripta/shared && npm test -w frontend`
Expected: FAIL.

- [ ] **Step 3: Extract DraftField**

Create `DraftField.tsx` from today's `NoteField` body, made generic:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { noteToSend } from "@scripta/shared";

const DRAFT_DELAY_MS = 600;

export function DraftField({ label, initial, max, onSave }: { label: string; initial: string | null; max: number; onSave: (value: string | null) => Promise<boolean> }) {
  const [draft, setDraft] = useState(initial ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sent = useRef(initial);
  const pending = useRef<string | null>(null);
  const latest = useRef(onSave);
  useEffect(() => { latest.current = onSave; });
  const save = useCallback((value: string) => {
    clearTimeout(timer.current);
    pending.current = null;
    const next = noteToSend(value, sent.current);
    if (next === undefined) return;
    const previous = sent.current;
    sent.current = next;
    void latest.current(next).then((saved) => {
      if (saved) return;
      sent.current = previous;
      setDraft((current) => (current === value ? (previous ?? "") : current));
    });
  }, []);
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pending.current !== null) save(pending.current);
  }, [save]);
  return (
    <label className="mt-3 block text-xs text-(--color-text-dim)">
      {label}
      <input
        value={draft}
        maxLength={max}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          clearTimeout(timer.current);
          pending.current = value;
          timer.current = setTimeout(() => save(value), DRAFT_DELAY_MS);
        }}
        onBlur={() => save(draft)}
        className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text)"
      />
      <span className="mt-1 block text-right">{`${draft.length}/${max}`}</span>
    </label>
  );
}
```

In `ReaderCardChoices.tsx`:
- Delete `NOTE_DELAY_MS` and the `NoteField` function body.
- Replace them with:

```tsx
function NoteField({ signature, onChange }: { signature: ChosenSignature; onChange: SaveStyle }) {
  return <DraftField label="Note" initial={signature.note} max={SIGNATURE_NOTE_MAX} onSave={(note) => onChange({ signature: { bookKey: signature.bookKey, note } })} />;
}
```

- Import `DraftField` from `./DraftField`, and remove the imports that become unused (`useCallback`, `useEffect`, `useRef`, `noteToSend` if nothing else uses them; check each with `rg` in the file).

- [ ] **Step 4: Add the editor sections**

In `ReaderCardOptions.tsx`:
- Import `useState`.
- Import from `@scripta/shared`: `CARD_PRINTS, CORNER_LABELS, CORNER_STYLES, FOOTER_LEFTS, FOOTER_LEFT_LABELS, FOOTER_RIGHTS, FOOTER_RIGHT_LABELS, MOTTO_LOOKS, MOTTO_LOOK_LABELS, MOTTO_MAX, PRINT_LABELS, styleThumbnail, type MottoLook`.
- Import `DraftField` from `./DraftField` and `type SaveStyle` from `./ReaderCardChoices`.
- Add these components above `ReaderCardOptions`:

```tsx
const SAMPLE_MOTTO = "Per libros ad astra";
const TILE = (checked: boolean) => `flex flex-col items-center gap-1 rounded-lg border p-1.5 text-xs font-semibold ${checked ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`;

function Thumbnails<T extends string>({ label, options, labels, value, thumbnail, onPick, columns }: { label: string; options: readonly T[]; labels: Record<T, string>; value: T | null; thumbnail: (option: T) => ReaderCardBase; onPick: (option: T) => void; columns: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-2 ${columns}`}>
      {options.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={value === option} onClick={() => onPick(option)} className={TILE(value === option)}>
          <span aria-hidden="true" className="block w-full"><ReaderCardImage input={thumbnail(option)} className="w-full" /></span>
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

function Chips<T extends string>({ label, options, labels, value, onPick }: { label: string; options: readonly T[]; labels: Record<T, string>; value: T; onPick: (option: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button key={option} type="button" role="radio" aria-checked={value === option} onClick={() => onPick(option)} className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${value === option ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)" : "border-(--color-border) text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}>
          {labels[option]}
        </button>
      ))}
    </div>
  );
}
```

`ReaderCardOptions` becomes:

```tsx
export function ReaderCardOptions({ input, onChange }: { input: ReaderCardBase; onChange: SaveStyle }) {
  const { counter, trait, layout, motto, footer, corners, print } = input.style;
  const [look, setLook] = useState<MottoLook>(motto?.look ?? "ribbon");
  const counterThumbs = useMemo(() => COUNTERS.map((option) => ({ option, input: counterThumbnail(input, option) })), [input]);
  const mottoThumbs = useMemo(() => new Map(MOTTO_LOOKS.map((option) => [option, styleThumbnail(input, { motto: { text: motto?.text ?? SAMPLE_MOTTO, look: option } }, "motto")])), [input, motto?.text]);
  const cornerThumbs = useMemo(() => new Map(CORNER_STYLES.map((option) => [option, styleThumbnail(input, { corners: option }, "corner")])), [input]);
  const pickLook = (next: MottoLook) => {
    setLook(next);
    if (motto) void onChange({ motto: { text: motto.text, look: next } });
  };
  return (
    <>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Counter</h3>
        <div role="radiogroup" aria-label="Counter" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {counterThumbs.map(({ option, input: thumbnail }) => (
            <button key={option} type="button" role="radio" aria-checked={counter === option} onClick={() => void onChange({ counter: option })} className={TILE(counter === option)}>
              <span aria-hidden="true" className="block w-full"><ReaderCardImage input={thumbnail} className="w-full" /></span>
              {COUNTER_LABELS[option]}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Second trait</h3>
        <Segmented label="Second trait" options={TRAITS} labels={TRAIT_LABELS} value={trait} onChange={(next) => void onChange({ trait: next })} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Motto</h3>
        <DraftField label="Your motto" initial={motto?.text ?? null} max={MOTTO_MAX} onSave={(text) => onChange({ motto: text ? { text, look } : null })} />
        <div className="mt-3">
          <Thumbnails label="Motto look" options={MOTTO_LOOKS} labels={MOTTO_LOOK_LABELS} value={motto?.look ?? look} thumbnail={(option) => mottoThumbs.get(option)!} onPick={pickLook} columns="grid-cols-3 sm:grid-cols-4" />
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Footer</h3>
        <p className="mb-1 text-xs text-(--color-text-dim)">Left</p>
        <Chips label="Footer left" options={FOOTER_LEFTS} labels={FOOTER_LEFT_LABELS} value={footer.left} onPick={(left) => void onChange({ footer: { ...footer, left } })} />
        <p className="mb-1 mt-3 text-xs text-(--color-text-dim)">Right</p>
        <Chips label="Footer right" options={FOOTER_RIGHTS} labels={FOOTER_RIGHT_LABELS} value={footer.right} onPick={(right) => void onChange({ footer: { ...footer, right } })} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Corners</h3>
        <Thumbnails label="Corners" options={CORNER_STYLES} labels={CORNER_LABELS} value={corners} thumbnail={(option) => cornerThumbs.get(option)!} onPick={(next) => void onChange({ corners: next })} columns="grid-cols-4 sm:grid-cols-6" />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Print</h3>
        <Segmented label="Print" options={CARD_PRINTS} labels={PRINT_LABELS} value={print} onChange={(next) => void onChange({ print: next })} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Layout</h3>
        <Segmented label="Layout" options={LAYOUTS} labels={LAYOUT_LABELS} value={layout} onChange={(next) => void onChange({ layout: next })} />
      </section>
    </>
  );
}
```

In `ReaderCardPage.tsx`, pass `onChange={change}` to `ReaderCardOptions` instead of `(patch) => void change(patch)`.

The motto field's `key`: `DraftField` keeps its own draft. That is correct for typing. A motto removed elsewhere is not reflected until remount, which is acceptable for A5.

- [ ] **Step 5: Verify the frontend**

Run: `npm run build -w @scripta/shared && npm run typecheck -w frontend && npm run lint -w frontend && npm test -w frontend`
Expected: PASS, including the A4 note tests.

- [ ] **Step 6: Commit**

```bash
git add frontend && git commit -m "Add motto, footer, corners and print to the web reader card editor

Mottos and corners are previewed as cropped thumbnails of the owner's
own card and the footer as chips; the motto text saves like the note,
so the note field and the motto share one DraftField.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 12: Mobile: print, crops and the owner's reader number

**Files:**
- Modify: `mobile/src/features/readerCard/api.ts`, `mobile/src/features/readerCard/useReaderCardStyle.ts`, `mobile/src/features/murals/ReaderCardImage.tsx`, `mobile/src/features/murals/ReaderCardBlock.tsx`, `mobile/src/features/readerCard/ReaderCardEditorScreen.tsx`

**Interfaces:**
- Produces: `READER_NUMBER_KEY` and `useOwnCardStyle(enabled?: boolean): OwnCardStyle | undefined`, both in `features/readerCard/useReaderCardStyle.ts`.

Mobile has no React renderer in its tests. The shared logic is pinned by Tasks 1, 6 and 8, and the screens are checked in Task 14.

- [ ] **Step 1: Implement**

`api.ts`:

```ts
export const { fetchReaderCardStyle, updateReaderCardStyle, fetchReaderNumber } = createReaderCardApi(request);
```

In `useReaderCardStyle.ts`:
- Import `useMemo` and `type OwnCardStyle`.
- Import `fetchReaderNumber` from `./api`.
- Add:

```ts
export const READER_NUMBER_KEY = ["reader-card", "number"] as const;

export function useOwnCardStyle(enabled = true): OwnCardStyle | undefined {
  const { data: style } = useReaderCardStyle(enabled);
  const { data: readerNumber } = useQuery({ queryKey: READER_NUMBER_KEY, queryFn: fetchReaderNumber, enabled: enabled && style?.footer.left === "readerNumber", staleTime: Infinity });
  return useMemo(() => (style ? { style, coverOf, readerNumber: style.footer.left === "readerNumber" ? readerNumber : null } : undefined), [style, readerNumber]);
}
```

`ReaderCardImage.tsx` becomes:

```tsx
import { useMemo } from "react";
import { SvgXml } from "react-native-svg";
import { cardRatio, renderReaderCard, resolvePrint, type ReaderCardBase, type ReaderCardPage } from "@scripta/shared";
import { cardFontFamily, useTheme } from "../../ui";
import { CARD_MONO_FAMILY, CARD_SCRIPT_FAMILY } from "../../ui/fontAssets";
import { readerCardXml } from "./readerCardXml";

export const PLATE_RATIO = 350 / 250;

export function ReaderCardImage({ input, page = "front", width }: { input: ReaderCardBase; page?: ReaderCardPage; width: number }) {
  const { mode } = useTheme();
  const xml = useMemo(
    () => readerCardXml(renderReaderCard({ ...input, print: resolvePrint(input.style.print, mode === "dark") }, page), { serif: cardFontFamily("playfairDisplay"), sans: cardFontFamily("sans"), mono: CARD_MONO_FAMILY, script: CARD_SCRIPT_FAMILY }),
    [input, page, mode],
  );
  return <SvgXml xml={xml} width={width} height={width * cardRatio(input.crop)} />;
}
```

In `ReaderCardBlock.tsx`:
- Import `useOwnCardStyle` instead of `coverOf, useReaderCardStyle`.
- Replace the `style` and `input` lines with:

```tsx
  const own = useOwnCardStyle(!publicCard);
  const input = useMemo(() => readerCardInputOf(books, groups, readerName, publicCard, publicCard ? undefined : own), [books, groups, readerName, publicCard, own]);
```

In `ReaderCardEditorScreen.tsx`:
- Import `useOwnCardStyle` beside `useReaderCardStyle, useSaveReaderCardStyle`. Drop `coverOf` from that import if nothing else uses it.
- Add `const own = useOwnCardStyle();`.
- `input` becomes `useMemo(() => readerCardInputOf(books, groups, readerName, undefined, own), [books, groups, readerName, own])`.

- [ ] **Step 2: Verify mobile**

Run: `npm run build -w @scripta/shared && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add mobile && git commit -m "Draw a fixed print, crops and the owner's reader number on mobile

The print resolves against the theme only when it follows it; the
owner's card reads its reader number while that footer is chosen.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 13: Mobile editor: motto, footer, corners and print

**Files:**
- Create: `mobile/src/features/readerCard/DraftField.tsx`
- Modify: `mobile/src/features/readerCard/ReaderCardChoices.tsx` (NoteField uses DraftField), `mobile/src/features/readerCard/ReaderCardOptions.tsx`, `mobile/src/features/readerCard/ReaderCardEditorScreen.tsx`

**Interfaces:**
- Produces:
  - `<DraftField label initial max onSave flushRef? />`
  - `ReaderCardOptions`'s `onChange` becomes `SaveStyle`

- [ ] **Step 1: Extract DraftField**

Create `mobile/src/features/readerCard/DraftField.tsx` from today's `NoteField`:

```tsx
import { useEffect, useRef, useState, type RefObject } from "react";
import { noteToSend } from "@scripta/shared";
import { Input } from "../../ui";
import { useDebouncedCallback } from "../library/lib/debounce";

const DRAFT_DELAY_MS = 600;

export function DraftField({ label, initial, max, onSave, flushRef }: { label: string; initial: string | null; max: number; onSave: (value: string | null) => Promise<boolean>; flushRef?: RefObject<() => void> }) {
  const [draft, setDraft] = useState(initial ?? "");
  const sent = useRef(initial);
  const { schedule, flush } = useDebouncedCallback((value: string) => {
    const next = noteToSend(value, sent.current);
    if (next === undefined) return;
    const previous = sent.current;
    sent.current = next;
    void onSave(next).then((saved) => {
      if (saved) return;
      sent.current = previous;
      setDraft((current) => (current === value ? (previous ?? "") : current));
    });
  }, DRAFT_DELAY_MS);
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flush;
    return () => { flushRef.current = () => {}; };
  });
  return <Input label={label} value={draft} maxLength={max} hint={`${draft.length}/${max}`} onChangeText={(value) => { setDraft(value); schedule(value); }} />;
}
```

In `ReaderCardChoices.tsx`, `NoteField` becomes:

```tsx
function NoteField({ signature, onChange, flushRef }: { signature: ChosenSignature; onChange: SaveStyle; flushRef: RefObject<() => void> }) {
  return <DraftField label="Note" initial={signature.note} max={SIGNATURE_NOTE_MAX} onSave={(note) => onChange({ signature: { bookKey: signature.bookKey, note } })} flushRef={flushRef} />;
}
```

Delete `NOTE_DELAY_MS`, and remove the imports that become unused (`useDebouncedCallback`, `noteToSend`, and `Input` if nothing else uses them; check each with `rg` in the file).

- [ ] **Step 2: Add the editor sections**

`ReaderCardOptions.tsx` becomes:

```tsx
import { useMemo, useState } from "react";
import { FlatList, ScrollView, StyleSheet } from "react-native";
import { CARD_PRINTS, CORNER_LABELS, CORNER_STYLES, COUNTERS, COUNTER_LABELS, FOOTER_LEFTS, FOOTER_LEFT_LABELS, FOOTER_RIGHTS, FOOTER_RIGHT_LABELS, LAYOUTS, LAYOUT_LABELS, MOTTO_LOOKS, MOTTO_LOOK_LABELS, MOTTO_MAX, PRINT_LABELS, TRAITS, TRAIT_LABELS, cardRatio, counterThumbnail, styleThumbnail, type MottoLook, type ReaderCardBase } from "@scripta/shared";
import { Segmented, spacing } from "../../ui";
import { Chip, Section, Tile } from "../library/components/StyleControls";
import { ReaderCardImage } from "../murals/ReaderCardImage";
import { DraftField } from "./DraftField";
import type { SaveStyle } from "./ReaderCardChoices";

const THUMB_WIDTH = 72;
const CORNER_WIDTH = 56;
const TILE_PADDING = 8;
const SAMPLE_MOTTO = "Per libros ad astra";
const options = <T extends string>(keys: readonly T[], labels: Record<T, string>) => keys.map((value) => ({ value, label: labels[value] }));
const TRAIT_OPTIONS = options(TRAITS, TRAIT_LABELS);
const LAYOUT_OPTIONS = options(LAYOUTS, LAYOUT_LABELS);
const PRINT_OPTIONS = options(CARD_PRINTS, PRINT_LABELS);

function TileRow<T extends string>({ items, width, value, labels, onPick }: { items: Array<{ option: T; input: ReaderCardBase }>; width: number; value: T | null; labels: Record<T, string>; onPick: (option: T) => void }) {
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(item) => item.option}
      initialNumToRender={3}
      windowSize={3}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      renderItem={({ item }) => (
        <Tile width={width + TILE_PADDING} tileWidth={width + TILE_PADDING} height={width * cardRatio(item.input.crop) + TILE_PADDING} label={labels[item.option]} selected={value === item.option} onPress={() => onPick(item.option)}>
          <ReaderCardImage input={item.input} width={width} />
        </Tile>
      )}
    />
  );
}

function ChipRow<T extends string>({ keys, labels, value, onPick }: { keys: readonly T[]; labels: Record<T, string>; value: T; onPick: (option: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {keys.map((key) => <Chip key={key} label={labels[key]} selected={value === key} onPress={() => onPick(key)} />)}
    </ScrollView>
  );
}

export function ReaderCardOptions({ input, onChange }: { input: ReaderCardBase; onChange: SaveStyle }) {
  const { counter, trait, layout, motto, footer, corners, print } = input.style;
  const [look, setLook] = useState<MottoLook>(motto?.look ?? "ribbon");
  const counterThumbs = useMemo(() => COUNTERS.map((option) => ({ option, input: counterThumbnail(input, option) })), [input]);
  const mottoThumbs = useMemo(() => MOTTO_LOOKS.map((option) => ({ option, input: styleThumbnail(input, { motto: { text: motto?.text ?? SAMPLE_MOTTO, look: option } }, "motto") })), [input, motto?.text]);
  const cornerThumbs = useMemo(() => CORNER_STYLES.map((option) => ({ option, input: styleThumbnail(input, { corners: option }, "corner") })), [input]);
  const pickLook = (next: MottoLook) => {
    setLook(next);
    if (motto) void onChange({ motto: { text: motto.text, look: next } });
  };
  return (
    <>
      <Section title="Counter">
        <TileRow items={counterThumbs} width={THUMB_WIDTH} value={counter} labels={COUNTER_LABELS} onPick={(next) => void onChange({ counter: next })} />
      </Section>
      <Section title="Second trait">
        <Segmented accessibilityLabel="Second trait" options={TRAIT_OPTIONS} value={trait} onChange={(next) => void onChange({ trait: next })} />
      </Section>
      <Section title="Motto">
        <DraftField label="Your motto" initial={motto?.text ?? null} max={MOTTO_MAX} onSave={(text) => onChange({ motto: text ? { text, look } : null })} />
        <TileRow items={mottoThumbs} width={THUMB_WIDTH} value={motto?.look ?? look} labels={MOTTO_LOOK_LABELS} onPick={pickLook} />
      </Section>
      <Section title="Footer, left">
        <ChipRow keys={FOOTER_LEFTS} labels={FOOTER_LEFT_LABELS} value={footer.left} onPick={(left) => void onChange({ footer: { ...footer, left } })} />
      </Section>
      <Section title="Footer, right">
        <ChipRow keys={FOOTER_RIGHTS} labels={FOOTER_RIGHT_LABELS} value={footer.right} onPick={(right) => void onChange({ footer: { ...footer, right } })} />
      </Section>
      <Section title="Corners">
        <TileRow items={cornerThumbs} width={CORNER_WIDTH} value={corners} labels={CORNER_LABELS} onPick={(next) => void onChange({ corners: next })} />
      </Section>
      <Section title="Print">
        <Segmented accessibilityLabel="Print" options={PRINT_OPTIONS} value={print} onChange={(next) => void onChange({ print: next })} />
      </Section>
      <Section title="Layout">
        <Segmented accessibilityLabel="Layout" options={LAYOUT_OPTIONS} value={layout} onChange={(next) => void onChange({ layout: next })} />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({ row: { gap: spacing.sm } });
```

In `ReaderCardEditorScreen.tsx`, pass `onChange={change}` to `ReaderCardOptions` instead of `(patch) => void change(patch)`.

- [ ] **Step 3: Verify mobile**

Run: `npm run build -w @scripta/shared && EXPO_PUBLIC_API_URL=http://localhost:3000 npm run typecheck -w mobile && EXPO_PUBLIC_API_URL=http://localhost:3000 npm test -w mobile && (cd mobile && npx expo-doctor)`
Expected: PASS, including `textImports.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add mobile && git commit -m "Add motto, footer, corners and print to the mobile reader card editor

Motto looks and corners scroll as lazy rows of cropped thumbnails and
the footer as chip rows; the note and the motto share one DraftField,
which flushes on unmount like the note did.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 14: Check it on screen and ship A5

**Files:** none. This task verifies the branch and opens the PR.

- [ ] **Step 1: Web check**

1. Run `npm run dev:claim`, then seed the fixture:

   ```bash
   node --input-type=module -e 'const m = await import("./scripts/devFixtureSetup.mjs"); m.seedDevAccount(false, console.log); m.seedFixtureUsers(console.log); m.seedCommunityGraph(console.log);'
   ```

2. Add a launch entry `api-dev` that runs `npm run backend` with `devDataDirEnv()` (`scripts/devDataDir.mjs`) merged into its `env`. Start it with `preview_start`, then start `web`.
3. Sign in as `scripta_dev`. Read the password with exactly `node -e 'process.stdout.write(require("./scripts/fixtures/account.json").password)'` from the worktree root, fill it into the login form in the preview pane, and never repeat it.
4. Open `/dashboard/reader-card` and check:
   - **Motto:** type one. The preview shows it after about 600 ms. Pick each look: the arc and the wavy ribbon follow their curves, centred. Type 28 "W"s: every look stays inside its slot. Clear the field: the motto disappears.
   - **Footer:**
     - Pick each left chip. Reader since, volumes and the others print their facts.
     - Reader number shows `Nº …` after its request.
     - Genre shows the lead genre or falls back to PLATE.
   - **Right chips:** for `scripta_dev`, name parts give `SCRIPTA` / `DEV` / `S. D.`, and signature draws in Pinyon Script.
   - **Corners:** each thumbnail matches the preview, and `none` removes them.
   - **Print:** `Reversed` stays reversed on the light theme, `Paper` stays paper on the dark one, and `Follow theme` toggles with the theme.
   - **Visitors preview:** with the reader number chosen it shows the number. Then check a visitor's view through a shared mural: the number appears only while that footer is chosen.
   - **Light and dark themes.**
   - **Layout:** the preview width stays about 18rem.
5. Restore the fixture account's style to its defaults when you finish (Print `Follow theme`, every option back to its first choice, motto cleared).

- [ ] **Step 2: Device pass**

Run `node scripts/dev-status.mjs --json` once. If no other worktree holds the emulator, dispatch `device-checker` for the mobile editor and the My shelf block:
- The motto field, plus the look row scrolling and picking. Arc and wavy text centred on its curve. A 28-character motto inside each look.
- Footer chip rows, with a reader number and a signature in Pinyon Script.
- Corner tiles not clipped.
- Print fixed against the theme.
- Light and dark themes.
- No Android text clipping in the chips.

The web check and the device pass share the `scripta_dev` account. Run them one after the other, not at the same time, because the backend rate limit (120/min) counts both.

- [ ] **Step 3: Ship**

1. Run the `security-review` skill. The branch exposes the reader number (sign-up order) to visitors and adds an owner endpoint.
2. Run `branch-reviewer` with this plan and the spec.
3. Push, and open the PR "Reader card A5: decoration" against `main`. Attach the contact sheet pages (`npm run sheet -w @scripta/shared`) as screenshots or an artifact, as the spec asks.
4. Enable `--auto` after the device pass, or after recording that it was skipped.
5. Add a deploy note:
   - Production must run the backend from this PR before the mobile OTA ships.
   - Deploying is the owner's call.
