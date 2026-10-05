import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "library-works-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.FILES_STORAGE_PATH = join(scratch, "files");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyLibrarySchema } = await import("./adapters/sqlite/connection.js");
const { canonicalWorkIds, createEntryWorksResolver, duplicateWorkMessage, firstDuplicateWork, keepFirstPerWork, workIdsByKey, WorkResolutionError } = await import("./works.js");

function harness(resolve: (lookups: Array<{ isbn?: string | null; title?: string | null }>) => Array<string | null> = (lookups) => lookups.map((lookup) => `w-${lookup.title ?? lookup.isbn}`), canonical: Record<string, string> = {}) {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const insert = db.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, row_hash, work_id) VALUES ('u1', ?, ?, ?, ?, ?, 'h', ?)");
  const lookups: unknown[] = [];
  const resolver = createEntryWorksResolver({
    db,
    resolveWorks: (batch) => { lookups.push(...batch); return resolve(batch); },
    canonicalWorks: (ids) => new Map(ids.map((id) => [id, canonical[id] ?? id]))
  });
  return { insert, resolver, lookups };
}

test("a key in the owner's library uses its stored work, canonicalised", () => {
  const { insert, resolver, lookups } = harness(undefined, { "w-old": "w-new" });
  insert.run(0, "isbn:9780441013593", "Dune", "Frank Herbert", "9780441013593", "w-old");
  assert.deepEqual(resolver("u1", [{ key: "isbn:9780441013593" }]).get("isbn:9780441013593"), { workId: "w-new", title: "Dune" });
  assert.deepEqual(lookups, []);
});

test("a library row with no work yet resolves from the row", () => {
  const { insert, resolver } = harness();
  insert.run(0, "ta:dune|frank herbert", "Dune", "Frank Herbert", null, null);
  assert.equal(resolver("u1", [{ key: "ta:dune|frank herbert" }]).get("ta:dune|frank herbert")?.workId, "w-Dune");
});

test("a key outside the library resolves from the entry's snapshot", () => {
  const { resolver } = harness();
  assert.deepEqual(resolver("u1", [{ key: "pool-1984", title: "1984", author: "George Orwell" }]).get("pool-1984"), { workId: "w-1984", title: "1984" });
});

test("another user's library row is not used", () => {
  const { insert, resolver } = harness();
  insert.run(0, "isbn:1", "Dune", "Frank Herbert", "1", "w-dune");
  assert.deepEqual(resolver("u2", [{ key: "isbn:1" }]).get("isbn:1"), { workId: null, title: null });
});

test("an empty key and an orphaned key get no work", () => {
  const { resolver } = harness();
  const works = resolver("u1", [{ key: "" }, { key: "ta:gone|nobody" }]);
  assert.equal(works.has(""), false);
  assert.deepEqual(works.get("ta:gone|nobody"), { workId: null, title: null });
});

test("a catalog failure becomes WorkResolutionError", () => {
  const { resolver } = harness(() => { throw new Error("locked"); });
  assert.throws(() => resolver("u1", [{ key: "x", title: "X" }]), WorkResolutionError);
});

test("firstDuplicateWork and keepFirstPerWork compare works, not keys", () => {
  const works = new Map([["a", { workId: "w1", title: "A" }], ["b", { workId: "w1", title: "B" }], ["c", { workId: null, title: null }], ["d", { workId: null, title: null }]]);
  assert.deepEqual(firstDuplicateWork(["a", "c", "d", "b"], works), { workId: "w1", title: "B" });
  assert.deepEqual(keepFirstPerWork(["a", "b", "c", "d"], (key) => key, works), ["a", "c", "d"]);
});

test("workIdsByKey skips empty keys and duplicateWorkMessage names the book", () => {
  const works = new Map([["a", { workId: "w1", title: "A" }]]);
  assert.deepEqual([...workIdsByKey(["a", "", "z"], works)], [["a", "w1"], ["z", null]]);
  assert.equal(duplicateWorkMessage({ workId: "w1", title: "Dune" }), "Dune is already here as another edition.");
  assert.equal(duplicateWorkMessage({ workId: "w1", title: null }), "That book is already here as another edition.");
});

test("canonicalWorkIds dedupes, skips the catalog for no ids, and wraps catalog errors", () => {
  const calls: string[][] = [];
  const canonical = (ids: string[]) => {
    calls.push(ids);
    return new Map(ids.map((id) => [id, id === "w-old" ? "w-new" : id]));
  };
  assert.deepEqual(canonicalWorkIds([], canonical), new Map());
  assert.deepEqual(calls, []);
  assert.deepEqual(canonicalWorkIds(["w-old", "w-old", "w-2"], canonical), new Map([["w-old", "w-new"], ["w-2", "w-2"]]));
  assert.deepEqual(calls, [["w-old", "w-2"]]);
  assert.throws(() => canonicalWorkIds(["w-1"], () => { throw new Error("down"); }), WorkResolutionError);
});
