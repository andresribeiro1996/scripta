# Fill Catalog Authors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the publisher-imported books that have a title but no author their author, from the shop's feed tags or its product page, so author search finds them (Pachinko by Min Jin Lee first).

**Architecture:**
1. **Author sources.** Presença's feed carries `NOMEAUTOR_<name>` tags, so it needs no page fetch. Relógio d'Água, Gradiva, Guerra & Paz and Penguin Livros put the main product's author in `<a class='autor_link'>` anchors on the product page, which the importer already fetches for every one of their products, because their feeds carry no ISBN.
2. **The importer repairs on every run.** An existing book with an empty title or author gets the missing part from its product. It never overwrites, and only when the stored title matches the product's. It goes through `seedBook`, so it also gets the title-and-author lookup key.
3. **`--fill-titles` claims the key too.** A shared `fillMissingIdentity` helper replaces the inline copies in `seedBook` and `findOrCreateBook`, and `fillBlankTitles` uses it.
4. **`seed-catalog.mjs --status`** reports blank titles and authors per shop, before and after.
5. **A filled identity reopens the work's code-only "no match" verdict.** The translation backlog can then re-plan it on its next ordinary run. Jev's and the owner's verdicts stay.

There is no new command. The production repair is an importer rerun.

**Tech Stack:** TypeScript, `node:sqlite`, `node:test` via `tsx`.

**Spec:** none separate. This plan carries the design; the evidence is in Background.

## Background (checked 2026-10-15)

- **What's already live.** PR #257 has been live since 2026-10-15 14:45Z:
  - The importer keeps the shop's title when no author is found.
  - `fillIdentity` fills title and author separately, never overwrites, and refreshes the search row (`sqliteBooksRepository.ts:578-590`).
  - `--fill-titles` (`seed/fillBlankTitles.ts`) fills blank titles from the feeds by exact `publisher_url`.
  - Publisher rows are searchable once they have a title: `CONFIRMED_SQL` accepts `created_by IS NOT NULL`, and ISBN search only checks `isSearchable` (`booksService.ts:362-364`).
  - The production counts read on 2026-10-15 still showed 17,944 blank titles, the pre-#257 figure, so `--fill-titles` has most likely not been run yet.
- **What's left.** After `--fill-titles`, almost every one of those books will have a title and no author.
  - Only Antígona (`vendor`) and WooCommerce shops with an `Autor` attribute give an author in the feed, and these books went blank because neither the shop nor Open Library had one.
  - Blank rows by shop on 2026-10-14: Penguin 5,601, Presença 3,866, Relógio d'Água 1,951, Gradiva 1,212, Afrontamento 1,207, Guerra & Paz 974, Exclamação 940, Saída de Emergência 888, INCM 662, Orfeu Negro 315, Divergência 212, Kathartika 71, Pato Lógico 42, Abysmo 1.
- **Presença.** Each author is its own `NOMEAUTOR_<name>` tag; there is also an `AUTOR_<slug>_<name>` duplicate.
  - 748 of 750 books on feed pages 1–3 had one; the 2 without were sticker books.
  - Shopify sorts tags alphabetically, so several authors come in alphabetical order, not credit order. That's accepted.
