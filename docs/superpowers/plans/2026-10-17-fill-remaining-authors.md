# Fill the Remaining Catalog Authors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the ~6,000 authorless catalog books an author: from five shops' feeds or product pages where the shop states it, and from ISBNdb by ISBN for every other book with an ISBN.

**Architecture:**
- **Task 1:** One credit cleaner cleans every shop credit: parentheses out, placeholders become no author, never split on " e ". The per-site tag rule gains an ordered form for Imprensa Nacional.
- **Task 2:** Four page extractors join the existing `autor_link` one, behind a named per-site `pageAuthor` rule.
- **Task 3:** The importer reads a page's author for any site with a rule, and rejects it only when the page shows a different ISBN.
- **Task 4:** A separate resumable script asks ISBNdb for the rest.

**Tech Stack:** TypeScript, `node:sqlite`, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-17-fill-remaining-authors-design.md`

## Global Constraints

- No new dependencies. No comments in code.
- A new `*.test.ts` file must be added to `backend/package.json`'s `test` script.
- Never overwrite a non-empty title or author. All fills go through `fillMissingIdentity` (`domain/findOrCreate.ts`) or the importer's existing repair branch.
- Never take an author from a related product, a translator credit, a placeholder, or an ISBNdb record whose title doesn't match the stored title.
- **Never split a credit on " e ".** "Alberto da Costa e Silva" is one person. Names the shop lists separately (several tags, links or `<h4>`) are joined with `", "`.
- **Pace:** shops are read only through the importer's existing throttle, robots `Disallow` check and retry handling. ISBNdb is called only through `createIsbndbCatalog` with the 1,100 ms throttle and `createIsbndbGate`, one call per book, `--max` a hard limit.
- **Page memory:** every string returned by a page extractor is copied with `structuredClone`. Production runs Node 24, where a substring keeps its whole page alive (#295).
- **Backend verify:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && git diff --check`. The backend has no lint script.
- **One test file:** `cd backend && npx tsx --test --test-name-pattern="<name>" <file>`.

## Review Focus

1. **Placeholders and role marks from every source.** "VV. AA.", "Vários (Presidência da República)", "(coords.)" and "(Tradução de …)" must never reach a stored author, whether from a tag, a page, a Woo attribute, a vendor or ISBNdb. Pinned in Task 1 (cleaner), Task 2 (pages) and Task 4 (ISBNdb).
2. **Related-product and translator markup.** Each page rule reads only its main-product block. Pinned per extractor in Task 2.
3. **A page with no ISBN.** It fills (Saída de Emergência, Exclamação); a page with a different ISBN does not. Pinned in Task 3.
4. **Resuming the ISBNdb pass.** `next` must let the following night's run continue without asking a book twice. An outage or pause must not skip books. Pinned in Task 4.
5. **A record for another book.** An ISBNdb title that doesn't match keeps the book authorless. Pinned in Task 4.

---

### Task 1: One credit cleaner, and ordered author tags for Imprensa Nacional

**Files:**
- Modify: `backend/src/modules/books/seed/publisherFeed.ts`
- Modify: `backend/src/modules/books/seed/publishers.ts`
- Test: `backend/src/modules/books/seed/publisherFeed.test.ts`

What changes: in publisherFeed.ts, add cleanCredit and a PLACEHOLDER constant, and change distinctNames, tagAuthors, and the author lines in parseShopifyProducts and parseWooProducts; in publishers.ts, the authorTag type and the Imprensa Nacional entry.

**Interfaces:**
- Produces: `export function cleanCredit(credit: string | null): string | null`, exported from `seed/publisherFeed.ts`.
  - It removes every `( … )` segment.
  - It splits on `", "`, collapses whitespace in each name, and drops placeholder names (see the regex below).
  - It rejoins with `", "`, or returns `null` when nothing is left. It never splits on " e ".
- Produces: `PublisherSite.authorTag?: RegExp | RegExp[]`.
  - Patterns are tried in order, and the first pattern with any match wins.
  - The name is capture group `name`, or group 1 if the pattern has no named groups. A numeric `order` group sorts the matches.

- [ ] **Step 1: Write the failing tests**

In `publisherFeed.test.ts`, add `cleanCredit` and `parseWooProducts` to the import from `./publisherFeed.js` if they aren't there, then append:

```ts
test("cleanCredit drops role marks and translator notes and keeps combined credits whole", () => {
  assert.equal(cleanCredit("Miguel Barcelos e Porfírio Pinto (coords.)"), "Miguel Barcelos e Porfírio Pinto");
  assert.equal(cleanCredit("Ana Isabel Marques (texto) e Maria João Castro (ilustração)"), "Ana Isabel Marques e Maria João Castro");
  assert.equal(cleanCredit("Juan Gabriel Vásquez (Tradução de Pedro Rapoula)"), "Juan Gabriel Vásquez");
  assert.equal(cleanCredit("Alberto da Costa e Silva"), "Alberto da Costa e Silva");
  assert.equal(cleanCredit("  Teresa   Castro "), "Teresa Castro");
});

test("cleanCredit turns placeholders into no author", () => {
  for (const credit of ["VV. AA.", " VV. AA.", "VVAA", "AA VV", "Vários", "Vários autores", "Vários (Presidência da República)", "Autor Desconhecido", "Diversos"]) assert.equal(cleanCredit(credit), null, credit);
  assert.equal(cleanCredit("Vários, Ana Luísa Amaral"), "Ana Luísa Amaral");
  assert.equal(cleanCredit(null), null);
});

const incm: PublisherSite = { name: "Imprensa Nacional", origin: "https://loja.incm.pt", platform: "shopify", authorFromVendor: false, authorTag: [/^AUTOR_(?<order>\d+)\s+(?<name>.+)$/, /^AUTOR\s+(?<name>.+)$/] };

function incmFeed(tags: string[]) {
  return { products: [{ title: "Cultura e Democracia", handle: "cultura-e-democracia", vendor: "Imprensa Nacional", tags, variants: [{ barcode: "" }], images: [{ src: "https://cdn.shopify.com/s/files/1/0000/0000/files/cultura.jpg" }] }] };
}

test("numbered author tags give the authors in credit order", () => {
  const [book] = parseShopifyProducts(incmFeed(["AUTOR António Araújo", "AUTOR Pedro Lourenço", "AUTOR_1  Pedro Lourenço", "AUTOR_0 António Araújo", "AUTOR_10 Zé Último", "AUTOR_2 Ana Segunda", "EDITORA Imprensa Nacional"]), incm);
  assert.equal(book!.author, "António Araújo, Pedro Lourenço, Ana Segunda, Zé Último");
});

test("without numbered tags the single author tag is the credit, kept whole", () => {
  const [book] = parseShopifyProducts(incmFeed(["AUTOR Mario Soares e Maria João Avillez", "COLEÇÃO Biografias"]), incm);
  assert.equal(book!.author, "Mario Soares e Maria João Avillez");
});

test("a placeholder author tag gives no author", () => {
  const [book] = parseShopifyProducts(incmFeed(["AUTOR VV. AA.", "TEMA História"]), incm);
  assert.equal(book!.author, null);
});

test("a WooCommerce Autor attribute is cleaned like any other credit", () => {
  const site: PublisherSite = { name: "Abysmo", origin: "https://abysmo.pt", platform: "woocommerce", authorFromVendor: false };
  const product = (terms: string[]) => [{ name: "Livro", permalink: "https://abysmo.pt/produto/livro/", sku: "", description: "", short_description: "", images: [{ src: "https://abysmo.pt/wp-content/uploads/livro.jpg" }], attributes: [{ name: "Autor", terms: terms.map((name) => ({ name })) }] }];
  assert.equal(parseWooProducts(product(["VV. AA."]), site)[0]!.author, null);
  assert.equal(parseWooProducts(product(["Rui Zink (org.)"]), site)[0]!.author, "Rui Zink");
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd backend && npx tsx --test src/modules/books/seed/publisherFeed.test.ts`
Expected: a type or import error. `cleanCredit` isn't exported, and `authorTag` doesn't accept an array.

