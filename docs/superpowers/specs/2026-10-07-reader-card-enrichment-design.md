# Reader card enrichment

Sub-project A of making the reader card prominent: a richer card with a back, a counter drawn from the reader's books, and a dedicated editor where the owner styles it.

## Why

- **Goal:** the reader card is meant to be one of the app's important objects. The landing page already sells it as the hero (`LandingHero.tsx`, `landing/ReaderCards.tsx`).
- **Today inside the app:**
  - The card only exists as a mural block the owner adds by hand. The "My shelf" preset adds it only when Settled (`packages/shared/src/murals/presets.ts:86-91`).
  - Leaning and Unwritten readers never see it anywhere.
  - The glyph is off by default.
  - The card itself is one of eight fixed plates, with nothing personal on it beyond the name.
- **The full effort is four sub-projects, each with its own spec:**

| # | Sub-project | Scope |
|---|---|---|
| **A** | Enrich the card (this spec) | What the card is: front, back, styling, editor |
| B | Your card, for you | Fixed card outside the mural, Unwritten and Leaning shown as progress, a reveal moment, a Home card |
| C | Your card, for others | Card on the public profile header, tapping a glyph opens the card |
| D | The card outside the app | Share image, og:image for profile and mural links |

A comes first because B, C and D all show the object A defines.

## Decisions

| Topic | Decision |
|---|---|
| Privacy | What the reader **chooses** is public: style, motto, signature book, highlight. What is **computed** stays as today: aggregate numbers are public, while `leaders` and `missing` are owner-only. The highlight's annotation is never sent. |
| Front | Plate + counter + secondary trait (runner-up), plus a chosen motto, footer, corners, finish and print. |
| Back | Two pages. **Chosen** (signature book + highlight) is public. **Record** (numbers and evidence) has its ◇ rows for the owner only. |
| Layout | Three faces, tap to turn (default). Alternatives: opens like a book, or a single merged back. |
| Options | Counter 5, motto look 12, footer 12 per corner, corners 12, finish 12, print 3, trait 4, layout 3. The owner chose to keep every option. Each one is permanent and needs tests. |
| Storage | Per user, in the library database. |
| Rendering | One portable SVG renderer in `@scripta/shared`, used by web, mobile and, later, the server. A live shine layer is drawn per client. |
| Editor | A dedicated screen, reached from your own card ("Edit card") and from Settings. |
| Not in A | New surfaces (B, C), share images (D), card history, rotating highlights, "reading now". |

## The card

### Front

Layer order, bottom to top:
1. Paper.
2. The finish underlay.
3. The ink group, which holds: frame and corners, header (EX LIBRIS or motto), counter, rings and emblem, trait seal, eyebrow, name, epithet, trait line, footer.
4. The finish overlay.

**Counter.** The owner picks one. The default is `dial`.

| Key | Look |
|---|---|
| `dial` | One radial tick per finished book outside the rings, grouped by genre segment. The lead segment is heavier, and books with highlights get long ticks. |
| `beads` | One bead per book between the two rings. Filled beads are books with highlights. |
| `shelf` | One spine per book on a shelf under EX LIBRIS. Heights come from the seed, the lead segment is in full ink, and books with highlights get a band. |
| `frame` | One tick per book along the frame band at a fixed pitch, clockwise from the top. The frame fills up as the reader reads. |
| `ring` | Arcs in proportion to each segment, one dash pattern per segment, no per-book marks. |

**Trait** (`both` default, `seal`, `line`, `none`):
- **Source:** a new `streak` field on `ReaderIdentity` and `PublicReaderCard`. `runnerUp` is only set on a Leaning tie, so it cannot be used. `streak` is the second-strongest candidate when its strength reaches the Leaning threshold (0.75), else null. On a tie it equals `runnerUp`. Unwritten cards have none.
- **Line:** "WITH A STREAK OF THE ⟨streak⟩" under the epithet.
- **Seal:** the streak's glyph in its own ink, sitting on the ring at 135°.
- **No streak:** neither is drawn.

