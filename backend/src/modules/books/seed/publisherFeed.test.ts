import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { feedProducts, feedUrl, findPortugalIsbn, isDisallowed, parseRobots, parseShopifyProducts, parseWooProducts } from "./publisherFeed.js";
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

test("Shopify parsing drops products without an image or a Portugal ISBN", () => {
  const books = parseShopifyProducts(shopify, antigona);
  assert.deepEqual(books.map((book) => book.isbn), ["9789726084945", "9789726084938", "9789726084990", "9789726084679"]);
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

test("WooCommerce parsing finds the ISBN in the image file name, decodes entities and drops the rest", () => {
  const books = parseWooProducts(woo, relogio);
  assert.deepEqual(books.map((book) => book.isbn), ["9789897837579", "9789897837821", "9789897837142", "9789899061330", "9789726085003"]);
  assert.equal(books[0]?.productUrl, "https://www.relogiodagua.pt/produto/guerra-branca-na-frente-artica-do-conflito-mundial/");
  assert.equal(books[3]?.title, "Livro com SKU – Edição & Notas");
  assert.ok(books.every((book) => book.author === null));
  assert.equal(feedProducts(woo, relogio)?.length, 7);
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
});
