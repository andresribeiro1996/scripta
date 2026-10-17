# Fill the remaining catalog authors — design

**Date:** 2026-10-17. **Follows:** `docs/superpowers/plans/2026-10-15-fill-authors.md` (PRs #286, #291, #295).

## Goal

About 6,000 catalog books still have a title and no author, so author search misses them and the translation and genre passes skip them. Give them their author from the shop that sells them where the shop says it, and from ISBNdb for every other book with an ISBN, without ever writing a wrong one.

Success: after the production runs, `seed-catalog.mjs --status` shows every row of the table below under its current `authorless` count, with no fill taken from a related product, a translator, a placeholder, or an ISBNdb record for a different title. What stays blank is what neither the shop nor ISBNdb knows.

## Where the 6,002 are (production, 2026-10-17 14:10Z)

| Source | Authorless | This design |
|---|---|---|
| Edições Afrontamento | 1,219 | page `product-autor` |
| Seed (`created_by = 'seed'`, no shop) | 1,394 | ISBNdb fallback |
| Saída de Emergência | 892 | page `summaryAuthor` |
| Exclamação | 881 | page Elementor widget; the ≈ ¾ with no author on the page go to the ISBNdb fallback |
| Imprensa Nacional | 667 | feed `AUTOR` tags |
| Orfeu Negro | 315 | page `<h4>` in `prod-main` |
| Divergência | 212 | ISBNdb fallback (no shop rule, see below) |
| Other shops and no-shop non-seed | ~420 | ISBNdb fallback when they have an ISBN |

Evidence for each rule (markup, sample sizes, accuracy) is in the research note from 2026-10-17, summarised per rule below.

## Decisions

1. **One shared credit cleaner** for every shop author source (feed vendor, feed tags, WooCommerce `Autor` attribute, every page rule, and the seed script):
   - drop every parenthesised segment: `(org.)`, `(orgs.)`, `(coord.)`, `(coords.)`, `(texto)`, `(ilustração)`, `(trad. de …)`, `(Tradução de …)`, `(org. …)`; collapse whitespace; trim;
   - a credit whose normalised form (lower case, accents, dots and spaces removed) is `vvaa`, `aavv`, `autordesconhecido`, `diversos`, or starts with `varios`, is no author (`null`);
   - **never split on " e "**: "Alberto da Costa e Silva" and "Melo e Castro" are one person each. A combined "A e B" credit is kept as the shop wrote it. Lists the shop already separates (several tags, several links, several `<h4>`) are joined with `", "` as today.
   - Rows filled with a placeholder on 2026-10-16 ("Vários", "Autor Desconhecido": about 5) stay; fills never overwrite.
2. **Imprensa Nacional, from the feed.** `AUTOR_<n> <name>` tags in numeric order of `n`; if there are none, the single `AUTOR <name>` tag. 11 of 11 sampled books right (placeholders dropped). This generalises the per-site author-tag rule that Presença uses.
3. **Four page rules,** each confined to the main product block:
   - **Saída de Emergência:** every `/autor/` link inside `<div class="summaryAuthor">` (17 of 17). `pageAuthors` misses these because the links carry an inline `style`, not `class="autor_link"`.
   - **Edições Afrontamento:** the text of `<p class="product-autor">` (14 of 14 that have it). Never `card-autor` (related cards) or `product-subtitulo`.
   - **Orfeu Negro:** every `<h4>` between `<div class="prod-main">` and the next `<div class="product-description` (16 of 19 exact, 2 add an illustrator, none wrong, 1 "Em Breve" empty). Illustrators counted as authors are accepted, as Goodreads does for picture books. Not the `autorilust` links.
   - **Exclamação:** the text of the Elementor text widget `data-id="b6a8e18"` (8 of 8 where it has text). If the shop rebuilds its template the id changes and the rule returns nothing, which is safe.
   - The existing `autor_link` rule stays for Relógio d'Água, Gradiva, Guerra & Paz and Penguin. A site names its page rule instead of today's `authorLinks: true`.
4. **When the importer reads a page for its author** (the #291 path): a site with any page rule, a feed that gives the ISBN, no feed author, and a stored book whose author is empty. The page's author is used unless **the page shows a different ISBN** (today: unless it shows the same one). Exclamação and Saída de Emergência pages carry no readable ISBN, so the stricter check would reject every one of them; the page is the feed's own permalink for that product, and the repair already requires the stored title to match the product's.
5. **Everything else, from ISBNdb.** A capped fallback script, `scripts/fill-authors-isbndb.mjs --max N [--after <id>] [--dry-run]`, run after the shop importer runs:
   - selects every book with an empty author and an ISBN, shop or not, in a stable order (`id`), starting after `--after` (1,394 seed rows, Divergência, Kathartika, Pato Lógico, Abysmo, Exclamação's books with no author on the page, and whatever the shop rules leave blank: roughly 3,000–4,000);
   - asks ISBNdb `GET /book/{isbn}` through the existing catalog search (`givenNameFirst` normalisation included), one call per book, `--max` a hard limit;
   - fills the author only when ISBNdb's title matches the stored title (the importer's same-title test) and the cleaned credit is not a placeholder;
   - fills through `fillMissingIdentity`, so the title key is claimed and the work's code-only translation verdict reopens, like every other fill;
   - stops on ISBNdb's daily pause and reports it, like `retitle-lossy.mjs`;
   - the report ends with `next`, the last id asked; the next night's run passes it as `--after`, so no book is asked twice and no new column is needed;
   - a dry run opens the database read-only and still asks ISBNdb, so it is used only as a small sample (`--max 50`).
   - Quota: run right after a 00:00Z reset with `--max 1500` a night (~28 minutes at the 1.1 s gap), 2–3 nights; the nightly cover re-checks lose those calls on those nights. How much ISBNdb knows of small Portuguese presses is unknown until the sample.
6. **No shop rule for:**
   - Divergência: its author is one of the genre tags, separable only by a hand-kept stoplist, and a new genre tag would become a permanent wrong author. ISBNdb covers it instead.
   - Kathartika, Pato Lógico, Abysmo: no author found in their feed or pages (2026-10-15 sampling). ISBNdb covers them.
   - Exclamação's uncategorised books: no author anywhere on their page (12 of 12 sampled). ISBNdb covers them.

## Components

- `seed/publisherFeed.ts`: the credit cleaner; the INCM tag rule; four page extractors next to `pageAuthors`; all return `string | null` copied with `structuredClone` (#295).
- `seed/publishers.ts`: `PublisherSite` names its page rule and its tag rule; the five shops get theirs.
- `seed/importPublisherCovers.ts`: page-author read for any site with a page rule; the ISBN check becomes "not a different ISBN".
- `seed/isbndbAuthors.ts` + `scripts/fill-authors-isbndb.mjs`: plan-then-fill like `lossyRetitle.ts`, report `{ selected, asked, filled, noRecord, noAuthor, titleMismatch, placeholder, next, isbndb: { max, asked, unavailable, notAsked, pausedUntil }, fills: [{ id, isbn, title, author }] }`.
- Docs: `backend/README.md` (Authors paragraph, new script section), `docs/publisher-catalog.md` "Author from" cells.

## Testing

- Each extractor against fixtures cut from the sampled pages, including the related-card, translator and empty cases the research found; the cleaner against every credit form listed above; the INCM rule against the multi-author and placeholder tag sets.
- Importer: a Saída-style page with no ISBN fills; a page with a different ISBN does not; a site without a page rule reads no page.
- Fallback script: fills on a matching title, skips a mismatched title, a placeholder and a record without authors, starts after `--after`, reports `next`, stops at `--max` and on the daily pause, writes nothing on a dry run.

## Production (run by Claude or the owner after the deploy)

Deploy main with this change and #295. Then, one job at a time and with `--max-old-space-size` as needed:
1. `--status` baseline.
2. Importer dry run per shop (`--site` for each of the five), spot-check `identity` lines (no translator, no related book, no placeholder).
3. Real importer run for the five shops.
4. After the next 00:00Z reset: `fill-authors-isbndb.mjs --dry-run --max 50` (a sample: a dry run spends ISBNdb calls too), check its fills and title mismatches; then the real run with `--max 1500`. Repeat the real run on the following nights with `--after <previous next>` until `selected` is exhausted.
5. `--status` again; translation backlog dry run, then real.
