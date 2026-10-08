import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("the shine reads the tilt sensor only when live and motion is allowed", () => {
  const shine = readFileSync("src/features/murals/CardShine.tsx", "utf8");
  assert.equal(shine.match(/useAnimatedSensor\(/g)?.length, 1);
  assert.match(shine, /live && !reduced \? <LiveShine/);
  assert.match(readFileSync("src/features/murals/ReaderCardViewer.tsx", "utf8"), /<ReaderCardTurner[^>]*liveShine/);
  assert.doesNotMatch(readFileSync("src/features/readerCard/ReaderCardEditorScreen.tsx", "utf8"), /liveShine/);
});

test("the editor options defer the first thumbnail mount", () => {
  assert.match(readFileSync("src/features/readerCard/ReaderCardOptions.tsx", "utf8"), /useDeferredValue\(input, null\)/);
});

test("the motto and corner tile rows size their placeholders from their section crop", () => {
  const options = readFileSync("src/features/readerCard/ReaderCardOptions.tsx", "utf8");
  assert.match(options, /<TileRow crop="motto" items=\{mottoThumbs\}/);
  assert.match(options, /<TileRow crop="corner" items=\{cornerThumbs\}/);
});
