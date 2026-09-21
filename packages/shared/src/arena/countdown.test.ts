import assert from "node:assert/strict";
import { test } from "node:test";
import { countdownLabel } from "./countdown.js";

const NOW = Date.parse("2026-09-21T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("a deadline days away counts in days, not three-digit hours", () => {
  assert.equal(countdownLabel(at(6 * DAY + 6 * HOUR), NOW), "6d 6h left");
  assert.equal(countdownLabel(at(2 * DAY), NOW), "2d 0h left");
});

test("the last day counts in hours, and the last hour in minutes", () => {
  assert.equal(countdownLabel(at(23 * HOUR + 59 * MINUTE), NOW), "23h 59m left");
  assert.equal(countdownLabel(at(45 * MINUTE + 30_000), NOW), "45m 30s left");
});

test("a passed deadline is closing, whatever it says", () => {
  assert.equal(countdownLabel(at(-1), NOW), "Closing…");
});
