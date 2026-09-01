// The first tests in this repo. They exist because slice 1 of the library
// normalisation ships a DATA MIGRATION, and a migration that has never
// been run against a realistic document is the one thing that cannot be
// safely deployed to other people's data.
//
// Uses node:test + node:sqlite — both built in, no new dependency. Run
// with `npm test`.
//
// The database is in-memory, so these are fast and leave nothing behind.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { bookKey, toContents, toDocument } from "../src/modules/library/domain/document.js";
import { migrateDocumentsToEntities } from "../src/modules/library/adapters/sqlite/migrateFromDocuments.js";
import { createSqliteLibraryRepository } from "../src/modules/library/adapters/sqlite/sqliteLibraryRepository.js";
import { createLibraryService } from "../src/modules/library/service.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(testDir, "../src/modules/library/adapters/sqlite/schema.sql"), "utf8");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

/** A document exercising the shapes that actually occur: a book with an
 *  ISBN and one without (so both bookKey branches are covered), Kobo
 *  fields the backend has never heard of, app-managed `_` fields,
 *  highlights, a series group and a collection, and a mural with two
 *  different block variants. */
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
        // A field no part of the backend knows about — must survive.
        SomeFutureKoboColumn: "keep me",
        highlights: [
          { BookmarkID: "bm-1", Text: "A beginning is a very delicate time.", Type: "highlight" },
          { BookmarkID: "bm-2", Text: "Fear is the mind-killer.", Annotation: "the litany" }
        ]
      },
      {
        // No ISBN — exercises the title+author fallback key.
        ContentID: "goodreads:12345",
        Title: "Some Indie Book",
        Attribution: "A. Writer",
        ReadStatus: 1,
        _order: 1
      }
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

describe("bookKey", () => {
  it("matches the frontend's ISBN-first identity", async () => {
    assert.equal(bookKey({ ISBN: "978-0-441-01359-3", Title: "Dune" }), "isbn:9780441013593");
  });

  it("falls back to normalized title+author when there is no usable ISBN", async () => {
    assert.equal(bookKey({ Title: "  Some   Indie Book ", Attribution: "A. Writer" }), "ta:some indie book|a. writer");
  });

  it("ignores a malformed ISBN rather than trusting it", async () => {
    assert.equal(bookKey({ ISBN: "not-an-isbn", Title: "X", Attribution: "Y" }), "ta:x|y");
  });
});

describe("document round trip", () => {
  it("preserves every field, including ones the backend doesn't model", async () => {
    const original = sampleDocument();
    const restored = toDocument(toContents(original, 1, "2026-03-01T00:00:00.000Z"));

    assert.deepEqual(restored, original);
  });

  it("keeps unknown top-level fields a future importer might add", async () => {
    const original = { ...sampleDocument(), someFutureTopLevelField: { nested: true } };
    const restored = toDocument(toContents(original, 1, "2026-03-01T00:00:00.000Z"));

    assert.deepEqual(restored.someFutureTopLevelField, { nested: true });
  });

  it("does not invent a highlights array for a book that never had one", async () => {
    const restored = toDocument(
      toContents({ books: [{ Title: "No highlights", Attribution: "X" }] }, 1, "2026-03-01T00:00:00.000Z")
    );
    const books = restored.books as Array<Record<string, unknown>>;

    assert.equal("highlights" in books[0]!, false);
  });

  it("keeps a highlight that arrived without a BookmarkID instead of dropping it", async () => {
    // The schema makes bookmark_id part of the primary key, so a missing
    // one has to be synthesized — losing a user's annotation to a
    // constraint would be the worst possible failure mode here.
    const contents = toContents(
      { books: [{ Title: "T", Attribution: "A", highlights: [{ Text: "orphan" }, { Text: "another" }] }] },
      1,
      "2026-03-01T00:00:00.000Z"
    );

    assert.equal(contents.books[0]!.highlights.length, 2);
    const ids = contents.books[0]!.highlights.map((h) => h.BookmarkID);
    assert.equal(new Set(ids).size, 2, "synthesized ids must be unique");
  });

  it("survives an empty library", async () => {
    const restored = toDocument(toContents({ books: [] }, 1, "2026-03-01T00:00:00.000Z"));
    assert.deepEqual(restored, { books: [], book_count: 0 });
  });
});

