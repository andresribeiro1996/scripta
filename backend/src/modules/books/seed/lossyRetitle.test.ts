import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { CatalogSearchHit } from "../domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "lossy-retitle-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { SourcePausedError, SourceUnavailableError } = await import("../domain/errors.js");
const { catalogTitleKey, workTitleKey } = await import("../domain/normalize.js");
const { lossyRetitleReport, planLossyRetitles } = await import("./lossyRetitle.js");
const { applyMojibakeRepairs } = await import("./mojibakeRepair.js");

type Site = Parameters<typeof planLossyRetitles>[2][number];

const NOW = "2026-10-01T00:00:00.000Z";
const SHOP: Site = { name: "Loja", origin: "https://loja.test", platform: "shopify", authorFromVendor: false };
const OTHER: Site = { name: "Outra", origin: "https://outra.test", platform: "shopify", authorFromVendor: false };
const FEED = "https://loja.test/products.json?limit=250&page=1";

function product(handle: string, title: string) {
  return { title, handle, vendor: "Loja", body_html: "", variants: [{ barcode: "", sku: "" }], images: [{ src: `https://loja.test/files/${handle}.jpg` }] };
}

const page1 = (products: unknown[]) => ({ status: 200, text: JSON.stringify({ products }) });

const hit = (title: string, authors: string[]): CatalogSearchHit => ({
  result: { title, authors, year: null, isbn: null, publisher: null, coverUrl: null, genres: [] },
  olCoverId: null,
  source: "isbndb"
});

function setup(options: { feeds?: Record<string, { status: number; text: string } | Error>; isbndb?: (isbn: string) => Promise<CatalogSearchHit[]> } = {}) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const requested: string[] = [];
  const asked: string[] = [];
  const deps = {
    sleep: async () => {},
    log: () => {},
    fetchText: async (url: string) => {
      requested.push(url);
      const entry = options.feeds?.[url];
      if (entry instanceof Error) throw entry;
      if (entry) return entry;
      if (url.endsWith("/robots.txt")) return { status: 404, text: "" };
      return { status: 200, text: JSON.stringify({ products: [] }) };
    },
    isbndb: {
      search: async (query: { isbn: string } | { text: string }) => {
        const isbn = "isbn" in query ? query.isbn : "";
        asked.push(isbn);
        return options.isbndb ? options.isbndb(isbn) : [];
      }
    }
  };
  const book = (title: string, author: string, isbn: string | null, publisherUrl?: string) => {
    const keys = [isbn && `isbn:${isbn}`, catalogTitleKey(title, author)].filter((key): key is string => Boolean(key));
    const created = repo.createBook({ title, author, isbn, createdBy: "publisher" }, keys, NOW);
    if (publisherUrl) repo.setPublisherUrl(created.id, publisherUrl);
    return created;
  };
  const stored = (id: string) => ({ ...(db.prepare("SELECT title, author, title_key FROM books WHERE id = ?").get(id) as { title: string; author: string; title_key: string | null }) });
  const dump = () => ["books", "works", "book_keys", "books_fts"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const plan = (max = 10, sites: Site[] = [SHOP]) => planLossyRetitles(db, deps, sites, { max });
  return { db, repo, requested, asked, book, stored, dump, plan };
}

test("the shop's title fixes a publisher book, and ISBNdb isn't asked when nothing is left", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "Pássaro Azul")]) } });
  const target = h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan();
  const report = lossyRetitleReport(plan, null);
  assert.deepEqual(h.asked, []);
  assert.deepEqual(plan.feeds, { Loja: { products: 1, matched: 1 } });
  assert.equal(report.dryRun, true);
  assert.equal(report.applied, null);
  assert.deepEqual(report.retitles, [{ id: target.id, isbn: "9789890000109", from: "P©ssaro Azul — Ana Lima", to: "Pássaro Azul — Ana Lima", source: "publisher" }]);
  assert.deepEqual(plan.stillLossy, []);
});

test("ISBNdb fixes the author the shop's feed couldn't, asked with the ISBN-13", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "Pássaro Azul")]) }, isbndb: async () => [hit("Passaro Azul", ["Inês Duarte"])] });
  const target = h.book("P©ssaro Azul", "In©s Duarte", "972000000X", "https://loja.test/products/passaro");
  const plan = await h.plan();
  assert.deepEqual(h.asked, ["9789720000002"]);
  assert.deepEqual(lossyRetitleReport(plan, null).retitles, [{ id: target.id, isbn: "972000000X", from: "P©ssaro Azul — In©s Duarte", to: "Pássaro Azul — Inês Duarte", source: "publisher+isbndb" }]);
  assert.deepEqual(plan.isbndb, { max: 10, asked: 1, unavailable: 0, notAsked: 0, pausedUntil: null });
});

