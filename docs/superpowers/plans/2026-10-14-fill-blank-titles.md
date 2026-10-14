# Fill Blank Catalog Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 17,944 blank catalog books (title and author both empty, all created by the publisher importer) their shop titles so search can find them, and stop the importer from creating blank books.

**Architecture:** Three changes, in task order:
1. **Identity rules.** `fillIdentity` fills a blank title or a blank author independently, so a book with a title still gets its author from a later lookup. A title-only identity never claims the authorless `ta:<title>||` lookup key.
2. **Importer.** When neither the shop nor Open Library gives an author, the importer keeps the shop's title (author stays empty) instead of blanking both.
3. **One-off fill.** A new `--fill-titles` mode of `import-publisher-covers.mjs` re-reads each shop's product feed and fills every blank book whose `publisher_url` matches a feed product's URL. It reads feed pages only (no product pages, no images), and covers are never touched.

`fillIdentity` already adds the book to search in the same transaction, and an empty author gives an empty `title_key`, so nothing groups these books into works by title until they have an author.

**Tech Stack:** TypeScript, `node:sqlite`, `node:test`.

**Spec:** this plan carries the design (no separate spec). The production measurements are in the Background section.

## Background (measured in production 2026-10-14)

- **Totals.** 17,944 of 77,927 books have `title = ''` and `author = ''`.
  - 17,942 have `created_by = 'publisher'`.
  - 16,064 were created 2026-10-02, 1,790 on 10-03, and 88 since.
  - Every one has a `work_id` whose work is also untitled (only 2 works have a title).
  - 16,012 have a publisher cover and 17,021 a publisher synopsis.
  - 0 are in `books_search`.
- **By shop (`publisher_url` host):** Penguin 5,601, Presença 3,866, Relógio d'Água 1,951, Gradiva 1,212, Afrontamento 1,207, Guerra & Paz 974, Exclamação 940, Saída de Emergência 888, INCM 662, Orfeu Negro 315, Divergência 212, Kathartika 71, Pato Lógico 42, Abysmo 1, none 2.
  - WooCommerce shops' permalinks can use a different host than `PUBLISHERS[].origin` (e.g. `www.exclamacao.pt` vs `https://exclamacao.pt`). That is why matching is by exact product URL, never by origin prefix.
- **Cause.** `importPublisherCovers.ts:229-249` blanks title and author when neither the feed nor Open Library has an author. Commit a11bac82 expected "the first user lookup fills title and author via fillIdentity".
  - Search (2026-10-13) only indexes books with a title, so that lookup never comes.
  - `fillIdentity` today only acts on `title = ''` (`sqliteBooksRepository.ts:52`), so a book given a title but no author could never get its author later. Task 1 fixes that.
- **`publisher_url`.** Set from the feed product's `productUrl` (`importPublisherCovers.ts:~254`, `setPublisherUrl` fills only a NULL), for feed and page matches alike. Exact equality with `productUrl` therefore finds the product.
- **Grouping safety.**
  - `workTitleKey(title, "")` is `""` (`normalize.ts:98-100`), and title-based work grouping (`groupablePairsStmt`, `sqliteBooksRepository.ts:96-127`) needs `title_key <> ''`. So title-only books never group.
  - The one leak is the lookup key. `catalogTitleKey(title, "")` is `ta:<title>||`, and `seedBook` (`seedCatalog.ts:23-30`) and `findOrCreateBook` (`findOrCreate.ts:33`) add it to a book when it's free. Then `findByIdentity` callers (e.g. `publicCoverLookup.ts:38/49`) would resolve a different ISBN-less "Poemas" lookup to that book. Task 1 stops catalog paths adding an authorless title key.

## Global Constraints

- No new dependencies. No comments in code. Minimum code: reuse `parseShopifyProducts` / `parseWooProducts`, `feedUrl`, robots handling and the throttle that the importer already has. Never write a second feed parser.
- New `*.test.ts` files must be added to the explicit list in `backend/package.json`'s `test` script.
- Never write `catalogTitleKey` into `books.title_key`. Title keys for works always come from `workTitleKey`, which is `""` without an author.
- Shops are read at the importer's pace: at least `MIN_WAIT_MS` (3000 ms) between requests to one shop, and the robots.txt crawl delay if it is higher. Respect robots `Disallow` for the feed.
- **Production writes run by the user.** The production steps (Task 5) run over `railway ssh`, and the user runs them; Claude Code's auto-mode classifier blocks Claude from running them. The code must be deployed first (`gh workflow run deploy.yml -f sha=<main tip>`).
- Backend verify: `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace backend`, `npm test --workspace backend`.

