# Rich Book Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every catalog book carries the richest details we can get from day one, not only once somebody opens it:
- the synopsis, page count, publisher, year and translator;
- the existing genres and rating.

**Architecture:**
1. **Schema and merge rules.**
   - `books` gains `pages`, `translator` and `summary_source`.
   - The details API (`BookMetadata`) returns `pages`, `publisher`, `year` and `translator`.
   - Saving details becomes a merge that never erases what's already there.
2. **The publisher importer** fills these fields from each shop's own product data. That's the Portuguese synopsis written by the publisher, plus page counts and translators from product attributes or page text.
3. **A server-side details backfill** fetches Open Library and ISBNdb details for every book that has never been checked. It runs in the background, after users' own requests, the same way the cover backfill does. Open Library's and ISBNdb's adapters also return pages, year and publisher.

**Tech Stack:** Fastify/TypeScript, `node:test`, backend `books` module, `@scripta/shared` (`BookMetadata`).

**Spec:** the Decisions below (chat, 2026-10-01: "I want the books/works as rich as possible", "we would benefit having the synopsis on our side from day 1").

## Decisions

- **Columns.** Nullable, added with the existing boot-migration pattern (PRAGMA + `ALTER TABLE ADD COLUMN` in `adapters/sqlite/connection.ts`, also in `books.sql`):
  - `books.pages INTEGER`
  - `books.translator TEXT`
  - `books.summary_source TEXT`, one of `'publisher'`, `'openlibrary'` or `'isbndb'`
  - `year` and `publisher` already exist.
- **API.** `BookMetadata` (`packages/shared/src/library/bookMetadata.ts`) gains `pages: number | null`, `publisher: string | null`, `year: number | null` and `translator: string | null`, all nullable. `GET /books/details` returns them. The client UI shows nothing new in this plan, because showing them is separate design work.
- **Merge rules for saving details** (repository `saveDetails` and the service):
  - **`summary`:**
    - A publisher synopsis replaces any non-publisher summary.
    - An Open Library or ISBNdb summary only fills an empty one, and never replaces a publisher one.
    - `summary_source` records whose summary it is.
  - **`pages`, `year`, `publisher`, `translator`, `genres`:** fill only when empty or null. They are never overwritten.
  - **`rating`, `rating_count`, `source_url`:** as today. Open Library's values are written when it answers.
  - **`data_sources`:** as today. It stays limited to `openlibrary`/`isbndb` because the inside search's ISBN answers depend on it. The publisher's credit is `summary_source`, plus `publisher_url` and `created_by`.
  - **`details_status`:** publisher data does not mark a book `found`. The backfill still asks Open Library and ISBNdb, and they fill whatever is still empty.
- **Importer extraction** (`seed/publisherFeed.ts`, `seed/importPublisherCovers.ts`), from the product's feed JSON and, when it was fetched, its product page text:
  - **Synopsis:**
    - Taken from the Shopify `body_html` or the WooCommerce `description` (falling back to `short_description`).
    - Converted to plain text: tags stripped, entities decoded, whitespace collapsed, paragraph breaks kept as `\n\n`.
    - Lines that are clearly shop notices are dropped: those matching `/pr[ée]-venda|envios|portes|stock|esgotado/i` within the first 200 characters.
    - Kept only if it is at least 80 characters.
  - **Pages:**
    - First a WooCommerce attribute whose name matches `/p[áa]ginas|n[úu]m\.? ?p[áa]g/i`;
    - else the first match of `/(\d{2,4})\s*(?:p[áa]g(?:inas|s)?\.?)(?![a-z])/i` in the text.
    - It must be between 8 and 5000.
  - **Translator:** a WooCommerce attribute matching `/^tradu/i`, else `/Tradu(?:ção|zido)(?: de| por)?:?\s*([^\n.;|]{3,60})/i` in the text, trimmed.
  - **Year:** a WooCommerce attribute matching `/^(ano|data|edi[cç][aã]o)/i` that contains a 4-digit year from 1900 to the current year.
  - **Publisher:** the site's `name` from `PUBLISHERS`, e.g. `"Antígona"`, `"Penguin Livros"`.
  - **Which books:** every resolved book the importer touches, whether created, existing, unchanged or covered. That way a re-run fills fields added later. Dry run writes nothing.
