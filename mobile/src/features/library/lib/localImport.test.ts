/// <reference types="node" />

// Characterization test for the on-device library.json validation — same
// convention as core/apiClient.test.ts (node:test + node:assert, no extra
// test framework dependency). localImport.ts is deliberately RN-free (see
// its own top comment) so this runs under plain `tsx --test`, no Metro
// needed.
// NOTE (handoff): mobile/package.json has no "test" script yet (root
// `npm test --workspaces --if-present` silently skips this workspace) —
// pre-existing gap, not introduced by this task; see this task's handoff
// notes. Runnable manually via `npx tsx --test src/features/library/lib/
// localImport.test.ts` from mobile/.

import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidLibraryJsonError, parseLibraryJson } from "./localImport.js";

test("parses a well-formed library.json", () => {
  const data = parseLibraryJson(JSON.stringify({ books: [{ Title: "Dune" }], book_count: 1 }));
  assert.equal(data.books.length, 1);
  assert.equal(data.books[0].Title, "Dune");
});

test("rejects invalid JSON", () => {
  assert.throws(() => parseLibraryJson("{not json"), InvalidLibraryJsonError);
});

test("rejects JSON with no books array", () => {
  assert.throws(() => parseLibraryJson(JSON.stringify({ foo: "bar" })), InvalidLibraryJsonError);
});

test("rejects a bare JSON array (not the exporter's object shape)", () => {
  assert.throws(() => parseLibraryJson(JSON.stringify([{ Title: "Dune" }])), InvalidLibraryJsonError);
});
