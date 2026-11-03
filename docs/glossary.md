# Glossary

Catalog and work-model terms that are easy to confuse. Each entry names where the term lives so it can be checked against the code.

## Books, editions, works

- **Edition** — a catalog `books` row: one ISBN, or a title-plus-author identity when there is none. Covers, synopses and languages belong to editions.
- **Work** — a `works` row grouping the editions of one book across formats and languages. Every edition has a `books.work_id`.
- **Book** — ambiguous; say which you mean. In the catalog code it is an edition; in user-facing copy it is usually a work; in the library it is an entry.
- **Library entry** — one book in a reader's library: an object inside the `library_documents.data` JSON (`{Title, Attribution, ISBN, …}`), not a catalog row. `library_books` is a table derived from that JSON, and its `work_id` links an entry to a work.
- **Catalog** — the shared `books`/`works` data every reader sees, written by the seed, imports and searches. Not to be confused with a **library**, which is one reader's private document.
- **My shelf** — the Profile tab: a reader's personal space built from their own library. It is a screen, not a store. Not to be confused with a mural's `shelf` block.

## Keys

Three different key formats share the `isbn:` / `ta:` prefixes.

- **`bookKey`** (`@scripta/shared` `library/merge.ts`) — a library entry's identity: a stored `_key`, else `isbn:<ISBN as written>`, else `ta:<title>|<author>` lowercased. Library groups and mural blocks hold it. Not canonicalized, so an entry's ISBN-10 and ISBN-13 give different keys.
- **Catalog key** (`book_keys`, `lookupIdentity`) — an edition's lookup key: `isbn:<ISBN-13>`, with the raw ISBN-10 kept as an alias, or the title key when there is no ISBN.
- **Title key** (`books.title_key`, `catalogTitleKey`) — `ta:<main title>|<first author>|<numbers in the title>`. The main title is cut at the first colon and drops brackets. Empty when the author has no letters. It groups keyless works and never moves an edition into a keyed work by itself.
- **Open Library work key** (`ol_work_key`, `OL…W`) — Open Library's work id, on both `books` and `works` (unique on `works`). An edition with a key joins the work that holds that key.

## Work merging

- **Keyed / keyless work** — a work with / without an `ol_work_key`. Keyless works are ours, grouped by title key.
- **`merged_into`** — on `works` only. A merged work stays as an alias row pointing at its survivor; reads use `COALESCE(merged_into, id)`, and chains are at most one hop.
- **Merge** — `mergeInto`: moves the editions, marks the source merged and logs a `work_merges` row. Its source is one of `title-key`, `admin`, `code`, `jev`, `manual`, `ol-duplicate`.
- **Title fold** (`planTitleFolds`) — folding a keyless work into a keyed or older keyless work with the same title key and the same whole title.
- **`ol-duplicate` merge** — joins two keyed Open Library works that are the same book. The survivor is the one with more editions.
- **Absorbed** — the count of active `ol-duplicate` merges into a work, used to pick a survivor.
- **Detach** — admin `detachEdition`: moves an edition out to a fresh keyless work and blocks it from title grouping (`title_group_blocked_at`). Refused for an edition with its own `ol_work_key`.

## Translations

- **Original title** (`books.original_title`) — a Portuguese edition's "Título original", from its summary or BNP record.
- **`original_key`** — the original title's stem (cut at ` - `, ` — ` or `. `), normalized, plus its numbers. **`original_whole_key`** is the same without the stem cut. Bump `ORIGINAL_KEY_VERSION` when either function changes; a boot migration recomputes them.
- **Translation join** — merging a Portuguese work into the keyed work of its original (`joinByCode`, source `code`; `jev` when the model decided).
- **Original arrival** — a title key queued by triggers when a new or newly keyed edition might be the original some translations are waiting for. A server job drains the queue every 60 s.
- **Claimant** — a Portuguese work whose original title names an arrived original.
- **Volume guard** — stops a translation join from folding a single volume into an omnibus. Verdicts: `join`, `review`, `never`.

## Series and collections

Two unrelated pairs share these names.

- **Catalog series** (`work_series`) — per work; sources ranked `wikidata`, `hardcover`, `ol-edition`, `ol-subject`, `original-title`.
- **Catalog collection** (`book_collections`) — per edition; a publisher's collection from `bnp` or `ol-edition`.
- **Library group** (`@scripta/shared` `library/groups.ts`) — a reader's `series` (seeded from the Kobo/Goodreads `Series` field) or `collection` (made by the reader), holding `bookKey`s.

## Provenance

There is no single source column.

- **`created_by`** — `seed`, `publisher` or `bnp`; NULL for an edition a reader's lookup, import or search created.
- **`data_sources`** — where details came from: `openlibrary`, `isbndb`, `bnp`.
- **Confirmed** — `created_by` or `data_sources` is set. Only confirmed editions are searchable.
- **`summary_source`**, **`genres_source`**, cover source — per-field provenance, each with its own value set (`domain/types.ts`).
- **Edition language** (`books.language`) — a BCP 47 tag (`en`, `pt`, `pt-PT`, `pt-BR`) or NULL; Portuguese is narrowed by ISBN prefix. The translation matcher reads it.

## Jobs and scripts

- **Fill-only** — a column written only while empty.
- **Fill** — a one-off script that fills a column across the catalog (`fill-characters`, `fill-awards`, …).
- **Backfill** — a periodic in-server job that works through rows in batches.
- **Drain** — running batches until one comes back short (`drainBatches`); also processing one queued arrival key (`drainKey`).
- **Seed** — the ranked launch list of about 50k books (`seed-catalog.mjs`), and the `created_by` value of the editions it made. Not to be confused with library series groups "seeded" from an import.
- **Prize books** — award-listed works imported from Wikidata, with their `work_awards` rows.
