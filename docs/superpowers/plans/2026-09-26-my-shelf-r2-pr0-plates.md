# My shelf release 2, PR 0: plate port and review. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the reader-card plate generator into `@scripta/shared` unchanged, add the `renderPlate` / `renderGlyph` API that clients will call, and make the `design/` masters output of that code. The user then reviews the set.

**Architecture:**
- `design/reader-cards/plates.mjs` becomes `packages/shared/src/readerCards/plates.ts`, a TypeScript port with identical output.
- A thin `render.ts` beside it maps a card state (settled, leaning or unwritten) and a print state (paper or reversed) onto the existing `plate()` / `glyph()` / `printStyle()` functions. It returns self-contained SVG strings.
- `design/reader-cards/generate.mjs` imports the built package.

**Tech Stack:** TypeScript, `node:test` via tsx (shared package), plain Node ESM for the generator script.

**Spec:** `docs/superpowers/specs/2026-09-26-my-shelf-release-2-design.md`, section "0. Plate port and review".

## Global Constraints

- **No visual change in the port.** `plate()`, `glyph()` and `printStyle()` must produce the same strings as `design/reader-cards/plates.mjs` today. The committed masters in `design/reader-cards/*.svg` are the reference.
- No code comments; the why goes in commit messages. No new packages.
- Text in plates stays live `<text>`. Paper is `#f1eadb`, and the inks are exactly `INKS` as defined today.
- **Card states:**
  - **Settled** prints eyebrow `THE`.
  - **Leaning** prints eyebrow `LEANING TOWARD` with the leading identity's emblem, ink and name.
  - **Unwritten** uses key and emblem `none` with graphite ink, eyebrow `NOT YET`, name `Unwritten`, and numeral `—`. Its epithet is the caller's short "what would change it" line, default `five finished books to begin`.
- The reader's name prints uppercase in the plate foot.
- In a worktree session, run git as `/usr/bin/git …` from the worktree root, and don't run `npm install`.

## Rulings made while planning

- **Where the phone check happens.** The spec asked for "an Android emulator screenshot of a plate at card size and of a glyph next to a username" on the review page. No app screen renders a plate until PR 2, and building a throwaway screen for a screenshot is waste. So the review page shows each plate and glyph at phone size in a browser at 390px width. PR 2's first mobile task does the emulator check, including whether Playfair Display resolves in `SvgXml`. The cost is that the review sees browser rendering, not Android's.
- **How Leaning and Unwritten are drawn.** They reuse `plate()`'s existing `eyebrow`, `emblem` and `numeral` options, exactly as the 2026-09-24 review page drew them. There's no new drawing code.

---

### Task 1: Port the generator and add the render API

**Files:**
- Create: `packages/shared/src/readerCards/plates.ts` (port of `design/reader-cards/plates.mjs`)
- Create: `packages/shared/src/readerCards/render.ts`
- Create: `packages/shared/src/readerCards/index.ts`
- Create: `packages/shared/src/readerCards/plates.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./readerCards/index.js";`)
- Modify: `packages/shared/package.json` (`exports` gains `"./readerCards": { "types": "./dist/readerCards/index.d.ts", "default": "./dist/readerCards/index.js" }`)