- [ ] **Step 3: Implement**

`publishers.ts`: change the field to `authorTag?: RegExp | RegExp[];`. Replace the Imprensa Nacional entry with:

```ts
  { name: "Imprensa Nacional", origin: "https://loja.incm.pt", platform: "shopify", authorFromVendor: false, authorTag: [/^AUTOR_(?<order>\d+)\s+(?<name>.+)$/, /^AUTOR\s+(?<name>.+)$/] },
```

`publisherFeed.ts`, next to the other module constants:

```ts
const PLACEHOLDER = /^(?:vvaa|aavv|autordesconhecido|diversos|varios\w*)$/;
```

Add after `findPageIsbn`, and replace `distinctNames` and `tagAuthors` with:

```ts
export function cleanCredit(credit: string | null): string | null {
  if (!credit) return null;
  const names = credit
    .replace(/\([^)]*\)/g, " ")
    .split(", ")
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter((name) => name !== "" && !PLACEHOLDER.test(normalizeWords(name).replace(/ /g, "")));
  return names.length > 0 ? names.join(", ") : null;
}

function distinctNames(names: string[]): string | null {
  return cleanCredit([...new Set(names.map((name) => name.replace(/\s+/g, " ").trim()).filter(Boolean))].join(", "));
}

function tagAuthors(tags: unknown, patterns: RegExp | RegExp[]): string | null {
  const labels = labelList(tags);
  for (const pattern of [patterns].flat()) {
    const found = labels.flatMap((label) => {
      const match = pattern.exec(label);
      return match ? [{ order: Number(match.groups?.order ?? 0), name: match.groups?.name ?? match[1] ?? "" }] : [];
    });
    if (found.length > 0) return distinctNames(found.sort((a, b) => a.order - b.order).map((entry) => entry.name));
  }
  return null;
}
```

In `parseShopifyProducts`, replace the `const fromVendor = …` line with:

```ts
    const fromVendor = site.authorFromVendor && vendor && normalizeWords(vendor) !== normalizeWords(site.name) ? cleanCredit(vendor) : null;
```

In `parseWooProducts`, replace `author: wooAttribute(product, /^autor/i)` with `author: cleanCredit(wooAttribute(product, /^autor/i))`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd backend && npx tsx --test src/modules/books/seed/publisherFeed.test.ts src/modules/books/seed/importPublisherCovers.test.ts src/modules/books/seed/fillBlankTitles.test.ts src/modules/books/seed/lossyRetitle.test.ts && cd .. && npm run typecheck --workspace backend`
Expected: all pass, including the existing Presença tag tests and `pageAuthors` tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/seed/publisherFeed.ts backend/src/modules/books/seed/publishers.ts backend/src/modules/books/seed/publisherFeed.test.ts
git commit -m "Clean every shop credit of role marks and placeholders, and read Imprensa Nacional's ordered author tags"
```

---

### Task 2: Four page-author extractors behind named rules

**Files:**
- Modify: `backend/src/modules/books/seed/publisherFeed.ts`
- Test: `backend/src/modules/books/seed/publisherFeed.test.ts`

What changes: in publisherFeed.ts, add PageAuthorRule, pageCredit, the four extractors and pageAuthor; pageAuthors uses pageCredit.

**Interfaces:**
- Consumes: `cleanCredit` and the new `distinctNames` (Task 1).
- Produces: `export type PageAuthorRule = "autorLink" | "summaryAuthor" | "productAutor" | "prodMainH4" | "elementorAuthor";`
- Produces: `export function pageAuthor(rule: PageAuthorRule, html: string): string | null`. `"autorLink"` is today's `pageAuthors`.

- [ ] **Step 1: Write the failing tests**

Add `pageAuthor` to the import from `./publisherFeed.js`, then append:

```ts
test("summaryAuthor reads the main product's author links and nothing from the tab or related cards", () => {
  const html = `<h1 class="product_title entry-title">Berengária, o Anjo da Noite</h1><div class="summaryAuthor"><span class="uppercase"><a style="color:#868686 !important; text-decoration: underline;" href="https://www.saidadeemergencia.com/autor/deana-barroqueiro/">Deana Barroqueiro</a></span></div><div class="summaryQuote"><p>…</p></div>
