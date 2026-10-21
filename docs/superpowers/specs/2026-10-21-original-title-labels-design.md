# Original titles that are not titles

## Problem

`originalTitleIn` (`backend/src/modules/books/domain/translation.ts:3-9`) reads the value after a "Título original" label. It returns things that are not titles:

1. **Bare label.** In `"…\n\nTítulo original:"` the separator in `/T[íi]tulo original\s*[:\-–—]?\s*([^\n]+)/i` is optional. With nothing after it, the capture backtracks and returns `":"`.
2. **Next line's label.** `\s*` crosses a newline. So in `"Título original:\nTradução: Ana Lima"` it captures `"Tradução: Ana Lima"`.

These values are stored in `books.original_title` by:
- `fillOriginalTitlesFromSummaries`;
- `mergeDetails` (its upsert);
- `summaryCleanup`;
- the publisher feed, through `fillOriginalTitle` (`importPublisherCovers.ts:310`).

BNP notes also reach `fillOriginalTitle` (`bnpImport.ts:87`). So does a WooCommerce "Título original" attribute, which is stored as the shop wrote it.

## What the bad values did

- **`":"` is mostly inert.**
  - `normalizeTitle` keeps only the text before the first `:`, so `originalKey(":")` is `null`. `claimGroups` therefore skips the claim, and `isSeriesLike` returns false.
  - `titlePattern(":")` is `null`, so there are no title candidates. No code join can come from it.
  - `sameMainTitle` is false.
- **But `":"` hides real evidence.** `evidenceOf` takes the first non-blank `originalTitle` across a work's editions. A stored `":"` on the earliest edition hides a real original title on a later edition. The work then falls back to author candidates. It gets `none`, or Jev is asked with `original_title: ":"`.
- **Judgments are keyed on `work_id`, not on the value.** That holds for both `work_match_judgments` and `work_merges`. So no row is keyed on a bad value. Only the evidence a judgment saw was wrong.
- **Label-shaped values are not inert.** `originalKey("Tradução: Ana Lima")` is `traducao|`. Three such translations by one author form a series-like group, and that blocks their matches.
- **A stored bad value is never replaced.** `fillOriginalTitle` writes only when the column is `NULL`, and the upsert uses `COALESCE(original_title, …)`. So a bad value blocks a later good one.

## Design

**Rule.** Add `isOriginalTitle(value)` in `domain/translation.ts`. It is true when the value:
- contains a letter or digit (`\p{L}`/`\p{N}`, so `Солярис` and `1984` pass);
- and does not start with another metadata label followed by a colon, or by a dash after whitespace.

Labels come from `@scripta/shared`'s `STRICT_METADATA_LABEL | LOOSE_METADATA_LABEL`, the same set `publisherFeed`'s `METADATA_LINE` uses.

**Parser.** `originalTitleIn` keeps its regex. It still reads a value on the line after a bare label, because `htmlToText` turns `<dt>/<dd>` and `<div>` pairs into separate lines. It returns `null` unless `isOriginalTitle` holds and the length cap holds.

**Writer guard.** `fillOriginalTitle` writes only values that pass `isOriginalTitle`. That covers the WooCommerce attribute and BNP paths. Without the guard, the next harvest would re-store what the repair cleared.

**Repair.** A once-only boot migration, `user_version` 5, after `turnIsbndbFirstAuthors`. This is the pattern PR #280 used.
- It sets `original_title = NULL` on every row whose stored value fails `isOriginalTitle`, `''` included.
- It runs in one `BEGIN IMMEDIATE` transaction.
- It logs the count only when the count is above 0.

`NULL`, not `''`, so a real value from another source can fill the row later. No production command is needed: the migration runs on the next deploy.

**Out of scope.** Judgments made with a bad value as evidence stay as they are. Re-asking those works costs Jev calls, and that is the user's call.
