# Portuguese Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the launch seed runs, make three changes:
- The seed's Portuguese share becomes Portugal editions with good covers.
- Covers come straight from Portuguese publishers' own shops.
- ISBNdb's 5,000-a-day quota stops the seed from calling it until the next day, instead of turning into a retry loop.

**Architecture:**
- **ISBNdb gate.** One gate, shared by every ISBNdb caller, pauses all ISBNdb calls:
  - when ISBNdb says the daily quota is used up (HTTP 429), until the quota resets;
  - when it rejects the key (401/403), until the next 00:00 UTC, and it sends one alert email.

  A book that needed ISBNdb while it was paused backs off until the pause ends.
- **Seed list.** The `por` share is drawn from Open Library works that have a Portugal-ISBN edition (`978-972`, `978-989`), ranked by readers.
- **Publisher importer.** An in-container script reads the public product feeds of 12 independent Portuguese publishers (Shopify `products.json`, WooCommerce Store API):
  - it keeps products with a Portugal ISBN;
  - it stores each cover as source `publisher`, status `manual`, so no automatic source replaces it;
  - it creates the book when we don't have it yet.

**Tech Stack:** Fastify/TypeScript, `node:test`, backend `books` module, plain-ESM scripts run on Railway over `railway ssh`.

**Spec:** the Decisions below (chat, 2026-10-01). They build on `docs/superpowers/plans/2026-09-30-seed-runner.md` and `2026-10-01-fast-import-lanes.md`.

## Decisions

- **No users yet.** The seed may use the whole ISBNdb quota. There's no per-lane reserve.
- **ISBNdb quota.** 5,000 requests a day, resetting at 00:00 UTC. Over the quota, ISBNdb answers 429 "Daily quota exceeded". Its docs pages refuse automated reads, so this is from search results. The gate therefore also reads the reset from the response headers when present: `retry-after` in seconds, or `reset=<seconds>` inside a `ratelimit` header.
- **Pause rules.**
  - 429: pause until `now + reset` from the headers, or until the next 00:00 UTC without them.
  - 401/403: pause until the next 00:00 UTC.
  - While paused, no ISBNdb request reaches the network. That includes calls already waiting in the throttle when the pause starts.
  - Each pause start logs one warning. A 401/403 pause start also sends one email to `ALERT_EMAIL` when it and Resend are configured.
- **Per-book backoff** after an incomplete lookup is `max(now + 10 min, the latest retryAt among its failures)`. A paused-gate failure isn't logged per book.
- **Google Books is out.** The 2026-09-27 bake-off measured it at 11 good covers out of 139: thumbnails only.
- **No separate Portuguese trial.** `seed-catalog.mjs --status` gains a Portugal-ISBN breakdown, which measures the same thing after the seed.
- **Seed mix:** 35,000 English and 5,000 Portugal editions. Brazilian editions enter only through user imports.
- **Seed list for Portugal:**
  - Two Open Library queries, `q=isbn:978972*` and `q=isbn:978989*`, each with `lang=por&sort=readinglog`. A single `OR` query loses the matched edition, so it can't be used.
  - Merged by `readers`, highest first, and deduped by ISBN.
  - The edition's ISBN must start with `978972` or `978989`. Pick the 13-digit one.
  - The language check is skipped for these, since the ISBN prefix is the signal: some Portugal editions have no `language` field.
