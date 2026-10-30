import assert from "node:assert/strict";
import { test } from "node:test";
import { setBookCoverUrl } from "./bookCovers.js";

test("a catalog cover URL replaces a gallery cover and drops its image id", () => {
  assert.deepEqual(setBookCoverUrl({ Title: "A", _coverImageId: "g1", _coverUrl: "https://g/1" }, "https://c/2"), {
    Title: "A",
    _coverUrl: "https://c/2"
  });
});
