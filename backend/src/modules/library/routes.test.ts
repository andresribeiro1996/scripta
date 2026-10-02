import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Readable } from "node:stream";
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
const { buildLibraryRoutes, libraryWriteLimit } = await import("./routes.js");
const { LIBRARY_PUT_HEADROOM_BYTES, LIBRARY_SMALL_SAVE_MAX_BYTES } = await import("./domain/constants.js");
const { env } = await import("../../config/env.js");

const kobo = { ContentID: "k1", Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1 };
const goodreads = { ContentID: "g1", Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2 };

const tooLargeBody = {
  error: "Your library is over 10 MB, the most Scripta can store. Remove some books or highlights and try again.",
  code: "LIBRARY_BODY_TOO_LARGE",
  maxBytes: 10485760
};

const smallSave = JSON.stringify({ data: { books: [] } });

function saveOfBytes(bytes: number) {
  const bare = JSON.stringify({ data: { books: [], padding: "" } });
  return JSON.stringify({ data: { books: [], padding: "x".repeat(bytes - Buffer.byteLength(bare)) } });
}

const otherWrites = [
  { method: "POST", url: "/library/books" },
  { method: "POST", url: "/library/books/merge" },
  { method: "POST", url: "/library/share" },
  { method: "POST", url: "/library/unshare" }
] as const;

async function setup() {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", env.LIBRARY_BODY_LIMIT_BYTES, undefined, undefined, () => undefined);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildLibraryRoutes(service));
  await app.ready();
  const merge = (payload: unknown, token: string | null = "u1") =>
    app.inject({ method: "POST", url: "/library/books/merge", headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as object });
  const addBook = (payload: unknown, token = "u1") =>
    app.inject({ method: "POST", url: "/library/books", headers: { authorization: `Bearer ${token}` }, payload: payload as object });
  const put = (payload: string, token = "u1") =>
    app.inject({ method: "PUT", url: "/library", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, payload });
  const otherWrite = (index: number, token = "u1") =>
    app.inject({ ...otherWrites[index % otherWrites.length]!, headers: { authorization: `Bearer ${token}` }, payload: {} });
  return { app, service, merge, addBook, put, otherWrite };
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

test("small saves get 120 a minute per account, apart from reads and other accounts", async () => {
  const { app, put } = await setup();
  for (let request = 1; request <= 120; request++) assert.notEqual((await put(smallSave)).statusCode, 429);
  assert.equal((await put(smallSave)).statusCode, 429);
  assert.notEqual((await put(smallSave, "u2")).statusCode, 429);
  assert.equal((await app.inject({ method: "GET", url: "/library", headers: { authorization: "Bearer u1" } })).statusCode, 200);
  await app.close();
});

test("saves over 1 MiB get 30 a minute per account", async () => {
  const { app, put } = await setup();
  const big = saveOfBytes(LIBRARY_SMALL_SAVE_MAX_BYTES + 1);
  assert.equal(Buffer.byteLength(big), LIBRARY_SMALL_SAVE_MAX_BYTES + 1);
  for (let request = 1; request <= 30; request++) assert.notEqual((await put(big)).statusCode, 429);
  assert.equal((await put(big)).statusCode, 429);
  assert.notEqual((await put(big, "u2")).statusCode, 429);
  await app.close();
});

test("a save of exactly 1 MiB still counts as small", async () => {
  const { app, put } = await setup();
  const edge = saveOfBytes(LIBRARY_SMALL_SAVE_MAX_BYTES);
  assert.equal(Buffer.byteLength(edge), LIBRARY_SMALL_SAVE_MAX_BYTES);
  for (let request = 1; request <= 31; request++) assert.notEqual((await put(edge)).statusCode, 429);
  await app.close();
});

test("a save with no Content-Length counts as big", async () => {
  const { app } = await setup();
  const chunked = () =>
    app.inject({
      method: "PUT",
      url: "/library",
      headers: { authorization: "Bearer u1", "content-type": "application/json", "transfer-encoding": "chunked" },
      payload: Readable.from([Buffer.from(smallSave)])
    });
  for (let request = 1; request <= 30; request++) assert.notEqual((await chunked()).statusCode, 429);
  assert.equal((await chunked()).statusCode, 429);
  await app.close();
});

test("after 30 small saves, add-book, merge, share and unshare are refused while another small save still passes", async () => {
  const { app, put, otherWrite } = await setup();
  for (let request = 1; request <= 30; request++) assert.notEqual((await put(smallSave)).statusCode, 429);
  for (let route = 0; route < otherWrites.length; route++) assert.equal((await otherWrite(route)).statusCode, 429);
  assert.notEqual((await put(smallSave)).statusCode, 429);
  assert.notEqual((await otherWrite(0, "u2")).statusCode, 429);
  await app.close();
});

test("add-book, merge, share and unshare get 30 a minute per account", async () => {
  const { app, put, otherWrite } = await setup();
  for (let request = 0; request < 30; request++) assert.notEqual((await otherWrite(request)).statusCode, 429);
  for (let route = 0; route < otherWrites.length; route++) assert.equal((await otherWrite(route)).statusCode, 429);
  assert.notEqual((await put(smallSave)).statusCode, 429);
  assert.notEqual((await otherWrite(0, "u2")).statusCode, 429);
  await app.close();
});

test("libraryWriteLimit gives 120 only to a PUT that declares at most 1 MiB and 30 to everything else", () => {
  const limit = (method: string, length?: string) =>
    libraryWriteLimit({ method, headers: length === undefined ? {} : { "content-length": length } });
  assert.equal(limit("PUT", "2"), 120);
  assert.equal(limit("PUT", String(LIBRARY_SMALL_SAVE_MAX_BYTES)), 120);
  assert.equal(limit("PUT", String(LIBRARY_SMALL_SAVE_MAX_BYTES + 1)), 30);
  assert.equal(limit("POST", "2"), 30);
  for (const invalid of [undefined, "", "abc", "-1", "1e3", "1.5", "0x10", "9".repeat(400)]) {
    assert.equal(limit("PUT", invalid), 30, `Content-Length ${JSON.stringify(invalid)}`);
  }
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

test("PUT /library over the default cap tells the reader it is 10 MB", async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: "PUT",
    url: "/library",
    headers: { authorization: "Bearer u1", "content-type": "application/json" },
    payload: JSON.stringify({ data: { books: [], padding: "x".repeat(10 * 1024 * 1024) } })
  });
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.json(), tooLargeBody);
  await app.close();
});

