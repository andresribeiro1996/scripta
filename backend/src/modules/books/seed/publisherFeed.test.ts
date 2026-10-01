import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { feedProducts, feedUrl, findPageIsbn, findPortugalIsbn, isDisallowed, parseRobots, parseShopifyProducts, parseWooProducts } from "./publisherFeed.js";
import type { PublisherSite } from "./publishers.js";

const shopify = JSON.parse(readFileSync(new URL("./fixtures/shopify-products.json", import.meta.url), "utf8"));
const woo = JSON.parse(readFileSync(new URL("./fixtures/woo-products.json", import.meta.url), "utf8"));

const antigona: PublisherSite = { name: "Antígona", origin: "https://antigona.pt", platform: "shopify", authorFromVendor: true };
const relogio: PublisherSite = { name: "Relógio d'Água", origin: "https://www.relogiodagua.pt", platform: "woocommerce", authorFromVendor: false };

test("findPortugalIsbn reads hyphenated, dotted and file-name ISBNs", () => {
  assert.equal(findPortugalIsbn("ISBN 978-972-608-467-9"), "9789726084679");
  assert.equal(findPortugalIsbn("978.989.9061.31.6"), "9789899061316");
  assert.equal(findPortugalIsbn("978‑972‑608‑494‑5"), "9789726084945");
  assert.equal(findPortugalIsbn("uploads/2026/09/9789897837579-scaled.jpg"), "9789897837579");
});

test("findPortugalIsbn rejects bad checksums and non-Portugal prefixes", () => {
  assert.equal(findPortugalIsbn("978-972-608-467-8"), null);
  assert.equal(findPortugalIsbn("9788535206234"), null);
  assert.equal(findPortugalIsbn("97897260846790"), null);
  assert.equal(findPortugalIsbn("no isbn here"), null);
});

test("findPortugalIsbn skips a Brazilian ISBN that comes first", () => {
  assert.equal(findPortugalIsbn("Edição brasileira 9788535206234, edição portuguesa 9789726084679."), "9789726084679");
});

test("a Shopify product keeps its own ISBN when the description cites another one", () => {
  const books = parseShopifyProducts(shopify, antigona);
  const own = books.find((book) => book.title === "Livro com Código de Barras");
  assert.equal(own?.isbn, "9789726084679");
});

test("a WooCommerce product keeps its own ISBN when the description cites another one", () => {
  const books = parseWooProducts(woo, relogio);
  assert.equal(books.find((book) => book.title === "Capa Citando Outro")?.isbn, "9789726085003");
});

test("Shopify parsing drops products without an image and leaves the ISBN of the rest to the product page", () => {
  const books = parseShopifyProducts(shopify, antigona);
  assert.deepEqual(books.map((book) => book.isbn), ["9789726084945", "9789726084938", "9789726084990", "9789726084679", null, null]);
  assert.equal(feedProducts(shopify, antigona)?.length, 7);
});

test("Shopify parsing builds the product URL and takes the author from the vendor only when allowed", () => {
  const [first] = parseShopifyProducts(shopify, antigona);
  assert.equal(first?.productUrl, "https://antigona.pt/products/o-museu-dos-esforcos-inuteis");
  assert.equal(first?.author, "Cristina Peri Rossi");
  assert.equal(first?.imageUrl, "https://cdn.shopify.com/s/files/1/1828/7185/files/2026_OMuseudosEsforcosInuteis_CristinaPeriRossi_Antigona.jpg?v=1787562626");
  assert.ok(parseShopifyProducts(shopify, { ...antigona, authorFromVendor: false }).every((book) => book.author === null));
  assert.ok(parseShopifyProducts(shopify, { ...antigona, name: "Cristina Peri Rossi" }).every((book) => book.title !== "O Museu dos Esforços Inúteis" || book.author === null));
});

