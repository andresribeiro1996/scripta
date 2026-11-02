import assert from "node:assert/strict";
import { test } from "node:test";
import { pinnedOffset } from "./pinnedOffset";

test("pinnedOffset keeps the tab bar pinned when switching tabs", () => {
  assert.equal(pinnedOffset(500, 320), 320);
  assert.equal(pinnedOffset(320, 320), null);
  assert.equal(pinnedOffset(100, 320), null);
});
