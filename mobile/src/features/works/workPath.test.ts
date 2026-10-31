/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { bookToolPath, seriesSearchHref, seriesSearchMethod, stackPrefix, workPath, workStatsPath } from "./workPath.js";

test("a work opened from inside the tabs stays in them; from a root-level screen it opens above it", () => {
  assert.equal(workPath("w1", ["(app)", "(arena)", "tierlist", "[id]"]), "/work/w1");
  assert.equal(workPath("w1", ["arena", "[id]"]), "/(public)/work/w1");
  assert.equal(workPath("w1", ["vote", "[code]"]), "/(public)/work/w1");
});

test("a Daily Chapter day opens in the stack Your chapters was opened in", () => {
  assert.equal(stackPrefix(["(app)", "(home)", "daily-chapters"]), "");
  assert.equal(stackPrefix(["(public)", "daily-chapters"]), "/(public)");
});

test("a work opened on one of its editions carries that edition and nothing otherwise", () => {
  assert.equal(workPath("w1", ["(app)", "(search)", "search"], "b1"), "/work/w1?edition=b1");
  assert.equal(workPath("w1", ["vote", "[code]"], "b/1"), "/(public)/work/w1?edition=b%2F1");
  assert.equal(workPath("w1", ["(app)", "(search)", "search"], undefined), "/work/w1");
  assert.equal(workPath("w1", ["(app)", "(search)", "search"], null), "/work/w1");
  assert.equal(workPath("w1", ["(app)", "(search)", "search"], ""), "/work/w1");
});

test("book tools open over the book screen in whichever stack it sits", () => {
  assert.equal(bookToolPath("a/b", "style", ["(app)", "(home)", "book", "[key]"]), "/book/a%2Fb/style");
  assert.equal(bookToolPath("k", "finished", ["(public)", "work", "[id]"]), "/(public)/book/k/finished");
});

test("the stats page opens in the same stack as the book it belongs to", () => {
  assert.equal(workStatsPath("w1", ["(app)", "(arena)", "work", "[id]"]), "/work/w1/stats");
  assert.equal(workStatsPath("w1", ["(public)", "work", "[id]"]), "/(public)/work/w1/stats");
});

test("a series tap reaches the Search tab's own screen by the call that works from where the book sits", () => {
  assert.equal(seriesSearchMethod(["(app)", "(search)", "work", "[id]"]), "dismissTo");
  assert.equal(seriesSearchMethod(["(app)", "(library)", "work", "[id]"]), "navigate");
  assert.equal(seriesSearchMethod(["(app)", "(you)", "u", "[username]"]), "navigate");
  assert.equal(seriesSearchMethod(["(public)", "work", "[id]"]), null);
  assert.deepEqual(seriesSearchHref("Dune Chronicles", 5, "dismissTo"), { pathname: "/search", params: { q: "Dune Chronicles", t: "5" } });
  assert.deepEqual(seriesSearchHref("Dune Chronicles", 5, "navigate"), { pathname: "/search", params: { q: "Dune Chronicles", t: "5", pop: "true" } });
});
