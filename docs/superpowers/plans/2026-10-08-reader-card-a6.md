# Reader card A6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner give the reader card one of 12 finishes: plain, aged, linen, letterpress, foil, holographic, vellum, watercolour, gilt edge, stamp, kraft and riso. Foil, holographic and gilt also get a live shine: it follows the pointer on web and the phone's tilt on mobile, and stays still under reduced motion. Every finish is drawn on web and mobile, previewed in the editor and shown to visitors.

**Architecture:**
- **Shared (`@scripta/shared`):**
  - `style.ts` gains `FINISHES` and the `finish` field, and `labels.ts` names the options.
  - The print rules move from `render.ts` into a new `paint.ts`. It also gains a colour `mix`.
  - `compose.ts` gains three things:
    - a `frame` slot;
    - an exported `cornerMarkup`;
    - an optional ink wrapper around everything from the frame to the footer.
  - A bake script writes 5 grey PNG tiles into `textures.ts`.
  - A new `finishes.ts` turns a finish into four things: a palette (ground and ink, where the ink may be a `url(#…)` gradient), compose slots (underlay, overlay, frame, corners), and an optional ink wrapper that adds copies, a mask or a rotation.
  - `render.ts` asks `finishes.ts` for these and composes with them.
  - A new `shine.ts` says which finishes shine and holds the shine gradient.
  - The `plain` finish adds no markup, so the default card stays byte-identical.
- **Backend:** the PATCH schema accepts `finish`. `publicStyle` already carries it to visitors once the field exists.
- **Clients:**
  - Each editor gains a Finish section of 12 thumbnails between Corners and Print.
  - Each turner draws a `CardShine` over the front face when the finish shines:
    - on web, it follows the pointer and sweeps slowly when idle;
    - on mobile, it follows Reanimated's gravity sensor in the full-screen viewer and is a still band elsewhere.

**Tech Stack:** TypeScript, `node:test` via tsx, `node:zlib` for the PNG encoder, Fastify + zod (backend), React 19 + Tailwind 4 (web, SSR tests), Expo Router / React Native 0.86 + react-native-svg 15.15.4 + Reanimated 4.5.1 (mobile).

**Spec:** `docs/superpowers/specs/2026-10-07-reader-card-enrichment-design.md`, these sections:
- "Front": layer order and the Finish table.
- "Renderer": `finishes.ts`, `textures.ts`, the portable subset, determinism and the contact sheet.
- "Clients": `ReaderCardViewer` (shine and reduced motion) and the Editor.
- The A6 row of "Phases", "Risks" and "A0 findings".

