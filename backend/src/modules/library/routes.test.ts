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
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
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
  return { app, db, service, merge, addBook, put, otherWrite };
}

test("PUT /library saves a book whose fields aren't text", async () => {
  const { app } = await setup();
  const book = { Title: "Dune", Attribution: { toString: 5 }, ISBN: "9780441013593", ReadStatus: 2 };
  const res = await app.inject({ method: "PUT", url: "/library", headers: { authorization: "Bearer u1" }, payload: { data: { books: [book] } } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual((res.json() as { data: { books: unknown[] } }).data.books, [book]);
  await app.close();
});

test("GET /library?fresh=1 answers like GET /library", async () => {
  const { app } = await setup();
  const book = { Title: "Dune", ISBN: "9780441013593" };
  await app.inject({ method: "PUT", url: "/library", headers: { authorization: "Bearer u1" }, payload: { data: { books: [book] } } });
  const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: "Bearer u1" } });
  const plain = await get("/library");
  const fresh = await get("/library?fresh=1");
  assert.equal(fresh.statusCode, 200);
  assert.equal(fresh.statusCode, plain.statusCode);
  assert.deepEqual(fresh.json(), plain.json());
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
  const after = service.getLibraryText("u1");
  assert.equal(after?.updatedAt, saved.updatedAt);
  assert.equal(after?.data, saved.data);
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
  const after = service.getLibraryText("u1");
  assert.equal(after?.updatedAt, saved.updatedAt);
  assert.equal(after?.data, saved.data);
  await app.close();
});

const shelfLibrary = () => ({
  books: [kobo, { ContentID: "k2", Title: "Emma", Attribution: "Jane Austen", ReadStatus: 0 }],
  groups: [{ id: "g1", type: "collection", name: "Favourites", bookKeys: [], createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" }]
});

async function changeSetup() {
  const base = await setup();
  const send = (method: "POST" | "PATCH", url: string, payload: unknown, token: string | null = "u1") =>
    base.app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as object });
  const tick = (payload: unknown, token: string | null = "u1", groupId = "g1") => send("POST", `/library/groups/${groupId}/books`, payload, token);
  const patch = (payload: unknown, token: string | null = "u1") => send("PATCH", "/library/books", payload, token);
  const add = (payload: unknown, token: string | null = "u1") => send("POST", "/library/books/add", payload, token);
  return { ...base, tick, patch, add };
}

test("POST /library/groups/:groupId/books ticks a book and answers the versions", async () => {
  const { app, service, tick } = await changeSetup();
  const saved = service.saveLibrary("u1", shelfLibrary());
  const res = await tick({ bookKey: bookKey(kobo), member: true });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { updatedAt: string; baseUpdatedAt: string };
  assert.equal(body.baseUpdatedAt, saved.updatedAt);
  assert.notEqual(body.updatedAt, saved.updatedAt);
  const groups = (service.getLibrary("u1")!.data as ReturnType<typeof shelfLibrary>).groups;
  assert.deepEqual(groups[0]!.bookKeys, [bookKey(kobo)]);
  await app.close();
});

test("POST /library/groups/:groupId/books answers 400, 401, 404 and 409", async () => {
  const { app, service, tick } = await changeSetup();
  assert.equal((await tick({ bookKey: "a", member: true }, null)).statusCode, 401);
  assert.equal((await tick({ bookKey: "a" })).statusCode, 400);
  assert.equal((await tick({ bookKey: "", member: true })).statusCode, 400);
  assert.equal((await tick({ bookKey: "a".repeat(2001), member: true })).statusCode, 400);
  assert.equal((await tick({ bookKey: "a", member: true })).statusCode, 404);
  service.saveLibrary("u1", shelfLibrary());
  assert.equal((await tick({ bookKey: bookKey(kobo), member: true }, "u1", "gone")).statusCode, 404);
  assert.equal((await tick({ bookKey: "ta:nobody|", member: true })).statusCode, 404);
  await app.close();
});