## Review Focus

1. **Generic titles stay apart.** Two different ISBNs both titled "Poemas" with no author must stay two books in two works, neither claiming `ta:poemas||`. Task 1 and Task 2 tests.
2. **Never overwrite.** `fillIdentity` never overwrites a non-empty title or author; it fills only the blank part. Task 1 test.
3. **Feed author fills too.** A blank book whose feed product now has an author gets both, and becomes groupable (non-empty `title_key`). Task 3 test.
4. **Vanished products.** A blank book whose product no longer appears in any feed stays blank. The run reports how many are left, and that is not an error. Task 3 test.
5. **Unreadable shops are skipped.** A shop whose robots.txt or feed fails is reported as skipped with the reason, and the other shops still run. Task 3 test.

---

### Task 1: Fill title and author independently, and never claim an authorless title key

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` (`fillIdentityStmt` line 52, `fillIdentity` lines 307-313)
- Modify: `backend/src/modules/books/seed/seedCatalog.ts` (lines 20-30)
- Modify: `backend/src/modules/books/domain/findOrCreate.ts` (lines 33-37)
- Modify: `backend/src/modules/books/booksService.ts` (line 177, in `saveHits`)
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`, `backend/src/modules/books/seed/seedCatalog.test.ts`

**Interfaces:**
- Produces: `fillIdentity(id: string, title: string, author: string): void` keeps its signature. It now sets the title only if the stored title is `''` and the author only if the stored author is `''`. It recomputes `title_key` from the resulting pair with `workTitleKey`, then fills the work's blank title or author and makes the book searchable if confirmed, as today. It does nothing if neither is blank.
- `seedBook` and `findOrCreateBook` call `fillIdentity` when the stored title is blank and a title is given, or when the stored author is blank and an author is given. They add `identity.titleKey` as a lookup key only when `identity.author` is non-empty.

- [ ] **Step 1: Write the failing tests**

In `sqliteBooksRepository.test.ts`, add tests next to the existing `fillIdentity` tests (around lines 589-605 and 846-871). They use that file's existing setup helpers for an in-memory repo; check the nearby tests for the exact helper names and the `createBook` input shape.

```ts
test("fillIdentity gives a titled book with no author its author, and keeps the title", () => {
  const repo = createRepo();
  const book = repo.createBook({ title: "Hamlet", author: "", isbn: "9789896414672", createdBy: "publisher" }, ["isbn:9789896414672"], "2026-10-14T00:00:00.000Z");
  repo.fillIdentity(book.id, "Hamlet: edição bilingue", "William Shakespeare");
  const row = repo.getBook(book.id)!;
  assert.equal(row.title, "Hamlet");
  assert.equal(row.author, "William Shakespeare");
  assert.notEqual(row.title_key, "");
});

test("fillIdentity never overwrites a title or author that is already there", () => {
  const repo = createRepo();
  const book = repo.createBook({ title: "Hamlet", author: "William Shakespeare", isbn: "9789896414672", createdBy: "publisher" }, ["isbn:9789896414672"], "2026-10-14T00:00:00.000Z");
  repo.fillIdentity(book.id, "Other", "Someone");
  const row = repo.getBook(book.id)!;
  assert.equal(row.title, "Hamlet");
  assert.equal(row.author, "William Shakespeare");
});

test("fillIdentity with a title and no author makes a blank book searchable without a work title key", () => {
  const repo = createRepo();
  const book = repo.createBook({ title: "", author: "", isbn: "9789896414672", createdBy: "publisher" }, ["isbn:9789896414672"], "2026-10-14T00:00:00.000Z");
  repo.fillIdentity(book.id, "Hamlet", "");
  const row = repo.getBook(book.id)!;
  assert.equal(row.title, "Hamlet");
  assert.equal(row.author, "");
  assert.equal(row.title_key, "");
  assert.equal(repo.isSearchable(book.id), true);
});
```

In `seedCatalog.test.ts`, add the following. Use the file's existing in-memory repo setup, and check lines 75-99 for how those tests build the repo and `now`.