- **Details backfill** (server):
  - **Which books:** those with `details_status IS NULL`, oldest first, in batches of 50 every 10 minutes (`startBackfill`'s cadence), at most one lookup at a time.
  - **What runs:** the same lookup as `getDetails`, Open Library first and ISBNdb filling gaps, saved through the merge rules.
  - **Priority:** it uses the throttles' normal (non-urgent) lane, so users' own detail requests, which use the urgent lane, always go first.
  - **Failures:**
    - ISBNdb's daily pause applies; a paused ISBNdb is skipped like any unavailable source.
    - A book whose lookup failed (`SourceUnavailableError`) stays `details_status IS NULL` and is retried on a later batch.
  - **Load:** about 2 Open Library requests per book. A 50k catalog takes roughly a day of Open Library time, plus ISBNdb within its quota.
- **Adapters:**
  - **Open Library** (`adapters/openlibrary/*`): add `number_of_pages_median`, `first_publish_year` and `publisher` to the `fields` it already requests in `fetchDetails`. Map them to `pages`, `year` and `publisher` (the first publisher). No new requests.
  - **ISBNdb** (`adapters/isbndb/isbndbCatalog.ts`): map the `pages`, `date_published` (year) and `publisher` the response already returns into the new fields.

## Global Constraints

- Minimum code, no code comments, no new dependencies (root `AGENTS.md`).
- Catch only the errors you expect (`SourceUnavailableError`). A bug must propagate.
- Every new `*.test.ts` is appended to `backend/package.json` `"test"`. Backend tests run with `DOTENV_CONFIG_PATH=/nonexistent/.env`. Rebuild `@scripta/shared` before backend typecheck.
- Shared changes keep the frontend and mobile typecheck green, because `BookMetadata` is shared. Run both typechecks.
- Don't touch `apple.ts`, `start-with-litestream.sh` or `litestream.yml`.
- Tests make no network calls.

## Review Focus

1. **A publisher synopsis is never replaced** by a later Open Library or ISBNdb answer, and an Open Library answer never erases a page count, year or translator the importer set. Pinned in Task 1.
2. **A shop notice ("Livro em pré-venda. Envios dia 13 de Outubro.") is not stored as a synopsis**, and a price or ISBN digit run is not stored as a page count. Pinned in Task 2.
3. **The backfill never delays a user's own details request,** because it uses the non-urgent lane. A source outage leaves books unchecked for a later batch, not marked missing. Pinned in Task 3.
4. **Clients still typecheck and render** with the new nullable `BookMetadata` fields. Pinned in Task 1.
5. **Re-running the importer** fills newly supported fields on books it already imported, and doesn't duplicate anything. Pinned in Task 2.

---

### Task 1: Schema, `BookMetadata` fields, merge rules, adapter fields

**Files:**
- `books.sql`, `connection.ts`
- `sqliteBooksRepository.ts`, plus its test
- `domain/ports.ts`
- `packages/shared/src/library/bookMetadata.ts`, plus every `BookMetadata` literal in tests and fakes
- `booksService.ts` (`getDetails`, `detailsOf`)
- `adapters/openlibrary/*`, `adapters/isbndb/isbndbCatalog.ts`, `adapters/catalog/compositeCatalog.ts`, plus their tests

- [ ] **Step 1: Failing tests:**
  - **Migration:** adds the 3 columns, idempotently.
  - **Repository merge:**
    - a publisher summary replaces an Open Library one;
    - an Open Library summary doesn't replace a publisher one;
    - pages, year, publisher and translator only fill nulls;
    - rating is overwritten as today.
  - **`getDetails`:** returns the new fields.
  - **Open Library adapter:** maps `number_of_pages_median`, `first_publish_year` and `publisher` from a fixture doc.
  - **ISBNdb adapter:** maps `pages`, `date_published` and `publisher`.
  - **Composite catalog:** keeps Open Library's values and fills the empty ones from ISBNdb.
- [ ] **Step 2:** Run them and watch them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Verify:
  - shared build and test;
  - backend typecheck and full suite;
  - frontend typecheck;
  - mobile typecheck (`EXPO_PUBLIC_API_URL` set, as in CI).
- [ ] **Step 5: Commit:** `Store page count, year, publisher and translator, and never let a later source erase richer details`.

### Task 2: The importer fills details from the publisher

**Files:** `seed/publisherFeed.ts`, `seed/importPublisherCovers.ts`, the fixtures, and their tests. The script needs no change unless the new deps need wiring.

- [ ] **Step 1: Failing tests** on fixtures:
  - **Synopsis:**
    - a Shopify `body_html` synopsis comes out as clean text with paragraph breaks;
    - a WooCommerce description that starts with "LIVRO EM PRÉ-VENDA. ENVIOS DIA 13 DE OUTUBRO." keeps only the real synopsis;
    - text under 80 characters is not stored.
  - **Pages:**
    - from an Abysmo/Kathartika-style `Núm. páginas` or `Páginas` attribute;
    - from text ("240 págs");
    - a "2024" or an ISBN digit run is not taken.
  - **Translator:** from an attribute, and from "Tradução de Ana Lima".
  - **Year** and **publisher:** a year attribute is taken; the publisher is the site name.
  - **Writes and dry run:**
    - details are saved through the merge, `summary_source = 'publisher'`;
    - an existing book gets them on a re-run;
    - dry run writes nothing.
- [ ] **Step 2:** Run them and watch them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Verify: backend typecheck and full suite, backend build, `node --check backend/scripts/import-publisher-covers.mjs`.
- [ ] **Step 5: Commit:** `Take the synopsis, page count and translator from the publisher's own product data`.

### Task 3: Server-side details backfill

**Files:** `backfill.ts` (or a sibling), `plugin.ts`, `booksService.ts` (a `backfillDetails(limit)` method), `sqliteBooksRepository.ts` (`listUncheckedDetailIds(limit)`), and their tests. Also the README books section.

- [ ] **Step 1: Failing tests:**
  - **Batching:** it takes at most 50 unchecked books, oldest first, one at a time, and saves through the merge.
  - **Failures:** a `SourceUnavailableError` leaves the book unchecked and counts nothing as missing.
  - **Priority:** the catalog calls use the non-urgent lane. Show that a queued urgent `getDetails` runs before the backfill's next lookup.
  - **Re-checking:** already-checked books are not re-fetched.
  - **Shutdown:** the plugin starts it with the cover backfill, and stops it on close.
- [ ] **Step 2:** Run them and watch them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Verify: backend typecheck, full suite and build.
- [ ] **Step 5: README:**
  - the new fields;
  - the merge rules;
  - publisher-first summaries;
  - the backfill and its load (a 50k catalog takes about a day of Open Library time, ISBNdb within its quota).
- [ ] **Step 6: Commit:** `Fetch every book's details in the background instead of on first view`.
