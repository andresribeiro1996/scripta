import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkQueue } from "./workQueue.js";

const flush = async () => {
  for (let tick = 0; tick < 5; tick++) await new Promise(setImmediate);
};

test("adding never runs work synchronously, and duplicates collapse", async () => {
  const ran: string[] = [];
  const queue = createWorkQueue({ concurrency: 4, run: async (id) => { ran.push(id); return null; }, onError: () => {} });
  queue.add("a");
  queue.add("a");
  assert.deepEqual(ran, []);
  assert.equal(queue.size(), 1);
  await flush();
  assert.deepEqual(ran, ["a"]);
  assert.equal(queue.size(), 0);
});

test("at most the concurrency runs at once", async () => {
  let running = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const queue = createWorkQueue({
    concurrency: 4,
    run: (id) => new Promise((resolve) => {
      running += 1;
      peak = Math.max(peak, running);
      releases.push(() => { running -= 1; resolve(null); });
    }),
    onError: () => {}
  });
  for (const id of ["a", "b", "c", "d", "e", "f"]) queue.add(id);
  await flush();
  assert.equal(running, 4);
  while (releases.length > 0) {
    releases.shift()!();
    await flush();
  }
  assert.equal(peak, 4);
  assert.equal(queue.size(), 0);
});

test("a pause keeps the work and resumes it at the given time", async () => {
  let now = 1_000;
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const calls: string[] = [];
  const queue = createWorkQueue({
    concurrency: 1,
    now: () => now,
    setTimer: (callback, ms) => { timers.push({ callback, ms }); return () => {}; },
    run: async (id) => {
      calls.push(id);
      return calls.length === 1 ? 61_000 : null;
    },
    onError: () => {}
  });
  queue.add("a");
  queue.add("b");
  await flush();
  assert.deepEqual(calls, ["a"]);
  assert.deepEqual(timers.map((timer) => timer.ms), [60_000]);
  assert.equal(queue.size(), 2);
  now = 61_000;
  timers[0]!.callback();
  await flush();
  assert.deepEqual(calls, ["a", "a", "b"]);
  assert.equal(queue.size(), 0);
});

test("an error drops that work, reports it, and the queue goes on", async () => {
  const errors: Array<[string, string]> = [];
  const ran: string[] = [];
  const queue = createWorkQueue({
    concurrency: 1,
    run: async (id) => {
      ran.push(id);
      if (id === "bad") throw new Error("boom");
      return null;
    },
    onError: (error, id) => { errors.push([id, (error as Error).message]); }
  });
  queue.add("bad");
  queue.add("good");
  await flush();
  assert.deepEqual(errors, [["bad", "boom"]]);
  assert.deepEqual(ran, ["bad", "good"]);
  assert.equal(queue.size(), 0);
});

test("stop drops queued work and ignores later adds", async () => {
  const ran: string[] = [];
  let cancelled = 0;
  const queue = createWorkQueue({
    concurrency: 1,
    setTimer: () => () => { cancelled += 1; },
    run: async (id) => { ran.push(id); return id === "a" ? Date.now() + 60_000 : null; },
    onError: () => {}
  });
  queue.add("a");
  await flush();
  queue.stop();
  queue.add("b");
  await flush();
  assert.deepEqual(ran, ["a"]);
  assert.equal(queue.size(), 0);
  assert.equal(cancelled, 1);
});

test("a resume timer that fires before the pause ends re-arms for the remainder", async () => {
  let now = 1_000;
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const calls: string[] = [];
  const queue = createWorkQueue({
    concurrency: 1,
    now: () => now,
    setTimer: (callback, ms) => { timers.push({ callback, ms }); return () => {}; },
    run: async (id) => {
      calls.push(id);
      return calls.length === 1 ? 2_000 : null;
    },
    onError: () => {}
  });
  queue.add("a");
  await flush();
  assert.deepEqual(calls, ["a"]);
  assert.deepEqual(timers.map((timer) => timer.ms), [1_000]);
  now = 1_999;
  timers[0]!.callback();
  await flush();
  assert.deepEqual(calls, ["a"]);
  assert.deepEqual(timers.map((timer) => timer.ms), [1_000, 1]);
  assert.equal(queue.size(), 1);
  now = 2_000;
  timers[1]!.callback();
  await flush();
  assert.deepEqual(calls, ["a", "a"]);
  assert.equal(queue.size(), 0);
});

test("a run that throws synchronously is reported and the queue goes on", async () => {
  const errors: Array<[string, string]> = [];
  const ran: string[] = [];
  const queue = createWorkQueue({
    concurrency: 1,
    run: (id) => {
      ran.push(id);
      if (id === "bad") throw new Error("sync boom");
      return Promise.resolve(null);
    },
    onError: (error, id) => { errors.push([id, (error as Error).message]); }
  });
  queue.add("bad");
  queue.add("good");
  await flush();
  assert.deepEqual(errors, [["bad", "sync boom"]]);
  assert.deepEqual(ran, ["bad", "good"]);
  assert.equal(queue.size(), 0);
});
