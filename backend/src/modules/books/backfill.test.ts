import assert from "node:assert/strict";
import { test } from "node:test";
import { startBackfill, startDetailsBackfill } from "./backfill.js";

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("the details backfill runs a batch at once and again every interval", async () => {
  const { state, timers } = fakeTimers();
  let batches = 0;
  startDetailsBackfill(async () => { batches++; }, () => {}, 600_000, timers);
  assert.equal(batches, 1);
  assert.equal(state.delay, 600_000);
  await new Promise((resolve) => setImmediate(resolve));
  state.callback!();
  assert.equal(batches, 2);
});

test("a new details batch does not start while the previous one is still running", async () => {
  const { state, timers } = fakeTimers();
  const gate = deferred();
  let batches = 0;
  startDetailsBackfill(() => { batches++; return gate.promise; }, () => {}, 1000, timers);
  state.callback!();
  state.callback!();
  assert.equal(batches, 1);
  gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  state.callback!();
  assert.equal(batches, 2);
});

test("a failed details batch is reported and the next one still runs", async () => {
  const { state, timers } = fakeTimers();
  const errors: unknown[] = [];
  let batches = 0;
  startDetailsBackfill(async () => { if (batches++ === 0) throw new Error("db down"); }, (error) => errors.push(error), 1000, timers);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.match((errors[0] as Error).message, /db down/);
  state.callback!();
  assert.equal(batches, 2);
});

test("stopping the details backfill clears the timer and aborts the running batch", async () => {
  const { state, handle, timers } = fakeTimers();
  let signal!: AbortSignal;
  const stop = startDetailsBackfill(async (value) => { signal = value; }, () => {}, 1000, timers);
  assert.equal(signal.aborted, false);
  stop();
  assert.equal(signal.aborted, true);
  assert.deepEqual(state.cleared, [handle]);
});
