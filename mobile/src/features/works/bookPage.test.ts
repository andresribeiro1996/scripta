/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookScreenModel } from "@scripta/shared";
import { otherEditionCovers, statusBadgeLabel } from "./bookPage.js";

type Feeling = NonNullable<BookScreenModel["feeling"]>;

test("statusBadgeLabel", () => {
  const opts = (sel: number | null) =>
    [1, 2, 3, 4, 5].map((r) => ({ rating: r, label: ["Not for me", "Fine", "Good", "Loved it", "All-time"][r - 1], selected: r === sel })) as Feeling["options"];
  assert.equal(statusBadgeLabel({ status: null, feeling: null }), null);
  assert.equal(statusBadgeLabel({ status: { label: "Reading", options: [] }, feeling: null }), "Reading");
  assert.equal(statusBadgeLabel({ status: { label: "Finished", options: [] }, feeling: { label: "How did it land?", options: opts(null) } }), "Finished");
  assert.equal(statusBadgeLabel({ status: { label: "Finished", options: [] }, feeling: { label: "All-time", options: opts(5) } }), "Finished · All-time");
});

test("otherEditionCovers skips missing, duplicate and current covers", () => {
  const ed = (bookId: string, coverUrl: string | null) => ({ bookId, title: "T", language: null, year: null, isbn: null, coverUrl, coverColor: null, pages: null, mine: false });
  assert.deepEqual(otherEditionCovers([ed("a", "u1"), ed("b", null), ed("c", "u2"), ed("d", "u1"), ed("e", "u3")], "u2"), ["u1", "u3"]);
  assert.deepEqual(otherEditionCovers([ed("a", "u1")], "u1"), []);
  assert.deepEqual(otherEditionCovers([], null), []);
});
