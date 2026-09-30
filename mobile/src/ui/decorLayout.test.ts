import assert from "node:assert/strict";
import { test } from "node:test";
import { decorLayerStyle, pieceStyle } from "./decorLayout";

const piece = (anchor: Parameters<typeof pieceStyle>[0]["anchor"], width: number | "full" = 40) => ({ anchor, width, height: 20, svg: "<svg/>" });

test("corner pieces keep their size and pin to their corner", () => {
  assert.deepEqual(pieceStyle(piece("top-left")), { position: "absolute", width: 40, height: 20, top: 0, left: 0 });
  assert.deepEqual(pieceStyle(piece("top-right")), { position: "absolute", width: 40, height: 20, top: 0, right: 0 });
  assert.deepEqual(pieceStyle(piece("bottom-left")), { position: "absolute", width: 40, height: 20, bottom: 0, left: 0 });
  assert.deepEqual(pieceStyle(piece("bottom-right")), { position: "absolute", width: 40, height: 20, bottom: 0, right: 0 });
});

test("edge pieces span the full width", () => {
  assert.deepEqual(pieceStyle(piece("top", "full")), { position: "absolute", height: 20, top: 0, left: 0, right: 0 });
  assert.deepEqual(pieceStyle(piece("bottom", "full")), { position: "absolute", height: 20, bottom: 0, left: 0, right: 0 });
});

test("the decor layer sits inside whichever safe-area padding the screen pays", () => {
  const insets = { top: 24, bottom: 16 };
  assert.deepEqual(decorLayerStyle(true, false, insets), { position: "absolute", left: 0, right: 0, top: 24, bottom: 0 });
  assert.deepEqual(decorLayerStyle(false, true, insets), { position: "absolute", left: 0, right: 0, top: 0, bottom: 16 });
  assert.deepEqual(decorLayerStyle(false, false, insets), { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 });
});