**Interfaces:**
- Produces:
  - `type IdentityKey = "carto" | "anno" | "lamp" | "star" | "arch" | "corr" | "way" | "loyal"`;
  - `READER_PLATES: readonly { key: IdentityKey; name: string; epithet: string; numeral: string }[]` (today's `PLATES`);
  - `PLATE_INKS` (today's `INKS`), `PLATE_PAPER`, `PLATE_REVERSED_LINE`;
  - `renderPlate(opts: RenderPlateOptions): string` and `renderGlyph(identity: IdentityKey, size: number, print: PlatePrint): string`;
  - `type PlatePrint = "paper" | "reversed"`;
  - `type CardState = "settled" | "leaning" | "unwritten"`;
  - `interface RenderPlateOptions { identity: IdentityKey | null; state: CardState; readerName: string; print: PlatePrint; label: string; unwrittenLine?: string; width?: number }`.
- Also exported, for the generator script only: `plate`, `glyph`, `printStyle` (unchanged signatures).

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/readerCards/plates.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PLATE_INKS, PLATE_PAPER, PLATE_REVERSED_LINE, READER_PLATES, glyph, plate, printStyle, renderGlyph, renderPlate } from "./index.js";

const masters = join(dirname(fileURLToPath(import.meta.url)), "../../../../design/reader-cards");
const standalone = (svg: string, ground: string, line: string) => svg.replace(">", `>${printStyle(ground, line)}`);
const master = (name: string) => readFileSync(join(masters, name), "utf8");

test("the port reproduces every committed master byte for byte", () => {
  for (const p of READER_PLATES) {
    const [, ink, deep] = PLATE_INKS[p.key];
    const base = `${p.numeral.toLowerCase()}-${p.key}`;
    const card = plate({ ...p, label: `The ${p.name} reader card` });
    assert.equal(standalone(card, PLATE_PAPER, ink), master(`${base}-paper.svg`), `${base}-paper`);
    assert.equal(standalone(card, deep, PLATE_REVERSED_LINE), master(`${base}-reversed.svg`), `${base}-reversed`);
    assert.equal(standalone(glyph(p.key, 48), PLATE_PAPER, ink), master(`${base}-glyph.svg`), `${base}-glyph`);
  }
});

test("a settled plate prints THE, the identity's ink and the reader's name", () => {
  const svg = renderPlate({ identity: "star", state: "settled", readerName: "scripta_dev", print: "paper", label: "Reader card: the Stargazer" });
  assert.match(svg, />THE</);
  assert.match(svg, />Stargazer</);
  assert.match(svg, />SCRIPTA_DEV</);
  assert.match(svg, new RegExp(PLATE_INKS.star[1]));
  assert.match(svg, /aria-label="Reader card: the Stargazer"/);
});

test("a leaning plate prints LEANING TOWARD over the leading identity", () => {
  const svg = renderPlate({ identity: "carto", state: "leaning", readerName: "a", print: "paper", label: "x" });
  assert.match(svg, />LEANING TOWARD</);
  assert.match(svg, />Cartographer</);
});

test("an unwritten plate is graphite with an empty cartouche and the given line", () => {
  const svg = renderPlate({ identity: null, state: "unwritten", readerName: "a", print: "paper", label: "x", unwrittenLine: "finish 2 more books" });
  assert.match(svg, />Unwritten</);
  assert.match(svg, />NOT YET</);
  assert.match(svg, />finish 2 more books</);
  assert.match(svg, />PLATE —</);
  assert.match(svg, new RegExp(PLATE_INKS.graph[1]));
  assert.match(renderPlate({ identity: null, state: "unwritten", readerName: "a", print: "paper", label: "x" }), />five finished books to begin</);
});

test("reversed print uses the deep ink as ground and the reversed line", () => {
  const svg = renderPlate({ identity: "way", state: "settled", readerName: "a", print: "reversed", label: "x" });
  assert.match(svg, new RegExp(PLATE_INKS.way[2]));
  assert.match(svg, new RegExp(PLATE_REVERSED_LINE));
});

test("renderGlyph is self-contained at the requested size", () => {
  const svg = renderGlyph("loyal", 24, "paper");
  assert.match(svg, /width="24" height="24"/);
  assert.match(svg, /<style>/);
});

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

test("every ink clears 5:1 against paper", () => {
  for (const [key, [, ink]] of Object.entries(PLATE_INKS)) {
    const ratio = (luminance(PLATE_PAPER) + 0.05) / (luminance(ink) + 0.05);
    assert.ok(ratio >= 5, `${key} is ${ratio.toFixed(2)}:1`);
  }
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test --workspace @scripta/shared`
Expected: FAIL, because `./index.js` doesn't exist.

- [ ] **Step 3: Port `plates.mjs` to `plates.ts`**

Copy `design/reader-cards/plates.mjs` to `packages/shared/src/readerCards/plates.ts`, then:
- Add types only: `[number, number]` for points, and `string` for path data. Type `INKS` as `Record<IdentityKey | "graph", readonly [string, string, string]>`, and `PLATES` as `readonly { key: IdentityKey; name: string; epithet: string; numeral: string }[]`.
- Keep every numeric literal, string template and function body as it is. Output must not change.
- Export the existing names plus the aliases `READER_PLATES = PLATES`, `PLATE_INKS = INKS`, `PLATE_PAPER = PAPER` and `PLATE_REVERSED_LINE = REVERSED_LINE`.
- `emblems` has a `none` entry, and `plate()`'s `key` must accept `"none"` for the Unwritten plate. Widen its type to `IdentityKey | "none"`.
- Add `.id-none` handling only if `printStyle` needs it. The standalone style sets classes, not ids, so it probably doesn't. The byte-equality test is the arbiter.

Resolve any strict-mode errors (`noUncheckedIndexedAccess`, implicit any) with types or non-null assertions, never by changing an expression's value.

- [ ] **Step 4: Write `render.ts` and `index.ts`**

`packages/shared/src/readerCards/render.ts`:

```ts
import { INKS, PAPER, PLATES, REVERSED_LINE, glyph, plate, printStyle, type IdentityKey } from "./plates.js";

export type PlatePrint = "paper" | "reversed";
export type CardState = "settled" | "leaning" | "unwritten";

export interface RenderPlateOptions {
  identity: IdentityKey | null;
  state: CardState;
  readerName: string;
  print: PlatePrint;
  label: string;
  unwrittenLine?: string;
  width?: number;
}

function inks(key: IdentityKey | "graph", print: PlatePrint): [string, string] {
  const [, ink, deep] = INKS[key];
  return print === "paper" ? [PAPER, ink] : [deep, REVERSED_LINE];
}

const withStyle = (svg: string, [ground, line]: [string, string]) => svg.replace(">", `>${printStyle(ground, line)}`);

export function renderPlate({ identity, state, readerName, print, label, unwrittenLine, width }: RenderPlateOptions): string {
  const reader = readerName.toUpperCase();
  if (state === "unwritten" || !identity) {
    const svg = plate({ key: "none", emblem: "none", name: "Unwritten", eyebrow: "NOT YET", epithet: unwrittenLine ?? "five finished books to begin", numeral: "—", reader, width, label });
    return withStyle(svg, inks("graph", print));
  }
  const p = PLATES.find((item) => item.key === identity)!;
  const svg = plate({ ...p, eyebrow: state === "leaning" ? "LEANING TOWARD" : "THE", reader, width, label });
  return withStyle(svg, inks(identity, print));
}

export function renderGlyph(identity: IdentityKey, size: number, print: PlatePrint): string {
  return withStyle(glyph(identity, size), inks(identity, print));
}
```

`packages/shared/src/readerCards/index.ts`:

```ts
export * from "./plates.js";
export * from "./render.js";
```

Wire `packages/shared/src/index.ts` and `package.json` `exports` as listed under Files.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared`
Expected: PASS, including the byte-for-byte master test and every existing test.

If a master comparison fails only because of whitespace, the spec allows it, but report the exact difference rather than normalising silently.

- [ ] **Step 6: Typecheck the consumers**

Run: `npm run typecheck --workspace mobile && npm run typecheck --workspace frontend && npm run typecheck --workspace backend`
Expected: PASS. The new names mustn't clash with existing exports; check `IdentityKey` and `glyph` against `@scripta/shared`'s root exports.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add packages/shared
/usr/bin/git commit -m "Shared: the reader-card plate generator and render API"
```

The body says why: the plates move from design scratch into shipping code, so the app and the masters share one source, and `renderPlate` gives clients one call per card state and print state.

---

### Task 2: Generate the masters from the shared package

**Files:**
- Modify: `design/reader-cards/generate.mjs`
- Delete: `design/reader-cards/plates.mjs`

- [ ] **Step 1: Point the script at the built package**

In `generate.mjs`, replace the `./plates.mjs` import with the built shared module:

```js
import { INKS, PAPER, PLATES, REVERSED_LINE, glyph, plate, printStyle } from "../../packages/shared/dist/readerCards/plates.js";
```

Keep the rest of the script as it is.

- [ ] **Step 2: Regenerate and confirm nothing changed**

```bash
npm run build --workspace @scripta/shared
node design/reader-cards/generate.mjs
/usr/bin/git status --short design/reader-cards
```

Expected: no `.svg` file shows as modified.

- [ ] **Step 3: Remove the old generator and commit**

```bash
/usr/bin/git rm design/reader-cards/plates.mjs
/usr/bin/git add design/reader-cards/generate.mjs
/usr/bin/git commit -m "Generate the reader-card masters from @scripta/shared"
```

---

### Task 3 (controller): The review page

This is done by the controller session, not an implementer. After Tasks 1–2 are reviewed:
- Build a private review page (Artifact) from `renderPlate` / `renderGlyph` output.
- It shows:
  - all eight plates, settled, in paper and reversed;
  - a Leaning plate and an Unwritten plate;
  - the glyphs at 24, 32 and 48px, in both themes and in one ink;
  - each plate and glyph at phone size in a 390px-wide frame, including a glyph next to a sample username in a feed-row mock.
- The page asks for notes per plate through comments.
- Edits requested by the user go to an implementer as generator changes in `plates.ts`, with the master test updated deliberately, and the page is republished.
- PR 0 merges once the user approves the set.

---

## Self-review

- **Spec coverage:** the port with no visual change (Task 1, byte-equality test); masters regenerated from shipping code (Task 2); the review page and user sign-off (Task 3). The emulator screenshot is deferred to PR 2 by ruling.
- **Types:** `IdentityKey`, `CardState`, `PlatePrint` and `RenderPlateOptions` are defined in Task 1. PR 1 (`readerIdentity`) must import `IdentityKey` from here, not redefine it.
