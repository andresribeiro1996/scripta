import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlayClock, MAX_PLAY_DURATION_MS } from "./playClock.js";

test("the clock starts once and ends at the last answer", () => {
  const clock = createPlayClock();
  assert.equal(clock.elapsed(500, false), 0);
  clock.start(1000);
  clock.start(5000);
  clock.answered(4000);
  clock.answered(9000);
  assert.equal(clock.durationMs(60_000), 8000);
});

test("a running count freezes once every question is answered", () => {
  const clock = createPlayClock();
  clock.start(1000);
  assert.equal(clock.elapsed(3000, false), 2000);
  clock.answered(4000);
  assert.equal(clock.elapsed(50_000, true), 3000);
});

test("duration stays inside the server's limit", () => {
  const clock = createPlayClock();
  clock.start(0);
  clock.answered(2 * MAX_PLAY_DURATION_MS);
  assert.equal(clock.durationMs(2 * MAX_PLAY_DURATION_MS), MAX_PLAY_DURATION_MS);
});

test("a clock that never started reports nothing", () => {
  assert.equal(createPlayClock().durationMs(1000), 0);
});

test("a device clock moved backwards still gives a valid duration", () => {
  const clock = createPlayClock();
  clock.start(5000);
  clock.answered(1000);
  assert.equal(clock.durationMs(1000), 0);
});