<div class="autor_tab"><h2 class="uppercase poppins-medium"><a href="https://www.saidadeemergencia.com/autor/deana-barroqueiro/">Deana Barroqueiro</a></h2></div>
<div class="autor"><a href="https://www.saidadeemergencia.com/autor/outro-autor/">Outro Autor</a></div>`;
  assert.equal(pageAuthor("summaryAuthor", html), "Deana Barroqueiro");
  assert.equal(pageAuthor("summaryAuthor", `<div class="summaryAuthor"><span class="uppercase"><a style="x" href="https://www.saidadeemergencia.com/autor/a/">Ana Uma</a> e <a style="x" href="https://www.saidadeemergencia.com/autor/b/">Bruno Dois</a></span></div>`), "Ana Uma, Bruno Dois");
  assert.equal(pageAuthor("summaryAuthor", `<div class="autor"><a href="https://www.saidadeemergencia.com/autor/outro/">Outro</a></div>`), null);
});

test("productAutor reads the main credit without role marks, never the related cards or the subtitle", () => {
  const html = `<h1>Pelo Buraco da Fechadura</h1><p class="product-subtitulo">Contos</p><p class="product-autor">Bando dos Gambozinos e Alberto Péssimo (ilustração)</p><div class="no-js-hidden" role="status"></div><p class="card-autor">Outro Autor</p>`;
  assert.equal(pageAuthor("productAutor", html), "Bando dos Gambozinos e Alberto Péssimo");
  assert.equal(pageAuthor("productAutor", `<p class="product-autor">Miguel Barcelos e Porfírio Pinto (coords.)</p>`), "Miguel Barcelos e Porfírio Pinto");
  assert.equal(pageAuthor("productAutor", `<h1>Poemas do Inferno</h1><p class="product-subtitulo">Amadeu Baptista</p><p class="card-autor">Amadeu Baptista</p>`), null);
});

test("prodMainH4 reads the creators in the main block and stops at the description", () => {
  const html = `<div class="prod-main"><h1 class="h2" itemprop="name"><strong>Mesmo Quando Não Me Vês</strong><br/> </h1><a class="autorilust" href="/blogs/autores-mini/marine-guerinat">Marine Guérinat</a><br><h4>Claire Wyniecki</h4> <h4>Hua Ling Xu</h4><h6 class="edicao"></h6></div></div>
<div class="product-description"><ul><li><strong>Tradução</strong> Joana Cabral</li></ul></div><div class="related"><h4>Outro Livro</h4></div>`;
  assert.equal(pageAuthor("prodMainH4", html), "Claire Wyniecki, Hua Ling Xu");
  assert.equal(pageAuthor("prodMainH4", `<div class="prod-main"><h1 class="h2">Em Breve</h1><h6 class="edicao"></h6></div><div class="product-description"></div>`), null);
  assert.equal(pageAuthor("prodMainH4", `<h4>Sem Bloco</h4>`), null);
});

test("elementorAuthor reads the author widget, not the CSS rule or the translator line", () => {
  const html = `<style>.elementor-element.elementor-element-b6a8e18{color:#000}</style><h1 class="product_title entry-title">Amok</h1><div class="woostify-product-content-widget"> <p>Uma crónica de amor luxemburguesa</p> <p>Tradução de Maria Bochicchio</p> </div>
<div class="elementor-element elementor-element-b6a8e18 elementor-widget elementor-widget-text-editor" data-id="b6a8e18" data-element_type="widget" data-widget_type="text-editor.default">
  <div class="elementor-widget-container"> Tullio Forgiarini </div>
</div>
<div class="elementor-element elementor-element-588aaf6 woostify-product-meta"></div>`;
  assert.equal(pageAuthor("elementorAuthor", html), "Tullio Forgiarini");
  assert.equal(pageAuthor("elementorAuthor", `<div class="elementor-element" data-id="b6a8e18" data-element_type="widget"><div class="elementor-widget-container">  </div></div>`), null);
  assert.equal(pageAuthor("elementorAuthor", `<div class="elementor-element" data-id="b6a8e18" data-element_type="widget"><div class="elementor-widget-container"> Vários </div></div>`), null);
});

test("the autorLink rule is the existing pageAuthors", () => {
  assert.equal(pageAuthor("autorLink", PACHINKO_PAGE), "Min Jin Lee");
});
```

(`PACHINKO_PAGE` is already declared in this file by the #286 tests.)

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd backend && npx tsx --test src/modules/books/seed/publisherFeed.test.ts`
Expected: an import error, because `pageAuthor` isn't exported.

- [ ] **Step 3: Implement**

In `publisherFeed.ts`, replace `pageAuthors` and add the rest after it:

```ts
export type PageAuthorRule = "autorLink" | "summaryAuthor" | "productAutor" | "prodMainH4" | "elementorAuthor";

function pageCredit(names: string[]): string | null {
  const credit = distinctNames(names);
  return credit === null ? null : structuredClone(credit);
}

const markupText = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " "));

export function pageAuthors(html: string): string | null {
  const start = html.search(/<main\b/);
  if (start < 0) return null;
  const main = html.slice(start);
  const end = main.search(PRODUCT_END);
  const product = end < 0 ? main : main.slice(0, end);
  return pageCredit([...product.matchAll(AUTHOR_LINK)].filter((link) => AUTHOR_PATH.test(link[1]!)).map((link) => decodeEntities(link[2]!)));
}