- **The `autor_link` shops** (Relógio d'Água, Gradiva, Guerra & Paz, Penguin Livros) share one WordPress theme.
  - The main product's author anchors sit after `<main` and before the first related-product card (`class="w-grid-item …"`). Related cards repeat the same anchor class with other authors.
  - Gradiva also uses `autor_link` for translators, with an `/tradutor/` href.
  - Penguin links to `/autores/`, the others to `/autor/`. Penguin renders the product block twice (desktop and mobile), so names must be deduped.
  - On 29 sampled pages, 27 gave the right author (multi-author included). The 2 that gave none were a "pack" and a tote bag.
  - Pachinko's page gives "Min Jin Lee". Its feed product (`/produto/pachinko-pre-venda/`) has no attributes and no SKU.
  - Gradiva, Guerra & Paz and Penguin products lack a feed ISBN, so the importer reads every page: Gradiva 1,535, Guerra & Paz 1,307 and Penguin 5,840 products, at ≥3 s each per shop.
  - Relógio d'Água is different (corrected during implementation): most of its products carry the ISBN in the image file name (`9789897837579-scaled.jpg`), so the importer never fetches their page and they get no page author. Only products without one, like Pachinko (`capa-pachinko.jpg`), are page-read. See Follow-ups.
- **Downstream passes that ran on blank identities** (the "Unblocking dependent sessions" session, 2026-10-16, production on 24d915ec):
  - **Translation.** The backlog recorded 18,477 Portuguese works as `noCandidates`, mostly because they had no author or work key. Code saves each as a judgment with `model = 'code'` and `into_work_id = NULL`.
  - **Why they stay out.** `portugueseWorkFilter` (`sqliteBooksRepository.ts:115-121` on main) leaves out any work with a judgment, unless `--recheck-none` is given and the judgment is more than 30 days old. So without Task 5, filling authors would not bring them back before 2026-11-15.
  - **Genre.** About 3,950 of the 4,006 works Jev doubted had a blank identity. 658 stayed unknown and are listed in `~/Documents/scripta-sitting/genre-left-unknown.json`.
  - **Merged editions.** 525 blank-title Portuguese editions were merged into their originals on `original_title` + synopsis. Filling their identity is safe: `fillWorkIdentityStmt` only fills a work's empty title or author, and their judgments carry an `into_work_id`.
- **Base.** Implementation branches from `origin/main` (24d915ec at the time of writing; this plan was written against 76a76b82). None of the commits in between touch this plan's files except `backend/README.md`, so line numbers there may have moved; find sections by heading.
- **Not covered.** These shops are not in this plan (see Follow-ups):
  - Imprensa Nacional: `AUTOR <name>` tags, combined "A e B" credits, "VV. AA." placeholders.
  - Edições Afrontamento: `<p class="product-autor">A e B (orgs.)</p>`.
  - Saída de Emergência: its `class="autor"` sits on related cards.
  - Exclamação, Kathartika, Divergência: no author markup found.
  - Orfeu Negro and Pato Lógico: none in the feed.

## Global Constraints

- No new dependencies. No comments in code. No new test files; every test goes into an existing file already listed in `backend/package.json`'s `test` script.
- Never overwrite a non-empty title or author. Never claim an authorless `ta:<title>||` key: a title key goes on a book only when the book will have an author.
- Never take an author from a related product, a translator link, or anything outside the main product block.
- **Pace.** Shops are read only through the importer's existing throttle (`MIN_WAIT_MS` 3000 per shop, or the robots crawl delay if higher), its `robots.txt` `Disallow` check, and its page retry handling. Nothing in this plan adds a request.
- **Open Library order.** It stays ahead of the product page for new books. The importer prefers its edition title, because Relógio's feed titles are sometimes in capitals.
- **Production steps are run by the user** (see Production runbook). The code must be deployed first.
- **Backend verify:** `npm run build --workspace @scripta/shared`, `npm run typecheck --workspace backend`, `npm test --workspace backend`, `git diff --check`. The backend has no lint script.
- **One test file:** `cd backend && npx tsx --test --test-name-pattern="<name>" <file>`.

## Review Focus

1. **Related-product contamination.** A product page lists other books' authors in related cards with the same `autor_link` class. Only the main product's author may be taken. Pinned in Task 2.
2. **Translator as author.** Gradiva's translator is an `autor_link` to `/tradutor/`, and it must never become the author. Pinned in Task 2.
3. **An ISBN pointing at another book.** A stored title-only row whose title doesn't match the product carrying its ISBN must keep its empty author. Pinned in Task 3.
4. **Repair touches nothing else.** A repaired book keeps its cover image, its existing author or title, and gets no Open Library lookup. Pinned in Task 3.
5. **Dry run.** A dry run counts and logs every fill it would make and writes nothing. Pinned in Task 3.

---

### Task 1: One helper for filling a missing title or author, used by `--fill-titles` too

**Files:**
- Modify: `backend/src/modules/books/domain/findOrCreate.ts` (add `fillMissingIdentity`; use it in `findOrCreateBook`, lines 32-36)
- Modify: `backend/src/modules/books/seed/seedCatalog.ts` (lines 22-26)
- Modify: `backend/src/modules/books/seed/fillBlankTitles.ts` (repo `Pick`, line 43)
- Test: `backend/src/modules/books/seed/seedCatalog.test.ts`, `backend/src/modules/books/seed/fillBlankTitles.test.ts`

**Interfaces:**
- Produces: `fillMissingIdentity(repo: Pick<BooksRepository, "findBookByKey" | "addKey" | "fillIdentity">, book: Pick<BookRow, "id" | "title" | "author">, title: string, author: string): boolean`, exported from `domain/findOrCreate.ts`.
  - It returns `false` and does nothing when no empty field would be filled.
  - Otherwise, if the book will have an author, it adds `catalogTitleKey(storedTitleOrNew, storedAuthorOrNew)` as a lookup key when that key is free. Then it calls `repo.fillIdentity(book.id, title, author)` and returns `true`.
  - The key comes from the stored values where they exist, not the incoming ones.
- `seedBook` and `fillBlankTitles` keep their signatures. `fillBlankTitles`'s `deps.repo` `Pick` gains `"getBook" | "findBookByKey" | "addKey"`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/modules/books/seed/seedCatalog.test.ts` (it already imports `catalogTitleKey`, `seedBook` and has `setup()` and `NOW`):

```ts
test("seedBook keys a filled author under the stored title, not the incoming one", () => {
  const { repo } = setup();
  const titled = seedBook({ isbn: "9789720000019", title: "Poemas", author: "" }, repo, () => NOW, "publisher").book!;
  seedBook({ isbn: "9789720000019", title: "Poemas Escolhidos", author: "Sophia de Mello Breyner Andresen" }, repo, () => NOW, "publisher");
  assert.equal(repo.getBook(titled.id)!.title, "Poemas");
  assert.equal(repo.findBookByKey(catalogTitleKey("Poemas", "Sophia de Mello Breyner Andresen")!)?.id, titled.id);
  assert.equal(repo.findBookByKey(catalogTitleKey("Poemas Escolhidos", "Sophia de Mello Breyner Andresen")!), undefined);
});
```

In `backend/src/modules/books/seed/fillBlankTitles.test.ts`, add `const { catalogTitleKey } = await import("../domain/normalize.js");` after the other dynamic imports, then append:

```ts
test("a feed product with an author also gives the book its title key", async () => {
  const site = { ...SHOP, authorFromVendor: true };
  const h = setup({ "https://shop.test/products.json?limit=250&page=1": page1([{ ...product("hamlet", "Hamlet", "9789896414672"), vendor: "William Shakespeare" }]) });
  const id = h.blank("9789896414672", "https://shop.test/products/hamlet");
  await fillBlankTitles(h.deps, [site], { dryRun: false });
  assert.equal(h.repo.findBookByKey(catalogTitleKey("Hamlet", "William Shakespeare")!)?.id, id);
});

test("a feed product without an author fills the title and claims no title key", async () => {
  const h = setup({ "https://shop.test/products.json?limit=250&page=1": page1([product("hamlet", "Hamlet", "9789896414672")]) });
  h.blank("9789896414672", "https://shop.test/products/hamlet");
  await fillBlankTitles(h.deps, [SHOP], { dryRun: false });
  assert.equal(h.repo.findBookByKey("ta:hamlet||"), undefined);
});
```

- [ ] **Step 2: Run them and confirm the right ones fail**

Run: `cd backend && npx tsx --test --test-name-pattern="stored title|title key" src/modules/books/seed/seedCatalog.test.ts src/modules/books/seed/fillBlankTitles.test.ts`
- Expected to fail: "keys a filled author under the stored title" (`seedBook` keys the incoming title) and "also gives the book its title key" (`fillBlankTitles` adds no key).
- Expected to pass already: "claims no title key". It guards the change.

- [ ] **Step 3: Implement**

In `backend/src/modules/books/domain/findOrCreate.ts`, change the first import and add the helper below `findExisting`:

```ts
import { catalogTitleKey, findByIdentity, lookupIdentity, type BookIdentity, type BookLookup } from "./normalize.js";
```

```ts
export function fillMissingIdentity(repo: Pick<BooksRepository, "findBookByKey" | "addKey" | "fillIdentity">, book: Pick<BookRow, "id" | "title" | "author">, title: string, author: string): boolean {
  if ((book.title || !title) && (book.author || !author)) return false;
  const nextAuthor = book.author || author;
  const titleKey = nextAuthor ? catalogTitleKey(book.title || title, nextAuthor) : null;
  if (titleKey && !repo.findBookByKey(titleKey)) repo.addKey(titleKey, book.id);
  repo.fillIdentity(book.id, title, author);
  return true;
}
```

Replace the body of `findOrCreateBook` after `findExisting` with:

```ts
  if (!existing) return repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn }, keysOf(repo, identity), createdAt);
  return fillMissingIdentity(repo, existing, identity.title, identity.author) ? (repo.getBook(existing.id) ?? existing) : existing;
```

In `backend/src/modules/books/seed/seedCatalog.ts`, add `import { fillMissingIdentity } from "../domain/findOrCreate.js";` and replace the `if ((!existing.title && identity.title) || …) { … }` block inside `if (existing)` with:

```ts
    fillMissingIdentity(repo, existing, identity.title, identity.author);
```

In `backend/src/modules/books/seed/fillBlankTitles.ts`, add `import { fillMissingIdentity } from "../domain/findOrCreate.js";`, change the repo `Pick` to `Pick<BooksRepository, "listBlankTitled" | "getBook" | "findBookByKey" | "addKey" | "fillIdentity">`, and replace the `for (const id of ids) deps.repo.fillIdentity(…)` line with:

```ts
        for (const id of ids) {
          const row = deps.repo.getBook(id);
          if (row) fillMissingIdentity(deps.repo, row, book.title, book.author ?? "");
        }
```

`backend/scripts/import-publisher-covers.mjs` passes the full repository, so it needs no change.

- [ ] **Step 4: Run the books tests**

Run: `cd backend && npx tsx --test src/modules/books/seed/seedCatalog.test.ts src/modules/books/seed/fillBlankTitles.test.ts src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
Expected: all pass, including the existing `seedBook` and `fillIdentity` tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/domain/findOrCreate.ts backend/src/modules/books/seed/seedCatalog.ts backend/src/modules/books/seed/fillBlankTitles.ts backend/src/modules/books/seed/seedCatalog.test.ts backend/src/modules/books/seed/fillBlankTitles.test.ts
git commit -m "Fill a missing title or author through one helper that keys the stored title, and let --fill-titles claim the key"
```

---

### Task 2: Read authors from Presença's tags and from the shops' product pages

**Files:**
- Modify: `backend/src/modules/books/seed/publishers.ts` (`PublisherSite`, five `PUBLISHERS` entries)
- Modify: `backend/src/modules/books/seed/publisherFeed.ts` (new `pageAuthors`, `tagAuthors`, `distinctNames`; `parseShopifyProducts` author line ~232; `ResolvedBook`)
- Test: `backend/src/modules/books/seed/publisherFeed.test.ts`

**Interfaces:**
- Produces: `PublisherSite` gains `authorTag?: RegExp` and `authorLinks?: boolean`.
  - `authorTag` is non-global; capture group 1 is one author's name.
  - `authorLinks` means "this shop's product page has `autor_link` anchors".
- Produces: `export function pageAuthors(html: string): string | null`.
  - It returns the distinct names of the `autor_link` anchors whose href has `/autor/` or `/autores/`, between the first `<main` and the first `class="w-grid-item"` card or `</main>`.
  - Names are entity-decoded and joined with `", "`, or the function returns `null`.
- Produces: `export type ResolvedBook = PublisherBook & { isbn: string; pageAuthor?: string | null }`. Task 3 fills `pageAuthor`.
- `parseShopifyProducts`: `author` is the vendor (as today) or, failing that, the site's `authorTag` names joined with `", "`.

- [ ] **Step 1: Write the failing tests**

In `backend/src/modules/books/seed/publisherFeed.test.ts`, add `pageAuthors` to the import from `./publisherFeed.js`, then append:

```ts
const presenca: PublisherSite = { name: "Presença", origin: "https://www.presenca.pt", platform: "shopify", authorFromVendor: false, authorTag: /^NOMEAUTOR_(.+)$/ };
const presencaWithoutTag: PublisherSite = { name: "Presença", origin: "https://www.presenca.pt", platform: "shopify", authorFromVendor: false };

function presencaFeed(tags: string[]) {
  return { products: [{ title: "Ultimate Football Heroes", handle: "ultimate-football-heroes", vendor: "Presença", tags, variants: [{ barcode: "9789897833199" }], images: [{ src: "https://cdn.shopify.com/s/files/1/0000/0000/files/heroes.jpg" }] }] };
}

test("a Shopify product takes its authors from the site's author tags", () => {
  const [book] = parseShopifyProducts(presencaFeed(["AUTOR_dan-leydon_Dan Leydon", "EDITORA_Presença", "NOMEAUTOR_Dan Leydon", "NOMEAUTOR_Matt Oldfield"]), presenca);
  assert.equal(book!.author, "Dan Leydon, Matt Oldfield");
});

test("a Shopify product with no author tag has no author", () => {
  const [book] = parseShopifyProducts(presencaFeed(["EDITORA_Jacarandá", "TIPO_BOOK"]), presenca);
  assert.equal(book!.author, null);
});

test("author tags count only on a site that names its tag pattern", () => {
  const [book] = parseShopifyProducts(presencaFeed(["NOMEAUTOR_Dan Leydon"]), presencaWithoutTag);
  assert.equal(book!.author, null);
});

const PACHINKO_PAGE = `<html><head><style>.w-grid-item{padding:0}</style></head><body>
<header><a class='autor_link' href='https://www.relogiodagua.pt/autor/menu/'>Menu Autor</a></header>
<main id="page-content">
<div class="wpb_wrapper"><a class='autor_link' href='https://www.relogiodagua.pt/autor/min-jin-lee/'>Min Jin Lee</a></div>
<h1 class="w-post-elm post_title entry-title">Pachinko</h1>
<div class="produto_traducao"><span class="w-post-elm-before">Tradução: </span><span class="w-post-elm-value">Marta Mendonça</span></div>
<p>ISBN: 978-989-783-319-9</p>
<div class="w-grid-item post-7722 product"><div class="w-grid-item-h"><a class='autor_link' href='https://www.relogiodagua.pt/autor/vladimir-nabokov/'>Vladimir Nabokov</a></div></div>
</main>
<footer><a class='autor_link' href='https://www.relogiodagua.pt/autor/rodape/'>Rodapé</a></footer>
</body></html>`;

test("pageAuthors takes the main product's author and none from the menu, related products or footer", () => {
  assert.equal(pageAuthors(PACHINKO_PAGE), "Min Jin Lee");
});

test("pageAuthors keeps every author once and skips translator links", () => {
  const html = `<main><h1>Aristóteles</h1><a class='autor_link' href='https://www.gradiva.pt/autor/tassos-apostolidis/'>Tassos Apostolidis</a>, <a class='autor_link' href='https://www.gradiva.pt/autor/alecos-papadatos/'>Alecos Papadatos</a> <a class='autor_link' href='https://www.gradiva.pt/tradutor/jorge-vaz-de-carvalho/'>Jorge Vaz de Carvalho</a><h1>Aristóteles</h1><a class='autor_link' href='https://www.gradiva.pt/autor/tassos-apostolidis/'>Tassos Apostolidis</a></main>`;
  assert.equal(pageAuthors(html), "Tassos Apostolidis, Alecos Papadatos");
});

test("pageAuthors reads /autores/ links and decodes entities in names", () => {
  const html = `<main><h1>Os Intrusos</h1><a class='autor_link' href='https://penguinlivros.pt/autores/edna-obrien-2/'>Edna O&#8217;Brien</a></main>`;
  assert.equal(pageAuthors(html), "Edna O’Brien");
});

