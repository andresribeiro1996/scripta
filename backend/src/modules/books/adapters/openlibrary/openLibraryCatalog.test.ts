import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SourceUnavailableError } from "../../domain/errors.js";
import type { Throttle } from "../http/http.js";
import { createOpenLibraryCatalog, parseEditionRecord } from "./openLibraryCatalog.js";

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

const doc = { key: "/works/OL123W", title: "Ecotopia", author_name: ["Ernest Callenbach"], ratings_average: 3.8, ratings_count: 42, number_of_pages_median: 311, first_publish_year: 1975, publisher: ["Bantam", "Banyan Tree"] };

test("details come from the matching work", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  const requests = respond([{ docs: [doc] }, { description: { value: "A book summary." }, subjects: ["Science fiction", "Ecology"] }, {}]);
  assert.deepEqual(await catalog.fetchDetails({ isbn: "9780553348477", title: "Ecotopia", author: "Ernest Callenbach" }), {
    metadata: {
      summary: "A book summary.",
      rating: 3.8,
      ratingCount: 42,
      sourceUrl: "https://openlibrary.org/works/OL123W",
      genres: ["Science Fiction"],
      pages: null,
      publisher: null,
      year: null,
      translator: null
    },
    sources: ["openlibrary"],
    summarySource: "openlibrary",
    workKey: "/works/OL123W"
  });
  assert.equal(new URL(requests[0]!).searchParams.get("isbn"), "9780553348477");
  assert.doesNotMatch(new URL(requests[0]!).searchParams.get("fields")!, /number_of_pages_median|first_publish_year|publisher/);

  respond([{ docs: [doc] }, { description: "**Plain summary.** Source: [Wikipedia](https://en.wikipedia.org/wiki/Ecotopia)" }]);
  assert.equal((await catalog.fetchDetails({ isbn: null, title: "ECOTOPIA", author: "Ernest Callenbach" }))?.metadata.summary, "Plain summary. Source: Wikipedia");
});

test("an edition's own description wins over the work's", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  const requests = respond([{ docs: [doc] }, { description: "Work text." }, { description: { value: "Edition text." } }]);
  assert.equal((await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" }))?.metadata.summary, "Edition text.");
  assert.equal(requests[2], "https://openlibrary.org/isbn/9780553348477.json");
  respond([{ docs: [doc] }, { description: "Work text." }, null]);
  assert.equal((await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" }))?.metadata.summary, "Work text.");
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
  respond([{ docs: [{ ...doc, ratings_average: 8, ratings_count: -2, number_of_pages_median: 0, first_publish_year: "1975", publisher: [] }] }, {}, {}]);
  const missing = await createOpenLibraryCatalog(direct).fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  assert.equal(missing?.metadata.summary, null);
  assert.equal(missing?.metadata.rating, null);
  assert.equal(missing?.metadata.ratingCount, 0);
  assert.deepEqual(missing?.metadata.genres, []);
  assert.deepEqual([missing?.metadata.pages, missing?.metadata.publisher, missing?.metadata.year], [null, null, null]);
  assert.equal(missing?.summarySource, null);
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
  assert.equal(hits[0]!.workKey, "/works/OL1W");
  assert.equal(new URL(requests[0]!).searchParams.get("q"), "dune");

  const isbnRequests = respond([{ docs: [] }]);
  assert.deepEqual(await createOpenLibraryCatalog(direct).search({ isbn: "9780441013593" }), []);
  assert.equal(new URL(isbnRequests[0]!).searchParams.get("isbn"), "9780441013593");
});

test("catalog calls use the urgent lane", async () => {
  const lanes: Array<boolean | undefined> = [];
  const recording: Throttle = (task, options) => {
    lanes.push(options?.urgent);
    return task();
  };
  respond([{ docs: [doc] }, {}, {}, { docs: [] }]);
  const catalog = createOpenLibraryCatalog(recording);
  await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  await catalog.search({ text: "dune" });
  assert.deepEqual(lanes, [true, true, true, true]);
});

test("a catalog built for the background uses the normal lane", async () => {
  const lanes: Array<boolean | undefined> = [];
  const recording: Throttle = (task, options) => {
    lanes.push(options?.urgent);
    return task();
  };
  respond([{ docs: [doc] }, {}, {}]);
  await createOpenLibraryCatalog(recording, false).fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  assert.deepEqual(lanes, [false, false, false]);
});

test("an edition record gives its title, its work and its languages as Open Library writes them", () => {
  const record = {
    key: "/books/OL40216430M",
    title: "  Hábitos Atômicos ",
    works: [{ key: "/works/OL17930368W" }],
    languages: [{ key: "/languages/por" }, { key: "/languages/eng" }],
    authors: [{ key: "/authors/OL7324898A" }],
    isbn_13: ["9788550807560"]
  };
  assert.deepEqual(parseEditionRecord(record), { title: "Hábitos Atômicos", workKey: "/works/OL17930368W", languages: ["/languages/por", "/languages/eng"] });
});

test("an edition record with no work or language, or that is not a record at all, parses as empty", () => {
  assert.deepEqual(parseEditionRecord({ title: "Só o título" }), { title: "Só o título", workKey: null, languages: [] });
  assert.deepEqual(parseEditionRecord({ works: [{}], languages: [{ key: 7 }, null, "por", { key: "/languages/por" }] }), { title: "", workKey: null, languages: ["/languages/por"] });
  for (const nothing of [null, undefined, "nonsense", 3, []]) assert.deepEqual(parseEditionRecord(nothing), { title: "", workKey: null, languages: [] }, String(nothing));
});

test("an edition record comes from /isbn/, and an ISBN Open Library doesn't know is null", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  const requests = respond([{ title: "Os Maias", works: [{ key: "/works/OL846513W" }], languages: [{ key: "/languages/por" }] }]);
  assert.deepEqual(await catalog.fetchEditionRecord("9789725681367"), { title: "Os Maias", workKey: "/works/OL846513W", languages: ["/languages/por"] });
  assert.deepEqual(requests, ["https://openlibrary.org/isbn/9789725681367.json"]);
  globalThis.fetch = (async () => new Response("<html>not found</html>", { status: 404 })) as typeof fetch;
  assert.equal(await catalog.fetchEditionRecord("9789722541701"), null);
});

test("a rate-limited edition record lookup is unavailable with its retry time", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  globalThis.fetch = (async () => new Response("slow down", { status: 429, headers: { "retry-after": "60" } })) as typeof fetch;
  await assert.rejects(catalog.fetchEditionRecord("9789725681367"), (error: unknown) => error instanceof SourceUnavailableError && error.status === 429 && typeof error.retryAt === "number");
});
