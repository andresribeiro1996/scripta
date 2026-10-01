import assert from "node:assert/strict";
import { test } from "node:test";
import { startBackfill } from "./backfill.js";

function fakeTimers() {
  const state = { callback: null as (() => void) | null, delay: 0, unrefs: 0, cleared: [] as object[] };
  const handle = { unref() { state.unrefs++; return handle; } };
  return {
    state,
    handle,
    timers: {
      setInterval: (callback: () => void, delay: number) => {
        state.callback = callback;
        state.delay = delay;
        return handle as unknown as NodeJS.Timeout;
      },
      clearInterval: (value: NodeJS.Timeout) => { state.cleared.push(value); }
    }
  };
}

test("the backfill fires every interval on an unref'd timer", () => {
  const { state, timers } = fakeTimers();
  let calls = 0;
  startBackfill(() => { calls++; }, 600_000, timers);
  assert.equal(state.delay, 600_000);
  assert.equal(state.unrefs, 1);
  assert.equal(calls, 0);
  state.callback!();
  state.callback!();
  assert.equal(calls, 2);
});

test("stop clears the interval", () => {
  const { state, handle, timers } = fakeTimers();
  const stop = startBackfill(() => {}, 1000, timers);
  assert.deepEqual(state.cleared, []);
  stop();
  assert.deepEqual(state.cleared, [handle]);
});

test("an error from the backfill is not swallowed", () => {
  const { state, timers } = fakeTimers();
  startBackfill(() => { throw new Error("db down"); }, 1000, timers);
  assert.throws(() => state.callback!(), /db down/);
});