test("PATCH /library/books sets status and rating", async () => {
  const { app, service, patch } = await changeSetup();
  service.saveLibrary("u1", shelfLibrary());
  const res = await patch({ bookKey: bookKey(kobo), readStatus: 2, rating: 4, day: "2026-10-02" });
  assert.equal(res.statusCode, 200);
  const book = (service.getLibrary("u1")!.data as ReturnType<typeof shelfLibrary>).books[0] as Record<string, unknown>;
  assert.equal(book.ReadStatus, 2);
  assert.equal(book.DateLastRead, "2026-10-02");
  assert.equal((await patch({ bookKey: bookKey(kobo), readStatus: 0 })).statusCode, 200);
  assert.equal((await patch({ bookKey: bookKey(kobo), rating: 5 })).statusCode, 200);
  await app.close();
});

test("PATCH /library/books answers 400, 401 and 404", async () => {
  const { app, service, patch } = await changeSetup();
  const key = bookKey(kobo);
  assert.equal((await patch({ bookKey: key, rating: 3 }, null)).statusCode, 401);
  assert.equal((await patch({ bookKey: key })).statusCode, 400);
  assert.equal((await patch({ bookKey: key, readStatus: 2 })).statusCode, 400);
  assert.equal((await patch({ bookKey: key, readStatus: 3 })).statusCode, 400);
  assert.equal((await patch({ bookKey: key, rating: 6 })).statusCode, 400);
  assert.equal((await patch({ bookKey: key, rating: 0 })).statusCode, 400);
  assert.equal((await patch({ bookKey: key, readStatus: 1, day: "yesterday" })).statusCode, 400);
  assert.equal((await patch({ bookKey: key, readStatus: 2, day: "2026-02-30" })).statusCode, 400);
  assert.equal((await patch({ bookKey: key, rating: 3 })).statusCode, 404);
  service.saveLibrary("u1", shelfLibrary());
  assert.equal((await patch({ bookKey: "ta:nobody|", rating: 3 })).statusCode, 404);
  await app.close();
});

test("POST /library/books/add appends a book, creating the library when there is none", async () => {
  const { app, service, add } = await changeSetup();
  const res = await add({ book: { Title: "Emma", Attribution: "Jane Austen", ReadStatus: 0 } });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { baseUpdatedAt: string | null }).baseUpdatedAt, null);
  assert.equal((service.getLibrary("u1")!.data as ReturnType<typeof shelfLibrary>).books.length, 1);
  assert.equal((await add({ book: { Title: "Dune" } })).statusCode, 200);
  assert.equal((service.getLibrary("u1")!.data as ReturnType<typeof shelfLibrary>).books.length, 2);
  await app.close();
});

test("POST /library/books/add answers 400, 401 and 413", async () => {
  const { app, add } = await changeSetup();
  assert.equal((await add({ book: { Title: "Dune" } }, null)).statusCode, 401);
  assert.equal((await add({})).statusCode, 400);
  assert.equal((await add({ book: {} })).statusCode, 400);
  assert.equal((await add({ book: { Title: "" } })).statusCode, 400);
  assert.equal((await add({ book: { Title: 5 } })).statusCode, 400);
  assert.equal((await add({ book: { Title: "Dune", padding: "x".repeat(65 * 1024) } })).statusCode, 413);
  await app.close();
});

test("a change that would push the library past the limit answers 413 with the size body", async () => {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const service = createLibraryService(createSqliteLibraryRepository(db), () => "", LIBRARY_PUT_HEADROOM_BYTES + 200);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildLibraryRoutes(service));
  const res = await app.inject({ method: "POST", url: "/library/books/add", headers: { authorization: "Bearer u1" }, payload: { book: { Title: "Dune", Attribution: "x".repeat(1000) } } });
  assert.equal(res.statusCode, 413);
  const body = res.json() as { code: string };
  assert.equal(body.code, "LIBRARY_BODY_TOO_LARGE");
  await app.close();
});

