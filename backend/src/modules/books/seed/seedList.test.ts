import assert from "node:assert/strict";
import { test } from "node:test";
import type { SeedEntry } from "./rankedWorks.js";
import { mergeSeedLists } from "./seedList.js";

const entry = (isbn: string, lang: "eng" | "por"): SeedEntry => ({ isbn, title: isbn, author: "A", lang, workKey: `/works/${isbn}`, readers: 1, subjects: [] });

test("dedupes by ISBN, Portuguese first", () => {
  const merged = mergeSeedLists([entry("1", "por"), entry("2", "por")], [entry("2", "eng"), entry("3", "eng")], { por: 5, eng: 5 });
  assert.deepEqual(merged.map((e) => `${e.lang}:${e.isbn}`), ["por:1", "por:2", "eng:3"]);
});

test("caps each language at its count, counting only unique entries", () => {
  const merged = mergeSeedLists([entry("1", "por"), entry("1", "por"), entry("2", "por"), entry("3", "por")], [entry("4", "eng"), entry("5", "eng")], { por: 2, eng: 1 });
  assert.deepEqual(merged.map((e) => e.isbn), ["1", "2", "4"]);
});