function summaryAuthor(html: string): string | null {
  const block = /<div class="summaryAuthor">([\s\S]*?)<\/div>/.exec(html)?.[1];
  return block === undefined ? null : pageCredit([...block.matchAll(/<a\b[^>]*href=["'][^"']*\/autor\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/g)].map((link) => markupText(link[1]!)));
}

function productAutor(html: string): string | null {
  const credit = /<p class="product-autor">([\s\S]*?)<\/p>/.exec(html)?.[1];
  return credit === undefined ? null : pageCredit([markupText(credit)]);
}

function prodMainH4(html: string): string | null {
  const start = html.indexOf('<div class="prod-main">');
  const end = start < 0 ? -1 : html.indexOf('<div class="product-description', start);
  if (end < 0) return null;
  return pageCredit([...html.slice(start, end).matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>/g)].map((heading) => markupText(heading[1]!)));
}

function elementorAuthor(html: string): string | null {
  const credit = /data-id="b6a8e18"[^>]*>\s*<div class="elementor-widget-container">([\s\S]*?)<\/div>/.exec(html)?.[1];
  return credit === undefined ? null : pageCredit([markupText(credit)]);
}

const PAGE_AUTHOR_RULES: Record<PageAuthorRule, (html: string) => string | null> = { autorLink: pageAuthors, summaryAuthor, productAutor, prodMainH4, elementorAuthor };

export function pageAuthor(rule: PageAuthorRule, html: string): string | null {
  return PAGE_AUTHOR_RULES[rule](html);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && npx tsx --test src/modules/books/seed/publisherFeed.test.ts && cd .. && npm run typecheck --workspace backend`
Expected: all pass. The existing `pageAuthors` tests are unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/seed/publisherFeed.ts backend/src/modules/books/seed/publisherFeed.test.ts
git commit -m "Read the main product's author from four more shops' page markup"
```

---

### Task 3: Sites name their page rule; the importer uses it and accepts pages without an ISBN

**Files:**
- Modify: `backend/src/modules/books/seed/publishers.ts`
- Modify: `backend/src/modules/books/seed/importPublisherCovers.ts`
- Modify: `backend/README.md`
- Modify: `docs/publisher-catalog.md`
- Test: `backend/src/modules/books/seed/importPublisherCovers.test.ts`

What changes: in publishers.ts, authorLinks?: boolean becomes pageAuthor?: PageAuthorRule and eight entries change; in importPublisherCovers.ts, the import line, readPage's resolved.push, readAuthorPage, and sameTitle is exported; in the README, the "Authors." paragraph under "Seeding the catalog"; in docs/publisher-catalog.md, the "Author from" cells.

**Interfaces:**
- Consumes: `PageAuthorRule` and `pageAuthor` (Task 2).
- Produces: `PublisherSite.pageAuthor?: PageAuthorRule`.
- Produces: `export function sameTitle(known: string, productTitle: string): boolean` from `importPublisherCovers.ts`. Task 4 uses it.

- [ ] **Step 1: Update the existing tests and write the failing one**

In `importPublisherCovers.test.ts`, change `const relogioLinks: Site = { ...relogio, authorLinks: true };` to `const relogioLinks: Site = { ...relogio, pageAuthor: "autorLink" };`. Replace any other `authorLinks: true` in the file the same way: `rg -n authorLinks backend/src`.

Append at the end of the file:

```ts
const SAIDA_ISBN = "9789897739309";
const SAIDA_URL = "https://www.saidadeemergencia.com/produto/berengaria-o-anjo-da-noite/";
const saida: Site = { name: "Saída de Emergência", origin: "https://www.saidadeemergencia.com", platform: "woocommerce", authorFromVendor: false, pageAuthor: "summaryAuthor" };
const saidaPage = (extra = "") => `<h1 class="product_title entry-title">Berengária, o Anjo da Noite</h1><div class="summaryAuthor"><span class="uppercase"><a style="color:#868686" href="https://www.saidadeemergencia.com/autor/deana-barroqueiro/">Deana Barroqueiro</a></span></div>${extra}`;
const saidaFeeds = (page: string) => ({
  "https://www.saidadeemergencia.com/wp-json/wc/store/v1/products?per_page=100&page=1": { text: JSON.stringify([{ name: "Berengária, o Anjo da Noite", permalink: SAIDA_URL, sku: "", description: "", short_description: "", images: [{ src: `https://www.saidadeemergencia.com/wp-content/uploads/2026/10/${SAIDA_ISBN}.jpg` }], attributes: [] }]) },
  [SAIDA_URL]: { text: page }
});

test("an author page that shows no ISBN still gives a feed-ISBN book its author", async () => {
  const h = await harness({ feeds: saidaFeeds(saidaPage()) });
  const before = publisherBook(h.repo, SAIDA_ISBN, "Berengária, o Anjo da Noite", "");

  const reports = await importPublisherCovers(h.deps, [saida], { dryRun: false });

  assert.equal(h.repo.getBook(before.id)!.author, "Deana Barroqueiro");
  assert.equal(reports["Saída de Emergência"]!.authorPages, 1);
});

test("an author page that shows a different ISBN gives no author", async () => {
  const h = await harness({ feeds: saidaFeeds(saidaPage(`<p>ISBN: 978-989-641-467-2</p>`)) });
  const before = publisherBook(h.repo, SAIDA_ISBN, "Berengária, o Anjo da Noite", "");

  await importPublisherCovers(h.deps, [saida], { dryRun: false });

  assert.equal(h.repo.getBook(before.id)!.author, "");
});

test("a refused author page leaves the book authorless and shows in pagesBlocked", async () => {
  const h = await harness({ feeds: { ...saidaFeeds(""), [SAIDA_URL]: { status: 403, text: "" } } });
  const before = publisherBook(h.repo, SAIDA_ISBN, "Berengária, o Anjo da Noite", "");

  const reports = await importPublisherCovers(h.deps, [saida], { dryRun: false });

  assert.equal(h.repo.getBook(before.id)!.author, "");
  assert.equal(reports["Saída de Emergência"]!.pagesBlocked, 1);
  assert.equal(reports["Saída de Emergência"]!.pagesDeferred, 0);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd backend && npx tsx --test src/modules/books/seed/importPublisherCovers.test.ts`
Expected: a type error, because `pageAuthor` isn't a `PublisherSite` field.

- [ ] **Step 3: Implement**

`publishers.ts`:
- Add `import type { PageAuthorRule } from "./publisherFeed.js";` and replace `authorLinks?: boolean;` with `pageAuthor?: PageAuthorRule;`.
- In the four `authorLinks: true` entries (Relógio d'Água, Gradiva, Guerra & Paz, Penguin Livros), replace it with `pageAuthor: "autorLink"`.
- Change these entries:

```ts
  { name: "Orfeu Negro", origin: "https://orfeunegro.org", platform: "shopify", authorFromVendor: false, pageAuthor: "prodMainH4" },
  { name: "Exclamação", origin: "https://exclamacao.pt", platform: "woocommerce", authorFromVendor: false, pageAuthor: "elementorAuthor" },
  { name: "Edições Afrontamento", origin: "https://www.edicoesafrontamento.pt", platform: "shopify", authorFromVendor: false, pageAuthor: "productAutor" },
  { name: "Saída de Emergência", origin: "https://www.saidadeemergencia.com", platform: "woocommerce", authorFromVendor: false, pageAuthor: "summaryAuthor" },
```

`importPublisherCovers.ts`:
- In the import from `./publisherFeed.js`, replace `pageAuthors` with `pageAuthor`.
- Make `function sameTitle` into `export function sameTitle`.
- In `readPage`, replace `pageAuthor: site.authorLinks ? pageAuthors(response.text) : null` with `pageAuthor: site.pageAuthor ? pageAuthor(site.pageAuthor, response.text) : null`.
- Replace `readAuthorPage` with:

```ts
  const readAuthorPage = async (book: PublisherBook, isbn: string) => {
    const rule = site.pageAuthor;
    if (!rule || book.author || deps.repo.findBookByKey(`isbn:${isbn}`)?.author !== "") return null;
    const page = new URL(book.productUrl);
    if (isDisallowed(page.pathname + page.search, disallow)) return null;
    report.authorPages++;
    try {
      const response = await request(() => deps.fetchText(book.productUrl));
      if (response.status !== 200) {
        if (response.status !== 404) report.pagesBlocked++;
        return null;
      }
      const shown = findPageIsbn(response.text);
      return shown === null || shown === isbn ? pageAuthor(rule, response.text) : null;
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      report.failed++;
      return null;
    }
  };
```

`backend/README.md`: replace the whole "**Authors.**" paragraph with:

```markdown
**Authors.** A book's author comes from the feed when the shop puts it there: Antígona's `vendor`, a WooCommerce `Autor` attribute, Presença's `NOMEAUTOR_` tags, or Imprensa Nacional's `AUTOR_<n>` tags in credit order, else its single `AUTOR` tag (`authorTag` in `seed/publishers.ts`). Otherwise it comes from Open Library, and failing that, for shops with a `pageAuthor` rule, from the product page. The rules read only the main product: `autorLink` takes the `autor_link` anchors to `/autor/` or `/autores/` between `<main` and the first related card (Relógio d'Água, Gradiva, Guerra & Paz, Penguin Livros); `summaryAuthor` the `/autor/` links in `div.summaryAuthor` (Saída de Emergência); `productAutor` the text of `p.product-autor`, never `card-autor` (Edições Afrontamento); `prodMainH4` the `<h4>` lines between `div.prod-main` and the description, which can include an illustrator (Orfeu Negro); `elementorAuthor` the Elementor text widget `b6a8e18` (Exclamação). Every credit, from any source, loses its parenthesised parts (`(org.)`, `(coords.)`, `(ilustração)`, `(Tradução de …)`), and placeholders (`VV. AA.`, `Vários…`, `Autor Desconhecido`, `Diversos`) count as no author; a combined "A e B" credit is kept whole, since " e " also joins surnames. A product whose ISBN comes from the feed or its image file name has its page fetched only when its stored book has no author, and the page's author is used unless the page shows a different ISBN (a page whose ISBN can't be read, or that shows several, counts as showing none; the stored title must still match). These reads are counted in `authorPages`; a refused one in `pagesBlocked`, an unreachable one in `failed`. On every run, an existing book with an empty title or author gets the missing part from its product (never overwriting either), but only when its stored title, if it has one, matches the product's. Each fill is logged as `<site>: identity <isbn> {"title":…,"author":…}` and counted in `identityFilled`; a dry run logs and counts without writing. Books no shop gives an author for are left to `scripts/fill-authors-isbndb.mjs` (see "ISBNdb authors").
```

`docs/publisher-catalog.md`, in the "Author from" column:
- Orfeu Negro / Orfeu Mini: `Open Library` → `Open Library, else the page's `<h4>` lines in `prod-main` (`prodMainH4`); can include an illustrator`
- Imprensa Nacional (INCM): → ``AUTOR_<n>` tags in credit order, else the `AUTOR` tag (`authorTag`); placeholders dropped`
- Exclamação: `Open Library` → `Open Library, else the page's Elementor widget `b6a8e18` (`elementorAuthor`); about ¾ of products have none`
- Edições Afrontamento: → `Open Library, else the page's `p.product-autor` without role marks (`productAutor`)`
- Saída de Emergência: → `Open Library, else the page's `/autor/` links in `div.summaryAuthor` (`summaryAuthor`)`
- Divergência, Kathartika, Pato Lógico: `Open Library` → `Open Library, else ISBNdb (`fill-authors-isbndb.mjs`)`
- Relógio d'Água, Gradiva, Guerra & Paz, Penguin Livros: every `(`authorLinks`)` → `(`pageAuthor: "autorLink"`)`

- [ ] **Step 4: Run the full backend verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && git diff --check`
Expected: all pass. `rg -n authorLinks backend/src backend/README.md docs/publisher-catalog.md` finds nothing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/seed/publishers.ts backend/src/modules/books/seed/importPublisherCovers.ts backend/src/modules/books/seed/importPublisherCovers.test.ts backend/README.md docs/publisher-catalog.md
git commit -m "Give five more shops a page author rule, and accept an author page that shows no ISBN"
```

---

### Task 4: `fill-authors-isbndb.mjs`, a capped and resumable ISBNdb author pass

**Files:**
- Create: `backend/src/modules/books/seed/isbndbAuthors.ts`
- Create: `backend/scripts/fill-authors-isbndb.mjs`
- Test: `backend/src/modules/books/seed/isbndbAuthors.test.ts`
- Modify: `backend/package.json`
- Modify: `backend/README.md`

What changes: the new test file is added to the backend package.json test script right after src/modules/books/seed/lossyRetitle.test.ts; the README gets a new "#### ISBNdb authors" section right after "#### Lossy titles".

**Interfaces:**
- Consumes: `cleanCredit` (Task 1), `sameTitle` (Task 3), `fillMissingIdentity` (`domain/findOrCreate.ts`), `normalizeWords` (`domain/normalize.ts`), and `BookCatalog["search"]`, which returns `CatalogSearchHit[]` whose `result` has `title: string` and `authors: string[]`.
- Produces:
  - `planIsbndbAuthors(db: DatabaseSync, isbndb: Pick<BookCatalog, "search">, options: { max: number; after: string }): Promise<IsbndbAuthorPlan>`
  - `applyIsbndbAuthors(repo: Pick<BooksRepository, "getBook" | "findBookByKey" | "addKey" | "fillIdentity">, plan: IsbndbAuthorPlan): number`
  - `isbndbAuthorReport(plan: IsbndbAuthorPlan, applied: number | null)`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/modules/books/seed/isbndbAuthors.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { CatalogSearchHit } from "../domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "isbndb-authors-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { SourcePausedError, SourceUnavailableError } = await import("../domain/errors.js");
const { catalogTitleKey } = await import("../domain/normalize.js");
const { applyIsbndbAuthors, isbndbAuthorReport, planIsbndbAuthors } = await import("./isbndbAuthors.js");

const NOW = "2026-10-01T00:00:00.000Z";
const CUS = "9789722020527";
const ORIANA = "9789726610458";
const SARAGOCA = "9789723301977";

const hit = (title: string, authors: string[]): CatalogSearchHit => ({ result: { title, authors, year: null, isbn: null, publisher: null, coverUrl: null, genres: [] }, olCoverId: null, source: "isbndb" });

function setup(answers: Record<string, () => Promise<CatalogSearchHit[]>>) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const asked: string[] = [];
  const isbndb = { search: async (query: { isbn: string } | { text: string }) => { const isbn = "isbn" in query ? query.isbn : ""; asked.push(isbn); return answers[isbn] ? answers[isbn]() : []; } };
  const book = (isbn: string | null, title: string, author = "") => repo.createBook({ title, author, isbn, createdBy: "seed" }, isbn ? [`isbn:${isbn}`] : [], NOW);
  return { db, repo, isbndb, asked, book };
}

test("a matching ISBNdb record fills the author and claims the title key", async () => {
  const h = setup({ [CUS]: async () => [hit("Os Cus De Judas", ["António Lobo Antunes"])] });
  const row = h.book(CUS, "Os Cus de Judas");

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });
  assert.equal(h.repo.getBook(row.id)!.author, "");
  const applied = applyIsbndbAuthors(h.repo, plan);

  assert.equal(applied, 1);
  assert.equal(h.repo.getBook(row.id)!.author, "António Lobo Antunes");
  assert.equal(h.repo.getBook(row.id)!.title, "Os Cus de Judas");
  assert.equal(h.repo.findBookByKey(catalogTitleKey("Os Cus de Judas", "António Lobo Antunes")!)?.id, row.id);
  assert.deepEqual(isbndbAuthorReport(plan, applied), { selected: 1, noRecord: 0, noAuthor: 0, titleMismatch: 0, placeholder: 0, commaName: 0, mismatches: [], next: row.id, isbndb: { max: 10, asked: 1, unavailable: 0, notAsked: 0, pausedUntil: null }, fills: [{ id: row.id, isbn: CUS, title: "Os Cus de Judas", author: "António Lobo Antunes" }], wouldFill: 1, applied: 1 });
});

test("a record for another title, a placeholder, no record and no authors fill nothing", async () => {
  const h = setup({
    [CUS]: async () => [hit("Memória de Elefante", ["António Lobo Antunes"])],
    [ORIANA]: async () => [hit("A Fada Oriana", ["VV. AA."])],
    [SARAGOCA]: async () => [hit("Manuscrito Encontrado em Saragoça", [])]
  });
  h.book(CUS, "Os Cus de Judas");
  h.book(ORIANA, "A Fada Oriana");
  h.book(SARAGOCA, "Manuscrito Encontrado em Saragoça");
  h.book("9789720701794", "Espreita como funcionam as coisas");

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

  assert.deepEqual([plan.titleMismatch, plan.placeholder, plan.noAuthor, plan.noRecord, plan.fills.length], [1, 1, 1, 1, 0]);
});

test("books with an author, without an ISBN or without a title are not selected", async () => {
  const h = setup({});
  h.book(CUS, "Os Cus de Judas", "António Lobo Antunes");
  h.book(null, "Sem ISBN");
  h.book(ORIANA, "");

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

  assert.equal(plan.selected, 0);
  assert.deepEqual(h.asked, []);
});

test("--max limits the asks, next is the last book answered, and --after resumes after it", async () => {
  const h = setup({});
  const ids = [h.book(CUS, "Um"), h.book(ORIANA, "Dois"), h.book(SARAGOCA, "Três")].map((row) => row.id).sort();

  const first = await planIsbndbAuthors(h.db, h.isbndb, { max: 2, after: "" });
  assert.deepEqual([first.isbndb.asked, first.isbndb.notAsked, first.next], [2, 1, ids[1]]);

  const second = await planIsbndbAuthors(h.db, h.isbndb, { max: 2, after: first.next! });
  assert.deepEqual([second.selected, second.isbndb.asked, second.next], [1, 1, ids[2]]);
  assert.equal(h.asked.length, 3);
});

test("a pause or an outage stops the pass and next stays at the last book answered", async () => {
  for (const failure of [new SourcePausedError("isbndb", "paused", { retryAt: Date.parse("2026-10-18T00:00:00.000Z") }), new SourceUnavailableError("isbndb", "HTTP 503")]) {
    const h = setup({});
    const rows = [h.book(CUS, "Um"), h.book(ORIANA, "Dois"), h.book(SARAGOCA, "Três")].sort((a, b) => (a.id < b.id ? -1 : 1));
    h.isbndb.search = async (query) => {
      const isbn = "isbn" in query ? query.isbn : "";
      h.asked.push(isbn);
      if (isbn === rows[1]!.isbn) throw failure;
      return [];
    };

    const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

    assert.equal(plan.next, rows[0]!.id);
    assert.equal(h.asked.length, 2);
    assert.equal(plan.isbndb.notAsked, 2);
    if (failure instanceof SourcePausedError) assert.equal(plan.isbndb.pausedUntil, "2026-10-18T00:00:00.000Z");
    else assert.equal(plan.isbndb.unavailable, 1);
  }
});

test("an author filled since the plan was made is not overwritten", async () => {
  const h = setup({ [CUS]: async () => [hit("Os Cus de Judas", ["António Lobo Antunes"])] });
  const row = h.book(CUS, "Os Cus de Judas");
  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });
  h.repo.fillIdentity(row.id, "Os Cus de Judas", "A. Lobo Antunes");

  assert.equal(applyIsbndbAuthors(h.repo, plan), 0);
  assert.equal(h.repo.getBook(row.id)!.author, "A. Lobo Antunes");
});

test("a pause on the first ask keeps next at --after, so the next night resumes there", async () => {
  const h = setup({});
  const rows = [h.book(CUS, "Um"), h.book(ORIANA, "Dois"), h.book(SARAGOCA, "Três")].sort((a, b) => (a.id < b.id ? -1 : 1));
  h.isbndb.search = async () => {
    throw new SourcePausedError("isbndb", "paused", { retryAt: Date.parse("2026-10-18T00:00:00.000Z") });
  };

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: rows[0]!.id });

  assert.equal(plan.next, rows[0]!.id);
  assert.equal(plan.isbndb.asked, 0);
  assert.equal(plan.isbndb.notAsked, 2);
});

