import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "books-jev-jobs-test-"));
process.env.AUTH_DB_PATH = join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { SourceUnavailableError, UnusableAnswerError } = await import("./domain/errors.js");
const { TypesafeBudgetSpentError } = await import("./typesafe.js");
const { heldCanonical, jevCostUsd, jevPause, runJevBacklog, startJevJobs } = await import("./jevJobs.js");

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const flush = async () => {
  for (let tick = 0; tick < 10; tick++) await new Promise(setImmediate);
};
const fakeRepo = (aliases: Record<string, string> = {}) => ({
  canonicalWorkIds: (ids: string[]) => new Map(ids.map((id) => [id, aliases[id] ?? id] as const))
});
const outage = () => new SourceUnavailableError("typesafe", "HTTP 529", { status: 529 });
const keyError = () => new SourceUnavailableError("typesafe", "HTTP 401", { status: 401 });
const spent = () => new TypesafeBudgetSpentError("test");
const KEY_ALERT = { subject: "rejected", text: "check the key" };

function pauseDeps(alerts: string[] = [], pauses: Array<[string, number]> = []) {
  return { now: () => NOW, alert: (subject: string) => { alerts.push(subject); }, onPause: (kind: string, until: number) => { pauses.push([kind, until]); } };
}

function jobsDeps(overrides: Record<string, unknown> = {}) {
  return { repo: fakeRepo(), heldWorkIds: () => [] as string[], now: () => NOW, alert: () => {}, info: () => {}, onError: (error: unknown) => { throw error; }, ...overrides };
}

test("jevPause strikes a book failure and an unusable answer, keeping the answer's detail as the reason, and returns null", () => {
  const strikes: unknown[] = [];
  const strike = (value: unknown) => { strikes.push(value); };
  assert.equal(jevPause(new SourceUnavailableError("typesafe", "HTTP 400", { status: 400 }), pauseDeps(), KEY_ALERT, strike), null);
  assert.equal(jevPause(new UnusableAnswerError("typesafe", "unexpected answer"), pauseDeps(), KEY_ALERT, strike), null);
  assert.deepEqual(strikes, [{ status: 400, reason: "HTTP 400" }, { status: null, reason: "unexpected answer" }]);
});

test("jevPause pauses an outage 10 minutes, a spent budget until UTC midnight, and a rejected key 24 hours with one alert", () => {
  const alerts: string[] = [];
  const strike = () => { throw new Error("struck"); };
  assert.equal(jevPause(outage(), pauseDeps(alerts), KEY_ALERT, strike), NOW + 10 * 60 * 1000);
  assert.equal(jevPause(spent(), pauseDeps(alerts), KEY_ALERT, strike), Date.parse("2026-10-16T00:00:00.000Z"));
  assert.deepEqual(alerts, []);
  assert.equal(jevPause(keyError(), pauseDeps(alerts), KEY_ALERT, strike), NOW + 24 * 60 * 60 * 1000);
  assert.deepEqual(alerts, ["rejected"]);
});

test("jevPause tells onPause the kind and the resume time", () => {
  const pauses: Array<[string, number]> = [];
  const strike = () => { throw new Error("struck"); };
  jevPause(outage(), pauseDeps([], pauses), KEY_ALERT, strike);
  jevPause(spent(), pauseDeps([], pauses), KEY_ALERT, strike);
  jevPause(keyError(), pauseDeps([], pauses), KEY_ALERT, strike);
  assert.deepEqual(pauses, [
    ["outage", NOW + 10 * 60 * 1000],
    ["budget", Date.parse("2026-10-16T00:00:00.000Z")],
    ["key", NOW + 24 * 60 * 60 * 1000]
  ]);
});

test("jevPause rethrows an error that isn't a TypeSafe failure", () => {
  assert.throws(() => jevPause(new TypeError("bug"), pauseDeps(), KEY_ALERT, () => {}), TypeError);
});

