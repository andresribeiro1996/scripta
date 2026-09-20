import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultHomeTab, homeTabOptions } from "./homeTabs.js";

test("Activity only carries a badge when there's something new", () => {
  assert.equal(homeTabOptions(0).find((tab) => tab.value === "activity")?.badge, undefined);
  assert.equal(homeTabOptions(3).find((tab) => tab.value === "activity")?.badge, 3);
  assert.equal(homeTabOptions(3).find((tab) => tab.value === "discover")?.badge, undefined);
});

test("an empty feed opens on Discover instead of a dead Activity tab", () => {
  assert.equal(defaultHomeTab(0), "discover");
  assert.equal(defaultHomeTab(1), "activity");
});