test("a name still in Last, First form fills nothing, and the stored translator is not an author", async () => {
  const h = setup({
    [CUS]: async () => [hit("Os Cus de Judas", ["Lobo Antunes, António"])],
    [ORIANA]: async () => [hit("Amok", ["Tullio Forgiarini", "Maria Bochicchio"])]
  });
  const cus = h.book(CUS, "Os Cus de Judas");
  const amok = h.book(ORIANA, "Amok");
  h.db.prepare("UPDATE books SET translator = ? WHERE id = ?").run("Maria Bochicchio", amok.id);

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

  assert.equal(plan.commaName, 1);
  assert.deepEqual(plan.fills.map((fill) => [fill.id, fill.author]), [[amok.id, "Tullio Forgiarini"]]);
  assert.ok(!plan.fills.some((fill) => fill.id === cus.id));
});

test("a title mismatch is listed with ISBNdb's title", async () => {
  const h = setup({ [CUS]: async () => [hit("Memória de Elefante", ["António Lobo Antunes"])] });
  const row = h.book(CUS, "Os Cus de Judas");

  const plan = await planIsbndbAuthors(h.db, h.isbndb, { max: 10, after: "" });

  assert.deepEqual(plan.mismatches, [{ id: row.id, title: "Os Cus de Judas", isbndbTitle: "Memória de Elefante" }]);
});
```

Add `src/modules/books/seed/isbndbAuthors.test.ts` to `backend/package.json`'s `test` script right after `src/modules/books/seed/lossyRetitle.test.ts`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd backend && npx tsx --test src/modules/books/seed/isbndbAuthors.test.ts`
Expected: an import error, because `./isbndbAuthors.js` doesn't exist.

