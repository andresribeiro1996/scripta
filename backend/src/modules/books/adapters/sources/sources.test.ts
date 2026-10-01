import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SourcePausedError } from "../../domain/errors.js";
import { createThrottle, type Throttle } from "../http/http.js";
import { appleArtworkUrl, createAppleSource, parseAppleResults, storefrontsFor } from "./apple.js";
import { createIsbndbGate } from "../isbndb/isbndbGate.js";
import { createIsbndbGet, createIsbndbSource, parseIsbndbBooks } from "./isbndb.js";
import { createOpenLibraryCoverSource } from "./openLibrary.js";

const direct: Throttle = (task) => task();
const gate = createIsbndbGate({ onPause: () => {} });
const acceptAll = () => true;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stub(handler: (url: string, init?: RequestInit) => Response) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    return handler(String(input), init);
  }) as typeof fetch;
  return urls;
}

test("ISBNdb books prefer image_original and skip entries without an image", () => {
  assert.deepEqual(parseIsbndbBooks({ book: { title: "Antídoto", authors: ["José Luís Peixoto"], image: "https://i/s.jpg", image_original: "https://i/o.jpg" } }), [
    { source: "isbndb", url: "https://i/o.jpg", title: "Antídoto", authors: ["José Luís Peixoto"] }
  ]);
  assert.equal(parseIsbndbBooks({ books: [{ title: "No image" }, { title: "Small", image: "https://i/s.jpg" }] }).length, 1);
  assert.deepEqual(parseIsbndbBooks("nonsense"), []);
});

test("ISBNdb lookups send the key and treat 404 as no candidates", async () => {
  let auth: string | null = null;
  const urls = stub((_url, init) => {
    auth = new Headers(init?.headers).get("Authorization");
    return Response.json({ book: { title: "Dune", authors: ["Frank Herbert"], image_original: "https://i/o.jpg" } });
  });
  const source = createIsbndbSource("secret", direct, gate);
  assert.deepEqual(await source.byIsbn("9780441013593"), [{ source: "isbndb", url: "https://i/o.jpg" }]);
  assert.equal(urls[0], "https://api2.isbndb.com/book/9780441013593");
  assert.equal(auth, "secret");
  stub(() => new Response("", { status: 404 }));
  assert.deepEqual(await source.byIsbn("9780441013593"), []);
});

test("ISBNdb title search keeps only accepted books", async () => {
  const urls = stub(() => Response.json({ books: [
    { title: "Dune", authors: ["Frank Herbert"], image: "https://i/1.jpg" },
    { title: "Dune Messiah", authors: ["Frank Herbert"], image: "https://i/2.jpg" }
  ] }));
  const found = await createIsbndbSource("k", direct, gate).byTitle("Dune", "Frank Herbert", (c) => c.title === "Dune");
  assert.deepEqual(found, [{ source: "isbndb", url: "https://i/1.jpg" }]);
  assert.equal(urls[0], "https://api2.isbndb.com/books/Dune?page=1&pageSize=20&column=title");
});

test("Apple artwork is requested at 1400px", () => {
  assert.equal(appleArtworkUrl("https://is1.mzstatic.com/image/thumb/a/b.jpg/100x100bb.jpg"), "https://is1.mzstatic.com/image/thumb/a/b.jpg/1400x1400bb.jpg");
  assert.deepEqual(parseAppleResults({ results: [{ trackName: "Solaris", artistName: "Stanisław Lem", artworkUrl100: "https://x/100x100bb.png" }, { trackName: "No art" }] }), [
    { source: "apple", url: "https://x/1400x1400bb.png", title: "Solaris", authors: ["Stanisław Lem"] }
  ]);
});

test("Apple ISBN lookup walks the storefronts until one answers", async () => {
  const urls = stub((url) => Response.json(url.includes("country=us") ? { results: [] } : { results: [{ trackName: "Orlando", artistName: "Virginia Woolf", artworkUrl100: "https://x/100x100bb.jpg" }] }));
  const found = await createAppleSource(direct).byIsbn("9788325408763");
  assert.deepEqual(found, [{ source: "apple", url: "https://x/1400x1400bb.jpg" }]);
  assert.deepEqual(urls.map((url) => new URL(url).searchParams.get("country")), ["us", "pt"]);
});