test("WooCommerce parsing finds the ISBN in the image file name, decodes entities and leaves the rest to the product page", () => {
  const books = parseWooProducts(woo, relogio);
  assert.deepEqual(books.map((book) => book.isbn), ["9789897837579", "9789897837821", "9789897837142", "9789899061330", "9789726085003", null, "9789899061354", null]);
  assert.equal(books[0]?.productUrl, "https://www.relogiodagua.pt/produto/guerra-branca-na-frente-artica-do-conflito-mundial/");
  assert.equal(books[3]?.title, "Livro com SKU – Edição & Notas");
  assert.deepEqual(books.map((book) => book.author), [null, null, null, null, null, null, "Raquel Serejo Martins", null]);
  assert.equal(feedProducts(woo, relogio)?.length, 8);
});

test("WooCommerce author joins the terms of an attribute named Autor and ignores other attributes", () => {
  const product = (attributes: object[]) => [{ name: "Livro", permalink: "https://x.example/livro/", sku: "9789726084679", images: [{ src: "https://x.example/a.jpg" }], attributes }];
  const terms = (...names: string[]) => names.map((name) => ({ name }));
  assert.equal(parseWooProducts(product([{ name: "Autores", terms: terms("A B", "C D") }]), relogio)[0]?.author, "A B, C D");
  assert.equal(parseWooProducts(product([{ name: "Autor", terms: terms("Eugene O&#8217;Neill") }]), relogio)[0]?.author, "Eugene O’Neill");
  assert.equal(parseWooProducts(product([{ name: "Tradutor", terms: terms("E F") }]), relogio)[0]?.author, null);
  assert.equal(parseWooProducts(product([{ name: "Autor", terms: [] }]), relogio)[0]?.author, null);
});

test("each book records the lookup step that found its ISBN", () => {
  const shop = parseShopifyProducts(shopify, antigona);
  assert.deepEqual(shop.map((book) => book.rank), [2, 2, 2, 0, 3, 3]);
  const shelf = parseWooProducts(woo, relogio);
  assert.deepEqual(shelf.map((book) => book.rank), [1, 1, 1, 0, 1, 3, 1, 3]);
});

test("parsers return nothing for a body of the wrong shape", () => {
  assert.deepEqual(parseShopifyProducts({ code: "rest_no_route" }, antigona), []);
  assert.deepEqual(parseWooProducts({ products: [] }, relogio), []);
  assert.equal(feedProducts({ code: "rest_no_route" }, relogio), null);
});

test("feedUrl pages each platform", () => {
  assert.equal(feedUrl(antigona, 3), "https://antigona.pt/products.json?limit=250&page=3");
  assert.equal(feedUrl(relogio, 2), "https://www.relogiodagua.pt/wp-json/wc/store/v1/products?per_page=100&page=2");
});

test("parseRobots reads the star group only", () => {
  const robots = [
    "User-agent: Googlebot",
    "Disallow: /google-only",
    "",
    "User-agent: *",
    "Disallow: /cart  # no carts",
    "Disallow: /checkout",
    "Disallow:",
    "Crawl-delay: 3",
    "",
    "User-agent: BadBot",
    "Disallow: /",
    "Crawl-delay: 99"
  ].join("\n");
  assert.deepEqual(parseRobots(robots), { disallow: ["/cart", "/checkout"], crawlDelayMs: 3000 });
});

test("parseRobots joins stacked user agents and reports no delay when none is set", () => {
  assert.deepEqual(parseRobots("User-agent: Bot\nUser-agent: *\nDisallow: /a\n"), { disallow: ["/a"], crawlDelayMs: null });
  assert.deepEqual(parseRobots("User-agent: Bot\nDisallow: /a\n"), { disallow: [], crawlDelayMs: null });
});

test("isDisallowed matches prefixes, wildcards and end anchors", () => {
  assert.equal(isDisallowed("/products.json", ["/products"]), true);
  assert.equal(isDisallowed("/products.json", ["/cart", "/*.json$"]), true);
  assert.equal(isDisallowed("/products.json", ["/*.xml$", "/cart"]), false);
  assert.equal(isDisallowed("/wp-json/wc/store/v1/products", ["/wp-admin/"]), false);
  assert.equal(isDisallowed("/products.json?limit=250&page=1", ["/*page="]), true);
  assert.equal(isDisallowed("/products.json?limit=250&page=1", ["/*sort="]), false);
});

