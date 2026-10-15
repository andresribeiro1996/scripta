import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "feed-genres-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { feedLabelGenres, fillFeedGenres } = await import("./feedGenres.js");

type Site = Parameters<typeof fillFeedGenres>[1][number];
const AT = "2026-10-15T00:00:00.000Z";
const SHOP: Site = { name: "Test Shop", origin: "https://shop.test", platform: "shopify", authorFromVendor: false };
const DOWN: Site = { name: "Down Shop", origin: "https://down.test", platform: "shopify", authorFromVendor: false };
const PAGE1 = "https://shop.test/products.json?limit=250&page=1";

function product(handle: string, isbn: string | null, tags: string[]) {
  return { title: handle, handle, vendor: "Test Shop", body_html: "", product_type: "Livro", tags, variants: [{ barcode: isbn ?? "", sku: "" }], images: [{ src: `https://shop.test/files/${handle}.jpg` }] };
}

function setup(feeds: Record<string, { status: number; text: string }>) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const deps = {
    repo,
    sleep: async () => {},
    fetchText: async (url: string) => feeds[url] ?? (url.endsWith("/robots.txt") ? { status: 404, text: "" } : { status: 200, text: JSON.stringify({ products: [] }) })
  };
  const book = (title: string, isbn: string, url: string | null) => {
    const row = repo.createBook({ title, author: "", isbn, createdBy: "publisher" }, [`isbn:${isbn}`], AT);
    if (url) repo.setPublisherUrl(row.id, url);
    return row.id;
  };
  const genres = (id: string) => (db.prepare("SELECT genres FROM books WHERE id = ?").get(id) as { genres: string }).genres;
  return { db, repo, deps, book, genres };
}

const page = (products: unknown[]) => ({ status: 200, text: JSON.stringify({ products }) });

test("age labels up to 12 and kids tags mean Children's; other numbers don't", () => {
  for (const label of ["+ 3 anos", "+3 anos", "3-5 anos", "10 - 12 anos", "tag_kids"]) assert.deepEqual(feedLabelGenres([label]), ["Children's"], label);
  for (const label of ["+ 13 anos", "100 anos", "Guerra dos 30 anos", "anos 80"]) assert.notDeepEqual(feedLabelGenres([label]), ["Children's"], label);
  assert.deepEqual(feedLabelGenres(["Policial", "Livro"]), ["Mystery"]);
  assert.deepEqual(feedLabelGenres(["Literatura Romântica e Erótica", "+ 6 anos"]), ["Romance", "Children's"]);
});

test("a product labels every book at its URL, else the book with its ISBN, only where genres are empty", () => {
  const h = setup({ [PAGE1]: page([product("hamlet", "9789896414672", ["Policial"]), product("orphan", "9789722031240", ["Poesia"]), product("kids", null, ["+ 3 anos"])]) });
  const first = h.book("Hamlet", "9789896414672", "https://shop.test/products/hamlet");
  const second = h.book("Hamlet 2", "9789896414689", "https://shop.test/products/hamlet");
  const byIsbn = h.book("Orphan", "9789722031240", null);
  const labelled = h.book("Kids", "9789722000000", "https://shop.test/products/kids");
  h.db.prepare("UPDATE books SET genres = ?, genres_source = 'manual' WHERE id = ?").run(JSON.stringify(["Fantasy"]), labelled);
  return fillFeedGenres(h.deps, [SHOP], { dryRun: false }).then((report) => {
    assert.deepEqual(report.sites["Test Shop"], { products: 3, matched: 3, labelled: 3, editions: 3 });
    assert.equal(h.genres(first), JSON.stringify(["Mystery"]));
    assert.equal(h.genres(second), JSON.stringify(["Mystery"]));
    assert.equal(h.genres(byIsbn), JSON.stringify(["Poetry"]));
    assert.equal(h.genres(labelled), JSON.stringify(["Fantasy"]));
  });
});

test("a dry run writes nothing, a repeat labels nothing, a down site is skipped, and unmatched labels are counted", async () => {
  const h = setup({ [PAGE1]: page([product("a", "9789896414672", ["Ensaio", "Policial"]), product("b", "9789896414689", ["Ensaio"])]), "https://down.test/products.json?limit=250&page=1": { status: 500, text: "" } });
  const a = h.book("A", "9789896414672", "https://shop.test/products/a");
  h.book("B", "9789896414689", "https://shop.test/products/b");
  const dry = await fillFeedGenres(h.deps, [SHOP, DOWN], { dryRun: true });
  assert.deepEqual(dry.sites["Test Shop"], { products: 2, matched: 2, labelled: 1, editions: 1 });
  assert.equal(dry.sites["Down Shop"]?.skipped, "feed answered HTTP 500");
  assert.deepEqual(dry.unmatchedLabels, [["Ensaio", 2], ["Livro", 2]]);
  assert.deepEqual(dry.matchedLabels, [["Policial", "Mystery", 1]]);
  assert.equal(h.genres(a), "[]");
  await fillFeedGenres(h.deps, [SHOP], { dryRun: false });
  assert.deepEqual((await fillFeedGenres(h.deps, [SHOP], { dryRun: false })).sites["Test Shop"], { products: 2, matched: 2, labelled: 0, editions: 0 });
});

test("a work reached by two products is counted once, in a dry run and in the real run", async () => {
  const h = setup({ [PAGE1]: page([product("first", "9789896414672", ["Policial"]), product("second", "9789896414672", ["Policial"])]) });
  const id = h.book("Twice", "9789896414672", null);
  const dry = await fillFeedGenres(h.deps, [SHOP], { dryRun: true });
  assert.deepEqual(dry.sites["Test Shop"], { products: 2, matched: 2, labelled: 1, editions: 1 });
  assert.equal(h.genres(id), "[]");
  const real = await fillFeedGenres(h.deps, [SHOP], { dryRun: false });
  assert.deepEqual(real.sites["Test Shop"], { products: 2, matched: 2, labelled: 1, editions: 1 });
});
