/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { libraryChangeRequest } from "./changeRequest.js";

test("a membership change posts to the group's books with the group id encoded", () => {
  assert.deepEqual(libraryChangeRequest({ kind: "membership", groupId: "a/b c", bookKey: "k1", member: true }), {
    path: "/library/groups/a%2Fb%20c/books",
    method: "POST",
    body: { bookKey: "k1", member: true },
  });
});

test("an add change posts the book", () => {
  const book = { title: "T" } as never;
  assert.deepEqual(libraryChangeRequest({ kind: "add", book }), { path: "/library/books/add", method: "POST", body: { book } });
});

test("a book change patches without its kind", () => {
  const request = libraryChangeRequest({ kind: "book", key: "k1", patch: { rating: 4 } } as never);
  assert.equal(request.path, "/library/books");
  assert.equal(request.method, "PATCH");
  assert.deepEqual(request.body, { key: "k1", patch: { rating: 4 } });
});