const page = (body: string) => `<html><head><style>.a{content:"9789726084679"}</style><script>var isbn = "9780306406157";</script></head><body>${body}</body></html>`;
const OWN = "9789726084679";
const RELATED = "9789726084945";
const FAR = `<p>${"texto ".repeat(10)}</p>`;

test("findPageIsbn takes the single labelled Portugal ISBN over unlabelled ones", () => {
  assert.equal(findPageIsbn(page(`<p>Relacionado ${RELATED}</p>${FAR}<p>ISBN: <b>978-972-608-467-9</b></p>`)), OWN);
  assert.equal(findPageIsbn(page(`<li>ISBN&nbsp;978&#8209;972&#8209;608&#8209;467&#8209;9</li>${FAR}<li>${RELATED}</li>`)), OWN);
});

test("findPageIsbn takes a single unlabelled Portugal ISBN", () => {
  assert.equal(findPageIsbn(page(`<p>Código ${RELATED}</p><p>Outro ${RELATED}</p>`)), RELATED);
});

test("findPageIsbn gives nothing for two distinct unlabelled Portugal ISBNs", () => {
  assert.equal(findPageIsbn(page(`<p>${RELATED}</p><p>${OWN}</p>`)), null);
});

test("findPageIsbn gives nothing for one Portugal and one Brazilian unlabelled ISBN", () => {
  assert.equal(findPageIsbn(page(`<p>${OWN}</p><p>9788535206234</p>`)), null);
  assert.equal(findPageIsbn(page(`<p>${OWN}</p><p>0-306-40615-2</p>`)), null);
});

test("findPageIsbn gives nothing when the labelled ISBN is foreign, even with a Portugal one elsewhere", () => {
  assert.equal(findPageIsbn(page(`<p>ISBN: 978-84-376-0494-7</p>${FAR}<div class="related">Outro ${RELATED}</div>`)), null);
  assert.equal(findPageIsbn(page(`<p>ISBN 0-306-40615-2</p>${FAR}<div class="related">Outro ${RELATED}</div>`)), null);
  assert.equal(findPageIsbn(page("<p>ISBN 978-85-3520-623-4</p>")), null);
});

test("findPageIsbn reads a labelled ISBN-10 and converts it to ISBN-13", () => {
  assert.equal(findPageIsbn(page(`<p>ISBN 972-608-467-9</p>${FAR}<div>${RELATED}</div>`)), OWN);
});

test("findPageIsbn gives nothing for two distinct labelled ISBNs", () => {
  assert.equal(findPageIsbn(page(`<p>ISBN ${RELATED}</p><p>ISBN: 978-972-608-467-9</p>`)), null);
});

test("findPageIsbn counts an ISBN-10 and its ISBN-13 as the same book", () => {
  assert.equal(findPageIsbn(page("<p>ISBN 972-608-467-9</p><p>ISBN 978-972-608-467-9</p>")), OWN);
});

test("findPageIsbn pins what it returns for a page whose only ISBN is a labelled related book", () => {
  assert.equal(findPageIsbn(page(`<h1>Moeda</h1><div class="related"><p>ISBN: ${RELATED}</p></div>`)), RELATED);
});

test("findPageIsbn reaches an ISBN exactly 40 characters after its label and not 41", () => {
  assert.equal(findPageIsbn(page(`<p>ISBN${"x".repeat(40)}${RELATED}</p><p>${OWN}</p>`)), RELATED);
  assert.equal(findPageIsbn(page(`<p>ISBN${"x".repeat(41)}${RELATED}</p><p>${OWN}</p>`)), null);
});

test("findPageIsbn ignores scripts and styles", () => {
  assert.equal(findPageIsbn(page(`<p>${RELATED}</p>`)), RELATED);
});

test("a feed product whose product page URL cannot be built has no page fallback", () => {
  const product = (permalink: string, sku: string) => [{ name: "Livro", permalink, sku, images: [{ src: "https://x.example/a.jpg" }] }];
  assert.deepEqual(parseWooProducts(product("/produto/livro/", ""), relogio), []);
  assert.equal(parseWooProducts(product("/produto/livro/", "9789726084679"), relogio)[0]?.isbn, "9789726084679");
  assert.equal(parseWooProducts(product("https://x.example/livro/", ""), relogio)[0]?.isbn, null);
});