```ts
test("two authorless books with the same title stay separate and neither claims the title key", () => {
  const { repo, now } = setup();
  const first = seedBook({ isbn: "9789720000011", title: "Poemas", author: "" }, repo, now, "publisher").book!;
  const second = seedBook({ isbn: "9789720000028", title: "Poemas", author: "" }, repo, now, "publisher").book!;
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.work_id, second.work_id);
  assert.equal(repo.findBookByKey("ta:poemas||"), undefined);
});

test("a blank seeded book gets the title from a later seed, then the author from another", () => {
  const { repo, now } = setup();
  const blank = seedBook({ isbn: "9789720000011", title: "", author: "" }, repo, now, "publisher").book!;
  seedBook({ isbn: "9789720000011", title: "Poemas", author: "" }, repo, now, "publisher");
  assert.equal(repo.getBook(blank.id)!.title, "Poemas");
  assert.equal(repo.findBookByKey("ta:poemas||"), undefined);
  seedBook({ isbn: "9789720000011", title: "Poemas", author: "Sophia de Mello Breyner Andresen" }, repo, now, "publisher");
  assert.equal(repo.getBook(blank.id)!.author, "Sophia de Mello Breyner Andresen");
});
```

The ISBNs above must be valid ISBN-13s, or `lookupIdentity` returns no ISBN key. Compute their check digits, or take valid Portuguese ISBNs from existing fixtures in these test files, and keep each test's two ISBNs distinct.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `npm test --workspace backend 2>&1 | rg -n "titled book with no author|never overwrites|without a work title key|stay separate|later seed" -A3`
- Expected: the author-fill and the seedBook tests fail today. `fillIdentity` ignores rows with a title, and `seedBook` adds `ta:poemas||`.
- The "never overwrites" and "searchable" tests may already pass; they guard the change.

- [ ] **Step 3: Implement**

`sqliteBooksRepository.ts`: replace `fillIdentityStmt` and the `fillIdentity` method.

```ts
  const fillIdentityStmt = db.prepare(`UPDATE books SET title = ?, author = ?, title_key = ? WHERE id = ? AND (title = '' OR author = '')`);
```

```ts
    fillIdentity(id, title, author) {
      inTransaction(() => {
        const row = getBookStmt.get(id) as BookRow | undefined;
        if (!row || (row.title !== "" && row.author !== "")) return;
        const nextTitle = row.title || title;
        const nextAuthor = row.author || author;
        if (nextTitle === row.title && nextAuthor === row.author) return;
        fillIdentityStmt.run(nextTitle, nextAuthor, nextTitle ? workTitleKey(nextTitle, nextAuthor) : null, id);
        fillWorkIdentityStmt.run(id);
        makeSearchableIfConfirmed(id);
      });
    },
```

Use whatever prepared statement this file already uses to read one book by id; it may not be called `getBookStmt`. Don't add a second one.

`seedCatalog.ts`, the existing-book branch and the new-book keys:

```ts
  if (existing) {
    repo.setWorkKey(existing.id, input.workKey);
    repo.setLanguage(existing.id, language);
    if ((!existing.title && identity.title) || (!existing.author && identity.author)) {
      if (identity.author && identity.titleKey && !repo.findBookByKey(identity.titleKey)) repo.addKey(identity.titleKey, existing.id);
      repo.fillIdentity(existing.id, identity.title, identity.author);
    }
    return { outcome: "existing", book: existing };
  }
  const titleKey = identity.author ? identity.titleKey : null;
  const keys = titleKey && titleKey !== identity.key && !repo.findBookByKey(titleKey) ? [identity.key, titleKey] : [identity.key];
```

(The `const { titleKey } = identity;` line is replaced by the `const titleKey = …` line above.)

`findOrCreate.ts`, lines 33-37:

```ts
  if ((!existing.title && identity.title) || (!existing.author && identity.author)) {
    if (identity.author && identity.titleKey) repo.addKey(identity.titleKey, existing.id);
    repo.fillIdentity(existing.id, identity.title, identity.author);
    return repo.getBook(existing.id) ?? existing;
  }
```

`booksService.ts:177`:

```ts
      if (!book.title || !book.author) deps.repo.fillIdentity(book.id, result.title, author);
```

- [ ] **Step 4: Run the whole backend suite**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
- Expected: all pass. Existing tests at `sqliteBooksRepository.test.ts:846-871` (authorless `title_key ""`) and `seedCatalog.test.ts:75-99` must still pass unchanged.
- If an existing test asserted that a titled book is *not* filled, report it rather than editing it silently.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/seed/seedCatalog.ts backend/src/modules/books/seed/seedCatalog.test.ts backend/src/modules/books/domain/findOrCreate.ts backend/src/modules/books/booksService.ts && git commit -m "$(cat <<'EOF'
Fill a book's title and author independently, and keep title-only books apart

fillIdentity only acted on books with no title, so a book given a title but no
author could never get its author from a later lookup. It now fills whichever
part is blank and never overwrites either.