**Motto.** Free text of up to 28 characters, in one of 12 looks. An empty text means no motto. Every look except `bannerBelow` lifts EX LIBRIS to a smaller line above it.

| Key | Look |
|---|---|
| `ribbon` | Ribbon with forked tails |
| `scroll` | Parchment with rolled ends |
| `arc` | Text on an arc above the counter |
| `cartouche` | Rounded double-ruled frame |
| `rule` | Plain italic line between rules |
| `bannerBelow` | Ribbon across the bottom of the emblem |
| `wavyRibbon` | Wavy ribbon, text follows the wave |
| `titleRules` | Small caps between double rules |
| `dropCap` | Boxed initial, rest italic |
| `sash` | Diagonal band across the top-right corner |
| `script` | Calligraphic text with a flourish |
| `plaque` | Engraved plaque, text in paper colour on ink |

**Footer.** Each corner is chosen separately. If a value is unavailable (no finish dates, zero highlights), that corner falls back to its default.

| Left | Example | Right | Example |
|---|---|---|---|
| `plate` (default) | PLATE IV | `name` (default) | ANDRÉ RIBEIRO |
| `plateName` | IV · STARGAZER | `firstName` | ANDRÉ |
| `since` | READER SINCE 2014 | `lastName` | RIBEIRO |
| `est` | EST. MMXIV | `firstInitial` | ANDRÉ R. |
| `volumes` | XLVIII VOLUMES | `initials` | A. R. |
| `highlights` | CXL HIGHLIGHTS | `catalog` | RIBEIRO, A. |
| `series` | XII SERIES | `handle` | @ANDRE |
| `genre` | FANTASY & SF (the lead segment) | `nameItalic` | *André Ribeiro* in the serif |
| `edition` | EDITION MMXXVI | `signature` | André Ribeiro in the script font |
| `readerNumber` | Nº XLII | `monogram` | AR in a double circle |
| `glyph` | the reader's glyph | `monogramDiamond` | AR in a diamond |
| `none` | — | `none` | — |

The name comes from the reader name the card already uses. A single-word name makes `lastName`, `initials` and `catalog` fall back to `name`.

**Corners** (12): `diamonds` (default, today's), `deco`, `fleuron`, `photo` (album photo corners), `stars`, `laurel`, `knot`, `volute`, `meander`, `rosette`, `register` (printer's registration mark), `none`.

**Finish** (12). Every finish defines both a paper and a reversed variant.

| Key | Look | Built from |
|---|---|---|
| `paper` (default) | Today's | — |
| `aged` | Warm paper, foxing, vignette | Seeded spots, radial gradient |
| `linen` | Fine weave | Pattern |
| `letterpress` | Cotton paper, debossed ink | Fibre texture tile; offset/flood/composite/merge filter on the ink group |
| `foil` | Metallic ink | Gradient ink; shine layer |
| `holo` | Iridescent ink and sheen | Gradient ink, sheen gradient; shine layer |
| `vellum` | Translucent, mottled | Texture tile, vignette |
| `watercolor` | Washes of the plate ink behind the emblem and name, runner-up ink behind the seal | Seeded irregular paths with blur |
| `gilt` | Gold frame, corners and edge | Gold gradient on the frame only; shine layer |
| `stamp` | Uneven, broken, slightly rotated ink | Speckle mask tile, rotation |
| `kraft` | Brown wrapping paper | Ground colour, fibre texture tile |
| `riso` | Two misregistered inks | An offset copy of the ink group in the runner-up ink, at reduced opacity (no blend modes) |

**Print:** `auto` (default) follows the viewer's theme, as today. `paper` and `reversed` fix the print for everyone.

### Back

Pages, as returned by `readerCardPages(layout, view, hasChosen)`:

| Layout | Pages |
|---|---|
| `faces` (default) | front → chosen → record → front |
| `book` | Front is a cover. Opening it shows chosen and record side by side, or as a pager on narrow screens. |
| `merged` | front ↔ merged |