test("held() returns the canonical ids of the held works, aliases included", async () => {
  const repo = fakeRepo({ alias: "canon" });
  assert.deepEqual([...heldCanonical(repo, ["alias", "other"])].sort(), ["canon", "other"]);
  let seen: string[] = [];
  const jobs = startJevJobs(jobsDeps({ repo, heldWorkIds: () => ["alias", "other"] }), {
    source: "t",
    budgetMessage: "m",
    sweep: () => [],
    judge: async (_workId, held) => { seen = [...held()].sort(); return null; }
  });
  jobs.add("w");
  await flush();
  jobs.stop();
  assert.deepEqual(seen, ["canon", "other"]);
});

test("four workers hitting a rejected key at once send one alert", async () => {
  const alerts: string[] = [];
  const jobs = startJevJobs(jobsDeps({ alert: (subject: string) => { alerts.push(subject); } }), {
    source: "t",
    budgetMessage: "m",
    sweep: () => [],
    judge: async (_workId, _held, pause) => jevPause(keyError(), pause, KEY_ALERT, () => {})
  });
  for (const id of ["a", "b", "c", "d"]) jobs.add(id);
  await flush();
  jobs.stop();
  assert.deepEqual(alerts, ["rejected"]);
});

test("a spent budget is logged once at info level with its source, and alerts nobody, however many workers hit it", async () => {
  const alerts: string[] = [];
  const infos: Array<{ details: object; message: string }> = [];
  const jobs = startJevJobs(jobsDeps({ alert: (subject: string) => { alerts.push(subject); }, info: (details: object, message: string) => { infos.push({ details, message }); } }), {
    source: "genres",
    budgetMessage: "paused until the budget resets",
    sweep: () => [],
    judge: async (_workId, _held, pause) => jevPause(spent(), pause, KEY_ALERT, () => {})
  });
  for (const id of ["a", "b", "c", "d"]) jobs.add(id);
  await flush();
  jobs.stop();
  assert.equal(infos.length, 1);
  assert.deepEqual(infos[0], { details: { source: "genres", until: "2026-10-16T00:00:00.000Z" }, message: "paused until the budget resets" });
  assert.deepEqual(alerts, []);
});

test("the held set is read once a minute, however many works are judged, and a newly held work is judged after it refreshes", async () => {
  const held: string[] = [];
  let clock = NOW;
  let reads = 0;
  const judged: string[] = [];
  const jobs = startJevJobs(jobsDeps({ heldWorkIds: () => { reads += 1; return held; }, now: () => clock }), {
    source: "t",
    budgetMessage: "m",
    sweep: () => [],
    judge: async (workId, heldNow) => { if (heldNow().has(workId)) judged.push(workId); return null; }
  });
  await flush();
  assert.equal(reads, 1);
  clock += 60 * 1000;
  reads = 0;
  jobs.add("one");
  jobs.add("two");
  await flush();
  assert.equal(reads, 1);
  held.push("became");
  jobs.add("became");
  await flush();
  assert.equal(reads, 1);
  assert.deepEqual(judged, []);
  clock += 60 * 1000;
  jobs.add("became");
  await flush();
  jobs.stop();
  assert.equal(reads, 2);
  assert.deepEqual(judged, ["became"]);
});

function fakeTimers() {
  const intervals: Array<{ callback: () => void; delay: number }> = [];
  const timeouts: Array<{ callback: () => void; delay: number }> = [];
  const cleared: unknown[] = [];
  const timers = {
    setInterval: (callback: () => void, delay: number) => {
      const timer = { unref() { return timer; } };
      intervals.push({ callback, delay });
      return timer as unknown as NodeJS.Timeout;
    },
    clearInterval: (timer: NodeJS.Timeout) => { cleared.push(timer); },
    setTimeout: (callback: () => void, delay: number) => {
      const timer = { unref() { return timer; } };
      timeouts.push({ callback, delay });
      return timer as unknown as NodeJS.Timeout;
    },
    clearTimeout: (timer: NodeJS.Timeout) => { cleared.push(timer); }
  };
  return { timers, intervals, timeouts, cleared };
}

