import assert from "node:assert/strict";
import fastifyMultipart from "@fastify/multipart";
import Fastify, { type InjectOptions } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import sharp from "sharp";

const scratch = mkdtempSync(join(tmpdir(), "books-routes-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { createBooksService, MAX_UPLOAD_BYTES } = await import("./booksService.js");
const { BookNotFoundError, SourceUnavailableError, WorkMergeError } = await import("./domain/errors.js");
const { buildAdminRoutes, buildCatalogRoutes, buildGenreReviewRoutes, buildSynopsisReviewRoutes, buildTranslationReviewRoutes, buildCoverFileRoutes, buildResolveRoutes } = await import("./routes.js");

type Deps = Parameters<typeof createBooksService>[0];
const publicUrlFor = (id: string, size: string) => `https://images.test/covers/${id}${size === "thumb" ? "-thumb" : ""}.webp`;
const empty = { byIsbn: async () => [], byTitle: async () => [] };

function makeService(overrides: Partial<Deps> = {}) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const repo = createSqliteBooksRepository(db);
  const service = createBooksService({
    repo,
    blobs: { save: async () => {}, read: async () => null },
    sources: { isbndb: null, apple: empty, openlibrary: empty },
    catalog: { fetchDetails: async () => null, search: async () => [] },
    backgroundCatalog: { fetchDetails: async () => null, search: async () => [] },
    editionRecords: { fetchEditionRecord: async () => null },
    fetchImage: async () => null,
    enqueue: () => {},
    publicUrlFor,
    adminUserId: "admin",
    warn: () => {},
    sharesArena: () => false,
    ...overrides
  });
  return { service, repo };
}

async function call(service: ReturnType<typeof createBooksService>, options: InjectOptions, signedInAs?: string, groupWorks: () => Promise<number | null> = async () => 0) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null));
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  await app.register(buildResolveRoutes(service));
  await app.register(buildCoverFileRoutes(publicUrlFor));
  await app.register(buildCatalogRoutes(service));
  await app.register(buildAdminRoutes(service, groupWorks));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return res;
}

function multipart(bytes: Buffer) {
  const boundary = "----bookcover";
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
  };
}

test("resolve needs auth, needs an ISBN or title, and ignores imageId", async () => {
  const { service } = makeService();
  assert.equal((await call(service, { method: "GET", url: "/covers/resolve?title=Dune" })).statusCode, 401);
  assert.equal((await call(service, { method: "GET", url: "/covers/resolve?imageId=abc" }, "u1")).statusCode, 400);
  const res = await call(service, { method: "GET", url: "/covers/resolve?title=Dune&author=Frank%20Herbert&imageId=abc" }, "u1");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { url: null, fullUrl: null, pending: true, upgrading: false });
});

test("batch resolve answers each lookup in order and validates the whole list", async () => {
  const { service } = makeService();
  const post = (payload: unknown, user?: string) => call(service, { method: "POST", url: "/covers/resolve/batch", payload: payload as object }, user);
  assert.equal((await post([{ title: "Dune" }])).statusCode, 401);
  assert.equal((await post({ title: "Dune" }, "u1")).statusCode, 400);
  assert.equal((await post([{ title: "Dune" }, { author: "Nobody" }], "u1")).statusCode, 400);
  assert.equal((await post(Array.from({ length: 101 }, (_, i) => ({ title: `Book ${i}` })), "u1")).statusCode, 400);
  const res = await post([{ title: "Dune" }, { isbn: "9780441013593", imageId: "ignored" }], "u1");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { results: [{ url: null, fullUrl: null, pending: true, upgrading: false }, { url: null, fullUrl: null, pending: true, upgrading: false }] });
});

