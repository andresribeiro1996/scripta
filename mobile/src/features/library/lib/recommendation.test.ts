import assert from "node:assert/strict";
import { test } from "node:test";
import { toRecommendation } from "./recommendation.js";

test("toRecommendation maps and defaults isbn/cover", () => {
  assert.deepEqual(
    toRecommendation({ title: "Dune", author: "Frank Herbert", isbn: "9780441172719", coverUrl: "https://x/c.jpg" }, 2),
    { title: "Dune", author: "Frank Herbert", isbn: "9780441172719", coverUrl: "https://x/c.jpg", readStatus: 2 }
  );
  assert.deepEqual(
    toRecommendation({ title: "Dune", author: "Frank Herbert" }, 0),
    { title: "Dune", author: "Frank Herbert", isbn: null, coverUrl: null, readStatus: 0 }
  );
});
