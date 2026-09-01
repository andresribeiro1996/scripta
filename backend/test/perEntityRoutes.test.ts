// The per-entity write path: one entity per request instead of the whole
// library.
//
// Driven through a real Fastify instance via `inject`, not by calling the
// service directly, because the things most likely to be wrong here are
// at the HTTP layer — body schemas, the path/body id agreement check, and
// which domain error maps to which status.

import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { signAccessToken } from "../src/modules/auth/tokens.js";
import { createSqliteLibraryRepository } from "../src/modules/library/adapters/sqlite/sqliteLibraryRepository.js";
import { buildLibraryRoutes } from "../src/modules/library/routes.js";
import { createLibraryService, type LibraryService } from "../src/modules/library/service.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(testDir, "../src/modules/library/adapters/sqlite/schema.sql"), "utf8");

const USER = "user-1";

/** A genuine access token for USER, signed with the same secret the guard
 *  verifies against (test/.env.test). Minting a real one rather than
 *  stubbing the guard means these tests also prove the routes are actually
 *  behind auth — an unauthenticated request gets 401, which a stubbed
 *  guard would have hidden. */
const TOKEN = signAccessToken({ id: USER, email: "user-1@example.test", username: "user1" });

async function buildTestApp(service: LibraryService): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(buildLibraryRoutes(service));
  await app.ready();
  return app;
}

