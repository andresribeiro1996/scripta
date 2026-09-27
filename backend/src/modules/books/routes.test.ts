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
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.COVERS_STORAGE_PATH = join(scratch, "covers-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyBooksMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteBooksRepository } = await import("./adapters/sqlite/sqliteBooksRepository.js");
const { createBooksService, MAX_UPLOAD_BYTES } = await import("./booksService.js");
const { SourceUnavailableError } = await import("./domain/errors.js");
const { buildAdminRoutes, buildCatalogRoutes, buildCoverFileRoutes, buildResolveRoutes } = await import("./routes.js");

type Deps = Parameters<typeof createBooksService>[0];
const empty = { byIsbn: async () => [], byTitle: async () => [] };

function makeService(overrides: Partial<Deps> = {}) {
  const db = new DatabaseSync(":memory:");
  applyBooksMigrations(db);
  const files = new Map<string, Buffer>();
  const service = createBooksService({
    repo: createSqliteBooksRepository(db),
    blobs: { save: (id, ext, bytes) => { files.set(`${id}.${ext}`, bytes); }, read: (id, ext) => files.get(`${id}.${ext}`) ?? null },
    sources: { isbndb: null, apple: empty, openlibrary: empty },
    catalog: { fetchDetails: async () => null, search: async () => [] },
    fetchImage: async () => null,
    enqueue: () => {},
    publicUrlFor: (id, size) => `https://api.test/covers/cached/${id}/${size}`,
    adminUserId: "admin",
    ...overrides
  });
  return { service, files };
}

async function call(service: ReturnType<typeof createBooksService>, options: InjectOptions, signedInAs?: string) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null));
  await app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  await app.register(buildResolveRoutes(service));
  await app.register(buildCoverFileRoutes(service));
  await app.register(buildCatalogRoutes(service));
  await app.register(buildAdminRoutes(service));
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
  assert.deepEqual(res.json(), { url: null, fullUrl: null, pending: true });
});

test("cover files serve WebP with immutable caching; thumb falls back to the full file", async () => {
  const { service, files } = makeService();
  const id = "11111111-1111-4111-8111-111111111111";
  files.set(`${id}.webp`, Buffer.from("full"));
  const res = await call(service, { method: "GET", url: `/covers/cached/${id}/thumb` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/webp");
  assert.equal(res.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(res.body, "full");
  assert.equal((await call(service, { method: "GET", url: "/covers/cached/22222222-2222-4222-8222-222222222222/file" })).statusCode, 404);
  assert.equal((await call(service, { method: "GET", url: "/covers/cached/not-a-uuid/file" })).statusCode, 400);
});

test("details and search wrap their payloads and map an unavailable catalog to 502", async () => {
  const { service } = makeService();
  assert.deepEqual((await call(service, { method: "GET", url: "/books/details?isbn=9780441013593" }, "u1")).json(), { metadata: null });
  assert.deepEqual((await call(service, { method: "GET", url: "/books/search?q=dune" }, "u1")).json(), { results: [] });

  const down = makeService({ catalog: {
    fetchDetails: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); },
    search: async () => { throw new SourceUnavailableError("openlibrary", "HTTP 503"); }
  } }).service;
  const details = await call(down, { method: "GET", url: "/books/details?isbn=9780441013593" }, "u1");
  assert.equal(details.statusCode, 502);
  assert.equal(details.json().error, "Book information is unavailable.");
  const search = await call(down, { method: "GET", url: "/books/search?q=dune" }, "u1");
  assert.equal(search.statusCode, 502);
  assert.equal(search.json().error, "Search is unavailable right now — try again.");
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
  assert.match(ok.json().url, /\/thumb$/);
  const bad = await call(service, { method: "PUT", url: "/books/cover?title=Dune&author=Frank%20Herbert", ...multipart(Buffer.from("nope")) }, "admin");
  assert.equal(bad.statusCode, 422);
});
