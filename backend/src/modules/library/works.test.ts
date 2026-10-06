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
const { canonicalByKey, canonicalWorkIds, createCopyKeysResolver, createEntryWorksResolver, duplicateWorkMessage, firstKeyPerWork, knownWorkIds, resolveTitleWorks, UnknownWorkError, workIdsByKey, WorkResolutionError } = await import("./works.js");

function harness(resolve: (lookups: Array<{ isbn?: string | null; title?: string | null }>) => Array<string | null> = (lookups) => lookups.map((lookup) => `w-${lookup.title ?? lookup.isbn}`), canonical: Record<string, string> = {}) {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const insert = db.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, row_hash, work_id) VALUES ('u1', ?, ?, ?, ?, ?, 'h', ?)");
  const lookups: unknown[] = [];
  const resolver = createEntryWorksResolver({
    db,
    resolveWorks: (batch) => { lookups.push(...batch); return resolve(batch); },
    canonicalWorks: (ids) => new Map(ids.flatMap((id) => (id in canonical ? [[id, canonical[id]!] as [string, string]] : [])))
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

const catalog = (known: Record<string, string>) => (ids: string[]) => new Map(ids.flatMap((id) => (id in known ? [[id, known[id]!] as [string, string]] : [])));

test("knownWorkIds canonicalises in order and refuses an unknown id", () => {
  const canonical = catalog({ "w-old": "w-new", "w-2": "w-2" });
  assert.deepEqual(knownWorkIds(["w-2", "w-old"], canonical), ["w-2", "w-new"]);
  assert.throws(() => knownWorkIds(["w-2", "w-gone"], canonical), UnknownWorkError);
  assert.throws(() => knownWorkIds(["w-2"], () => { throw new Error("down"); }), WorkResolutionError);
});

test("canonicalByKey maps keys through merges and leaves NULL works out", () => {
  const stored = new Map<string, string | null>([["k1", "w-old"], ["k2", null], ["k3", "w-3"]]);
  assert.deepEqual(canonicalByKey(stored, catalog({ "w-old": "w-new", "w-3": "w-3" })), new Map([["k1", "w-new"], ["k3", "w-3"]]));
});

test("firstKeyPerWork keeps the first key of each work in the given order", () => {
  assert.deepEqual(firstKeyPerWork(["k2", "k1", "k3"], new Map([["k1", "w1"], ["k2", "w1"], ["k3", "w3"]])), new Map([["w1", "k2"], ["w3", "k3"]]));
});

test("copy keys pick the owner's first copy of each work by position, through merges", () => {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const row = db.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, row_hash, work_id) VALUES (?, ?, ?, 'T', 'A', NULL, 'h', ?)");
  row.run("u1", 0, "isbn:9780441013593", "w-pt");
  row.run("u1", 1, "isbn:9780441172719", "w-dune");
  row.run("u1", 2, "ta:orlando|virginia woolf", "w-orlando");
  row.run("u2", 0, "ta:other|x", "w-dune");
  const copies = createCopyKeysResolver({ db, canonicalWorks: catalog({ "w-pt": "w-dune", "w-dune": "w-dune", "w-orlando": "w-orlando" }) });
  assert.deepEqual(copies("u1", ["w-dune", "w-none"]), new Map([["w-dune", "isbn:9780441013593"]]));
  assert.deepEqual(copies("u1", []), new Map());
});

test("a key that is itself a catalog work resolves to that work", () => {
  const db = new DatabaseSync(":memory:");
  applyLibrarySchema(db);
  const resolver = createEntryWorksResolver({ db, resolveWorks: () => { throw new Error("no lookups expected"); }, canonicalWorks: catalog({ "w-solo": "w-solo-canonical" }) });
  const works = resolver("u1", [{ key: "w-solo" }, { key: "isbn:gone" }]);
  assert.equal(works.get("w-solo")?.workId, "w-solo-canonical");
  assert.equal(works.get("isbn:gone")?.workId, null);
});

test("resolveTitleWorks looks books up by title and author and wraps catalog errors", () => {
  const seen: unknown[] = [];
  assert.deepEqual(resolveTitleWorks([{ title: "1984", author: "George Orwell" }], (lookups) => { seen.push(...lookups); return ["w-1984"]; }), ["w-1984"]);
  assert.deepEqual(seen, [{ isbn: null, title: "1984", author: "George Orwell" }]);
  assert.deepEqual(resolveTitleWorks([], () => { throw new Error("not called"); }), []);
  assert.throws(() => resolveTitleWorks([{ title: "1984", author: "" }], () => { throw new Error("down"); }), WorkResolutionError);
});