test("the old cover URLs redirect permanently to the stored file; a bad id is a 400", async () => {
  const { service } = makeService();
  const id = "11111111-1111-4111-8111-111111111111";
  const thumb = await call(service, { method: "GET", url: `/covers/cached/${id}/thumb` });
  assert.equal(thumb.statusCode, 301);
  assert.equal(thumb.headers.location, publicUrlFor(id, "thumb"));
  const file = await call(service, { method: "GET", url: `/covers/cached/${id}/file` });
  assert.equal(file.statusCode, 301);
  assert.equal(file.headers.location, publicUrlFor(id, "file"));
  assert.equal((await call(service, { method: "GET", url: "/covers/cached/not-a-uuid/thumb" })).statusCode, 400);
});

test("details and search wrap their payloads and map an unavailable catalog to 502", async () => {
  const { service } = makeService();
  assert.deepEqual((await call(service, { method: "GET", url: "/books/details?isbn=9780441013593" }, "u1")).json(), { metadata: null });
  assert.deepEqual((await call(service, { method: "GET", url: "/books/search?q=dune" }, "u1")).json(), { results: [] });
  assert.deepEqual((await call(service, { method: "GET", url: "/books/search/external?q=dune" }, "u1")).json(), { results: [] });

  const down = makeService({ catalog: {
    fetchDetails: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); },
    search: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); }
  } }).service;
  const details = await call(down, { method: "GET", url: "/books/details?isbn=9780441013593" }, "u1");
  assert.equal(details.statusCode, 502);
  assert.equal(details.json().error, "Book information is unavailable.");
  assert.deepEqual((await call(down, { method: "GET", url: "/books/search?q=dune" }, "u1")).json(), { results: [] });
  const search = await call(down, { method: "GET", url: "/books/search/external?q=dune" }, "u1");
  assert.equal(search.statusCode, 502);
  assert.equal(search.json().error, "Search is unavailable right now — try again.");
  assert.equal((await call(down, { method: "GET", url: "/books/search/external" }, "u1")).statusCode, 400);
});

test("admin routes report the flag and refuse everyone else", async () => {
  const { service } = makeService();
  assert.deepEqual((await call(service, { method: "GET", url: "/books/admin" }, "u1")).json(), { isAdmin: false });
  assert.deepEqual((await call(service, { method: "GET", url: "/books/admin" }, "admin")).json(), { isAdmin: true });
  assert.equal((await call(service, { method: "POST", url: "/books/cover/reject", payload: { title: "Dune" } }, "u1")).statusCode, 403);
  assert.equal((await call(service, { method: "POST", url: "/books/cover/reject", payload: { title: "Dune" } }, "admin")).statusCode, 404);
  const upload = multipart(Buffer.from("x"));
  assert.equal((await call(service, { method: "PUT", url: "/books/cover?title=Dune", ...upload }, "u1")).statusCode, 403);
});

test("the admin can upload a cover and non-images are refused", async () => {
  const { service } = makeService();
  const photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#224466" } }).jpeg().toBuffer();
  const ok = await call(service, { method: "PUT", url: "/books/cover?title=Dune&author=Frank%20Herbert", ...multipart(photo) }, "admin");
  assert.equal(ok.statusCode, 200);
  assert.match(ok.json().url, /-thumb\.webp$/);
  const bad = await call(service, { method: "PUT", url: "/books/cover?title=Dune&author=Frank%20Herbert", ...multipart(Buffer.from("nope")) }, "admin");
  assert.equal(bad.statusCode, 422);
});

test("only a signed-in admin may merge or detach works", async () => {
  const { service } = makeService();
  const merge = { method: "POST" as const, url: "/books/works/merge", payload: { from: { isbn: "9789720000001" }, into: { isbn: "9789720000002" } } };
  const detach = { method: "POST" as const, url: "/books/works/detach", payload: { edition: { isbn: "9789720000001" } } };
  assert.equal((await call(service, merge)).statusCode, 401);
  assert.equal((await call(service, merge, "u1")).statusCode, 403);
  assert.equal((await call(service, detach, "u1")).statusCode, 403);
});