A title with no author made a lookup key such as ta:poemas||, and the first
authorless "Poemas" claimed it, so a different ISBN-less "Poemas" lookup
resolved to that book. Catalog paths now add a title key only when there is
an author.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The importer keeps the shop title when no author is found

**Files:**
- Modify: `backend/src/modules/books/seed/importPublisherCovers.ts` (lines ~232-242)
- Test: `backend/src/modules/books/seed/importPublisherCovers.test.ts` (tests at ~269-282 "a book with no author anywhere is still created, blank, and gets its cover", and ~817-827 "a work key with no author still lands on the blank row")

**Interfaces:**
- Consumes: Task 1's `seedBook`, which no longer adds an authorless title key.
- Produces: a new book with no author anywhere is created with `title` = the shop product's title and `author = ""`. The `noAuthor` report counter keeps counting these.

- [ ] **Step 1: Update the two existing tests to the new behaviour (they become the failing tests)**

Rename "a book with no author anywhere is still created, blank, and gets its cover" to "a book with no author anywhere keeps the shop title, gets its cover and is searchable". Change its assertions from `row.title === ""` to `row.title` equal to that fixture product's title (read it from the test's feed fixture). Keep `row.author === ""` and the cover assertions, and add `assert.equal(h.repo.isSearchable(row.id), true)`.

Do the same in "a work key with no author still lands on the blank row": expect the shop title, `author ""`, and keep the work-key assertion. Rename it to "a work key with no author lands on the titled row".

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test --workspace backend 2>&1 | rg -n "keeps the shop title|lands on the titled row" -A4`
Expected: FAIL with `title` `""`.

- [ ] **Step 3: Implement**

In the `if (!row)` block, stop blanking the title:

```ts
        if (result.edition?.author) {
          title = result.edition.title ?? title;
          author = result.edition.author;
        } else {
          report.noAuthor++;
          author = "";
        }
```

(Only `title = "";` is removed.)

- [ ] **Step 4: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/seed/importPublisherCovers.ts backend/src/modules/books/seed/importPublisherCovers.test.ts && git commit -m "$(cat <<'EOF'
Keep the shop's title when the importer finds no author

A book with no author anywhere was created with both title and author blank,
waiting for a user lookup to fill them. Search only indexes titled books, so
that lookup never came: 17,944 catalog books were unfindable. The title is
known from the shop, so keep it; the author stays empty until a lookup fills
it, and an empty author keeps the book out of title-based work grouping.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `--fill-titles`, which fills blank books from the shop feeds

**Files:**
- Modify: `backend/src/modules/books/seed/importPublisherCovers.ts` (extract the robots and feed loop from `importSite`, lines ~93-136, into exported functions; export `SiteSkipped`)
- Create: `backend/src/modules/books/seed/fillBlankTitles.ts`
- Create: `backend/src/modules/books/seed/fillBlankTitles.test.ts`
- Modify: `backend/src/modules/books/domain/ports.ts` (add `listBlankTitled`) and `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts` (implement it)
- Modify: `backend/scripts/import-publisher-covers.mjs` (add `--fill-titles`)
- Modify: `backend/package.json` (`test` list: add `src/modules/books/seed/fillBlankTitles.test.ts`)
- Modify: `backend/README.md` (the importer section: one line for `--fill-titles`)

**Interfaces:**
- Consumes: Task 1's `fillIdentity`.
- Produces (in `importPublisherCovers.ts`, exported):
  ```ts
  export class SiteSkipped extends Error {}
  export interface Throttle { request<T>(call: () => Promise<T>): Promise<T>; slowTo(ms: number): void }
  export function createThrottle(sleep: (ms: number) => Promise<void>): Throttle
  export interface SiteFeed { books: PublisherBook[]; disallow: string[]; products: number }
  export async function readSiteFeed(site: PublisherSite, fetchText: ImportDeps["fetchText"], throttle: Throttle): Promise<SiteFeed>
  ```
  `readSiteFeed` throws `SiteSkipped` (robots refused, feed not JSON, no end, and so on) or `SourceUnavailableError`, exactly as the extracted block does today. `importSite` must behave identically after the extraction.
- Produces (repository): `listBlankTitled(): Array<{ id: string; publisher_url: string }>`. These are books with `title = ''` and a non-null `publisher_url`.
- Produces (`fillBlankTitles.ts`):
  ```ts
  export interface TitleFillSiteReport { products: number; matched: number; filled: number; skipped?: string }
  export interface TitleFillReport { sites: Record<string, TitleFillSiteReport>; blankBefore: number; leftBlank: number }
  export async function fillBlankTitles(
    deps: { fetchText: ImportDeps["fetchText"]; sleep: (ms: number) => Promise<void>; repo: Pick<BooksRepository, "listBlankTitled" | "fillIdentity"> },
    sites: PublisherSite[],
    options: { dryRun: boolean }
  ): Promise<TitleFillReport>
  ```

**Behaviour:**
- **Matching.** Load the blank books once into a `Map` keyed by `publisher_url`. For each site in order, read its feed with `readSiteFeed`. For every feed book whose `productUrl` is in the map, count it as `matched` and remove it from the map. Unless `dryRun`, call `fillIdentity(id, book.title, book.author)` and count `filled`.
- **What's read.** Feeds are read whether or not the product has an ISBN. Product pages and images are never fetched.
- **Failures.** A site that throws `SiteSkipped` or `SourceUnavailableError` gets `skipped: error.message`, and the next site runs. Any other error propagates.
- **Totals.** `blankBefore` is the map's size at the start. `leftBlank` is its size at the end: books whose product wasn't found in any feed read.

- [ ] **Step 1: Write the failing tests** in `fillBlankTitles.test.ts`

Copy the env preamble and dynamic-import pattern from the top of `importPublisherCovers.test.ts`, since `connection.js` loads `config/env.ts`. Then:

```ts
const SHOP: PublisherSite = { name: "Test Shop", origin: "https://shop.test", platform: "shopify", authorFromVendor: false };
const OTHER: PublisherSite = { name: "Other Shop", origin: "https://other.test", platform: "shopify", authorFromVendor: false };