test("a shop that lists authors gives each name as a candidate", async () => {
  const h = setup({ feeds: { [FEED]: page1([{ ...product("passaro", "Pássaro Azul"), vendor: "Ana Lima, Inês Duarte" }]) } });
  h.book("P©ssaro Azul", "Ana Lima, In©s Duarte", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan(10, [{ ...SHOP, authorFromVendor: true }]);
  assert.deepEqual(h.asked, []);
  assert.deepEqual(plan.books.map((book) => [book.repairedTitle, book.repairedAuthor, book.origin]), [["Pássaro Azul", "Ana Lima, Inês Duarte", "publisher"]]);
});

test("a shop is read when its host matches ignoring www., and products still match by exact URL", async () => {
  const h = setup({ feeds: { "https://www.loja.test/products.json?limit=250&page=1": page1([product("passaro", "Pássaro Azul")]) } });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan(10, [{ ...SHOP, origin: "https://www.loja.test" }, OTHER]);
  assert.ok(h.requested.length > 0 && h.requested.every((url) => url.startsWith("https://www.loja.test/")));
  assert.deepEqual(plan.feeds, { Loja: { products: 1, matched: 0 } });
});

test("a book whose publisher_url is on no known shop goes straight to ISBNdb", async () => {
  const h = setup({ isbndb: async () => [hit("Pássaro Azul", ["Ana Lima"])] });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://fechada.test/products/passaro");
  const plan = await h.plan();
  assert.deepEqual(h.requested, []);
  assert.deepEqual(plan.feeds, {});
  assert.deepEqual(plan.books.map((book) => [book.repairedTitle, book.origin]), [["Pássaro Azul", "isbndb"]]);
});

test("two books at one publisher_url both take the product's title", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "Pássaro Azul")]) } });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://loja.test/products/passaro");
  h.book("P©ssaro Azul", "Rui Costa", "9789890000116", "https://loja.test/products/passaro");
  const plan = await h.plan();
  assert.deepEqual(plan.books.map((book) => book.repairedTitle), ["Pássaro Azul", "Pássaro Azul"]);
  assert.deepEqual(plan.feeds, { Loja: { products: 1, matched: 2 } });
});

test("a shop that can't be read is reported, and its books go to ISBNdb", async () => {
  const h = setup({ feeds: { "https://loja.test/robots.txt": { status: 503, text: "" } }, isbndb: async () => [hit("Pássaro Azul", ["Ana Lima"])] });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan();
  assert.deepEqual(plan.feeds, { Loja: { skipped: "robots.txt answered HTTP 503" } });
  assert.deepEqual(plan.books.map((book) => book.origin), ["isbndb"]);
});

test("--max caps the ISBNdb requests, and the rest count as not asked", async () => {
  const h = setup();
  h.book("P©ssaro 1", "Ana Lima", "9789890000109");
  h.book("P©ssaro 2", "Ana Lima", "9789890000116");
  h.book("P©ssaro 3", "Ana Lima", "9789720000101");
  const plan = await h.plan(2);
  assert.equal(h.asked.length, 2);
  assert.deepEqual(plan.isbndb, { max: 2, asked: 2, unavailable: 0, notAsked: 1, pausedUntil: null });
  assert.deepEqual(plan.stillLossy.map((book) => book.isbndb), ["no record", "no record", "not asked"]);
});

test("--max 0 reads the feeds and asks ISBNdb nothing", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "Pássaro Azul")]) } });
  h.book("P©ssaro Azul", "In©s Duarte", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan(0);
  assert.deepEqual(h.asked, []);
  assert.deepEqual(plan.books.map((book) => book.repairedTitle), ["Pássaro Azul"]);
  assert.deepEqual(plan.isbndb, { max: 0, asked: 0, unavailable: 0, notAsked: 1, pausedUntil: null });
  assert.deepEqual(plan.stillLossy.map((book) => [book.text, book.isbndb]), [["Pássaro Azul — In©s Duarte", "not asked"]]);
});

test("a pause stops the ISBNdb requests and reports when it lifts", async () => {
  const retryAt = Date.parse("2026-10-02T00:00:00.000Z");
  const h = setup({
    isbndb: async () => {
      throw new SourcePausedError("isbndb", "paused", { retryAt });
    }
  });
  h.book("P©ssaro 1", "Ana Lima", "9789890000109");
  h.book("P©ssaro 2", "Ana Lima", "9789890000116");
  const plan = await h.plan();
  assert.equal(h.asked.length, 1);
  assert.deepEqual(plan.isbndb, { max: 10, asked: 1, unavailable: 0, notAsked: 2, pausedUntil: "2026-10-02T00:00:00.000Z" });
  assert.deepEqual(plan.stillLossy.map((book) => book.isbndb), ["not asked", "not asked"]);
});

