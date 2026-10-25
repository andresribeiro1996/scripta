import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";
import type { BooksRepository } from "../domain/ports.js";

const scratch = mkdtempSync(join(tmpdir(), "wikidata-match-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("../adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("../adapters/sqlite/sqliteBooksRepository.js");
const { SourceUnavailableError } = await import("../domain/errors.js");
const { createWorkFetcher, matchWorkIds } = await import("./wikidataMatch.js");

const AT = "2026-10-24T12:00:00.000Z";

function setup() {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  return createSqliteBooksRepository(db);
}

function book(repo: BooksRepository, isbn: string | null, title: string, workKey?: string) {
  return repo.createBook({ title, author: "Author", isbn, workKey }, isbn ? [`isbn:${isbn}`] : [`ta:${title.toLowerCase()}|author|`], AT);
}

const row = (ids: { isbns?: string[]; olWorkIds?: string[] }) => ({ isbns: ids.isbns ?? [], olWorkIds: ids.olWorkIds ?? [] });

const redirect = (from: string, to: string) => ({ key: `/works/${from}`, type: { key: "/type/redirect" }, location: `/works/${to}` });

function openLibraryWorks(bodies: Record<string, unknown>) {
  const asked: string[] = [];
  return {
    asked,
    fetchWork: async (key: string) => {
      asked.push(key);
      const body = bodies[key] ?? null;
      if (body instanceof Error) throw body;
      return body;
    }
  };
}

test("matchWorkIds matches by ISBN and by Open Library ID", async () => {
  const repo = setup();
  const dune = book(repo, "9780441013593", "Dune");
  const emma = book(repo, "9780141439587", "Emma", "OL66554W");
  const result = await matchWorkIds(repo, openLibraryWorks({}).fetchWork, [
    row({ isbns: ["0-441-01359-7"] }),
    row({ olWorkIds: ["OL66554W"] }),
    row({ isbns: ["978-0-14-143958-7", "9780000000002"], olWorkIds: ["OL66554W", "OL1W"] }),
    row({ isbns: ["9780441013593"], olWorkIds: ["OL66554W"] }),
    row({})
  ]);
  assert.deepEqual(result.workIds, [new Set([dune.work_id]), new Set([emma.work_id]), new Set([emma.work_id]), new Set([dune.work_id, emma.work_id]), new Set()]);
  assert.deepEqual([result.redirected, result.failedKeys], [0, []]);
});

test("matchWorkIds follows a redirect through two hops", async () => {
  const repo = setup();
  const target = book(repo, null, "Two hops", "OL3W");
  book(repo, null, "Three hops", "OL7W");
  const near = openLibraryWorks({ OL1W: redirect("OL1W", "OL2W"), OL2W: redirect("OL2W", "OL3W") });
  const reached = await matchWorkIds(repo, near.fetchWork, [row({ olWorkIds: ["OL1W"] })]);
  assert.deepEqual(reached.workIds, [new Set([target.work_id])]);
  assert.equal(reached.redirected, 1);
  assert.deepEqual(near.asked, ["OL1W", "OL2W"]);
  const far = openLibraryWorks({ OL4W: redirect("OL4W", "OL5W"), OL5W: redirect("OL5W", "OL6W"), OL6W: redirect("OL6W", "OL7W") });
  const missed = await matchWorkIds(repo, far.fetchWork, [row({ olWorkIds: ["OL4W"] })]);
  assert.deepEqual(missed.workIds, [new Set()]);
  assert.equal(missed.redirected, 0);
  assert.deepEqual(far.asked, ["OL4W", "OL5W"]);
});

test("a 404 or a non-redirect record matches nothing", async () => {
  const repo = setup();
  book(repo, null, "Catalog work", "OL9W");
  const { asked, fetchWork } = openLibraryWorks({
    OL1W: { key: "/works/OL1W", type: { key: "/type/work" }, title: "Plain" },
    OL3W: { key: "/works/OL3W", type: { key: "/type/delete" } },
    OL4W: { key: "/works/OL4W", type: { key: "/type/redirect" }, location: "/authors/OL1A" },
    OL5W: "not a record",
    OL6W: { key: "/works/OL6W", type: { key: "/type/work" }, location: "/works/OL9W" }
  });
  const result = await matchWorkIds(repo, fetchWork, [row({ olWorkIds: ["OL1W", "OL2W", "OL3W", "OL4W", "OL5W", "OL6W"] })]);
  assert.deepEqual(result, { workIds: [new Set()], redirected: 0, failedKeys: [] });
  assert.deepEqual(asked, ["OL1W", "OL2W", "OL3W", "OL4W", "OL5W", "OL6W"]);
});

test("a non-429 failure goes to failedKeys and a 429 is rethrown", async () => {
  const repo = setup();
  const target = book(repo, null, "Target", "OL30W");
  const { fetchWork } = openLibraryWorks({
    OL31W: new SourceUnavailableError("openlibrary", "HTTP 503", { status: 503 }),
    OL32W: new SourceUnavailableError("openlibrary", "timeout"),
    OL33W: redirect("OL33W", "OL30W"),
    OL41W: redirect("OL41W", "OL42W"),
    OL42W: new SourceUnavailableError("openlibrary", "HTTP 502", { status: 502 })
  });
  const rows = [row({ olWorkIds: ["OL31W"] }), row({ olWorkIds: ["OL32W"] }), row({ olWorkIds: ["OL33W"] }), row({ olWorkIds: ["OL41W"] })];
  const result = await matchWorkIds(repo, fetchWork, rows);
  assert.deepEqual(result, { workIds: [new Set(), new Set(), new Set([target.work_id]), new Set()], redirected: 1, failedKeys: ["OL31W", "OL32W", "OL41W"] });
  const limited = openLibraryWorks({ OL31W: new SourceUnavailableError("openlibrary", "HTTP 429", { status: 429 }) });
  await assert.rejects(matchWorkIds(repo, limited.fetchWork, rows), (error: unknown) => error instanceof SourceUnavailableError && error.status === 429);
  const broken = openLibraryWorks({ OL31W: new TypeError("boom") });
  await assert.rejects(matchWorkIds(repo, broken.fetchWork, rows), TypeError);
});

test("each Open Library key is fetched once", async () => {
  const repo = setup();
  const target = book(repo, null, "Target", "OL3W");
  book(repo, null, "Held", "OL10W");
  const chain = openLibraryWorks({ OL1W: redirect("OL1W", "OL2W"), OL2W: redirect("OL2W", "OL3W") });
  const result = await matchWorkIds(repo, chain.fetchWork, [row({ olWorkIds: ["OL1W", "OL10W"] }), row({ olWorkIds: ["OL2W"] }), row({ olWorkIds: ["OL1W"] })]);
  assert.deepEqual(chain.asked, ["OL1W", "OL2W"]);
  assert.deepEqual(result.workIds.map((ids) => ids.size), [2, 1, 1]);
  assert.equal(result.redirected, 2);
  assert.ok(result.workIds[1]!.has(target.work_id!));
  const failing = openLibraryWorks({ OL11W: redirect("OL11W", "OL12W"), OL12W: new SourceUnavailableError("openlibrary", "HTTP 503", { status: 503 }) });
  const failed = await matchWorkIds(repo, failing.fetchWork, [row({ olWorkIds: ["OL11W"] }), row({ olWorkIds: ["OL12W"] })]);
  assert.deepEqual(failing.asked, ["OL11W", "OL12W"]);
  assert.deepEqual(failed.failedKeys, ["OL11W", "OL12W"]);
});

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubOpenLibrary(replies: Array<() => Response>) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return replies.shift()!();
  }) as typeof fetch;
  return urls;
}