test("Apple storefronts follow the ISBN registration group", () => {
  assert.deepEqual(storefrontsFor("978-85-359-0277-8"), ["br", "pt", "us"]);
  assert.deepEqual(storefrontsFor("9786555320015"), ["br", "pt", "us"]);
  assert.deepEqual(storefrontsFor("9789722115520"), ["pt", "br", "us"]);
  assert.deepEqual(storefrontsFor("9789896572549"), ["pt", "br", "us"]);
  assert.deepEqual(storefrontsFor("9780141184272"), ["us"]);
  assert.deepEqual(storefrontsFor("9781501110368"), ["us"]);
  assert.deepEqual(storefrontsFor("9788325408763"), ["us", "pt", "br"]);
  assert.deepEqual(storefrontsFor("9791032700000"), ["us", "pt", "br"]);
  assert.deepEqual(storefrontsFor("8535902775"), ["br", "pt", "us"]);
  assert.deepEqual(storefrontsFor("972211552X"), ["pt", "br", "us"]);
  assert.deepEqual(storefrontsFor("0141184272"), ["us"]);
  assert.deepEqual(storefrontsFor(null), ["us", "pt", "br"]);
  assert.deepEqual(storefrontsFor("not an isbn"), ["us", "pt", "br"]);
});

test("Apple title search sends the title alone and moves on when nothing is accepted", async () => {
  const urls = stub((url) => Response.json(url.includes("country=us")
    ? { results: [{ trackName: "A Quinta dos Animais", artistName: "George Orwell", artworkUrl100: "https://x/100x100bb.jpg" }] }
    : { results: [{ trackName: "Something else", artistName: "Nobody", artworkUrl100: "https://y/100x100bb.jpg" }] }));
  const found = await createAppleSource(direct).byTitle("A Quinta dos Animais", "Paulo Faria, George Orwell", (c) => c.title === "A Quinta dos Animais");
  assert.deepEqual(found, [{ source: "apple", url: "https://x/1400x1400bb.jpg" }]);
  assert.deepEqual(urls.map((url) => new URL(url).searchParams.get("country")), ["us"]);
  const first = new URL(urls[0]!);
  assert.equal(first.searchParams.get("term"), "A Quinta dos Animais");
  assert.equal(first.searchParams.get("media"), "ebook");
});

test("Open Library ISBN covers need no API call; title search maps cover ids", async () => {
  const urls = stub(() => Response.json({ docs: [
    { title: "Dune", author_name: ["Frank Herbert"], cover_i: 42 },
    { title: "Dune", author_name: ["Frank Herbert"] }
  ] }));
  const source = createOpenLibraryCoverSource(direct);
  assert.deepEqual(await source.byIsbn("9780441013593"), [{ source: "openlibrary", url: "https://covers.openlibrary.org/b/isbn/9780441013593-L.jpg?default=false" }]);
  assert.equal(urls.length, 0);
  assert.deepEqual(await source.byTitle("Dune", "Frank Herbert", acceptAll), [{ source: "openlibrary", url: "https://covers.openlibrary.org/b/id/42-L.jpg" }]);
  assert.equal(new URL(urls[0]!).searchParams.get("author"), null);
});

test("cover lookups stay in the normal lane", async () => {
  const lanes: Array<boolean | undefined> = [];
  const recording: Throttle = (task, options) => {
    lanes.push(options?.urgent === true);
    return task();
  };
  stub(() => Response.json({}));
  await createIsbndbSource("k", recording, gate).byIsbn("9780441013593");
  await createAppleSource(recording).byIsbn("9780441013593");
  assert.deepEqual(lanes, [false, false]);
});

test("a call queued behind the one that exhausts the quota never reaches ISBNdb", async () => {
  const urls = stub(() => new Response("Daily quota exceeded", { status: 429 }));
  const pauses: number[] = [];
  const get = createIsbndbGet("k", createThrottle(0), createIsbndbGate({ onPause: ({ until }) => pauses.push(until) }));
  const results = await Promise.allSettled([get("https://api2.isbndb.com/book/1"), get("https://api2.isbndb.com/book/2")]);
  assert.deepEqual(results.map((result) => result.status === "rejected" && result.reason instanceof SourcePausedError), [true, true]);
  assert.equal(urls.length, 1);
  assert.equal(pauses.length, 1);
});
