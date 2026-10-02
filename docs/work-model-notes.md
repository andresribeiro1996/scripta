# Work model: notes for the future plan

Today a catalog `books` row is an edition (an ISBN) or a title-plus-author identity. Nothing groups editions into a work. This file collects what the eventual work/edition model needs to know. Nothing here is built yet.

## Already in place

- **`books.ol_work_key`** holds Open Library's work id (`OL82563W`). It is filled by the seed, by the publisher importer (from `/isbn/{isbn}.json`), and by Open Library details and search answers. It is fill-only, and nothing reads it yet.
- **Covers stay per edition.** The Portuguese Relógio d'Água cover isn't the English Penguin one. A work would pick a display cover, for example the one in the reader's language.

## Gaps to plan for

- **Books Open Library doesn't know** get no work key. That includes many small Portuguese presses. They need works of our own (our id), grouped by title plus author where it's safe, and linked to an Open Library work later if one appears. Wikidata and PORBASE (the national library catalogue) have work-level ids for some Portuguese books.
- **Backfill.** Rows without a key can be filled from `/isbn/{isbn}.json` at 1 request/s, in the background.
- **The title key (`ta:`)** acts like a work key but uses edition titles, which differ by language. It caused the importer's English-title collision fixed on 2026-10-01, so it shouldn't become the work key.
- **Who benefits:**
  - Social "who read this book" should match by work, across editions and languages.
  - Library duplicate review can use the work as a "maybe the same book" hint. It must never auto-merge, since owning two editions is legitimate.
  - The arena, tier lists and murals keep their per-library `bookKey`.

## Quotes for a work

Famous quotes belong to the work, not an edition. They are curated lines about or from the book, not readers' highlights, which stay private to each reader.

- **Wikiquote** (pt.wikiquote.org and en.wikiquote.org) is the realistic source:
  - **Coverage:** curated pages per famous work and author. Strong for classics (Pessoa, Saramago, Eça, Camões), close to nothing for recent or small-press books.
  - **Licence:** CC BY-SA, so show credit and a link to the page.
  - **Lookup path:** Open Library work key → Wikidata item → Wikiquote sitelink.
  - **Language:** show quotes in the reader's language first.
- **Not usable:**
  - Goodreads quotes: no API, and their terms forbid copying.
  - Wikidata's "quotation" property: nearly empty.
  - AI-generated quotes: misattribution risk.
- **Possible extra:** press pull-quotes on publisher product pages ("«…» — Público") are praise for the book, not quotes from it. The importer could keep them later.
