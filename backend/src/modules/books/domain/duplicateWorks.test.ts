import assert from "node:assert/strict";
import { test } from "node:test";
import { planCrowdedFolds, planDuplicateSets } from "./duplicateWorks.js";
import { workTitleKey } from "./normalize.js";

const KEY = workTitleKey("Fourth Wing", "Rebecca Yarros");

test("merges keyed works with the same full title into the one with the most editions", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 2, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-b", title: "Fourth WIng", author: "Rebecca Yarros", editions: 9, createdAt: "2026-09-02" }
  ]), [{ titleKey: KEY, into: "w-b", from: ["w-a"] }]);
});

test("keeps a graphic novel apart from the novel it shares a title key with", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-novel", title: "Fourth Wing", author: "Rebecca Yarros", editions: 5, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-gn", title: "Fourth Wing: The Graphic Novel", author: "Rebecca Yarros", editions: 1, createdAt: "2026-09-02" }
  ]), []);
});

test("breaks an editions tie by the oldest work, then the lowest id", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 3, createdAt: "2026-09-05" },
    { titleKey: KEY, id: "w-b", title: "Fourth Wing", author: "Rebecca Yarros", editions: 3, createdAt: "2026-09-01" }
  ]), [{ titleKey: KEY, into: "w-b", from: ["w-a"] }]);
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-c", title: "Fourth Wing", author: "Rebecca Yarros", editions: 3, createdAt: "2026-09-02" },
    { titleKey: KEY, id: "w-b", title: "Fourth Wing", author: "Rebecca Yarros", editions: 3, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 3, createdAt: "2026-09-01" }
  ]), [{ titleKey: KEY, into: "w-a", from: ["w-b", "w-c"] }]);
});

test("leaves out a work whose own title key differs from the shared edition key", () => {
  const works = [
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 2, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-b", title: "Fourth Wing", author: "Rebecca Yarros", editions: 1, createdAt: "2026-09-02" },
    { titleKey: KEY, id: "w-x", title: "Iron Flame", author: "Rebecca Yarros", editions: 9, createdAt: "2026-08-01" },
    { titleKey: KEY, id: "w-y", title: "Iron Flame", author: "Rebecca Yarros", editions: 8, createdAt: "2026-08-02" }
  ];
  assert.deepEqual(planDuplicateSets(works), [{ titleKey: KEY, into: "w-a", from: ["w-b"] }]);
});

test("never merges works with an empty or placeholder first author", () => {
  for (const author of ["Anónimo", "AA.VV.", "AAVV", "Diversos", ""]) {
    const titleKey = workTitleKey("Cantar de Mio Cid", author);
    assert.deepEqual(planDuplicateSets([
      { titleKey, id: "w-a", title: "Cantar de Mio Cid", author, editions: 2, createdAt: "2026-09-01" },
      { titleKey, id: "w-b", title: "Cantar de Mio Cid", author, editions: 1, createdAt: "2026-09-02" }
    ]), [], author);
  }
});

test("counts a work listed twice once", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 5, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 5, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-b", title: "Fourth Wing", author: "Rebecca Yarros", editions: 1, createdAt: "2026-09-02" }
  ]), [{ titleKey: KEY, into: "w-a", from: ["w-b"] }]);
  assert.deepEqual(planDuplicateSets([
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 5, createdAt: "2026-09-01" },
    { titleKey: KEY, id: "w-a", title: "Fourth Wing", author: "Rebecca Yarros", editions: 5, createdAt: "2026-09-01" }
  ]), []);
});

test("never merges works whose title key is empty", () => {
  assert.deepEqual(planDuplicateSets([
    { titleKey: "", id: "w-a", title: "!!!", author: "Jane Doe", editions: 2, createdAt: "2026-09-01" },
    { titleKey: "", id: "w-b", title: "???", author: "John Roe", editions: 1, createdAt: "2026-09-02" }
  ]), []);
});

const crowded = [
  { titleKey: KEY, workId: "w-novel", title: "Fourth Wing", keyed: true },
  { titleKey: KEY, workId: "w-gn", title: "Fourth Wing: The Graphic Novel", keyed: true },
  { titleKey: KEY, workId: "k-1", title: "Fourth wing", keyed: false },
  { titleKey: KEY, workId: "k-2", title: "Fourth Wing: The Graphic Novel", keyed: false }
];

test("folds a keyless work into the one keyed work with its full title", () => {
  assert.deepEqual(planCrowdedFolds(crowded), [
    { source: "k-1", target: "w-novel" },
    { source: "k-2", target: "w-gn" }
  ]);
});

test("leaves a keyless work alone when no keyed work, or several, have its full title", () => {
  assert.deepEqual(planCrowdedFolds([
    { titleKey: KEY, workId: "w-novel", title: "Fourth Wing", keyed: true },
    { titleKey: KEY, workId: "k-1", title: "Fourth Wing: The Graphic Novel", keyed: false }
  ]), []);
  assert.deepEqual(planCrowdedFolds([
    { titleKey: KEY, workId: "w-a", title: "Fourth Wing", keyed: true },
    { titleKey: KEY, workId: "w-b", title: "Fourth WIng", keyed: true },
    { titleKey: KEY, workId: "k-1", title: "Fourth Wing", keyed: false }
  ]), []);
});

test("folds only within the keyless work's own title key", () => {
  const other = workTitleKey("Iron Flame", "Rebecca Yarros");
  assert.deepEqual(planCrowdedFolds([
    { titleKey: other, workId: "w-flame", title: "Iron Flame", keyed: true },
    { titleKey: KEY, workId: "k-1", title: "Iron Flame", keyed: false }
  ]), []);
});

test("never folds works whose title key is empty", () => {
  assert.deepEqual(planCrowdedFolds([
    { titleKey: "", workId: "w-a", title: "!!!", keyed: true },
    { titleKey: "", workId: "k-1", title: "!!!", keyed: false }
  ]), []);
});