- [ ] **Step 3: Implement**

Create `backend/src/modules/books/seed/isbndbAuthors.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { canonicalIsbn } from "@scripta/shared";
import { SourcePausedError, SourceUnavailableError } from "../domain/errors.js";
import { fillMissingIdentity } from "../domain/findOrCreate.js";
import { normalizeWords } from "../domain/normalize.js";
import type { BookCatalog, BooksRepository } from "../domain/ports.js";
import { sameTitle } from "./importPublisherCovers.js";
import { cleanCredit } from "./publisherFeed.js";

export interface IsbndbAuthorPlan {
  selected: number;
  noRecord: number;
  noAuthor: number;
  titleMismatch: number;
  placeholder: number;
  commaName: number;
  mismatches: Array<{ id: string; title: string; isbndbTitle: string }>;
  next: string | null;
  isbndb: { max: number; asked: number; unavailable: number; notAsked: number; pausedUntil: string | null };
  fills: Array<{ id: string; isbn: string; title: string; author: string }>;
}

const TARGETS_SQL = `SELECT id, title, isbn, translator FROM books WHERE author = '' AND title <> '' AND isbn IS NOT NULL AND isbn <> '' AND id > ? ORDER BY id`;

export async function planIsbndbAuthors(db: DatabaseSync, isbndb: Pick<BookCatalog, "search">, options: { max: number; after: string }): Promise<IsbndbAuthorPlan> {
  const targets = db.prepare(TARGETS_SQL).all(options.after) as unknown as Array<{ id: string; title: string; isbn: string; translator: string | null }>;
  const plan: IsbndbAuthorPlan = { selected: targets.length, noRecord: 0, noAuthor: 0, titleMismatch: 0, placeholder: 0, commaName: 0, mismatches: [], next: options.after || null, isbndb: { max: options.max, asked: 0, unavailable: 0, notAsked: 0, pausedUntil: null }, fills: [] };
  for (const book of targets) {
    const isbn = canonicalIsbn(book.isbn);
    if (plan.isbndb.asked >= options.max) break;
    if (!isbn) {
      plan.next = book.id;
      continue;
    }
    plan.isbndb.asked++;
    let hit;
    try {
      hit = (await isbndb.search({ isbn }))[0]?.result;
    } catch (error) {
      if (error instanceof SourcePausedError) plan.isbndb.pausedUntil = new Date(error.retryAt).toISOString();
      else if (error instanceof SourceUnavailableError) plan.isbndb.unavailable++;
      else throw error;
      plan.isbndb.asked--;
      break;
    }
    plan.next = book.id;
    if (!hit) plan.noRecord++;
    else if (hit.authors.length === 0) plan.noAuthor++;
    else if (!sameTitle(book.title, hit.title)) {
      plan.titleMismatch++;
      plan.mismatches.push({ id: book.id, title: book.title, isbndbTitle: hit.title });
    } else if (hit.authors.some((name) => name.includes(","))) plan.commaName++;
    else {
      const translators = new Set((book.translator ?? "").split(", ").map(normalizeWords).filter(Boolean));
      const author = cleanCredit(hit.authors.filter((name) => !translators.has(normalizeWords(name))).join(", "));
      if (author) plan.fills.push({ id: book.id, isbn, title: book.title, author });
      else plan.placeholder++;
    }
  }
  plan.isbndb.notAsked = targets.length - targets.findIndex((book) => book.id === plan.next) - 1;
  return plan;
}

export function applyIsbndbAuthors(repo: Pick<BooksRepository, "getBook" | "findBookByKey" | "addKey" | "fillIdentity">, plan: IsbndbAuthorPlan): number {
  let applied = 0;
  for (const fill of plan.fills) {
    const row = repo.getBook(fill.id);
    if (row && fillMissingIdentity(repo, row, row.title, fill.author)) applied++;
  }
  return applied;
}

export function isbndbAuthorReport(plan: IsbndbAuthorPlan, applied: number | null) {
  return { ...plan, wouldFill: plan.fills.length, applied };
}
```