- **Visitor with nothing chosen:** the chosen page is skipped.
- **Owner with nothing chosen:** the chosen page shows an invitation, and "Edit card" sits outside the card.

**Chosen page:**
- signature book cover, title (2 lines max), author, and the note (up to 60 characters, italic);
- a divider;
- the highlight (4 lines max, ending in "…"), with "AUTHOR · TITLE" under it;
- the footer.

If only one of the two is chosen, that block takes the whole page.

**Record page:**
- "READER'S RECORD" header, then "THE STARGAZER · PLATE IV";
- typewriter rows: finished, one row per non-empty segment (lead first, `unknown` shown as "Genre unknown"), books with highlights, runner-up;
- for the owner only, ◇ rows with each of `leaders` and, when Leaning, the `missing` line;
- a legend for the chosen counter (for `dial`: "one mark per finished book; long marks carry your highlights");
- the coverage line above the footer.

**Merged page:** a small cover with the title, a two-line highlight, then compact rows: finished, lead segment, with highlights, runner-up, and the owner's ◇ rows.

## Data

### Style

```ts
type ReaderCardStyle = {
  counter: Counter;                                   // 5
  layout: "faces" | "book" | "merged";
  motto: { text: string; look: MottoLook } | null;    // text ≤ 28 chars; 12 looks
  footer: { left: FooterLeft; right: FooterRight };   // 12 + 12
  finish: Finish;                                     // 12
  corners: Corners;                                   // 12
  print: "auto" | "paper" | "reversed";
  trait: "both" | "seal" | "line" | "none";
  signature: { bookKey: string; note: string | null } | null;   // note ≤ 60 chars
  highlight: { bookKey: string; highlightId: string } | null;
};
```

- **Defaults:** `dial`, `faces`, no motto, `plate`/`name`, `paper`, `diamonds`, `auto`, `both`, no signature, no highlight.
- **Where it lives:** `@scripta/shared` exports the type, the option lists, `DEFAULT_READER_CARD_STYLE` and `normalizeReaderCardStyle`. Normalising falls back to the default field by field for anything invalid or unknown, so old rows, and a client older than the option, still draw.
- **Storage:** a new table in the library database, `reader_card_styles(user_id TEXT PRIMARY KEY, style TEXT NOT NULL, updated_at TEXT NOT NULL)`, added to `schema.sql` with `CREATE TABLE IF NOT EXISTS`. The library eraser deletes the row.
- **Why the library database:** it already holds the card, bookKeys, highlights, duplicate merges and the public resolver.

### API (owner only)

- **`GET /library/reader-card/style`:** returns the normalised style. A missing row returns the default.
- **`PATCH /library/reader-card/style`:**
  - Every top-level field is optional and the server merges. An older client therefore never wipes fields it does not know. This is the `FeedSettings` trap in reverse: `normalizeFeedSettings` and its zod strip unknown keys.
  - The zod schema is built from the shared option lists.
  - Responds 400 when `signature.bookKey` is not a finished book in the caller's library, or `highlight` is not an `eligiblePassages` entry (`packages/shared/src/murals/home.ts:5-12`) of that book.
  - Motto text and note are trimmed and length-checked. They are escaped at render.
- **Client:** there is no shared library API factory, so a new `createReaderCardApi(request: ApiRequest)` goes in `packages/shared/src/readerCards/api.ts`, following `murals/api.ts`. Each client destructures it in A4.

### Public numbers

These are computed when the library is saved and stored in `library_summary.reader_card` beside today's fields. A shared `readerCardFacts(books, groups)` computes them. The server calls it on save, and the owner's editor calls it locally for instant previews.

```ts
dial: { segments: Array<{ group: "lamp" | "star" | "arch" | "corr" | "other" | "unknown"; books: number; marked: number }> };
facts: { finished: number; highlights: number; series: number; since: number | null; edition: number };
```

