import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("every mark animation defers to the system reduce-motion setting", () => {
  const source = readFileSync("src/ui/BrandMark.tsx", "utf8");
  const timings = source.match(/withTiming\(/g)?.length ?? 0;
  assert.ok(timings > 0);
  assert.equal(source.match(/reduceMotion: ReduceMotion\.System/g)?.length ?? 0, timings);
});
