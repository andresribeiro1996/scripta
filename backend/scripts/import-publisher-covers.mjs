import { parseArgs } from "node:util";
import sharp from "sharp";

sharp.cache(false);
sharp.concurrency(1);

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false }, site: { type: "string" }, "fill-titles": { type: "boolean", default: false }, "fill-genres": { type: "boolean", default: false } } });

const OPEN_LIBRARY_GAP_MS = 1000;

const { createThrottle, fetchJson } = await import("../dist/modules/books/adapters/http/http.js");
const { parseEditionRecord } = await import("../dist/modules/books/adapters/openlibrary/openLibraryCatalog.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { fillBlankTitles } = await import("../dist/modules/books/seed/fillBlankTitles.js");
const { fillFeedGenres } = await import("../dist/modules/books/seed/feedGenres.js");
const { importPublisherCovers } = await import("../dist/modules/books/seed/importPublisherCovers.js");
const { fetchBytes, fetchText } = await import("../dist/modules/books/seed/siteFetch.js");
const { PUBLISHERS } = await import("../dist/modules/books/seed/publishers.js");
const { createObjectStore } = await import("../dist/storage/createObjectStore.js");

const openLibraryThrottle = createThrottle(OPEN_LIBRARY_GAP_MS);

const openLibrary = (url) => openLibraryThrottle(() => fetchJson("openlibrary", url));

async function lookupOpenLibrary(isbn) {
  const query = new URLSearchParams({ q: `isbn:${isbn}`, fields: "author_name", limit: "1" });
  const data = await openLibrary(`https://openlibrary.org/search.json?${query}`);
  const authors = Array.isArray(data?.docs?.[0]?.author_name) ? data.docs[0].author_name.filter((name) => typeof name === "string") : [];
  const edition = parseEditionRecord(await openLibrary(`https://openlibrary.org/isbn/${isbn}.json`));
  return { title: authors.length > 0 ? edition.title || null : null, author: authors.join(", "), workKey: edition.workKey, languages: edition.languages };
}

const sites = values.site ? PUBLISHERS.filter((site) => site.name === values.site) : PUBLISHERS;
if (sites.length === 0) {
  console.error(`unknown site "${values.site}"; names are: ${PUBLISHERS.map((site) => site.name).join(", ")}`);
  process.exit(1);
}

if (values["fill-titles"] && values["fill-genres"]) {
  console.error("--fill-titles and --fill-genres can't run together");
  process.exit(1);
}

if (values["fill-titles"]) {
  const report = await fillBlankTitles(
    { fetchText, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), repo: createSqliteBooksRepository(openBooksDb()) },
    sites,
    { dryRun: values["dry-run"] }
  );
  console.log(JSON.stringify(report, null, 2));
} else if (values["fill-genres"]) {
  const report = await fillFeedGenres(
    { fetchText, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), repo: createSqliteBooksRepository(openBooksDb()) },
    sites,
    { dryRun: values["dry-run"] }
  );
  console.log(JSON.stringify(report, null, 2));
} else {
  const store = createObjectStore();
  const reports = await importPublisherCovers(
    {
      fetchText,
      fetchBytes,
      lookupOpenLibrary,
      repo: createSqliteBooksRepository(openBooksDb()),
      blobs: { save: (id, extension, bytes) => store.put(`covers/${id}.${extension}`, bytes, "image/webp") },
      now: () => new Date(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (line) => console.error(`${line} rss=${Math.round(process.memoryUsage.rss() / 1048576)}MB`)
    },
    sites,
    { dryRun: values["dry-run"] }
  );
  console.log(JSON.stringify(reports, null, 2));
}