describe("repository", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = freshDb();
  });

  it("stores and reassembles a library unchanged", async () => {
    const repo = createSqliteLibraryRepository(db);
    const original = sampleDocument();

    await repo.replaceContents("user-1", toContents(original, 1, "2026-03-01T00:00:00.000Z"));
    const restored = toDocument((await repo.getContents("user-1"))!);

    assert.deepEqual(restored, original);
  });

  it("keeps one user's library entirely separate from another's", async () => {
    const repo = createSqliteLibraryRepository(db);
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));
    await repo.replaceContents(
      "user-2",
      toContents({ books: [{ Title: "Only mine", Attribution: "B" }] }, 1, "2026-03-01T00:00:00.000Z")
    );

    const one = toDocument((await repo.getContents("user-1"))!);
    const two = toDocument((await repo.getContents("user-2"))!);

    assert.equal((one.books as unknown[]).length, 2);
    assert.equal((two.books as unknown[]).length, 1);
    assert.equal(two.groups, undefined);
  });

  it("replaces rather than accumulates on a second save", async () => {
    const repo = createSqliteLibraryRepository(db);
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));
    await repo.replaceContents(
      "user-1",
      toContents({ books: [{ Title: "Replaced", Attribution: "C" }] }, 2, "2026-03-02T00:00:00.000Z")
    );

    const restored = toDocument((await repo.getContents("user-1"))!);
    assert.equal((restored.books as unknown[]).length, 1);
    assert.equal(restored.groups, undefined, "old groups must not survive a replace");
    assert.equal(restored.murals, undefined, "old murals must not survive a replace");
  });

  it("returns undefined for a user who has never saved", async () => {
    const repo = createSqliteLibraryRepository(db);
    assert.equal(await repo.getContents("nobody"), undefined);
    assert.equal(await repo.getVersion("nobody"), undefined);
  });

  it("moves one mural block without touching anything else", async () => {
    // This is the write MuralEditorPage's drag handler should be making —
    // the whole reason for the normalisation.
    const repo = createSqliteLibraryRepository(db);
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));

    await repo.saveMuralBlockLayout("user-1", "m-1", "b-1", { x: 5, y: 6, w: 1, h: 2 });

    const contents = (await repo.getContents("user-1"))!;
    const mural = contents.murals[0]!;
    assert.deepEqual(mural.blocks.find((b) => b.id === "b-1")!.layout, { x: 5, y: 6, w: 1, h: 2 });
    // The neighbouring block, the books and the groups are all untouched.
    assert.deepEqual(mural.blocks.find((b) => b.id === "b-2")!.layout, { x: 2, y: 0, w: 4, h: 5 });
    assert.equal(contents.books.length, 2);
    assert.equal(contents.groups.length, 2);
    assert.equal(contents.settings.version, 2, "a write bumps the version");
  });

  it("will not let one user move another user's block", async () => {
    const repo = createSqliteLibraryRepository(db);
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));

    await repo.saveMuralBlockLayout("attacker", "m-1", "b-1", { x: 99, y: 99, w: 9, h: 9 });

    const mural = (await repo.getContents("user-1"))!.murals[0]!;
    assert.deepEqual(mural.blocks.find((b) => b.id === "b-1")!.layout, { x: 0, y: 0, w: 2, h: 3 });
  });

  it("cascades a mural's blocks away when the mural is deleted", async () => {
    const repo = createSqliteLibraryRepository(db);
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));

    await repo.deleteMural("user-1", "m-1");

    const orphans = db.prepare(`SELECT COUNT(*) AS n FROM mural_blocks`).get() as Record<string, unknown>;
    assert.equal(orphans.n, 0);
  });

  it("deletes a book's highlights along with the book", async () => {
    const repo = createSqliteLibraryRepository(db);
    await repo.replaceContents("user-1", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));

    await repo.deleteBook("user-1", "isbn:9780441013593");

    const remaining = db.prepare(`SELECT COUNT(*) AS n FROM highlights WHERE user_id = ?`).get("user-1") as Record<
      string,
      unknown
    >;
    assert.equal(remaining.n, 0);
  });
});

