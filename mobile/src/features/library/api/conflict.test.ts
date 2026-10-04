/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibrarySaver, type LibraryDocument } from "@scripta/shared";
import { LibraryConflictError } from "./conflict.js";

test("a conflict carries the 409 status the saver looks for", () => {
  assert.equal(new LibraryConflictError().status, 409);
});

test("the saver replays a whole save once after the conflict error", async () => {
  const doc = (updatedAt: string): LibraryDocument => ({ data: { books: [] }, updatedAt, shareToken: null, shareUrl: null });
  const puts: Array<string | undefined> = [];
  const saver = createLibrarySaver({
    send: async () => ({ updatedAt: "", baseUpdatedAt: null }),
    put: async (_data, expected) => {
      puts.push(expected);
      if (expected === "1") throw new LibraryConflictError();
      return doc("3");
    },
    fetch: async () => doc("2"),
    write: () => {},
  });
  saver.receive(doc("1"));
  const saved = await saver.saveWhole((data) => ({ ...data, name: "x" }));
  assert.equal(saved.updatedAt, "3");
  assert.deepEqual(puts, ["1", "2"]);
  saver.dispose();
});