test("an unreadable stored document answers 500 and is left alone", async () => {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const repo = createSqliteLibraryRepository(db);
  const service = createLibraryService(repo, () => "", env.LIBRARY_BODY_LIMIT_BYTES);
  service.saveLibrary("u1", shelfLibrary());
  db.prepare("UPDATE library_documents SET data = ? WHERE user_id = ?").run("{broken", "u1");
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildLibraryRoutes(service));
  const res = await app.inject({ method: "PATCH", url: "/library/books", headers: { authorization: "Bearer u1" }, payload: { bookKey: bookKey(kobo), rating: 3 } });
  assert.equal(res.statusCode, 500);
  assert.equal(repo.getDocument("u1")!.data, "{broken");
  await app.close();
});

test("changes get 60 a minute per account, apart from whole-library saves", async () => {
  const { app, patch, put } = await changeSetup();
  for (let request = 1; request <= 60; request++) assert.notEqual((await patch({ bookKey: "a", rating: 3 })).statusCode, 429);
  assert.equal((await patch({ bookKey: "a", rating: 3 })).statusCode, 429);
  assert.notEqual((await patch({ bookKey: "a", rating: 3 }, "u2")).statusCode, 429);
  assert.notEqual((await put(smallSave)).statusCode, 429);
  await app.close();
});

test("add shares the writes bucket", async () => {
  const { app, add, otherWrite } = await changeSetup();
  for (let request = 1; request <= 30; request++) assert.notEqual((await add({ book: { Title: "Dune" } })).statusCode, 429);
  assert.equal((await add({ book: { Title: "Dune" } })).statusCode, 429);
  assert.equal((await otherWrite(0)).statusCode, 429);
  await app.close();
});

test("an old build that PUTs with the version it held before a change gets 409 and its replay succeeds", async () => {
  const { app, service, tick, put } = await changeSetup();
  const held = service.saveLibrary("u1", shelfLibrary());
  assert.equal((await tick({ bookKey: bookKey(kobo), member: true })).statusCode, 200);
  const stale = await put(JSON.stringify({ updatedAt: held.updatedAt, data: shelfLibrary() }));
  assert.equal(stale.statusCode, 409);
  const current = (stale.json() as { current: { updatedAt: string } }).current;
  assert.notEqual(current.updatedAt, held.updatedAt);
  const replay = await put(JSON.stringify({ updatedAt: current.updatedAt, data: shelfLibrary() }));
  assert.equal(replay.statusCode, 200);
  await app.close();
});

test("a change that loses a race for the document answers 409", async () => {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const repo = createSqliteLibraryRepository(db);
  createLibraryService(repo, () => "", env.LIBRARY_BODY_LIMIT_BYTES).saveLibrary("u1", shelfLibrary());
  const service = createLibraryService({ ...repo, updateDocumentData: () => undefined }, () => "", env.LIBRARY_BODY_LIMIT_BYTES);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildLibraryRoutes(service));
  const res = await app.inject({ method: "PATCH", url: "/library/books", headers: { authorization: "Bearer u1" }, payload: { bookKey: bookKey(kobo), rating: 3 } });
  assert.equal(res.statusCode, 409);
  assert.ok((res.json() as { error: string }).error);
  await app.close();
});

test("PUT and GET /library answer each copy's work id", async () => {
  const { app, put } = await setup();
  const saved = await put(JSON.stringify({ data: { books: [kobo] } }));
  assert.equal(saved.statusCode, 200);
  const workId = saved.json().works["ta:dune|frank herbert"];
  assert.equal(typeof workId, "string");
  const read = await app.inject({ method: "GET", url: "/library", headers: { authorization: "Bearer u1" } });
  assert.deepEqual(read.json().works, { "ta:dune|frank herbert": workId });
  await app.close();
});

const tagged = { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2, _key: "isbn:9999999999999", _workId: "some-work" };
const { _key: _ignoredKey, _workId: _ignoredWorkId, ...untagged } = tagged;

