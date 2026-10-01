import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { bookKey } from "@scripta/shared";

const scratch = mkdtempSync(join(tmpdir(), "library-routes-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery-files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyLibrarySchema } = await import("./adapters/sqlite/connection.js");
const { createSqliteLibraryRepository } = await import("./adapters/sqlite/sqliteLibraryRepository.js");
const { createLibraryService } = await import("./service.js");
const { buildLibraryRoutes } = await import("./routes.js");

const kobo = { ContentID: "k1", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1 };
const goodreads = { ContentID: "g1", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 };

async function setup() {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", undefined, undefined, () => undefined);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildLibraryRoutes(service));
  await app.ready();
  const merge = (payload: unknown, token: string | null = "u1") =>
    app.inject({ method: "POST", url: "/library/books/merge", headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as object });
  return { app, service, merge };
}

test("PUT /library saves a book whose fields aren't text", async () => {
  const { app } = await setup();
  const book = { Title: "Dune", Attribution: { toString: 5 }, ISBN: "9780441013593", ReadStatus: 2 };
  const res = await app.inject({ method: "PUT", url: "/library", headers: { authorization: "Bearer u1" }, payload: { data: { books: [book] } } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual((res.json() as { data: { books: unknown[] } }).data.books, [book]);
  await app.close();
});

test("PUT /library rejects an anonymous caller before the body is read", async () => {
  const { app } = await setup();
  const send = (headers: Record<string, string>) =>
    app.inject({ method: "PUT", url: "/library", headers: { "content-type": "application/json", ...headers }, payload: "{not json" });
  assert.equal((await send({})).statusCode, 401);
  assert.equal((await send({ authorization: "Bearer u1" })).statusCode, 400);
  await app.close();
});

test("library writes share one bucket of 30 a minute per account, apart from reads and other accounts", async () => {
  const { app } = await setup();
  const writes = [
    { method: "PUT", url: "/library" },
    { method: "POST", url: "/library/books" },
    { method: "POST", url: "/library/books/merge" },
    { method: "POST", url: "/library/share" },
    { method: "POST", url: "/library/unshare" }
  ] as const;
  const write = (token: string, index: number) =>
    app.inject({ ...writes[index % writes.length]!, headers: { authorization: `Bearer ${token}` }, payload: {} });
  for (let request = 0; request < 30; request++) assert.notEqual((await write("u1", request)).statusCode, 429);
  for (let route = 0; route < writes.length; route++) assert.equal((await write("u1", route)).statusCode, 429);
  assert.notEqual((await write("u2", 0)).statusCode, 429);
  assert.equal((await app.inject({ method: "GET", url: "/library", headers: { authorization: "Bearer u1" } })).statusCode, 404);
  await app.close();
});

test("GET /library allows 60 requests a minute per account", async () => {
  const { app } = await setup();
  const read = (token: string) => app.inject({ method: "GET", url: "/library", headers: { authorization: `Bearer ${token}` } });
  for (let request = 1; request <= 60; request++) assert.equal((await read("u1")).statusCode, 404);
  assert.equal((await read("u1")).statusCode, 429);
  assert.equal((await read("u2")).statusCode, 404);
  await app.close();
});

test("POST /library/books/merge requires a signed-in user", async () => {
  const { app, merge } = await setup();
  const res = await merge({ keep: "a", merge: ["b"], updatedAt: "2026-01-01T00:00:00.000Z" }, null);
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("POST /library/books/merge rejects a malformed body with 400", async () => {
  const { app, merge } = await setup();
  assert.equal((await merge({ keep: "a" })).statusCode, 400);
  assert.equal((await merge({ keep: "a", merge: ["b"], updatedAt: "yesterday" })).statusCode, 400);
  await app.close();
});

test("POST /library/books/merge returns 404 when the user has no library", async () => {
  const { app, merge } = await setup();
  const res = await merge({ keep: "a", merge: ["b"], updatedAt: "2026-01-01T00:00:00.000Z" }, "nobody");
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("POST /library/books/merge returns 409 with the current document on a stale updatedAt", async () => {
  const { app, service, merge } = await setup();
  const saved = service.saveLibrary("u1", { books: [kobo, goodreads] });
  const res = await merge({ keep: bookKey(goodreads), merge: [bookKey(kobo)], updatedAt: "2000-01-01T00:00:00.000Z" });
  assert.equal(res.statusCode, 409);
  const body = res.json() as { current: { updatedAt: string; data: { books: unknown[] } } };
  assert.equal(body.current.updatedAt, saved.updatedAt);
  assert.equal(body.current.data.books.length, 2);
  await app.close();
});

test("POST /library/books/merge merges the books and returns the saved document", async () => {
  const { app, service, merge } = await setup();
  const saved = service.saveLibrary("u1", { books: [kobo, goodreads] });
  const res = await merge({ keep: bookKey(goodreads), merge: [bookKey(kobo)], updatedAt: saved.updatedAt });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { data: { books: Array<Record<string, unknown>> } };
  assert.equal(body.data.books.length, 1);
  assert.equal(bookKey(body.data.books[0]!), bookKey(goodreads));
  await app.close();
});