test("an unavailable answer is counted and the next book is still asked", async () => {
  let calls = 0;
  const h = setup({
    isbndb: async () => {
      calls++;
      if (calls === 1) throw new SourceUnavailableError("isbndb", "HTTP 503", { status: 503 });
      return [hit("Pássaro 2", ["Ana Lima"])];
    }
  });
  h.book("P©ssaro 1", "Ana Lima", "9789890000109");
  h.book("P©ssaro 2", "Ana Lima", "9789890000116");
  const plan = await h.plan();
  assert.deepEqual(plan.isbndb, { max: 10, asked: 2, unavailable: 1, notAsked: 0, pausedUntil: null });
  assert.deepEqual(plan.stillLossy.map((book) => [book.text, book.isbndb]), [["P©ssaro 1 — Ana Lima", "unavailable"]]);
  assert.deepEqual(plan.books.map((book) => book.repairedTitle), ["Pássaro 2"]);
});

test("a book left lossy lists what it was compared against", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "O Pássaro Azul")]) }, isbndb: async () => [hit("Pássaro Azul!", ["Ana Lima"])] });
  const target = h.book("P©ssaro Azul", "Ana Lima", "9789890000109", "https://loja.test/products/passaro");
  const plan = await h.plan();
  assert.deepEqual(plan.stillLossy, [{ id: target.id, isbn: "9789890000109", text: "P©ssaro Azul — Ana Lima", isbndb: "answered", candidates: { titles: ["O Pássaro Azul", "Pássaro Azul!"], authors: ["Ana Lima"] } }]);
  assert.deepEqual(plan.books, []);
});

test("a lossy book with no ISBN and no shop is listed and not asked about", async () => {
  const h = setup();
  const target = h.book("P©ssaro Azul", "Ana Lima", null);
  const plan = await h.plan();
  assert.deepEqual(h.asked, []);
  assert.deepEqual(plan.stillLossy, [{ id: target.id, isbn: null, text: "P©ssaro Azul — Ana Lima", isbndb: "not asked", candidates: { titles: [], authors: [] } }]);
});

test("an unexpected error propagates before anything is written", async () => {
  const h = setup({
    isbndb: async () => {
      throw new RangeError("boom");
    }
  });
  h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  const before = h.dump();
  await assert.rejects(h.plan(), RangeError);
  assert.deepEqual(h.dump(), before);
});

test("a book's work is planned only while it holds the book's old text", async () => {
  const h = setup({ isbndb: async () => [hit("Pássaro Azul", ["Ana Lima"])] });
  const follows = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  const differs = h.book("P©ssaro Azul", "Rui Costa", "9789890000116");
  h.db.prepare("UPDATE works SET title = 'Outro' WHERE id = ?").run(differs.work_id);
  const plan = await h.plan();
  assert.deepEqual(plan.works.map((work) => work.id), [follows.work_id]);
});

test("planning writes nothing", async () => {
  const h = setup({ feeds: { [FEED]: page1([product("passaro", "Pássaro Azul")]) }, isbndb: async () => [hit("Pássaro Azul", ["Inês Duarte"])] });
  h.book("P©ssaro Azul", "In©s Duarte", "9789890000109", "https://loja.test/products/passaro");
  const before = h.dump();
  const plan = await h.plan();
  assert.equal(plan.books.length, 1);
  assert.deepEqual(h.dump(), before);
});

test("applying the plan updates the book, its keys, its search row and its work", async () => {
  const h = setup({ isbndb: async () => [hit("Pássaro Azul", ["Inês Duarte"])] });
  const target = h.book("P©ssaro Azul", "In©s Duarte", "9789890000109");
  const plan = await h.plan();
  const applied = applyMojibakeRepairs(h.db, plan);
  assert.deepEqual(applied, { books: 1, works: 1, skipped: 0 });
  assert.deepEqual(h.stored(target.id), { title: "Pássaro Azul", author: "Inês Duarte", title_key: workTitleKey("Pássaro Azul", "Inês Duarte") });
  assert.equal(h.repo.findBookByKey(catalogTitleKey("Pássaro Azul", "Inês Duarte")!)?.id, target.id);
  assert.deepEqual({ ...(h.db.prepare("SELECT title, author FROM books_fts WHERE book_id = ?").get(target.id) as object) }, { title: "Pássaro Azul", author: "Inês Duarte" });
  assert.deepEqual({ ...(h.db.prepare("SELECT title, author FROM works WHERE id = ?").get(target.work_id) as object) }, { title: "Pássaro Azul", author: "Inês Duarte" });
  assert.equal(lossyRetitleReport(plan, applied).dryRun, false);
  assert.equal((await h.plan()).targets, 0);
});

test("a book edited after planning is skipped when the plan is applied", async () => {
  const h = setup({ isbndb: async () => [hit("Pássaro Azul", ["Ana Lima"])] });
  const target = h.book("P©ssaro Azul", "Ana Lima", "9789890000109");
  const plan = await h.plan();
  h.db.prepare("UPDATE books SET title = 'Editado' WHERE id = ?").run(target.id);
  assert.deepEqual(applyMojibakeRepairs(h.db, plan), { books: 0, works: 1, skipped: 1 });
  assert.equal(h.stored(target.id).title, "Editado");
});
