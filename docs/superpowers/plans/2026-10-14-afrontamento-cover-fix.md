# Afrontamento Cover Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1,171 bad Edições Afrontamento covers stored by the 2026-10-13 publisher import with clean crops, and stop the classifier from producing them again.

**Architecture:**
- **Classifier (`classifyPublisherImage`).** Its mock-up crop gains an edge-refinement pass. The existing `trim` finds a box around the book plus its shadow; each side of that box then moves inward to the book's first straight, strong edge, but only across a smooth stripe (a shadow, not cover art). The corner tolerance that decides "uniform canvas" rises from 20 to 32, so lightly vignetted coloured canvases count as mock-ups instead of passing as flat square covers.
- **Reset module.** A new module and script put the affected books back to their pre-import cover state and delete the bad images.
- **Importer.** It gains `--site` so only Afrontamento is re-run.

**Tech Stack:** TypeScript, sharp, `node:sqlite`, `node:test`.

**Spec:** this plan carries the design (no separate spec); background is in `docs/superpowers/plans/2026-10-04-publisher-cover-crop.md`, which introduced the classifier.

## Background (measured 2026-10-14)

- **The run.** It set 3,922 covers. 2,176 were crops: Afrontamento 1,114, Exclamação 671, Imprensa Nacional 383. A further 1,668 were "flat" squares.
  - Reports live in production: `/data/publisher-import-2026-10-13.json` and `.log`. The 2026-10-03 report is `/data/import-publisher-covers.log`.
  - Every stored image has `cover_images.source = 'publisher'`, `origin = 'https://www.edicoesafrontamento.pt'`, a `created_at` at or after `2026-10-13T20:39Z`, and book `cover_status = 'manual'`.
- **The spot-check.** It covered 28 random new covers. Exclamação and Imprensa Nacional are acceptable. All 13 Afrontamento covers are bad.
- **Afrontamento originals.** They are 2048×2048 renders.
  - **Canvas.** A light canvas: grey 187–227, or tinted light blue/lilac.
  - **Shadow.** A long soft drop shadow on the left, falling from about 190 to 77 over about 430px, and a soft band under the book.
  - **Book edges.** Sharp: luma jumps of 15–90 over 1–2px at the 400px classify scale.
  - **Why the trim fails.** `trim(threshold 50)` against the top-left pixel stops halfway into the shadow, so crops keep a grey margin and shadow on the left and bottom.
  - **Why squares slip through.** Two originals sit on cyan and lilac canvases whose corners differ by 23–28. That is above `CORNER_TOLERANCE = 20`, so the canvas isn't "uniform" and they fall through to `flat`.
- **Python prototype.** The algorithm below, run on 12 Afrontamento originals, gave 11 clean crops with ratios 1.22–1.57. The miss was a pale cover whose bottom edge has a luma step under 15, and it keeps a thin bottom shadow. It also cropped both squares correctly and kept the synthetic "pale cover edge" and "shadow band" fixtures at their expected ratios.
  - The originals are in the scratchpad of session 85974729; Task 3 refetches a larger sample.

## Global Constraints

- No new dependencies; sharp only.
- No comments in code. Put the non-obvious *why* in commit messages.
- Classifier test fixtures are generated with sharp, from SVG or `create`. No image files on disk.
- New `*.test.ts` files must be added to the explicit list in `backend/package.json`'s `test` script.
- **Production writes run by the user.** The production steps (Task 5) run over `railway ssh` and are run by the user. Claude Code's auto-mode classifier blocks Claude from running them, so give the exact command and read the output the user pastes.
- **Deploy first.** The scripts run from `/app/backend/dist` in the container, so the code must be deployed before Task 5 (`gh workflow run deploy.yml -f sha=<main tip>`, run by the user).
- **No deploys during a run.** No deploy may run while the importer runs, or the container restart kills it. Merges to main are fine.
- Backend verify: `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace backend`, `npm test --workspace backend`.

## Review Focus