Notes for the implementer:
- `notAsked` counts the selected books after `next`. `next` starts at `--after`, which is never among the selected ids (they are all greater), so `findIndex` returns `-1` and it counts them all.
- A name with a comma is one `givenNameFirst` couldn't turn ("Lobo Antunes, António"). Writing it would key the work on the wrong surname, and fills are never overwritten, so the book is counted in `commaName` and left.
- ISBNdb sometimes lists a translator as a contributor, so a name equal to the book's stored `translator` is dropped.
- When a call fails, the counter is decremented, because that ask got no answer. The failure is counted in `unavailable` or `pausedUntil`, and `next` stays at the last book answered, so the next run asks that book again.

Create `backend/scripts/fill-authors-isbndb.mjs`:

```js
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, max: { type: "string" }, after: { type: "string", default: "" } } });
const max = Number(values.max);
if (!Number.isInteger(max) || max < 0) {
  console.error("Usage: node scripts/fill-authors-isbndb.mjs --max N [--after <book id>] [--dry-run]");
  process.exit(1);
}
const dryRun = values["dry-run"];

const ISBNDB_GAP_MS = 1100;

const { env, isbndbConfigured } = await import("../dist/config/env.js");
if (!isbndbConfigured) {
  console.error("ISBNDB_API_KEY is not set.");
  process.exit(1);
}
const { createThrottle } = await import("../dist/modules/books/adapters/http/http.js");
const { createIsbndbCatalog } = await import("../dist/modules/books/adapters/isbndb/isbndbCatalog.js");
const { createIsbndbGate } = await import("../dist/modules/books/adapters/isbndb/isbndbGate.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { applyIsbndbAuthors, isbndbAuthorReport, planIsbndbAuthors } = await import("../dist/modules/books/seed/isbndbAuthors.js");

const gate = createIsbndbGate({ onPause: ({ reason, until }) => console.error(`ISBNdb paused (${reason}) until ${new Date(until).toISOString()}`) });
const isbndb = createIsbndbCatalog(env.ISBNDB_API_KEY, createThrottle(ISBNDB_GAP_MS), gate, false);
const db = dryRun ? new DatabaseSync(env.COVERS_DB_PATH, { readOnly: true }) : openBooksDb();
const plan = await planIsbndbAuthors(db, isbndb, { max, after: values.after });
const applied = dryRun ? null : applyIsbndbAuthors(createSqliteBooksRepository(db), plan);
console.log(JSON.stringify(isbndbAuthorReport(plan, applied), null, 2));
```

