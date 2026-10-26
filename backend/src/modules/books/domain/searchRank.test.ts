import assert from "node:assert/strict";
import { test } from "node:test";
import { rankWorks, seriesOrder } from "./searchRank.js";

test("seriesOrder sorts decimal and Roman positions as numbers and puts unpositioned members last", () => {
  const members = ["2", "1", "III", null, "1.5"].map((position, index) => ({ workId: `w-${index}`, position }));
  assert.deepEqual(seriesOrder(members), ["w-1", "w-4", "w-0", "w-2", "w-3"]);
  assert.deepEqual(seriesOrder([{ workId: "none", position: null }, { workId: "four", position: "IV" }, { workId: "two", position: "ii" }]), ["two", "four", "none"]);
});

test("seriesOrder keeps unpositioned members in their stored order", () => {
  const members = [{ workId: "a", position: null }, { workId: "b", position: "Book" }, { workId: "c", position: "1" }, { workId: "d", position: null }];
  assert.deepEqual(seriesOrder(members), ["c", "a", "b", "d"]);
});

test("rankWorks puts a widely published work above a one-edition work with a slightly better text match", () => {
  const famous = { workId: "famous", textScore: 9.5, exactTitle: false, signals: { editions: 30, languages: 8, hasCover: true, wikipediaSites: null } };
  const obscure = { workId: "obscure", textScore: 10, exactTitle: false, signals: { editions: 1, languages: 1, hasCover: true, wikipediaSites: null } };
  assert.deepEqual(rankWorks([obscure, famous]), ["famous", "obscure"]);
});

test("rankWorks adds a bonus for a title that equals the query and keeps ties in their given order", () => {
  const signals = { editions: 1, languages: 1, hasCover: false, wikipediaSites: null };
  assert.deepEqual(rankWorks([{ workId: "near", textScore: 10.5, exactTitle: false, signals }, { workId: "exact", textScore: 10, exactTitle: true, signals }]), ["exact", "near"]);
  assert.deepEqual(rankWorks([{ workId: "first", textScore: 10, exactTitle: false, signals }, { workId: "second", textScore: 10, exactTitle: false, signals }]), ["first", "second"]);
});

test("rankWorks puts a work with Wikipedia articles above an otherwise equal work without", () => {
  const base = { editions: 3, languages: 2, hasCover: true };
  const plain = { workId: "plain", textScore: 10, exactTitle: false, signals: { ...base, wikipediaSites: null } };
  const known = { workId: "known", textScore: 10, exactTitle: false, signals: { ...base, wikipediaSites: 80 } };
  assert.deepEqual(rankWorks([plain, known]), ["known", "plain"]);
});
