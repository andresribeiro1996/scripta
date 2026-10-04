# Publisher Cover Crop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover most of the ~7,000 publisher images the importer rejected on 2026-10-03. Two kinds get in:
- mock-ups: the book photographed on a background, cropped to the cover;
- real covers that are square: children's picture books.

Non-books (coins, mugs, badges) stay rejected. A cropped or square publisher cover never replaces a good cover a book already has. The same branch fixes the seed's hidden database error.

**Architecture:**
- **Classification.** A new pure function in `domain/images.ts` classifies a publisher image before it is encoded:
  - `cropped`: a product photo on a plain background, cropped to the book;
  - `flat`: the image is the cover itself;
  - rejected.
- **The importer** encodes the classified bytes, uses the matching acceptance rule, and only fills books that have no cover or a low-res one.
- **`createBook`** starts its transaction as a write (`BEGIN IMMEDIATE`) and only rolls back when a transaction is active, so the real error surfaces.

**Tech Stack:** Fastify/TypeScript backend, `sharp`, `node:sqlite`, `node:test`.

**Spec:** the Decisions below. They come from chat on 2026-10-04 and from the calibration run on real rejected images:
- results in the session scratchpad, `crop-calibration/*.json` and contact sheets;
- 5 publishers sampled: Afrontamento, Imprensa Nacional, Exclamação, Guerra & Paz, Penguin Livros.

## Decisions

### What the calibration found (2026-10-04)

- **Mock-ups on a plain background.**
  - **Afrontamento** (2048×2048): the book on a white or coloured canvas with a soft shadow.
  - **Exclamação** (600×600): the cover on white.
  - **Imprensa Nacional** (900×600): the book centred.
  - **Crop strength:** `trim({ threshold: 50 })` against the corner colour gives clean portrait crops (ratio 1.22–1.53). At 25 it leaves shadow bands; at 80 it cuts into white covers. A second trim pass changed nothing.
  - **What a crop keeps:** about 41–68% of the width, and 64–100% of the height.
- **Real covers that are square.** Penguin's picture books are 2000×2000 to 2000×2338 (ratio 1.0–1.17), and their trims keep 88–100% of the image. Cropping doesn't help; they need a wider ratio window.
- **Non-books.**
  - Imprensa Nacional coins: on white, the crop is round, ratio ≈ 1.0.
  - Imprensa Nacional mugs: crop ratio 0.86–0.99.
  - A Guerra & Paz round badge: white corners, fills about 90% of the canvas.

### Classification: `classifyPublisherImage(input: Buffer): Promise<PublisherImage | null>`

`PublisherImage = { kind: "cropped" | "flat"; input: Buffer }`

1. **Prepare.** Decode with `limitInputPixels` 8000×8000 and flatten alpha onto white. Read the 4 corner pixels of a ≤400 px downscale.
   - **Corners uniform:** max channel difference between any two corners ≤ 12.
   - **Corner mean:** the average of the 12 channel values.
2. **Trim.** `trim({ background: <top-left corner colour>, threshold: 50 })`. Record:
   - `keptW = trimmedW / W` and `keptH = trimmedH / H`;
   - `area = keptW × keptH`.
3. **Product photo (`cropped`).** When the corners are uniform and `keptW < 0.85` or `keptH < 0.85`:
   - the result is the trimmed bytes, kind `cropped`;
   - it's accepted only if its ratio is 1.2–1.9 and `area ≥ 0.30`, otherwise `null`. A coin, a mug, or a white cover trimmed down to its text block is rejected.
4. **The cover itself (`flat`).** Otherwise:
   - the result is the original bytes, kind `flat`;
   - it's accepted if the ratio is 0.75–1.9;
   - **except** when the corners are uniform, the corner mean is ≥ 235 and `keptW < 0.97` or `keptH < 0.97`. That's a white canvas around a non-portrait object (the badge), so `null`.
5. **Errors.** Any decode error gives `null`, as `encodeCover` does today.

### Acceptance and replacement in the importer

