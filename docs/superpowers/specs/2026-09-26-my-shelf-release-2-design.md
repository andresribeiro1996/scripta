# My shelf, release 2

## Context

Release 1 (PRs #26–#33) made My shelf a private-by-default space built from the reader's books, and made finishing a book a small moment. The 2026-09-24 product review ([artifact](https://claude.ai/artifact/7v7RkbHXPJBjxXGZsETfoj)) put two things in release 2:

- **The reader card.** A literary identity worked out from the reader's history, drawn as one of eight in-house bookplates. Each card shows the evidence behind it and says what it doesn't know.
- **Pick my next read.** A single duel between two unread books from Up next. The winner becomes the book being read.

The plates are already drawn. `design/reader-cards/plates.mjs` generates them, with SVG masters for both print states and the small glyphs (#23). No shipping code renders them yet.

## Decisions locked in with the user

- **The plates are reviewed before any card code ships.** The review called the set a draft that no one else had seen. PR 0 ports the generator unchanged and publishes a review page. The user comments, the generator is edited, and card work starts only after sign-off.
- **The card is a mural block, plus a glyph next to usernames.** The block works like any other block. The glyph appears next to a reader's username in Activity, Discover, People and profile headers.
- **The glyph has its own switch.** "Show my reader glyph next to my name" is in Feed settings and off by default. It is independent of the card block.
- **Visitors see numbers only.** A visitor who taps a published card sees the identity, the share and the coverage lines, but no titles, authors or series names. The owner sees the full evidence.
- **Plates render from one source.** The generator moves into `@scripta/shared` as `renderPlate()` and `renderGlyph()`, which return SVG strings. Web renders them inline and mobile through react-native-svg's `SvgXml`. The `design/` files become output of the same code.
- **It still works with no followers, and nothing is published automatically.** No new top-level sections, services or packages.

## 0. Plate port and review

- Port `design/reader-cards/plates.mjs` to `packages/shared/src/readerCards/plates.ts` with **no visual change**. The new file's output for each plate, state, print and glyph must match the current masters byte for byte, or differ only in whitespace.
- `design/reader-cards/generate.mjs` imports the built shared package, so the committed SVGs are regenerated from shipping code.
- Publish a private review page with:
  - all eight plates at full size, in paper and reversed print;
  - the Leaning and Unwritten plates;
  - the glyphs at 24, 32 and 48px, in both themes and in one ink;
  - an Android emulator screenshot of a plate at card size and of a glyph next to a username.
- The user comments per plate. Edits go into the generator and the review page is republished. This PR merges after the user approves the set, and PRs 2 and 3 build on the approved set.

## 1. `readerIdentity()`

A pure function in `packages/shared/src/library/readerIdentity.ts`, next to `calculateShelfTheme`. It imports `IdentityKey` (`"carto" | "anno" | "lamp" | "star" | "arch" | "corr" | "way" | "loyal"`) and `CardState` from `../readerCards/index.js`, where PR 0 defines them; it doesn't redefine them.

```ts
readerIdentity(books: Array<Record<string, unknown>>, groups: Group[]): ReaderIdentity

interface ReaderIdentity {
  state: CardState;
  identity: IdentityKey | null;          // null only when unwritten
  runnerUp: IdentityKey | null;          // set when leaning on a tie
  signal: { counted: number; of: number; label: string } | null;
  leaders: { label: string; count: number }[];   // owner-only evidence
  coverage: string[];
  missing: string | null;                // what would change it; leaning or unwritten only
}
```

It looks only at finished books (`ReadStatus === 2`) and never needs dates, so imported history counts in full.

| Key | Name | Signal over finished books | Threshold |
|---|---|---|---|
| carto | The Cartographer | share in a `series` group | ≥30% and ≥3 books |
| anno | The Annotator | share with a highlight or review (`Type` "highlight" or "review") | ≥30% and ≥20 marks |
| lamp | The Lamplighter | Mystery, Crime, Thriller, Horror | ≥35% |
| star | The Stargazer | Fantasy, Science Fiction | ≥40% |
| arch | The Archivist | History, Biography & Memoir, Politics | ≥35% |
| corr | The Correspondent | Classics, Literary Fiction, Poetry | ≥40% |
| way | The Wayfarer | genres above 5% | ≥6 genres, none over 25% |
| loyal | The Loyalist | share by the top 3 authors (`Attribution`) | ≥40% |

- Genres come from the same `_genres` enrichment `calculateShelfTheme` uses. The four genre signals and the Wayfarer count only when genres are known for at least half of the finished books. The Wayfarer checks both of its conditions, and its strength is the lower of genre count ÷ 6 and 25% ÷ the largest share. The largest share includes the four genre signals' grouped shares as well as single genres, so a reader with 40% fantasy and science fiction together is a Stargazer, not a Wayfarer (decided with the user).
- Strength is share ÷ threshold, and the strongest signal wins.
- **States:**
  - **Settled:** the winner clears its threshold, and no other signal that clears is within 5% of the winner's strength.
  - **Leaning:** the winner reaches at least 75% of its threshold without clearing it, or two signals clear within 5% of each other. In the tie case `runnerUp` names the second.
  - **Unwritten:** fewer than five finished books, or no signal reaches 75%. `missing` says what would change it, e.g. "Finish 2 more books" or "Genres are known for 3 of 11 finished books".
- `leaders` names what drove the winner: series names with counts (Cartographer), the most-marked books (Annotator), genres (genre signals), or authors (Loyalist).
- **Coverage lines:** always "genres known for N of M finished books". When some finished books came from a Goodreads or StoryGraph import, add "series unknown for Goodreads and StoryGraph imports", since those exports carry no series.
- `publicReaderCard(identity)` returns `{ state, identity, runnerUp, signal, coverage }`. It is the only shape that leaves the server for visitors.
- **Tests:**
  - each signal at, just below and just above its threshold;
  - the genre-coverage gate;
  - a tie producing Leaning with `runnerUp`;
  - fewer than five finished books;
  - Goodreads-only coverage;
  - the dev fixture: 3 of 11 finished books in a series gives leaning Cartographer, and one more finished series book settles it;
  - `publicReaderCard` carrying no leader text.

## 2. The card block, its sheet, and the public card

- **Block:** a new `MuralBlock` variant, `{ type: "readerCard" }`, with no settings.
  - It is added to `BLOCK_TYPE_LABELS` as "Reader card", with a default size of 4×6, and appears in both editors' Add block menus.
  - Existing murals are unchanged.
- **Owner rendering:** the canvas computes `readerIdentity(ownBooks, groups)` on the device, as the shelf theme does, and renders `renderPlate()` with the owner's username.
  - Paper print in the light theme, reversed in dark.
  - The accessible label reads like "Reader card: the Stargazer, leaning".
  - Finishing a book updates the card the next time it renders; there is no extra moment in this release.
- **Mobile rendering:** `SvgXml`. `renderPlate` output carries its colours as inline styles, because `SvgXml` drops `<style>` blocks (PR 0's final review).
  - The first mobile task checks on the emulator that the colours are right and that the fonts resolve. `SvgXml` keeps only the first family in a font list, so that means Playfair Display for the name and epithet, and the sans labels (EX LIBRIS, the eyebrow, the plate foot).
  - If the fonts fail, the plate's text is drawn as React Native `Text` over the SVG art, and the shared API is unchanged.
- **Accessible labels on the wrapper:** `SvgXml` drops ARIA attributes, and glyphs are `aria-hidden`. The label goes on the element around the SVG: web `<span role="img" aria-label>`, mobile `View accessibilityLabel`.
- **Public rendering:**
  - `blockRefs` sets `needsReaderCard` when a mural has the block.
  - `publicResolver` adds `readerCard: publicReaderCard(readerIdentity(allBooks, groups))` to the public data, as it does for `shelfTheme`. The reader's name comes from the public profile the payload already carries.
  - A backend test asserts that no leader label and no title from the library appears in the payload.
- **Sheet:** tapping the plate opens a sheet with:
  - the identity name and epithet, and both identities when Leaning on a tie;
  - the signal line ("3 of 11 finished books are in a series") and the coverage lines;
  - **for the owner only**, the leaders and, when Leaning or Unwritten, `missing`.
- **Preset:** `buildMuralPreset("shelf", books, groups)` gains a `groups` argument, and places a `readerCard` block below the profile block when the result is Settled. It stays out when Leaning or Unwritten. The block's height is set in the plan and checked on the emulator.

## 3. The glyph and its switch

- **Setting:** `FeedSettings` gains `readerGlyph: boolean`, default `false` in `DEFAULT_FEED_SETTINGS`, saved through the existing feed-settings endpoint.
  - Mobile's `FeedSettingsDialog` and web's owner controls show "Show my reader glyph next to my name".
  - Existing rows without the field read as `false`.
- **When it shows:** all three must hold:
  1. the reader is published;
  2. `readerGlyph` is on;
  3. their card is Settled.

  Leaning and Unwritten show nothing, because a 24px mark has no room to say "leaning".
- **Where:** a 24px `renderGlyph()` right after the username, on both clients:
  - Activity and Home feed rows (`FeedRow`);
  - Discover items;
  - People search;
  - a published profile's header.

  Its accessible label ("the Stargazer") goes on the wrapper, as for the card. It does nothing when tapped.
- **Data:**
  - Community payloads that carry another reader's username gain an optional `readerGlyph?: IdentityKey`.
  - The library module exposes `readerGlyphFor(userId): IdentityKey | null`, which runs `readerIdentity` and returns a key only when Settled.
  - The community service calls it once per distinct user in a response, memoised for the request.
- **Cost:** today feed, Discover and People rows read no libraries, so this adds up to one library read per distinct reader on a page. The plan includes a backend test on a large fixture library to confirm the page stays fast. Storing the settled key when a library is saved is the fallback if it doesn't, and is not built up front.
- **Tests:**
  - the switch off, the reader unpublished, Leaning, and Unwritten each give no `readerGlyph`;
  - switch on, published and Settled gives the key;
  - nothing else from the library appears in community payloads.

## 4. Pick my next read

- **Entry:** Home's Up next section on both clients gains a "Can't choose?" link when Up next has at least two books.
- **Sheet:** titled "Pick your next read", with two covers side by side (the first two Up next books) and a "This one" button under each.
  - It uses the finishing moment's duel layout and equal-height buttons.
  - "Another pair" moves on to the next two books and wraps around at the end.
- **Choosing:** the winner is set to Reading through the same status save the book sheet uses: mobile's `setStatus(book, 1)`, and web's `handleSetBookStatus`. The sheet then closes, and Home shows the book under Reading now.
  - A failed save keeps the sheet open, with the same error the status control shows.
  - It saves no date, emits nothing beyond what a status change already emits, and touches no shelf.
- **No shared helper** unless both clients grow the same pairing logic, in which case `upNextPairs(keys)` goes into shared with a test.

## PR order

0. Plate port and review. Merges after the user signs off on the set.
1. `readerIdentity()` and `publicReaderCard()` in shared, with tests. This can proceed during the PR 0 review.
2. The card block, sheet, public card and preset. Builds on 0 and 1.
3. The glyph and its switch. Builds on 0 and 1.
4. Pick my next read. Independent, and can go first.

Each PR gets an emulator device check. Device-check agents change the dev account only through the app's UI, and put back what they change.

## What stays out

- **Card history** ("a Lamplighter in 2024"): needs a year of dated finishes.
- **Share images of the card:** privacy first; revisit when the shelf's own share controls see use.
- **Tapping a glyph to open the card:** later, if people ask.
- **A moment when a card settles:** later.
- **Commissioned art:** the in-house set is the release art once approved.
- **Taste connections, goals and streaks, AI recommendations:** unchanged from the review's "what waits" list.
