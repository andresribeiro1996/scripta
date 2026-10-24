import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUPING_INTERVAL_MS, startBackfill, startCoverColorBackfill, startDetailsBackfill, startWorksBackfill, startWorksGrouping } from "./backfill.js";

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
  startDetailsBackfill(async () => { batches++; return results.shift() ?? null; }, () => {}, 1000, timers, 0, () => clock);
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

test("a details backfill given an initial delay runs nothing until it passes, then once, then every interval", async () => {
  const { state, timers } = fakeTimers();
  let batches = 0;
  startDetailsBackfill(async () => { batches++; }, () => {}, 600_000, timers, 30_000);
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

test("stopping a details backfill before its initial delay passes cancels the first run", () => {
  const { state, timers } = fakeTimers();
  const stop = startDetailsBackfill(async () => {}, () => {}, 600_000, timers, 30_000);
  assert.notEqual(state.firstRun, null);
  stop();
  assert.equal(state.firstRun, null);
});

test("a details backfill without an initial delay never sets a first-run timer", () => {
  const { state, timers } = fakeTimers();
  startDetailsBackfill(async () => {}, () => {}, 600_000, timers);
  assert.equal(state.firstRun, null);
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

test("a works backfill given an initial delay assigns nothing until it passes, then drains once", async () => {
  const { state, timers } = fakeTimers();
  const { log, info } = fakeLog();
  const limits: number[] = [];
  startWorksBackfill({ assignMissingWorks: (limit) => { limits.push(limit); return 0; }, fillTitleKeys: () => 0 }, log, undefined, timers, 45_000);
  await until(() => limits.length > 0);
  assert.deepEqual(limits, []);
  assert.equal(state.firstRun?.delay, 45_000);
  assert.equal(state.delay, 600_000);
  state.firstRun!.callback();
  await until(() => limits.length > 0);
  assert.deepEqual(limits, [250]);
  assert.deepEqual(info, []);
});

test("works grouping drains at start on a daily unref'd timer, and logs what it grouped", async () => {
  const { state, timers } = fakeTimers();
  const { log, info } = fakeLog();
  const sizes = [250, 7];
  const limits: number[] = [];
  startWorksGrouping(async () => 0, (limit) => { limits.push(limit); return sizes.shift() ?? 0; }, log, undefined, timers);
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

test("works grouping given an initial delay runs nothing until it passes, then once, then on its daily timer", async () => {
  const { state, timers } = fakeTimers();
  const { log, info } = fakeLog();
  const sizes = [5, 3];
  const limits: number[] = [];
  startWorksGrouping(async () => 0, (limit) => { limits.push(limit); return sizes.shift() ?? 0; }, log, undefined, timers, 120_000);
  await until(() => limits.length > 0);
  assert.deepEqual(limits, []);
  assert.equal(state.firstRun?.delay, 120_000);
  assert.equal(state.delay, GROUPING_INTERVAL_MS);
  state.firstRun!.callback();
  await until(() => info.length === 1);
  assert.deepEqual(info[0]!.details, { grouped: 5 });
  state.callback!();
  await until(() => info.length === 2);
  assert.deepEqual(info[1]!.details, { grouped: 3 });
});

test("stopping works grouping before its initial delay passes cancels the first run", () => {
  const { state, timers } = fakeTimers();
  const { log } = fakeLog();
  const grouping = startWorksGrouping(async () => 0, () => 0, log, undefined, timers, 120_000);
  assert.notEqual(state.firstRun, null);
  grouping.stop();
  assert.equal(state.firstRun, null);
});

test("works grouping merges duplicate works before grouping keyless ones", async () => {
  const { timers } = fakeTimers();
  const { log, info } = fakeLog();
  const calls: string[] = [];
  const signals: unknown[] = [];
  const sizes = [250, 4];
  startWorksGrouping(
    async (signal) => { calls.push("merge"); signals.push(signal); return 3; },
    () => { calls.push("group"); return sizes.shift() ?? 0; },
    log,
    undefined,
    timers
  );
  await until(() => info.length === 2);
  assert.deepEqual(calls, ["merge", "group", "group"]);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.deepEqual(info, [
    { details: { merged: 3 }, message: "merged duplicate Open Library works" },
    { details: { grouped: 254 }, message: "grouped keyless works by title" }
  ]);
});

test("runNow while a grouping run is going returns null and starts nothing", async () => {
  const { timers } = fakeTimers();
  const { log } = fakeLog();
  let calls = 0;
  const grouping = startWorksGrouping(async () => 0, () => { calls++; return calls < 3 ? 250 : 0; }, log, undefined, timers);
  assert.equal(await grouping.runNow(), null);
  await until(() => calls === 3);
  assert.equal(await grouping.runNow(), 0);
  assert.equal(calls, 4);
});

test("a failed grouping run is logged and the next run still works", async () => {
  const { state, timers } = fakeTimers();
  const { log, info, error } = fakeLog();
  const outcomes: Array<Error | number> = [new Error("database is locked"), 2];
  startWorksGrouping(async () => 0, () => {
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

test("a failed duplicate pass is logged, skips that run's grouping, and the next run still works", async () => {
  const { state, timers } = fakeTimers();
  const { log, info, error } = fakeLog();
  const outcomes: Array<Error | number> = [new Error("database is locked"), 0];
  const groups: number[] = [];
  startWorksGrouping(
    async () => {
      const outcome = outcomes.shift() ?? 0;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    (limit) => { groups.push(limit); return 2; },
    log,
    undefined,
    timers
  );
  await until(() => error.length === 1);
  assert.equal(error[0]!.message, "works grouping failed");
  assert.match((error[0]!.details as { err: Error }).err.message, /database is locked/);
  assert.deepEqual(groups, []);
  assert.deepEqual(info, []);
  state.callback!();
  await until(() => info.length === 1);
  assert.deepEqual(groups, [250]);
  assert.deepEqual(info, [{ details: { grouped: 2 }, message: "grouped keyless works by title" }]);
});

test("stopping works grouping ends a run at the next batch boundary and clears the timer", async () => {
  const { state, handle, timers } = fakeTimers();
  const { log } = fakeLog();
  let batches = 0;
  let grouping: { stop(): void } | null = null;
  grouping = startWorksGrouping(async () => 0, () => { batches++; grouping?.stop(); return 250; }, log, undefined, timers);
  await until(() => batches > 1);
  assert.equal(batches, 1);
  assert.deepEqual(state.cleared, [handle]);
});

test("the cover colour backfill drains in batches of 50 until one comes back short, logs the total, and drains again on the next tick", async () => {
  const { state, timers } = fakeTimers();
  const { log, info, error } = fakeLog();
  const sizes = [50, 50, 7];
  const limits: number[] = [];
  startCoverColorBackfill(async (limit) => { limits.push(limit); return sizes.shift() ?? 0; }, log, undefined, timers);
  assert.equal(state.delay, 600_000);
  await until(() => info.length === 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(limits, [50, 50, 50]);
  assert.deepEqual(info, [{ details: { coloured: 107 }, message: "coloured cover images" }]);

  state.callback!();
  await until(() => limits.length === 4);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(limits, [50, 50, 50, 50]);
  assert.equal(info.length, 1);
  assert.deepEqual(error, []);
});

test("a cover colour backfill given an initial delay colours nothing until it passes, then drains once", async () => {
  const { state, timers } = fakeTimers();
  const { log } = fakeLog();
  const limits: number[] = [];
  startCoverColorBackfill(async (limit) => { limits.push(limit); return 0; }, log, undefined, timers, 50_000);
  await until(() => limits.length > 0);
  assert.deepEqual(limits, []);
  assert.equal(state.firstRun?.delay, 50_000);
  assert.equal(state.delay, 600_000);
  state.firstRun!.callback();
  await until(() => limits.length > 0);
  assert.deepEqual(limits, [50]);
});

test("the cover colour backfill stops draining when stopped and logs a failed batch as an error", async () => {
  const { state, timers } = fakeTimers();
  const { log } = fakeLog();
  const limits: number[] = [];
  const stop = startCoverColorBackfill(async (limit) => { limits.push(limit); return limit; }, log, undefined, timers);
  await until(() => limits.length === 2);
  stop();
  const seen = limits.length;
  await until(() => false);
  assert.equal(limits.length, seen);
  assert.equal(state.cleared.length, 1);

  const failing = fakeLog();
  startCoverColorBackfill(async () => { throw new Error("R2 GET failed: HTTP 500"); }, failing.log, undefined, fakeTimers().timers);
  await until(() => failing.error.length > 0);
  assert.equal(failing.error.length, 1);
  const [failure] = failing.error;
  assert.equal(failure?.message, "cover colour backfill failed");
  assert.equal((failure?.details as { err: Error }).err.message, "R2 GET failed: HTTP 500");
  assert.deepEqual(failing.info, []);
});
