import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoverWorker } from "./worker.js";

function gated() {
  const started: string[] = [];
  const gates = new Map<string, () => void>();
  let inFlight = 0;
  let peak = 0;
  const processBook = async (id: string) => {
    started.push(id);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise<void>((resolve) => gates.set(id, resolve));
    inFlight--;
  };
  const release = (id: string) => gates.get(id)!();
  return { started, processBook, release, peak: () => peak };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("three slow books overlap and a fourth waits for a free slot", async () => {
  const { started, processBook, release, peak } = gated();
  const worker = createCoverWorker(processBook, () => {});
  for (const id of ["a", "b", "c", "d"]) worker.enqueue(id);
  await tick();
  assert.deepEqual(started, ["a", "b", "c"]);
  release("b");
  await tick();
  assert.deepEqual(started, ["a", "b", "c", "d"]);
  for (const id of ["a", "c", "d"]) release(id);
  await worker.idle();
  assert.equal(peak(), 3);
});

test("a front entry jumps the queue and duplicates are dropped", async () => {
  const { started, processBook, release } = gated();
  const worker = createCoverWorker(processBook, () => {});
  for (const id of ["a", "b", "c", "d", "e", "d"]) worker.enqueue(id);
  worker.enqueue("e", true);
  await tick();
  release("a");
  await tick();
  assert.deepEqual(started, ["a", "b", "c", "e"]);
  for (const id of ["b", "c", "e"]) release(id);
  await tick();
  release("d");
  await worker.idle();
  assert.deepEqual(started, ["a", "b", "c", "e", "d"]);
});

test("a book that is being processed is never started again concurrently", async () => {
  const { started, processBook, release } = gated();
  const worker = createCoverWorker(processBook, () => {});
  worker.enqueue("a");
  await tick();
  worker.enqueue("a");
  worker.enqueue("b");
  await tick();
  assert.deepEqual(started, ["a", "b"]);
  release("a");
  release("b");
  await worker.idle();
  assert.deepEqual(started, ["a", "b"]);
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
  worker.enqueue("x", true);
  release();
  await worker.idle();
  assert.equal(runs, 2);
});

test("stop halts queued work while running books finish", async () => {
  const { started, processBook, release } = gated();
  const worker = createCoverWorker(processBook, () => {});
  for (const id of ["a", "b", "c", "d"]) worker.enqueue(id);
  await tick();
  worker.stop();
  release("a");
  release("b");
  release("c");
  await worker.idle();
  worker.enqueue("e");
  assert.deepEqual(started, ["a", "b", "c"]);
});

test("stop clears the queue and ignores new work", async () => {
  const seen: string[] = [];
  const worker = createCoverWorker(async (id) => { seen.push(id); }, () => {});
  worker.stop();
  worker.enqueue("a");
  await worker.idle();
  assert.deepEqual(seen, []);
});
