import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUPING_INTERVAL_MS, startBackfill, startDetailsBackfill, startWorksBackfill, startWorksGrouping } from "./backfill.js";

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
  startWorksBackfill({ assignMissingWorks: (limit) => { limits.push(limit); return sizes.shift() ?? 0; }, fillTitleKeys: () => 0 }, log, undefined, timers);
  assert.deepEqual(limits, []);
  assert.equal(state.delay, 600_000);
  await until(() => info.length > 0);
  assert.deepEqual(limits, [250, 250, 250]);
  assert.deepEqual(info, [{ details: { assigned: 517, titleKeyed: 0 }, message: "updated works for existing editions" }]);
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
  const step = () => { turnAtBatch.push(turns); return sizes.shift() ?? 0; };
  startWorksBackfill({ assignMissingWorks: step, fillTitleKeys: step }, log, undefined, timers);
  await until(() => info.length > 0);
  running = false;
  assert.equal(turnAtBatch.length, 6);
  turnAtBatch.forEach((turn, i) => assert.ok(turn > (turnAtBatch[i - 1] ?? 0), `batch ${i} ran in the same turn as the one before it`));
});

test("a failed works batch is logged as an error, and the next tick retries", async () => {
  const { state, timers } = fakeTimers();
  const { log, info, error } = fakeLog();
  const outcomes: Array<Error | number> = [new Error("database is locked"), 4];
  let attempts = 0;
  const assignMissingWorks = () => {
    attempts++;
    const outcome = outcomes.shift() ?? 0;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  startWorksBackfill({ assignMissingWorks, fillTitleKeys: () => 0 }, log, undefined, timers);
  await until(() => error.length === 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(error[0]!.message, "works backfill failed");
  assert.match((error[0]!.details as { err: Error }).err.message, /database is locked/);
  assert.equal(info.length, 0);
  state.callback!();
  await until(() => info.length === 1);
  assert.equal(attempts, 2);
  assert.deepEqual(info[0]!.details, { assigned: 4, titleKeyed: 0 });
});

test("stopping the works backfill ends it at the next batch boundary", async () => {
  const { timers } = fakeTimers();
  const { log } = fakeLog();
  let batches = 0;
  let stop = () => {};
  stop = startWorksBackfill({ assignMissingWorks: () => { batches++; stop(); return batches < 50 ? 250 : 0; }, fillTitleKeys: () => 0 }, log, undefined, timers);
  await until(() => batches > 1);
  assert.equal(batches, 1);
});

test("a works backfill with nothing to assign logs nothing", async () => {
  const { timers } = fakeTimers();
  const { log, info, error } = fakeLog();
  let batches = 0;
  startWorksBackfill({ assignMissingWorks: () => { batches++; return 0; }, fillTitleKeys: () => 0 }, log, undefined, timers);
  await until(() => batches === 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([info, error], [[], []]);
});

test("the works tick fills title keys after assigning works, draining each step in order", async () => {
  const { timers } = fakeTimers();
  const { log, info } = fakeLog();
  const calls: string[] = [];
  const sizes: Record<string, number[]> = { assign: [3], keys: [250, 10] };
  const step = (name: string) => () => { calls.push(name); return sizes[name]!.shift() ?? 0; };
  startWorksBackfill({ assignMissingWorks: step("assign"), fillTitleKeys: step("keys") }, log, undefined, timers);
  await until(() => info.length > 0);
  assert.deepEqual(calls, ["assign", "keys", "keys"]);
  assert.deepEqual(info, [{ details: { assigned: 3, titleKeyed: 260 }, message: "updated works for existing editions" }]);
});

test("a works tick that changes nothing logs nothing", async () => {
  const { timers } = fakeTimers();
  const { log, info } = fakeLog();
  let calls = 0;
  startWorksBackfill({ assignMissingWorks: () => { calls++; return 0; }, fillTitleKeys: () => { calls++; return 0; } }, log, undefined, timers);
  await until(() => calls === 2);
  await new Promise(setImmediate);
  assert.deepEqual(info, []);
});

test("works grouping drains at start on a daily unref'd timer, and logs what it grouped", async () => {
  const { state, timers } = fakeTimers();
  const { log, info } = fakeLog();
  const sizes = [250, 7];
  const limits: number[] = [];
  startWorksGrouping((limit) => { limits.push(limit); return sizes.shift() ?? 0; }, log, undefined, timers);
  assert.equal(state.delay, GROUPING_INTERVAL_MS);
  assert.equal(state.unrefs, 1);
  await until(() => info.length > 0);
  assert.deepEqual(limits, [250, 250]);
  assert.deepEqual(info, [{ details: { grouped: 257 }, message: "grouped keyless works by title" }]);
  sizes.push(1);
  state.callback!();
  await until(() => info.length > 1);
  assert.deepEqual(info[1], { details: { grouped: 1 }, message: "grouped keyless works by title" });
});

test("runNow while a grouping run is going returns null and starts nothing", async () => {
  const { timers } = fakeTimers();
  const { log } = fakeLog();
  let calls = 0;
  const grouping = startWorksGrouping(() => { calls++; return calls < 3 ? 250 : 0; }, log, undefined, timers);
  assert.equal(await grouping.runNow(), null);
  await until(() => calls === 3);
  assert.equal(await grouping.runNow(), 0);
  assert.equal(calls, 4);
});

test("a failed grouping run is logged and the next run still works", async () => {
  const { state, timers } = fakeTimers();
  const { log, info, error } = fakeLog();
  const outcomes: Array<Error | number> = [new Error("database is locked"), 2];
  startWorksGrouping(() => {
    const outcome = outcomes.shift() ?? 0;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }, log, undefined, timers);
  await until(() => error.length === 1);
  assert.equal(error[0]!.message, "works grouping failed");
  state.callback!();
  await until(() => info.length === 1);
  assert.deepEqual(info[0]!.details, { grouped: 2 });
});

test("stopping works grouping ends a run at the next batch boundary and clears the timer", async () => {
  const { state, handle, timers } = fakeTimers();
  const { log } = fakeLog();
  let batches = 0;
  let grouping: { stop(): void } | null = null;
  grouping = startWorksGrouping(() => { batches++; grouping?.stop(); return 250; }, log, undefined, timers);
  await until(() => batches > 1);
  assert.equal(batches, 1);
  assert.deepEqual(state.cleared, [handle]);
});
