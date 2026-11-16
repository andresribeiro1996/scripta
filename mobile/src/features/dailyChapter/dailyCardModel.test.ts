import assert from "node:assert/strict";
import { test } from "node:test";
import type { DailyChapterHistory } from "@scripta/shared";
import { dailyCardAction, dailyPlayVariant } from "./dailyCardModel.js";

const history = (results: Array<{ editionId: string; score: number; date: string }>) => ({ results, today: "2026-11-15" }) as unknown as DailyChapterHistory;

test("unplayed or unknown history offers play", () => {
  assert.deepEqual(dailyCardAction("ed-15", undefined), { kind: "play" });
  assert.deepEqual(dailyCardAction("ed-15", history([])), { kind: "play" });
});

test("today's result shows its score", () => {
  assert.deepEqual(dailyCardAction("ed-15", history([{ editionId: "ed-15", score: 4, date: "2026-11-15" }])), { kind: "results", score: 4 });
  assert.deepEqual(dailyCardAction("ed-15", history([{ editionId: "ed-15", score: 0, date: "2026-11-15" }])), { kind: "results", score: 0 });
});

test("yesterday's result is not today's", () => {
  assert.deepEqual(dailyCardAction("ed-15", history([{ editionId: "ed-14", score: 5, date: "2026-11-14" }])), { kind: "play" });
});

test("an empty library leaves the primary button to import", () => {
  assert.equal(dailyPlayVariant(true), "secondary");
  assert.equal(dailyPlayVariant(false), "primary");
});