function product(handle: string, title: string, isbn: string | null) {
  return { title, handle, vendor: "Test Shop", body_html: "", variants: [{ barcode: isbn ?? "", sku: "" }], images: [{ src: `https://shop.test/files/${handle}.jpg` }] };
}

function setup(feeds: Record<string, { status: number; text: string } | Error>) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const requested: string[] = [];
  const deps = {
    repo,
    sleep: async () => {},
    fetchText: async (url: string) => {
      requested.push(url);
      const entry = feeds[url];
      if (entry instanceof Error) throw entry;
      if (entry) return entry;
      if (url.endsWith("/robots.txt")) return { status: 404, text: "" };
      return { status: 200, text: JSON.stringify({ products: [] }) };
    },
  };
  const blank = (isbn: string, url: string) => {
    const book = repo.createBook({ title: "", author: "", isbn, createdBy: "publisher" }, [`isbn:${isbn}`], "2026-10-02T00:00:00.000Z");
    repo.setPublisherUrl(book.id, url);
    return book.id;
  };
  return { repo, deps, requested, blank };
}

const page1 = (products: unknown[]) => ({ status: 200, text: JSON.stringify({ products }) });

test("a blank book gets the title of the feed product at its publisher_url and becomes searchable", async () => {
  const h = setup({ "https://shop.test/products.json?limit=250&page=1": page1([product("hamlet", "Hamlet", "9789896414672")]) });
  const id = h.blank("9789896414672", "https://shop.test/products/hamlet");
  const report = await fillBlankTitles(h.deps, [SHOP], { dryRun: false });
  assert.deepEqual(report, { sites: { "Test Shop": { products: 1, matched: 1, filled: 1 } }, blankBefore: 1, leftBlank: 0 });
  assert.equal(h.repo.getBook(id)!.title, "Hamlet");
  assert.equal(h.repo.getBook(id)!.author, "");
  assert.equal(h.repo.isSearchable(id), true);
});

test("a product with no ISBN in the feed still fills the book at its URL, without fetching the page", async () => {
  const h = setup({ "https://shop.test/products.json?limit=250&page=1": page1([product("moby-dick", "Moby Dick", null)]) });
  const id = h.blank("9789897022647", "https://shop.test/products/moby-dick");
  await fillBlankTitles(h.deps, [SHOP], { dryRun: false });
  assert.equal(h.repo.getBook(id)!.title, "Moby Dick");
  assert.ok(!h.requested.includes("https://shop.test/products/moby-dick"));
});

test("a dry run counts matches and writes nothing", async () => {
  const h = setup({ "https://shop.test/products.json?limit=250&page=1": page1([product("hamlet", "Hamlet", "9789896414672")]) });
  const id = h.blank("9789896414672", "https://shop.test/products/hamlet");
  const report = await fillBlankTitles(h.deps, [SHOP], { dryRun: true });
  assert.deepEqual(report.sites["Test Shop"], { products: 1, matched: 1, filled: 0 });
  assert.equal(h.repo.getBook(id)!.title, "");
});