function storedKeys(db: DatabaseSync): string[] {
  return (db.prepare("SELECT book_key FROM library_books WHERE user_id = ? ORDER BY position").all("u1") as Array<{ book_key: string }>).map((row) => row.book_key);
}

test("PUT /library keys and stores a book without the client's _key and _workId", async () => {
  const { app, db, put } = await setup();
  const saved = await put(JSON.stringify({ data: { books: [tagged] } }));
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(storedKeys(db), [bookKey(untagged)]);
  assert.notEqual(storedKeys(db)[0], "isbn:9999999999999");
  const read = await app.inject({ method: "GET", url: "/library", headers: { authorization: "Bearer u1" } });
  assert.deepEqual(read.json().data.books, [untagged]);
  await app.close();
});

test("POST /library/books/add keys and stores a book without the client's _key and _workId", async () => {
  const { app, db, add } = await changeSetup();
  const res = await add({ book: tagged });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(storedKeys(db), [bookKey(untagged)]);
  const read = await app.inject({ method: "GET", url: "/library", headers: { authorization: "Bearer u1" } });
  assert.deepEqual(read.json().data.books, [{ ...untagged, _order: 0 }]);
  await app.close();
});

const styleUrl = "/library/reader-card/style";
const asUser = (user: string) => ({ authorization: `Bearer ${user}` });
const wizard = { Title: "A Wizard of Earthsea", Attribution: "Ursula K. Le Guin", ReadStatus: 2, highlights: [
  { Type: "highlight", Text: "To light a candle", BookmarkID: "h1" },
  { Type: "note", Text: "mine", Annotation: "private", BookmarkID: "n1" },
  { Type: "review", Text: "five stars", BookmarkID: "goodreads-review:1" },
] };
const unread = { Title: "Dune", Attribution: "Frank Herbert", ReadStatus: 1 };
const dispossessed = { Title: "The Dispossessed", Attribution: "Ursula K. Le Guin", ReadStatus: 2, highlights: [{ Type: "highlight", Text: "True journey is return", BookmarkID: "h2" }] };

test("GET reader card style returns the default before any change", async () => {
  const { app } = await setup();
  const response = await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { counter: "dial", layout: "faces", trait: "both", motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto", signature: null, highlight: null });
  await app.close();
});

test("PATCH reader card style merges each change into the stored style", async () => {
  const { app } = await setup();
  await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { counter: "shelf" } });
  const response = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { trait: "seal" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { counter: "shelf", layout: "faces", trait: "seal", motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto", signature: null, highlight: null });
  await app.close();
});

test("PATCH reader card style rejects unknown options and unknown fields", async () => {
  const { app, service } = await setup();
  service.saveLibrary("u1", { books: [wizard], groups: [] });
  const key = bookKey(wizard);
  for (const payload of [{ counter: "spiral" }, { layout: "scroll" }, { trait: 3 }, { motto: "x" }, { signature: { bookKey: key, note: "a".repeat(61) } }, { signature: { bookKey: key, motto: "x" } }, { highlight: { bookKey: key, highlightId: "h1", motto: "x" } }]) {
    const response = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.equal(typeof response.json().error, "string");
  }
  const stored = await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") });
  assert.deepEqual(stored.json(), { counter: "dial", layout: "faces", trait: "both", motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto", signature: null, highlight: null });
  await app.close();
});

test("PATCH reader card style stores a known layout", async () => {
  const { app } = await setup();
  const response = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { layout: "book" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().layout, "book");
  await app.close();
});

test("a counter or trait change keeps the stored signature and highlight", async () => {
  const { app, service } = await setup();
  service.saveLibrary("u1", { books: [wizard], groups: [] });
  const patch = (payload: object) => app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload });
  await patch({ signature: { bookKey: bookKey(wizard), note: "why" } });
  await patch({ highlight: { bookKey: bookKey(wizard), highlightId: "h1" } });
  const response = await patch({ counter: "ring" });
  assert.equal(response.statusCode, 200);
  const expected = { counter: "ring", layout: "faces", trait: "both", motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto", signature: { bookKey: bookKey(wizard), note: "why" }, highlight: { bookKey: bookKey(wizard), highlightId: "h1" } };
  assert.deepEqual(response.json(), expected);
  const stored = await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") });
  assert.deepEqual(stored.json(), expected);
  await app.close();
});

test("a signature must be a finished book in the caller's own library", async () => {
  const { app, service } = await setup();
  service.saveLibrary("u1", { books: [wizard, unread], groups: [] });
  const patch = (user: string, key: string) => app.inject({ method: "PATCH", url: styleUrl, headers: asUser(user), payload: { signature: { bookKey: key, note: "  why  " } } });
  assert.equal((await patch("u1", bookKey(unread))).statusCode, 400);
  assert.equal((await patch("u2", bookKey(wizard))).statusCode, 400);
  const ok = await patch("u1", bookKey(wizard));
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().signature, { bookKey: bookKey(wizard), note: "why" });
  await app.close();
});

test("a highlight must be one of the caller's Kobo highlights, not a note or a review", async () => {
  const { app, service } = await setup();
  service.saveLibrary("u1", { books: [wizard], groups: [] });
  const patch = (highlightId: string) => app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { highlight: { bookKey: bookKey(wizard), highlightId } } });
  assert.equal((await patch("n1")).statusCode, 400);
  assert.equal((await patch("goodreads-review:1")).statusCode, 400);
  assert.equal((await patch("h1")).statusCode, 200);
  const stored = await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") });
  assert.deepEqual(stored.json().highlight, { bookKey: bookKey(wizard), highlightId: "h1" });
  await app.close();
});