1. **Light cover on a light canvas.** On a side with no shadow, the trim boundary is already the book's edge and must not move inward into the cover. Pinned by the existing "pale cover edge" test and the new band test in Task 1.
2. **Flat colour band next to the shadow.** A cover whose edge next to the shadow is a flat band (Afrontamento's olive "Biblioteca das Ciências Sociais" strip) keeps the band. The refinement must stop at the first strong edge from the outside, not at an inner one. Task 1 test.
3. **Genuine square covers.** The tolerance change (20 → 32) must not turn a real square cover into a "mock-up". A square whose art reaches the edges stays `flat` even when its corners differ by 21–32 (Task 1 test). The case it *can* change is a real square cover with plain margins and corners differing by 21–32: it is now refused instead of stored flat. Task 3's Penguin and Presença sample measures how often that happens.
4. **Reset scope.** The reset touches only books whose current cover is a publisher image from the given origin created at or after `since`. A book whose cover changed since (another image id) is skipped, not overwritten. Task 2 tests.
5. **Rejected covers stay rejected.** The reset never restores an image whose URL the user rejected (`cover_rejections`). Task 2 test.

---

### Task 1: Crop mock-ups to the book's edges, and treat lightly vignetted canvases as uniform

**Files:**
- Modify: `backend/src/modules/books/domain/images.ts` (constants at lines 12–21, `classifyPublisherImage` at lines 111–163)
- Test: `backend/src/modules/books/domain/images.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `classifyPublisherImage(input: Buffer): Promise<PublisherImage | null>`, with the signature unchanged. The `cropped` branch now returns the refined crop.

- [ ] **Step 1: Write the failing tests**

Add these to `images.test.ts`, after the existing "a shadow band stays outside the crop…" test. They reuse `rectangle`, `canvas` and `ratioOf`, which are already in the file. `gradient` is a new helper; put it next to `rectangle`.

```ts
async function gradient(width: number, height: number, from: string, to: string, vertical: boolean, left: number, top: number): Promise<Layer> {
  const [x2, y2] = vertical ? ["0", "1"] : ["1", "0"];
  const svg = `<svg width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`;
  return { input: await sharp(Buffer.from(svg)).png().toBuffer(), left, top };
}

test("a soft drop shadow on a grey canvas is cropped away, leaving only the book", async () => {
  const image = await canvas(2048, 2048, "#dcdcdc", [
    await gradient(430, 1600, "#dcdcdc", "#4d4d4d", false, 44, 224),
    await gradient(1100, 170, "#7d7d7d", "#dcdcdc", true, 474, 1824),
    await rectangle(1100, 1600, "#2a6f97", 474, 224),
  ]);
  const result = await classifyPublisherImage(image);
  assert.equal(result?.kind, "cropped");
  const { width } = await sharp(result!.input).metadata();
  assert.ok(Math.abs(width! - 1100) <= 22, `width ${width}`);
  assert.ok(Math.abs((await ratioOf(result!.input)) - 1600 / 1100) < 0.02);
});

test("a flat colour band at the cover's shadowed edge stays inside the crop", async () => {
  const image = await canvas(2048, 2048, "#dcdcdc", [
    await gradient(430, 1600, "#dcdcdc", "#4d4d4d", false, 44, 224),
    await gradient(1100, 170, "#7d7d7d", "#dcdcdc", true, 474, 1824),
    await rectangle(1100, 1360, "#2a6f97", 474, 224),
    await rectangle(1100, 240, "#b2af90", 474, 1584),
  ]);
  const result = await classifyPublisherImage(image);
  assert.equal(result?.kind, "cropped");
  assert.ok(Math.abs((await ratioOf(result!.input)) - 1600 / 1100) < 0.02);
});

test("a book on a lightly vignetted coloured canvas is cropped, not kept as a square", async () => {
  const image = await canvas(2048, 2048, "rgb(150,222,228)", [
    await rectangle(400, 400, "rgb(140,198,214)", 0, 1648),
    await rectangle(1100, 1500, "#f2ead8", 474, 274),
  ]);
  const result = await classifyPublisherImage(image);
  assert.equal(result?.kind, "cropped");
  assert.ok(Math.abs((await ratioOf(result!.input)) - 1500 / 1100) < 0.02);
});

test("a square cover whose art reaches all four edges stays flat on a slightly uneven background", async () => {
  const image = await canvas(2048, 2048, "#f4e9d2", [
    await rectangle(400, 400, "#ddd2bb", 0, 1648),
    await rectangle(248, 2048, "#1d3557", 900, 0),
    await rectangle(2048, 248, "#e63946", 0, 900),
  ]);
  assert.equal((await classifyPublisherImage(image))?.kind, "flat");
});
```

`ratioOf` is defined further down the file. If it sits after these tests, that's fine: function declarations are hoisted. If it is a `const` arrow function, move the new tests below it.

- [ ] **Step 2: Run them and confirm the first three fail**

Run: `npm test --workspace backend 2>&1 | rg -n "shadow on a grey canvas|flat colour band|vignetted|art runs" -A3`
- The soft-shadow and band tests fail on the width or ratio assertion, because the crop includes the shadow.
- The vignette test fails with `kind` `flat`.
- The square-art test passes before and after the change. It guards the change: its corners differ by 24, so the new tolerance calls them uniform, but its art reaches every edge, so the trim keeps the whole image and it stays `flat`.

- [ ] **Step 3: Implement**

In `images.ts`, change the corner tolerance and add the edge constants beside the others:

```ts
const CORNER_TOLERANCE = 32;
const EDGE_STEP = 15;
const EDGE_GAP = 2;
const EDGE_SHARE = 0.6;
const EDGE_SEARCH = 0.3;
const SHADOW_ROUGHNESS = 12;
```

Add the box type and refinement function above `classifyPublisherImage`. All coordinates are inclusive, in the small (≤400px) image:

```ts
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function refineToBookEdges(luma: Float32Array, width: number, height: number, box: Box): Box {
  const at = (x: number, y: number) => luma[y * width + x] ?? 0;
  const columnIsEdge = (x: number, outward: -1 | 1) => {
    const neighbour = x + outward * EDGE_GAP;
    if (neighbour < 0 || neighbour >= width) return false;
    let strong = 0;
    for (let y = box.top; y <= box.bottom; y++) if (Math.abs(at(x, y) - at(neighbour, y)) >= EDGE_STEP) strong++;
    return strong >= EDGE_SHARE * (box.bottom - box.top + 1);
  };
  const rowIsEdge = (y: number, outward: -1 | 1) => {
    const neighbour = y + outward * EDGE_GAP;
    if (neighbour < 0 || neighbour >= height) return false;
    let strong = 0;
    for (let x = box.left; x <= box.right; x++) if (Math.abs(at(x, y) - at(x, neighbour)) >= EDGE_STEP) strong++;
    return strong >= EDGE_SHARE * (box.right - box.left + 1);
  };
  const roughness = (left: number, top: number, right: number, bottom: number) => {
    let total = 0;
    let count = 0;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        total += Math.abs(at(Math.min(x + 1, width - 1), y) - at(x, y)) + Math.abs(at(x, Math.min(y + 1, height - 1)) - at(x, y));
        count++;
      }
    }
    return count === 0 ? 0 : total / count;
  };
  const firstEdge = (from: number, steps: number, direction: 1 | -1, isEdge: (value: number) => boolean) => {
    for (let step = 0; step <= steps; step++) if (isEdge(from + direction * step)) return from + direction * step;
    return null;
  };
  const reachX = Math.floor((box.right - box.left) * EDGE_SEARCH);
  const reachY = Math.floor((box.bottom - box.top) * EDGE_SEARCH);
  const left = firstEdge(box.left, reachX, 1, (x) => columnIsEdge(x, -1));
  const right = firstEdge(box.right, reachX, -1, (x) => columnIsEdge(x, 1));
  const top = firstEdge(box.top, reachY, 1, (y) => rowIsEdge(y, -1));
  const bottom = firstEdge(box.bottom, reachY, -1, (y) => rowIsEdge(y, 1));
  return {
    left: left !== null && roughness(box.left, box.top, left - 1, box.bottom) < SHADOW_ROUGHNESS ? left : box.left,
    right: right !== null && roughness(right + 1, box.top, box.right, box.bottom) < SHADOW_ROUGHNESS ? right : box.right,
    top: top !== null && roughness(box.left, box.top, box.right, top - 1) < SHADOW_ROUGHNESS ? top : box.top,
    bottom: bottom !== null && roughness(box.left, bottom + 1, box.right, box.bottom) < SHADOW_ROUGHNESS ? bottom : box.bottom,
  };
}
```

Then replace the body of the `cropped` branch in `classifyPublisherImage`, currently the `if (photoOnCanvas && cornerMean >= LIGHT_CANVAS_MEAN) { … }` block. Map the trim box into the small image, refine it, map it back, and extract from the full-resolution decode:

```ts
    if (photoOnCanvas && cornerMean >= LIGHT_CANVAS_MEAN) {
      const luma = new Float32Array(smallWidth * smallHeight);
      for (let i = 0; i < luma.length; i++) {
        const offset = i * smallChannels;
        luma[i] = 0.299 * (small.data[offset] ?? 0) + 0.587 * (small.data[offset + 1] ?? 0) + 0.114 * (small.data[offset + 2] ?? 0);
      }
      const scaleX = smallWidth / width;
      const scaleY = smallHeight / height;
      const trimLeft = -(trimmed.info.trimOffsetLeft ?? 0);
      const trimTop = -(trimmed.info.trimOffsetTop ?? 0);
      const book = refineToBookEdges(luma, smallWidth, smallHeight, {
        left: Math.floor(trimLeft * scaleX),
        top: Math.floor(trimTop * scaleY),
        right: Math.min(smallWidth - 1, Math.ceil((trimLeft + trimmed.info.width) * scaleX) - 1),
        bottom: Math.min(smallHeight - 1, Math.ceil((trimTop + trimmed.info.height) * scaleY) - 1),
      });
      const left = Math.round(book.left / scaleX);
      const top = Math.round(book.top / scaleY);
      const cropWidth = Math.min(width - left, Math.round((book.right + 1) / scaleX) - left);
      const cropHeight = Math.min(height - top, Math.round((book.bottom + 1) / scaleY) - top);
      const ratio = cropHeight / cropWidth;
      if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO || (cropWidth * cropHeight) / (width * height) < MIN_CROP_AREA) return null;
      const cropped = await sharp(decoded.data, rawOptions).extract({ left, top, width: cropWidth, height: cropHeight }).png().toBuffer();
      return { kind: "cropped", input: cropped };
    }
