import assert from "node:assert/strict";
import { test } from "node:test";
import { AFTER_FOLLOW, AFTER_SHELF_PUBLISH_FAILED, afterShelfPublish } from "./queryKeys.js";

test("afterShelfPublish only refreshes the own profile without a username", () => {
  assert.deepEqual(afterShelfPublish(null), [["community", "own-profile"]]);
  assert.deepEqual(afterShelfPublish(""), [["community", "own-profile"]]);
});

test("afterShelfPublish adds the profile and activity keys for a username", () => {
  assert.deepEqual(afterShelfPublish("ana"), [
    ["community", "own-profile"],
    ["community", "profile", "ana"],
    ["community", "activity", "ana"],
  ]);
});

test("AFTER_FOLLOW covers people and the dashboard prefix", () => {
  assert.deepEqual(AFTER_FOLLOW, [["community", "people"], ["community", "dashboard"]]);
});

test("AFTER_SHELF_PUBLISH_FAILED refreshes the own profile and murals", () => {
  assert.deepEqual(AFTER_SHELF_PUBLISH_FAILED, [["community", "own-profile"], ["murals"]]);
});