- **Segments:**
  - Each finished, deduplicated book counts in exactly one segment: the identity's genre group if the book matches it, else the first matching group in the fixed `GENRE_SIGNALS` order, else `other` (genre known, outside the groups), else `unknown`.
  - The lead segment comes first.
  - `marked` counts books with at least one eligible passage.
- **Facts:**
  - `highlights` counts eligible passages.
  - `series` counts series groups with a finished book.
  - `since` is the year of the earliest `DateLastRead` among finished books. Every import writes that field (Kobo's is the last-read time, which is close enough). It is parsed like `murals/stats.ts` does, and is null when no date parses.
  - `edition` is the year the card was last recomputed.
- **Reader number:**
  - It is the 1-based rank of the account's creation time.
  - The auth module exposes it through a method on its port; the plan confirms which one. The public resolver asks for it only when `footer.left` is `readerNumber`.
  - It reveals sign-up order, which the owner accepted.
- **Recompute triggers:**
  - A small save recomputes the card when a status flips or series membership changes (`backend/src/modules/library/service.ts:487-489`). Highlights only change through full saves (`PUT /library`, `addBook`), which always recompute, so no new trigger is needed.
  - Bumping `LIBRARY_DERIVED_VERSION` (1 → 2, `domain/constants.ts`) drops `library_derived`, which makes the boot backfill rewrite every user's `library_summary.reader_card` once.

### Public payload

`PublicReaderCard` gains optional fields. They are additive, so old clients ignore them.

```ts
type PublicReaderCard = Pick<ReaderIdentity, "state" | "identity" | "runnerUp" | "signal" | "coverage"> & {
  streak?: IdentityKey | null;
  dial?: { segments: … };
  facts?: { …; readerNumber?: number };
  style?: Omit<ReaderCardStyle, "signature" | "highlight">;
  chosen?: {
    signature?: { title: string; author: string; workId: string | null; coverUrl: string | null; note: string | null };
    highlight?: { text: string; title: string; author: string };
  };
};
```

- **Cover:** `chosen.signature.coverUrl` follows `PublicBookData` (`publicResolver.ts:52-71`): the owner's custom cover first, then the catalog thumb.
- **Highlight:** `chosen.highlight` takes `text` from `resolvePublicLibraryData` and drops `annotation`.
- **Delivery:** unchanged in A. The card still reaches visitors through a mural's `readerCard` block (`needsReaderCard`, `publicPayload.ts:39`). C adds the profile header.
- **Missing references:** a signature or highlight whose book or highlight no longer exists is treated as not chosen. It is left out of `chosen`, without an error.
- **Duplicate merges:** a library dedupe rekeys `signature.bookKey` and `highlight.bookKey` alongside the murals' `rekeyBooks` (`backend/src/app.ts:156-164`).

## Renderer

All of it lives in `packages/shared/src/readerCards/`.

```ts
renderReaderCard(input: ReaderCardInput, page: "front" | "chosen" | "record" | "merged"): string
readerCardPages(layout, view: "owner" | "visitor", hasChosen: boolean): Array<Page | [Page, Page]>
readerCardShine(finish): null | "foil" | "holo" | "gilt"
readerCardSummary(input): string[]      // text alternative for screen readers
```

- **`ReaderCardInput`:** the public card (with `dial` and `facts`), `style`, `chosen`, `view`, `leaders` (owner only), the resolved print, the reader name, the handle and a `seed`.
- **Existing callers:** `renderPlate` stays as a wrapper with the default style. Landing callers have no dial data, so they draw no counter and no trait.
- **Composition:** the plate is assembled from slots instead of the fixed template in `plates.ts:plate()`.
- **Modules** (each a set of pure functions returning SVG fragments that use the existing class names):

| Module | Content |
|---|---|
| `compose.ts` | Layer order and slots |
| `style.ts` | Type, option lists, defaults, `normalizeReaderCardStyle` |
| `counters.ts` | 5 counters. Each declares its slot: around the rings, top, or frame band. |
| `mottos.ts`, `footer.ts`, `corners.ts` | 12, 12 + 12, 12 |
| `finishes.ts` | 12. Each returns a palette (ground, ink as a colour or `url(#…)`, secondary ink), `defs`, `underlay`, `overlay` and attributes for the ink group (filter, mask, transform). `withStyle` reads the palette instead of the fixed inks. |
| `textures.ts` | Generated base64 tiles |
| `pages.ts` | Chosen, record, merged |
| `fit.ts` | Text fitting without measurement |

- **Portable subset.** `react-native-svg` 15.15.4 implements Blend, ColorMatrix, Composite, DropShadow, Flood, GaussianBlur, Merge and Offset. `FeTurbulence`, `FeDisplacementMap` and `FeImage` render nothing, and SMIL and `mix-blend-mode` are not supported. A `portable.test.ts` renders the variants and checks every element and attribute against an allowlist:
  - **Rejected:** `<style>`, `animate*`, `set`, `feTurbulence`, `feDisplacementMap`, `feImage`, `foreignObject`, `mix-blend-mode`, any leftover `class`.
  - **`href`:** only `data:`, plus one `https:` image for the signature cover.
- **Textures:**
  - Five PNG tiles: cotton fibre, vellum, kraft, stamp speckle (used as a mask) and riso grain.
  - Baked once by a script with sharp and committed as a base64 module, at about 12 KB per tile and 60 KB in total.
  - Regenerated only when the design changes.
- **Determinism:** all randomness (spots, spine heights, speckles, watercolour edges) comes from a seed derived from the username, which is the name the card already prints (`readerName={profile?.username}`). The same card looks the same on every screen and on the server.
- **Text fitting:** `fit.ts` estimates widths from per-font average character widths. It shrinks a motto to its look's slot, wraps the signature title to 2 lines and the highlight to 4 (ending in "…"), and shortens footer values to their corner.
- **Fonts:**
  - **Playfair Display:** already used.
  - **Courier Prime (OFL):** for the record rows, because Android has no Courier New.
  - **Pinyon Script (OFL):** for `script` mottos and `signature` footers.
  - **Loading:** web loads them with `@font-face`, mobile with `expo-font` as assets, which still ships over the air. The server needs them only in D.
- **Tests:**
  - **Per dimension:** each option with the other dimensions at their defaults, × 8 plates × 2 prints. Each must render, pass the allowlist and be deterministic.
  - **Random combinations:** about 50 seeded full combinations.
  - **Privacy:** the visitor view never contains `leaders`, `missing` or annotation text.
  - **Text fitting:** `fit.ts` at the length limits.
- **Contact sheet:** `npm run sheet -w @scripta/shared` writes one HTML per dimension, with every option across 8 plates × 2 prints. It is the visual review attached to the A5 and A6 PRs. It is a development tool, not a test.

## Clients

### Components (web and mobile)

**`ReaderCardImage`** draws the static card.
- It memoises `renderReaderCard`, then uses `dangerouslySetInnerHTML` on web and `SvgXml` on mobile, like today's `ReaderCardBlock`s.
- It is used by the mural block, the editor thumbnails, and later by C.
- Its only interaction is opening the card.

**`ReaderCardViewer`** draws the interactive card.
- **Opening:** tapping the mural's card opens it full screen. It replaces today's reader-card detail: `MuralBlockDetail` on web, the `Sheet` in mobile `ReaderCardBlock.tsx:36-50`. Their signal, coverage and leaders text now lives on the record page.
- **Faces:** tap turns the card with a rotateY flip, and dots show the page.
- **Book:** on wide screens the cover swings on its spine to reveal the spread; on narrow screens the pages are a horizontal pager.
- **Merged:** tap toggles front and back.
- **Shine** (when `readerCardShine` is not null): a gradient layer over the card.
  - **Web:** follows the pointer, and sweeps slowly when the pointer is idle.
  - **Mobile:** follows `useAnimatedSensor(SensorType.ROTATION)` from Reanimated, which needs no new native dependency. The sensor runs only while the viewer is open.
- **Reduced motion:** the shine stays still and turning is an instant swap.
- **Owner:** sees an "Edit card" button.
- **Accessibility:** `role="img"` with a label, a live region announcing "page 2 of 3", and the `readerCardSummary` lines as a text alternative.
- **Keyboard (web):** Enter and Space turn the card, the arrow keys change page, and Esc closes.

**Mural block.** `ReaderCardBlock` renders `ReaderCardImage` (front) with the owner's style. The style comes from the payload for visitors and from the owner's style query for the owner. The block size (4×6) is unchanged.

### Editor

- **Routes:**
  - **Web:** `/dashboard/reader-card`, inside `DashboardLayout` under `RequireUsername` (`frontend/src/App.tsx:77-98`).
  - **Mobile:** a root route `(app)/reader-card.tsx`, pushed above the tabs like `account-security`, so it is reachable from My shelf and from Settings.
- **Entry points in A:**
  - "Edit card" in the owner's `ReaderCardViewer`.
  - A "Reader card" row in Settings, on both clients.
- **Layout:**
  - Live preview: an inline `ReaderCardViewer` with a You/Visitors toggle. Visitors view drops `leaders` and `missing`.
  - On web, the preview is sticky on the left with the options on the right. On mobile, one column.
- **Sections:**
  - **Front:**
    - Counter: 5 thumbnails.
    - Motto: a text field of up to 28 characters plus 12 look thumbnails.
    - Footer: 12 chips per corner.
    - Corners: 12 cropped thumbnails.
    - Finish: 12 thumbnails.
    - Print: 3 segments.
    - Trait: 4 segments.
  - **Back:**
    - Layout: 3 options.
    - Signature book: picker plus note.
    - Highlight: picker.
  - **Glyph:** the "show next to your name" switch moves here and is removed from `OwnShelfView`'s feed settings and mobile `FeedSettingsDialog`. It still saves through the existing full-body `PUT /community/profile/feed-settings`.
- **Saving:**
  - Each change sends an optimistic `PATCH`. Motto and note wait about 600 ms after typing stops.
  - On error the field reverts and a toast shows.
  - Previews use `readerCardFacts` on the owner's local library, so there is no round trip.
- **Thumbnails:**
  - On mobile, each row is a horizontal virtualised list, rendered lazily.
  - A thumbnail shows the owner's own card with that option swapped in.
- **Unwritten card:** every option still applies, and the editor shows "finish N more books" from `missing`.
- **Phased options:** each phase adds its options to the shared lists, and the editor only offers options that are already drawn.

### Pickers

- **Signature book:**
  - **Web:** reuses `BookSearchList` (`frontend/src/components/murals/pickers.tsx:19-70`) with `filterBooks(books, q, "finished")`.
  - **Mobile:** extracts the book picker that exists inline in `MuralEditorScreen.tsx:292-312` and `library/components/GroupDetail.tsx:240` into one component.
- **Highlight:**
  - Two steps, book then its `eligiblePassages`, as in `BlockConfigPanel.tsx:273-307` and the mobile mural editor.
  - A search box over passage text across all books, through a new shared `searchPassages(books, q)`.
  - Readers with no Kobo highlights see "No Kobo highlights yet".

## Phases

Stacked PRs. Each is retargeted to `main` before `--auto`, so CI runs. Device passes gate merge, not PR opening. `branch-reviewer` runs before each merge.

| Phase | Content | Verify |
|---|---|---|
| **A0 · Spike** (throwaway, not merged) | A test screen in mobile rendering, through `SvgXml`: a `data:` PNG inside `<pattern>`, a remote `https:` image, `textPath` with `startOffset="50%"`, a mask with an image, GaussianBlur on a group. It also times the heaviest card (320-tick dial, letterpress, laurel corners) and a row of 12 thumbnails. | `device-checker`, after `node scripts/dev-status.mjs --json` shows the emulator free. Outcome: a go/no-go per finish. Fallbacks: procedural textures, the client drawing the cover over a slot, or a DOM component (expo-dom, a store build) for the full-screen viewer only. |
| **A1 · Renderer core** | `compose.ts`, `style.ts`, counters, `streak` and the trait, `readerCardFacts` with `dial`/`facts` saved server-side, the `LIBRARY_DERIVED_VERSION` bump, the portable test, the contact sheet | Shared and backend tests. Visible change: every card gains the dial, line and seal. |
| **A2 · Backend** | Style table, `GET`/`PATCH`, `chosen` resolution without annotation, rekey on merge, eraser, shared API types and client | Backend tests (env preamble, new test file in `backend/package.json`'s list). **security-review**, because the phase decides what visitors see. |
| **A3 · Pages and viewer** | `pages.ts`, Courier Prime, `ReaderCardImage`/`ReaderCardViewer` on both clients, three layouts, a11y, replacing the detail sheets | Web in the preview browser; mobile through `device-checker` |
| **A4 · Editor** | Routes, entry points, pickers, `searchPassages`, the glyph switch move | Same as A3 |
| **A5 · Decoration** | 12 mottos (+ script font), 12 + 12 footers (with the reader number from auth), 12 corners, print, trait, signature note | Contact sheet on the PR; **security-review** for the reader number |
| **A6 · Finishes** | Texture bake script, 12 finishes, shine layer on both clients, reduced motion | Contact sheet; `device-checker` for shine, tilt and timing |

## Deploy

- **Backend:** one new table in the existing library database, already under `/data` and in Litestream. No new `*_DB_PATH`.
- **Recompute:** the `user_version` bump recomputes every card once at the first boot after deploy.
- **Mobile:** JS, fonts and textures only, so it ships over the air with no store build, unless A0 sends the viewer to expo-dom.
- **Production:** merged is not live. Deploying is the owner's call, through `deploy.yml`.

## Risks

- **Combinatorics:**
  - 5 × 12 × 12 × 12 × 12 × 12 × 3 × 4 × 3 styles cannot all be reviewed.
  - The per-dimension sheets and the seeded combination test cover each option and the obvious collisions, not the product.
  - Known collisions to design for:
    - `sash` with corner ornaments;
    - `shelf` with mottos that sit under EX LIBRIS;
    - `frame` with corners other than `none`;
    - `bannerBelow` with the trait seal.
- **Fidelity on mobile:** watercolour and stamp are approximations without displacement. A0 decides whether they are good enough.
- **Text estimates:** unusual strings may overflow. The limits and the `fit.ts` tests bound it.
- **Motto text:** it is public free text, length-limited and escaped, with no moderation, like the profile bio.
- **Reader number:** it reveals sign-up order, which the owner accepted.

## Later sub-projects

- **B · Your card, for you:**
  - The card fixed at the top of My shelf, outside any mural, in all three states.
  - Unwritten and Leaning shown as progress ("3 more books to your card"; "leaning to the Cartographer: missing X").
  - A one-time full-screen reveal when the card settles or changes plate.
  - A compact Home card.
- **C · Your card, for others:**
  - The card on the public profile header, independent of the mural. This needs a new delivery path for `PublicReaderCard`.
  - Tapping a glyph opens the card.
  - The "where it shows" switches in the editor.
- **D · The card outside the app:**
  - Server rendering with sharp from the same renderer.
  - Download and share from the editor.
  - og:image for profile and shared mural links, which today have no OG tags.

## Mockups

`2026-10-07-reader-card-mockups/` holds the brainstorm mockup generators. They are geometry references, not production code. They write an HTML fragment:

```bash
node_modules/.bin/tsx docs/superpowers/specs/2026-10-07-reader-card-mockups/twelve.ts /tmp/twelve.html
```

`face.ts` (trait), `counters.ts`, `verso.ts`, `pages.ts` (layouts), `editor.ts`, `extras.ts` and `six.ts`/`twelve.ts` (motto, footer, finish and corner options) match the screens agreed in the brainstorm.