```

`trimmed` is still computed above this block exactly as today. Its `info.width` and `info.height` still drive `keptWidth`, `keptHeight` and `photoOnCanvas`. If TypeScript says `trimOffsetLeft` is missing from `OutputInfo`, check `node_modules/sharp/lib/index.d.ts`. The field exists in the sharp versions this repo uses. Don't cast around a real absence; report it instead.

- [ ] **Step 4: Run the whole backend suite**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
- Expected: all pass, including every existing classifier and importer test.
- In particular, "corners that differ by 15 are uniform and corners that differ by 40 are not" still holds at tolerance 32.
- If an existing test fails, report the test and the numbers. Don't loosen its assertion.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/images.ts backend/src/modules/books/domain/images.test.ts && git commit -m "$(cat <<'EOF'
Crop publisher mock-ups to the book's edges, not the shadow

Afrontamento renders its books with a long soft drop shadow on a light grey
canvas. Trimming against the corner colour stops halfway into that gradient,
so 1,114 crops kept a grey margin. Each side of the trimmed box now moves in
to the first straight, strong edge, but only across a smooth stripe, so cover
art and flat cover bands are never cut.

Coloured canvases with a slight vignette differed by 23-28 between corners and
fell through to "flat", storing 57 whole mock-ups as square covers; the
uniform-canvas tolerance is now 32.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Reset tool for one publisher's covers, and `--site` for the importer

**Files:**
- Create: `backend/src/modules/books/seed/resetPublisherCovers.ts`
- Create: `backend/src/modules/books/seed/resetPublisherCovers.test.ts`
- Create: `backend/scripts/reset-publisher-covers.mjs`
- Modify: `backend/scripts/import-publisher-covers.mjs` (`parseArgs` at line 7, `PUBLISHERS` argument at about line 49)
- Modify: `backend/package.json` (`test` script: add `src/modules/books/seed/resetPublisherCovers.test.ts`)

**Interfaces:**
- Consumes:
  - the `books`, `cover_images` and `cover_rejections` tables (`books.sql`);
  - `applyBooksMigrations(db)` and `createSqliteBooksRepository(db)` for tests;
  - `ObjectStore.delete(key)` (`backend/src/storage/objectStore.ts`).
- Produces:
  ```ts
  export interface ResetReport { matched: number; restoredLowRes: number; markedMissing: number; skipped: number }
  export async function resetPublisherCovers(
    deps: { db: DatabaseSync; deleteBlob: (key: string) => Promise<void>; now: () => Date },
    options: { origin: string; since: string; apply: boolean }
  ): Promise<ResetReport>
  ```

**Behaviour:**
- **Which books.** Every book whose *current* cover image has `source = 'publisher'`, `origin = options.origin` and `created_at >= options.since`, and whose `cover_status = 'manual'`.
- **What each book gets back.** Its previous cover state:
  - **Previous image found.** The newest *other* `cover_images` row for that book with `created_at < options.since` whose `source_url` is not in that book's `cover_rejections`. The book gets `cover_image_id` = that row and `cover_status = 'low_res'`. A classified cover only ever filled `missing` or `low_res` books, so an older image means it was `low_res`.
  - **None found.** `cover_image_id = NULL` and `cover_status = 'missing'`.
  - **Either way.** `cover_checked_at` = `now()`.
- **Race guard.** The update is guarded on `cover_image_id` still being the publisher image. A miss counts as `skipped`, and that book's image is not deleted.
- **Clean-up.** After a successful update, delete the publisher image's `cover_images` row and its blobs, `covers/<id>.webp` and `covers/<id>-thumb.webp`.
- **Dry run.** `apply: false` counts only and writes nothing. Every counter is filled as if applied, except `skipped`, which is 0.
- **Rejections.** It never adds a `cover_rejections` row. The re-run must be free to fetch the same URL and classify it with the new code.

- [ ] **Step 1: Write the failing tests** in `resetPublisherCovers.test.ts`

```ts
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applyBooksMigrations } from "../adapters/sqlite/connection.js";
import { resetPublisherCovers } from "./resetPublisherCovers.js";

