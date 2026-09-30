import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestionReason } from "./helpers.js";

test("suggestionReason counts the shared books, singular or plural", () => {
  assert.equal(suggestionReason({ sharedCount: 6 }), "You share 6 books");
  assert.equal(suggestionReason({ sharedCount: 1 }), "You share 1 book");
});

test("suggestionReason says Recently active when no books are shared", () => {
  assert.equal(suggestionReason({ sharedCount: 0 }), "Recently active");
});
