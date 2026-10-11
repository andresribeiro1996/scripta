/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { workPath } from "./workPath.js";

test("a work opened from inside the tabs stays in them; from a root-level screen it opens above it", () => {
  assert.equal(workPath("w1", ["(app)", "(arena)", "tierlist", "[id]"]), "/work/w1");
  assert.equal(workPath("w1", ["arena", "[id]"]), "/(public)/work/w1");
  assert.equal(workPath("w1", ["vote", "[code]"]), "/(public)/work/w1");
});