describe("migration from blob documents", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = freshDb();
  });

  function seedBlob(userId: string, document: unknown, updatedAt = "2026-01-01T00:00:00.000Z") {
    db.prepare(`INSERT INTO library_documents (user_id, data, updated_at) VALUES (?, ?, ?)`).run(
      userId,
      JSON.stringify(document),
      updatedAt
    );
  }

  it("migrates an existing blob into entities without losing anything", async () => {
    const original = sampleDocument();
    seedBlob("user-1", original);

    const result = await migrateDocumentsToEntities(db);
    assert.equal(result.ran, true);
    assert.equal(result.migrated, 1);
    assert.deepEqual(result.failed, []);

    const repo = createSqliteLibraryRepository(db);
    assert.deepEqual(toDocument((await repo.getContents("user-1"))!), original);
  });

  it("leaves the original blob row untouched, so a rollback is possible", async () => {
    seedBlob("user-1", sampleDocument());
    await migrateDocumentsToEntities(db);

    const row = db.prepare(`SELECT data FROM library_documents WHERE user_id = ?`).get("user-1") as Record<
      string,
      unknown
    >;
    assert.deepEqual(JSON.parse(String(row.data)), sampleDocument());
  });

  it("is idempotent — a second boot does not re-run or duplicate", async () => {
    seedBlob("user-1", sampleDocument());
    await migrateDocumentsToEntities(db);

    const second = await migrateDocumentsToEntities(db);
    assert.equal(second.ran, false);
    assert.equal(second.migrated, 0);

    const repo = createSqliteLibraryRepository(db);
    assert.equal((await repo.getContents("user-1"))!.books.length, 2);
  });

  it("does not clobber a user already written by the new code path", async () => {
    // The blob is the stale copy in this case, not the source of truth.
    seedBlob("user-1", sampleDocument());
    const repo = createSqliteLibraryRepository(db);
    await repo.replaceContents("user-1", toContents({ books: [{ Title: "Newer", Attribution: "N" }] }, 5, "2026-06-01T00:00:00.000Z"));

    const result = await migrateDocumentsToEntities(db);

    assert.equal(result.skipped, 1);
    assert.equal(result.migrated, 0);
    const contents = (await repo.getContents("user-1"))!;
    assert.equal(contents.books.length, 1);
    assert.equal(contents.settings.version, 5);
  });

  it("reports a malformed document instead of failing every other user", async () => {
    db.prepare(`INSERT INTO library_documents (user_id, data, updated_at) VALUES (?, ?, ?)`).run(
      "broken",
      "{not valid json",
      "2026-01-01T00:00:00.000Z"
    );
    seedBlob("fine", sampleDocument());

    const result = await migrateDocumentsToEntities(db);

    assert.equal(result.migrated, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0]!.userId, "broken");

    const repo = createSqliteLibraryRepository(db);
    assert.ok(await repo.getContents("fine"), "a broken row must not block a healthy one");
  });

  it("migrates many users in one pass", async () => {
    for (let i = 0; i < 25; i++) {
      seedBlob(`user-${i}`, { books: [{ Title: `Book ${i}`, Attribution: "A" }] });
    }

    const result = await migrateDocumentsToEntities(db);

    assert.equal(result.migrated, 25);
    const repo = createSqliteLibraryRepository(db);
    assert.equal((await repo.getContents("user-24"))!.books.length, 1);
  });
});

