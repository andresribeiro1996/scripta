import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import sharp from "sharp";

const scratch = mkdtempSync(join(tmpdir(), "publisher-covers-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError } = await import("../domain/errors.js");
const { importPublisherCovers } = await import("./importPublisherCovers.js");

type Deps = Parameters<typeof importPublisherCovers>[0];
type Site = Parameters<typeof importPublisherCovers>[1][number];

const NOW = new Date("2026-10-01T00:00:00.000Z");
const shopifyFeed = readFileSync(new URL("./fixtures/shopify-products.json", import.meta.url), "utf8");
const wooFeed = readFileSync(new URL("./fixtures/woo-products.json", import.meta.url), "utf8");

const antigona: Site = { name: "Antígona", origin: "https://antigona.pt", platform: "shopify", authorFromVendor: true };
const relogio: Site = { name: "Relógio d'Água", origin: "https://www.relogiodagua.pt", platform: "woocommerce", authorFromVendor: false };
const MUSEU = "9789726084945";
const MUSEU_IMAGE = "https://cdn.shopify.com/s/files/1/1828/7185/files/2026_OMuseudosEsforcosInuteis_CristinaPeriRossi_Antigona.jpg?v=1787562626";
const BARCODE_IMAGE = "https://cdn.shopify.com/s/files/1/0000/0000/files/livro-codigo-de-barras.jpg?v=1";
const GUERRA = "9789897837579";

const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#886644" } }).png().toBuffer();

function shopifyPage(products: object[]) {
  return JSON.stringify({ products });
}

function product(isbn: string, title: string, image: string) {
  return {
    title,
    handle: title.toLowerCase().replace(/\W+/g, "-"),
    vendor: "Some Author",
    variants: [{ barcode: isbn }],
    images: [{ src: image }]
  };
}

async function harness(options: { feeds?: Record<string, { status?: number; text?: string } | Error>; images?: Record<string, Buffer | null | Error>; lookup?: Deps["lookupOpenLibrary"]; beforeImage?: (url: string) => void } = {}) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const files = new Map<string, Buffer>();
  const requests: string[] = [];
  const imageRequests: string[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const lookups: string[] = [];
  const good = await png(500, 750);
  const deps: Deps = {
    fetchText: async (url) => {
      requests.push(url);
      const feed = options.feeds?.[url];
      if (feed instanceof Error) throw feed;
      if (feed) return { status: feed.status ?? 200, text: feed.text ?? "" };
      if (url.endsWith("/robots.txt")) return { status: 200, text: "User-agent: *\nDisallow: /cart\n" };
      if (url.endsWith("&page=1")) return { status: 200, text: url.startsWith("https://antigona.pt") ? shopifyFeed : wooFeed };
      return { status: 200, text: url.includes("/products.json") ? shopifyPage([]) : "[]" };
    },
    fetchBytes: async (url) => {
      requests.push(url);
      imageRequests.push(url);
      options.beforeImage?.(url);
      const image = options.images?.[url];
      if (image instanceof Error) throw image;
      return image === undefined ? good : image;
    },
    lookupOpenLibrary: async (isbn) => {
      lookups.push(isbn);
      return options.lookup ? options.lookup(isbn) : null;
    },
    repo,
    blobs: { save: async (id, extension, bytes) => { files.set(`${id}.${extension}`, bytes); } },
    now: () => NOW,
    sleep: async (ms) => { sleeps.push(ms); },
    log: (line) => { logs.push(line); }
  };
  const imageCount = () => (db.prepare("SELECT COUNT(*) AS n FROM cover_images").get() as { n: number }).n;
  const bookCount = () => (db.prepare("SELECT COUNT(*) AS n FROM books").get() as { n: number }).n;
  return { db, repo, deps, files, requests, imageRequests, sleeps, logs, lookups, imageCount, bookCount };
}

function addBook(repo: ReturnType<typeof createSqliteBooksRepository>, isbn: string, title = "Existing") {
  return repo.createBook({ title, author: "Someone", isbn }, [`isbn:${isbn}`], NOW.toISOString());
}

function addCover(repo: ReturnType<typeof createSqliteBooksRepository>, bookId: string, source: "upload" | "apple", width: number, sourceUrl: string | null, status: "good" | "manual" | "low_res" = "manual") {
  const id = `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`;
  repo.insertImage({ id, book_id: bookId, source, source_url: sourceUrl, width, height: Math.round(width * 1.5), byte_size: 1, created_at: NOW.toISOString() });
  repo.setCover(bookId, { imageId: id, status, checkedAt: NOW.toISOString() });
  return id;
}

test("an existing book gets the publisher cover as a manual cover and loses its upgrade mark", async () => {
  const h = await harness();
  const book = addBook(h.repo, MUSEU);
  h.repo.setUpgradeWanted(book.id, NOW.toISOString());

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  const row = h.repo.getBook(book.id)!;
  const image = h.repo.getImage(row.cover_image_id!)!;
  assert.equal(row.cover_status, "manual");
  assert.equal(row.cover_upgrade_wanted_at, null);
  assert.equal(image.source, "publisher");
  assert.equal(image.source_url, MUSEU_IMAGE);
  assert.equal(h.files.size, 8);
  assert.deepEqual(reports["Antígona"], {
    products: 7,
    books: 4,
    fromPage: 0,
    imageUrlPrefix: "https://cdn.shopify.com/s/files/1/",
    coversSet: 4,
    created: 3,
    noAuthor: 0,
    unchanged: 0,
    rejectedImage: 0,
    failed: 0
  });
  assert.equal(h.logs.length, 1);
});

test("an uploaded cover is never replaced", async () => {
  const h = await harness();
  const book = addBook(h.repo, MUSEU);
  const uploadId = addCover(h.repo, book.id, "upload", 900, null);

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(h.repo.getBook(book.id)!.cover_image_id, uploadId);
  assert.equal(reports["Antígona"]!.unchanged, 1);
  assert.ok(!h.imageRequests.includes(MUSEU_IMAGE));
});

test("a second run changes nothing and stores no new image", async () => {
  const h = await harness();
  await importPublisherCovers(h.deps, [antigona], { dryRun: false });
  const images = h.imageCount();
  h.imageRequests.length = 0;

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.unchanged, 4);
  assert.equal(reports["Antígona"]!.coversSet, 0);
  assert.equal(reports["Antígona"]!.created, 0);
  assert.equal(h.imageCount(), images);
  assert.deepEqual(h.imageRequests, []);
});

test("an image an admin rejected is not stored again", async () => {
  const h = await harness();
  const book = addBook(h.repo, MUSEU);
  h.repo.addRejection(book.id, MUSEU_IMAGE, NOW.toISOString());

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.rejectedImage, 1);
  assert.equal(h.repo.getBook(book.id)!.cover_image_id, null);
  assert.ok(!h.imageRequests.includes(MUSEU_IMAGE));
});

