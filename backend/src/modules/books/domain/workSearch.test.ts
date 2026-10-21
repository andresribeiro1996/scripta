import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookRow } from "./types.js";
import { coveredFirst, firstEditionPerWork } from "./workSearch.js";

function book(id: string, title: string, workId: string | null, cover: { image?: string; ol?: number } = {}): BookRow {
  return { id, title, work_id: workId, cover_image_id: cover.image ?? null, ol_cover_id: cover.ol ?? null } as BookRow;
}

const shown = (rows: BookRow[]) => firstEditionPerWork(rows, new Map()).map(({ row }) => row.id);

test("shows the work's covered edition when the best match has no cover and the same full title", () => {
  const rows = [book("b-bare", "Fourth wing", "w-1"), book("b-cover", "Fourth WIng", "w-1", { image: "img-1" })];
  assert.deepEqual(shown(rows), ["b-cover"]);
});

test("keeps the best match when the covered edition has another full title", () => {
  const portuguese = [book("b-pt", "Asa de Ferro", "w-1"), book("b-en", "Iron Flame", "w-1", { image: "img-1" })];
  assert.deepEqual(shown(portuguese), ["b-pt"]);
  const graphic = [book("b-novel", "Fourth Wing", "w-1"), book("b-gn", "Fourth Wing: The Graphic Novel", "w-1", { image: "img-1" })];
  assert.deepEqual(shown(graphic), ["b-novel"]);
});

test("keeps works in the order of their best match", () => {
  const rows = [
    book("a-bare", "Fourth Wing", "w-a"),
    book("b-bare", "Iron Flame", "w-b"),
    book("a-cover", "Fourth Wing", "w-a", { image: "img-a" }),
    book("c-bare", "Onyx Storm", "w-c")
  ];
  assert.deepEqual(shown(rows), ["a-cover", "b-bare", "c-bare"]);
});

test("treats an Open Library cover id as a cover", () => {
  const rows = [book("b-bare", "Fourth Wing", "w-1"), book("b-ol", "Fourth Wing", "w-1", { ol: 77 })];
  assert.deepEqual(shown(rows), ["b-ol"]);
});

test("follows the canonical work when grouping editions", () => {
  const rows = [book("b-bare", "Fourth Wing", "w-old"), book("b-cover", "Fourth Wing", "w-new", { image: "img-1" })];
  const hits = firstEditionPerWork(rows, new Map([["w-old", "w-new"]]));
  assert.deepEqual(hits.map(({ row, workId }) => [row.id, workId]), [["b-cover", "w-new"]]);
});

test("coveredFirst keeps every item and only swaps within a work", () => {
  const items = [
    book("a-bare", "Dune", "w-a"),
    book("n-bare", "Dune", null),
    book("b-bare", "Dune", "w-b"),
    book("n-cover", "Dune", null, { image: "img-n" }),
    book("a-cover", "Dune", "w-a", { image: "img-a" })
  ];
  const ordered = coveredFirst(items, (item) => item.work_id, (item) => item.cover_image_id !== null, (item) => item.title);
  assert.deepEqual(ordered.map((item) => item.id), ["a-cover", "n-bare", "b-bare", "n-cover", "a-bare"]);
  assert.deepEqual(items.map((item) => item.id), ["a-bare", "n-bare", "b-bare", "n-cover", "a-cover"]);
});

test("keeps a covered best match when a later edition of the work is covered too", () => {
  const rows = [book("b-first", "Dune", "w-1", { image: "img-1" }), book("b-second", "Dune", "w-1", { image: "img-2" })];
  assert.deepEqual(shown(rows), ["b-first"]);
});