test("the admin merges one edition's work into another's and gets the resulting work", async () => {
  const { service, repo } = makeService();
  const english = repo.createBook({ title: "Blindness", author: "José Saramago", isbn: "9780156007757", workKey: "OL1W" }, ["isbn:9780156007757"], "2026-10-01T00:00:00.000Z");
  const portuguese = repo.createBook({ title: "Ensaio sobre a Cegueira", author: "José Saramago", isbn: "9789720000002" }, ["isbn:9789720000002"], "2026-10-02T00:00:00.000Z");
  const res = await call(service, { method: "POST", url: "/books/works/merge", payload: { from: { isbn: "978-972-0-00000-2" }, into: { isbn: "9780156007757" } } }, "admin");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    id: english.work_id,
    olWorkKey: "OL1W",
    title: "Blindness",
    author: "José Saramago",
    editions: [
      { id: english.id, isbn: "9780156007757", title: "Blindness", author: "José Saramago", olWorkKey: "OL1W" },
      { id: portuguese.id, isbn: "9789720000002", title: "Ensaio sobre a Cegueira", author: "José Saramago", olWorkKey: null }
    ]
  });
});

test("merging answers 400 for a bad body, 404 for an unknown edition and 409 for a refused merge", async () => {
  const { service, repo } = makeService();
  repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], "2026-10-01T00:00:00.000Z");
  repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], "2026-10-01T00:00:00.000Z");
  const merge = (payload: unknown) => call(service, { method: "POST", url: "/books/works/merge", payload: payload as object }, "admin");
  assert.equal((await merge({ from: { isbn: "9780441013593" } })).statusCode, 400);
  assert.equal((await merge({ from: {}, into: { isbn: "9780441013593" } })).statusCode, 400);
  assert.equal((await merge({ from: { isbn: "9789999999999" }, into: { isbn: "9780441013593" } })).statusCode, 404);
  const keyed = await merge({ from: { isbn: "9780441013593" }, into: { isbn: "9780141439587" } });
  assert.equal(keyed.statusCode, 409);
  assert.match(keyed.json().error, /Open Library/);
  assert.equal((await merge({ from: { isbn: "9780141439587" }, into: { isbn: "9780141439587" } })).statusCode, 409);
});

test("an admin lookup with an ISBN never falls back to another edition's title", async () => {
  const { service, repo } = makeService();
  repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593", "ta:dune|frank herbert|"], "2026-10-01T00:00:00.000Z");
  repo.createBook({ title: "Emma", author: "Jane Austen", isbn: "9780141439587" }, ["isbn:9780141439587"], "2026-10-01T00:00:00.000Z");
  const res = await call(service, { method: "POST", url: "/books/works/merge", payload: { from: { isbn: "9789999999999", title: "Dune", author: "Frank Herbert" }, into: { isbn: "9780141439587" } } }, "admin");
  assert.equal(res.statusCode, 404);
  for (const isbn of ["123", "not-an-isbn"]) {
    const bad = await call(service, { method: "POST", url: "/books/works/merge", payload: { from: { isbn, title: "Dune", author: "Frank Herbert" }, into: { isbn: "9780141439587" } } }, "admin");
    assert.equal(bad.statusCode, 404);
  }
});

test("the admin detaches an edition from a grouped work, and a keyed edition is refused", async () => {
  const { service, repo } = makeService();
  const keyed = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", workKey: "OL1W" }, ["isbn:9780441013593"], "2026-10-01T00:00:00.000Z");
  const joined = repo.createBook({ title: "Dune", author: "Frank Herbert", isbn: "9780593099322" }, ["isbn:9780593099322"], "2026-10-01T00:00:00.000Z");
  repo.mergeWorks(joined.work_id!, keyed.work_id!);
  const res = await call(service, { method: "POST", url: "/books/works/detach", payload: { edition: { isbn: "9780593099322" } } }, "admin");
  assert.equal(res.statusCode, 200);
  assert.notEqual(res.json().id, keyed.work_id);
  assert.deepEqual(res.json().editions.map((e: { id: string }) => e.id), [joined.id]);
  assert.notEqual(repo.getBook(joined.id)!.title_group_blocked_at, null);
  assert.equal((await call(service, { method: "POST", url: "/books/works/detach", payload: { edition: { isbn: "9780441013593" } } }, "admin")).statusCode, 409);
  assert.equal((await call(service, { method: "POST", url: "/books/works/detach", payload: { edition: {} } }, "admin")).statusCode, 400);
  assert.equal((await call(service, { method: "POST", url: "/books/works/detach", payload: { edition: { isbn: "9789999999999" } } }, "admin")).statusCode, 404);
});