- **Order of checks.** An image that already passes `isAcceptableCover` (ratio 1.2–1.9) is used as today, unclassified, so behaviour for good images doesn't change. Only a rejected image goes through `classifyPublisherImage`, and its result is encoded with `encodeCover`.
- **Classified covers only fill gaps.** A cover found this way (`cropped`, or `flat` with ratio < 1.2) is stored only when the book has no cover or a `low_res` one. It never replaces a `good` cover from any source.
  - It's stored like any publisher cover (source `publisher`, status `manual`) so re-runs stay no-ops.
  - Sub-400 px covers keep today's rule: they fill only books without any cover.
- **Report.** `SiteReport` gains `cropped` and `squareAccepted` counts. `rejectedImage` keeps counting what's still rejected.

### Seed error fix

- `createBook` uses `BEGIN IMMEDIATE`.
- The catch rolls back only when `db.isTransaction` is true, then rethrows the original error.
- On 2026-10-04 the seed died at 48,000 of 50,000 with "cannot rollback - no transaction is active", which hid the real error.

### Re-run

After merge and deploy, re-run the importer with deploys paused. That's the controller's step, not code. Books with a publisher cover are skipped without a download; previously rejected images are fetched again.

## Global Constraints

- Minimum code, no code comments, no new dependencies (root `AGENTS.md`).
- Catch only the errors you expect; decode failures map to `null`, as `encodeCover` does.
- Every new `*.test.ts` is appended to `backend/package.json` `"test"`. Backend tests run with `DOTENV_CONFIG_PATH=/nonexistent/.env`.
- Tests use synthetic images generated with sharp (no network, no publisher images in the repo).
- Memory: classification runs inside the importer's existing one-image-at-a-time lock (`exclusive`), on the same bytes, with no extra parallelism.

## Review Focus

1. **A white or very pale cover on a white canvas, with no shadow:** it must not come out as a cropped text block. The `area ≥ 0.30` rule rejects it. Pinned in Task 1.
2. **A coin or mug on white:** rejected, because its crop ratio is about 1.0. Pinned in Task 1.
3. **A book with a good Apple cover whose publisher image is a mock-up:** the Apple cover stays. Pinned in Task 2.
4. **A Penguin-style square picture-book cover:** accepted as `flat`. A white-canvas round badge is rejected. Pinned in Task 1.
5. **The seed's real database error surfaces** instead of "cannot rollback". Pinned in Task 3.

---

### Task 1: `classifyPublisherImage`

**Files:** Modify `backend/src/modules/books/domain/images.ts`; Test `backend/src/modules/books/domain/images.test.ts`.

**Interfaces:**
- Produces: `export interface PublisherImage { kind: "cropped" | "flat"; input: Buffer }` and `export async function classifyPublisherImage(input: Buffer): Promise<PublisherImage | null>`.

- [ ] **Step 1: Failing tests.** Build the synthetic inputs with `sharp({ create: { width, height, channels: 3, background } })` plus `composite` of rectangles and circles. Expected results:

| Input | Expected |
|---|---|
| A 2048×2048 white canvas, a 1100×1600 coloured rectangle centred, and a 40 px soft grey border around it as the shadow | `cropped`; the re-measured ratio is within 1.2–1.9 |
| A 900×600 white canvas with a 365×556 centred rectangle | `cropped` |
| A 900×600 white canvas with a centred circle of diameter 580 | `null` |
| A 2000×2000 image of random colour blocks, edge to edge | `flat` |
| A 2000×2000 image filled with one colour, with a smaller differently coloured rectangle inside covering 95% | `flat` |
| A 500×500 white canvas with a black circle of diameter 450 | `null` |
| A 2048×2048 white canvas with a 1100×1600 white rectangle that has only a small dark text-like block in it (100×60) | `null` |
| Landscape random colour blocks, 2000×1000 (ratio 0.5) | `null` |
| A corrupt buffer | `null` |

- [ ] **Step 2:** Run them and watch them fail:

