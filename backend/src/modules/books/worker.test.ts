import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoverWorker } from "./worker.js";

test("books are processed in order, a front entry jumps the queue, and duplicates are dropped", async () => {
  const seen: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const worker = createCoverWorker(async (id) => {
    if (id === "a") await gate;
    seen.push(id);
  }, () => {});
  worker.enqueue("a");
  worker.enqueue("b");
  worker.enqueue("c");
  worker.enqueue("b");
  worker.enqueue("c", true);
  release();
  await worker.idle();
  assert.deepEqual(seen, ["a", "c", "b"]);
});

test("enqueueing a queued book does not duplicate it", async () => {
  const seen: string[] = [];
  const worker = createCoverWorker(async (id) => { seen.push(id); }, () => {});
  for (let i = 0; i < 5; i++) worker.enqueue("same");
  await worker.idle();
  assert.deepEqual(seen, ["same"]);
});

test("an error in one book is reported and the queue keeps draining", async () => {
  const seen: string[] = [];
  const errors: Array<[unknown, string]> = [];
  const worker = createCoverWorker(async (id) => {
    if (id === "bad") throw new Error("disk full");
    seen.push(id);
  }, (error, id) => errors.push([error, id]));
  worker.enqueue("bad");
  worker.enqueue("good");
  await worker.idle();
  assert.deepEqual(seen, ["good"]);
  assert.equal(errors[0]![1], "bad");
});

test("a book re-enqueued while it is being processed runs once more afterwards", async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const worker = createCoverWorker(async () => {
    runs++;
    if (runs === 1) await gate;
  }, () => {});
  worker.enqueue("x");
  worker.enqueue("x", true);
  release();
  await worker.idle();
  assert.equal(runs, 2);
});

test("stop clears the queue and ignores new work", async () => {
  const seen: string[] = [];
  const worker = createCoverWorker(async (id) => { seen.push(id); }, () => {});
  worker.stop();
  worker.enqueue("a");
  await worker.idle();
  assert.deepEqual(seen, []);
});