const nearTheLine = (room: number) => ({ books: [], padding: "x".repeat(env.LIBRARY_BODY_LIMIT_BYTES - LIBRARY_PUT_HEADROOM_BYTES - room) });

test("POST /library/books that would take the library past the cap answers 413 like PUT /library and leaves it alone", async () => {
  const { app, service, addBook } = await setup();
  const saved = service.saveLibrary("u1", nearTheLine(100));
  const res = await addBook({ title: "Dune", author: "Frank Herbert", readStatus: 0 });
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.json(), tooLargeBody);
  const after = service.getLibrary("u1");
  assert.equal(after?.updatedAt, saved.updatedAt);
  assert.deepEqual(after?.data, saved.data);
  await app.close();
});

test("POST /library/books under the cap still adds the book", async () => {
  const { app, service, addBook } = await setup();
  service.saveLibrary("u1", nearTheLine(2000));
  const res = await addBook({ title: "Dune", author: "Frank Herbert", readStatus: 0 });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { updated: boolean }).updated, false);
  assert.equal((service.getLibrary("u1")!.data as { books: unknown[] }).books.length, 1);
  await app.close();
});

test("POST /library/books/merge that would take the library past the cap answers 413 like PUT /library and leaves it alone", async () => {
  const { app, service, merge } = await setup();
  const short = { ContentID: "k1", Title: "a", Attribution: "b" };
  const isbn = { ContentID: "g1", Title: "a", Attribution: "b", ISBN: "9780441013593" };
  const stamp = "2026-01-01T00:00:00.000Z";
  const shelves = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, type: "collection", name: `Shelf ${i}`, bookKeys: [bookKey(short)], createdAt: stamp, updatedAt: stamp }));
  const bare = { books: [isbn, short], groups: shelves, padding: "" };
  const saved = service.saveLibrary("u1", { ...bare, padding: "x".repeat(env.LIBRARY_BODY_LIMIT_BYTES - LIBRARY_PUT_HEADROOM_BYTES - Buffer.byteLength(JSON.stringify(bare))) });
  const res = await merge({ keep: bookKey(isbn), merge: [bookKey(short)], updatedAt: saved.updatedAt });
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.json(), tooLargeBody);
  const after = service.getLibrary("u1");
  assert.equal(after?.updatedAt, saved.updatedAt);
  assert.deepEqual(after?.data, saved.data);
  await app.close();
});