test("a sub-400 image is used only when the book has no cover", async () => {
  const small = await png(300, 450);
  const h = await harness({ images: { [MUSEU_IMAGE]: small, [BARCODE_IMAGE]: small } });
  const bare = addBook(h.repo, MUSEU);
  const covered = addBook(h.repo, "9789726084679");
  const existing = addCover(h.repo, covered.id, "apple", 350, "https://apple.example/cover.jpg", "low_res");

  await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  const row = h.repo.getBook(bare.id)!;
  assert.equal(h.repo.getImage(row.cover_image_id!)!.width, 300);
  assert.equal(row.cover_status, "manual");
  assert.equal(h.repo.getBook(covered.id)!.cover_image_id, existing);
  assert.equal(h.repo.getBook(covered.id)!.cover_status, "low_res");
});

test("a 400 or wider publisher image replaces a worse existing cover", async () => {
  const h = await harness();
  const book = addBook(h.repo, MUSEU);
  addCover(h.repo, book.id, "apple", 350, "https://apple.example/cover.jpg", "low_res");

  await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  const row = h.repo.getBook(book.id)!;
  assert.equal(h.repo.getImage(row.cover_image_id!)!.source, "publisher");
  assert.equal(row.cover_status, "manual");
});

test("a new book takes the vendor as its author", async () => {
  const h = await harness();

  await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  const row = h.repo.findBookByKey(`isbn:${MUSEU}`)!;
  assert.equal(row.title, "O Museu dos Esforços Inúteis");
  assert.equal(row.author, "Cristina Peri Rossi");
  assert.equal(row.cover_status, "manual");
  assert.deepEqual(h.lookups, []);
});

