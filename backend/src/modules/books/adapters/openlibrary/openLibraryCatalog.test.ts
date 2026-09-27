import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SourceUnavailableError } from "../../domain/errors.js";
import type { Throttle } from "../http/http.js";
import { createOpenLibraryCatalog } from "./openLibraryCatalog.js";

const direct: Throttle = (task) => task();
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respond(bodies: unknown[]) {
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    const body = bodies.shift();
    if (body instanceof Error) throw body;
    return Response.json(body);
  }) as typeof fetch;
  return requests;
}

const doc = { key: "/works/OL123W", title: "Ecotopia", author_name: ["Ernest Callenbach"], ratings_average: 3.8, ratings_count: 42 };

test("details come from the matching work", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  const requests = respond([{ docs: [doc] }, { description: { value: "A book summary." }, subjects: ["Science fiction", "Ecology"] }]);
  assert.deepEqual(await catalog.fetchDetails({ isbn: "9780553348477", title: "Ecotopia", author: "Ernest Callenbach" }), {
    summary: "A book summary.",
    rating: 3.8,
    ratingCount: 42,
    sourceUrl: "https://openlibrary.org/works/OL123W",
    genres: ["Science Fiction"]
  });
  assert.equal(new URL(requests[0]!).searchParams.get("isbn"), "9780553348477");

  respond([{ docs: [doc] }, { description: "**Plain summary.** Source: [Wikipedia](https://en.wikipedia.org/wiki/Ecotopia)" }]);
  assert.equal((await catalog.fetchDetails({ isbn: null, title: "ECOTOPIA", author: "Ernest Callenbach" }))?.summary, "Plain summary. Source: Wikipedia");
});

test("details reject mismatches and untrusted keys", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  respond([{ docs: [doc] }]);
  assert.equal(await catalog.fetchDetails({ isbn: null, title: "Different title", author: "Ernest Callenbach" }), null);
  respond([{ docs: [doc] }]);
  assert.equal(await catalog.fetchDetails({ isbn: null, title: "Ecotopia", author: "Different author" }), null);
  respond([{ docs: [{ ...doc, key: "//untrusted.test/work" }] }]);
  assert.equal(await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" }), null);
  respond([{ docs: [] }]);
  assert.equal(await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" }), null);
  assert.equal(await catalog.fetchDetails({ isbn: null, title: "Ecotopia", author: "" }), null);
});

test("details tolerate invalid ratings and an empty work", async () => {
  respond([{ docs: [{ ...doc, ratings_average: 8, ratings_count: -2 }] }, {}]);
  const missing = await createOpenLibraryCatalog(direct).fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  assert.equal(missing?.summary, null);
  assert.equal(missing?.rating, null);
  assert.equal(missing?.ratingCount, 0);
  assert.deepEqual(missing?.genres, []);
});

test("a network failure is reported as unavailable", async () => {
  respond([new TypeError("fetch failed")]);
  await assert.rejects(createOpenLibraryCatalog(direct).fetchDetails({ isbn: "9780553348477", title: "", author: "" }), SourceUnavailableError);
});

test("search maps docs and keeps the Open Library cover id", async () => {
  const requests = respond([{ docs: [
    { key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert"], first_publish_year: 1965, isbn: ["0441013597", "9780441013593"], publisher: ["Ace"], cover_i: 7, subject: [] },
    { key: "/works/OL2W", title: "" }
  ] }]);
  const hits = await createOpenLibraryCatalog(direct).search({ text: "dune" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.result.isbn, "9780441013593");
  assert.equal(hits[0]!.olCoverId, 7);
  assert.equal(new URL(requests[0]!).searchParams.get("q"), "dune");

  const isbnRequests = respond([{ docs: [] }]);
  assert.deepEqual(await createOpenLibraryCatalog(direct).search({ isbn: "9780441013593" }), []);
  assert.equal(new URL(isbnRequests[0]!).searchParams.get("isbn"), "9780441013593");
});