test("only a signed-in admin may run works grouping", async () => {
  const { service } = makeService();
  const group = { method: "POST" as const, url: "/books/works/group" };
  assert.equal((await call(service, group)).statusCode, 401);
  assert.equal((await call(service, group, "u1")).statusCode, 403);
});

test("the admin runs works grouping and gets the count, or 409 while a run is going", async () => {
  const { service } = makeService();
  const group = { method: "POST" as const, url: "/books/works/group" };
  const done = await call(service, group, "admin", async () => 12);
  assert.equal(done.statusCode, 200);
  assert.deepEqual(done.json(), { grouped: 12 });
  const busy = await call(service, group, "admin", async () => null);
  assert.equal(busy.statusCode, 409);
  assert.deepEqual(busy.json(), { error: "Grouping is already running." });
});

test("catalog search accepts by=work and refuses any other grouping", async () => {
  const { service } = makeService();
  assert.equal((await call(service, { method: "GET", url: "/books/search?q=dune&by=work" }, "u1")).statusCode, 200);
  assert.equal((await call(service, { method: "GET", url: "/books/search?q=dune&by=edition" }, "u1")).statusCode, 400);
});

async function callReview(options: InjectOptions, signedInAs?: string, decided: Array<[string, unknown]> = []) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null));
  await app.register(buildGenreReviewRoutes({
    isAdmin: (userId) => userId === "admin",
    review: () => ({ items: [], total: 0 }),
    decide: (workId, action) => {
      if (workId === "missing") throw new BookNotFoundError();
      decided.push([workId, action]);
      return { workId, editions: 1 };
    }
  }));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return res;
}

test("only the signed-in admin may list or decide genre reviews", async () => {
  assert.equal((await callReview({ method: "GET", url: "/books/genre-review" })).statusCode, 401);
  assert.equal((await callReview({ method: "GET", url: "/books/genre-review" }, "u1")).statusCode, 403);
  assert.equal((await callReview({ method: "POST", url: "/books/genre-review/w1", payload: { genres: ["History"] } }, "u1")).statusCode, 403);
  assert.deepEqual((await callReview({ method: "GET", url: "/books/genre-review" }, "admin")).json(), { items: [], total: 0 });
});

test("a genre review decision is validated before it is applied", async () => {
  const decided: Array<[string, unknown]> = [];
  const post = (payload: unknown, workId = "w1") => callReview({ method: "POST", url: `/books/genre-review/${workId}`, payload: payload as object }, "admin", decided);
  assert.equal((await post({ genres: ["History", "Poetry"] })).statusCode, 200);
  assert.equal((await post({ genres: [] })).statusCode, 200);
  assert.equal((await post({ retry: true })).statusCode, 200);
  for (const bad of [{ genres: ["Novel"] }, { genres: ["History", "History"] }, { genres: ["History", "Poetry", "Classics", "Religion"] }, { retry: false }, { genres: ["History"], retry: true }, {}]) {
    assert.equal((await post(bad)).statusCode, 400, JSON.stringify(bad));
  }
  assert.equal((await post({ genres: ["History"] }, "missing")).statusCode, 404);
  assert.deepEqual(decided, [["w1", { genres: ["History", "Poetry"] }], ["w1", { genres: [] }], ["w1", { retry: true }]]);
});