test("createWorkFetcher retries a 429 after its wait and gives up after three attempts", async () => {
  const waits: number[] = [];
  const lines: string[] = [];
  const sleep = async (ms: number) => void waits.push(ms);
  const fetchWork = createWorkFetcher({ log: (line) => lines.push(line), sleep });
  const throttled = () => new Response("", { status: 429, headers: { "retry-after": "120" } });
  const urls = stubOpenLibrary([throttled, () => Response.json({ key: "/works/OL1W" })]);
  assert.deepEqual(await fetchWork("OL1W"), { key: "/works/OL1W" });
  assert.deepEqual(urls, ["https://openlibrary.org/works/OL1W.json", "https://openlibrary.org/works/OL1W.json"]);
  const retry = waits.filter((ms) => ms > 1000);
  assert.equal(retry.length, 1);
  assert.ok(retry[0]! > 119_000 && retry[0]! <= 120_000);
  assert.match(lines[0]!, /^openlibrary attempt 1 failed \(openlibrary unavailable: HTTP 429\), retrying in 120s$/);

  waits.length = 0;
  lines.length = 0;
  const gaveUp = stubOpenLibrary([() => new Response("", { status: 429 }), () => new Response("", { status: 429 }), () => new Response("", { status: 429 }), () => Response.json({})]);
  await assert.rejects(fetchWork("OL2W"), (error: unknown) => error instanceof SourceUnavailableError && error.status === 429);
  assert.equal(gaveUp.length, 3);
  assert.deepEqual(waits.filter((ms) => ms > 1000), [60_000, 60_000]);
  assert.deepEqual(lines, [
    "openlibrary attempt 1 failed (openlibrary unavailable: HTTP 429), retrying in 60s",
    "openlibrary attempt 2 failed (openlibrary unavailable: HTTP 429), retrying in 60s"
  ]);
});

test("createWorkFetcher counts every attempt and reports progress every hundred requests", async () => {
  const lines: string[] = [];
  const fetchWork = createWorkFetcher({ log: (line) => lines.push(line), sleep: async () => {} });
  stubOpenLibrary(Array.from({ length: 100 }, (_, index) => () => (index === 40 ? new Response("", { status: 404 }) : index === 70 ? new Response("", { status: 500 }) : Response.json({}))));
  for (let index = 0; index < 100; index++) {
    if (index === 70) await assert.rejects(fetchWork("OL1W"), SourceUnavailableError);
    else await fetchWork("OL1W");
  }
  assert.deepEqual(lines, [JSON.stringify({ openLibraryRequests: 100, failed: 1 })]);
});
