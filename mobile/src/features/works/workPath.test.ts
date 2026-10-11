/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { bookToolPath, workPath, workStatsPath } from "./workPath.js";

test("a work opened from inside the tabs stays in them; from a root-level screen it opens above it", () => {
  assert.equal(workPath("w1", ["(app)", "(arena)", "tierlist", "[id]"]), "/work/w1");
  assert.equal(workPath("w1", ["arena", "[id]"]), "/(public)/work/w1");
  assert.equal(workPath("w1", ["vote", "[code]"]), "/(public)/work/w1");
});

test("book tools open over the book screen in whichever stack it sits", () => {
  assert.equal(bookToolPath("a/b", "style", ["(app)", "(home)", "book", "[key]"]), "/book/a%2Fb/style");
  assert.equal(bookToolPath("k", "finished", ["(public)", "work", "[id]"]), "/(public)/book/k/finished");
});

test("the stats page opens in the same stack as the book it belongs to", () => {
  assert.equal(workStatsPath("w1", ["(app)", "(arena)", "work", "[id]"]), "/work/w1/stats");
  assert.equal(workStatsPath("w1", ["(public)", "work", "[id]"]), "/(public)/work/w1/stats");
});
