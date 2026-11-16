import assert from "node:assert/strict";
import { test } from "node:test";
import { shareImageReady } from "./shareImageReady";

test("shareImageReady is true with nothing to load, and waits for every expected cover", () => {
  assert.equal(shareImageReady(true, [], new Set()), true);
  assert.equal(shareImageReady(true, ["a", "b"], new Set(["a"])), false);
  assert.equal(shareImageReady(true, ["a", "b"], new Set(["a", "b"])), true);
  assert.equal(shareImageReady(false, [], new Set()), false);
});
