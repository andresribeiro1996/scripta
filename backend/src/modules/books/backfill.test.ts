import assert from "node:assert/strict";
import { test } from "node:test";
import { startBackfill, startDetailsBackfill, startWorksBackfill } from "./backfill.js";

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

test("a batch that reports a pause makes the details backfill skip ticks until then", async () => {
  const { state, timers } = fakeTimers();
  let clock = 1_000;
  const results: Array<number | null> = [5_000, null];
  let batches = 0;
  startDetailsBackfill(async () => { batches++; return results.shift() ?? null; }, () => {}, 1000, timers, () => clock);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(batches, 1);
  clock = 4_999;
  state.callback!();
  assert.equal(batches, 1);
  clock = 5_000;
  state.callback!();
  assert.equal(batches, 2);
  await new Promise((resolve) => setImmediate(resolve));
  state.callback!();
  assert.equal(batches, 3);
});

function fakeLog() {
  const info: Array<{ details: object; message: string }> = [];
  const error: Array<{ details: object; message: string }> = [];
  return {
    info,
    error,
    log: {
      info: (details: object, message: string) => { info.push({ details, message }); },
      error: (details: object, message: string) => { error.push({ details, message }); }
    }
  };
}

async function until(condition: () => boolean) {
  for (let turns = 0; turns < 200 && !condition(); turns++) await new Promise((resolve) => setImmediate(resolve));
}

test("the works backfill runs no batch on the caller's turn, then batches until one comes back short, and logs the total", async () => {
  const { state, timers } = fakeTimers();
  const sizes = [250, 250, 17];
  const limits: number[] = [];
  const { log, info } = fakeLog();
  startWorksBackfill((limit) => { limits.push(limit); return sizes.shift() ?? 0; }, log, undefined, timers);
  assert.deepEqual(limits, []);
  assert.equal(state.delay, 600_000);
  await until(() => info.length > 0);
  assert.deepEqual(limits, [250, 250, 250]);
  assert.deepEqual(info, [{ details: { assigned: 517 }, message: "assigned works to existing editions" }]);
});

test("the works backfill gives the event loop a turn before every batch", async () => {
  const { timers } = fakeTimers();
  let turns = 0;
  let running = true;
  const probe = () => {
    turns++;
    if (running) setImmediate(probe);
  };
  setImmediate(probe);
  const sizes = [250, 250, 250, 250, 3];
  const turnAtBatch: number[] = [];
  const { log, info } = fakeLog();
  startWorksBackfill(() => { turnAtBatch.push(turns); return sizes.shift() ?? 0; }, log, undefined, timers);
  await until(() => info.length > 0);
  running = false;
  assert.equal(turnAtBatch.length, 5);
  turnAtBatch.forEach((turn, i) => assert.ok(turn > (turnAtBatch[i - 1] ?? 0), `batch ${i} ran in the same turn as the one before it`));
});

test("a failed works batch is logged as an error, and the next tick retries", async () => {
  const { state, timers } = fakeTimers();
  const { log, info, error } = fakeLog();
  const outcomes: Array<Error | number> = [new Error("database is locked"), 4];
  let attempts = 0;
  startWorksBackfill(() => {
    attempts++;
    const outcome = outcomes.shift() ?? 0;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }, log, undefined, timers);
  await until(() => error.length === 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(error[0]!.message, "works backfill failed");
  assert.match((error[0]!.details as { err: Error }).err.message, /database is locked/);
  assert.equal(info.length, 0);
  state.callback!();
  await until(() => info.length === 1);
  assert.equal(attempts, 2);
  assert.deepEqual(info[0]!.details, { assigned: 4 });
});

test("stopping the works backfill ends it at the next batch boundary", async () => {
  const { timers } = fakeTimers();
  const { log } = fakeLog();
  let batches = 0;
  let stop = () => {};
  stop = startWorksBackfill(() => { batches++; stop(); return batches < 50 ? 250 : 0; }, log, undefined, timers);
  await until(() => batches > 1);
  assert.equal(batches, 1);
});

test("a works backfill with nothing to assign logs nothing", async () => {
  const { timers } = fakeTimers();
  const { log, info, error } = fakeLog();
  let batches = 0;
  startWorksBackfill(() => { batches++; return 0; }, log, undefined, timers);
  await until(() => batches === 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([info, error], [[], []]);
});
