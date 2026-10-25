import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { SourceUnavailableError } from "../../domain/errors.js";
import type { Throttle } from "../http/http.js";
import { createOpenLibraryCatalog, parseEditionRecord, searchOpenLibraryWorks } from "./openLibraryCatalog.js";

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
      summary: null,
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
    summarySource: null,
    workKey: "/works/OL123W",
    workSummary: "A book summary."
  });
  assert.equal(new URL(requests[0]!).searchParams.get("isbn"), "9780553348477");
  assert.doesNotMatch(new URL(requests[0]!).searchParams.get("fields")!, /number_of_pages_median|first_publish_year|publisher/);

  respond([{ docs: [doc] }, { description: "**Plain summary.** Source: [Wikipedia](https://en.wikipedia.org/wiki/Ecotopia)" }]);
  assert.equal((await catalog.fetchDetails({ isbn: null, title: "ECOTOPIA", author: "Ernest Callenbach" }))?.workSummary, "Plain summary. Source: Wikipedia");
});

test("details carry cleaned subjects from the work record", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  respond([
    { docs: [{ ...doc, author_name: ["Arthur Conan Doyle"] }] },
    { type: { key: "/type/work" }, subject_people: ["Mr. Sherlock Holmes (Fictional character)", "Sherlock Holmes", "Dr. Watson"], subject_places: ["London"], subject_times: ["19th century"], subjects: ["Fiction"] },
    {}
  ]);
  const details = await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  assert.deepEqual(details?.subjects, { person: ["Sherlock Holmes", "Dr. Watson"], place: ["London"], time: ["19th century"] });
});

test("a redirect or missing work record sets no subjects", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  for (const work of [{ type: { key: "/type/redirect" }, location: "/works/OL2W" }, null]) {
    respond([{ docs: [doc] }, work, {}]);
    const details = await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" });
    assert.equal(details?.subjects, undefined);
  }
});

test("an edition's own description wins over the work's", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  const requests = respond([{ docs: [doc] }, { description: "Work text." }, { description: { value: "Edition text." } }]);
  const withEdition = await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  assert.deepEqual([withEdition?.metadata.summary, withEdition?.summarySource, withEdition?.workSummary], ["Edition text.", "openlibrary", "Work text."]);
  assert.equal(requests[2], "https://openlibrary.org/isbn/9780553348477.json");
  respond([{ docs: [doc] }, { description: "Work text." }, null]);
  const withoutEdition = await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  assert.deepEqual([withoutEdition?.metadata.summary, withoutEdition?.summarySource, withoutEdition?.workSummary], [null, null, "Work text."]);
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

test("an edition record gives the series strings Open Library holds for it, and omits the field when there are none", () => {
  const parsed = parseEditionRecord({ title: "Memories of Ice", series: ["Malazan Book of the Fallen (3)", " Penguin classics ", "--", 7, null] });
  assert.deepEqual(parsed.series, [{ name: "Malazan Book of the Fallen", position: "3" }, { name: "Penguin classics", position: null }]);
  for (const record of [{ title: "x" }, { title: "x", series: [] }, { title: "x", series: ["--", 7] }, { title: "x", series: "Penguin classics" }]) assert.equal("series" in parseEditionRecord(record), false, JSON.stringify(record));
});

test("an edition record reads the series strings Open Library really writes", () => {
  const parsed = parseEditionRecord({ series: ["Harry Potter, #1", "Harry Potter, 1", "Dune chronicles -- bk. 1", "The Witcher: Book 0.5"] });
  assert.deepEqual(parsed.series, [
    { name: "Harry Potter", position: "1" },
    { name: "Harry Potter", position: "1" },
    { name: "Dune chronicles", position: "1" },
    { name: "The Witcher", position: "0.5" }
  ]);
});

test("details carry the edition's series strings and the work's series subjects", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  respond([{ docs: [doc] }, { subjects: ["Fantasy", "series:Malazan_Book_of_the_Fallen"] }, { series: ["Penguin classics", "Malazan Book of the Fallen (3)"] }]);
  const details = await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  assert.deepEqual(details?.editionSeries, [{ name: "Penguin classics", position: null }, { name: "Malazan Book of the Fallen", position: "3" }]);
  assert.deepEqual(details?.subjectSeries, [{ name: "Malazan Book of the Fallen", position: null }]);
});

test("details read series subjects from the search doc when the work lists none, and omit empty series", async () => {
  const catalog = createOpenLibraryCatalog(direct);
  respond([{ docs: [{ ...doc, subject: ["series:Dune_Chronicles"] }] }, {}, null]);
  const fromDoc = await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  assert.deepEqual(fromDoc?.subjectSeries, [{ name: "Dune Chronicles", position: null }]);
  assert.equal("editionSeries" in fromDoc!, false);
  respond([{ docs: [doc] }, { subjects: ["Fantasy"] }, { series: [] }]);
  const none = await catalog.fetchDetails({ isbn: "9780553348477", title: "", author: "" });
  assert.equal("subjectSeries" in none!, false);
  assert.equal("editionSeries" in none!, false);
});

test("search carries the series subjects of each doc", async () => {
  respond([{ docs: [
    { key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert"], subject: ["Fantasy", "series:Dune_Chronicles"] },
    { key: "/works/OL2W", title: "Stoner", author_name: ["John Williams"], subject: ["Fiction"] }
  ] }]);
  const hits = await createOpenLibraryCatalog(direct).search({ text: "dune" });
  assert.deepEqual(hits[0]!.subjectSeries, [{ name: "Dune Chronicles", position: null }]);
  assert.equal("subjectSeries" in hits[1]!, false);
});

test("a work search asks for the title and author and keeps only docs with a work key and a title", async () => {
  const requests = respond([{ docs: [{ key: "/works/OL1W", title: "To the Lighthouse", author_name: ["Virginia Woolf"] }, { key: "/books/OL2M", title: "x" }, { key: "/works/OL3W" }] }]);
  assert.deepEqual(await searchOpenLibraryWorks(direct, "To the Lighthouse", "virginia woolf"), [{ key: "/works/OL1W", title: "To the Lighthouse", authors: ["Virginia Woolf"] }]);
  const url = new URL(requests[0]!);
  assert.equal(url.origin + url.pathname, "https://openlibrary.org/search.json");
  assert.match(url.search, /title=To\+the\+Lighthouse/);
  assert.match(url.search, /author=virginia\+woolf/);
  assert.match(url.search, /fields=key%2Ctitle%2Cauthor_name/);
  assert.match(url.search, /limit=10/);
  respond([{}]);
  assert.deepEqual(await searchOpenLibraryWorks(direct, "x", "y"), []);
});

test("a work search without author names gives an empty author list, and a rate limit propagates", async () => {
  respond([{ docs: [{ key: "/works/OL4W", title: "Anonymous" }, { key: "/works/OL5W", title: "Mixed", author_name: ["A", 7, null] }] }]);
  assert.deepEqual(await searchOpenLibraryWorks(direct, "x", "y"), [{ key: "/works/OL4W", title: "Anonymous", authors: [] }, { key: "/works/OL5W", title: "Mixed", authors: ["A"] }]);
  globalThis.fetch = (async () => new Response("slow down", { status: 429 })) as typeof fetch;
  await assert.rejects(searchOpenLibraryWorks(direct, "x", "y"), (error: unknown) => error instanceof SourceUnavailableError && error.status === 429);
  globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  assert.deepEqual(await searchOpenLibraryWorks(direct, "x", "y"), []);
});
