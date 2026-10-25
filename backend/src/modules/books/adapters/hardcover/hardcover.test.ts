import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "hardcover-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.TZ = "America/Sao_Paulo";

const { SourceUnavailableError } = await import("../../domain/errors.js");
const { createHardcoverLookup, descriptionText, editionsQuery, featuredSeriesOf, genresFromTags, isbn13To10, parseEditions, seriesPosition } =
  await import("./hardcover.js");
import type { HardcoverBook, HardcoverSeries } from "./hardcover.js";

const series = (name: string, position: number | null = null): HardcoverSeries => ({ name, position, compilation: false });
const book = (overrides: Partial<HardcoverBook> = {}): HardcoverBook => ({
  id: 1,
  usable: true,
  description: null,
  genreTags: [],
  featured: null,
  series: [],
  ...overrides
});
const missing = (): never => assert.fail("expected an edition");
const tags = (counts: Record<string, number>) => Object.entries(counts).map(([tag, count]) => ({ tag, count }));

test("isbn13To10 converts 978 ISBNs only", () => {
  assert.equal(isbn13To10("9780441172719"), "0441172717");
  assert.equal(isbn13To10("9790000000001"), null);
});

test("editionsQuery sends ISBN-10s for 978 ISBNs only", () => {
  const { variables } = editionsQuery(["9780441172719", "9790000000001"]);
  assert.deepEqual(variables.i13, ["9780441172719", "9790000000001"]);
  assert.deepEqual(variables.i10, ["0441172717"]);
});

const bookRow = (extra: Record<string, unknown> = {}) => ({
  id: 7,
  book_status_id: 1,
  canonical_id: null,
  description: "<p>Hi</p>",
  cached_tags: { Genre: [{ tag: "Fantasy", count: 20 }], Mood: [{ tag: "Dark", count: 9 }] },
  cached_featured_series: { series: { name: "Dune" }, position: 1.5, collection: false },
  ...extra
});
const body = (...editions: unknown[]) => ({ data: { editions } });

test("parseEditions reads an edition", () => {
  const [edition = missing()] = parseEditions(body({ isbn_13: "9780441172719", isbn_10: null, book: bookRow() }));
  assert.equal(edition.isbn13, "9780441172719");
  assert.deepEqual(edition.book, {
    id: 7,
    usable: true,
    description: "<p>Hi</p>",
    genreTags: [{ tag: "Fantasy", count: 20 }],
    featured: { name: "Dune", position: 1.5, compilation: false },
    series: []
  });
});

test("parseEditions gives an isbn_10-only edition its ISBN-13", () => {
  const [edition = missing()] = parseEditions(body({ isbn_13: null, isbn_10: "0441172717", book: bookRow() }));
  assert.equal(edition.isbn13, "9780441172719");
});

test("parseEditions marks deleted and deduped books unusable", () => {
  const [a = missing(), b = missing()] = parseEditions(
    body({ isbn_13: "9780441172719", book: bookRow({ book_status_id: 3 }) }, { isbn_13: "9780441172719", book: bookRow({ canonical_id: 9 }) })
  );
  assert.equal(a.book.usable, false);
  assert.equal(b.book.usable, false);
});

test("parseEditions tolerates missing Genre and an empty featured series", () => {
  const [edition = missing()] = parseEditions(body({ isbn_13: "9780441172719", book: bookRow({ cached_tags: {}, cached_featured_series: {} }) }));
  assert.deepEqual(edition.book.genreTags, []);
  assert.equal(edition.book.featured, null);
});

test("parseEditions keeps a null position and the collection flag", () => {
  const [edition = missing()] = parseEditions(
    body({ isbn_13: "9780441172719", book: bookRow({ cached_featured_series: { series: { name: "Omnibus" }, position: null, collection: true } }) })
  );
  assert.deepEqual(edition.book.featured, { name: "Omnibus", position: null, compilation: true });
});

test("parseEditions throws on GraphQL errors", () => {
  assert.throws(() => parseEditions({ errors: [{ message: "bad field" }] }), /GraphQL: bad field/);
});

test("featuredSeriesOf prefers featured, then a sole row", () => {
  assert.equal(featuredSeriesOf(book({ featured: series("A"), series: [series("B")] }))?.name, "A");
  assert.equal(featuredSeriesOf(book({ series: [series("B")] }))?.name, "B");
  assert.equal(featuredSeriesOf(book({ series: [series("B"), series("C")] })), null);
  assert.equal(featuredSeriesOf(book()), null);
});

