import assert from "node:assert/strict";
import { test } from "node:test";
import { SourcePausedError, SourceUnavailableError } from "../../domain/errors.js";
import { createIsbndbGate, type IsbndbPause } from "./isbndbGate.js";

const NOON = Date.parse("2026-10-01T12:00:00.000Z");
const MIDNIGHT = Date.parse("2026-10-02T00:00:00.000Z");

function harness() {
  let clock = NOON;
  const pauses: IsbndbPause[] = [];
  const gate = createIsbndbGate({ now: () => clock, onPause: (pause) => pauses.push(pause) });
  const fail = (detail: string, options: ConstructorParameters<typeof SourceUnavailableError>[2]) => async (): Promise<string> => {
    throw new SourceUnavailableError("isbndb", detail, options);
  };
  return { gate, pauses, fail, advance: (ms: number) => { clock += ms; }, set: (at: number) => { clock = at; } };
}

test("a daily quota 429 pauses until the next UTC midnight and the call that hit it throws paused", async () => {
  const h = harness();
  await assert.rejects(h.gate.run(h.fail("HTTP 429 Daily quota exceeded", { status: 429 })), (error: unknown) => error instanceof SourcePausedError && error.retryAt === MIDNIGHT);
  assert.deepEqual(h.pauses, [{ reason: "quota", until: MIDNIGHT }]);
});

test("a quota reset on the stroke of midnight waits for the following one", async () => {
  const h = harness();
  h.set(MIDNIGHT);
  await assert.rejects(h.gate.run(h.fail("Daily quota exceeded", { status: 429 })), SourcePausedError);
  assert.equal(h.pauses[0]!.until, MIDNIGHT + 24 * 60 * 60 * 1000);
});

test("a 429 that names its reset pauses until then", async () => {
  const h = harness();
  const until = NOON + 3_600_000;
  await assert.rejects(h.gate.run(h.fail("HTTP 429", { status: 429, retryAt: until })), SourcePausedError);
  assert.deepEqual(h.pauses, [{ reason: "quota", until }]);
});

test("a 429 with remaining=0 pauses until midnight", async () => {
  const h = harness();
  await assert.rejects(h.gate.run(h.fail("HTTP 429", { status: 429, quota: true })), SourcePausedError);
  assert.deepEqual(h.pauses, [{ reason: "quota", until: MIDNIGHT }]);
});

test("a bare 429 is a per-second limit: no pause, rethrown as is", async () => {
  const h = harness();
  const bare = new SourceUnavailableError("isbndb", "HTTP 429", { status: 429 });
  await assert.rejects(h.gate.run(async () => { throw bare; }), (error: unknown) => error === bare);
  assert.deepEqual(h.pauses, []);
  assert.equal(await h.gate.run(async () => "ok"), "ok");
});

test("a rejected key pauses until midnight with reason key", async () => {
  for (const status of [401, 403]) {
    const h = harness();
    await assert.rejects(h.gate.run(h.fail(`HTTP ${status}`, { status })), SourcePausedError);
    assert.deepEqual(h.pauses, [{ reason: "key", until: MIDNIGHT }]);
  }
});

test("a burst of failures starts one pause", async () => {
  const h = harness();
  const burst = await Promise.allSettled([
    h.gate.run(h.fail("Daily quota exceeded", { status: 429 })),
    h.gate.run(h.fail("Daily quota exceeded", { status: 429 })),
    h.gate.run(h.fail("HTTP 403", { status: 403 }))
  ]);
  assert.ok(burst.every((result) => result.status === "rejected" && result.reason instanceof SourcePausedError));
  assert.equal(h.pauses.length, 1);
});

test("while paused the call is not made, and after the pause it is", async () => {
  const h = harness();
  await assert.rejects(h.gate.run(h.fail("Daily quota exceeded", { status: 429 })), SourcePausedError);
  let calls = 0;
  const call = async () => { calls += 1; return "ok"; };
  await assert.rejects(h.gate.run(call), (error: unknown) => error instanceof SourcePausedError && error.retryAt === MIDNIGHT);
  assert.equal(calls, 0);
  h.set(MIDNIGHT);
  assert.equal(await h.gate.run(call), "ok");
  assert.equal(calls, 1);
});

test("a server error does not pause", async () => {
  const h = harness();
  const error = new SourceUnavailableError("isbndb", "HTTP 503", { status: 503 });
  await assert.rejects(h.gate.run(async () => { throw error; }), (caught: unknown) => caught === error);
  assert.deepEqual(h.pauses, []);
});

test("an error that is not a source failure propagates", async () => {
  const h = harness();
  await assert.rejects(h.gate.run(async () => { throw new RangeError("bug"); }), RangeError);
  assert.deepEqual(h.pauses, []);
});
