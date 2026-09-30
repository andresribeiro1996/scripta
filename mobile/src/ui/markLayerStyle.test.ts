import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayerEntrance } from "@scripta/shared/themes";
import { layerStyle } from "./markLayerStyle";

test("no entrance stays at rest for any progress", () => {
  for (const progress of [0, 0.4, 1]) {
    assert.deepEqual(layerStyle(progress, null, false, 2), { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }] });
  }
});

test("fan at progress 0 offsets by from times unit and stays opaque", () => {
  assert.deepEqual(layerStyle(0, { from: [-4, -3], fade: false, delayMs: 80 }, false, 2), { opacity: 1, transform: [{ translateX: -8 }, { translateY: -6 }] });
});

test("register fades in while sliding into place", () => {
  const enter: LayerEntrance = { from: [8.6, 6.2], fade: true, delayMs: 100 };
  assert.deepEqual(layerStyle(0, enter, false, 1), { opacity: 0, transform: [{ translateX: 8.6 }, { translateY: 6.2 }] });
  assert.deepEqual(layerStyle(1, enter, false, 1), { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }] });
});

test("gild fades the mark in with no offset", () => {
  assert.deepEqual(layerStyle(0, null, true, 1), { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }] });
});
