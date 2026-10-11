# Cover Colour Wash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A soft gradient of the cover's accent colour behind the book screen's header and hero on web and mobile, from one colour per stored cover image computed on the server.

**Architecture:** sharp computes an accent colour when a cover is encoded, and a resumable in-process backfill fills existing images. The colour is stored in `cover_images.color`. `GET /works/:id` returns `work.coverColor` for the edition whose cover is shown. A shared helper turns it into gradient stops; web draws a CSS gradient and mobile an SVG gradient plus a matching header tint.

**Tech Stack:** Fastify + node:sqlite + sharp backend, `@scripta/shared` (TS, node:test), React + Vite + Tailwind web, Expo Router + React Native + react-native-svg mobile.

**Spec:** `docs/superpowers/specs/2026-10-11-cover-colour-wash-design.md`

## Global Constraints

- No code comments (repo rule); the why goes in commit messages.
- API change is additive only (`coverColor` is a new field; old mobile builds ignore it).
- Colour values: `NULL` = not computed, `''` = computed, no colour, `#rrggbb` = colour. The API maps `''` to `null`.
- Catch only the expected failure (`ObjectNotFound` for a missing thumb, sharp decode failure → `null`); everything else propagates.
- New backend `*.test.ts` files must be added to the explicit list in `backend/package.json`'s `test` script.
- After `packages/shared` changes, run `npm run build` in `packages/shared/` before typechecking `frontend/`, `mobile/` or `backend/`.
- Backend tests need the env preamble the existing test files set; run through `npm test` in `backend/` or `npx tsx --test <file>` from `backend/`.
- Run git from the worktree root; stage files by name and commit in the same command. End commit messages with the session's Co-Authored-By line.

## Review Focus

1. A greyscale or near-monochrome cover gives no wash, never a muddy grey or black band. Covered by tests in Task 1 and checked visually in Task 6.
2. A viewer whose library copy uses a custom cover gets `coverColor: null`, not a colour from a different edition's cover. Tested in Task 3.
3. The backfill must not swallow store errors, must be resumable after a deploy, and must not load whole full-size images (use thumbs). Covered in Task 2.
4. Mobile: no visible seam between the tinted header and the wash, in light and dark. Checked by the Task 6 device pass.
5. Web themes: the wash reads in every theme `scheme` (light and dark palettes), and text over it keeps its contrast.

---

### Task 1: Extract and store a colour for every new cover

**Files:**
- Modify: `backend/src/modules/books/domain/images.ts` (add `coverColor`; `encodeCover` returns `color`)
- Modify: `backend/src/modules/books/domain/types.ts` (`CoverImageRow.color: string | null`; `EncodedCover.color`)
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts` (`ALTER TABLE cover_images ADD COLUMN color TEXT` guarded by `PRAGMA table_info`, then `CREATE INDEX IF NOT EXISTS idx_cover_images_color_pending ON cover_images(id) WHERE color IS NULL`)
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` (`insertImageStmt` writes `color`)
- Modify: `backend/src/modules/books/booksService.ts` (`storeCoverImage` passes `image.color`)
- Test: `backend/src/modules/books/domain/images.test.ts` (create if absent, and add to the `test` list), plus the repository test for the migration

**Algorithm (from the spec):**
1. Flatten on white, convert to sRGB, resize to fit 64×64, take raw pixels.
2. Drop pixels with saturation < 0.25 or value < 0.15 (near-white falls under the saturation rule).
3. Bucket the rest into 12 hue bins, weighted by saturation × value.
4. If the heaviest bin's weight is under 3% of the pixel count, return `null`.
5. Otherwise return the bin's weighted mean RGB as lowercase `#rrggbb`.
6. Garbage input returns `null` (catch the sharp decode failure only).

- [ ] **Step 1: Failing tests.** Build the inputs with sharp `create`/`composite` in the test:
  - a 200×300 solid `#cc2222` gives a red within ±8 per channel;
  - a black 200×300 image with a 120px gold (`#e0a82e`) filled circle gives a gold within ±12 per channel;
  - a horizontal grey gradient gives `null`;
  - `Buffer.from("nope")` gives `null`;
  - `encodeCover` of the red image returns `color` set.
  
  Migration test: after `applyBooksMigrations`, `PRAGMA table_info(cover_images)` includes `color`, and `PRAGMA index_list(cover_images)` includes `idx_cover_images_color_pending`. Insert-image test: a stored image row carries its `color`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - `encodeCover` computes the colour from the encoded `thumb` (small) via `coverColor` and returns it.
  - `coverColor` returns `null` instead of throwing on a decode failure.
  - `storeCoverImage` stores `image.color ?? ''`. Use `''` when extraction ran and found nothing; there's no `NULL` path for new images.