test("pageAuthors finds nothing when only related products have author links", () => {
  const html = `<main><h1>Saco de Pano</h1><div class="w-grid-item post-1 product"><a class='autor_link' href='https://www.relogiodagua.pt/autor/jane-austen/'>Jane Austen</a></div></main>`;
  assert.equal(pageAuthors(html), null);
});

test("pageAuthors finds nothing on a page without a main element", () => {
  assert.equal(pageAuthors(`<body><a class='autor_link' href='https://www.relogiodagua.pt/autor/a/'>Alguém</a></body>`), null);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd backend && npx tsx --test src/modules/books/seed/publisherFeed.test.ts`
Expected: a type or import error. `pageAuthors` isn't exported and `authorTag` isn't a `PublisherSite` field.

- [ ] **Step 3: Implement**

In `backend/src/modules/books/seed/publishers.ts`:

```ts
export interface PublisherSite {
  name: string;
  origin: string;
  platform: "shopify" | "woocommerce";
  authorFromVendor: boolean;
  authorTag?: RegExp;
  authorLinks?: boolean;
}
```

Change these entries (and only these):

```ts
  { name: "Relógio d'Água", origin: "https://www.relogiodagua.pt", platform: "woocommerce", authorFromVendor: false, authorLinks: true },
  { name: "Gradiva", origin: "https://gradiva.pt", platform: "woocommerce", authorFromVendor: false, authorLinks: true },
  { name: "Guerra & Paz", origin: "https://guerraepaz.pt", platform: "woocommerce", authorFromVendor: false, authorLinks: true },
  { name: "Presença", origin: "https://www.presenca.pt", platform: "shopify", authorFromVendor: false, authorTag: /^NOMEAUTOR_(.+)$/ },
  { name: "Penguin Livros", origin: "https://penguinlivros.pt", platform: "woocommerce", authorFromVendor: false, authorLinks: true }
```

In `backend/src/modules/books/seed/publisherFeed.ts`, change `ResolvedBook`:

```ts
export type ResolvedBook = PublisherBook & { isbn: string; pageAuthor?: string | null };
```

Add next to the other module constants:

```ts
const AUTHOR_LINK = /<a\s+class=['"]autor_link['"]\s+href=['"]([^'"]*)['"][^>]*>([^<]+)<\/a>/g;
const AUTHOR_PATH = /\/autor(?:es)?\//;
const PRODUCT_END = /class="w-grid-item[\s"]|<\/main>/;
```

Add after `findPageIsbn`:

```ts
function distinctNames(names: string[]): string | null {
  const distinct = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  return distinct.length > 0 ? distinct.join(", ") : null;
}

export function pageAuthors(html: string): string | null {
  const start = html.search(/<main\b/);
  if (start < 0) return null;
  const main = html.slice(start);
  const end = main.search(PRODUCT_END);
  const product = end < 0 ? main : main.slice(0, end);
  return distinctNames([...product.matchAll(AUTHOR_LINK)].filter((link) => AUTHOR_PATH.test(link[1]!)).map((link) => decodeEntities(link[2]!)));
}

function tagAuthors(tags: unknown, pattern: RegExp): string | null {
  return distinctNames(labelList(tags).map((tag) => pattern.exec(tag)?.[1] ?? ""));
}
```

`labelList` is declared further down the file as a function declaration, so it is hoisted and usable here.

In `parseShopifyProducts`, replace the `const author = …` line with:

```ts
    const fromVendor = site.authorFromVendor && vendor && normalizeWords(vendor) !== normalizeWords(site.name) ? vendor : null;
    const author = fromVendor ?? (site.authorTag ? tagAuthors(product.tags, site.authorTag) : null);
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd backend && npx tsx --test src/modules/books/seed/publisherFeed.test.ts && cd .. && npm run typecheck --workspace backend`
Expected: all pass. Typecheck is clean (existing `PublisherSite` literals still compile because the new fields are optional).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/seed/publishers.ts backend/src/modules/books/seed/publisherFeed.ts backend/src/modules/books/seed/publisherFeed.test.ts
git commit -m "Read authors from Presença's feed tags and from the main product's author links on four shops' pages"
```

---

### Task 3: The importer uses page authors and fills existing books' missing title or author

**Files:**
- Modify: `backend/src/modules/books/seed/importPublisherCovers.ts`:
  - `SiteReport` and `emptyReport` (lines 18-37, 60)
  - imports (line 9)
  - `readPage` (`resolved.push` near line 197)
  - the per-book loop (lines 259-277)
- Modify: `backend/README.md`: the report field list in "Seeding the catalog", and a new paragraph after the `--fill-titles` paragraph.
- Modify: `docs/publisher-catalog.md`: "Author from" cells.
- Test: `backend/src/modules/books/seed/importPublisherCovers.test.ts`

**Interfaces:**
- Consumes: `pageAuthors`, `ResolvedBook.pageAuthor`, `PublisherSite.authorLinks` (Task 2); `seedBook` (whose fill now goes through `fillMissingIdentity`, Task 1).
- Produces: `SiteReport.identityFilled: number`, the existing books whose empty title or author the run filled (or would fill, in a dry run).
- Produces: one log line per such fill, `<site name>: identity <isbn> {"title":"…","author":"…"}`.

- [ ] **Step 1: Write the failing tests**

In `backend/src/modules/books/seed/importPublisherCovers.test.ts`:
- Add `const { catalogTitleKey, searchTokens } = await import("../domain/normalize.js");` after the other dynamic imports.
- Add `identityFilled: 0,` to the expected Antígona report in the first test (the `assert.deepEqual(reports["Antígona"], { … })` block).
- Then append at the **end of the file** (after `WOO_FEED` is declared):

```ts
const PACHINKO = "9789897833199";
const PACHINKO_URL = "https://www.relogiodagua.pt/produto/pachinko-pre-venda/";
const relogioLinks: Site = { ...relogio, authorLinks: true };
const pachinkoFeeds = {
  [WOO_FEED]: { text: JSON.stringify([{ name: "Pachinko", permalink: PACHINKO_URL, sku: "", description: "", short_description: "", images: [{ src: "https://www.relogiodagua.pt/wp-content/uploads/2023/02/capa-pachinko.jpg" }], attributes: [] }]) },
  [PACHINKO_URL]: { text: `<main><a class='autor_link' href='https://www.relogiodagua.pt/autor/min-jin-lee/'>Min Jin Lee</a><h1>Pachinko</h1><p>ISBN: 978-989-783-319-9</p><div class="w-grid-item post-1 product"><a class='autor_link' href='https://www.relogiodagua.pt/autor/jane-austen/'>Jane Austen</a></div></main>` }
};

function publisherBook(repo: ReturnType<typeof createSqliteBooksRepository>, isbn: string, title: string, author: string) {
  const book = repo.createBook({ title, author, isbn, createdBy: "publisher" }, [`isbn:${isbn}`], NOW.toISOString());
  addCover(repo, book.id, "upload", 900, null);
  return repo.getBook(book.id)!;
}

test("a title-only book gets its author from the product page on a re-run, keeps its cover and is found by author", async () => {
  const h = await harness({ feeds: pachinkoFeeds });
  const before = publisherBook(h.repo, PACHINKO, "Pachinko", "");

  const reports = await importPublisherCovers(h.deps, [relogioLinks], { dryRun: false });

  const row = h.repo.getBook(before.id)!;
  assert.equal(row.title, "Pachinko");
  assert.equal(row.author, "Min Jin Lee");
  assert.equal(row.cover_image_id, before.cover_image_id);
  assert.equal(reports["Relógio d'Água"]!.identityFilled, 1);
  assert.equal(h.repo.findBookByKey(catalogTitleKey("Pachinko", "Min Jin Lee")!)?.id, before.id);
  assert.deepEqual(h.repo.searchBooks(searchTokens("Min Jin Lee"), 10).map((found) => found.id), [before.id]);
  assert.deepEqual(h.lookups, []);
  assert.ok(h.logs.includes(`Relógio d'Água: identity ${PACHINKO} {"title":"Pachinko","author":"Min Jin Lee"}`));
});

test("a blank book gets its title and the page author on a re-run", async () => {
  const h = await harness({ feeds: pachinkoFeeds });
  const before = publisherBook(h.repo, PACHINKO, "", "");

  await importPublisherCovers(h.deps, [relogioLinks], { dryRun: false });

  const row = h.repo.getBook(before.id)!;
  assert.equal(row.title, "Pachinko");
  assert.equal(row.author, "Min Jin Lee");
  assert.equal(h.repo.isSearchable(before.id), true);
});

test("a dry run counts and logs the identity it would fill and writes nothing", async () => {
  const h = await harness({ feeds: pachinkoFeeds });
  const before = publisherBook(h.repo, PACHINKO, "Pachinko", "");

  const reports = await importPublisherCovers(h.deps, [relogioLinks], { dryRun: true });

  assert.equal(reports["Relógio d'Água"]!.identityFilled, 1);
  assert.ok(h.logs.some((line) => line.startsWith(`Relógio d'Água: identity ${PACHINKO}`)));
  assert.equal(h.repo.getBook(before.id)!.author, "");
  assert.equal(h.repo.findBookByKey(catalogTitleKey("Pachinko", "Min Jin Lee")!), undefined);
});

test("a re-run never replaces an author the book already has", async () => {
  const h = await harness({ feeds: pachinkoFeeds });
  const before = publisherBook(h.repo, PACHINKO, "Pachinko", "Min J. Lee");

  const reports = await importPublisherCovers(h.deps, [relogioLinks], { dryRun: false });

  assert.equal(h.repo.getBook(before.id)!.author, "Min J. Lee");
  assert.equal(reports["Relógio d'Água"]!.identityFilled, 0);
});

test("a site without author links leaves a title-only book's author empty", async () => {
  const h = await harness({ feeds: pachinkoFeeds });
  const before = publisherBook(h.repo, PACHINKO, "Pachinko", "");

  await importPublisherCovers(h.deps, [relogio], { dryRun: false });

  assert.equal(h.repo.getBook(before.id)!.author, "");
});

test("a new page-shop book takes the page author when Open Library has none", async () => {
  const h = await harness({ feeds: pachinkoFeeds });

  const reports = await importPublisherCovers(h.deps, [relogioLinks], { dryRun: false });

  const row = h.repo.findBookByKey(`isbn:${PACHINKO}`)!;
  assert.equal(row.title, "Pachinko");
  assert.equal(row.author, "Min Jin Lee");
  assert.equal(reports["Relógio d'Água"]!.noAuthor, 0);
  assert.deepEqual(h.lookups, [PACHINKO]);
});

test("a new page-shop book still prefers Open Library's title and author", async () => {
  const h = await harness({ feeds: pachinkoFeeds, lookup: async () => ({ title: "Pachinko", author: "Min J. Lee" }) });

  await importPublisherCovers(h.deps, [relogioLinks], { dryRun: false });

  assert.equal(h.repo.findBookByKey(`isbn:${PACHINKO}`)!.author, "Min J. Lee");
});

const presenca: Site = { name: "Presença", origin: "https://www.presenca.pt", platform: "shopify", authorFromVendor: false, authorTag: /^NOMEAUTOR_(.+)$/ };
const presencaFeeds = {
  "https://www.presenca.pt/products.json?limit=250&page=1": { text: shopifyPage([{ title: "Pachinko", handle: "pachinko", vendor: "Presença", tags: ["EDITORA_Presença", "NOMEAUTOR_Min Jin Lee"], variants: [{ barcode: PACHINKO }], images: [{ src: "https://cdn.shopify.com/s/files/1/0000/0000/files/pachinko.jpg" }] }]) }
};

test("a title-only book gets its author from the feed's author tags on a re-run", async () => {
  const h = await harness({ feeds: presencaFeeds });
  const before = publisherBook(h.repo, PACHINKO, "Pachinko", "");

  await importPublisherCovers(h.deps, [presenca], { dryRun: false });

  assert.equal(h.repo.getBook(before.id)!.author, "Min Jin Lee");
});

test("a re-run does not fill the author when the stored title is another book's", async () => {
  const h = await harness({ feeds: presencaFeeds });
  const before = publisherBook(h.repo, PACHINKO, "Os Maias", "");

  const reports = await importPublisherCovers(h.deps, [presenca], { dryRun: false });

  assert.equal(h.repo.getBook(before.id)!.author, "");
  assert.equal(h.repo.getBook(before.id)!.title, "Os Maias");
  assert.equal(reports["Presença"]!.identityFilled, 0);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd backend && npx tsx --test src/modules/books/seed/importPublisherCovers.test.ts`
Expected: a type error on `identityFilled`. Once that compiles, the re-run and page-author tests fail. "never replaces", "without author links", "prefers Open Library" and "another book's" may already pass; they guard the change.

- [ ] **Step 3: Implement**

In `backend/src/modules/books/seed/importPublisherCovers.ts`:

1. Add `pageAuthors` to the import from `./publisherFeed.js`.
2. Add `identityFilled: number;` to `SiteReport` after `noAuthor`, and `identityFilled: 0` to `emptyReport` after `noAuthor: 0`.
3. In `readPage`, replace `if (isbn) resolved.push({ ...book, isbn, details: withPageText(book.details, response.text) });` with:

```ts
    if (isbn) resolved.push({ ...book, isbn, pageAuthor: site.authorLinks ? pageAuthors(response.text) : null, details: withPageText(book.details, response.text) });
```

4. In the per-book loop, replace the whole `if (!row) { … }` block (from `if (!row) {` through the `row = seedBook(…).book!;` line and its closing brace) with:

```ts
    const known = book.author ?? book.pageAuthor ?? null;
    if (!row) {
      let { title, author } = book;
      if (!author) {
        const result = await lookup();
        if (!result) continue;
        if (result.edition?.author) {
          title = result.edition.title ? fillLossy(result.edition.title, title) ?? result.edition.title : title;
          author = result.edition.author;
        } else if (book.pageAuthor) {
          author = book.pageAuthor;
        } else {
          report.noAuthor++;
          author = "";
        }
      }
      report.created++;
      if (options.dryRun) {
        report.coversSet++;
        continue;
      }
      row = seedBook({ isbn: book.isbn, title, author, workKey: memo.looked?.edition?.workKey ?? undefined }, deps.repo, deps.now, "publisher").book!;
    } else if ((!row.title || (!row.author && known)) && (!row.title || sameTitle(row.title, book.title))) {
      const title = row.title || book.title;
      report.identityFilled++;
      deps.log(`${site.name}: identity ${book.isbn} ${JSON.stringify({ title, author: row.author || known || "" })}`);
      if (!options.dryRun) seedBook({ isbn: book.isbn, title, author: known ?? "" }, deps.repo, deps.now, "publisher");
    }
```

The `else if` only runs for an existing row. It fills the title when the row has none, and the author when the row has none and a shop source has one. When the row already has a title, that title must match the product's. Calling `seedBook` on an existing row does only this fill: its `setWorkKey(id, undefined)` and `setLanguage(id, null)` are no-ops.

5. In `backend/README.md`, under "Seeding the catalog", add `identityFilled` after `noAuthor` in the report field list. Then add this paragraph after the `--fill-titles` paragraph:

```markdown
**Authors.** A book's author comes from the feed when the shop puts it there: Antígona's `vendor`, a WooCommerce `Autor` attribute, or Presença's `NOMEAUTOR_` tags (`authorTag` in `seed/publishers.ts`). Otherwise it comes from Open Library, and failing that, for shops with `authorLinks`, from the product page. There it is the `autor_link` anchors to `/autor/` or `/autores/` between `<main` and the first related-product card (`w-grid-item`), so related books and `/tradutor/` links never count. On every run, an existing book with an empty title or author gets the missing part from its product (never overwriting either), but only when its stored title matches the product's. Each fill is logged as `<site>: identity <isbn> {"title":…,"author":…}` and counted in `identityFilled`; a dry run logs and counts without writing.
```

6. In `docs/publisher-catalog.md`, change these "Author from" cells:
   - Relógio d'Água: `Open Library; the page has an `/autor/` link` → `Open Library, else the page's `autor_link` (`authorLinks`)`
   - Gradiva: `Open Library; the page has an `/autor/` link` → `Open Library, else the page's `autor_link` (`authorLinks`); translators share the class with a `/tradutor/` href`
   - Guerra & Paz: `Open Library` → `Open Library, else the page's `autor_link` (`authorLinks`)`
   - Penguin Livros: `Open Library; the page has `Autor(a)` links to `/autores/`` → `Open Library, else the page's `autor_link` to `/autores/` (`authorLinks`)`
   - Presença: `Open Library` → ``NOMEAUTOR_<name>` tags (`authorTag`), one per author, in alphabetical order`
   - Imprensa Nacional: `Open Library` → `Open Library; the feed has `AUTOR <name>` tags (also "A e B" and "VV. AA."), not used yet`
   - Edições Afrontamento: `Open Library` → `Open Library; the page has `<p class="product-autor">` (e.g. "A e B (orgs.)"), not used yet`

- [ ] **Step 4: Run the full backend verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && git diff --check`
Expected: all pass. If an existing test asserts `h.logs.length` on a run that now fills an identity, read it first. If its rows are publisher-shaped with an empty field, update the count; otherwise the condition is wrong.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/seed/importPublisherCovers.ts backend/src/modules/books/seed/importPublisherCovers.test.ts backend/README.md docs/publisher-catalog.md
git commit -m "Fill an existing book's missing title or author on every importer run, from feed tags or the product page"
```

---

### Task 4: `seed-catalog.mjs --status` reports blank titles and authors per shop

**Files:**
- Modify: `backend/scripts/seed-catalog.mjs` (`printStatus`, lines 22-35)
- Modify: `backend/README.md` (one sentence where `--status` is described; find it with `rg -n -- '--status' backend/README.md`)

**Interfaces:**
- Produces: `--status`'s JSON line gains `blank: { untitled, authorless, byShop: { [host]: { untitled, authorless } } }`.
  - `untitled` counts books with an empty title (author empty or not). `authorless` counts books with a title and an empty author.
  - `host` is the `publisher_url` host, or `"none"`.

- [ ] **Step 1: Implement**

In `printStatus`, before the `log(…)` call, add:

```js
  const blank = { untitled: 0, authorless: 0, byShop: {} };
  for (const row of db.prepare("SELECT publisher_url AS url, title = '' AS untitled FROM books WHERE title = '' OR author = ''").all()) {
    const shop = row.url && URL.canParse(row.url) ? new URL(row.url).host : "none";
    const field = row.untitled ? "untitled" : "authorless";
    blank[field]++;
    blank.byShop[shop] ??= { untitled: 0, authorless: 0 };
    blank.byShop[shop][field]++;
  }
```

and add `blank` as the last field of the logged object: `log(JSON.stringify({ total, null: 0, good: 0, low_res: 0, missing: 0, manual: 0, ...counts, withImage, portugal, blank }));`.

In `backend/README.md`, where `--status` is described, add: "It also prints `blank`: books with an empty title (`untitled`) and books with a title but no author (`authorless`), in all and per `publisher_url` host."

- [ ] **Step 2: Verify against a scratch copy of the dev catalog**

Run:

```bash
SCRATCH=$(mktemp -d) && cp /Users/andreribeiro/Documents/scripta/backend/data/dev/covers.sqlite "$SCRATCH/covers.sqlite" && sqlite3 "$SCRATCH/covers.sqlite" "UPDATE books SET author = '', publisher_url = 'https://www.relogiodagua.pt/produto/x/' WHERE rowid = (SELECT MIN(rowid) FROM books)" && COVERS_DB_PATH="$SCRATCH/covers.sqlite" node backend/scripts/seed-catalog.mjs --status
```

Expected: the JSON line ends with a `blank` object whose `byShop` has `"www.relogiodagua.pt":{"untitled":0,"authorless":1}` (or `untitled: 1` if that row's title was already empty). Delete `$SCRATCH` afterwards. Never point this at `backend/data/dev/covers.sqlite` itself.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/seed-catalog.mjs backend/README.md
git commit -m "Report blank titles and authors per shop in seed-catalog --status"
```

---

### Task 5: A filled title or author reopens its work's code-only "no match" verdict

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`:
  - a new statement next to `saveWorkMatchJudgmentStmt` (~line 114 on main)
  - one call in `fillIdentity` (~line 586)
- Modify: `backend/README.md`: one sentence after the `--recheck-none` paragraph under "Translation backlog"
- Test: `backend/src/modules/books/translationJudgments.test.ts`

**Interfaces:**
- No signature changes. `fillIdentity(id, title, author)` now also deletes the `work_match_judgments` row of the book's work when that row has `model = 'code'` and `into_work_id IS NULL`.
- `portugueseWorksNeedingMatch` then selects the work again on an ordinary backlog run.
- Rows with an `into_work_id` (merges), Jev rows and `manual` rows are never touched.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/modules/books/translationJudgments.test.ts` (it has `freshRepo()`, `edition()` and `AT`):

```ts
test("filling a book's author reopens its work's code-only no-match verdict, and keeps Jev's and the owner's", () => {
  const repo = freshRepo();
  const byCode = edition(repo, "9789720000419", { title: "Seis", author: "", language: "pt-PT" });
  const byJev = edition(repo, "9789720000420", { title: "Sete", author: "", language: "pt-PT" });
  const byOwner = edition(repo, "9789720000421", { title: "Oito", author: "", language: "pt-PT" });
  repo.saveWorkMatchJudgment(byCode.work_id!, { model: "code", intoWorkId: null, confidence: null, askedAt: AT });
  repo.saveWorkMatchJudgment(byJev.work_id!, { model: "jev-1.13.0", intoWorkId: null, confidence: 0.8, askedAt: AT });
  repo.saveWorkMatchJudgment(byOwner.work_id!, { model: "manual", intoWorkId: null, confidence: null, askedAt: AT });
  assert.deepEqual(repo.portugueseWorksNeedingMatch(null, 10, 3, null), []);

  for (const book of [byCode, byJev, byOwner]) repo.fillIdentity(book.id, book.title, "Alguém Autor");

  assert.deepEqual(repo.portugueseWorksNeedingMatch(null, 10, 3, null), [byCode.work_id]);
  assert.equal(repo.workMatchJudgments([byJev.work_id!]).get(byJev.work_id!)?.model, "jev-1.13.0");
  assert.equal(repo.workMatchJudgments([byOwner.work_id!]).get(byOwner.work_id!)?.model, "manual");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && npx tsx --test --test-name-pattern="reopens its work" src/modules/books/translationJudgments.test.ts`
Expected: FAIL on the second `portugueseWorksNeedingMatch` assertion (`[]` instead of `[byCode.work_id]`).

- [ ] **Step 3: Implement**

In `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`, next to `saveWorkMatchJudgmentStmt`:

```ts
  const reopenCodeNoMatchStmt = db.prepare(`DELETE FROM work_match_judgments WHERE model = 'code' AND into_work_id IS NULL AND work_id = (SELECT work_id FROM books WHERE id = ?)`);
```

In `fillIdentity`, right after `fillWorkIdentityStmt.run(id);`:

```ts
        reopenCodeNoMatchStmt.run(id);
```

In `backend/README.md`, after the `--recheck-none` paragraph under "Translation backlog", add:

```markdown
Filling a book's empty title or author (`fillIdentity`, e.g. from the publisher importer) drops its work's code-only "none" answer, so the next run plans that work again without `--recheck-none`; Jev's and the owner's answers stay.
```

- [ ] **Step 4: Run the full backend verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && git diff --check`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/translationJudgments.test.ts backend/README.md
git commit -m "Reopen a work's code-only no-match verdict when its book gets a title or author"
```

---

## Production runbook (the user runs these, after the deploy that ships this plan)

Goes into the batch runbook. Run it after the mojibake repair, one job at a time, and hold deploys while any of them runs: a deploy kills a `railway ssh` job. Every step only fills empty fields, so a rerun is always safe. A wrong fill is never overwritten by a rerun either, so it can only be undone by hand; the log lines are the record of what changed, which is why both pilots in step 3 are dry runs.

1. **Baseline.** Note `blank` in the output.
   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "cd /app/backend && node scripts/seed-catalog.mjs --status"
   ```
2. **`--fill-titles`, dry run then real**, if it hasn't run since #257 (10–20 min each, feeds only). Since this plan, it also fills Presença's authors from tags on the books whose title it fills, and gives filled authors their title key. Presença's title-only books are filled in step 4.
   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "cd /app/backend && node scripts/import-publisher-covers.mjs --fill-titles --dry-run"
   ```
   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "cd /app/backend && node scripts/import-publisher-covers.mjs --fill-titles"
   ```
3. **Pilot: Relógio d'Água dry run.** Only its products without an ISBN in the image file name are page-read, so it is much shorter than 2,300 pages; the log's `pages <n>/<total>` lines (one every 100 pages, so none if fewer) show the real count. It writes nothing and logs every fill it would make.
   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "cd /app/backend && setsid node scripts/import-publisher-covers.mjs --dry-run --site \"Relógio d'Água\" > /data/publisher-authors-relogio-dry.json 2> /data/publisher-authors-relogio-dry.log < /dev/null & sleep 3; echo started"
   ```
   When `/data/publisher-authors-relogio-dry.json` is non-empty, check:
   - `skipped` is absent, and `pagesDeferred` is 0. If any page failed, page-sourced books are deferred for the whole run, so rerun.
   - `identityFilled` is non-zero. It will be far below Relógio's ~1,951 blank rows, because file-name-ISBN products are never page-read.
   - About 20 random `identity` lines read right (`grep ': identity ' /data/publisher-authors-relogio-dry.log | shuf -n 20`), including Pachinko → Min Jin Lee (`grep 9789897833199 …`).

   **Then a Gradiva dry run** (~77 min: 1,535 pages at Gradiva's 3 s crawl delay). Relógio no longer tests page authors at scale, and Gradiva is fully page-read and has the `/tradutor/` links.
   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "cd /app/backend && setsid node scripts/import-publisher-covers.mjs --dry-run --site Gradiva > /data/publisher-authors-gradiva-dry.json 2> /data/publisher-authors-gradiva-dry.log < /dev/null & sleep 3; echo started"
   ```
   When `/data/publisher-authors-gradiva-dry.json` is non-empty, check the same `skipped` and `pagesDeferred` rules, that `identityFilled` is in the hundreds, and that about 20 random `identity` lines (`grep ': identity ' /data/publisher-authors-gradiva-dry.log | shuf -n 20`) name the author, not the translator or a related book's author. Open two or three of those products on gradiva.pt to compare. Log lines end with ` rss=<n>MB`; that suffix is not part of the author.
4. **Full importer run** (~7 h, all shops, 4 at a time; Penguin's 5,840 pages are the long pole). It fills Gradiva, Guerra & Paz, Penguin and Presença, the page-read part of Relógio, and does the usual cover pass everywhere.
   ```bash
   npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c "cd /app/backend && setsid node scripts/import-publisher-covers.mjs > /data/publisher-authors.json 2> /data/publisher-authors.log < /dev/null & sleep 3; echo started"
   ```
   Then rerun any shop that reports `pagesDeferred` > 0 with `--site`.
5. **After.**
   - Run `--status` again and compare `blank.byShop` for the five hosts.
   - Search "Min Jin Lee" in the web app: Pachinko should come up.
   - The remaining `authorless` counts are the unresolved list for the follow-ups.
6. **Translation backlog.** Follow `backend/README.md` → "Translation backlog": dry run, then the real run with `--max` at the dry run's `wouldAsk`.
   - No `--recheck-none` is needed. Task 5 reopened every work whose book got a title or author.
   - Compare `noCandidates` with the earlier 18,477. Expect a smaller `noCandidates` and more `codeMerges` and `wouldAsk`.
   - The `--max` budget is the owner's call.
7. **Genre doubts left unknown.** Follow `backend/README.md` → "Catalog genre backfill" step 4: export with `--scope catalog`, label in Sonnet batches of at most 100 works, and import one file per batch.
   - Label only the works listed in `~/Documents/scripta-sitting/genre-left-unknown.json` that now have an author.
   - The export covers every Jev-judged work, so filter it to those ids.
   - A Claude session does the labelling.

## Follow-ups (not in this plan)

- **Imprensa Nacional** (662 blank on 10-14):
  - `AUTOR <name>` tags on most books, `AUTOR_<n> <name>` (credit order) on some.
  - Combined "Pedro Carvalho e Luc Luycx" credits and "VV. AA." placeholders need rules first.
- **Edições Afrontamento** (1,207): one `<p class="product-autor">` per page, e.g. "Vincenzo Russo e Sabrina Sedlmayer (orgs.)". Splitting on " e " is unsafe ("Melo e Castro"), and "(orgs.)" must be dropped. Related cards use `card-autor`.
- **Saída de Emergência** (888): the main product links `/autor/<slug>/` without `autor_link`. Its `class="autor"` belongs to related cards.
- **Exclamação, Kathartika, Divergência, Orfeu Negro, Pato Lógico:** no author found in the feed or page markup sampled.
- **Relógio d'Água file-name ISBNs:** most Relógio products get their ISBN from the image file name, so the importer never reads their page and they stay authorless. Done by the follow-up that reads the page only for feed-ISBN books whose stored row has no author (`authorPages`).
- **ISBNdb** is an existing source that could cover what shops can't, against its daily quota. Decide after step 5's counts.