test("a blank book whose product is gone stays blank and is counted", async () => {
  const h = setup({ "https://shop.test/products.json?limit=250&page=1": page1([product("hamlet", "Hamlet", "9789896414672")]) });
  const gone = h.blank("9789722379915", "https://shop.test/products/a-tranca");
  const report = await fillBlankTitles(h.deps, [SHOP], { dryRun: false });
  assert.equal(report.leftBlank, 1);
  assert.equal(h.repo.getBook(gone)!.title, "");
});

test("a shop whose feed fails is skipped with the reason, and the next shop still runs", async () => {
  const h = setup({
    "https://shop.test/products.json?limit=250&page=1": { status: 503, text: "" },
    "https://other.test/products.json?limit=250&page=1": page1([{ ...product("hamlet", "Hamlet", "9789896414672"), images: [{ src: "https://other.test/files/hamlet.jpg" }] }]),
  });
  const id = h.blank("9789896414672", "https://other.test/products/hamlet");
  const report = await fillBlankTitles(h.deps, [SHOP, OTHER], { dryRun: false });
  assert.ok(report.sites["Test Shop"]!.skipped);
  assert.equal(h.repo.getBook(id)!.title, "Hamlet");
});

test("a feed product with an author fills both, so the book can group into a work", async () => {
  const site = { ...SHOP, authorFromVendor: true };
  const h = setup({ "https://shop.test/products.json?limit=250&page=1": page1([{ ...product("hamlet", "Hamlet", "9789896414672"), vendor: "William Shakespeare" }]) });
  const id = h.blank("9789896414672", "https://shop.test/products/hamlet");
  await fillBlankTitles(h.deps, [site], { dryRun: false });
  const row = h.repo.getBook(id)!;
  assert.equal(row.author, "William Shakespeare");
  assert.notEqual(row.title_key, "");
});
```

Check the fixtures against `parseShopifyProducts` (`publisherFeed.ts:206-228`). If it needs other fields for a product to count, such as a variant `id` or image `width`, add them to `product()`. If a 503 surfaces as a thrown `SourceUnavailableError` from the real `fetchText` rather than a status, keep the test's status-503 path anyway: `readSiteFeed` turns a non-200 feed status into `SiteSkipped`.

- [ ] **Step 2: Run them and confirm they fail**

Add the file to `backend/package.json`'s `test` list. Then run `npm test --workspace backend 2>&1 | rg -n "fillBlankTitles|Cannot find module" | head`.
Expected: fails because `./fillBlankTitles.js` doesn't exist.

- [ ] **Step 3: Extract the feed reading in `importPublisherCovers.ts`**

Export `SiteSkipped` (add `export` to its class declaration). Add these next to `createExclusive`:

```ts
export interface Throttle {
  request<T>(call: () => Promise<T>): Promise<T>;
  slowTo(ms: number): void;
}

export function createThrottle(sleep: (ms: number) => Promise<void>): Throttle {
  let waitMs = MIN_WAIT_MS;
  let requested = false;
  return {
    async request(call) {
      if (requested) await sleep(waitMs);
      requested = true;
      return call();
    },
    slowTo(ms) {
      waitMs = Math.max(MIN_WAIT_MS, ms);
    },
  };
}

export interface SiteFeed {
  books: PublisherBook[];
  disallow: string[];
  products: number;
}

