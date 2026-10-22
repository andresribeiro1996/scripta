# Wikidata series fill follows Open Library redirects

## Problem

The `wikidata` mode of `backend/scripts/fill-series.mjs` joins a Wikidata series row to a catalog work only by ISBN or by Open Library work ID (P648), never by title. Wikidata often keeps an Open Library work key that Open Library has since merged into another work. The catalog stores the surviving key, so the row matches nothing.

Two Malazan books show it. *Memories of Ice* (Q4343791) has P648 `OL17731722W`, which redirects to `OL5734773W`, the catalog's key. *The Bonehunters* (Q630382) has `OL17731799W`, which redirects to `OL5734753W`. Neither book's catalog ISBNs are in Wikidata's edition lists, so the ISBN path can't rescue them.

Open Library answers a merged work's JSON with HTTP 200 and a redirect record:

```json
{ "key": "/works/OL17731722W", "type": { "key": "/type/redirect" }, "location": "/works/OL5734773W" }
```

An unknown key is HTTP 404.

## Behaviour

1. Some Open Library work IDs on Wikidata rows have no catalog work. A row's IDs count only if its series name has a name key and isn't on the `--skip` list. The fill fetches `https://openlibrary.org/works/<id>.json` for each of these IDs, once per run. It uses the fill's Open Library throttle (`OPEN_LIBRARY_GAP_MS`, 1 s) and the shared `User-Agent` (`fetchJson`). IDs that already have a catalog work are never fetched. So are the IDs of skipped rows and of rows without a usable series name.
2. If the record's `type.key` is `/type/redirect` and `location` holds a work key, the fill looks that key up in the catalog. A catalog work there takes the original ID's place for every row that carries the ID. If the target has no catalog work either, the fill fetches the target and follows its redirect the same way. It follows at most 2 hops, so one ID costs at most 2 requests.
3. A 404, or a record that isn't a redirect, means no match. That covers a plain work and a deleted one. So does a redirect whose `location` isn't a work key.
4. Failures follow the `held` fill. A non-429 `SourceUnavailableError` (5xx, timeout, network, invalid JSON) puts the original ID in `failedKeys`, and the run goes on. A 429 is retried by the script, up to three attempts in all, waiting out its Retry-After and at least a minute each time, and then ends the run. Any other error ends the run too.
5. The dry run makes the same requests and writes nothing. That way its `series` list and counts match the real run's.
6. The report adds two fields. `redirected` is the number of IDs that reached a catalog work only through a redirect. `failedKeys` lists the IDs to try again. A re-run is safe: rows that exist are skipped.
7. The script runs every Wikidata query before any Open Library request. Then it calls the fill once with all the rows. The lookups take hours, and spreading them between pages would cause two problems. A Wikidata failure could end the run hours in. And Wikidata edits made between pages would shift `OFFSET` paging.
8. While it runs, the script writes a progress line to stderr every 100 Open Library requests.

## Unchanged

- The SPARQL query, including the publisher-series class filter and the edition-item exclusion.
- The `--skip` list. A real run still refuses to start without it.
- Dry run first.
- No title matching.
- Batched writes: 300 rows per transaction, with 100 ms pauses.

## Cost

Each run takes one second per Open Library ID that has no catalog work, plus a second request for the redirect targets that aren't in the catalog either. The dry run and the real run each pay this.

## Anti-goals

- No persisted redirect cache between the dry run and the real run.
- No change to the `held`, `originals` or `bnp` modes.
- No redirect following anywhere outside this fill.