test("a highlight id only counts under the book it belongs to", async () => {
  const { app, service } = await setup();
  service.saveLibrary("u1", { books: [wizard, dispossessed], groups: [] });
  const patch = (key: string, highlightId: string) => app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { highlight: { bookKey: key, highlightId } } });
  assert.equal((await patch(bookKey(dispossessed), "h1")).statusCode, 400);
  assert.equal((await patch(bookKey(wizard), "h2")).statusCode, 400);
  const stored = await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") });
  assert.equal(stored.json().highlight, null);
  assert.equal((await patch(bookKey(dispossessed), "h2")).statusCode, 200);
  await app.close();
});

test("a rejected choice stores nothing, and null clears a choice", async () => {
  const { app, service } = await setup();
  service.saveLibrary("u1", { books: [wizard, unread], groups: [] });
  await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { signature: { bookKey: bookKey(wizard) } } });
  await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { counter: "ring", signature: { bookKey: bookKey(unread) } } });
  const afterReject = (await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") })).json();
  assert.equal(afterReject.counter, "dial");
  assert.equal(afterReject.signature.bookKey, bookKey(wizard));
  const cleared = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { signature: null } });
  assert.equal(cleared.json().signature, null);
  await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { highlight: { bookKey: bookKey(wizard), highlightId: "h1" } } });
  const highlightCleared = await app.inject({ method: "PATCH", url: styleUrl, headers: asUser("u1"), payload: { highlight: null } });
  assert.equal(highlightCleared.statusCode, 200);
  assert.equal(highlightCleared.json().highlight, null);
  const stored = await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") });
  assert.equal(stored.json().highlight, null);
  await app.close();
});

test("the reader card style needs a signed-in user", async () => {
  const { app } = await setup();
  assert.equal((await app.inject({ method: "GET", url: styleUrl })).statusCode, 401);
  assert.equal((await app.inject({ method: "PATCH", url: styleUrl, payload: { counter: "shelf" } })).statusCode, 401);
  const stored = await app.inject({ method: "GET", url: styleUrl, headers: asUser("u1") });
  assert.deepEqual(stored.json(), { counter: "dial", layout: "faces", trait: "both", motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto", signature: null, highlight: null });
  await app.close();
});
