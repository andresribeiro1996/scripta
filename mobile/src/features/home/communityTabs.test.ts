import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMUNITY_TABS, parseCommunityTab } from "./communityTabs.js";

test("the tabs read Discover and People", () => {
  assert.deepEqual(COMMUNITY_TABS.map((tab) => tab.label), ["Discover", "People"]);
});

test("a tab param opens that tab, and anything else opens People", () => {
  assert.equal(parseCommunityTab("discover"), "discover");
  assert.equal(parseCommunityTab("people"), "people");
  assert.equal(parseCommunityTab("activity"), "people");
  assert.equal(parseCommunityTab(undefined), "people");
});
