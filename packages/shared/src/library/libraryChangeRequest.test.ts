import assert from "node:assert/strict";
import { test } from "node:test";
import { libraryChangeRequest } from "./libraryChangeRequest.js";

const wire = (body: unknown) => JSON.parse(JSON.stringify(body));

test("a membership change posts to the group's books with the group id encoded", () => {
  assert.deepEqual(libraryChangeRequest({ kind: "membership", groupId: "a/b c", bookKey: "k1", member: true }), {
    method: "POST",
    path: "/library/groups/a%2Fb%20c/books",
    body: { bookKey: "k1", member: true },
  });
});

test("an add change posts the book", () => {
  const book = { Title: "T" };
  assert.deepEqual(libraryChangeRequest({ kind: "add", book }), { method: "POST", path: "/library/books/add", body: { book } });
});

test("a finish change patches the status, rating and day", () => {
  const request = libraryChangeRequest({ kind: "book", bookKey: "k1", readStatus: 2, rating: 4, day: "2026-10-01" });
  assert.equal(request.method, "PATCH");
  assert.equal(request.path, "/library/books");
  assert.deepEqual(wire(request.body), { bookKey: "k1", readStatus: 2, rating: 4, day: "2026-10-01" });
});

test("a status change to unread or reading sends no day", () => {
  const request = libraryChangeRequest({ kind: "book", bookKey: "k1", readStatus: 1, day: "2026-10-01" });
  assert.deepEqual(wire(request.body), { bookKey: "k1", readStatus: 1 });
});

test("a rating-only change sends just the rating", () => {
  assert.deepEqual(wire(libraryChangeRequest({ kind: "book", bookKey: "k1", rating: 3 }).body), { bookKey: "k1", rating: 3 });
});