test("a new book without a vendor takes Open Library's edition title and author", async () => {
  const h = await harness({ lookup: async () => ({ title: "Guerra Branca", author: "Bruno Maçães" }) });

  const reports = await importPublisherCovers(h.deps, [relogio], { dryRun: false });

  const row = h.repo.findBookByKey(`isbn:${GUERRA}`)!;
  assert.equal(row.title, "Guerra Branca");
  assert.equal(row.author, "Bruno Maçães");
  assert.equal(reports["Relógio d'Água"]!.created, 6);
  assert.equal(h.lookups.length, 5);
});

test("a new book keeps the shop's title when Open Library has no edition title", async () => {
  const h = await harness({ lookup: async () => ({ title: null, author: "Bruno Maçães" }) });

  await importPublisherCovers(h.deps, [relogio], { dryRun: false });

  const row = h.repo.findBookByKey(`isbn:${GUERRA}`)!;
  assert.equal(row.title, "GUERRA BRANCA — NA FRENTE ÁRTICA DO CONFLITO MUNDIAL");
  assert.equal(row.author, "Bruno Maçães");
});

test("a book with no author anywhere is still created, blank, and gets its cover", async () => {
  const h = await harness();

  const reports = await importPublisherCovers(h.deps, [relogio], { dryRun: false });

  assert.equal(reports["Relógio d'Água"]!.noAuthor, 5);
  assert.equal(reports["Relógio d'Água"]!.created, 6);
  assert.equal(reports["Relógio d'Água"]!.coversSet, 6);
  const row = h.repo.findBookByKey(`isbn:${GUERRA}`)!;
  assert.equal(row.title, "");
  assert.equal(row.author, "");
  assert.equal(row.cover_status, "manual");
  assert.equal(h.repo.getImage(row.cover_image_id!)!.source, "publisher");
});

test("a WooCommerce book with an Autor attribute needs no Open Library lookup", async () => {
  const h = await harness();

  await importPublisherCovers(h.deps, [relogio], { dryRun: false });

  const row = h.repo.findBookByKey("isbn:9789899061354")!;
  assert.equal(row.title, "Livro com Autor");
  assert.equal(row.author, "Raquel Serejo Martins");
  assert.ok(!h.lookups.includes("9789899061354"));
});

test("an Open Library outage counts the book as failed", async () => {
  const h = await harness({ lookup: async () => { throw new SourceUnavailableError("openlibrary", "timeout"); } });

  const reports = await importPublisherCovers(h.deps, [relogio], { dryRun: false });

  assert.equal(reports["Relógio d'Água"]!.failed, 5);
  assert.equal(h.bookCount(), 1);
});

