import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import Fastify from "fastify";
import jwt from "jsonwebtoken";

const scratch = mkdtempSync(join(tmpdir(), "scripta-home-test-"));
for (const key of ["AUTH", "LIBRARY", "MURALS", "COVERS", "GALLERY", "TIERLISTS", "ARENA"]) process.env[`${key}_DB_PATH`] = join(scratch, `${key}.sqlite`);
process.env.GALLERY_STORAGE_PATH = join(scratch, "gallery");
process.env.COVERS_STORAGE_PATH = join(scratch, "covers");
process.env.JWT_ACCESS_SECRET = "home-test-access-secret-at-least-32-characters";
process.env.JWT_REFRESH_SECRET = "home-test-refresh-secret-at-least-32-characters";
const { createSqliteMuralsRepository } = await import("./adapters/sqlite/sqliteMuralsRepository.js");
const { createMuralsService } = await import("./service.js");
const { buildMuralRoutes, buildPublicMuralRoutes } = await import("./routes.js");
const { openLibraryDb } = await import("../library/adapters/sqlite/connection.js");
const { bookKey } = await import("@scripta/shared");
const authorization = (sub: string) => ({ authorization: `Bearer ${jwt.sign({ sub, email: `${sub}@example.test`, username: sub }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "5m" })}` });

test("home routes preserve ownership, retries, edits and public content boundaries", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8"));
  const service = createMuralsService(createSqliteMuralsRepository(db), (token) => `https://example.test/shared/${token}`);
  const app = Fastify();
  await app.register(buildMuralRoutes(service));
  await app.register(buildPublicMuralRoutes(service));
  const library = openLibraryDb();
  try {
    assert.equal((await app.inject({ method: "GET", url: "/murals/home" })).statusCode, 401);
    assert.deepEqual((await app.inject({ method: "GET", url: "/murals/home", headers: authorization("owner") })).json(), { mural: null });
    assert.equal((await app.inject({ method: "POST", url: "/murals/home", headers: authorization("owner"), payload: { withPassage: "yes" } })).statusCode, 400);
    const create = () => app.inject({ method: "POST", url: "/murals/home", headers: authorization("owner"), payload: { withPassage: true } });
    const [a, b] = await Promise.all([create(), create()]);
    assert.equal(a.statusCode, 200);
    const home = a.json();
    assert.equal(home.id, b.json().id);
    assert.equal(service.listMurals("owner").length, 1);
    assert.equal((await app.inject({ method: "PUT", url: "/murals/home", headers: authorization("stranger"), payload: { muralId: home.id } })).statusCode, 404);
    assert.deepEqual((await app.inject({ method: "GET", url: "/murals/home", headers: authorization("stranger") })).json(), { mural: null });
    const book = { Title: "Shared title", Attribution: "Writer", _coverUrl: "https://example.test/cover.png", Rating: 5, highlights: [{ BookmarkID: "secret", Type: "highlight", Text: "PRIVATE PASSAGE" }] };
    const hidden = { Title: "PRIVATE BOOK", Attribution: "Writer" };
    library.prepare("INSERT INTO library_documents (user_id, data) VALUES (?, ?)").run("owner", JSON.stringify({ books: [book, hidden], groups: [{ id: "private-collection-id", type: "collection", name: "PRIVATE COLLECTION NAME", bookKeys: [bookKey(book)] }] }));
    service.updateMural("owner", home.id, { blocks: [
      { id: "s", type: "shelf", title: "", collectionId: "private-collection-id", bookKeys: [bookKey(hidden)], layout: { x: 0, y: 0, w: 8, h: 5 } },
      { id: "q", type: "quote", mode: "rediscover", bookKey: bookKey(book), highlightId: "secret", layout: { x: 0, y: 6, w: 8, h: 5 } }
    ], updatedAt: home.updatedAt });
    const shared = service.share("owner", home.id)!;
    const response = await app.inject({ method: "GET", url: `/murals/shared/${shared.shareToken}` });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.books.length, 1);
    assert.equal(body.books[0].title, "Shared title");
    assert.deepEqual(body.highlights, []);
    assert.deepEqual(body.mural.blocks[0].bookKeys, [bookKey(book)]);
    assert.equal(body.mural.blocks[1].type, "text");
    for (const privateValue of ["PRIVATE PASSAGE", "PRIVATE BOOK", "PRIVATE COLLECTION NAME", "private-collection-id", '"Rating"']) assert.equal(response.body.includes(privateValue), false);
    assert.equal((await create()).json().blocks.length, 2);
    const stale = await app.inject({ method: "PUT", url: `/murals/${home.id}`, headers: authorization("owner"), payload: { blocks: [], updatedAt: home.updatedAt } });
    assert.equal(stale.statusCode, 409);
    assert.equal((await app.inject({ method: "DELETE", url: `/murals/${home.id}`, headers: authorization("owner") })).statusCode, 204);
    assert.deepEqual((await app.inject({ method: "GET", url: "/murals/home", headers: authorization("owner") })).json(), { mural: null });
  } finally {
    await app.close();
    library.close();
    db.close();
  }
});