export async function readSiteFeed(site: PublisherSite, fetchText: ImportDeps["fetchText"], throttle: Throttle): Promise<SiteFeed> {
  const robots = await throttle.request(() => fetchText(`${site.origin}/robots.txt`));
  if (robots.status !== 200 && robots.status !== 404) throw new SiteSkipped(`robots.txt answered HTTP ${robots.status}`);
  const rules = robots.status === 200 ? parseRobots(robots.text) : { disallow: [], crawlDelayMs: null };
  const feed = new URL(feedUrl(site, 1));
  if (isDisallowed(feed.pathname + feed.search, rules.disallow)) throw new SiteSkipped("robots.txt disallows the feed");
  throttle.slowTo(rules.crawlDelayMs ?? 0);
  const books: PublisherBook[] = [];
  let products = 0;
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new SiteSkipped("feed has no end");
    const response = await throttle.request(() => fetchText(feedUrl(site, page)));
    if (response.status === 400 && page > 1) break;
    if (response.status !== 200) throw new SiteSkipped(`feed answered HTTP ${response.status}`);
    let json: unknown;
    try {
      json = JSON.parse(response.text);
    } catch (error) {
      if (error instanceof SyntaxError) throw new SiteSkipped("feed is not JSON");
      throw error;
    }
    const listed = feedProducts(json, site);
    if (!listed) throw new SiteSkipped("feed is not a product list");
    if (listed.length === 0) break;
    products += listed.length;
    books.push(...(site.platform === "shopify" ? parseShopifyProducts(json, site) : parseWooProducts(json, site)));
  }
  return { books, disallow: rules.disallow, products };
}
```

Then the start of `importSite` becomes:

```ts
  const report = emptyReport();
  const throttle = createThrottle(deps.sleep);
  const request = throttle.request;
  let feed: SiteFeed;
  try {
    feed = await readSiteFeed(site, deps.fetchText, throttle);
  } catch (error) {
    if (error instanceof SiteSkipped || error instanceof SourceUnavailableError) return { ...emptyReport(), skipped: error.message };
    throw error;
  }
  report.products = feed.products;
  const { books, disallow } = feed;
```

The rest of `importSite` (`readPage`, which uses `request`, and everything after it) stays the same. `throttle.request` is a method on an object literal that doesn't use `this`, so taking it as `const request = throttle.request` is safe. The whole existing `importPublisherCovers.test.ts` suite must pass unchanged; it is the proof that the extraction preserved behaviour.

- [ ] **Step 4: Add `listBlankTitled` to the repository**

`ports.ts`, in `BooksRepository`:

```ts
  listBlankTitled(): Array<{ id: string; publisher_url: string }>;
```

`sqliteBooksRepository.ts`, a prepared statement beside the others, and the method:

```ts
  const blankTitledStmt = db.prepare(`SELECT id, publisher_url FROM books WHERE title = '' AND publisher_url IS NOT NULL`);
```

```ts
    listBlankTitled() {
      return blankTitledStmt.all() as Array<{ id: string; publisher_url: string }>;
    },
```

If any other class implements `BooksRepository` (a fake or in-memory repo in tests), typecheck will name it. Add the same method there, returning the blank-titled rows it holds.

- [ ] **Step 5: Implement `fillBlankTitles.ts`**

```ts
import type { BooksRepository } from "../domain/ports.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { createThrottle, readSiteFeed, SiteSkipped, type ImportDeps } from "./importPublisherCovers.js";
import type { PublisherSite } from "./publishers.js";

export interface TitleFillSiteReport {
  products: number;
  matched: number;
  filled: number;
  skipped?: string;
}

export interface TitleFillReport {
  sites: Record<string, TitleFillSiteReport>;
  blankBefore: number;
  leftBlank: number;
}

