import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { sharedDistIsStale } from "./devFixtureSetup.mjs";

function withShared(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "scripta-devFixtureSetup-"));
  try {
    for (const [path, seconds] of Object.entries(files)) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, "");
      utimesSync(full, seconds, seconds);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a missing dist is stale", () => {
  withShared({ "src/index.ts": 100 }, (dir) => assert.equal(sharedDistIsStale(dir), true));
});

test("a dist newer than every source file is fresh", () => {
  withShared({ "src/index.ts": 100, "src/library/sort.ts": 150, "dist/index.js": 200 }, (dir) => assert.equal(sharedDistIsStale(dir), false));
});

test("a source file newer than the dist, however deep, makes it stale", () => {
  withShared({ "src/index.ts": 100, "src/library/text/brackets.ts": 300, "dist/index.js": 200 }, (dir) => assert.equal(sharedDistIsStale(dir), true));
});

test("a newer test file does not make the dist stale", () => {
  withShared({ "src/index.ts": 100, "src/library/sort.test.ts": 300, "dist/index.js": 200 }, (dir) => assert.equal(sharedDistIsStale(dir), false));
});