**Starting point:**
- A5 (#214) and the thumbnail perf work (#215) are on `main`.
- The editor-layout branch `claude/hello-e28136` (#216, merged) pins the preview and turns the mobile `TileRow` into a 4-column grid.
- The branch `claude/reader-card-sheets` must be merged to `main` first. On mobile it:
  - moves the 12-option sections into an inline panel below the pinned card (`PanelId`, `ReaderCardPanel`, `TileRow`'s `available` width prop);
  - groups the options by face and turns the card to the face being edited;
  - removes the You/Visitors toggle;
  - changes `PRINT_LABELS` to Auto/Light/Dark.

  Task 7 builds on that. The current version of this plan is committed on that branch.
- Cut the A6 worktree from `origin/main` after that merge.

## Decisions this plan takes

The spec is silent on these, A0 left them open, or the code makes the spec's wording impractical. Each one is final for A6.

1. **Letterpress uses no filter.** A0 could not see the offset/flood/composite filter, and the spec allows a fallback. Letterpress draws a copy of the ink group in a highlight colour, offset by (0.6, 0.7) under the ink, on a cotton-fibre paper. No re-probe.
2. **No sharp.** The spec says the bake script uses sharp, but sharp is only a backend dependency. The bake script encodes grey PNGs with `node:zlib` (`deflateSync`, `crc32`), so `@scripta/shared` gains no dependency.
3. **One grey tile per texture, used as a luminance mask.** Each texture is drawn as a colour rectangle masked by its tile pattern, so one tile serves both prints and any tint. The A0 "faint mask" finding is handled by high-contrast tiles: the speckle tile is pure black holes on white.
4. **Back pages keep the finish's paper, not its ink.** The chosen, record and merged pages get the finish's ground, underlay, overlay and gilt frame. Their ink stays a plain colour, with no copies, mask or rotation, so the record rows stay legible.
5. **Where the shine shows.**
   - It shows over the front face of the turner: in the full-screen viewer and in the editor preview.
   - The mural block and the editor thumbnails never shine.
   - On mobile, the rotation sensor runs only in the full-screen viewer (`liveShine`). The editor preview shows a still band.
   - On web, the shine follows the pointer and sweeps slowly when idle, only under `prefers-reduced-motion: no-preference`.
6. **The trait seal and the footer glyph keep their own plain inks** under every finish, because they are styled before composition.
7. **Finish thumbnails are the whole card**, with no crop, like the counter thumbnails.
8. **Gilt paints gold** on the frame (through the new `frame` slot), on the corners (through the `corners` slot, styled before composition) and on a new edge line in the overlay.
9. **Riso's second ink** is the streak's plate ink. Without a streak it is riso red `#e4572e`.
10. **A missing or unknown finish draws plain paper.** `normalizeReaderCardStyle` falls back to `paper`, and the renderer does too for a style object without `finish`. That covers payloads from a backend older than A6.
11. **Watercolour washes the seal only when the seal is drawn.** Its washes are the emblem, the name and, when shown, the seal.
12. **The `paper` finish is labelled "Plain"**, because the Print control already has a "Paper" option.
13. **Not in A6:** server rendering of finishes (D), the shine in the contact sheet (it is a client layer), and the collisions A5 accepted.

## Global Constraints

- **Code style:**
  - No comments in code (`AGENTS.md`).
  - Search with `rg`. Run git from the worktree root.
  - Stage and commit in one command, and say why in the commit body.
- **Shared builds:**
  - Run `npm run dev:link-deps` once per worktree.
  - Run `npm run build -w @scripta/shared` before any backend, frontend or mobile typecheck or test, because consumers read `packages/shared/dist`.
- **Finishes (exact, in this order):**
  ```ts
  ["paper", "aged", "linen", "letterpress", "foil", "holo", "vellum", "watercolor", "gilt", "stamp", "kraft", "riso"]
  ```
  The default is `"paper"`.
- **Labels:** exactly as in Task 1's `FINISH_LABELS`.
- **Card geometry:**
  - viewBox `0 0 250 350`, ground `rx="4"`.
  - Rings centre (125, 134); seal radius 64 at `SEAL_ANGLE`.
  - Name baseline y = 247.
- **Ids:**
  - Every id is `rc-<letters>-<seed>-<print>`. `portable.test.ts` enforces it.
  - Finish id names must not equal a motto look name (`ribbon`, `scroll`, `arc`, `rule`, `sash`, `script`, `plaque`, …). This plan uses `agedVignette`, `linenWeave`, `vellumVignette`, `wash`, `foilInk`, `holoInk`, `holoSheen`, `goldInk`, `speckleTile`, `stampMask`, and `<texture>Tile`/`<texture>Mask`.
- **References:** every `url(#…)` and `href="#…"` must point at an id defined in the same SVG.
- **Gradients:** every gradient used on ink uses `gradientUnits="userSpaceOnUse"` and spans (0,0)–(250,350). Horizontal rules have zero-height bounding boxes, so an `objectBoundingBox` gradient would paint them with nothing.
- **Defaults:** the `paper` finish returns the print's own palette and no slots, so default cards, `plates.test.ts` masters and the landing page stay byte-identical.
- **Portability:** react-native-svg 15.15.4. Never use:
  - `<style>`, SMIL, `feTurbulence`, `feDisplacementMap`, `feImage`, `foreignObject`, `mix-blend-mode`;
  - a leftover `class`, a nested `<svg>`;
  - an `href` other than `data:`, the one signature cover, or an own id.
- **Determinism:** all randomness comes from `random(seedOf(...))` (`./seed.js`), keyed on the card's `seed`.
- **Web:**
  - Animation only inside `@media (prefers-reduced-motion: no-preference)`. `frontend/scripts/test-motion-css.mts` checks it.
  - The token scanners in `frontend/scripts/test-*.mts` stay green.
- **Mobile:**
  - `Text` only from `mobile/src/ui/Text`.
  - Rules of React (reactCompiler).
  - No new native dependency: `useAnimatedSensor` ships in Reanimated, so this goes over the air.
- **Backend tests:** keep the env preamble (`process.env.*` before imports).
- **Node:** `zlib.crc32` needs Node ≥ 22.2. The repo runs 26.

## Review Focus

1. **A style without `finish`.** This covers pre-A6 stored rows, a pre-A6 backend serving visitors, and an unknown value from a newer client. Each draws plain paper and never throws. Pinned in Task 1 ("a finish must be one of the twelve…") and Task 4 ("a style without a finish draws exactly the plain card").
2. **A finish with an arc or wavy motto.** The ink copies (riso, letterpress) must not duplicate the motto's path ids, and the copied `<textPath>` must still find its curve. Pinned in Task 5 ("ink copies keep every id unique…").
3. **Stamp's rotation must not clip the card's corners or frame.** The mask region extends 10 units past the card on every side. Pinned in Task 5 ("stamp breaks and tilts the front ink…").
4. **Back pages under ink finishes stay legible:** plain ink, no copies, mask or rotation. Pinned in Task 4 ("back pages keep the finish's paper") and Task 5 ("foil and holo print the front in a gradient ink, and the back in plain ink", and the stamp test).
5. **Reduced motion.** There is no idle sweep, no pointer-follow and no sensor. Pinned in Task 6 (`test-motion-css.mts`, and `CardShine` returning early) and Task 7 ("the shine reads the rotation sensor only when live and motion is allowed").

---

### Task 1: The finish option, its labels, and the server accepting it

**Files:**
- Modify: `packages/shared/src/readerCards/style.ts`
- Modify: `packages/shared/src/readerCards/labels.ts`
- Modify: `packages/shared/src/readerCards/index.ts:10`
- Modify: `backend/src/modules/library/routes.ts:4,98-109`
- Modify: `backend/README.md:88`
- Test: `packages/shared/src/readerCards/style.test.ts`
- Test: `backend/src/modules/library/routes.test.ts`
- Test: whatever deep-equals a whole style. Find them with `rg -n 'print: "auto"' --glob '*.test.ts' --glob '*.mts' backend frontend mobile packages`.

**Interfaces:**
- Produces:
  ```ts
  export const FINISHES: readonly ["paper", "aged", "linen", "letterpress", "foil", "holo", "vellum", "watercolor", "gilt", "stamp", "kraft", "riso"];
  export type Finish = (typeof FINISHES)[number];
  // ReaderCardStyle and PublicReaderCardStyle gain `finish: Finish`
  export const FINISH_LABELS: Record<Finish, string>;
  ```

- [ ] **Step 1: Write the failing shared tests**

In `style.test.ts`:
- add `FINISHES` to the `./style.js` import and `FINISH_LABELS` to the `./labels.js` import;
- change `PUBLIC_DEFAULTS` to `{ motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", finish: "paper", print: "auto" }`;
- then add:

```ts
test("a finish must be one of the twelve; anything else, or none, is plain paper", () => {
  assert.equal(FINISHES.length, 12);
  assert.equal(normalizeReaderCardStyle({ finish: "foil" }).finish, "foil");
  assert.equal(normalizeReaderCardStyle({ finish: "neon" }).finish, "paper");
  assert.equal(normalizeReaderCardStyle({}).finish, "paper");
  assert.equal(publicStyle(normalizeReaderCardStyle({ finish: "gilt" })).finish, "gilt");
  assert.deepEqual(Object.keys(FINISH_LABELS), [...FINISHES]);
  assert.equal(FINISH_LABELS.paper, "Plain");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL. `FINISHES` is not exported, and the default deep-equal is missing `finish`.

- [ ] **Step 3: Add the option**

In `style.ts`, after the `CARD_PRINTS` lines:

```ts
export const FINISHES = ["paper", "aged", "linen", "letterpress", "foil", "holo", "vellum", "watercolor", "gilt", "stamp", "kraft", "riso"] as const;
export type Finish = (typeof FINISHES)[number];
```

Then:
- Add `finish: Finish;` to `ReaderCardStyle`, after `corners`.
- Add `"finish"` to the `PublicReaderCardStyle` pick.
- Add `finish: "paper"` to `DEFAULT_READER_CARD_STYLE`, after `corners`.
- Add `finish: oneOf(FINISHES, raw.finish, DEFAULT_READER_CARD_STYLE.finish),` in `normalizeReaderCardStyle`, after `corners`.
- Add `finish: style.finish` in `publicStyle`, after `corners`.

In `labels.ts`, import `Finish` with the other types from `./style.js` and add:

```ts
export const FINISH_LABELS: Record<Finish, string> = { paper: "Plain", aged: "Aged", linen: "Linen", letterpress: "Letterpress", foil: "Foil", holo: "Holographic", vellum: "Vellum", watercolor: "Watercolour", gilt: "Gilt edge", stamp: "Stamp", kraft: "Kraft", riso: "Riso" };
```

In `index.ts`, add `FINISH_LABELS` to the `./labels.js` export list.

- [ ] **Step 4: Run the shared tests**

Run: `npm test -w @scripta/shared`
Expected: PASS. If another shared test deep-equals a whole public style (`thumbnail.test.ts`, `readerCard.test.ts`), add `finish: "paper"` to its expectation. Do not change what it tests.

- [ ] **Step 5: Write the failing backend test**

Append to `backend/src/modules/library/routes.test.ts`:

```ts
test("PATCH reader card style stores a finish, keeps the rest, and rejects an unknown one", async () => {
  const { app } = await setup();
  await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { corners: "laurel" } });
  const response = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { finish: "foil" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().finish, "foil");
  assert.equal(response.json().corners, "laurel");
  const bad = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { finish: "neon" } });
  assert.equal(bad.statusCode, 400);
  await app.close();
});
```

Also find the test that asserts a visitor's `readerCard.style` (`rg -n "readerCard.style|style: {" backend/src/modules/library/*.test.ts`). Add `finish: "paper"` to its expected object, and in a copy of that case set `finish: "gilt"` first and assert it reaches the visitor.

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run build -w @scripta/shared && npm test -w backend`
Expected: FAIL. The strict zod schema returns 400 for `{ finish: "foil" }`.

- [ ] **Step 7: Accept the field**

In `routes.ts`, add `FINISHES` to the `@scripta/shared` import on line 4, and add `finish: z.enum(FINISHES).optional(),` to `readerCardStylePatchSchema`, after `corners`.

In `backend/README.md:88`, replace the two stale field lists:
- the stored style becomes "a JSON `{counter, layout, trait, motto, footer, corners, finish, print, signature, highlight}`";
- the visitor style becomes "(`counter`, `layout`, `trait`, `motto`, `footer`, `corners`, `finish` and `print`)".

- [ ] **Step 8: Run everything that reads the style**

Run: `npm run build -w @scripta/shared && npm test -w backend && npm run typecheck -w frontend && npm test -w frontend && npm run typecheck -w mobile && npm test -w mobile`
Expected: PASS. Fix any whole-style deep-equal the `rg` in **Files** found by adding `finish: "paper"`.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/readerCards backend/src/modules/library backend/README.md frontend/scripts mobile/src && git commit -m "Add the reader card finish option

Twelve finishes, stored and served like the other decorations. Unknown or
missing values read as plain paper, so old rows and old clients still draw.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Paint module, frame slot, ink wrapper and the reference guard

**Files:**
- Create: `packages/shared/src/readerCards/paint.ts`
- Modify: `packages/shared/src/readerCards/render.ts:34-54` (move `inks`, `rules`, `withStyle` out)
- Modify: `packages/shared/src/readerCards/compose.ts`
- Modify: `packages/shared/src/readerCards/portable.test.ts:35,42-46`
- Test: `packages/shared/src/readerCards/paint.test.ts` (new)
- Test: `packages/shared/src/readerCards/compose.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // paint.ts
  export function inks(key: IdentityKey | "graph", print: PlatePrint): [string, string];
  export function withStyle(svg: string, palette: [string, string]): string;
  export function mix(a: string, b: string, t: number): string;
  // compose.ts
  export const FRAME_MARKUP: string;
  export function cornerMarkup(slots: PlateSlots): string;
  export type InkWrap = (body: string) => string;
  // PlateSlots gains `frame?: string`
  export function composePlate(face: PlateFace, slots?: PlateSlots, wrapInk?: InkWrap): string;
  ```

- [ ] **Step 1: Write the failing tests**

`paint.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { inks, mix, withStyle } from "./paint.js";

test("mix blends two colours channel by channel", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#ff0000", "#0000ff", 0), "#ff0000");
  assert.equal(mix("#1f4e6b", "#1f4e6b", 0.3), "#1f4e6b");
});

test("withStyle turns print classes into inline rules and refuses an unknown class", () => {
  assert.equal(withStyle(`<rect class="pg"/><path class="pl"/>`, ["#111111", "url(#rc-foilInk-1-paper)"]), `<rect style="fill:#111111"/><path style="stroke:url(#rc-foilInk-1-paper);fill:none"/>`);
  assert.throws(() => withStyle(`<rect class="nope"/>`, ["#000000", "#ffffff"]), /No print rule/);
  assert.deepEqual(inks("star", "paper"), ["#f1eadb", "#5b3b6e"]);
});
```

Append to `compose.test.ts` (add `composePage` to the import):

```ts
test("the ink wrapper holds everything from the frame to the footer, between the underlay and the overlay", () => {
  const svg = composePlate(face, { underlay: `<g id="u"/>`, overlay: `<g id="o"/>` }, (body) => `<g id="ink">\n${body}\n</g>`);
  const inside = svg.slice(svg.indexOf(`<g id="ink">`), svg.indexOf(`<g id="o"/>`));
  for (const part of [`x="10" y="10"`, "EX LIBRIS", `r="60"`, `id="emblem"`, ">ANDRE<"]) assert.ok(inside.includes(part), part);
  assert.ok(svg.indexOf(`id="u"`) < svg.indexOf(`id="ink"`));
  assert.doesNotMatch(inside, /id="u"|id="o"/);
});

test("without a wrapper the plate is unchanged", () => {
  const slots = { underlay: `<g id="u"/>`, top: `<g id="t"/>` };
  assert.equal(composePlate(face, slots, (body) => body), composePlate(face, slots));
});

test("a frame slot replaces both frame rules on the front and on a back page", () => {
  for (const svg of [composePlate(face, { frame: `<g id="gold"/>` }), composePage(face, "<g/>", { frame: `<g id="gold"/>` })]) {
    assert.match(svg, /<g id="gold"\/>/);
    assert.doesNotMatch(svg, /x="10" y="10"/);
  }
});
```

In `portable.test.ts`, replace the guard test at lines 42-46 with:

```ts
test("the guard counts every remote image and lets url(#…) point only at the card's own ids", () => {
  const twoImages = `<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="https://a.example/b" width="1"/><image x="2" href="https://a.example/c"/></svg>`;
  assert.deepEqual(portabilityProblems(twoImages), ["more than one remote image"]);
  assert.deepEqual(portabilityProblems(`<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url( #a)"/></svg>`), ["url(#a)"]);
  assert.deepEqual(portabilityProblems(`<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="rc-foilInk-1-paper"/></defs><rect style="fill:url(#rc-foilInk-1-paper)"/></svg>`), []);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL. `./paint.js` is missing, `composePage` has no frame slot, and the guard still rejects every `url(#…)`.

- [ ] **Step 3: Implement**

`paint.ts` takes the three functions out of `render.ts` unchanged, plus `mix`:

```ts
import { INKS, PAPER, REVERSED_LINE, type IdentityKey } from "./plates.js";
import type { PlatePrint } from "./render.js";

export function inks(key: IdentityKey | "graph", print: PlatePrint): [string, string] {
  const [, ink, deep] = INKS[key];
  return print === "paper" ? [PAPER, ink] : [deep, REVERSED_LINE];
}

const rules = (g: string, l: string): Record<string, string> => ({
  pg: `fill:${g}`, pgf: `fill:${g}`, gg: `fill:${g}`,
  pf: `fill:${l}`, pt: `fill:${l}`, gd: `fill:${l}`, gi: `fill:${l}`,
  pl: `stroke:${l};fill:none`, gk: `stroke:${l};fill:none`,
  pgs: `stroke:${g};fill:none`, gr: `stroke:${g};fill:none`, gs: `stroke:${g};fill:none`,
  pgl: `fill:${g};stroke:${l}`,
});

export function withStyle(svg: string, [g, l]: [string, string]): string {
  const r = rules(g, l);
  return svg.replace(/<[^>]*>/g, (tag) => tag.replace(/ class="(\w+)"/g, (_, c: string) => {
    const style = r[c];
    if (!style) throw new Error(`No print rule for class "${c}"`);
    return ` style="${style}"`;
  }));
}

export function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, "0")).join("")}`;
}
```

In `render.ts`, delete `inks`, `rules` and `withStyle`. Import `inks` and `withStyle` from `./paint.js`, and drop `PAPER` and `REVERSED_LINE` from the `./plates.js` import if they are now unused.

In `compose.ts`:

```ts
// PlateSlots: add `frame?: string;` before `frameBand`
export const FRAME_MARKUP = [`<rect class="pl" x="10" y="10" width="230" height="330" stroke-width="1.6"/>`, `<rect class="pl" x="16" y="16" width="218" height="318" stroke-width=".6"/>`].join("\n");
export const cornerMarkup = (slots: PlateSlots) => slots.corners ?? `<path class="pf" d="${DIAMONDS}"/>`;
export type InkWrap = (body: string) => string;
const bare: InkWrap = (body) => body;

export function composePlate(face: PlateFace, slots: PlateSlots = {}, wrapInk: InkWrap = bare): string {
  const ink = join([
    slots.frame ?? FRAME_MARKUP,
    slots.frameBand,
    cornerMarkup(slots),
    slots.header ?? EX_LIBRIS,
    slots.top,
    `<circle class="pl" cx="125" cy="134" r="60" stroke-width="1.4"/>`,
    `<circle class="pl" cx="125" cy="134" r="55" stroke-width=".6"/>`,
    slots.rings,
    face.emblemSvg,
    slots.seal,
    slots.banner,
    `<text class="pt" x="125" y="220" text-anchor="middle" font-size="8" letter-spacing="3" font-family="${SANS}" font-weight="600">${face.eyebrow}</text>`,
    `<text class="pt" x="125" y="247" text-anchor="middle" font-size="25" font-family="${SERIF}">${face.name}</text>`,
    `<path class="pl" d="M82 263H117M133 263H168" stroke-width=".8"/><circle class="pf" cx="125" cy="263" r="2"/>`,
    `<text class="pt" x="125" y="283" text-anchor="middle" font-size="11" font-style="italic" font-family="${SERIF}">${face.epithet}</text>`,
    slots.trait,
    ...footer(face, slots),
  ]);
  return join([openSvg(face), GROUND, slots.underlay, wrapInk(ink), slots.overlay, `</svg>`]);
}

export function composePage(face: PlateFace, body: string, slots: PlateSlots = {}): string {
  return join([openSvg(face), GROUND, slots.underlay, slots.frame ?? FRAME_MARKUP, cornerMarkup(slots), body, ...footer(face, slots), slots.overlay, `</svg>`]);
}
```

Delete the old `FRAME` array and `corners` helper. `join` drops empty parts and joins with `"\n"`, so the unwrapped plate is the same bytes as before.

In `portable.test.ts`, replace line 35 (`if (/url\(\s*['"]?#/.test(svg)) …`) with:

```ts
  for (const [, ref] of svg.matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)) if (!ids.includes(ref!)) problems.push(`url(#${ref})`);
```

- [ ] **Step 4: Run all shared tests**

Run: `npm test -w @scripta/shared`
Expected: PASS. `plates.test.ts` (byte-identical masters) and `readerCard.test.ts` must stay green untouched.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Give the card a frame slot and an ink wrapper

Finishes need to restyle the frame, wrap the ink group in copies, masks and
rotations, and paint with gradients, so the print rules move to their own
module and the portability guard now allows url(#…) to the card's own ids.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Baked texture tiles

**Files:**
- Create: `packages/shared/scripts/bake-textures.ts`
- Create (generated): `packages/shared/src/readerCards/textures.ts`
- Modify: `packages/shared/package.json` (scripts)
- Test: `packages/shared/src/readerCards/textures.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export const TEXTURE_SIZE: 64;
  export const TEXTURES: { fibre: string; vellum: string; kraft: string; speckle: string; grain: string }; // data:image/png;base64,…
  export type Texture = keyof typeof TEXTURES;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { TEXTURES, TEXTURE_SIZE } from "./textures.js";

const decode = (uri: string) => Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");

function pixels(png: Buffer): number[] {
  const parts: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") parts.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(parts));
  return Array.from({ length: TEXTURE_SIZE }, (_, y) => [...rows.subarray(y * (TEXTURE_SIZE + 1) + 1, (y + 1) * (TEXTURE_SIZE + 1))]).flat();
}

test("each texture is a small square grey PNG", () => {
  assert.deepEqual(Object.keys(TEXTURES).sort(), ["fibre", "grain", "kraft", "speckle", "vellum"]);
  for (const [name, uri] of Object.entries(TEXTURES)) {
    assert.match(uri, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, name);
    const png = decode(uri);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], name);
    assert.equal(png.toString("ascii", 12, 16), "IHDR", name);
    assert.equal(png.readUInt32BE(16), TEXTURE_SIZE, name);
    assert.equal(png.readUInt32BE(20), TEXTURE_SIZE, name);
    assert.equal(png[24], 8, name);
    assert.equal(png[25], 0, name);
    assert.ok(png.length < 12_000, `${name} is ${png.length} bytes`);
  }
});

test("the speckle mask is mostly solid with real holes, so it reads on a phone", () => {
  const values = pixels(decode(TEXTURES.speckle));
  const holes = values.filter((value) => value < 64).length / values.length;
  assert.ok(holes > 0.03 && holes < 0.25, `holes ${holes}`);
  assert.ok(values.every((value) => value === 0 || value === 255));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @scripta/shared`
Expected: FAIL. `./textures.js` is missing.

- [ ] **Step 3: Write the bake script**

`packages/shared/scripts/bake-textures.ts`:

```ts
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { random, seedOf } from "../src/readerCards/seed.js";

const SIZE = 64;
const wrap = (value: number) => ((Math.round(value) % SIZE) + SIZE) % SIZE;

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  const rows = Buffer.alloc(SIZE * (SIZE + 1));
  for (let y = 0; y < SIZE; y++) rows.set(pixels.subarray(y * SIZE, (y + 1) * SIZE), y * (SIZE + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function fibres(next: () => number, count: number, shortest: number, longest: number, brightness: number): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < count; i++) {
    let x = next() * SIZE, y = next() * SIZE, angle = next() * Math.PI * 2;
    const bend = (next() - 0.5) * 0.2, length = shortest + next() * (longest - shortest), value = Math.round(brightness * (0.5 + next() * 0.5));
    for (let step = 0; step < length; step += 0.5) {
      const at = wrap(y) * SIZE + wrap(x);
      pixels[at] = Math.max(pixels[at]!, value);
      x += Math.cos(angle) * 0.5;
      y += Math.sin(angle) * 0.5;
      angle += bend;
    }
  }
  return pixels;
}

function clouds(next: () => number, cells: number): Uint8Array {
  const grid = Array.from({ length: cells * cells }, () => next());
  const at = (gx: number, gy: number) => grid[(((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells)]!;
  const pixels = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const fx = (x / SIZE) * cells, fy = (y / SIZE) * cells, gx = Math.floor(fx), gy = Math.floor(fy), tx = fx - gx, ty = fy - gy;
    const top = at(gx, gy) * (1 - tx) + at(gx + 1, gy) * tx, bottom = at(gx, gy + 1) * (1 - tx) + at(gx + 1, gy + 1) * tx;
    pixels[y * SIZE + x] = Math.round((top * (1 - ty) + bottom * ty) * 255);
  }
  return pixels;
}

function speckles(next: () => number, count: number, smallest: number, largest: number): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE).fill(255);
  for (let i = 0; i < count; i++) {
    const cx = next() * SIZE, cy = next() * SIZE, r = smallest + next() * (largest - smallest), reach = Math.ceil(r);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) if (dx * dx + dy * dy <= r * r) pixels[wrap(cy + dy) * SIZE + wrap(cx + dx)] = 0;
  }
  return pixels;
}

const grain = (next: () => number) => Uint8Array.from({ length: SIZE * SIZE }, () => Math.round(255 * next() ** 2));
const blend = (a: Uint8Array, b: Uint8Array, t: number) => a.map((value, i) => Math.round(value * (1 - t) + b[i]! * t));
const make = (name: string) => random(seedOf(`texture:${name}`));
const vellum = make("vellum"), kraft = make("kraft");

const tiles: Record<string, Uint8Array> = {
  fibre: fibres(make("fibre"), 70, 4, 14, 255),
  vellum: blend(clouds(vellum, 4), clouds(vellum, 9), 0.4),
  kraft: blend(fibres(kraft, 140, 3, 10, 220), grain(kraft), 0.3),
  speckle: speckles(make("speckle"), 90, 0.6, 1.8),
  grain: grain(make("grain")),
};

const body = Object.entries(tiles).map(([name, pixels]) => `  ${name}: "data:image/png;base64,${png(pixels).toString("base64")}",`).join("\n");
writeFileSync(new URL("../src/readerCards/textures.ts", import.meta.url), `export const TEXTURE_SIZE = ${SIZE};\n\nexport const TEXTURES = {\n${body}\n} as const;\n\nexport type Texture = keyof typeof TEXTURES;\n`);
```

In `packages/shared/package.json` scripts, add `"textures": "node --import tsx scripts/bake-textures.ts"`.

- [ ] **Step 4: Bake and run the tests**

Run: `npm run textures -w @scripta/shared && npm test -w @scripta/shared`
Expected: PASS. Run the bake twice: `git diff --stat` after the second run must show `textures.ts` unchanged, which proves the tiles are deterministic.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/scripts/bake-textures.ts packages/shared/src/readerCards/textures.ts packages/shared/src/readerCards/textures.test.ts packages/shared/package.json && git commit -m "Bake five grey texture tiles for card finishes

Encoded with node:zlib rather than sharp, so the shared package gains no
dependency. Tiles are grey and used as luminance masks, so one tile serves
any tint and both prints; the speckle tile is pure black and white because
A0 found image masks faint on Android.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Paper finishes, wired into the renderer

**Files:**
- Create: `packages/shared/src/readerCards/finishes.ts`
- Modify: `packages/shared/src/readerCards/render.ts` (`sealSlot`, `renderReaderCard`)
- Modify: `packages/shared/src/readerCards/portable.test.ts` (finish dimension, combinations)
- Modify: `packages/shared/scripts/contact-sheet.ts` (finishes page)
- Test: `packages/shared/src/readerCards/finishes.test.ts` (new)

**Interfaces:**
- Consumes: `inks`, `withStyle`, `mix` (Task 2); `FRAME_MARKUP`, `cornerMarkup`, `InkWrap`, `PlateSlots.frame` (Task 2); `TEXTURES`, `TEXTURE_SIZE`, `Texture` (Task 3); `Finish` (Task 1).
- Produces:
  ```ts
  export interface FinishContext { print: PlatePrint; ink: IdentityKey | "graph"; streak: IdentityKey | null; seed: number; front: boolean; seal: { x: number; y: number } | null; corners: string }
  export interface FinishLayers { palette: [string, string]; slots: Pick<PlateSlots, "underlay" | "overlay" | "frame" | "corners">; wrapInk?: InkWrap }
  export function finishLayers(finish: Finish | undefined, context: FinishContext): FinishLayers;
  ```

- [ ] **Step 1: Write the failing tests**

`finishes.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { renderReaderCard, type ReaderCardInput } from "./render.js";
import { seedOf } from "./seed.js";
import { DEFAULT_READER_CARD_STYLE, publicStyle, type Finish, type PublicReaderCardStyle } from "./style.js";

const card: PublicReaderCard = { state: "settled", identity: "star", runnerUp: null, streak: "carto", signal: null, coverage: ["c"], dial: { segments: [{ group: "star", books: 22, marked: 9 }] }, facts: { finished: 22, highlights: 9, series: 2, since: 2014, edition: 2026 } };
const input = (finish: Finish, print: "paper" | "reversed" = "paper", patch: Partial<PublicReaderCardStyle> = {}): ReaderCardInput => ({ card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), finish, ...patch }, readerName: "andre.ribeiro", print, label: "x", seed: seedOf("andre.ribeiro"), view: "owner" });
const BUILT: Finish[] = ["aged", "linen", "vellum", "watercolor", "kraft"];

test("a style without a finish draws exactly the plain card", () => {
  const plain = renderReaderCard(input("paper"));
  const style: Partial<PublicReaderCardStyle> = { ...input("paper").style };
  delete style.finish;
  assert.equal(renderReaderCard({ ...input("paper"), style: style as PublicReaderCardStyle }), plain);
  assert.equal(renderReaderCard(input("neon" as Finish)), plain);
});

test("every finish draws its own card in both prints, the same way twice", () => {
  for (const finish of BUILT) for (const print of ["paper", "reversed"] as const) {
    const svg = renderReaderCard(input(finish, print));
    assert.notEqual(svg, renderReaderCard(input("paper", print)), `${finish}/${print}`);
    assert.equal(renderReaderCard(input(finish, print)), svg, `${finish}/${print} is deterministic`);
  }
});

test("paper finishes change the paper and leave the ink", () => {
  for (const [finish, ground] of [["aged", "#eadab9"], ["linen", "#ece3cf"], ["vellum", "#efe2c4"], ["kraft", "#caa97c"]] as const) {
    assert.match(renderReaderCard(input(finish)), new RegExp(`<rect style="fill:${ground}" width="250" height="350" rx="4"/>`), finish);
  }
  assert.match(renderReaderCard(input("aged")), /<text style="fill:#5b3b6e"[^>]*font-size="25"/);
});

test("textured finishes paint through a mask of their tile", () => {
  for (const finish of ["vellum", "kraft"] as const) {
    const svg = renderReaderCard(input(finish));
    assert.match(svg, /<image href="data:image\/png;base64,/, finish);
    assert.match(svg, new RegExp(`mask="url\\(#rc-${finish}Mask-\\d+-paper\\)"`), finish);
  }
});

test("watercolour washes the seal only when the seal is drawn", () => {
  assert.match(renderReaderCard(input("watercolor", "paper", { trait: "both" })), /fill="#1f4e6b" opacity="0.28"/);
  assert.doesNotMatch(renderReaderCard(input("watercolor", "paper", { trait: "line" })), /opacity="0.28"/);
});

test("back pages keep the finish's paper", () => {
  for (const page of ["record", "chosen", "merged"] as const) assert.match(renderReaderCard(input("aged"), page), /<rect style="fill:#eadab9" width="250"/, page);
});
```

In `portable.test.ts`:
- add `FINISHES` to the `./style.js` import;
- add `...FINISHES.map((finish): [string, Partial<PublicReaderCardStyle>] => [\`finish ${finish}\`, { finish }]),` to `decorationsOf`;
- add `finish: pick(FINISHES),` to the combination `style` literal.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL. `finishes.ts` does not exist yet, so every finish still renders as the plain card.

- [ ] **Step 3: Write `finishes.ts`**

```ts
import { FRAME_MARKUP, type InkWrap, type PlateSlots } from "./compose.js";
import { inks, mix, withStyle } from "./paint.js";
import { INKS, type IdentityKey } from "./plates.js";
import type { PlatePrint } from "./render.js";
import { random, seedOf } from "./seed.js";
import type { Finish } from "./style.js";
import { TEXTURES, TEXTURE_SIZE, type Texture } from "./textures.js";

export interface FinishContext { print: PlatePrint; ink: IdentityKey | "graph"; streak: IdentityKey | null; seed: number; front: boolean; seal: { x: number; y: number } | null; corners: string }
export interface FinishLayers { palette: [string, string]; slots: Pick<PlateSlots, "underlay" | "overlay" | "frame" | "corners">; wrapInk?: InkWrap }

interface Paint extends FinishContext { ground: string; line: string; plate: string; deep: string; paper: boolean; id: (name: string) => string }
type Builder = (paint: Paint) => FinishLayers;

const TILE = TEXTURE_SIZE / 2;
const SHEET = `width="250" height="350" rx="4"`;
const f = (value: number) => value.toFixed(2);

function textured(texture: Texture, id: (name: string) => string, colour: string, opacity: number): { defs: string; layer: string } {
  const tile = id(`${texture}Tile`), mask = id(`${texture}Mask`);
  return {
    defs: `<pattern id="${tile}" patternUnits="userSpaceOnUse" width="${TILE}" height="${TILE}"><image href="${TEXTURES[texture]}" width="${TILE}" height="${TILE}" preserveAspectRatio="none"/></pattern><mask id="${mask}" maskUnits="userSpaceOnUse" x="0" y="0" width="250" height="350"><rect width="250" height="350" fill="url(#${tile})"/></mask>`,
    layer: `<rect ${SHEET} fill="${colour}" opacity="${opacity}" mask="url(#${mask})"/>`,
  };
}

function vignette(id: string, colour: string, opacity: number): { defs: string; layer: string } {
  return {
    defs: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="125" cy="175" r="215"><stop offset=".55" stop-color="${colour}" stop-opacity="0"/><stop offset="1" stop-color="${colour}" stop-opacity="${opacity}"/></radialGradient>`,
    layer: `<rect ${SHEET} fill="url(#${id})"/>`,
  };
}

function blob(next: () => number, cx: number, cy: number, rx: number, ry: number): string {
  const points = Array.from({ length: 9 }, (_, i) => {
    const angle = (i / 9) * Math.PI * 2, scale = 0.8 + next() * 0.4;
    return [cx + Math.cos(angle) * rx * scale, cy + Math.sin(angle) * ry * scale] as const;
  });
  const mid = (a: readonly [number, number], b: readonly [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  const start = mid(points[8]!, points[0]!);
  return `M${start[0].toFixed(1)} ${start[1].toFixed(1)}${points.map((point, i) => {
    const end = mid(point, points[(i + 1) % 9]!);
    return `Q${point[0].toFixed(1)} ${point[1].toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)}`;
  }).join("")}Z`;
}

const plain: Builder = (p) => ({ palette: [p.ground, p.line], slots: {} });

const BUILDERS: Partial<Record<Finish, Builder>> = {
  paper: plain,
  aged: (p) => {
    const next = random(seedOf(`${p.seed}:aged`));
    const spot = p.paper ? "#8a5a2b" : "#000000";
    const spots = Array.from({ length: 12 }, () => `<circle cx="${(8 + next() * 234).toFixed(1)}" cy="${(8 + next() * 334).toFixed(1)}" r="${(1.5 + next() * 4.5).toFixed(1)}" fill="${spot}" opacity="${f((p.paper ? 0.06 : 0.1) + next() * 0.1)}"/>`).join("");
    const edge = vignette(p.id("agedVignette"), spot, p.paper ? 0.28 : 0.4);
    return { palette: p.paper ? ["#eadab9", p.line] : [mix(p.ground, "#3a2a14", 0.35), "#e8d6b0"], slots: { underlay: `<defs>${edge.defs}</defs>${spots}`, overlay: edge.layer } };
  },
  linen: (p) => {
    const weave = p.id("linenWeave");
    return { palette: [p.paper ? "#ece3cf" : p.ground, p.line], slots: { underlay: `<defs><pattern id="${weave}" patternUnits="userSpaceOnUse" width="3" height="3"><path d="M0 .75H3M0 2.25H3" stroke="${p.line}" stroke-width=".35" opacity=".1"/><path d="M.75 0V3M2.25 0V3" stroke="${p.line}" stroke-width=".35" opacity=".07"/></pattern></defs><rect ${SHEET} fill="url(#${weave})"/>` } };
  },
  vellum: (p) => {
    const mottle = textured("vellum", p.id, "#ffffff", p.paper ? 0.45 : 0.1);
    const edge = vignette(p.id("vellumVignette"), "#ffffff", p.paper ? 0.35 : 0.12);
    return { palette: [p.paper ? "#efe2c4" : mix(p.ground, "#ffffff", 0.06), p.line], slots: { underlay: `<defs>${mottle.defs}${edge.defs}</defs>${mottle.layer}`, overlay: edge.layer } };
  },
  watercolor: (p) => {
    const next = random(seedOf(`${p.seed}:wash`));
    const blur = p.id("wash");
    const tone = (colour: string) => (p.paper ? colour : mix(colour, "#ffffff", 0.35));
    const washes: Array<[number, number, number, number, string, number]> = [[125, 134, 50, 46, p.plate, 0.2], [125, 240, 72, 18, p.plate, 0.14]];
    if (p.seal && p.streak) washes.push([p.seal.x, p.seal.y, 17, 17, INKS[p.streak][1], 0.28]);
    const paths = washes.map(([x, y, rx, ry, colour, opacity]) => `<path d="${blob(next, x, y, rx, ry)}" fill="${tone(colour)}" opacity="${f(p.paper ? opacity : opacity * 1.2)}"/>`).join("");
    return { palette: [p.ground, p.line], slots: { underlay: `<defs><filter id="${blur}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter></defs><g filter="url(#${blur})">${paths}</g>` } };
  },
  kraft: (p) => {
    const fibres = textured("kraft", p.id, p.paper ? "#5b4024" : "#000000", p.paper ? 0.3 : 0.35);
    return { palette: p.paper ? ["#caa97c", mix(p.plate, "#000000", 0.35)] : ["#3a2a1a", "#e9d6b4"], slots: { underlay: `<defs>${fibres.defs}</defs>${fibres.layer}` } };
  },
};

export function finishLayers(finish: Finish | undefined, context: FinishContext): FinishLayers {
  const [ground, line] = inks(context.ink, context.print);
  const [, plate, deep] = INKS[context.ink];
  const paint: Paint = { ...context, ground, line, plate, deep, paper: context.print === "paper", id: (name) => `rc-${name}-${context.seed}-${context.print}` };
  const layers = ((finish && BUILDERS[finish]) || plain)(paint);
  if (context.front) return layers;
  return { palette: [layers.palette[0], layers.palette[1].startsWith("url(") ? line : layers.palette[1]], slots: layers.slots };
}
```

`FRAME_MARKUP` and `withStyle` are imported now and used by Task 5's builders. If the typecheck flags them as unused before then, add them in Task 5 instead.

- [ ] **Step 4: Wire it into `render.ts`**

Import `cornerMarkup` from `./compose.js` and `finishLayers` from `./finishes.js`. Replace `sealSlot` and `renderReaderCard` with:

```ts
function sealCentre(): { x: number; y: number } {
  const rad = (SEAL_ANGLE * Math.PI) / 180;
  return { x: 125 + SEAL_RADIUS * Math.sin(rad), y: 134 - SEAL_RADIUS * Math.cos(rad) };
}

function sealSlot(streak: IdentityKey, print: PlatePrint): string {
  const { x: cx, y: cy } = sealCentre();
  return `<circle class="pg" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${SEAL_SIZE / 2 + 2.5}"/>${glyphAt(streak, cx - SEAL_SIZE / 2, cy - SEAL_SIZE / 2, SEAL_SIZE, print)}`;
}

const BACKS = { record: [", reader’s record", recordBody], chosen: [", chosen by the reader", chosenBody], merged: [", back", mergedBody] } as const;

export function renderReaderCard(input: ReaderCardInput, page: ReaderCardPage = "front"): string {
  const { card, style, print, seed } = input;
  const { face, ink } = faceOf({ ...input, identity: card.identity, state: card.state });
  const streak = card.state === "unwritten" ? null : card.streak ?? null;
  const seal = streak !== null && (style.trait === "both" || style.trait === "seal");
  const decorated: PlateSlots = { ...decorations(input, print), ...(page === "front" ? mottoSlots(style.motto, `rc-${style.motto?.look ?? "none"}-${seed}-${print}`) : {}) };
  const finish = finishLayers(style.finish, { print, ink, streak, seed, front: page === "front", seal: page === "front" && seal ? sealCentre() : null, corners: cornerMarkup(decorated) });
  if (page !== "front") {
    const [suffix, body] = BACKS[page];
    return withStyle(composePage({ ...face, label: `${face.label}${suffix}` }, body(input), { ...decorated, ...finish.slots }), finish.palette);
  }
  const line = streak !== null && (style.trait === "both" || style.trait === "line");
  const lead = card.identity && GENRE_LEADS.has(card.identity) ? (card.identity as DialGroup) : null;
  const slots: PlateSlots = { ...decorated, ...finish.slots };
  const counter = card.dial ? drawCounter(style.counter, card.dial.segments, { seed, sealGap: seal, lead }) : null;
  if (counter) slots[counter.slot] = counter.svg;
  if (streak && seal) slots.seal = sealSlot(streak, print);
  if (streak && line) slots.trait = traitLine(streak);
  return withStyle(composePlate(face, slots, finish.wrapInk), finish.palette);
}
```

Back pages never had motto slots, so the `page === "front"` guard keeps their markup unchanged.

- [ ] **Step 5: Add the contact sheet page**

In `contact-sheet.ts`, add `FINISHES` to the import and this entry to `dimensions`:

```ts
  finishes: FINISHES.map((finish) => [finish, { ...DEFAULT_READER_CARD_STYLE, finish }]),
```

- [ ] **Step 6: Run the tests and the sheet**

Run: `npm test -w @scripta/shared && npm run typecheck -w @scripta/shared && npm run sheet -w @scripta/shared`
Expected: PASS. Open the printed `finishes.html`:
- aged, linen, vellum, watercolour and kraft each look like their spec row, on all 8 plates and both prints;
- the other six look plain until Task 5.

- [ ] **Step 7: Commit**

```bash
git add packages/shared && git commit -m "Draw the paper finishes on the reader card

Aged, linen, vellum, watercolour and kraft change the paper under the ink.
Back pages keep the finish's paper; the plain finish adds no markup, so the
default card is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ink finishes and the shine data

**Files:**
- Modify: `packages/shared/src/readerCards/finishes.ts`
- Create: `packages/shared/src/readerCards/shine.ts`
- Modify: `packages/shared/src/readerCards/index.ts`
- Test: `packages/shared/src/readerCards/finishes.test.ts`
- Test: `packages/shared/src/readerCards/shine.test.ts` (new)

**Interfaces:**
- Consumes: everything Task 4 produced.
- Produces:
  ```ts
  export type ShineKind = "foil" | "holo" | "gilt";
  export const SHINE_STOPS: Record<ShineKind, ReadonlyArray<readonly [offset: number, colour: string, opacity: number]>>;
  export function readerCardShine(finish: Finish | undefined): ShineKind | null;
  export function shineGradientCss(kind: ShineKind): string;
  ```

- [ ] **Step 1: Write the failing tests**

In `finishes.test.ts`:
- replace `BUILT` with `const BUILT = FINISHES.filter((finish) => finish !== "paper");`;
- add `FINISHES` to the `./style.js` import;
- append:

```ts
test("foil and holo print the front in a gradient ink, and the back in plain ink", () => {
  for (const finish of ["foil", "holo"] as const) for (const print of ["paper", "reversed"] as const) {
    const front = renderReaderCard(input(finish, print));
    assert.match(front, new RegExp(`<text style="fill:url\\(#rc-${finish}Ink-\\d+-${print}\\)"`), `${finish}/${print}`);
    assert.match(front, new RegExp(`<linearGradient id="rc-${finish}Ink-\\d+-${print}" gradientUnits="userSpaceOnUse"`), `${finish}/${print}`);
    assert.doesNotMatch(renderReaderCard(input(finish, print), "record"), /:url\(/, `${finish}/${print} back`);
  }
  assert.match(renderReaderCard(input("holo")), /fill="url\(#rc-holoSheen-\d+-paper\)"/);
});

test("gilt paints the frame, corners and edge gold and leaves the name in the plate ink", () => {
  const svg = renderReaderCard(input("gilt"));
  assert.match(svg, /<rect style="stroke:url\(#rc-goldInk-\d+-paper\);fill:none" x="10" y="10"/);
  assert.match(svg, /<path style="fill:url\(#rc-goldInk-\d+-paper\)" d="M16 11\.5/);
  assert.match(svg, /stroke="url\(#rc-goldInk-\d+-paper\)" stroke-width="1.5"/);
  assert.match(svg, /<text style="fill:#5b3b6e"[^>]*font-size="25"/);
  assert.match(renderReaderCard(input("gilt"), "record"), /stroke:url\(#rc-goldInk-/);
});

test("stamp breaks and tilts the front ink inside a mask larger than the card, and leaves the back straight", () => {
  const svg = renderReaderCard(input("stamp"));
  assert.match(svg, /<g mask="url\(#rc-stampMask-\d+-paper\)" transform="rotate\(-1.2 125 175\)"/);
  assert.match(svg, /<mask id="rc-stampMask-\d+-paper" maskUnits="userSpaceOnUse" x="-10" y="-10" width="270" height="370">/);
  assert.doesNotMatch(renderReaderCard(input("stamp"), "record"), /rotate\(|stampMask-\d+-paper\)"/);
});

test("riso prints a misregistered copy in the streak's ink, or riso red without one", () => {
  assert.match(renderReaderCard(input("riso")), /<g transform="translate\(1.4 .9\)" opacity=".6">[\s\S]*?fill:#1f4e6b/);
  assert.match(renderReaderCard({ ...input("riso"), card: { ...card, streak: null } }), /fill:#e4572e/);
});

test("letterpress debosses the ink with an offset highlight on cotton paper", () => {
  const svg = renderReaderCard(input("letterpress"));
  assert.match(svg, /<rect style="fill:#f5f0e6" width="250"/);
  assert.match(svg, /<g transform="translate\(.6 .7\)" opacity="0.8">/);
});

test("ink copies keep every id unique, and the copied motto still finds its curve", () => {
  for (const finish of ["riso", "letterpress"] as const) {
    const svg = renderReaderCard(input(finish, "paper", { motto: { text: "Per libros ad astra", look: "arc" } }));
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]!);
    assert.equal(new Set(ids).size, ids.length, finish);
    for (const [, ref] of svg.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(ref!), `${finish} → ${ref}`);
    assert.ok((svg.match(/<textPath/g)?.length ?? 0) >= 2, finish);
  }
});
```

`shine.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { readerCardShine, shineGradientCss } from "./shine.js";
import { FINISHES } from "./style.js";

test("only foil, holo and gilt shine", () => {
  assert.deepEqual(FINISHES.filter((finish) => readerCardShine(finish)), ["foil", "holo", "gilt"]);
  assert.equal(readerCardShine(undefined), null);
});

test("the web shine is one CSS gradient built from the shared stops", () => {
  assert.equal(shineGradientCss("foil"), "linear-gradient(110deg, rgba(255, 255, 255, 0) 40%, rgba(255, 255, 255, 0.5) 50%, rgba(255, 255, 255, 0) 60%)");
  assert.match(shineGradientCss("holo"), /^linear-gradient\(110deg, rgba\(127, 107, 214, 0\) 30%/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w @scripta/shared`
Expected: FAIL. The six ink finishes still draw plain, and `./shine.js` is missing.

- [ ] **Step 3: Add the ink finishes**

In `finishes.ts`:
- change `BUILDERS` to `Record<Finish, Builder>`;
- add these helpers above it;
- add the six entries below to it.

```ts
const HOLO = ["#7f6bd6", "#4fb3c9", "#83d18a", "#e7c766", "#e07fb0"];
const GOLD: Array<[number, string]> = [[0, "#7d5e1c"], [0.35, "#e7cd78"], [0.5, "#f6e7b0"], [0.65, "#e7cd78"], [1, "#8f6d22"]];
const RISO_RED = "#e4572e";

function gradient(id: string, stops: Array<[number, string]>, [x1, y1, x2, y2] = [0, 0, 250, 350]): string {
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([offset, colour]) => `<stop offset="${offset}" stop-color="${colour}"/>`).join("")}</linearGradient>`;
}

const copyOf = (body: string) => body.replace(/<defs>[\s\S]*?<\/defs>/g, "");
```

```ts
  letterpress: (p) => {
    const fibres = textured("fibre", p.id, p.paper ? p.line : "#ffffff", p.paper ? 0.1 : 0.06);
    const edge = p.paper ? "#ffffff" : "#000000";
    return {
      palette: [p.paper ? "#f5f0e6" : p.ground, p.line],
      slots: { underlay: `<defs>${fibres.defs}</defs>${fibres.layer}` },
      wrapInk: (body) => `<g transform="translate(.6 .7)" opacity="${p.paper ? 0.8 : 0.45}">${withStyle(copyOf(body), [p.ground, edge])}</g>\n${body}`,
    };
  },
  foil: (p) => {
    const id = p.id("foilInk");
    const stops: Array<[number, string]> = p.paper
      ? [[0, p.deep], [0.3, mix(p.plate, "#ffffff", 0.55)], [0.5, p.plate], [0.7, mix(p.plate, "#ffffff", 0.4)], [1, p.deep]]
      : [[0, "#a59d8c"], [0.3, "#f6f1e4"], [0.5, "#cfc7b4"], [0.7, "#ffffff"], [1, "#a59d8c"]];
    return { palette: [p.ground, `url(#${id})`], slots: { underlay: `<defs>${gradient(id, stops)}</defs>` } };
  },
  holo: (p) => {
    const ink = p.id("holoInk"), sheen = p.id("holoSheen");
    const inkStops = HOLO.map((colour, i): [number, string] => [i / (HOLO.length - 1), mix(colour, p.line, 0.45)]);
    const sheenStops = HOLO.map((colour, i): [number, string] => [i / (HOLO.length - 1), colour]);
    return {
      palette: [p.ground, `url(#${ink})`],
      slots: { underlay: `<defs>${gradient(ink, inkStops)}${gradient(sheen, sheenStops, [250, 0, 0, 350])}</defs>`, overlay: `<rect ${SHEET} fill="url(#${sheen})" opacity="${p.paper ? 0.14 : 0.1}"/>` },
    };
  },
  gilt: (p) => {
    const id = p.id("goldInk"), gold = `url(#${id})`;
    return {
      palette: [p.ground, p.line],
      slots: {
        underlay: `<defs>${gradient(id, GOLD)}</defs>`,
        frame: withStyle(FRAME_MARKUP, [p.ground, gold]),
        corners: withStyle(p.corners, [p.ground, gold]),
        overlay: `<rect x=".75" y=".75" width="248.5" height="348.5" rx="3.4" fill="none" stroke="${gold}" stroke-width="1.5"/>`,
      },
    };
  },
  stamp: (p) => {
    const tile = p.id("speckleTile"), mask = p.id("stampMask");
    return {
      palette: [p.ground, p.line],
      slots: { underlay: `<defs><pattern id="${tile}" patternUnits="userSpaceOnUse" width="${TILE}" height="${TILE}"><image href="${TEXTURES.speckle}" width="${TILE}" height="${TILE}" preserveAspectRatio="none"/></pattern><mask id="${mask}" maskUnits="userSpaceOnUse" x="-10" y="-10" width="270" height="370"><rect x="-10" y="-10" width="270" height="370" fill="url(#${tile})"/></mask></defs>` },
      wrapInk: (body) => `<g mask="url(#${mask})" transform="rotate(-1.2 125 175)" opacity=".94">\n${body}\n</g>`,
    };
  },
  riso: (p) => {
    const second = p.streak ? INKS[p.streak][1] : RISO_RED;
    const grain = textured("grain", p.id, p.line, p.paper ? 0.1 : 0.06);
    return {
      palette: [p.ground, p.line],
      slots: { overlay: `<defs>${grain.defs}</defs>${grain.layer}` },
      wrapInk: (body) => `<g transform="translate(1.4 .9)" opacity=".6">${withStyle(copyOf(body), [p.ground, p.paper ? second : mix(second, "#ffffff", 0.35)])}</g>\n<g opacity=".9">\n${body}\n</g>`,
    };
  },
```

`finishLayers` already drops `wrapInk` and flattens `url(` inks on back pages. Stamp's mask lives in `underlay`, but on a back page nothing references it.

- [ ] **Step 4: Add `shine.ts` and export it**

```ts
import type { Finish } from "./style.js";

export type ShineKind = "foil" | "holo" | "gilt";

export const SHINE_STOPS: Record<ShineKind, ReadonlyArray<readonly [offset: number, colour: string, opacity: number]>> = {
  foil: [[0.4, "#ffffff", 0], [0.5, "#ffffff", 0.5], [0.6, "#ffffff", 0]],
  holo: [[0.3, "#7f6bd6", 0], [0.4, "#4fb3c9", 0.22], [0.5, "#83d18a", 0.28], [0.6, "#e7c766", 0.22], [0.7, "#e07fb0", 0]],
  gilt: [[0.42, "#fff3c4", 0], [0.5, "#fff3c4", 0.4], [0.58, "#fff3c4", 0]],
};

export function readerCardShine(finish: Finish | undefined): ShineKind | null {
  return finish === "foil" || finish === "holo" || finish === "gilt" ? finish : null;
}

const rgba = (hex: string, opacity: number) => `rgba(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")}, ${opacity})`;

export function shineGradientCss(kind: ShineKind): string {
  return `linear-gradient(110deg, ${SHINE_STOPS[kind].map(([offset, colour, opacity]) => `${rgba(colour, opacity)} ${Math.round(offset * 100)}%`).join(", ")})`;
}
```

In `index.ts` add: `export { SHINE_STOPS, readerCardShine, shineGradientCss, type ShineKind } from "./shine.js";`

- [ ] **Step 5: Run the tests and the sheet**

Run: `npm test -w @scripta/shared && npm run typecheck -w @scripta/shared && npm run sheet -w @scripta/shared`
Expected: PASS. In `finishes.html`, all 12 finishes differ, on all 8 plates and both prints:
- foil reads as metallic;
- gilt's gold frame lines up with the corners;
- stamp's tilt clips nothing;
- riso's copy sits down-right.

The portable test now covers every finish × plate × print on front and record pages, plus the 50 combinations.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/readerCards && git commit -m "Draw the ink finishes and name the shining ones

Foil, holographic, gilt, letterpress, stamp and riso change the ink on the
front. Letterpress uses an offset highlight copy instead of the filter A0
could not see on a phone; back pages keep plain ink so the record stays
legible. shine.ts holds the gradient both clients draw over the card.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Web: Finish section and the shine

**Files:**
- Create: `frontend/src/components/readerCard/CardShine.tsx`
- Modify: `frontend/src/components/readerCard/ReaderCardTurner.tsx`
- Modify: `frontend/src/components/readerCard/ReaderCardOptions.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/scripts/test-motion-css.mts`
- Test: `frontend/scripts/test-reader-card-shine.mts` (new)
- Test: `frontend/scripts/test-reader-card-editor.mts`

**Interfaces:**
- Consumes: `FINISHES`, `FINISH_LABELS`, `readerCardShine`, `shineGradientCss`, `ShineKind`, `styleThumbnail`.
- Produces: `CardShine({ kind }: { kind: ShineKind })`, absolutely positioned and filling its parent.

- [ ] **Step 1: Write the failing tests**

`frontend/scripts/test-reader-card-shine.mts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DEFAULT_READER_CARD_STYLE, readerCardInputOf, type Finish, type Layout } from "@scripta/shared";
import { ReaderCardTurner } from "../src/components/readerCard/ReaderCardTurner";

const books = Array.from({ length: 6 }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, _genres: ["Fantasy"] }));
const turner = (finish: Finish, layout: Layout = "faces") => renderToString(createElement(ReaderCardTurner, { input: readerCardInputOf(books, [], "andre.ribeiro", undefined, { style: { ...DEFAULT_READER_CARD_STYLE, finish, layout }, coverOf: () => null }), cardWidth: "w-72", spreadWidth: "w-96" }));

test("foil, holo and gilt cards carry one shine, over the front face", () => {
  for (const finish of ["foil", "holo", "gilt"] as const) assert.equal(turner(finish).match(/card-shine-idle/g)?.length, 1, finish);
});

test("other finishes have no shine", () => {
  for (const finish of ["paper", "aged", "riso"] as const) assert.doesNotMatch(turner(finish), /card-shine/, finish);
});

test("the book pager shines its front page only", () => {
  assert.equal(turner("foil", "book").match(/card-shine-idle/g)?.length, 1);
});
```

In `test-reader-card-editor.mts`, append:

```ts
test("twelve finish thumbnails between corners and print, with the stored one checked", () => {
  const html = options({ finish: "gilt" });
  const finishes = group(html, "Finish");
  assert.equal(finishes.match(/role="radio"/g)?.length, 12);
  assert.match(finishes, /aria-checked="true"[^>]*>(?:(?!<\/button>).)*Gilt edge/s);
  assert.ok(html.indexOf(`aria-label="Corners"`) < html.indexOf(`aria-label="Finish"`) && html.indexOf(`aria-label="Finish"`) < html.indexOf(`aria-label="Print"`));
});
```

In `test-motion-css.mts`, add `".card-shine-idle"` to the selector list and `"card-shine-sweep"` to the keyframe list.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build -w @scripta/shared && npm test -w frontend`
Expected: FAIL. There is no shine, no Finish group and no CSS rule yet.

- [ ] **Step 3: Implement**

`CardShine.tsx`:

```tsx
import { useRef, type PointerEvent } from "react";
import { shineGradientCss, type ShineKind } from "@scripta/shared";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function CardShine({ kind }: { kind: ShineKind }) {
  const ref = useRef<HTMLSpanElement>(null);
  const follow = (event: PointerEvent<HTMLSpanElement>) => {
    const element = ref.current;
    if (!element || reducedMotion()) return;
    const box = element.getBoundingClientRect();
    element.classList.remove("card-shine-idle");
    element.style.backgroundPosition = `${75 - 50 * ((event.clientX - box.left) / box.width)}% 0`;
  };
  const rest = () => {
    const element = ref.current;
    if (!element) return;
    element.classList.add("card-shine-idle");
    element.style.backgroundPosition = "50% 0";
  };
  return <span ref={ref} aria-hidden="true" onPointerMove={follow} onPointerLeave={rest} className="card-shine-idle absolute inset-0 rounded-[1.6%/1.143%]" style={{ backgroundImage: shineGradientCss(kind), backgroundSize: "300% 100%", backgroundPosition: "50% 0" }} />;
}
```

`ReaderCardTurner.tsx`:
- Import `readerCardShine` from `@scripta/shared` and `CardShine` from `./CardShine`.
- In the body, add:
  ```tsx
  const shine = readerCardShine(input.style.finish);
  const shineOn = (page: ReaderCardPage) => (shine && page === "front" ? <CardShine kind={shine} /> : null);
  ```
- Spread layout: in the `page="front"` span, after its `ReaderCardImage`, add `{shineOn("front")}`.
- Pager: give each page `div` the class `relative`, and after its `ReaderCardImage` add `{shineOn(page)}`.
- Flip: in each face span, after its `ReaderCardImage`, add `{shineOn(pages[turn.faces[face]]!)}`.

`ReaderCardOptions.tsx`:
- Add `FINISHES`, `FINISH_LABELS` to the import, and `finish` to the `input.style` destructure.
- Add:
  ```tsx
  const finishThumbs = useMemo(() => new Map(FINISHES.map((option) => [option, styleThumbnail(base, { finish: option })])), [base]);
  ```
- Insert this between the Corners and Print sections:

```tsx
      <section>
        <h3 className="mb-2 text-sm font-semibold">Finish</h3>
        <Thumbnails label="Finish" options={FINISHES} labels={FINISH_LABELS} value={finish} thumbnail={(option) => finishThumbs.get(option)!} onPick={(next) => void onChange({ finish: next })} columns="grid-cols-4 sm:grid-cols-6" />
      </section>
```

`index.css`: add `@keyframes card-shine-sweep { from { background-position: 25% 0; } to { background-position: 75% 0; } }` outside any media block. Inside the existing `@media (prefers-reduced-motion: no-preference) {` block, add `.card-shine-idle { animation: card-shine-sweep 9s ease-in-out infinite alternate; }`.

- [ ] **Step 4: Run the checks**

Run: `npm test -w frontend && npm run typecheck -w frontend && npm run lint -w frontend`
Expected: PASS. Lint may show only pre-existing warnings in other files.

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "Offer finishes in the web editor and shine foil, holo and gilt

The shine sits over the front face in the viewer and the editor preview,
follows the pointer, and sweeps slowly only for people who allow motion.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Mobile: Finish section and the tilting shine

**Files:**
- Create: `mobile/src/features/murals/CardShine.tsx`
- Modify: `mobile/src/features/murals/ReaderCardTurner.tsx`
- Modify: `mobile/src/features/murals/ReaderCardViewer.tsx:33`
- Modify: `mobile/src/features/readerCard/ReaderCardOptions.tsx`
- Test: `mobile/src/features/murals/cardShine.test.ts` (new)

**Interfaces:**
- Consumes: `SHINE_STOPS`, `readerCardShine`, `ShineKind`, `FINISHES`, `FINISH_LABELS`, `styleThumbnail`.
- Produces:
  ```tsx
  CardShine({ kind, width, height, live }: { kind: ShineKind; width: number; height: number; live: boolean })
  ReaderCardTurner // gains `liveShine?: boolean` (default false)
  ```

- [ ] **Step 1: Write the failing guard test**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("the shine reads the rotation sensor only when live and motion is allowed", () => {
  const shine = readFileSync("src/features/murals/CardShine.tsx", "utf8");
  assert.equal(shine.match(/useAnimatedSensor\(/g)?.length, 1);
  assert.match(shine, /live && !reduced \? <LiveShine/);
  assert.match(readFileSync("src/features/murals/ReaderCardViewer.tsx", "utf8"), /<ReaderCardTurner[^>]*liveShine/);
  assert.doesNotMatch(readFileSync("src/features/readerCard/ReaderCardEditorScreen.tsx", "utf8"), /liveShine/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w mobile`
Expected: FAIL. `CardShine.tsx` is missing.

- [ ] **Step 3: Implement**

`CardShine.tsx`:

```tsx
import { StyleSheet, View } from "react-native";
import Animated, { Extrapolation, SensorType, interpolate, useAnimatedSensor, useAnimatedStyle } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { SHINE_STOPS, type ShineKind } from "@scripta/shared";
import { useReducedMotion } from "../../ui";

const TILT = 0.5;

function Band({ kind, width, height }: { kind: ShineKind; width: number; height: number }) {
  return (
    <Svg width={width * 3} height={height}>
      <Defs>
        <LinearGradient id="shine" x1="0" y1="0" x2="1" y2="0.35">
          {SHINE_STOPS[kind].map(([offset, colour, opacity]) => <Stop key={offset} offset={offset} stopColor={colour} stopOpacity={opacity} />)}
        </LinearGradient>
      </Defs>
      <Rect width={width * 3} height={height} fill="url(#shine)" />
    </Svg>
  );
}

function LiveShine({ kind, width, height }: { kind: ShineKind; width: number; height: number }) {
  const rotation = useAnimatedSensor(SensorType.ROTATION, { interval: "auto" });
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(rotation.sensor.get().roll, [-TILT, TILT], [-1.5 * width, -0.5 * width], Extrapolation.CLAMP) }] }));
  return <Animated.View style={band}><Band kind={kind} width={width} height={height} /></Animated.View>;
}

export function CardShine({ kind, width, height, live }: { kind: ShineKind; width: number; height: number; live: boolean }) {
  const reduced = useReducedMotion();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: (width * 4) / 250 }]}>
      {live && !reduced ? <LiveShine kind={kind} width={width} height={height} /> : <View style={{ transform: [{ translateX: -width }] }}><Band kind={kind} width={width} height={height} /></View>}
    </View>
  );
}

const styles = StyleSheet.create({ clip: { overflow: "hidden" } });
```

Check `rotation.sensor.get()` against `node_modules/react-native-reanimated/lib/typescript` before you use it. If the sensor's shared value has no `.get()` in 4.5.1, use `.value` inside the worklet. That is allowed in `useAnimatedStyle`: the LogBox warning is only for `.value` written directly in a JSX `style`.

`ReaderCardTurner.tsx`:
- Add `liveShine = false` to the props (`liveShine?: boolean`).
- Import `readerCardShine` and `type ReaderCardPage` from `@scripta/shared`, and `CardShine` from `./CardShine`.
- In the body:
  ```tsx
  const shine = readerCardShine(input.style.finish);
  const shineOn = (page: ReaderCardPage) => (shine && page === "front" ? <CardShine kind={shine} width={width} height={width * PLATE_RATIO} live={liveShine} /> : null);
  ```
- The flip faces are the two entries of `CardFaces`' `faces` array. That child is keyed by the rotation it last settled at, because Reanimated re-applies first-render values after a re-render. Make each entry a fragment holding its `ReaderCardImage` followed by `shineOn(pages[turn.faces[0]]!)` or `shineOn(pages[turn.faces[1]]!)`.
- After the `ReaderCardImage` in each pager page `View`, add `{shineOn(page)}`.

`ReaderCardViewer.tsx:33`: pass `liveShine` to `ReaderCardTurner`.

`ReaderCardOptions.tsx`: the mobile editor opens 12-option sections in an inline panel below the pinned card (`PanelId`, `PANEL_TITLES`, `PanelTrigger`, `ReaderCardPanel`, and per-section panels such as `CornersPanel`). Finish follows that pattern:
- Add `FINISHES`, `FINISH_LABELS` to the `@scripta/shared` import.
- Add `"finish"` to `PanelId`, and `finish: "Finish"` to `PANEL_TITLES`.
- Add a panel next to `CornersPanel`:

```tsx
function FinishPanel({ input, available, onChange }: { input: ReaderCardBase; available: number; onChange: SaveStyle }) {
  const deferred = useDeferredValue(input);
  const thumbs = useMemo(() => FINISHES.map((option) => ({ option, input: styleThumbnail(deferred, { finish: option }) })), [deferred]);
  return <TileRow items={thumbs} value={input.style.finish} labels={FINISH_LABELS} available={available} onPick={(next) => void onChange({ finish: next })} />;
}
```

- In `ReaderCardPanel`, render `<FinishPanel input={input} available={available} onChange={onChange} />` for `panel === "finish"`.
- In `FrontOptions`, add `finish` to the `input.style` destructure, and add this section right after Corners:

```tsx
      <Section title="Finish">
        <PanelTrigger title="Finish" current={FINISH_LABELS[finish]} onPress={() => onOpen("finish")} />
      </Section>
```

Picking a finish saves it, keeps the panel open, and updates the pinned card live. The finish is a front option, so the editor's existing `change()` already turns the card to the front.

- [ ] **Step 4: Run the checks**

Run: `npm run build -w @scripta/shared && npm test -w mobile && npm run typecheck -w mobile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src && git commit -m "Offer finishes in the mobile editor and tilt the shine in the viewer

The rotation sensor runs only while the full-screen viewer is open and
motion is allowed; the editor preview shows a still band. Reanimated ships
the sensor, so this goes over the air.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Check it on screen and ship A6

**Files:** none. This task verifies the branch and opens the PR.

- [ ] **Step 1: Web check**

1. Run `npm run dev:claim`, then seed the fixture:

   ```bash
   node --input-type=module -e 'const m = await import("./scripts/devFixtureSetup.mjs"); m.seedDevAccount(false, console.log); m.seedFixtureUsers(console.log); m.seedCommunityGraph(console.log);'
   ```

2. Add a launch entry `api-dev` that runs `npm run backend` with `devDataDirEnv()` (`scripts/devDataDir.mjs`) merged into its `env`. Start it with `preview_start`, then start `web`.
3. Sign in as `scripta_dev`. Read the password with exactly `node -e 'process.stdout.write(require("./scripts/fixtures/account.json").password)'` from the worktree root, fill it into the login form in the preview pane, and never repeat it.
4. Open `/dashboard/reader-card` and check:
   - **Finish:** 12 thumbnails between Corners and Print. Each thumbnail matches the preview after you pick it.
   - **Foil, holographic, gilt:**
     - The preview's front face shows the shine.
     - It follows the pointer and sweeps when the pointer leaves.
     - With reduced motion emulated, it sits still and ignores the pointer.
     - The gradient ink renders (not black or blank) with the viewer open over a mural that shows the same card, in both themes.
   - **Back pages:** turn the card. Every finish keeps its paper, and the record rows are plain and legible.
   - **Print:** `Dark` and `Light` each with aged, kraft and foil.
   - **Visitors preview and a shared mural:** the chosen finish shows to visitors.
5. Restore the fixture account's style when you finish (Finish `Plain`, Print `Auto`).

- [ ] **Step 2: Device pass**

Run `node scripts/dev-status.mjs --json` once. If no other worktree holds the emulator, dispatch `device-checker` for the mobile editor and the My shelf block:
- The Finish row opens the inline panel: 12 tiles, 4 per row, nothing clipped. Picking one keeps the panel open and updates the pinned card. Report how long the panel takes to fill: it mounts 12 textured full-card thumbnails at once.
- Each finish in the pinned preview in light and dark themes:
  - foil and holo ink visibly a gradient (react-native-svg must accept `fill:url(#…)` inside `style`);
  - the vellum and kraft textures visible;
  - stamp holes visible;
  - riso's offset copy down-right;
  - gilt's frame gold.
- The full-screen viewer for foil: the shine band is present. The emulator cannot be tilted reliably, so tilt is checked on the owner's phone in Step 3.
- Back pages legible under every finish.

The web check and the device pass share the `scripta_dev` account. Run them one after the other, not at the same time, because the backend rate limit (120/min) counts both.

- [ ] **Step 3: Tilt on a real phone**

Start the phone stack with `node scripts/dev-phone.mjs` and give the owner the printed `exp://` URL. Ask them to:
- set Finish to Foil;
- open the card from My shelf;
- tilt the phone. The band should follow the tilt.

Then turn on the system's reduce-motion setting, reopen the card, and check that the band stays still. Run `npm run dev:release` afterwards.

- [ ] **Step 4: Ship**

1. Skip `security-review` and say so in the PR. The finish is public style like the other decorations; no auth, token or visibility rule changes.
2. Run `branch-reviewer` with this plan and the spec.
3. Push, and open the PR "Reader card A6: finishes" against `main`. Attach the contact sheet's `finishes.html` (`npm run sheet -w @scripta/shared`) as screenshots or an artifact, as the spec asks.
4. Enable `--auto` after the device pass, or after recording that it was skipped.
5. Add a deploy note:
   - Production must run the backend from this PR before the mobile OTA ships. An older backend returns 400 on `finish`.
   - No migration and no env vars.
   - Deploying is the owner's call.
