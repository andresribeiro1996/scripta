import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoverWorker, type CoverPriority } from "./worker.js";

function gated() {
  const started: string[] = [];
  const lanes = new Map<string, CoverPriority>();
  const gates = new Map<string, () => void>();
  let inFlight = 0;
  let peak = 0;
  const processBook = async (id: string, lane: CoverPriority) => {
    started.push(id);
    lanes.set(id, lane);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise<void>((resolve) => gates.set(id, resolve));
    inFlight--;
  };
  const release = (id: string) => gates.get(id)!();
  return { started, lanes, processBook, release, peak: () => peak };
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
  worker.enqueue("e", "front");
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
  worker.enqueue("x", "front");
  worker.enqueue("x", "front");
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

async function holdSlots(worker: ReturnType<typeof createCoverWorker>, gate: ReturnType<typeof gated>) {
  for (const id of ["h1", "h2", "h3"]) worker.enqueue(id);
  await tick();
  assert.deepEqual(gate.started, ["h1", "h2", "h3"]);
}

async function drainAll(worker: ReturnType<typeof createCoverWorker>, gate: ReturnType<typeof gated>) {
  let seen = 0;
  while (seen < gate.started.length || seen === 0) {
    seen = gate.started.length;
    for (const id of gate.started) gate.release(id);
    await tick();
  }
  await worker.idle();
}

test("background books run only after normal books queued before or while they wait", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("bg1", "background");
  worker.enqueue("n1");
  worker.enqueue("bg2", "background");
  worker.enqueue("n2");
  gate.release("h1");
  await tick();
  gate.release("h2");
  await tick();
  gate.release("h3");
  await tick();
  assert.deepEqual(gate.started.slice(3), ["n1", "n2", "bg1"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(3), ["n1", "n2", "bg1", "bg2"]);
});

test("a normal book enqueued after five background books runs before the rest of them", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  for (let i = 1; i <= 5; i++) worker.enqueue(`bg${i}`, "background");
  worker.enqueue("n1");
  gate.release("h1");
  await tick();
  assert.deepEqual(gate.started.slice(3), ["n1"]);
  gate.release("h2");
  await tick();
  assert.deepEqual(gate.started.slice(3), ["n1", "bg1"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(3), ["n1", "bg1", "bg2", "bg3", "bg4", "bg5"]);
});

test("a background-queued book enqueued at the front runs next", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  for (let i = 1; i <= 3; i++) worker.enqueue(`bg${i}`, "background");
  worker.enqueue("n1");
  worker.enqueue("bg3", "front");
  gate.release("h1");
  await tick();
  assert.deepEqual(gate.started.slice(3), ["bg3"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(3), ["bg3", "n1", "bg1", "bg2"]);
});

test("a background-queued book enqueued as normal moves to the back of the normal queue", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("bg1", "background");
  worker.enqueue("n1");
  worker.enqueue("bg1");
  gate.release("h1");
  await tick();
  gate.release("h2");
  await tick();
  assert.deepEqual(gate.started.slice(3), ["n1", "bg1"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(3), ["n1", "bg1"]);
});

test("the same id enqueued twice as background runs once", async () => {
  const seen: string[] = [];
  const worker = createCoverWorker(async (id) => { seen.push(id); }, () => {});
  worker.enqueue("same", "background");
  worker.enqueue("same", "background");
  await worker.idle();
  assert.deepEqual(seen, ["same"]);
});

test("background is a no-op for a book already queued normally or being processed", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("n1");
  worker.enqueue("n1", "background");
  worker.enqueue("h1", "background");
  gate.release("h1");
  await tick();
  assert.deepEqual(gate.started.slice(3), ["n1"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(3), ["n1"]);
});

test("stop drops background books", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("bg1", "background");
  worker.stop();
  for (const id of ["h1", "h2", "h3"]) gate.release(id);
  await worker.idle();
  assert.deepEqual(gate.started, ["h1", "h2", "h3"]);
});

test("a promoted background book runs once, not again when its stale background entry comes up", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  for (let i = 1; i <= 3; i++) worker.enqueue(`bg${i}`, "background");
  worker.enqueue("bg2");
  worker.enqueue("bg3", "front");
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(3).sort(), ["bg1", "bg2", "bg3"]);
  assert.equal(gate.started.filter((id) => id === "bg2").length, 1);
  assert.equal(gate.started.filter((id) => id === "bg3").length, 1);
});

test("at most one background book runs at a time and all of them complete", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  for (let i = 1; i <= 5; i++) worker.enqueue(`bg${i}`, "background");
  await tick();
  assert.deepEqual(gate.started, ["bg1"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started, ["bg1", "bg2", "bg3", "bg4", "bg5"]);
  assert.equal(gate.peak(), 1);
});