```bash
cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test src/modules/books/domain/images.test.ts
```

- [ ] **Step 3:** Implement it following the Decisions' Classification steps 1–5 exactly. Keep the constants as named module constants: `CORNER_TOLERANCE` 12, `TRIM_THRESHOLD` 50, `PHOTO_KEPT` 0.85, `MIN_CROP_AREA` 0.30, `FLAT_MIN_RATIO` 0.75, `WHITE_CANVAS_MEAN` 235, `CANVAS_KEPT` 0.97.
- [ ] **Step 4:** Run the image tests and the backend typecheck.
- [ ] **Step 5: Commit:** `Tell a publisher's mock-up photo from its cover and crop it to the book`.

### Task 2: Use it in the importer

**Files:**
- Modify `backend/src/modules/books/seed/importPublisherCovers.ts` and `backend/README.md` (publisher importer paragraph).
- Test `backend/src/modules/books/seed/importPublisherCovers.test.ts`.

**Interfaces:** Consumes `classifyPublisherImage` from Task 1, and `encodeCover` and `isAcceptableCover` from `domain/images.ts`.

- [ ] **Step 1: Failing tests,** with the existing fakes and a fake `fetchBytes` returning synthetic images:
  - **Mock-up:** a mock-up image for a book with no cover is stored, and the report has `cropped` 1.
  - **Square:** a square picture-book cover is stored, and the report has `squareAccepted` 1.
  - **Good cover kept:** a mock-up for a book that already has a `good` Apple cover changes nothing.
  - **Low-res cover replaced:** a mock-up for a book with a `low_res` cover replaces it.
  - **Non-book:** a coin image is counted in `rejectedImage`.
  - **Unchanged behaviour:** an image that already passes `isAcceptableCover` is not classified. Assert the stored bytes equal today's `encodeCover(original)` output size.
  - **Dry run:** downloads nothing and writes nothing, as today.
- [ ] **Step 2:** Run them and watch them fail.
- [ ] **Step 3:** Implement, inside the existing `exclusive` lock:
  1. fetch the bytes and `encodeCover` them;
  2. if the result fails `isAcceptableCover`, run `classifyPublisherImage(bytes)` and `encodeCover(result.input)`;
  3. apply the acceptance and replacement rule from Decisions in the post-download `settle` check.

  Add `cropped` and `squareAccepted` to `SiteReport` and `emptyReport`, and one README sentence.
- [ ] **Step 4:** Run the importer tests, the backend typecheck, the full backend suite, and `node --check backend/scripts/import-publisher-covers.mjs`.
- [ ] **Step 5: Commit:** `Recover publisher mock-ups and square covers, without replacing good covers`.

### Task 3: Surface the real error in `createBook`

**Files:** Modify `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` (`createBook`); Test `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`.

- [ ] **Step 1: Failing test.** Force the insert to fail inside the transaction, for example a second `createBook` with an `id` collision via a stubbed `randomUUID`, or another way the code allows. Assert that the thrown error is the insert's own error, not "cannot rollback", and that no row was left behind.
- [ ] **Step 2:** Run it and watch it fail, if it fails today. If today's code already surfaces it in that path, write the test against the path where SQLite rolls back by itself, and say so.
- [ ] **Step 3:** Implement: `db.exec("BEGIN IMMEDIATE")`; in the catch, `if (db.isTransaction) db.exec("ROLLBACK")`, then rethrow.
- [ ] **Step 4:** Run the repository tests and the full backend suite.
- [ ] **Step 5: Commit:** `Start catalog inserts as writes and keep the real error when one fails`.

### Task 4 (controller): deploy and re-run

1. Merge, re-enable deploys, and wait for the deploy.
2. Pause deploys.
3. Re-run `import-publisher-covers.mjs` in the container and compare `cropped`, `squareAccepted` and `rejectedImage` per site with the 2026-10-03 run.
4. Spot-check 20 newly stored crops by downloading their thumbnails from `images.atmyshelf.com`.
