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
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
const { createSqliteMuralsRepository } = await import("./adapters/sqlite/sqliteMuralsRepository.js");
const { createMuralsService } = await import("./service.js");
const { buildMuralRoutes, buildPublicMuralRoutes } = await import("./routes.js");
const { openLibraryDb } = await import("../library/adapters/sqlite/connection.js");
const { getAuthenticatedUserFromAccessToken } = await import("../auth/tokens.js");
const { bookKey } = await import("@scripta/shared");
const authorization = (sub: string) => ({ authorization: `Bearer ${jwt.sign({ sub, email: `${sub}@example.test`, username: sub }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "5m" })}` });

test("murals routes preserve ownership, edits and public content boundaries", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8"));
  const service = createMuralsService(createSqliteMuralsRepository(db), (token) => `https://example.test/shared/${token}`);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => getAuthenticatedUserFromAccessToken(token, (id) => ["owner", "stranger"].includes(id) ? {
    id, email: `${id}@example.test`, username: id, avatar_id: null, google_id: null, password_hash: null, created_at: ""
  } : undefined));
  await app.register(buildMuralRoutes(service));
  await app.register(buildPublicMuralRoutes(service));
  const library = openLibraryDb();
  try {
    assert.equal((await app.inject({ method: "GET", url: "/murals" })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/murals", headers: authorization("owner"), payload: { name: "" } })).statusCode, 400);
    const create = () => app.inject({ method: "POST", url: "/murals", headers: authorization("owner"), payload: { name: "My reading space" } });
    const [a, b] = await Promise.all([create(), create()]);
    assert.equal(a.statusCode, 201);
    assert.equal(b.statusCode, 201);
    const home = a.json();
    assert.equal(service.listMurals("owner").length, 2);
    assert.equal((await app.inject({ method: "PUT", url: `/murals/${home.id}`, headers: authorization("stranger"), payload: { name: "Hijacked" } })).statusCode, 404);
    const book = { Title: "Shared title", Attribution: "Writer", _coverUrl: "https://example.test/cover.png", _genres: ["Fantasy"], Rating: 5, highlights: [{ BookmarkID: "secret", Type: "highlight", Text: "PRIVATE PASSAGE" }] };
    const hidden = { Title: "PRIVATE BOOK", Attribution: "Writer", _genres: ["History"] };
    library.prepare("INSERT INTO library_documents (user_id, data) VALUES (?, ?)").run("owner", JSON.stringify({ books: [book, hidden], groups: [{ id: "private-collection-id", type: "collection", name: "PRIVATE COLLECTION NAME", bookKeys: [bookKey(book)] }] }));
    service.updateMural("owner", home.id, { blocks: [
      { id: "s", type: "shelf", title: "", role: "finished", collectionId: "private-collection-id", bookKeys: [bookKey(hidden)], layout: { x: 0, y: 0, w: 8, h: 5 } },
      { id: "q", type: "quote", mode: "rediscover", bookKey: bookKey(book), highlightId: "secret", layout: { x: 0, y: 6, w: 8, h: 5 } },
      { id: "p", type: "profile", bio: "Reader", favoriteGenres: ["Fantasy"], layout: { x: 0, y: 12, w: 8, h: 5 } }
    ], updatedAt: home.updatedAt });
    const shared = service.share("owner", home.id)!;
    const response = await app.inject({ method: "GET", url: `/murals/shared/${shared.shareToken}` });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.books.length, 1);
    assert.equal(body.books[0].title, "Shared title");
    assert.deepEqual(body.highlights, []);
    assert.deepEqual(body.mural.blocks[0].bookKeys, [bookKey(book)]);
    assert.equal(body.mural.blocks[0].role, "finished");
    assert.equal(body.mural.blocks[1].type, "text");
    assert.deepEqual(body.shelfTheme, { genres: ["Fantasy", "History"], matchedBooks: 2, totalBooks: 2 });
    for (const privateValue of ["PRIVATE PASSAGE", "PRIVATE BOOK", "PRIVATE COLLECTION NAME", "private-collection-id", '"Rating"']) assert.equal(response.body.includes(privateValue), false);
    const stale = await app.inject({ method: "PUT", url: `/murals/${home.id}`, headers: authorization("owner"), payload: { blocks: [], updatedAt: home.updatedAt } });
    assert.equal(stale.statusCode, 409);
    assert.equal((await app.inject({ method: "DELETE", url: `/murals/${home.id}`, headers: authorization("owner") })).statusCode, 204);
    assert.equal(service.deleteMural("owner", b.json().id), true);
    assert.deepEqual(service.listMurals("owner"), []);
  } finally {
    await app.close();
    library.close();
    db.close();
  }
});

test("public mural payload carries the reader card without leaking titles or series names", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8"));
  const service = createMuralsService(createSqliteMuralsRepository(db), (token) => `https://example.test/shared/${token}`);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => getAuthenticatedUserFromAccessToken(token, (id) => id === "cardOwner" ? {
    id, email: `${id}@example.test`, username: id, avatar_id: null, google_id: null, password_hash: null, created_at: ""
  } : undefined));
  await app.register(buildMuralRoutes(service));
  await app.register(buildPublicMuralRoutes(service));
  const library = openLibraryDb();
  try {
    const create = () => app.inject({ method: "POST", url: "/murals", headers: authorization("cardOwner"), payload: { name: "My reading space" } });
    const [withCard, withoutCard] = await Promise.all([create(), create()]);
    const seriesBooks = [
      { Title: "Klara 1", Attribution: "Author A", ReadStatus: 2 },
      { Title: "Klara 2", Attribution: "Author B", ReadStatus: 2 },
      { Title: "Klara 3", Attribution: "Author C", ReadStatus: 2 }
    ];
    const otherBooks = Array.from({ length: 7 }, (_, i) => ({ Title: `Standalone ${i}`, Attribution: `Author ${i + 4}`, ReadStatus: 2 }));
    const books = [...seriesBooks, ...otherBooks];
    library.prepare("INSERT INTO library_documents (user_id, data) VALUES (?, ?)").run("cardOwner", JSON.stringify({
      books,
      groups: [{ id: "series-id", type: "series", name: "Secret Series", bookKeys: seriesBooks.map(bookKey) }]
    }));
    const cardHome = withCard.json();
    const noCardHome = withoutCard.json();
    service.updateMural("cardOwner", cardHome.id, { blocks: [{ id: "c", type: "readerCard", layout: { x: 0, y: 0, w: 4, h: 6 } }], updatedAt: cardHome.updatedAt });
    const sharedWithCard = service.share("cardOwner", cardHome.id)!;
    const sharedWithoutCard = service.share("cardOwner", noCardHome.id)!;
    const withCardResponse = await app.inject({ method: "GET", url: `/murals/shared/${sharedWithCard.shareToken}` });
    const withoutCardResponse = await app.inject({ method: "GET", url: `/murals/shared/${sharedWithoutCard.shareToken}` });
    const withCardBody = withCardResponse.json();
    assert.deepEqual(withCardBody.readerCard, {
      state: "settled",
      identity: "carto",
      runnerUp: null,
      signal: { counted: 3, of: 10, label: "3 of 10 finished books are in a series" },
      coverage: ["genres known for 0 of 10 finished books"]
    });
    const readerCardJson = JSON.stringify(withCardBody.readerCard);
    assert.equal(readerCardJson.includes("Secret Series"), false);
    assert.equal(readerCardJson.includes("Klara"), false);
    assert.equal("readerCard" in withoutCardResponse.json(), false);
  } finally {
    await app.close();
    library.close();
    db.close();
  }
});
