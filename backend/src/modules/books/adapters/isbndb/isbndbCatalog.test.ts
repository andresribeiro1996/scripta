import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SourceUnavailableError } from "../../domain/errors.js";
import type { Throttle } from "../http/http.js";
import { createIsbndbCatalog } from "./isbndbCatalog.js";

const direct: Throttle = (task) => task();
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respond(status: number, body: unknown) {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") });
    return Response.json(body, { status });
  }) as typeof fetch;
  return requests;
}

const dune = {
  title: "Dune",
  title_long: "Dune (Dune Chronicles, Book 1)",
  isbn: "0441013597",
  isbn13: "9780441013593",
  publisher: "Ace",
  language: "en",
  date_published: "2005-08-02T00:00:00Z",
  pages: 544,
  overview: "Short overview.",
  image: "https://images.isbndb.com/covers/35/93/9780441013593.jpg",
  synopsis: "<p>Set on the desert planet <b>Arrakis</b>.<br>Paul &amp; Jessica &quot;flee&quot;.</p><p>The spice must flow.</p>",
  authors: ["Frank Herbert"],
  subjects: ["Fiction / Science Fiction / General", "Fiction / Fantasy / Epic"]
};

test("details come from the synopsis and subjects of the ISBN lookup", async () => {
  const requests = respond(200, { book: dune });
  assert.deepEqual(await createIsbndbCatalog("secret", direct).fetchDetails({ isbn: "9780441013593", title: "Dune", author: "Frank Herbert" }), {
    metadata: {
      summary: 'Set on the desert planet Arrakis.\nPaul & Jessica "flee".\nThe spice must flow.',
      rating: null,
      ratingCount: 0,
      sourceUrl: "https://isbndb.com/book/9780441013593",
      genres: ["Fantasy", "Science Fiction"]
    },
    sources: ["isbndb"]
  });
  assert.deepEqual(requests, [{ url: "https://api2.isbndb.com/book/9780441013593", authorization: "secret" }]);
});

test("details fall back to the overview, and need an ISBN and something to show", async () => {
  const requests = respond(200, { book: { isbn: "0441013597", overview: "Short overview.", subjects: ["Unmapped"] } });
  const catalog = createIsbndbCatalog("k", direct);
  const details = await catalog.fetchDetails({ isbn: "0441013597", title: "Dune", author: "Frank Herbert" });
  assert.equal(details?.metadata.summary, "Short overview.");
  assert.equal(details?.metadata.sourceUrl, "https://isbndb.com/book/0441013597");
  assert.deepEqual(details?.metadata.genres, []);

  requests.length = 0;
  assert.equal(await catalog.fetchDetails({ isbn: null, title: "Dune", author: "Frank Herbert" }), null);
  assert.equal(requests.length, 0);

  respond(200, { book: { isbn13: "9780441013593", title: "Dune" } });
  assert.equal(await catalog.fetchDetails({ isbn: "9780441013593", title: "Dune", author: "" }), null);

  respond(404, { errorMessage: "Not Found" });
  assert.equal(await catalog.fetchDetails({ isbn: "9780441013593", title: "Dune", author: "" }), null);
});

test("an ISBNdb failure is a source failure", async () => {
  respond(429, {});
  await assert.rejects(createIsbndbCatalog("k", direct).fetchDetails({ isbn: "9780441013593", title: "", author: "" }), SourceUnavailableError);
});

test("an ISBN search returns the one book", async () => {
  const requests = respond(200, { book: dune });
  assert.deepEqual(await createIsbndbCatalog("k", direct).search({ isbn: "9780441013593" }), [{
    result: {
      title: "Dune",
      authors: ["Frank Herbert"],
      year: 2005,
      isbn: "9780441013593",
      publisher: "Ace",
      coverUrl: null,
      genres: ["Fantasy", "Science Fiction"]
    },
    olCoverId: null,
    source: "isbndb"
  }]);
  assert.equal(requests[0]!.url, "https://api2.isbndb.com/book/9780441013593");
});

test("a text search maps each book and skips the untitled", async () => {
  const requests = respond(200, {
    total: 3,
    books: [dune, { isbn: "1234567890", authors: [] }, { title: "Dune Messiah", isbn13: "9780593098233", date_published: "2019", authors: ["Frank Herbert"], subjects: [] }]
  });
  const hits = await createIsbndbCatalog("k", direct).search({ text: "dune & more" });
  assert.deepEqual(hits.map((hit) => [hit.result.title, hit.result.isbn, hit.result.year, hit.olCoverId]), [
    ["Dune", "9780441013593", 2005, null],
    ["Dune Messiah", "9780593098233", 2019, null]
  ]);
  assert.equal(requests[0]!.url, "https://api2.isbndb.com/books/dune%20%26%20more?page=1&pageSize=20");

  respond(404, {});
  assert.deepEqual(await createIsbndbCatalog("k", direct).search({ text: "nothing" }), []);
});