export async function fillBlankTitles(
  deps: { fetchText: ImportDeps["fetchText"]; sleep: (ms: number) => Promise<void>; repo: Pick<BooksRepository, "listBlankTitled" | "fillIdentity"> },
  sites: PublisherSite[],
  options: { dryRun: boolean }
): Promise<TitleFillReport> {
  const blank = new Map(deps.repo.listBlankTitled().map((row) => [row.publisher_url, row.id]));
  const blankBefore = blank.size;
  const reports: Record<string, TitleFillSiteReport> = {};
  for (const site of sites) {
    const report: TitleFillSiteReport = { products: 0, matched: 0, filled: 0 };
    reports[site.name] = report;
    try {
      const feed = await readSiteFeed(site, deps.fetchText, createThrottle(deps.sleep));
      report.products = feed.products;
      for (const book of feed.books) {
        const id = blank.get(book.productUrl);
        if (!id) continue;
        blank.delete(book.productUrl);
        report.matched++;
        if (options.dryRun) continue;
        deps.repo.fillIdentity(id, book.title, book.author);
        report.filled++;
      }
    } catch (error) {
      if (!(error instanceof SiteSkipped || error instanceof SourceUnavailableError)) throw error;
      report.skipped = error.message;
    }
  }
  return { sites: reports, blankBefore, leftBlank: blank.size };
}
```

Match the import paths and type names to the real ones: check where `PublisherSite`, `ImportDeps` and `SourceUnavailableError` are exported from, and export `ImportDeps` if it isn't already. `book.author` is the field `parseShopifyProducts` / `parseWooProducts` produce. If it can be `undefined`, pass `book.author ?? ""`.

- [ ] **Step 6: Add `--fill-titles` to `backend/scripts/import-publisher-covers.mjs`**

Add the option to `parseArgs`: `"fill-titles": { type: "boolean", default: false }`. Import `fillBlankTitles` the way the script imports `importPublisherCovers`:

```js
const { fillBlankTitles } = await import("../dist/modules/books/seed/fillBlankTitles.js");
```

Before the `importPublisherCovers` call (after `sites` is computed), add:

```js
if (values["fill-titles"]) {
  const repo = createSqliteBooksRepository(openBooksDb());
  const report = await fillBlankTitles({ fetchText, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), repo }, sites, { dryRun: values["dry-run"] });
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
```

Reuse the script's existing `fetchText`, `openBooksDb` and `createSqliteBooksRepository` bindings; don't redeclare them. If the script already builds the repository before this point, reuse that instance instead of opening the DB a second time.

`README.md`, in the importer section, add one line: `--fill-titles` re-reads each shop's product feed (feed pages only, no product pages or images) and fills the title, and the author if the feed has one, of every catalog book with an empty title whose `publisher_url` is a feed product's URL. With `--dry-run` it only counts; `--site` limits it to one shop.

- [ ] **Step 7: Verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && node --check backend/scripts/import-publisher-covers.mjs`
- Expected: all pass, including the unchanged `importPublisherCovers.test.ts` suite.
- Then a local smoke test with the backend built (`npm run build --workspace backend`) against a scratch DB. Use the env preamble the backend tests use, with `COVERS_DB_PATH` pointing at a temp file: `node backend/scripts/import-publisher-covers.mjs --fill-titles --dry-run --site Nope` exits 1, listing site names.
- Don't run it against real shops.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/books/seed/importPublisherCovers.ts backend/src/modules/books/seed/fillBlankTitles.ts backend/src/modules/books/seed/fillBlankTitles.test.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/scripts/import-publisher-covers.mjs backend/package.json backend/README.md && git commit -m "$(cat <<'EOF'
Fill blank catalog titles from the shop feeds

17,944 publisher-created books have no title, so search can't find them. Each
records the shop product it came from in publisher_url, and that product's
title is in the shop's feed. --fill-titles reads only the feed pages (minutes,
not the hours product pages take), matches books by exact product URL (a
WooCommerce permalink's host can differ from the shop's configured origin), and
fills the title through fillIdentity, which indexes the book for search.
Covers are not touched.

The feed reading moves out of importSite into readSiteFeed so both paths read
shops the same way, at the same pace and under the same robots rules.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Ship and deploy

- [ ] **Step 1:** Run the `ship` skill: PR to `main` with auto-merge.
- [ ] **Step 2:** After merge, deploy `gh workflow run deploy.yml -f sha=<main tip>` (the user asked for deploys to be run for them in this thread; confirm again if this runs in a new session). Confirm the Railway deployment reached `SUCCESS` with the Railway MCP `list-deployments` and `get-logs` (project `404b0e4a-701b-47ea-83fc-a82a80ae5094`, service `4fda553d-dff6-4b9c-8dd3-77ada1f5e4f0`).

---

### Task 5: Production run (commands run by the user; Claude reads the output)

Prefix: `npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c '…'`

- [ ] **Step 1: Dry run, all shops.** `cd /app/backend && node scripts/import-publisher-covers.mjs --fill-titles --dry-run`
  - About 150 feed pages at 3 s each, roughly 8–15 minutes, so run it in the foreground.
  - Expected: `blankBefore` about 17,942, and `matched` summed over shops close to that. `leftBlank` is the books whose products have gone from the feeds.
  - Look at any `skipped` shop's reason before applying.
- [ ] **Step 2: Apply.** Run the same command without `--dry-run`. Expected: `filled` equals `matched` per shop.
- [ ] **Step 3: Check.** Re-run the read-only empty-title count used on 2026-10-14 (`blank.mjs` in the session scratchpad: total blank, by shop, `inSearch`).
  - Expected: the blank total falls to roughly `leftBlank`.
  - Search a few filled titles in the app ("Hamlet", "Moby Dick").
- [ ] **Step 4:** Update the `catalog-launch-status` memory with the counts.

## Out of scope

- **Authors.** Filling authors (ISBNdb lookups, or per-shop author parsing from product pages) is a separate plan. Once authors land, Task 1 lets `fillIdentity` add them to titled books, and the books then group into works by title and author.
- **Leftover blanks.** The two blank books with no `publisher_url` (created 2026-09-08), and books whose products have gone from the shop feeds, stay blank.
- **Title clean-up.** Shop titles are stored as the feed gives them, e.g. a "Hamlet - Edição de bolso" suffix stays.