test("normal books still use all three slots while a background book runs", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  worker.enqueue("bg1", "background");
  worker.enqueue("bg2", "background");
  await tick();
  for (const id of ["n1", "n2", "n3"]) worker.enqueue(id);
  await tick();
  assert.deepEqual(gate.started, ["bg1", "n1", "n2"]);
  gate.release("n1");
  await tick();
  assert.deepEqual(gate.started, ["bg1", "n1", "n2", "n3"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(4), ["bg2"]);
});

test("upgrade books run before background books queued earlier", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("bg1", "background");
  worker.enqueue("up1", "upgrade");
  worker.enqueue("bg2", "background");
  worker.enqueue("up2", "upgrade");
  for (const id of ["h1", "h2", "h3"]) gate.release(id);
  await tick();
  assert.deepEqual(gate.started.slice(3), ["up1"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(3), ["up1", "up2", "bg1", "bg2"]);
});

test("upgrade and background together never exceed one running book", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  worker.enqueue("bg1", "background");
  worker.enqueue("up1", "upgrade");
  worker.enqueue("bg2", "background");
  worker.enqueue("up2", "upgrade");
  await tick();
  assert.deepEqual(gate.started, ["bg1"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started, ["bg1", "up1", "up2", "bg2"]);
  assert.equal(gate.peak(), 1);
});

test("normal books still use all three slots while an upgrade runs", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  worker.enqueue("up1", "upgrade");
  worker.enqueue("up2", "upgrade");
  await tick();
  for (const id of ["n1", "n2", "n3"]) worker.enqueue(id);
  await tick();
  assert.deepEqual(gate.started, ["up1", "n1", "n2"]);
  gate.release("n1");
  await tick();
  assert.deepEqual(gate.started, ["up1", "n1", "n2", "n3"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(4), ["up2"]);
});

test("a normal request for a book queued as upgrade leaves it there and runs it once", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("up1", "upgrade");
  worker.enqueue("n1");
  worker.enqueue("up1");
  gate.release("h1");
  await tick();
  assert.deepEqual(gate.started.slice(3), ["n1"]);
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(3), ["n1", "up1"]);
  assert.equal(gate.lanes.get("up1"), "upgrade");
});

test("a front request for a book queued as upgrade promotes it and it runs once", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("up1", "upgrade");
  worker.enqueue("up2", "upgrade");
  worker.enqueue("n1");
  worker.enqueue("up2", "front");
  gate.release("h1");
  await tick();
  assert.deepEqual(gate.started.slice(3), ["up2"]);
  assert.equal(gate.lanes.get("up2"), "front");
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(3), ["up2", "n1", "up1"]);
  assert.equal(gate.lanes.get("up1"), "upgrade");
});

test("upgrade is a no-op for a book already queued fast, queued as background or active", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("n1");
  worker.enqueue("bg1", "background");
  worker.enqueue("n1", "upgrade");
  worker.enqueue("h1", "upgrade");
  worker.enqueue("bg1", "upgrade");
  await drainAll(worker, gate);
  assert.deepEqual(gate.started.slice(3), ["n1", "bg1"]);
  assert.equal(gate.lanes.get("bg1"), "background");
});

test("processBook receives the lane each book was taken from", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("n1");
  worker.enqueue("f1", "front");
  worker.enqueue("up1", "upgrade");
  worker.enqueue("bg1", "background");
  worker.enqueue("bg2", "background");
  worker.enqueue("bg2");
  await drainAll(worker, gate);
  assert.equal(gate.lanes.get("h1"), "normal");
  assert.equal(gate.lanes.get("n1"), "normal");
  assert.equal(gate.lanes.get("f1"), "front");
  assert.equal(gate.lanes.get("up1"), "upgrade");
  assert.equal(gate.lanes.get("bg1"), "background");
  assert.equal(gate.lanes.get("bg2"), "normal");
});

test("a normal book promoted to front is passed the front lane, and a requeued one too", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("n1");
  worker.enqueue("n1", "front");
  worker.enqueue("h1", "front");
  gate.release("h1");
  await tick();
  assert.deepEqual(gate.started.slice(3), ["h1"]);
  assert.equal(gate.lanes.get("h1"), "front");
  gate.release("h2");
  await tick();
  assert.deepEqual(gate.started.slice(3), ["h1", "n1"]);
  assert.equal(gate.lanes.get("n1"), "front");
  await drainAll(worker, gate);
});

test("stop drops upgrade books", async () => {
  const gate = gated();
  const worker = createCoverWorker(gate.processBook, () => {});
  await holdSlots(worker, gate);
  worker.enqueue("up1", "upgrade");
  worker.stop();
  for (const id of ["h1", "h2", "h3"]) gate.release(id);
  await worker.idle();
  assert.deepEqual(gate.started, ["h1", "h2", "h3"]);
});