- [ ] **Step 4: Run, expect PASS.** Then `npm run typecheck && npm test` in `backend/`.
- [ ] **Step 5: Commit**, e.g. "Store an accent colour with every new cover image".

### Task 2: Backfill colours for existing cover images

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` and its port type: `listPendingColorImageIds(limit): string[]` (`SELECT id FROM cover_images WHERE color IS NULL LIMIT ?`), `setImageColor(id, color: string)`
- Modify: `backend/src/modules/books/backfill.ts`: `startCoverColorBackfill(step: (limit) => Promise<number>, onError)`. Reuse `drainBatches` or mirror its shape for an async step. Run at boot, then on a 10-minute interval, with an `AbortSignal`.
- Modify: `backend/src/modules/books/booksService.ts`: `fillCoverColors(limit)`. For each pending id, read `covers/<id>-thumb.webp` from the object store and run `coverColor`. Write the colour, or `''` when it's `null` or the store reports the object missing. Any other store error propagates and stops the batch. Return the number processed.
- Modify: `backend/src/modules/books/plugin.ts`: start the backfill alongside the others, and stop it on close.
- Test: the service and backfill tests (existing files where the other backfills are tested; add new files to the `test` list)

- [ ] **Step 1: Failing tests.**
  - With an in-memory object store holding a red thumb for image A and nothing for image B, `fillCoverColors(10)` sets A to red and B to `''`, and returns 2.
  - A second call returns 0.
  - A store whose `get` throws a non-missing error makes `fillCoverColors` reject, and leaves the row `NULL`.
  - The backfill loop drains until a step returns 0, and stops on abort.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Find how the object store signals a missing key (read `backend/src/storage/*`) and catch only that.
- [ ] **Step 4: Run, expect PASS.** Then `npm run typecheck && npm test` in `backend/`.
- [ ] **Step 5: Commit**, e.g. "Backfill accent colours for existing cover images".

### Task 3: Return the cover colour with the work page

**Files:**
- Modify: `packages/shared/src/works/types.ts`: `WorkPage.work.coverColor: string | null`
- Modify: `backend/src/modules/books/domain/types.ts` and `sqliteBooksRepository.ts`:
  - `WorkPageRows.editions` gains `cover_color`, via `LEFT JOIN cover_images ci ON ci.id = books.cover_image_id` in `pageEditionsStmt`.
  - Qualify the existing columns as needed.
- Modify: `backend/src/modules/books/works.ts`: editions carry `coverColor: string | null`, with `''` mapped to `null`.
- Modify: `backend/src/modules/works/service.ts`:
  - `coverColor` is the `coverColor` of the edition whose `coverUrl === coverUrl` (the already chosen one), else `null`.
  - Update any WorkPage literals and fixtures in backend, frontend and mobile tests (`rg -n "coverUrl:" --glob '*.test.*'`, plus the frontend `scripts/test-*.mts`).
- Test: `backend/src/modules/books/works.test.ts`, `backend/src/modules/works/service.test.ts`

- [ ] **Step 1: Failing tests.**
  - Page edition: an edition whose image has colour `#e0a82e` carries `coverColor: "#e0a82e"`; one with `''` carries `null`.
  - Service: with no viewer copy, `coverColor` is the first covered edition's colour.
  - Service: with a viewer copy whose `coverUrl` is a custom URL matching no edition, `coverColor` is `null`.
  - Service: with a viewer copy whose `coverUrl` equals an edition's, it is that edition's colour.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** Then `cd packages/shared && npm run build && npm test`, `cd backend && npm run typecheck && npm test`, and typecheck `frontend` and `mobile`.
- [ ] **Step 5: Commit**, e.g. "Return the shown cover's accent colour with the work page".

### Task 4: Shared wash helpers

**Files:**
- Create: `packages/shared/src/works/coverWash.ts`, exported from `packages/shared/src/works/index.ts`
- Test: `packages/shared/src/works/coverWash.test.ts`

**Interfaces:**
```ts
export function coverWash(color: string | null, scheme: "light" | "dark"): { top: string; mid: string } | null;
export function blendHex(base: string, over: string, alpha: number): string;
```
- `coverWash`:
  - Returns `null` for `null` or a malformed colour.
  - Top alpha is 0.32 for light and 0.24 for dark; mid is half of that.
  - Returns `rgba(r, g, b, a)` strings.
- `blendHex`: `#rrggbb` of `over` composited at `alpha` on `base`, both `#rrggbb`.

- [ ] **Step 1: Failing tests.**
  - `coverWash("#e0a82e", "light")` gives `{ top: "rgba(224, 168, 46, 0.32)", mid: "rgba(224, 168, 46, 0.16)" }`.
  - The dark variant uses 0.24 and 0.12.
  - `coverWash(null, "light")` and `coverWash("gold", "light")` give `null`.
  - `blendHex("#ffffff", "#000000", 0.5)` gives `#808080`.
  - `blendHex("#f2efe9", "#e0a82e", 0.32)` is computed exactly in the test from the formula `round(base + (over - base) * alpha)` per channel.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** Then `npm run typecheck && npm test && npm run build` in `packages/shared`.
- [ ] **Step 5: Commit**, e.g. "Add shared cover wash helpers".

### Task 5: Web wash

**Files:**
- Modify: `frontend/src/components/book/BookScreen.tsx`. Possibly `frontend/src/pages/WorkPage.tsx` if the theme scheme is read there.

- [ ] **Step 1:**
  - Make the page's `<main>` `relative isolate`.
  - As its first child, render a `pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px]` div with `aria-hidden`.
  - Give it `style={{ background: \`linear-gradient(to bottom, ${wash.top}, ${wash.mid} 45%, transparent)\` }}`, where `wash = coverWash(page?.work.coverColor ?? null, scheme)`.
  - Get `scheme` from the active theme's palette `scheme` (find how the web app reads the current theme id: `useTheme`/`data-theme` plus `@scripta/shared` palettes).
  - Render nothing when `wash` is `null`.
  - If `<main>` sits inside a padded layout, make the layer bleed to the page edges on narrow screens the way the page background does, and confirm visually in Task 6.
- [ ] **Step 2: Verify.** `cd frontend && npm run typecheck && npm run lint && npm test`. If `frontend/scripts/test-work-page.mts` renders `BookScreen`, add one assertion that a page with `coverColor` renders the gradient and one without does not.
- [ ] **Step 3: Commit**, e.g. "Wash the web book screen in its cover's colour".

### Task 6: Mobile wash and header tint

**Files:**
- Modify: `mobile/src/features/works/BookScreen.tsx` (wash layer)
- Modify: `mobile/src/features/works/WorkScreen.tsx` (header background)

- [ ] **Step 1: Wash layer.**
  - Compute `wash = coverWash(page?.work.coverColor ?? null, mode)` from `useTheme()`.
  - When set, render an absolutely positioned `react-native-svg` `<Svg>` as the first child of the ScrollView content: full width, about 420pt tall, behind the hero (`pointerEvents="none"`, accessibility hidden).
  - Inside, a `<Defs><LinearGradient id="wash" x1="0" y1="0" x2="0" y2="1">` with stops at `top` (offset 0), `mid` (offset 0.45) and transparent (offset 1), filling a `<Rect>`.
  - Use the stop colour and opacity props react-native-svg expects; pass the rgb and the alpha separately if rgba strings aren't accepted.
  - The content's horizontal padding means the layer needs negative margins or an absolute fill of the ScrollView width. Make it edge to edge.
- [ ] **Step 2: Header tint.** In `WorkScreen`, when `wash` is set, pass `headerStyle: { backgroundColor: blendHex(colors.background, page.work.coverColor, topAlpha) }` in the `Stack.Screen` options, where `topAlpha` matches `coverWash`'s top alpha for the scheme (export a constant or return `topAlpha` from `coverWash` — whichever is smaller). This makes header and wash meet without a seam. With no colour, the options are unchanged.
- [ ] **Step 3: Verify.** `cd mobile && npm run typecheck && npm test`.
- [ ] **Step 4: Commit**, e.g. "Wash the mobile book screen in its cover's colour".
- [ ] **Step 5: Visual pass.**
  - **Web (browser, headless Chrome as in earlier passes):** a coloured cover (The Fellowship of the Ring) and a greyscale or monochrome cover at 390 and 1280 wide, in the light and dark themes.
  - **Mobile:** a `device-checker` emulator pass on the same books: the header-to-wash seam, light and dark, and that text keeps its contrast.
  - The dev DB's existing covers need colours. Let the backfill run at backend boot, and confirm with a quick query or by waiting for the books to show colour.

---

## Self-review notes

- **Spec coverage:** extraction and storage (Task 1), backfill (2), API (3), shared helpers (4), web (5), mobile and visual checks (6). Non-goals are untouched.
- **Custom library covers:** they get no wash because the colour is matched to the shown cover URL (Task 3).
