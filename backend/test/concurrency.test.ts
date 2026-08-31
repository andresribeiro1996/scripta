// Covers the optimistic-concurrency precondition and the per-entity
// block-layout write — the two halves of slice 2.
//
// The bug being fixed: PUT /library was unconditional last-write-wins, so
// two devices editing the same account silently lost one side's changes
// with nothing surfaced to anyone. These tests assert the conflict is now
// detected, that the loser gets the current document back so it can
// re-apply, and that a stale write does NOT land.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";

import { LibraryEntityNotFoundError, LibraryVersionConflictError } from "../src/modules/library/domain/errors.js";
import { createSqliteLibraryRepository } from "../src/modules/library/adapters/sqlite/sqliteLibraryRepository.js";
import { createLibraryService, type LibraryService } from "../src/modules/library/service.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(testDir, "../src/modules/library/adapters/sqlite/schema.sql"), "utf8");

function freshService(): LibraryService {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return createLibraryService(createSqliteLibraryRepository(db));
}

function libraryWith(titles: string[]) {
  return { books: titles.map((title, index) => ({ Title: title, Attribution: "A", _order: index })) };
}

function muralDocument(x: number) {
  return {
    books: [],
    murals: [
      {
        id: "m-1",
        name: "Board",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        blocks: [{ id: "b-1", type: "empty", layout: { x, y: 0, w: 2, h: 2 } }]
      }
    ]
  };
}

describe("optimistic concurrency on the document write", () => {
  let service: LibraryService;

  beforeEach(() => {
    service = freshService();
  });

  it("accepts a write quoting the current version", () => {
    const first = service.saveLibrary("u", libraryWith(["A"]));
    const second = service.saveLibrary("u", libraryWith(["A", "B"]), first.version);

    assert.equal(second.version, first.version + 1);
    assert.equal((service.getLibrary("u")!.data as { books: unknown[] }).books.length, 2);
  });

  it("rejects a write quoting a stale version", () => {
    const first = service.saveLibrary("u", libraryWith(["A"]));
    // Another device saves in between.
    service.saveLibrary("u", libraryWith(["A", "from-phone"]), first.version);

    assert.throws(
      () => service.saveLibrary("u", libraryWith(["A", "from-laptop"]), first.version),
      LibraryVersionConflictError
    );
  });

  it("does not apply the losing write — this is the data loss being fixed", () => {
    const first = service.saveLibrary("u", libraryWith(["A"]));
    service.saveLibrary("u", libraryWith(["A", "from-phone"]), first.version);

    try {
      service.saveLibrary("u", libraryWith(["A", "from-laptop"]), first.version);
    } catch {
      // expected
    }

    const books = (service.getLibrary("u")!.data as { books: Array<{ Title: string }> }).books;
    assert.deepEqual(
      books.map((b) => b.Title),
      ["A", "from-phone"],
      "the phone's save must survive the laptop's stale attempt"
    );
  });

  it("reports both versions so the client can re-apply", () => {
    const first = service.saveLibrary("u", libraryWith(["A"]));
    service.saveLibrary("u", libraryWith(["A", "B"]), first.version);

    try {
      service.saveLibrary("u", libraryWith(["C"]), first.version);
      assert.fail("should have conflicted");
    } catch (err) {
      assert.ok(err instanceof LibraryVersionConflictError);
      assert.equal(err.expectedVersion, first.version);
      assert.equal(err.currentVersion, first.version + 1);
    }
  });

  it("still allows an unconditional write when no version is quoted", () => {
    // The first-ever save has no version to quote, and "replace whatever
    // is there" stays expressible on purpose.
    const first = service.saveLibrary("u", libraryWith(["A"]));
    const forced = service.saveLibrary("u", libraryWith(["replaced"]));

    assert.equal(forced.version, first.version + 1);
    assert.equal((service.getLibrary("u")!.data as { books: unknown[] }).books.length, 1);
  });

  it("does not conflict on the very first save of a library", () => {
    // A client that has never read can quote nothing; a client that read a
    // 404 may quote 0. Neither should be a conflict.
    assert.doesNotThrow(() => service.saveLibrary("new-user", libraryWith(["A"]), 0));
  });

  it("keeps versions independent per user", () => {
    const alice = service.saveLibrary("alice", libraryWith(["A"]));
    service.saveLibrary("bob", libraryWith(["B"]));
    service.saveLibrary("bob", libraryWith(["B", "B2"]), 1);

    // Bob's activity must not invalidate Alice's version.
    assert.doesNotThrow(() => service.saveLibrary("alice", libraryWith(["A", "A2"]), alice.version));
  });
});

describe("per-entity block layout write", () => {
  let service: LibraryService;

  beforeEach(() => {
    service = freshService();
  });

  it("moves one block and bumps the version", () => {
    const saved = service.saveLibrary("u", muralDocument(0));
    const result = service.saveMuralBlockLayout("u", "m-1", "b-1", { x: 4, y: 5, w: 2, h: 2 }, saved.version);

    assert.equal(result.version, saved.version + 1);
    const data = service.getLibrary("u")!.data as { murals: Array<{ blocks: Array<{ layout: unknown }> }> };
    assert.deepEqual(data.murals[0]!.blocks[0]!.layout, { x: 4, y: 5, w: 2, h: 2 });
  });

  it("leaves the rest of the library alone", () => {
    service.saveLibrary("u", {
      ...muralDocument(0),
      books: [{ Title: "Untouched", Attribution: "A" }],
      name: "My Library"
    });
    service.saveMuralBlockLayout("u", "m-1", "b-1", { x: 7, y: 7, w: 1, h: 1 });

    const data = service.getLibrary("u")!.data as { books: Array<{ Title: string }>; name: string };
    assert.equal(data.books[0]!.Title, "Untouched");
    assert.equal(data.name, "My Library");
  });

  it("404s for a block that no longer exists rather than silently succeeding", () => {
    service.saveLibrary("u", muralDocument(0));
    assert.throws(
      () => service.saveMuralBlockLayout("u", "m-1", "gone", { x: 1, y: 1, w: 1, h: 1 }),
      LibraryEntityNotFoundError
    );
  });

  it("does not bump the version when nothing was updated", () => {
    const saved = service.saveLibrary("u", muralDocument(0));
    try {
      service.saveMuralBlockLayout("u", "m-1", "gone", { x: 1, y: 1, w: 1, h: 1 });
    } catch {
      // expected
    }
    assert.equal(service.getLibrary("u")!.version, saved.version);
  });

  it("refuses a stale layout write", () => {
    const first = service.saveLibrary("u", muralDocument(0));
    service.saveLibrary("u", muralDocument(1), first.version);

    assert.throws(
      () => service.saveMuralBlockLayout("u", "m-1", "b-1", { x: 9, y: 9, w: 1, h: 1 }, first.version),
      LibraryVersionConflictError
    );
  });

  it("will not move another user's block", () => {
    service.saveLibrary("alice", muralDocument(0));
    service.saveLibrary("bob", muralDocument(0));

    assert.throws(
      () => service.saveMuralBlockLayout("mallory", "m-1", "b-1", { x: 9, y: 9, w: 1, h: 1 }),
      LibraryEntityNotFoundError
    );

    const alice = service.getLibrary("alice")!.data as { murals: Array<{ blocks: Array<{ layout: { x: number } }> }> };
    assert.equal(alice.murals[0]!.blocks[0]!.layout.x, 0);
  });
});
