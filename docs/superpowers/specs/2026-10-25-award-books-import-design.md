# Add prize books missing from the catalog — design

## Why

Book awards went live on 2026-10-25 (PR #358). Award pills and the Home card only show for books the catalog already has, and matching is by exact ISBN or Open Library work ID. A read-only count on production that day found:

- 2,273 prize-listed works on Wikidata with an ISBN or an Open Library ID;
- of those, 1,621 matched no catalog book directly (about 100 more match through Open Library redirects).

| Prize | Unmatched | Won | Nominated | With an ISBN | Open Library ID only |
|---|---|---|---|---|---|
| Booker | 204 | 25 | 179 | 126 | 78 |
| Hugo, Best Novel | 161 | 25 | 136 | 109 | 52 |
| Nebula, Best Novel | 159 | 21 | 138 | 108 | 51 |
| Pulitzer for Fiction | 45 | 40 | 5 | 27 | 18 |
| International Booker | 33 | 6 | 27 | 19 | 14 |
| Saramago | 3 | 3 | 0 | 3 | 0 |
| Nobel (laureates' works) | 957 | 957 | — | 555 | 402 |
| Camões (laureates' works) | 59 | 59 | — | 30 | 29 |

A reader who searches the catalog for a recent Booker or Hugo winner today often finds nothing locally. A search does go out to ISBNdb and Open Library and saves what it finds, but that book then has no award until the next full awards fill.

## Decisions

The user asked Claude to proceed without questions ("go on", 2026-10-25). Every decision below is **Claude's call**, open to the user's override.

1. **Scope: the eight book prizes, winners and nominees.** That is about 600 works. Laureates' other works for the Nobel and Camões (about 1,000) are left out. Many are single poems, essays or letters, and an author prize already shows on whichever of their books the catalog has.
2. **Open Library only, no ISBNdb.** ISBNdb's daily quota is shared with search and other jobs, and an ISBNdb search spends it unmetered. Open Library is free and already throttled at 1 request a second. A Portugal ISBN (978-972, 978-989) goes to the BNP lookup first, as user search does.
3. **The edition is the one Wikidata names.** A book is created with an ISBN that Wikidata lists for the work, or under the Open Library work ID Wikidata gives, so the awards fill matches it afterwards by the same identifier. Language is whatever that edition is, mostly English. Translations join through the catalog's existing grouping and translation matching.
4. **The same save path as user search, shared, not copied.** That path finds an existing book by identity, else creates it, sets the work key, makes it searchable, groups title keys and merges duplicate works. Its core moves out of the books service closure into a function both the service and the script call. The service's behaviour doesn't change.
5. **A script, run like the awards fill.**
   - Usage: `node scripts/import-award-books.mjs [--dry-run] [--max N]`, run over `railway ssh` with deploys held.
   - It runs every Wikidata query (the awards fill's own `awardQueries`), then every Open Library lookup, then writes.
   - A dry run makes the same lookups and writes nothing.
   - `--max N` stops after N works are created, for a first small real run that can be inspected.
6. **Awards come from a full `fill-awards.mjs` run afterwards.** The import writes no award rows itself. A later awards fill picks the new books up by their identifiers.
7. **Nothing else is fetched up front.** Covers, details (genres, summary, pages) and work keys come from the server's existing background jobs: unchecked covers are queued 500 per 10 minutes, details are backfilled 50 per 10 minutes. About 600 new books are absorbed within a few hours.

## Lookup per work

For each Wikidata work no catalog book matches (by any of its ISBNs or Open Library IDs, after following Open Library redirects as the awards fill does):

1. If it has a Portugal ISBN, try the BNP lookup.
2. Else, if it has an Open Library work ID, ask Open Library search for that work. The hit carries the work key, title, author, year and cover id. Save it with an ISBN from Wikidata's list when the hit lists one, else with the hit's own first ISBN.
3. Else, ask Open Library search for each of its ISBNs in turn until one returns a hit. Save that hit with the ISBN that was searched, not the hit's first ISBN.
4. If nothing returns a usable hit (no title or no author), the work is reported as `unresolved` and skipped.

A single work costs at most a few requests. Search hits can be for the wrong work, so a hit is used only when its work key equals the Wikidata work's Open Library ID (step 2), or when the searched ISBN is among the hit's ISBNs (step 3).

## Report

The script prints a JSON report on stdout and progress on stderr, like `fill-awards.mjs`:

- `prizes`: per key, `{ candidates, alreadyHeld, created, unresolved }`;
- `requests`, `failedKeys`;
- `unresolved`: the Wikidata item IDs and labels, capped at 50, for a spot check.

A dry run's `created` counts the books that would be created.

## Failure handling

- Wikidata failures end the run, as in the awards fill.
- An Open Library 429 is waited out up to three attempts, then ends the run. Nothing is written in that case, because writes happen only after every lookup.
- Any other per-work failure goes in `failedKeys` and the run goes on.
- A real run waits for the books DB lock (`waitForBnpLock`) and writes in batches of 300 with pauses, like the other fills.
- Re-running is safe: a second run finds the books the first one created.

## Non-goals

- Translations or Portuguese editions of prize books.
- Laureates' other works (Nobel, Camões).
- ISBNdb lookups.
- A server job: this is a one-off script, re-run by hand if wanted.
- Any change to award matching or the awards fill.

## Testing

- Unit tests for the lookup decision: the BNP path, the work-ID hit, the ISBN hit, a wrong-work hit rejected, unresolved, a 429 rethrown and another failure reported.
- A dry run writing nothing, `--max` stopping creation, and an existing book found rather than duplicated.
- The extracted save path keeps the books service's existing search tests passing unchanged.
- Production: a dry run reviewed with the user, then `--max 20`, a check of those books' pages, then the full run, then `fill-awards.mjs`.

## Left to the builder

- Where the extracted save function lives and its exact signature.
- How the script finds unmatched works: reuse `matchWorkIds`, or a lighter identifier check.
- Step 2 uses Open Library search with `q=key:/works/OL…W`. Checked live on 2026-10-25: it returns the one work with title, author, cover id and its ISBNs in a single request. `isbn=<ISBN>` returns the work whose `isbn` list holds that ISBN.