describe("service (document compatibility layer)", () => {
  it("round-trips through the same API the frontend already calls", async () => {
    const db = freshDb();
    const service = createLibraryService(createSqliteLibraryRepository(db));
    const original = sampleDocument();

    assert.equal(await service.getLibrary("user-1"), null);

    const saved = await service.saveLibrary("user-1", original);
    assert.deepEqual(saved.data, original);
    assert.equal(saved.version, 1);

    const read = (await service.getLibrary("user-1"))!;
    assert.deepEqual(read.data, original);
    assert.equal(read.version, 1);
  });

  it("increments the version on each save, for the concurrency check in slice 2", async () => {
    const db = freshDb();
    const service = createLibraryService(createSqliteLibraryRepository(db));

    assert.equal((await service.saveLibrary("user-1", { books: [] })).version, 1);
    assert.equal((await service.saveLibrary("user-1", { books: [] })).version, 2);
    assert.equal((await service.saveLibrary("user-1", { books: [] })).version, 3);
  });
});

describe("tenant isolation", () => {
  // Regression tests for a real bug found by smoke-testing two accounts
  // against one server: groups, murals and mural blocks were keyed on
  // `id` ALONE. Those ids are generated client-side, so one account
  // saving a group whose id matched another account's hit ON CONFLICT and
  // overwrote that account's row — and for mural_blocks the conflict
  // update reassigned user_id too, handing one user's block to another.
  // The primary keys are now (user_id, id).
  let db: DatabaseSync;

  beforeEach(() => {
    db = freshDb();
  });

  it("keeps two users' identically-id'd groups and murals separate", async () => {
    const repo = createSqliteLibraryRepository(db);

    // Both users save a group "g-1" and a mural "m-1" with block "b-1" —
    // exactly what two clients generating ids independently can produce.
    await repo.replaceContents("alice", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));

    const bobs = sampleDocument();
    bobs.name = "Bob's Library";
    bobs.groups[0]!.name = "Bob's series";
    bobs.murals[0]!.name = "Bob's board";
    bobs.murals[0]!.blocks[0]!.layout = { x: 9, y: 9, w: 1, h: 1 };
    await repo.replaceContents("bob", toContents(bobs, 1, "2026-03-01T00:00:00.000Z"));

    const alice = (await repo.getContents("alice"))!;
    const bob = (await repo.getContents("bob"))!;

    assert.equal(alice.settings.name, "Andre's Library");
    assert.equal(alice.groups[0]!.name, "Dune", "Bob's save must not rename Alice's group");
    assert.equal(alice.murals[0]!.name, "2026 reading");
    assert.deepEqual(alice.murals[0]!.blocks.find((b) => b.id === "b-1")!.layout, { x: 0, y: 0, w: 2, h: 3 });

    assert.equal(bob.groups[0]!.name, "Bob's series");
    assert.equal(bob.murals[0]!.name, "Bob's board");
    assert.deepEqual(bob.murals[0]!.blocks.find((b) => b.id === "b-1")!.layout, { x: 9, y: 9, w: 1, h: 1 });
  });

  it("does not let deleting one user's mural touch another's with the same id", async () => {
    const repo = createSqliteLibraryRepository(db);
    await repo.replaceContents("alice", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));
    await repo.replaceContents("bob", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));

    await repo.deleteMural("bob", "m-1");

    assert.equal((await repo.getContents("alice"))!.murals.length, 1, "Alice's mural must survive");
    assert.equal((await repo.getContents("bob"))!.murals.length, 0);
    // ...and Alice's blocks must not have been cascaded away with Bob's.
    assert.equal((await repo.getContents("alice"))!.murals[0]!.blocks.length, 2);
  });

  it("does not let deleting one user's group empty another's membership list", async () => {
    const repo = createSqliteLibraryRepository(db);
    await repo.replaceContents("alice", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));
    await repo.replaceContents("bob", toContents(sampleDocument(), 1, "2026-03-01T00:00:00.000Z"));

    await repo.deleteGroup("bob", "g-1");

    const alice = (await repo.getContents("alice"))!;
    assert.equal(alice.groups.length, 2);
    assert.deepEqual(alice.groups.find((g) => g.id === "g-1")!.bookKeys, ["isbn:9780441013593"]);
  });
});
