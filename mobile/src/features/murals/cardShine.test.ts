import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("the shine reads the rotation sensor only when live and motion is allowed", () => {
  const shine = readFileSync("src/features/murals/CardShine.tsx", "utf8");
  assert.equal(shine.match(/useAnimatedSensor\(/g)?.length, 1);
  assert.match(shine, /live && !reduced \? <LiveShine/);
  assert.match(readFileSync("src/features/murals/ReaderCardViewer.tsx", "utf8"), /<ReaderCardTurner[^>]*liveShine/);
  assert.doesNotMatch(readFileSync("src/features/readerCard/ReaderCardEditorScreen.tsx", "utf8"), /liveShine/);
});
