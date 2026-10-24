import assert from "node:assert/strict";
import { test } from "node:test";
import { createJobs, startJob, startTimer } from "./jobs.js";

function fakeTimers() {
  const state = { callback: null as (() => void) | null, delay: 0, firstRun: null as { callback: () => void; delay: number } | null, unrefs: 0, cleared: [] as object[] };
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
      clearInterval: (value: NodeJS.Timeout) => { state.cleared.push(value); },
      setTimeout: (callback: () => void, delay: number) => {
        state.firstRun = { callback, delay };
        return handle as unknown as NodeJS.Timeout;
      },
      clearTimeout: () => { state.firstRun = null; }
    }
  };
}

test("the timer fires every interval on an unref'd timer", () => {
  const { state, timers } = fakeTimers();
  let calls = 0;
  startTimer(() => { calls++; }, 600_000, timers);
  assert.equal(state.delay, 600_000);
  assert.equal(state.unrefs, 1);
  assert.equal(calls, 0);
  state.callback!();
  state.callback!();
  assert.equal(calls, 2);
});

test("stop clears the interval", () => {
  const { state, handle, timers } = fakeTimers();
  const stop = startTimer(() => {}, 1000, timers);
  assert.deepEqual(state.cleared, []);
  stop();
  assert.deepEqual(state.cleared, [handle]);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("a job runs a batch at once and again every interval", async () => {
  const { state, timers } = fakeTimers();
  let batches = 0;
  startJob(async () => { batches++; }, () => {}, 600_000, timers);
  assert.equal(batches, 1);
  assert.equal(state.delay, 600_000);
  await new Promise((resolve) => setImmediate(resolve));
  state.callback!();
  assert.equal(batches, 2);
});

test("a new job run does not start while the previous one is still running", async () => {
  const { state, timers } = fakeTimers();
  const gate = deferred();
  let batches = 0;
  startJob(() => { batches++; return gate.promise; }, () => {}, 1000, timers);
  state.callback!();
  state.callback!();
  assert.equal(batches, 1);
  gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  state.callback!();
  assert.equal(batches, 2);
});

test("a failed job run is reported and the next one still runs", async () => {
  const { state, timers } = fakeTimers();
  const errors: unknown[] = [];
  let batches = 0;
  startJob(async () => { if (batches++ === 0) throw new Error("db down"); }, (error) => errors.push(error), 1000, timers);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  assert.match((errors[0] as Error).message, /db down/);
  state.callback!();
  assert.equal(batches, 2);
});

test("stopping a job clears the timer and aborts the running batch", async () => {
  const { state, handle, timers } = fakeTimers();
  let signal!: AbortSignal;
  const stop = startJob(async (value) => { signal = value; }, () => {}, 1000, timers);
  assert.equal(signal.aborted, false);
  stop();
  assert.equal(signal.aborted, true);
  assert.deepEqual(state.cleared, [handle]);
});

test("a batch that reports a pause makes a job skip ticks until then", async () => {
  const { state, timers } = fakeTimers();
  let clock = 1_000;
  const results: Array<number | null> = [5_000, null];
  let batches = 0;
  startJob(async () => { batches++; return results.shift() ?? null; }, () => {}, 1000, timers, 0, () => clock);
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

test("a job given an initial delay runs nothing until it passes, then once, then every interval", async () => {
  const { state, timers } = fakeTimers();
  let batches = 0;
  startJob(async () => { batches++; }, () => {}, 600_000, timers, 30_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(batches, 0);
  assert.equal(state.firstRun?.delay, 30_000);
  assert.equal(state.delay, 600_000);
  assert.equal(state.unrefs, 2);
  state.firstRun!.callback();
  assert.equal(batches, 1);
  await new Promise((resolve) => setImmediate(resolve));
  state.callback!();
  assert.equal(batches, 2);
});

test("stopping a job before its initial delay passes cancels the first run", () => {
  const { state, timers } = fakeTimers();
  const stop = startJob(async () => {}, () => {}, 600_000, timers, 30_000);
  assert.notEqual(state.firstRun, null);
  stop();
  assert.equal(state.firstRun, null);
});

test("a job without an initial delay never sets a first-run timer", () => {
  const { state, timers } = fakeTimers();
  startJob(async () => {}, () => {}, 600_000, timers);
  assert.equal(state.firstRun, null);
});


function fakeLog() {
  const error: Array<{ details: object; message: string }> = [];
  return { error, log: { error: (details: object, message: string) => { error.push({ details, message }); } } };
}

test("every runs a job at once and again every interval", async () => {
  const { state, timers } = fakeTimers();
  let runs = 0;
  const jobs = createJobs(fakeLog().log, timers);
  jobs.every("cover-enqueue", 600_000, () => { runs++; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  assert.equal(state.delay, 600_000);
  state.callback!();
  assert.equal(runs, 2);
});

test("every holds the first run back by its initial delay", () => {
  const { state, timers } = fakeTimers();
  let runs = 0;
  createJobs(fakeLog().log, timers).every("bnp-sync", 600_000, () => { runs++; }, 30_000);
  assert.equal(runs, 0);
  assert.equal(state.firstRun?.delay, 30_000);
  state.firstRun!.callback();
  assert.equal(runs, 1);
});

test("a job that throws or rejects is logged with its name, and the next tick still runs", async () => {
  const { state, timers } = fakeTimers();
  const { log, error } = fakeLog();
  const failures = [new Error("sync boom"), new Error("async boom")];
  let runs = 0;
  createJobs(log, timers).every("cover-enqueue", 1000, () => {
    runs++;
    const failure = failures.shift();
    if (failure?.message === "sync boom") throw failure;
    if (failure) return Promise.reject(failure);
  });
  await new Promise((resolve) => setImmediate(resolve));
  state.callback!();
  await new Promise((resolve) => setImmediate(resolve));
  state.callback!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 3);
  assert.equal(error.length, 2);
  assert.deepEqual(error.map((entry) => entry.message), ["cover-enqueue failed", "cover-enqueue failed"]);
  assert.deepEqual(error.map((entry) => (entry.details as { err: Error }).err.message), ["sync boom", "async boom"]);
});

test("a job that returns a resume time skips ticks until then", async () => {
  const { state, timers } = fakeTimers();
  let runs = 0;
  createJobs(fakeLog().log, timers).every("sweep", 1000, () => { runs++; return Date.now() + 60_000; });
  await new Promise((resolve) => setImmediate(resolve));
  state.callback!();
  state.callback!();
  assert.equal(runs, 1);
});

test("stopAll aborts running jobs, clears their timers and calls every owned stop once, last registered first", async () => {
  const { state, handle, timers } = fakeTimers();
  const jobs = createJobs(fakeLog().log, timers);
  const order: string[] = [];
  let signal!: AbortSignal;
  jobs.own(() => order.push("first"));
  jobs.every("sweep", 1000, (value) => { signal = value; });
  jobs.own(() => order.push("last"));
  await new Promise((resolve) => setImmediate(resolve));
  jobs.stopAll();
  assert.equal(signal.aborted, true);
  assert.deepEqual(state.cleared, [handle]);
  assert.deepEqual(order, ["last", "first"]);
  jobs.stopAll();
  assert.deepEqual(order, ["last", "first"]);
});
