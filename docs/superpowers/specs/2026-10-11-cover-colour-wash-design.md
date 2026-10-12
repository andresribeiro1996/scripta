# Cover colour wash — design

## Goal

Make the top of the book screen feel like the book: a soft gradient of the cover's accent colour behind the header and hero, fading into the page (option 1 of the four mockups, chosen 2026-10-11). The colour is computed once on the server and returned with the work page, so web and mobile show the same wash and mobile needs no native module.

## Non-goals

- Colours for custom library covers (gallery uploads or arbitrary URLs). Those books show no wash.
- Accent theming of stars, chips or buttons.
- A blurred cover backdrop.
- Colour on any screen other than the book screen.

## Colour extraction

`coverColor(image: Buffer): Promise<string | null>` in `backend/src/modules/books/domain/images.ts`, next to `encodeCover`, using sharp (already a dependency):

1. Flatten on white, sRGB, resize to fit 128×128 (default kernel), raw pixels.
2. Drop pixels that are near-grey (HSV saturation < 0.25), near-black (value < 0.15) or near-white (value > 0.95 with saturation < 0.1).
3. Bucket the rest into 12 hue bins, weighting each pixel by saturation × value.
4. Take the heaviest bin. If its weight is under 1% of the total pixel count, return `null`: the cover is effectively greyscale.
5. Return the weighted mean RGB of that bin as `#rrggbb`.

The Fellowship cover (black field, gold ring) yields gold, not black. A grey or monochrome cover yields `null`: no wash.

## Storage

- `cover_images.color TEXT`, one value per stored image. The column is added in `applyBooksMigrations` the same way `origin` was added. Values:
  - `NULL`: not computed yet.
  - `''`: computed, no usable colour.
  - `#rrggbb`: the colour.
- A partial index `idx_cover_images_color_pending ON cover_images(id) WHERE color IS NULL`, created in the migration code after the column exists.
- `encodeCover` also returns `color`. `storeCoverImage` passes it to `insertImage`, so every new cover gets one: source fetch, admin upload, publisher import.

## Backfill

Existing images have `color IS NULL`. `startCoverColorBackfill` in `backfill.ts`, started from the books plugin like the other backfills:

- It drains batches of 50 via the existing `drainBatches`, with an `AbortSignal`.
- For each pending image it reads `covers/<id>-thumb.webp` from the object store and runs `coverColor`. It writes `''` when there is no colour or the thumb is missing (`ObjectNotFound`). Other errors stop the batch and are retried on the next tick, never swallowed.
- It is resumable through the `color IS NULL` predicate, so a deploy mid-run simply continues.
- It runs once at boot, then every 10 minutes, so newly pending rows (there should be none) get picked up.

## API

`WorkPage.work.coverColor: string | null`. This is additive; old clients ignore it.

- `getWorkPageWith` editions gain `coverColor`, joined from `cover_images` by `cover_image_id`, with `''` mapped to `null`.
- `works/service.ts getPage` already picks `coverUrl` from the viewer's copy, then the viewer's edition, then the first edition with a cover. `coverColor` is the colour of the edition whose `coverUrl` equals the chosen `coverUrl`, else `null`. A viewer's custom library cover therefore gets no wash, instead of a colour that doesn't match the cover shown.

## Clients

A shared helper in `packages/shared/src/works/` (exported): `coverWash(color: string | null, scheme: "light" | "dark"): { top: string; mid: string } | null`. It returns rgba stops: top alpha 0.32 in light and 0.24 in dark, mid at half of that. Both clients render the same stops.

- **Web (`frontend/src/components/book/BookScreen.tsx`):** an absolutely positioned, `pointer-events-none`, `aria-hidden` layer at the top of the page's `<main>`, behind the header row and hero. It is full width and about 520px tall, with `linear-gradient(to bottom, top, mid 45%, transparent)`. The scheme comes from the active theme's `scheme`. Nothing renders when `coverWash` returns `null`.
- **Mobile (`mobile/src/features/works/BookScreen.tsx`, `WorkScreen.tsx`):** on a tinted book screen the native header is transparent and a non-scrolling backdrop layer behind the ScrollView draws both the header band (`coverColor` at the wash alpha for the scroll offset over `colors.background`) and the `react-native-svg` `LinearGradient` wash, translated by the same UI-thread scroll value in the same frame, so the two cannot disagree whatever the scroll latency; overscroll clamps to the top alpha. The ScrollView starts at the header bottom and its content clips there. The library-only route has no scroll value and keeps the wash in the scrolling content. When there is no colour, the header and content look as they do today.
- **Unresolved library-only screen (`/book/<key>`):** there is no work page, so no wash.

## Testing

- **Backend:**
  - `coverColor`: a synthetic solid red gives red; a black field with a gold ring gives gold; a greyscale gradient gives `null`; garbage input gives `null`.
  - `encodeCover` returns the colour.
  - Migration adds the column and index.
  - Backfill fills pending rows, writes `''` for missing thumbs, and stops on other store errors.
  - `getPage` returns the matching edition colour, `null` for a custom copy cover, and `null` for `''`.
- **Shared:** `coverWash` and `blendHex` cases.
- **Web:** typecheck, lint, tests; browser check of a coloured cover, a greyscale cover, a custom-cover book, and the light and dark themes.
- **Mobile:** typecheck, tests; emulator pass for the header-to-wash seam, light and dark.

## Production

No new env vars, DB files or `litestream.yml` entries. The column lives in the existing `covers.sqlite`. The backfill runs in-process after deploy. Old mobile builds keep working.