- **Publishers, first run:** confirmed active, independent, feed platform known, and ISBN on the product. **Shopify:** Antígona `https://antigona.pt`, Orfeu Negro `https://orfeunegro.org`, Pato Lógico `https://pato-logico.com`, Imprensa Nacional `https://loja.incm.pt`, Flâneur `https://flaneur.pt`. **WooCommerce:** Relógio d'Água `https://www.relogiodagua.pt`, Guerra & Paz `https://guerraepaz.pt`, Exclamação `https://exclamacao.pt`, Abysmo `https://abysmo.pt`, Gradiva `https://gradiva.pt`, Planeta Tangerina `https://planetatangerina.com`, Bruaá `https://bruaa.pt`. Tinta-da-China and the others are out for now (their sites refuse automated reads, there's no ISBN, or they're group-owned).
- **Feeds** (verified on Antígona and Relógio d'Água, 2026-10-01):
  - Shopify: `GET {origin}/products.json?limit=250&page=N`. Read `title`, `vendor` (the author at Antígona), `body_html`, `variants[].sku/barcode`, `images[0].src/width/height`, and the product URL `{origin}/products/{handle}`.
  - WooCommerce: `GET {origin}/wp-json/wc/store/v1/products?per_page=100&page=N`. Read `name`, `sku`, `description`, `short_description`, `attributes`, `images[0].src`, `permalink`. Relógio has an empty `sku`, and the ISBN is in the image file name.
  - Stop at an empty page, or at a 400 past the last page.
- **ISBN of a product:** scan the product's whole JSON text for ISBN-13 candidates. A candidate is `97[89]` plus 10 more digits, optionally separated by `-`, space or `.`. It must pass the checksum and start with `978972` or `978989`. Take the first match. A product with none is skipped: not a book, or not a Portugal edition.
- **Author of a new book:**
  - Shopify `vendor`, when the site's `authorFromVendor` is true and the vendor isn't the publisher's own name.
  - Otherwise Open Library: `search.json?q=isbn:{isbn}&fields=title,author_name`, 1 request a second. Its title is then preferred over the shop's, because some shops write titles in capitals.
  - Still no author: skip the book, counted as `noAuthor`.
- **Cover rules:**
  - Fetch `images[0]`. It must decode (`encodeCover`) and pass `isAcceptableCover`.
  - Use it when it's at least `MIN_GOOD_WIDTH` (400), or when the book has no cover.
  - Never replace a cover whose image source is `upload` (an admin upload).
  - Skip when the current image's `source_url` is already this image URL, so re-runs are no-ops.
  - Store the cover with source `publisher` and status `manual`, then clear `cover_upgrade_wanted_at`.
- **Politeness:**
  - User agent `Atmyshelf/1.0 (+https://atmyshelf.com)`.
  - Read `{origin}/robots.txt` and skip the site when the `User-agent: *` group disallows the feed path.
  - Wait `max(3 s, Crawl-delay)` between requests to one site, image downloads included.
  - Sites run concurrently, and the Open Library lookups share one 1 s throttle.
- **Script:** `node scripts/import-publisher-covers.mjs [--dry-run]`. It runs from `/app/backend` like `seed-catalog.mjs`, prints per-site counts, and with `--dry-run` writes nothing and fetches no images.
- **Run order on Railway, after merge:** importer `--dry-run`, then the importer, then the seed.

## Global Constraints

- Minimum code, no new code comments, no new dependencies (root `AGENTS.md`).
- Catch only the errors you expect. `SourceUnavailableError` keeps its meaning, and the paused error is a subclass of it so every existing `attempt()` still treats it as "source unavailable".
- Append every new `*.test.ts` to `backend/package.json` `"test"`. Tests run with `DOTENV_CONFIG_PATH=/nonexistent/.env`.
- Code the container script imports must live under `backend/src/` (compiled to `dist/`). `backend/scripts/*.mjs` imports `../dist/...`.
- Tests make no network calls. Use fixtures and fake fetch, and keep fixture JSON trimmed to a few products.
- Don't touch `apple.ts`, `start-with-litestream.sh` or `litestream.yml`.

## Review Focus

1. **Quota hit mid-seed.** After the 429, no ISBNdb request goes out until the reset, including calls queued in the throttle. The affected books are retried after the reset, not every 10 minutes, and the log gets one warning, not one per book. Pinned in Task 1.
2. **Key rejected.** One email per pause, at most one a day. A failing email send is logged and crashes nothing. With no `ALERT_EMAIL`, it only logs. Pinned in Task 1.
3. **A publisher product with a Brazilian ISBN, or two ISBNs** (e.g. an original edition's ISBN mentioned in the description): only a Portugal ISBN is used, and Brazil-only products are skipped. Pinned in Task 3.
4. **Running the importer twice** stores no second image for any book, and an admin-uploaded cover is never replaced. Pinned in Task 3.
5. **A site whose robots.txt disallows the feed path,** or whose feed returns non-JSON, is skipped with a reason. The other sites still run. Pinned in Task 3.

---

### Task 1: ISBNdb gate — pause on quota and on a rejected key, alert email

**Files:**
- Modify: `backend/src/modules/books/domain/errors.ts`:
  - `SourceUnavailableError` gains optional `status?: number` and `retryAt?: number` (epoch ms) through a third constructor argument `options: { status?: number; retryAt?: number } = {}`.
  - Add `export class SourcePausedError extends SourceUnavailableError`, with a required `retryAt`.
- Modify: `backend/src/modules/books/adapters/http/http.ts`. `fetchJson`'s non-ok branch passes `status`. For 429 it passes `retryAt` from `retry-after`, or from `reset=` in `ratelimit`, as `now + seconds*1000`.
- Create: `backend/src/modules/books/adapters/isbndb/isbndbGate.ts`.
- Modify: `backend/src/modules/books/adapters/sources/isbndb.ts`. `createIsbndbGet(apiKey, throttle, gate, urgent = false)` and `createIsbndbSource(apiKey, throttle, gate)`.
- Modify: `backend/src/modules/books/adapters/isbndb/isbndbCatalog.ts`: `createIsbndbCatalog(apiKey, throttle, gate)`.
- Modify: `backend/src/modules/books/plugin.ts`.
  - Create one gate shared by the source and the catalog.
  - `onPause` logs `app.log.warn({ reason, until }, "ISBNdb paused")`. For reason `"key"` it also calls `options.alert?.(...)` and catches and logs a failed send.
  - The plugin takes options `{ alert?: (subject: string, text: string) => Promise<void> }`.
- Modify: `backend/src/app.ts`: `app.register(registerBooksModule, { alert: emailEnabled && env.ALERT_EMAIL ? (subject, text) => sendAccountEmail(env.ALERT_EMAIL, subject, text) : undefined })`.
- Modify: `backend/src/config/env.ts`: `ALERT_EMAIL: z.string().optional().default("")`, following `ISBNDB_API_KEY`'s pattern.
- Modify: `backend/src/modules/books/booksService.ts` (`processBook`): the backoff rule, and no warning for `SourcePausedError`.
- Modify: `backend/scripts/cover-source-trial.ts`: pass a gate whose `onPause` does nothing.
- Test: `isbndbGate.test.ts` (new), `http.test.ts`, `booksService.test.ts`, `isbndb` source and catalog tests where their signatures changed.

**Interfaces:**
- `createIsbndbGate(options: { now?: () => number; onPause: (pause: { reason: "quota" | "key"; until: number }) => void }): IsbndbGate`
- `interface IsbndbGate { run<T>(call: () => Promise<T>): Promise<T> }`
  - `run` throws `new SourcePausedError("isbndb", "paused until <ISO>", { retryAt: until })` while paused, without calling `call`.
  - Otherwise it awaits `call`. On a `SourceUnavailableError` with `status` 429, 401 or 403 it starts a pause (as in Decisions) unless one is already running, calls `onPause` once, and rethrows.
  - `createIsbndbGet` wraps both sides of the throttle: `gate.run(() => throttle(() => gate.run(fetch), { urgent }))`. So a call queued before the pause doesn't hit the network.
  - The inner rethrow mustn't start a second pause or call `onPause` twice.

- [ ] **Step 1: Write failing tests:**
  - **Gate:**
    - A 429 with no headers pauses until the next 00:00 UTC.
    - A 429 whose `retryAt` is set pauses until it.
    - 401 and 403 pause with reason `"key"`.
    - `onPause` is called once for a burst of failures.
    - While paused, `call` isn't invoked and `SourcePausedError` carries `retryAt`.
    - After `until`, calls go through again.
    - A 503 doesn't pause.
  - **`fetchJson` (fake `fetch`):** a 429 with `retry-after: 120` sets `retryAt` 120 s ahead and `status` 429. A 429 with `ratelimit: limit=5000, remaining=0, reset=3600` sets it 3,600 s ahead. A 500 has `status` 500 and no `retryAt`.
  - **`createIsbndbGet` with a real `createThrottle` and fakes:** two calls queued, the first returns 429, and the second never reaches the fetch.
  - **`processBook`:** a lookup whose ISBNdb failure is `SourcePausedError` with `retryAt` 5 h ahead sets the book's backoff to that time, so `schedule` ignores it before then. It warns for none of those failures. A plain 503 failure keeps the 10-minute backoff and still warns.
- [ ] **Step 2:** Run them and watch them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `cd backend && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test`.
- [ ] **Step 5: Commit.** Message: `Pause ISBNdb for the day when its quota runs out or it rejects the key`. The body explains: 5,000 requests a day against roughly 10,000 the seed needs, and why a per-book 10-minute retry turned a used-up quota into a loop.

---

### Task 2: Portugal editions in the seed list, and a Portugal breakdown in `--status`

**Files:**
- Modify: `backend/src/modules/books/seed/rankedWorks.ts`:
  - Export `PORTUGAL_ISBN_PREFIXES = ["978972", "978989"] as const`.
  - `rankedWorksUrl(lang, offset, limit, isbnPrefix?: string)` uses `q=isbn:${isbnPrefix}*` when it's given, and `language:${lang}` otherwise. `lang` and `sort` stay as they are.
  - `parseRankedWorks(json, lang, isbnPrefix?)`: with a prefix, skip the language check and keep only an edition ISBN starting with the prefix, preferring 13 digits.
- Modify: `backend/src/modules/books/seed/fetchRankedWorks.ts`. `collectRanked("por", wanted, log)` collects each prefix in turn, as it does today for one query, then returns the union sorted by `readers` descending and deduped by ISBN. `"eng"` is unchanged.
- Modify: `backend/scripts/seed-catalog.mjs`. `--status` adds `portugal: { total, good, low_res, missing, manual, null }` for books whose `isbn` starts with `978972` or `978989`.
- Test: `rankedWorks.test.ts`, `fetchRankedWorks.test.ts` (fake fetch). Check that the scripts tests cover `seed-catalog.mjs --status`, and extend them if they do.

- [ ] **Step 1: Write failing tests:**
  - `rankedWorksUrl("por", 0, 1000, "978972")` has `q=isbn:978972*`, `lang=por` and `sort=readinglog`.
  - Parsing with prefix `978989` keeps an edition with no `language` field, and drops an edition whose ISBNs are all `97885…`.
  - With prefix `978972`, it picks `9789722365598` over `9722365592`.
  - `collectRanked("por")` asks both prefixes and merges by readers. A work found under both appears once.
- [ ] **Step 2:** Run and watch them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Typecheck and the full backend suite.
- [ ] **Step 5: Commit.** Message: `Seed Portugal editions instead of any Portuguese-language edition`. The body says the old `language:por` list was 155 Brazilian to 29 Portugal editions in the 200-book trial sample, and 684 Portugal editions out of 5,000.

---

### Task 3: Publisher cover importer

**Files:**
- Create: `backend/src/modules/books/seed/publishers.ts`: `PUBLISHERS: PublisherSite[]`, the 12 sites from Decisions. `interface PublisherSite { name: string; origin: string; platform: "shopify" | "woocommerce"; authorFromVendor: boolean }`.
- Create: `backend/src/modules/books/seed/publisherFeed.ts`. Exports:
  - `findPortugalIsbn(text: string): string | null`
  - `parseShopifyProducts(json: unknown, site: PublisherSite): PublisherBook[]` and `parseWooProducts(json: unknown, site: PublisherSite): PublisherBook[]`, with `interface PublisherBook { isbn: string; title: string; author: string | null; imageUrl: string; productUrl: string }`. Products without an image or a Portugal ISBN are dropped.
  - `feedUrl(site: PublisherSite, page: number): string`
  - `parseRobots(text: string): { disallow: string[]; crawlDelayMs: number | null }`, for the `User-agent: *` group only.
- Create: `backend/src/modules/books/seed/importPublisherCovers.ts`:
  - `importPublisherCovers(deps, sites, options: { dryRun: boolean }): Promise<Record<string, SiteReport>>`
  - `deps`:
    - `fetchText(url): Promise<{ status: number; text: string }>`
    - `fetchBytes(url): Promise<Buffer | null>`
    - `lookupOpenLibrary(isbn): Promise<{ title: string; author: string } | null>`
    - `repo`, `blobs`, `now`, `sleep`, `log`
  - `SiteReport = { skipped?: string; products: number; books: number; coversSet: number; created: number; noAuthor: number; unchanged: number; rejectedImage: number; failed: number }`
  - `failed` counts books whose image fetch threw `SourceUnavailableError`. Other errors propagate.
- Modify: `backend/src/modules/books/booksService.ts`. Move `storeImage` to an exported module-level `storeCoverImage(deps: { repo, blobs }, bookId, source, sourceUrl, image, at)`, and use it from both places.
- Modify: `backend/src/modules/books/seed/seedCatalog.ts`. Extract the per-entry body into an exported `seedBook(input: { isbn, title, author }, repo, now): "created" | "existing" | "invalid"`, used by `seedCatalog` and the importer.
- Modify: `backend/src/modules/books/domain/types.ts`: add `"publisher"` to `CoverSourceName`. `cover_images.source` is plain TEXT, so no migration is needed.
- Create: `backend/scripts/import-publisher-covers.mjs`.
  - Plain ESM, built like `seed-catalog.mjs`. It imports `dist`.
  - It builds `deps` from `fetch` (UA and 30 s timeout), `encodeCover`, the sqlite repository (`openBooksDb`), and `createObjectStore()` saving `covers/<id>.webp`.
  - Flags: `--dry-run`. It prints one JSON report.
- Create: fixtures `backend/src/modules/books/seed/fixtures/shopify-products.json` and `woo-products.json`. Trim them from real responses (Antígona, Relógio d'Água) to 3 products each, and add one product with a Brazilian ISBN and one with no ISBN.
- Test: `publisherFeed.test.ts`, `importPublisherCovers.test.ts`.

- [ ] **Step 1: Probe the 12 feeds**, one request each, ≥3 s apart. Use page 1 with a small page size and the user agent from Decisions, and record per site:
  - JSON or not;
  - how many products show a Portugal ISBN;
  - whether `vendor` is an author.

  Set `authorFromVendor` true only when, on page 1, ≥80% of products with an ISBN have a `vendor` that differs from the publisher's name. Drop sites whose feed isn't JSON from `PUBLISHERS`, and list them in the report with the reason.
- [ ] **Step 2: Write failing tests:**
  - **`findPortugalIsbn`:**
    - hyphenated `978-972-608-467-9`, dotted `978.989.9061.31.6`, and inside a file name `9789897837579-scaled.jpg`;
    - a bad checksum gives null;
    - `9788535206234` alone gives null;
    - a text with a Brazilian ISBN first and a Portugal ISBN second gives the Portugal one.
  - **Parsers on the fixtures:** the drop rules, `productUrl`, and `author` from the vendor only when the site allows it.
  - **`parseRobots`:** picks the `*` group, `Disallow` prefixes and `Crawl-delay`.
  - **`importPublisherCovers` with fakes:**
    - an existing book gets the cover, with status `manual`, source `publisher` and the upgrade mark cleared;
    - an `upload` cover is untouched;
    - a second run is `unchanged` with no new image row;
    - a sub-400 image is used only when the book has no cover;
    - a new book takes the vendor author;
    - a new book without a vendor takes Open Library's title and author;
    - neither gives `noAuthor` and no book row;
    - a robots disallow of the feed path skips the site with a reason and no feed request;
    - a non-JSON feed skips the site;
    - `dryRun` writes nothing and fetches no image;
    - the wait between one site's requests is `max(3000, crawl delay)`.
- [ ] **Step 3:** Run and watch them fail.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Typecheck, the full backend suite, and `npm run build` in `backend`, then `node scripts/import-publisher-covers.mjs --dry-run` locally against a dev DB with `COVERS_DB_PATH` pointed at a scratch file. Paste the report into the task report.
- [ ] **Step 6: Commit.** Message: `Import covers from Portuguese publishers' own shops`. The body says why: these editions are weakest on Apple and ISBNdb, and their covers aren't bound by ISBNdb's delete-on-lapse terms.

---

### Task 4: Docs

- [ ] `backend/README.md`:
  - **Books section:**
    - the ISBNdb gate and its pause rules;
    - `ALERT_EMAIL`;
    - the `publisher` source and the fact that it's stored as `manual`.
  - **Seeding section:**
    - Portugal editions;
    - the run order (importer `--dry-run`, importer, seed) with the exact `railway ssh` commands in the existing `-- sh -c` form;
    - the publisher list and politeness rules;
    - **takedown:** how to remove one publisher's covers. List the image ids with `source = 'publisher' AND source_url LIKE '<cdn or origin>%'`, delete the R2 objects, clear the pointers and delete the rows, the same way as the ISBNdb deletion steps.
  - **Known limitations:** the seed's ISBNdb gap-filling takes about 2–3 days at 5,000 a day.
- [ ] Commit: `Document the ISBNdb pause, Portugal seed and publisher importer`.