`backend/README.md`: add after the "#### Lossy titles" section (before the next `####` heading):

````markdown
#### ISBNdb authors

`scripts/fill-authors-isbndb.mjs` gives an author to books no shop rule could: every book with an empty author, a title and an ISBN, shop or not, in `id` order. It asks ISBNdb `GET /book/{isbn}` (one call per book, the 1.1 s gap, its own gate) and fills the author only when ISBNdb's title matches the stored one, through the same cleaning as shop credits (parentheses out, placeholders dropped). A name ISBNdb still gives as "Last, First" leaves the book alone (`commaName`), and a name equal to the book's stored translator is dropped. Each fill claims the title key and reopens the work's code-only translation "none", like every fill. `--max` is a hard limit on calls; the run stops at ISBNdb's daily pause or on an outage, and the report's `next` is the last book answered, so the next run passes it as `--after` and asks nothing twice. A dry run opens the database read-only but still spends ISBNdb calls, so keep it to a sample. The calls come out of the same daily quota as the server's cover re-checks: run it right after 00:00Z.

```bash
npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && node scripts/fill-authors-isbndb.mjs --dry-run --max 50'
npx -y @railway/cli@latest ssh --project 404b0e4a-701b-47ea-83fc-a82a80ae5094 --environment 39833834-0e18-4dde-a57f-3bf0bf0bab51 --service scripta -- sh -c 'cd /app/backend && setsid node scripts/fill-authors-isbndb.mjs --max 1500 > /data/isbndb-authors.json 2> /data/isbndb-authors.log < /dev/null & sleep 3; echo started'
```

The report has `selected`, `noRecord`, `noAuthor`, `titleMismatch` with `mismatches` (`{ id, title, isbndbTitle }`), `placeholder`, `commaName`, `next`, `isbndb` (`max`, `asked`, `unavailable`, `notAsked`, `pausedUntil`), `fills` (`{ id, isbn, title, author }` each), `wouldFill` and `applied` (`null` on a dry run).
````

- [ ] **Step 4: Run the full backend verify**

Run: `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend && git diff --check && node --check backend/scripts/fill-authors-isbndb.mjs`
Expected: all pass, and the new test file runs in `npm test`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/books/seed/isbndbAuthors.ts backend/src/modules/books/seed/isbndbAuthors.test.ts backend/scripts/fill-authors-isbndb.mjs backend/package.json backend/README.md
git commit -m "Add a capped, resumable ISBNdb pass for authors no shop gives"
```

---

## Production runbook (after the deploy that ships this plan and #295)

Run one job at a time, each with `setsid … < /dev/null &` and its output in `/data`, and hold deploys while any runs. Every fill only fills empty fields. A wrong fill can only be undone by hand from its `identity` log line or the report's `fills`.

1. **Baseline:** `seed-catalog.mjs --status`, and note `blank`.
2. **Importer dry run per shop:** run `node --max-old-space-size=5120 scripts/import-publisher-covers.mjs --dry-run --site "<name>"` for Imprensa Nacional, Saída de Emergência, Edições Afrontamento, Orfeu Negro and Exclamação. For each:
   - check that `skipped` is absent and `pagesDeferred`, `pagesBlocked` and `failed` are 0 (Saída sits behind Cloudflare; a rising `pagesBlocked` means it started refusing);
   - read 20 random `identity` lines: no translator, no related book, no placeholder.
3. **Real importer run for those five shops**, the same commands without `--dry-run`, then `--status` again.
4. **ISBNdb authors, after the next 00:00Z reset:**
   - run `fill-authors-isbndb.mjs --dry-run --max 50` and read its `fills` (no translators, no comma names) and `mismatches` (is the title test too strict?);
   - then run `--max 1500`;
   - if `unavailable` > 0, the run stopped early: run it again the same night with `--after <its next>`;
   - on the following nights, run `--max 1500 --after <previous next>` until `selected` reaches 0. Always pass the last report's `next`, even when it equals the `--after` you gave.
5. **Then:** `--status`; the translation backlog dry run, then the real run with `--max` at `wouldAsk`.
