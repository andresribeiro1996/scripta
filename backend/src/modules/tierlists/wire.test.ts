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

const { boardBooksToWorks, boardKeysInOrder, boardToWorks, histogramToWorks, placementsFromWorks, placementsToWorks } = await import("./wire.js");

const works = new Map([["k1", "w1"], ["k2", "w1"], ["k3", "w3"]]);
const data = { tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: ["k2"] }], pool: ["k1", "k3", "k-orphan"] };

test("boardToWorks swaps keys for works, tiers before pool, first edition wins, orphans left out", () => {
  assert.deepEqual(boardKeysInOrder(data), ["k2", "k1", "k3", "k-orphan"]);
  assert.deepEqual(boardToWorks(data, works), { tiers: [{ id: "s", label: "S", color: "#000000", workIds: ["w1"] }], pool: ["w3"] });
});

test("histogram cells and placements keep only each work's first key", () => {
  const first = new Set(["k2", "k3"]);
  assert.deepEqual(histogramToWorks([{ bookKey: "k1", tierId: "s", votes: 4 }, { bookKey: "k2", tierId: "s", votes: 2 }, { bookKey: "k3", tierId: "s", votes: 1 }], works, first), [{ workId: "w1", tierId: "s", votes: 2 }, { workId: "w3", tierId: "s", votes: 1 }]);
  assert.deepEqual(placementsToWorks([{ bookKey: "k1", tierId: "s" }, { bookKey: "k3", tierId: "a" }], works, first), [{ workId: "w3", tierId: "a" }]);
});

test("placementsFromWorks maps each work to its board key and refuses a work not on the board", () => {
  const keyByWork = new Map([["w1", "k2"], ["w3", "k3"]]);
  assert.deepEqual(placementsFromWorks([{ workId: "w1-old", tierId: "s" }], ["w1"], keyByWork), [{ bookKey: "k2", tierId: "s" }]);
  assert.equal(placementsFromWorks([{ workId: "w9", tierId: "s" }], ["w9"], keyByWork), null);
});

test("a frozen snapshot is zipped with the pool when the lengths match, else books come live", () => {
  const live = () => [{ title: "Live", key: "k1", workId: "w1" }];
  assert.deepEqual(boardBooksToWorks(["k1", "k3"], [{ title: "A" }, { title: "B" }], works, live), [{ title: "A", key: "k1", workId: "w1" }, { title: "B", key: "k3", workId: "w3" }]);
  assert.deepEqual(boardBooksToWorks(["k1", "k3"], [{ title: "A" }], works, live), live());
  assert.deepEqual(boardBooksToWorks(["k1"], null, works, live), live());
});