const ORIGIN = "https://www.edicoesafrontamento.pt";
const SINCE = "2026-10-13T20:30:00.000Z";
const NOW = new Date("2026-10-14T12:00:00.000Z");

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const deleted: string[] = [];
  const deps = { db, deleteBlob: async (key: string) => void deleted.push(key), now: () => NOW };
  let n = 0;
  const book = (status: string | null) => {
    const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    db.prepare("INSERT INTO books (id, title, author, isbn, cover_status, created_at) VALUES (?, ?, '', ?, ?, ?)").run(id, `Book ${n}`, `97897236${String(n).padStart(5, "0")}`, status, "2026-10-01T00:00:00.000Z");
    return id;
  };
  const image = (bookId: string, source: string, origin: string | null, createdAt: string, sourceUrl = `https://img.test/${++n}.jpg`) => {
    const id = `10000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    db.prepare("INSERT INTO cover_images (id, book_id, source, source_url, origin, width, height, byte_size, color, created_at) VALUES (?, ?, ?, ?, ?, 500, 750, 1, '', ?)").run(id, bookId, source, sourceUrl, origin, createdAt);
    return id;
  };
  const point = (bookId: string, imageId: string | null, status: string) => db.prepare("UPDATE books SET cover_image_id = ?, cover_status = ? WHERE id = ?").run(imageId, status, bookId);
  const row = (bookId: string) => db.prepare("SELECT cover_image_id, cover_status, cover_checked_at FROM books WHERE id = ?").get(bookId) as { cover_image_id: string | null; cover_status: string | null; cover_checked_at: string | null };
  const imageExists = (id: string) => db.prepare("SELECT 1 FROM cover_images WHERE id = ?").get(id) !== undefined;
  return { db, deps, deleted, book, image, point, row, imageExists };
}

test("a publisher cover over a low-res one is reset to the low-res cover and its files deleted", async () => {
  const h = setup();
  const id = h.book("low_res");
  const lowRes = h.image(id, "apple", null, "2026-10-05T00:00:00.000Z");
  const bad = h.image(id, "publisher", ORIGIN, "2026-10-14T01:00:00.000Z");
  h.point(id, bad, "manual");
  const report = await resetPublisherCovers(h.deps, { origin: ORIGIN, since: SINCE, apply: true });
  assert.deepEqual(report, { matched: 1, restoredLowRes: 1, markedMissing: 0, skipped: 0 });
  assert.deepEqual(h.row(id), { cover_image_id: lowRes, cover_status: "low_res", cover_checked_at: NOW.toISOString() });
  assert.equal(h.imageExists(bad), false);
  assert.deepEqual(h.deleted.sort(), [`covers/${bad}-thumb.webp`, `covers/${bad}.webp`]);
});

test("a publisher cover on a book that had none is reset to missing", async () => {
  const h = setup();
  const id = h.book("missing");
  const bad = h.image(id, "publisher", ORIGIN, "2026-10-14T01:00:00.000Z");
  h.point(id, bad, "manual");
  const report = await resetPublisherCovers(h.deps, { origin: ORIGIN, since: SINCE, apply: true });
  assert.deepEqual(report, { matched: 1, restoredLowRes: 0, markedMissing: 1, skipped: 0 });
  assert.deepEqual(h.row(id), { cover_image_id: null, cover_status: "missing", cover_checked_at: NOW.toISOString() });
});

test("an older image the user rejected is never restored", async () => {
  const h = setup();
  const id = h.book("missing");
  h.image(id, "apple", null, "2026-10-05T00:00:00.000Z", "https://img.test/rejected.jpg");
  h.db.prepare("INSERT INTO cover_rejections (book_id, source_url, created_at) VALUES (?, ?, ?)").run(id, "https://img.test/rejected.jpg", "2026-10-06T00:00:00.000Z");
  const bad = h.image(id, "publisher", ORIGIN, "2026-10-14T01:00:00.000Z");
  h.point(id, bad, "manual");
  await resetPublisherCovers(h.deps, { origin: ORIGIN, since: SINCE, apply: true });
  assert.equal(h.row(id).cover_image_id, null);
  assert.equal(h.row(id).cover_status, "missing");
});

test("covers from another publisher, an earlier run, or another source are left alone", async () => {
  const h = setup();
  const other = h.book("missing");
  h.point(other, h.image(other, "publisher", "https://www.exclamacao.pt", "2026-10-14T01:00:00.000Z"), "manual");
  const earlier = h.book("missing");
  h.point(earlier, h.image(earlier, "publisher", ORIGIN, "2026-10-03T01:00:00.000Z"), "manual");
  const upload = h.book("missing");
  h.point(upload, h.image(upload, "upload", ORIGIN, "2026-10-14T01:00:00.000Z"), "manual");
  const before = [other, earlier, upload].map(h.row);
  const report = await resetPublisherCovers(h.deps, { origin: ORIGIN, since: SINCE, apply: true });
  assert.deepEqual(report, { matched: 0, restoredLowRes: 0, markedMissing: 0, skipped: 0 });
  assert.deepEqual([other, earlier, upload].map(h.row), before);
  assert.deepEqual(h.deleted, []);
});

test("a dry run counts the books and writes nothing", async () => {
  const h = setup();
  const id = h.book("missing");
  const bad = h.image(id, "publisher", ORIGIN, "2026-10-14T01:00:00.000Z");
  h.point(id, bad, "manual");
  const report = await resetPublisherCovers(h.deps, { origin: ORIGIN, since: SINCE, apply: false });
  assert.deepEqual(report, { matched: 1, restoredLowRes: 0, markedMissing: 1, skipped: 0 });
  assert.equal(h.row(id).cover_image_id, bad);
  assert.equal(h.imageExists(bad), true);
  assert.deepEqual(h.deleted, []);
});
```

The `INSERT` column lists above must match `books.sql`. Before running, check the `books` and `cover_images` `CREATE TABLE` statements. If `cover_images` has no `color` column, or `books` needs other NOT NULL columns, adjust the fixture inserts to the real schema. Never change the schema to fit the test.

Add the race-guard test. The cover must change between the select and the update, so the first book's blob deletion repoints the second book:

```ts
test("a book whose cover changed after the reset started is skipped and keeps its cover", async () => {
  const h = setup();
  const first = h.book("missing");
  const firstBad = h.image(first, "publisher", ORIGIN, "2026-10-14T01:00:00.000Z");
  h.point(first, firstBad, "manual");
  const second = h.book("missing");
  const secondBad = h.image(second, "publisher", ORIGIN, "2026-10-14T01:00:01.000Z");
  h.point(second, secondBad, "manual");
  const upload = h.image(second, "upload", null, "2026-10-14T12:00:00.000Z");
  const deps = { ...h.deps, deleteBlob: async (key: string) => { if (key === `covers/${firstBad}.webp`) h.point(second, upload, "manual"); await h.deps.deleteBlob(key); } };
  const report = await resetPublisherCovers(deps, { origin: ORIGIN, since: SINCE, apply: true });
  assert.equal(report.skipped, 1);
  assert.equal(h.row(second).cover_image_id, upload);
  assert.equal(h.imageExists(secondBad), true);
});
```

The affected-books query orders by `ci.created_at`, so the first book is processed first.

- [ ] **Step 2: Run them to confirm they fail**

Add the test file to `backend/package.json`'s `test` list. Then run `npm test --workspace backend 2>&1 | rg -n "resetPublisherCovers|Cannot find module" | head`
Expected: it fails because `./resetPublisherCovers.js` doesn't exist.

- [ ] **Step 3: Implement `resetPublisherCovers.ts`**

```ts
import type { DatabaseSync } from "node:sqlite";

export interface ResetReport {
  matched: number;
  restoredLowRes: number;
  markedMissing: number;
  skipped: number;
}

export async function resetPublisherCovers(
  deps: { db: DatabaseSync; deleteBlob: (key: string) => Promise<void>; now: () => Date },
  options: { origin: string; since: string; apply: boolean }
): Promise<ResetReport> {
  const affected = deps.db
    .prepare(
      `SELECT b.id AS bookId, b.cover_image_id AS imageId FROM books b JOIN cover_images ci ON ci.id = b.cover_image_id
       WHERE ci.source = 'publisher' AND ci.origin = ? AND ci.created_at >= ? AND b.cover_status = 'manual' ORDER BY ci.created_at`
    )
    .all(options.origin, options.since) as Array<{ bookId: string; imageId: string }>;
  const previousStmt = deps.db.prepare(
    `SELECT id FROM cover_images WHERE book_id = ? AND id <> ? AND created_at < ?
       AND (source_url IS NULL OR source_url NOT IN (SELECT source_url FROM cover_rejections WHERE book_id = ?))
     ORDER BY created_at DESC LIMIT 1`
  );
  const updateStmt = deps.db.prepare(`UPDATE books SET cover_image_id = ?, cover_status = ?, cover_checked_at = ? WHERE id = ? AND cover_image_id = ?`);
  const deleteImageStmt = deps.db.prepare(`DELETE FROM cover_images WHERE id = ?`);
  const report: ResetReport = { matched: affected.length, restoredLowRes: 0, markedMissing: 0, skipped: 0 };
  const at = deps.now().toISOString();
  for (const { bookId, imageId } of affected) {
    const previous = previousStmt.get(bookId, imageId, options.since, bookId) as { id: string } | undefined;
    if (options.apply) {
      if (updateStmt.run(previous?.id ?? null, previous ? "low_res" : "missing", at, bookId, imageId).changes === 0) {
        report.skipped++;
        continue;
      }
      deleteImageStmt.run(imageId);
      await deps.deleteBlob(`covers/${imageId}.webp`);
      await deps.deleteBlob(`covers/${imageId}-thumb.webp`);
    }
    if (previous) report.restoredLowRes++;
    else report.markedMissing++;
  }
  return report;
}
```

- [ ] **Step 4: Add the script `backend/scripts/reset-publisher-covers.mjs`**

```js
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { origin: { type: "string" }, since: { type: "string" }, apply: { type: "boolean", default: false } } });
if (!values.origin || !values.since || Number.isNaN(Date.parse(values.since))) {
  console.error("usage: node scripts/reset-publisher-covers.mjs --origin <https://…> --since <ISO time> [--apply]");
  process.exit(1);
}

const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { resetPublisherCovers } = await import("../dist/modules/books/seed/resetPublisherCovers.js");
const { createObjectStore } = await import("../dist/storage/createObjectStore.js");

const store = createObjectStore();
const report = await resetPublisherCovers(
  { db: openBooksDb(), deleteBlob: (key) => store.delete(key), now: () => new Date() },
  { origin: values.origin, since: new Date(values.since).toISOString(), apply: values.apply }
);
console.log(JSON.stringify({ apply: values.apply, ...report }));
```

- [ ] **Step 5: Add `--site` to `import-publisher-covers.mjs`**

Change line 7, and the `PUBLISHERS` argument passed to `importPublisherCovers`:

```js
const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, site: { type: "string" } } });
```

```js
const sites = values.site ? PUBLISHERS.filter((site) => site.name === values.site) : PUBLISHERS;
if (sites.length === 0) {
  console.error(`unknown site "${values.site}"; names are: ${PUBLISHERS.map((site) => site.name).join(", ")}`);
  process.exit(1);
}
```

Pass `sites` instead of `PUBLISHERS` to `importPublisherCovers`. Put the `sites` lines after the `PUBLISHERS` import and before `createObjectStore()`.

- [ ] **Step 6: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && node --check backend/scripts/reset-publisher-covers.mjs && node --check backend/scripts/import-publisher-covers.mjs`
Expected: everything passes.

Then run a local smoke test against a scratch DB:
1. `npm run build --workspace backend`.
2. Then `COVERS_DB_PATH=$(mktemp -d)/covers.sqlite node backend/scripts/reset-publisher-covers.mjs --origin https://www.edicoesafrontamento.pt --since 2026-10-13T20:30Z`. Use the same environment preamble the backend tests use, or `config/env.ts` exits at import. It should print `{"apply":false,"matched":0,…}`.
3. Then `node backend/scripts/import-publisher-covers.mjs --site Nope` should exit 1 listing the site names.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/books/seed/resetPublisherCovers.ts backend/src/modules/books/seed/resetPublisherCovers.test.ts backend/scripts/reset-publisher-covers.mjs backend/scripts/import-publisher-covers.mjs backend/package.json && git commit -m "$(cat <<'EOF'
Add a reset for one publisher's imported covers, and --site for the importer

Publisher covers are stored as status manual, which nothing ever replaces, and
the importer skips any book whose cover is already a publisher image. Undoing
a bad run therefore needs the books put back first: to the low-res cover they
had, or to missing, never to an image the user rejected. Rejections are not
added, so the re-run can fetch the same URLs and classify them again.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 (main session, not an implementer): calibrate on real images before merge

This gate decides whether the constants in Task 1 hold beyond the 12 prototype images. Do it after Tasks 1–2 pass review and before the PR merges.

- [ ] **Step 1: Fetch a real sample into the scratchpad**

Fetch 40 random Afrontamento products from `https://www.edicoesafrontamento.pt/products.json?limit=250&page=N` (Shopify; use pages 1–10, and send the importer's User-Agent string). Take each product's first image `src`. Also fetch 10 products each from Exclamação, Imprensa Nacional, Penguin Livros and Presença, using the `origin` values in `publishers.ts`; WooCommerce sites use `/wp-json/wc/store/products?per_page=…&page=…`. This is a regression check for future runs of those publishers.

- [ ] **Step 2: Run the built classifier on them**

Build the backend first (`npm run build --workspace backend`). Then run a scratch `.mjs` that imports `classifyPublisherImage` and `isAcceptableCover` from `backend/dist/modules/books/domain/images.js`. For each image, follow the importer's order (`importPublisherCovers.ts:266-279`):
1. If the original is already cover-shaped, record `kept`.
2. Otherwise record `cropped`, `flat` or `null`.

Save every output as a PNG. Then build a contact sheet (PIL is available) with each label.

- [ ] **Step 3: Judge it and record the result in the PR description**

Pass criteria:
- At least 36 of the 40 Afrontamento covers are `cropped` or `kept` with no visible canvas or shadow on any side.
- None is cut into the cover art.
- No Afrontamento image is `flat`.
- In the other four publishers, no image's outcome got worse than under `main`'s classifier. Run the same script against a `main` build for comparison.

If it falls short, tune `EDGE_STEP`, `EDGE_SHARE` or `SHADOW_ROUGHNESS` within the ranges the prototype tried (12–40, 0.4–0.6, 6–12). Never go to `EDGE_SHARE` 0.4: it cut into two covers in the prototype. Add a synthetic test for the failure mode you saw, and rerun. A residual thin bottom shadow on a pale cover whose edge step is under 15 is a known, accepted miss.

---

### Task 4: Ship and deploy

- [ ] **Step 1:** Run the `ship` skill: PR to `main` with auto-merge, and the Task 3 contact-sheet summary in the description.
- [ ] **Step 2:** After merge, ask the user to deploy, giving the exact command with the merged main tip: `gh workflow run deploy.yml -f sha=<main tip>`. Confirm the Railway deployment reached `SUCCESS` (Railway MCP `get-logs` on service `4fda553d-dff6-4b9c-8dd3-77ada1f5e4f0`, project `404b0e4a-701b-47ea-83fc-a82a80ae5094`).

---

### Task 5: Production run (commands run by the user; Claude reads the output)

Every command uses this prefix:
`npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c '…'`

The container has no `nohup`. Start background jobs with `setsid … &` followed by `sleep 3` and an `ls` of the output files, and confirm they appeared.

- [ ] **Step 1: Dry-run the reset.** `cd /app/backend && node scripts/reset-publisher-covers.mjs --origin https://www.edicoesafrontamento.pt --since 2026-10-13T20:30:00Z`
  Expected: `matched` about 1,171 (the run's Afrontamento `coversSet`). Stop and investigate if it is far off.
- [ ] **Step 2: Apply.** Run the same command with `--apply`. Expected: `skipped` 0 or near 0, and `restoredLowRes + markedMissing = matched - skipped`.
- [ ] **Step 3: Re-run the importer for Afrontamento only.**
  `cd /app/backend && setsid node scripts/import-publisher-covers.mjs --site "Edições Afrontamento" > /data/publisher-import-afrontamento-<date>.json 2> /data/publisher-import-afrontamento-<date>.log < /dev/null & sleep 3; ls -la /data/publisher-import-afrontamento-<date>.*`
  The last Afrontamento pass took a few hours. Hold deploys until the `.json` file has content.
  - **Checking it's alive.** Match `bin/nod[e] scripts/import-publisher` in `/proc/*/cmdline`. The bracket stops the check matching itself.
- [ ] **Step 4: Compare.** Compare the Afrontamento report with the 2026-10-13 one (cropped 1,114, squareAccepted 57, rejectedImage 468). Expect `squareAccepted` near 0 and `coversSet` near 1,171.
- [ ] **Step 5: Spot-check.** The user runs a read-only sample query: about 20 random Afrontamento books with `cover_status = 'manual'` and a cover created after the Step 3 start time, with their `images.atmyshelf.com` cover URLs. Claude builds a contact sheet, judges it, and sends it to the user.
- [ ] **Step 6:** Update the `catalog-launch-status` memory with the outcome.

## Out of scope (noted, not fixed here)

- **Presença squares.** Presença had 404 `squareAccepted` covers in the 2026-10-13 run and none were spot-checked. Presença publishes novels, which are rarely square. Sample them before trusting them; if they are mock-ups, this plan's reset tool handles them with `--origin` set to Presença's.
- **Two one-off bad covers.** One Exclamação cover is a near-blank square, and one Imprensa Nacional cover has missing glyphs ("Te_tro de Revist_"). Fix them through the app's cover rejection.
- **Empty titles.** 18 of the 28 sampled books had an empty `title`, which keeps them out of search (`title <> ''`). The cause has not been investigated.
