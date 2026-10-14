import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "fill-blank-titles-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { fillBlankTitles } = await import("./fillBlankTitles.js");

type Site = Parameters<typeof fillBlankTitles>[1][number];

const SHOP: Site = { name: "Test Shop", origin: "https://shop.test", platform: "shopify", authorFromVendor: false };
const OTHER: Site = { name: "Other Shop", origin: "https://other.test", platform: "shopify", authorFromVendor: false };

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
