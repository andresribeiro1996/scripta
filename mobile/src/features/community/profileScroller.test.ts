import assert from "node:assert/strict";
import { test } from "node:test";
import { dragX, rubberBand, swipeTarget, syncedOffset } from "./pinnedOffset";

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

test("syncedOffset follows the active page until the tab bar is pinned, then keeps its own scroll", () => {
  assert.equal(syncedOffset(100, 500, 300), 100);
  assert.equal(syncedOffset(400, 50, 300), 300);
  assert.equal(syncedOffset(400, 500, 300), 500);
});

test("dragX moves the pages opposite the finger and damps the drag past either end", () => {
  assert.equal(dragX(0, -100, 3, 320), 100);
  assert.equal(dragX(320, 100, 3, 320), 220);
  assert.equal(dragX(0, 90, 3, 320), -30);
  assert.equal(dragX(640, -90, 3, 320), 670);
});