test("the sweep runs at boot and again after 24 hours, queueing what it returns", async () => {
  const { timers, intervals, cleared } = fakeTimers();
  const pending = ["first"];
  const judged: string[] = [];
  const swept: string[][] = [];
  const jobs = startJevJobs(jobsDeps({ timers, heldWorkIds: () => ["h"] }), {
    source: "t",
    budgetMessage: "m",
    sweep: (heldIds) => { swept.push(heldIds); return pending.splice(0); },
    judge: async (workId) => { judged.push(workId); return null; }
  });
  await flush();
  assert.deepEqual(judged, ["first"]);
  assert.deepEqual(swept, [["h"]]);
  assert.deepEqual(intervals.map((tick) => tick.delay), [24 * 60 * 60 * 1000]);
  pending.push("second");
  await flush();
  assert.deepEqual(judged, ["first"]);
  intervals[0]!.callback();
  await flush();
  assert.deepEqual(judged, ["first", "second"]);
  jobs.stop();
  assert.equal(cleared.length, 1);
});

test("the sweep waits for initialDelayMs before its first pass", async () => {
  const { timers, timeouts, cleared } = fakeTimers();
  const judged: string[] = [];
  const jobs = startJevJobs(jobsDeps({ timers, initialDelayMs: 60_000 }), {
    source: "t",
    budgetMessage: "m",
    sweep: () => ["early"],
    judge: async (workId) => { judged.push(workId); return null; }
  });
  await flush();
  assert.deepEqual(judged, []);
  assert.deepEqual(timeouts.map((tick) => tick.delay), [60_000]);
  timeouts[0]!.callback();
  await flush();
  assert.deepEqual(judged, ["early"]);
  jobs.stop();
  assert.equal(cleared.length, 2);
});

test("stop ends the sweep and drops queued works", async () => {
  const { timers, cleared } = fakeTimers();
  const judged: string[] = [];
  const jobs = startJevJobs(jobsDeps({ timers, initialDelayMs: 60_000 }), {
    source: "t",
    budgetMessage: "m",
    sweep: () => [],
    judge: async (workId) => { judged.push(workId); return null; }
  });
  for (const id of ["a", "b", "c", "d", "e", "f"]) jobs.add(id);
  jobs.stop();
  await flush();
  assert.deepEqual(judged, []);
  assert.equal(cleared.length, 2);
});

test("the backlog asks every item until the first pause and names its kind", async () => {
  const items = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const done = await runJevBacklog(items, async () => null);
  assert.deepEqual(done, { asked: items, stoppedBy: "done" });
  for (const kind of ["budget", "outage", "key"] as const) {
    const stopped = await runJevBacklog(items, async (item, onPause) => {
      if (item === "c") {
        onPause(kind, NOW);
        return NOW;
      }
      return null;
    });
    assert.equal(stopped.stoppedBy, kind);
    assert.ok(!stopped.asked.includes("c"));
  }
  const unrecorded = await runJevBacklog(items, async (item) => (item === "a" ? NOW : null));
  assert.equal(unrecorded.stoppedBy, "outage");
});

test("a backlog stop is attributed to the item whose call failed, not to a concurrent one", async () => {
  const releases: Array<() => void> = [];
  const gate = (index: number) => new Promise<void>((resolve) => { releases[index] = resolve; });
  const result = await Promise.all([
    runJevBacklog(["slow", "failing"], async (item, onPause) => {
      if (item === "slow") {
        onPause("budget", NOW);
        await gate(0);
        return null;
      }
      onPause("key", NOW);
      setImmediate(() => releases[0]!());
      return NOW;
    })
  ]);
  assert.equal(result[0].stoppedBy, "key");
});

test("jevCostUsd rounds to cents", () => {
  assert.equal(jevCostUsd(1000), 0.12);
  assert.equal(jevCostUsd(0), 0);
});
