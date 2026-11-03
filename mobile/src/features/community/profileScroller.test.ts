import assert from "node:assert/strict";
import { test } from "node:test";
import { pinnedOffset, rubberBand, swipeTarget } from "./pinnedOffset";

test("pinnedOffset keeps the tab bar pinned when switching tabs", () => {
  assert.equal(pinnedOffset(500, 320), 320);
  assert.equal(pinnedOffset(320, 320), null);
  assert.equal(pinnedOffset(100, 320), null);
});

test("swipeTarget moves to the neighbouring tab for a far or fast enough swipe", () => {
  const tabs = ["shelf", "activity", "daily"];
  assert.equal(swipeTarget(tabs, "shelf", -80, 0), "activity");
  assert.equal(swipeTarget(tabs, "activity", 80, 0), "shelf");
  assert.equal(swipeTarget(tabs, "daily", -80, 0), null);
  assert.equal(swipeTarget(tabs, "shelf", -30, -700), "activity");
  assert.equal(swipeTarget(tabs, "shelf", -30, 0), null);
  assert.equal(swipeTarget(tabs, "shelf", 80, 0), null);
  assert.equal(swipeTarget(tabs, "other", -80, 0), null);
});

test("rubberBand damps the drag only where there is no neighbouring tab", () => {
  assert.equal(rubberBand(90, false), 90);
  assert.equal(rubberBand(90, true), 30);
});