function seedDocument() {
  return {
    books: [
      { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", _order: 0 },
      { Title: "Indie", Attribution: "A. Writer", _order: 1 }
    ],
    groups: [
      {
        id: "g-1",
        type: "series",
        name: "Dune",
        bookKeys: ["isbn:9780441013593"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    murals: [
      {
        id: "m-1",
        name: "Board",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        blocks: [{ id: "b-1", type: "empty", layout: { x: 0, y: 0, w: 1, h: 1 } }]
      }
    ]
  };
}

describe("per-entity library routes", () => {
  let app: FastifyInstance;
  let service: LibraryService;

  beforeEach(async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(SCHEMA);
    service = createLibraryService(createSqliteLibraryRepository(db));
    await service.saveLibrary(USER, seedDocument());
    app = await buildTestApp(service);
  });

  async function currentDocument() {
    return (await service.getLibrary(USER))!.data as {
      books: Array<Record<string, unknown>>;
      groups?: Array<Record<string, unknown>>;
      murals?: Array<Record<string, unknown>>;
    };
  }

  describe("books", () => {
    it("saves one book without touching the rest of the library", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/library/books",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { book: { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", _order: 0, _style: { cardRadius: 8 } } }
      });

      assert.equal(response.statusCode, 200);
      assert.equal((response.json() as { bookKey: string }).bookKey, "isbn:9780441013593");

      const document = await currentDocument();
      assert.equal(document.books.length, 2, "the other book must survive");
      assert.deepEqual(document.books.find((b) => b.ISBN === "9780441013593")!._style, { cardRadius: 8 });
      assert.equal(document.groups!.length, 1, "groups must be untouched");
      assert.equal(document.murals!.length, 1, "murals must be untouched");
    });

    it("derives the key from the record rather than trusting the caller", async () => {
      // A client-supplied key that disagreed with the record's own fields
      // would orphan every group and mural block referencing that book.
      const response = await app.inject({
        method: "PUT",
        url: "/library/books",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { book: { Title: "Whatever", Attribution: "X", ISBN: "9780441013593" }, bookKey: "isbn:0000000000000" }
      });

      assert.equal((response.json() as { bookKey: string }).bookKey, "isbn:9780441013593");
    });

    it("deletes one book by key", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/library/books",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { bookKey: "isbn:9780441013593" }
      });

      assert.equal(response.statusCode, 200);
      const document = await currentDocument();
      assert.equal(document.books.length, 1);
      assert.equal(document.books[0]!.Title, "Indie");
    });

    it("handles a key containing a slash", async () => {
      // "AC/DC" as a title produces ta:ac/dc|..., which is exactly why the
      // key travels in the body rather than the path.
      await app.inject({ method: "PUT", url: "/library/books", headers: { authorization: `Bearer ${TOKEN}` }, payload: { book: { Title: "AC/DC", Attribution: "Band" } } });
      const key = "ta:ac/dc|band";
      assert.ok((await currentDocument()).books.some((b) => b.Title === "AC/DC"));

      const response = await app.inject({ method: "DELETE", url: "/library/books", headers: { authorization: `Bearer ${TOKEN}` }, payload: { bookKey: key } });
      assert.equal(response.statusCode, 200);
      assert.equal((await currentDocument()).books.some((b) => b.Title === "AC/DC"), false);
    });

    it("rejects a body that isn't a book", async () => {
      const response = await app.inject({ method: "PUT", url: "/library/books", headers: { authorization: `Bearer ${TOKEN}` }, payload: { book: "not an object" } });
      assert.equal(response.statusCode, 400);
    });
  });

  describe("groups", () => {
    it("saves one group without touching books or murals", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/library/groups/g-1",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: {
          group: {
            id: "g-1",
            type: "series",
            name: "Renamed",
            bookKeys: ["isbn:9780441013593"],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z"
          }
        }
      });

      assert.equal(response.statusCode, 200);
      const document = await currentDocument();
      assert.equal(document.groups![0]!.name, "Renamed");
      assert.equal(document.books.length, 2);
      assert.equal(document.murals!.length, 1);
    });

    it("creates a group that did not exist", async () => {
      await app.inject({
        method: "PUT",
        url: "/library/groups/g-2",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: {
          group: { id: "g-2", type: "collection", name: "Favourites", bookKeys: [], createdAt: "x", updatedAt: "x" }
        }
      });

      const groups = (await currentDocument()).groups!;
      assert.equal(groups.length, 2);
      assert.ok(groups.some((g) => g.id === "g-2"));
    });

    it("refuses a path id that disagrees with the body", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/library/groups/g-1",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { group: { id: "g-999", type: "series", name: "Mismatch", bookKeys: [] } }
      });

      assert.equal(response.statusCode, 400);
      assert.equal((await currentDocument()).groups![0]!.name, "Dune", "nothing should have been written");
    });

    it("deletes a group and leaves its books alone", async () => {
      const response = await app.inject({ method: "DELETE", url: "/library/groups/g-1", headers: { authorization: `Bearer ${TOKEN}` } });

      assert.equal(response.statusCode, 200);
      const document = await currentDocument();
      assert.equal(document.groups, undefined);
      assert.equal(document.books.length, 2, "deleting a group must not delete its books");
    });
  });

  describe("murals", () => {
    it("saves one mural, blocks and all", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/library/murals/m-1",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: {
          mural: {
            id: "m-1",
            name: "Renamed board",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
            blocks: [
              { id: "b-1", type: "empty", layout: { x: 0, y: 0, w: 1, h: 1 } },
              { id: "b-2", type: "text", layout: { x: 1, y: 0, w: 2, h: 2 }, heading: "New" }
            ]
          }
        }
      });

      assert.equal(response.statusCode, 200);
      const mural = (await currentDocument()).murals![0] as { name: string; blocks: Array<Record<string, unknown>> };
      assert.equal(mural.name, "Renamed board");
      assert.equal(mural.blocks.length, 2);
      assert.equal(mural.blocks[1]!.heading, "New");
    });

    it("deletes a mural and cascades its blocks", async () => {
      const response = await app.inject({ method: "DELETE", url: "/library/murals/m-1", headers: { authorization: `Bearer ${TOKEN}` } });

      assert.equal(response.statusCode, 200);
      assert.equal((await currentDocument()).murals, undefined);
      assert.equal((await currentDocument()).books.length, 2);
    });
  });

  it("rejects every per-entity route without a token", async () => {
    // These write to a named account, so an unauthenticated caller must
    // not reach them at all.
    for (const [method, url] of [
      ["PUT", "/library/books"],
      ["DELETE", "/library/books"],
      ["PUT", "/library/groups/g-1"],
      ["DELETE", "/library/groups/g-1"],
      ["PUT", "/library/murals/m-1"],
      ["DELETE", "/library/murals/m-1"]
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      assert.equal(response.statusCode, 401, `${method} ${url} must require auth`);
    }
  });

  describe("optimistic concurrency", () => {
    it("refuses a stale per-entity write with 409", async () => {
      const stale = (await service.getLibrary(USER))!.version;
      // Someone else saves in between.
      await service.saveLibrary(USER, seedDocument(), stale);

      const response = await app.inject({
        method: "PUT",
        url: "/library/groups/g-1",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { group: { id: "g-1", type: "series", name: "Too late", bookKeys: [] }, expectedVersion: stale }
      });

      assert.equal(response.statusCode, 409);
      assert.equal((await currentDocument()).groups![0]!.name, "Dune");
    });

    it("accepts a write quoting the current version", async () => {
      const version = (await service.getLibrary(USER))!.version;
      const response = await app.inject({
        method: "PUT",
        url: "/library/groups/g-1",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { group: { id: "g-1", type: "series", name: "In step", bookKeys: [] }, expectedVersion: version }
      });

      assert.equal(response.statusCode, 200);
      assert.equal((await currentDocument()).groups![0]!.name, "In step");
    });

    it("honours the precondition on a delete too", async () => {
      const stale = (await service.getLibrary(USER))!.version;
      await service.saveLibrary(USER, seedDocument(), stale);

      const response = await app.inject({
        method: "DELETE",
        url: "/library/murals/m-1",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { expectedVersion: stale }
      });

      assert.equal(response.statusCode, 409);
      assert.equal((await currentDocument()).murals!.length, 1);
    });

    it("bumps the version on every per-entity write, so the next one can quote it", async () => {
      const before = (await service.getLibrary(USER))!.version;
      await app.inject({
        method: "PUT",
        url: "/library/books",
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { book: { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593" } }
      });

      assert.equal((await service.getLibrary(USER))!.version, before + 1);
    });
  });
});
