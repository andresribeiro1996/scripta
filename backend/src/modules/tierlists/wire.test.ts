import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "tierlists-wire-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.TIERLISTS_DB_PATH = join(scratch, "tierlists.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { boardBooks, canonicalBoard, canonicalFirst, histogramToWorks, placementsFromWorks, placementsToWorks } = await import("./wire.js");
const { openBooksDb } = await import("../books/adapters/sqlite/connection.js");
const { resolveWorks } = await import("../books/index.js");

const work = (title: string) => resolveWorks([{ isbn: null, title, author: "Someone" }])[0]!;
const [old, kept, other] = [work("Wire Old"), work("Wire Kept"), work("Wire Other")];
openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(kept, old);

test("canonicalBoard canonicalizes ids, tiers before pool, first work wins", () => {
  const data = { tiers: [{ id: "s", label: "S", color: "#000000", workIds: [old] }], pool: [kept, other] };
  assert.deepEqual(canonicalBoard(data), { tiers: [{ id: "s", label: "S", color: "#000000", workIds: [kept] }], pool: [other] });
});

test("canonicalFirst keeps only the first stored id of each canonical work", () => {
  const { canonical, first } = canonicalFirst([old, other, kept]);
  assert.equal(canonical.get(old), kept);
  assert.deepEqual([...first].sort(), [old, other].sort());
});

test("histogram cells and placements keep only each work's first stored id and emit the canonical one", () => {
  const { canonical, first } = canonicalFirst([old, kept, other]);
  assert.deepEqual(histogramToWorks([{ workId: kept, tierId: "s", votes: 4 }, { workId: old, tierId: "s", votes: 2 }, { workId: other, tierId: "s", votes: 1 }], canonical, first), [{ workId: kept, tierId: "s", votes: 2 }, { workId: other, tierId: "s", votes: 1 }]);
  assert.deepEqual(placementsToWorks([{ workId: kept, tierId: "s" }, { workId: other, tierId: "a" }], canonical, first), [{ workId: other, tierId: "a" }]);
});

test("placementsFromWorks maps each canonical id to the stored id and refuses a work not on the board", () => {
  const storedByCanonical = new Map([[kept, old], [other, other]]);
  assert.deepEqual(placementsFromWorks([{ workId: kept, tierId: "s" }], [kept], storedByCanonical), [{ workId: old, tierId: "s" }]);
  assert.equal(placementsFromWorks([{ workId: "w9", tierId: "s" }], ["w9"], storedByCanonical), null);
});

test("boardBooks matches snapshot books by canonical work and falls back to live when one is missing", () => {
  const live = () => [{ title: "Live", author: "", isbn: null, imageId: null, coverUrl: null, readStatus: null, key: "kl", workId: null }];
  const snapshot = [{ title: "A", key: "ka", workId: old }, { title: "B", key: "kb", workId: other }];
  const canonicalSnapshot = [{ ...snapshot[0]!, workId: kept }, snapshot[1]!];
  assert.deepEqual(boardBooks([kept, other], snapshot, live), canonicalSnapshot);
  assert.deepEqual(boardBooks([other, kept], snapshot, live), [canonicalSnapshot[1], canonicalSnapshot[0]]);
  assert.deepEqual(boardBooks([kept, other], [snapshot[1]!], live), live());
  assert.deepEqual(boardBooks([kept], null, live), live());
});
