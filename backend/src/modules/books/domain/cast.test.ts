import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCast } from "./cast.js";
import type { CastRows } from "./types.js";

const cover = (imageId: string) => `cover:${imageId}`;
const work = { id: "w1", title: "Philosopher's Stone", coverImageId: "img" };
const series = { name: "Harry Potter", nameKey: "harry potter" };

test("members that spell a character differently give one character, spelled by the lowest position", () => {
  const rows: CastRows = {
    work,
    series,
    members: [
      { id: "w2", position: "2", people: ["Potter, Harry", "Ron Weasley"] },
      { id: "w1", position: "1", people: ["Harry Potter", "Hermione Granger"] }
    ]
  };
  const cast = buildCast(rows, cover);
  const harry = cast.characters.find((character) => character.id === "ch:s:harry potter|harry potter");
  assert.deepEqual(harry, { id: "ch:s:harry potter|harry potter", name: "Harry Potter", works: 2 });
  assert.equal(cast.characters.filter((character) => character.name.includes("Harry")).length, 1);
});

test("order is works, then the best index, then the name", () => {
  const rows: CastRows = {
    work,
    series,
    members: [
      { id: "a", position: "1", people: ["Zed One", "Cy Two", "Ann Three", "Bo Four"] },
      { id: "b", position: "2", people: ["Bo Four", "Ann Three"] }
    ]
  };
  assert.deepEqual(buildCast(rows, cover).characters.map((character) => character.name), ["Bo Four", "Ann Three", "Zed One", "Cy Two"]);
  const tied: CastRows = { work, series: null, members: [{ id: "w1", position: null, people: ["Mia Zed", "Abe Quill", "Dan Poe", "Eve Lamb"] }] };
  assert.deepEqual(buildCast(tied, cover).characters.map((character) => character.name), ["Mia Zed", "Abe Quill", "Dan Poe", "Eve Lamb"]);
});

test("positions compare numerically, nulls last, ties by id", () => {
  const rows: CastRows = {
    work,
    series,
    members: [
      { id: "z", position: null, people: ["Pat Null"] },
      { id: "b", position: "10", people: ["Pat Null", "Sam Ten"] },
      { id: "a", position: "9", people: ["Pat Null"] }
    ]
  };
  assert.equal(buildCast(rows, cover).characters.find((character) => character.name === "Sam Ten")?.works, 1);
  const spelled: CastRows = { work, series, members: [{ id: "b", position: "10", people: ["Ten, Pat"] }, { id: "a", position: "9", people: ["Pat Nine"] }] };
  assert.equal(buildCast(spelled, cover).characters[0]!.name, "Pat Nine");
});

test("a series scope is labeled by the series, a lone work by its title, and unkeyable names are skipped", () => {
  const seriesCast = buildCast({ work, series, members: [{ id: "w1", position: "1", people: ["Harry Potter", "!!!"] }, { id: "w2", position: "2", people: [] }] }, cover);
  assert.deepEqual(seriesCast.scope, { kind: "series", key: "harry potter", label: "Harry Potter", coverUrl: "cover:img", workCount: 2 });
  assert.equal(seriesCast.characters.length, 1);
  const single = buildCast({ work: { ...work, coverImageId: null }, series: null, members: [{ id: "w1", position: null, people: ["Ann Lee"] }] }, cover);
  assert.deepEqual(single.scope, { kind: "work", key: "w1", label: "Philosopher's Stone", coverUrl: null, workCount: 1 });
  assert.equal(single.characters[0]!.id, "ch:w:w1|ann lee");
});

test("roman series positions order by value", () => {
  const rows: CastRows = {
    work,
    series,
    members: [{ id: "a", position: "IX", people: ["Nine, Pat"] }, { id: "b", position: "V", people: ["Pat Nine"] }]
  };
  assert.equal(buildCast(rows, cover).characters[0]!.name, "Pat Nine");
});
