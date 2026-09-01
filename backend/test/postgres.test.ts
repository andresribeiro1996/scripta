// Runs the SAME behavioural expectations as the SQLite adapter against
// real Postgres. Two adapters behind one port are only interchangeable if
// they actually behave the same, and the only way to know that is to ask
// both the same questions.
//
// Needs a Postgres to talk to. Set TEST_DATABASE_URL and these run;
// leave it unset and they skip, so `npm test` still works on a checkout
// with no database. CI sets it via a service container.
//
//   TEST_DATABASE_URL=postgres://atmyshelf:atmyshelf@127.0.0.1:5432/atmyshelf_test npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import pg from "pg";

import { toContents, toDocument } from "../src/modules/library/domain/document.js";
import { initLibrarySchema } from "../src/modules/library/adapters/postgres/connection.js";
import { createPgLibraryRepository } from "../src/modules/library/adapters/postgres/pgLibraryRepository.js";
import { createLibraryService } from "../src/modules/library/service.js";
import type { LibraryRepository } from "../src/modules/library/domain/ports.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/** The same document the SQLite suite round-trips, so the two adapters
 *  are compared on identical input. */
function sampleDocument() {
  return {
    source: "kobo-export",
    schema_version: 1,
    book_count: 2,
    name: "Andre's Library",
    books: [
      {
        ContentID: "file:///mnt/onboard/dune.epub",
        Title: "Dune",
        Attribution: "Frank Herbert",
        ISBN: "9780441013593",
        Series: "Dune",
        ReadStatus: 2,
        ___PercentRead: 100,
        _order: 0,
        _coverUrl: null,
        SomeFutureKoboColumn: "keep me",
        highlights: [
          { BookmarkID: "bm-1", Text: "A beginning is a very delicate time.", Type: "highlight" },
          { BookmarkID: "bm-2", Text: "Fear is the mind-killer.", Annotation: "the litany" }
        ]
      },
      { ContentID: "goodreads:12345", Title: "Some Indie Book", Attribution: "A. Writer", ReadStatus: 1, _order: 1 }
    ],
    groups: [
      {
        id: "g-1",
        type: "series",
        name: "Dune",
        bookKeys: ["isbn:9780441013593"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        style: { cardRadius: 12 }
      },
      {
        id: "g-2",
        type: "collection",
        name: "Favourites",
        bookKeys: ["isbn:9780441013593", "ta:some indie book|a. writer"],
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z"
      }
    ],
    style: { cardMinWidth: 180, cardGap: 12 },
    murals: [
      {
        id: "m-1",
        name: "2026 reading",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
        coverImageId: "img-1",
        coverImageUrl: "https://example.test/img-1.webp",
        blocks: [
          { id: "b-1", type: "spotlight", layout: { x: 0, y: 0, w: 2, h: 3 }, bookKey: "isbn:9780441013593", caption: "Reread" },
          {
            id: "b-2",
            type: "tierlist",
            layout: { x: 2, y: 0, w: 4, h: 5 },
            title: "Ranked",
            tiers: [{ id: "t-1", label: "S", color: "#c9482f", bookKeys: ["isbn:9780441013593"] }],
            pool: []
          }
        ]
      }
    ]
  };
}

describe("postgres adapter", { skip: DATABASE_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let pool: pg.Pool;
  let repo: LibraryRepository;

  before(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: false, max: 4 });
    await initLibrarySchema(pool);
    repo = createPgLibraryRepository(pool);
  });

  after(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // Truncate rather than drop: keeps the schema, and proves the schema
    // is re-runnable (initLibrarySchema uses IF NOT EXISTS throughout).
    await pool.query("TRUNCATE library_settings, books, highlights, groups, group_books, murals, mural_blocks");
  });

  it("stores and reassembles a library unchanged", async () => {
    const original = sampleDocument();
    await repo.replaceContents("user-1", toContents(original, 1, "2026-03-01T00:00:00.000Z"));

    assert.deepEqual(toDocument((await repo.getContents("user-1"))!), original);
  });

  it("produces the byte-identical document the SQLite adapter does", async () => {
    // The actual interchangeability claim: same input, same output, so a
    // migration between the two can't quietly reshape anyone's library.
    const { DatabaseSync } = await import("node:sqlite");
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { createSqliteLibraryRepository } = await import("../src/modules/library/adapters/sqlite/sqliteLibraryRepository.js");

    const here = dirname(fileURLToPath(import.meta.url));
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec(readFileSync(join(here, "../src/modules/library/adapters/sqlite/schema.sql"), "utf8"));
    const sqliteRepo = createSqliteLibraryRepository(sqlite);

    const original = sampleDocument();
    const contents = toContents(original, 1, "2026-03-01T00:00:00.000Z");
    await sqliteRepo.replaceContents("user-1", contents);
    await repo.replaceContents("user-1", contents);

    assert.deepEqual(
      toDocument((await repo.getContents("user-1"))!),
      toDocument((await sqliteRepo.getContents("user-1"))!)
    );
  });

  it("returns undefined for a user who has never saved", async () => {
    assert.equal(await repo.getContents("nobody"), undefined);
    assert.equal(await repo.getVersion("nobody"), undefined);
  });

  it("replaces rather than accumulates on a second save", async () => {
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));
    await repo.replaceContents(
      "user-1",
      toContents({ books: [{ Title: "Replaced", Attribution: "C" }] }, 2, "2026-03-02T00:00:00.000Z")
    );

    const restored = toDocument((await repo.getContents("user-1"))!);
    assert.equal((restored.books as unknown[]).length, 1);
    assert.equal(restored.groups, undefined);
    assert.equal(restored.murals, undefined);
  });

  it("keeps two users' identically-id'd groups and murals separate", async () => {
    // The cross-tenant bug that was real in SQLite must not reappear here.
    await repo.replaceContents("alice", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));

    const bobs = sampleDocument();
    bobs.groups[0]!.name = "Bob's series";
    bobs.murals[0]!.blocks[0]!.layout = { x: 9, y: 9, w: 1, h: 1 };
    await repo.replaceContents("bob", toContents(bobs, 1, "2026-03-01T00:00:00.000Z"));

    const alice = (await repo.getContents("alice"))!;
    assert.equal(alice.groups[0]!.name, "Dune");
    assert.deepEqual(alice.murals[0]!.blocks.find((b) => b.id === "b-1")!.layout, { x: 0, y: 0, w: 2, h: 3 });
  });

  it("cascades a mural's blocks away when the mural is deleted", async () => {
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));
    await repo.deleteMural("user-1", "m-1");

    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM mural_blocks");
    assert.equal(rows[0].n, 0);
  });

  it("moves one block without touching anything else", async () => {
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));
    const result = await repo.saveMuralBlockLayout("user-1", "m-1", "b-1", { x: 5, y: 6, w: 1, h: 2 });

    assert.equal(result.updated, true);
    assert.equal(result.version, 2);
    const contents = (await repo.getContents("user-1"))!;
    assert.deepEqual(contents.murals[0]!.blocks.find((b) => b.id === "b-1")!.layout, { x: 5, y: 6, w: 1, h: 2 });
    assert.deepEqual(contents.murals[0]!.blocks.find((b) => b.id === "b-2")!.layout, { x: 2, y: 0, w: 4, h: 5 });
    assert.equal(contents.books.length, 2);
  });

  it("reports a layout write that matched nothing, without bumping the version", async () => {
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));
    const result = await repo.saveMuralBlockLayout("user-1", "m-1", "gone", { x: 1, y: 1, w: 1, h: 1 });

    assert.equal(result.updated, false);
    assert.equal(result.version, 1);
  });

  it("will not let one user move another user's block", async () => {
    await repo.replaceContents("alice", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));
    const result = await repo.saveMuralBlockLayout("mallory", "m-1", "b-1", { x: 99, y: 99, w: 9, h: 9 });

    assert.equal(result.updated, false);
    const alice = (await repo.getContents("alice"))!;
    assert.deepEqual(alice.murals[0]!.blocks.find((b) => b.id === "b-1")!.layout, { x: 0, y: 0, w: 2, h: 3 });
  });

  it("rolls a failed write back rather than leaving a half-written library", async () => {
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));

    // A group whose type violates the CHECK constraint fails mid-transaction,
    // after books have already been deleted and rewritten.
    const broken = toContents(sampleDocument(), 2, "2026-03-02T00:00:00.000Z");
    (broken.groups[0] as { type: string }).type = "not-a-valid-type";

    await assert.rejects(() => repo.replaceContents("user-1", broken));

    // The original library must still be intact and readable.
    assert.deepEqual(toDocument((await repo.getContents("user-1"))!), sampleDocument());
  });

  it("enforces optimistic concurrency through the service, same as SQLite", async () => {
    const service = createLibraryService(repo);
    const first = await service.saveLibrary("u", { books: [{ Title: "A", Attribution: "X" }] });
    await service.saveLibrary("u", { books: [{ Title: "from-phone", Attribution: "X" }] }, first.version);

    await assert.rejects(() => service.saveLibrary("u", { books: [{ Title: "from-laptop", Attribution: "X" }] }, first.version));

    const books = ((await service.getLibrary("u"))!.data as { books: Array<{ Title: string }> }).books;
    assert.deepEqual(
      books.map((b) => b.Title),
      ["from-phone"]
    );
  });
});