test("seriesPosition formats without a trailing zero", () => {
  assert.equal(seriesPosition(1), "1");
  assert.equal(seriesPosition(1.5), "1.5");
  assert.equal(seriesPosition(null), null);
});

test("genresFromTags applies the count floor, the combined-tag rule and the limit", () => {
  assert.deepEqual(genresFromTags(tags({ Fantasy: 1 })), []);
  assert.deepEqual(genresFromTags(tags({ "Science Fiction & Fantasy": 5, Fantasy: 20 })), ["Fantasy"]);
  assert.deepEqual(genresFromTags(tags({ "Science Fiction & Fantasy": 50 })), []);
  assert.deepEqual(genresFromTags(tags({ Fantasy: 61, Adventure: 27, "Young Adult": 25 })), ["Fantasy", "Young Adult"]);
  assert.deepEqual(genresFromTags(tags({ Fantasy: 10, Romance: 30, Mystery: 20 })), ["Romance", "Mystery"]);
  assert.deepEqual(genresFromTags(tags({ Adult: 40, Mystery: 3 })), ["Mystery"]);
  assert.deepEqual(genresFromTags(tags({ Romance: 30, Fantasy: 10 })), ["Fantasy", "Romance"]);
});

test("descriptionText strips markup and empties", () => {
  assert.equal(descriptionText("<p>Hello <i>world</i></p>"), "Hello world");
  assert.equal(descriptionText("  \n "), null);
  assert.equal(descriptionText(null), null);
});

const NOW = 1_000_000;
const OK = body({ isbn_13: "9780441172719", book: bookRow() });
const status = (code: number | undefined, retryAt?: number) => new SourceUnavailableError("hardcover", `HTTP ${code}`, { status: code, retryAt });

function harness(results: Array<unknown | Error>) {
  const calls: Array<{ headers?: Record<string, string>; timeoutMs?: number }> = [];
  const sleeps: number[] = [];
  const queue = [...results];
  const lookup = createHardcoverLookup("tok", {
    post: async (_source, _url, _body, headers, timeoutMs) => {
      calls.push({ headers, timeoutMs });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    throttle: (task) => task(),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW
  });
  return { lookup, calls, sleeps };
}

test("lookup sends the token and timeout", async () => {
  const { lookup, calls } = harness([OK]);
  const editions = await lookup(["9780441172719"]);
  assert.equal(editions.length, 1);
  assert.deepEqual(calls[0], { headers: { Authorization: "Bearer tok" }, timeoutMs: 30_000 });
});

test("lookup waits out a short 429", async () => {
  const { lookup, sleeps } = harness([status(429, NOW + 30_000), OK]);
  assert.equal((await lookup(["9780441172719"])).length, 1);
  assert.deepEqual(sleeps, [30_000]);
});

test("lookup waits 60 s on a 429 without retryAt", async () => {
  const { lookup, sleeps } = harness([status(429), OK]);
  await lookup(["9780441172719"]);
  assert.deepEqual(sleeps, [60_000]);
});

test("lookup stops at once on a 429 an hour away", async () => {
  const { lookup, calls, sleeps } = harness([status(429, NOW + 3_600_000), OK]);
  await assert.rejects(lookup(["9780441172719"]), (error: InstanceType<typeof SourceUnavailableError>) => {
    assert.equal(error.quota, true);
    assert.equal(error.status, 429);
    assert.equal(error.retryAt, NOW + 3_600_000);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test("lookup gives up after three 429s", async () => {
  const { lookup, calls } = harness([status(429), status(429), status(429), OK]);
  await assert.rejects(lookup(["9780441172719"]), /429/);
  assert.equal(calls.length, 3);
});

test("lookup retries a 503 three times then throws", async () => {
  const { lookup, calls, sleeps } = harness([status(503), status(503), status(503), status(503), OK]);
  await assert.rejects(lookup(["9780441172719"]), /503/);
  assert.equal(calls.length, 4);
  assert.deepEqual(sleeps, [30_000, 30_000, 30_000]);
});

test("lookup retries a network error", async () => {
  const { lookup, sleeps } = harness([new SourceUnavailableError("hardcover", "fetch failed"), OK]);
  assert.equal((await lookup(["9780441172719"])).length, 1);
  assert.deepEqual(sleeps, [30_000]);
});

test("lookup does not retry a 401, a 400 or a GraphQL error", async () => {
  for (const first of [status(401), status(400), { errors: [{ message: "boom" }] }]) {
    const { lookup, calls, sleeps } = harness([first, OK]);
    await assert.rejects(lookup(["9780441172719"]));
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  }
});
