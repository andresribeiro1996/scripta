import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

const USER_AGENT = "Atmyshelf/1.0 (+https://atmyshelf.com)";
const TIMEOUT_MS = 30_000;
const OPEN_LIBRARY_GAP_MS = 1000;

const { SourceUnavailableError } = await import("../dist/modules/books/domain/errors.js");
const { createThrottle, fetchJson } = await import("../dist/modules/books/adapters/http/http.js");
const { openBooksDb } = await import("../dist/modules/books/adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../dist/modules/books/adapters/sqlite/sqliteBooksRepository.js");
const { importPublisherCovers } = await import("../dist/modules/books/seed/importPublisherCovers.js");
const { PUBLISHERS } = await import("../dist/modules/books/seed/publishers.js");
const { createObjectStore } = await import("../dist/storage/createObjectStore.js");

async function guarded(url, read) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429 || res.status >= 500) throw new SourceUnavailableError(new URL(url).hostname, `HTTP ${res.status}`, { status: res.status });
    return await read(res);
  } catch (error) {
    if (error instanceof TypeError || error?.name === "TimeoutError") throw new SourceUnavailableError(new URL(url).hostname, error.message);
    throw error;
  }
}

const fetchText = (url) => guarded(url, async (res) => ({ status: res.status, text: await res.text() }));
const fetchBytes = (url) => guarded(url, async (res) => (res.ok ? Buffer.from(await res.arrayBuffer()) : null));

const openLibraryThrottle = createThrottle(OPEN_LIBRARY_GAP_MS);

const openLibrary = (url) => openLibraryThrottle(() => fetchJson("openlibrary", url));

async function lookupOpenLibrary(isbn) {
  const query = new URLSearchParams({ q: `isbn:${isbn}`, fields: "author_name", limit: "1" });
  const data = await openLibrary(`https://openlibrary.org/search.json?${query}`);
  const authors = Array.isArray(data?.docs?.[0]?.author_name) ? data.docs[0].author_name.filter((name) => typeof name === "string") : [];
  const edition = await openLibrary(`https://openlibrary.org/isbn/${isbn}.json`);
  const title = typeof edition?.title === "string" ? edition.title.trim() : "";
  const workKey = typeof edition?.works?.[0]?.key === "string" ? edition.works[0].key : null;
  return { title: authors.length > 0 ? title || null : null, author: authors.join(", "), workKey };
}

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
    log: (line) => console.error(line)
  },
  PUBLISHERS,
  { dryRun: values["dry-run"] }
);
console.log(JSON.stringify(reports, null, 2));
