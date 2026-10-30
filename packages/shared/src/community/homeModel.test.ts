import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldMarkFeedSeen } from "./homeModel.js";

test("the feed counts as seen only when focused, a row is on screen, the data is loaded and idle, and it wasn't sent yet", () => {
  const ready = { focused: true, rowVisible: true, loaded: true, failed: false, fetching: false, sent: false };
  assert.equal(shouldMarkFeedSeen(ready), true);
  assert.equal(shouldMarkFeedSeen({ ...ready, focused: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, rowVisible: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, loaded: false }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, failed: true }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, fetching: true }), false);
  assert.equal(shouldMarkFeedSeen({ ...ready, sent: true }), false);
});
