/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SeedBook } from "@scripta/shared";
import { seedFormUnsaved, slotsAfterServerLoad, slotsUnsaved } from "./seedDraft.js";

const book = (title: string) => ({ workId: title, title }) as unknown as SeedBook;
const loaded = [book("a"), null];

test("server data replaces slots that match the last saved state", () => {
  assert.equal(slotsAfterServerLoad([book("a"), null], [book("a"), null], loaded), loaded);
  assert.equal(slotsAfterServerLoad([null, null], null, loaded), loaded);
});

test("server data never overwrites unsaved slot edits", () => {
  const local = [book("a"), book("b")];
  assert.equal(slotsAfterServerLoad(local, [book("a"), null], loaded), local);
  assert.equal(slotsAfterServerLoad([null, book("b")], null, loaded).length, 2);
  assert.equal(slotsUnsaved([null, book("b")], null), true);
});

test("form fields are unsaved only when they differ from the initial values", () => {
  const initial = { name: "", size: 16, duration: "" };
  assert.equal(seedFormUnsaved(initial, initial), false);
  assert.equal(seedFormUnsaved({ ...initial, size: 8 }, initial), true);
  assert.equal(seedFormUnsaved({ ...initial, duration: "2" }, initial), true);
  assert.equal(seedFormUnsaved({ ...initial, name: "x" }, initial), true);
});