async function callSynopsisReview(options: InjectOptions, signedInAs?: string, decide: (hash: string, decision: "keep" | "hide") => { hash: string } = (hash) => ({ hash })) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null));
  await app.register(buildSynopsisReviewRoutes({ isAdmin: (userId) => userId === "admin", review: () => ({ items: [], total: 0 }), decide }));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return res;
}

test("the synopsis review is the admin's only", async () => {
  const hash = "a".repeat(40);
  assert.equal((await callSynopsisReview({ method: "GET", url: "/books/synopsis-review" })).statusCode, 401);
  assert.equal((await callSynopsisReview({ method: "GET", url: "/books/synopsis-review" }, "reader")).statusCode, 403);
  assert.equal((await callSynopsisReview({ method: "POST", url: `/books/synopsis-review/${hash}`, payload: { decision: "keep" } }, "reader")).statusCode, 403);
  const listed = await callSynopsisReview({ method: "GET", url: "/books/synopsis-review" }, "admin");
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), { items: [], total: 0 });
});

test("a synopsis decision needs a hash and keep or hide, and maps not found", async () => {
  const hash = "a".repeat(40);
  for (const [url, payload] of [[`/books/synopsis-review/${hash}`, { decision: "maybe" }], [`/books/synopsis-review/${hash}`, {}], [`/books/synopsis-review/${hash}`, { decision: "keep", extra: true }], ["/books/synopsis-review/not-a-hash", { decision: "keep" }]] as const) {
    assert.equal((await callSynopsisReview({ method: "POST", url, payload }, "admin")).statusCode, 400, `${url} ${JSON.stringify(payload)}`);
  }
  const saved = await callSynopsisReview({ method: "POST", url: `/books/synopsis-review/${hash}`, payload: { decision: "hide" } }, "admin");
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json(), { hash });
  const missing = await callSynopsisReview({ method: "POST", url: `/books/synopsis-review/${hash}`, payload: { decision: "keep" } }, "admin", () => { throw new BookNotFoundError(); });
  assert.equal(missing.statusCode, 404);
});

async function callTranslationReview(options: InjectOptions, signedInAs?: string, decide: (workId: string) => { workId: string } = (workId) => ({ workId })) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null));
  await app.register(buildTranslationReviewRoutes({ isAdmin: (userId) => userId === "admin", review: () => ({ items: [], total: 0 }), decide }));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return res;
}

test("the translation review is the admin's only, and maps validation, not found and stale merges", async () => {
  assert.equal((await callTranslationReview({ method: "GET", url: "/books/translation-review" })).statusCode, 401);
  assert.equal((await callTranslationReview({ method: "GET", url: "/books/translation-review" }, "reader")).statusCode, 403);
  assert.equal((await callTranslationReview({ method: "GET", url: "/books/translation-review" }, "admin")).statusCode, 200);
  for (const payload of [{}, { merge: "" }, { reject: false }, { undo: true, reject: true }, { merge: "w", extra: 1 }]) {
    assert.equal((await callTranslationReview({ method: "POST", url: "/books/translation-review/w1", payload }, "admin")).statusCode, 400, JSON.stringify(payload));
  }
  assert.equal((await callTranslationReview({ method: "POST", url: "/books/translation-review/w1", payload: { reject: true } }, "reader")).statusCode, 403);
  assert.equal((await callTranslationReview({ method: "POST", url: "/books/translation-review/w1", payload: { undo: true } }, "admin")).statusCode, 200);
  assert.equal((await callTranslationReview({ method: "POST", url: "/books/translation-review/w1", payload: { reject: true } }, "admin", () => { throw new BookNotFoundError(); })).statusCode, 404);
  assert.equal((await callTranslationReview({ method: "POST", url: "/books/translation-review/w1", payload: { merge: "w2" } }, "admin", () => { throw new WorkMergeError("Both works are in an arena."); })).statusCode, 409);
});