test("a robots rule against the feed skips the site without asking for the feed", async () => {
  const h = await harness({ feeds: { "https://antigona.pt/robots.txt": { text: "User-agent: *\nDisallow: /products.json\n" } } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.match(reports["Antígona"]!.skipped!, /robots/);
  assert.deepEqual(h.requests, ["https://antigona.pt/robots.txt"]);
});

test("a robots rule matching the feed query skips the site", async () => {
  const h = await harness({ feeds: { "https://antigona.pt/robots.txt": { text: "User-agent: *\nDisallow: /*page=\n" } } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.match(reports["Antígona"]!.skipped!, /robots/);
  assert.deepEqual(h.requests, ["https://antigona.pt/robots.txt"]);
});

test("a missing robots.txt means no restrictions", async () => {
  const h = await harness({ feeds: { "https://antigona.pt/robots.txt": { status: 404, text: "" } } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.skipped, undefined);
  assert.equal(reports["Antígona"]!.books, 4);
});

test("a robots.txt that answers another error skips the site", async () => {
  const h = await harness({ feeds: { "https://antigona.pt/robots.txt": { status: 403, text: "" } } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.match(reports["Antígona"]!.skipped!, /403/);
});

test("a feed that is not JSON skips the site", async () => {
  const h = await harness({ feeds: { "https://antigona.pt/products.json?limit=250&page=1": { text: "<html>shop</html>" } } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.skipped, "feed is not JSON");
  assert.equal(h.bookCount(), 0);
});

test("a feed answering an error status skips the site", async () => {
  const h = await harness({ feeds: { "https://antigona.pt/products.json?limit=250&page=1": { status: 500 } } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.match(reports["Antígona"]!.skipped!, /500/);
});

test("a timeout skips that site and the next site still imports", async () => {
  const h = await harness({ feeds: { "https://antigona.pt/robots.txt": new SourceUnavailableError("fetch", "The operation was aborted due to timeout") } });

  const reports = await importPublisherCovers(h.deps, [antigona, relogio], { dryRun: false });

  assert.match(reports["Antígona"]!.skipped!, /timeout/);
  assert.equal(reports["Relógio d'Água"]!.skipped, undefined);
  assert.equal(reports["Relógio d'Água"]!.books, 6);
});

test("a 400 past the last page ends the feed", async () => {
  const page1 = shopifyPage([product(MUSEU, "Um", "https://cdn.example/a/1.jpg")]);
  const h = await harness({ feeds: { "https://antigona.pt/products.json?limit=250&page=1": { text: page1 }, "https://antigona.pt/products.json?limit=250&page=2": { status: 400, text: "{}" } } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.skipped, undefined);
  assert.equal(reports["Antígona"]!.books, 1);
});

test("the image URL prefix stops at the last shared directory", async () => {
  const h = await harness({ lookup: async () => ({ title: "T", author: "A" }) });

  const reports = await importPublisherCovers(h.deps, [relogio], { dryRun: true });

  assert.equal(reports["Relógio d'Água"]!.imageUrlPrefix, "https://www.relogiodagua.pt/wp-content/uploads/2026/09/");
});

test("a dry run writes nothing and fetches no image", async () => {
  const h = await harness({ lookup: async () => ({ title: "T", author: "A" }) });
  addBook(h.repo, MUSEU);

  const reports = await importPublisherCovers(h.deps, [antigona, relogio], { dryRun: true });

  assert.deepEqual(h.imageRequests, []);
  assert.equal(h.imageCount(), 0);
  assert.equal(h.bookCount(), 1);
  assert.equal(h.files.size, 0);
  assert.equal(reports["Antígona"]!.created, 3);
  assert.equal(reports["Antígona"]!.coversSet, 4);
  assert.equal(reports["Relógio d'Água"]!.created, 6);
});

test("an image fetch that is unavailable counts as failed and the run goes on", async () => {
  const h = await harness({ images: { [MUSEU_IMAGE]: new SourceUnavailableError("fetch", "HTTP 503") } });
  const book = addBook(h.repo, MUSEU);

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.failed, 1);
  assert.equal(reports["Antígona"]!.coversSet, 3);
  assert.equal(h.repo.getBook(book.id)!.cover_image_id, null);
});

test("an image that is missing, not an image or not cover-shaped is rejected", async () => {
  const h = await harness({ images: { [MUSEU_IMAGE]: null, [BARCODE_IMAGE]: Buffer.from("not an image"), "https://cdn.shopify.com/s/files/1/1828/7185/files/2026_OMeioeaMassagem_MarshallMcLuhan_Antigona.jpg?v=1790076012": await png(600, 600) } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.rejectedImage, 3);
  assert.equal(reports["Antígona"]!.coversSet, 1);
});

test("requests to one site wait three seconds, or the longer crawl delay", async () => {
  const plain = await harness();
  await importPublisherCovers(plain.deps, [antigona], { dryRun: false });
  assert.equal(plain.sleeps.length, plain.requests.length - 1);
  assert.ok(plain.sleeps.every((ms) => ms === 3000));

  const slow = await harness({ feeds: { "https://antigona.pt/robots.txt": { text: "User-agent: *\nCrawl-delay: 5\n" } } });
  await importPublisherCovers(slow.deps, [antigona], { dryRun: false });
  assert.equal(slow.sleeps.length, slow.requests.length - 1);
  assert.ok(slow.sleeps.every((ms) => ms === 5000));

  const fast = await harness({ feeds: { "https://antigona.pt/robots.txt": { text: "User-agent: *\nCrawl-delay: 1\n" } } });
  await importPublisherCovers(fast.deps, [antigona], { dryRun: false });
  assert.ok(fast.sleeps.every((ms) => ms === 3000));
});

test("a cover set by any publisher is left alone, so a second site's run changes nothing", async () => {
  const first = await harness();
  await importPublisherCovers(first.deps, [antigona], { dryRun: false });
  const images = first.imageCount();
  const other: Site = { name: "Outra", origin: "https://outra.example", platform: "shopify", authorFromVendor: true };
  const feed = shopifyPage([product(MUSEU, "Museu", "https://cdn.example/outra/museu.jpg")]);
  const second = { ...first.deps, fetchText: async (url: string) => (url.endsWith("&page=1") ? { status: 200, text: feed } : first.deps.fetchText(url)) };
  first.imageRequests.length = 0;

  const reports = await importPublisherCovers(second, [other], { dryRun: false });

  assert.equal(reports["Outra"]!.unchanged, 1);
  assert.equal(reports["Outra"]!.coversSet, 0);
  assert.equal(first.imageCount(), images);
  assert.deepEqual(first.imageRequests, []);
});

test("a book that gained an upload cover while its image downloaded is not written", async () => {
  let bookId = "";
  const h = await harness({ beforeImage: (url) => { if (url === MUSEU_IMAGE) addCover(h.repo, bookId, "upload", 900, null); } });
  bookId = addBook(h.repo, MUSEU).id;

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  const row = h.repo.getBook(bookId)!;
  assert.equal(h.repo.getImage(row.cover_image_id!)!.source, "upload");
  assert.equal(reports["Antígona"]!.unchanged, 1);
  assert.equal(h.imageCount(), 1 + 3);
});

test("a sub-400 image is dropped when the book gained a cover while it downloaded", async () => {
  let bookId = "";
  const h = await harness({ images: { [MUSEU_IMAGE]: await png(300, 450) }, beforeImage: (url) => { if (url === MUSEU_IMAGE) addCover(h.repo, bookId, "apple", 800, "https://apple.example/c.jpg", "good"); } });
  bookId = addBook(h.repo, MUSEU).id;

  await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(h.repo.getImage(h.repo.getBook(bookId)!.cover_image_id!)!.source, "apple");
});

test("when two products give one ISBN, the one that matched on the strongest step supplies the image", async () => {
  const weak = { ...product("9789726084000", "Fraco", "https://cdn.example/weak.jpg"), variants: [{}], body_html: `<p>ISBN ${MUSEU}</p>` };
  const strong = { ...product(MUSEU, "Forte", "https://cdn.example/strong.jpg") };
  const h = await harness({
    feeds: {
      "https://antigona.pt/products.json?limit=250&page=1": { text: shopifyPage([weak]) },
      "https://antigona.pt/products.json?limit=250&page=2": { text: shopifyPage([strong]) }
    }
  });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.books, 1);
  assert.deepEqual(h.imageRequests, ["https://cdn.example/strong.jpg"]);
});

const FEED_1 = "https://antigona.pt/products.json?limit=250&page=1";
const unlabelled = (title: string, image: string) => ({ ...product("", title, image), variants: [{}] });
const pageUrl = (title: string) => `https://antigona.pt/products/${title.toLowerCase().replace(/\W+/g, "-")}`;
const isbnPage = (isbn: string) => ({ text: `<html><body><p>ISBN ${isbn}</p></body></html>` });

test("a product without a feed ISBN is resolved from its page and gets its cover", async () => {
  const h = await harness({ feeds: { [FEED_1]: { text: shopifyPage([unlabelled("Sem Codigo", "https://cdn.example/sem.jpg")]) }, [pageUrl("Sem Codigo")]: isbnPage(MUSEU) } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  const row = h.repo.findBookByKey(`isbn:${MUSEU}`)!;
  assert.equal(h.repo.getImage(row.cover_image_id!)!.source_url, "https://cdn.example/sem.jpg");
  assert.equal(row.cover_status, "manual");
  assert.equal(reports["Antígona"]!.fromPage, 1);
  assert.equal(reports["Antígona"]!.books, 1);
  assert.equal(reports["Antígona"]!.coversSet, 1);
});

test("a product with a feed ISBN fetches no page", async () => {
  const h = await harness();

  await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.ok(!h.requests.includes("https://antigona.pt/products/o-museu-dos-esforcos-inuteis"));
  assert.ok(h.requests.includes("https://antigona.pt/products/cartaz-sem-isbn"));
});

test("a page that is unavailable counts as failed and the rest of the site imports", async () => {
  const feed = shopifyPage([unlabelled("Sem Codigo", "https://cdn.example/sem.jpg"), product(MUSEU, "Com Codigo", "https://cdn.example/com.jpg")]);
  const h = await harness({ feeds: { [FEED_1]: { text: feed }, [pageUrl("Sem Codigo")]: new SourceUnavailableError("fetch", "HTTP 503") } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.skipped, undefined);
  assert.equal(reports["Antígona"]!.failed, 1);
  assert.equal(reports["Antígona"]!.books, 1);
  assert.equal(reports["Antígona"]!.fromPage, 0);
  assert.equal(h.repo.getBook(h.repo.findBookByKey(`isbn:${MUSEU}`)!.id)!.cover_status, "manual");
});

test("a page that answers 404 skips the product silently", async () => {
  const h = await harness({ feeds: { [FEED_1]: { text: shopifyPage([unlabelled("Sem Codigo", "https://cdn.example/sem.jpg")]) }, [pageUrl("Sem Codigo")]: { status: 404, text: "" } } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.failed, 0);
  assert.equal(reports["Antígona"]!.books, 0);
});

test("a product path robots disallows is not fetched", async () => {
  const h = await harness({ feeds: { [FEED_1]: { text: shopifyPage([unlabelled("Sem Codigo", "https://cdn.example/sem.jpg")]) }, "https://antigona.pt/robots.txt": { text: "User-agent: *\nDisallow: /products/sem\n" } } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.ok(!h.requests.includes(pageUrl("Sem Codigo")));
  assert.equal(reports["Antígona"]!.books, 0);
});

test("a page match loses to a feed match for the same ISBN", async () => {
  const feed = shopifyPage([unlabelled("Pagina", "https://cdn.example/page.jpg"), product(MUSEU, "Feed", "https://cdn.example/feed.jpg")]);
  const h = await harness({ feeds: { [FEED_1]: { text: feed }, [pageUrl("Pagina")]: isbnPage(MUSEU) } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.equal(reports["Antígona"]!.books, 1);
  assert.equal(reports["Antígona"]!.fromPage, 0);
  assert.deepEqual(h.imageRequests, ["https://cdn.example/feed.jpg"]);
});

test("a dry run fetches product pages but no images and writes nothing", async () => {
  const h = await harness({ feeds: { [FEED_1]: { text: shopifyPage([unlabelled("Sem Codigo", "https://cdn.example/sem.jpg")]) }, [pageUrl("Sem Codigo")]: isbnPage(MUSEU) } });

  const reports = await importPublisherCovers(h.deps, [antigona], { dryRun: true });

  assert.ok(h.requests.includes(pageUrl("Sem Codigo")));
  assert.deepEqual(h.imageRequests, []);
  assert.equal(h.bookCount(), 0);
  assert.equal(h.imageCount(), 0);
  assert.equal(reports["Antígona"]!.fromPage, 1);
  assert.equal(reports["Antígona"]!.coversSet, 1);
});

test("product page requests wait the same time as feed requests", async () => {
  const h = await harness({
    feeds: {
      [FEED_1]: { text: shopifyPage([unlabelled("Sem Codigo", "https://cdn.example/sem.jpg")]) },
      [pageUrl("Sem Codigo")]: isbnPage(MUSEU),
      "https://antigona.pt/robots.txt": { text: "User-agent: *\nCrawl-delay: 5\n" }
    }
  });

  await importPublisherCovers(h.deps, [antigona], { dryRun: false });

  assert.ok(h.requests.includes(pageUrl("Sem Codigo")));
  assert.equal(h.sleeps.length, h.requests.length - 1);
  assert.ok(h.sleeps.every((ms) => ms === 5000));
});
