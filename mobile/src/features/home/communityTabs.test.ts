import assert from "node:assert/strict";
import { test } from "node:test";
import { communityTabOptions, defaultCommunityTab, parseCommunityTab, shouldMarkSeen } from "./communityTabs.js";

test("the tabs read Activity, Discover and People", () => {
  assert.deepEqual(communityTabOptions(0).map((tab) => tab.label), ["Activity", "Discover", "People"]);
});

test("Activity only carries a badge when there's something new", () => {
  assert.equal(communityTabOptions(0).find((tab) => tab.value === "activity")?.badge, undefined);
  assert.equal(communityTabOptions(3).find((tab) => tab.value === "activity")?.badge, 3);
  assert.equal(communityTabOptions(3).find((tab) => tab.value === "discover")?.badge, undefined);
});

test("an empty feed opens on Discover instead of a dead Activity tab", () => {
  assert.equal(defaultCommunityTab(0), "discover");
  assert.equal(defaultCommunityTab(1), "activity");
});

test("a tab param opens that tab, and anything else falls back to the default", () => {
  assert.equal(parseCommunityTab("activity"), "activity");
  assert.equal(parseCommunityTab("discover"), "discover");
  assert.equal(parseCommunityTab("people"), "people");
  assert.equal(parseCommunityTab("feed"), undefined);
  assert.equal(parseCommunityTab(undefined), undefined);
});

test("activity counts as seen only while its rows are on screen", () => {
  assert.equal(shouldMarkSeen("activity", 2), true);
  assert.equal(shouldMarkSeen("activity", 0), false);
  assert.equal(shouldMarkSeen("discover", 2), false);
  assert.equal(shouldMarkSeen("people", 2), false);
});
