import assert from "node:assert/strict";
import { mock, test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { STALL_MS, checkEventLoop, registerStallLog, timeStep, timeSync, timedMethods } from "./stallLog.js";

type LogLine = { level: number; msg: string; reqId?: string; method?: string; route?: string; blockedMs?: number; maxMs?: number };

function busyWait(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end);
}

function build(t: TestContext) {
  const lines: LogLine[] = [];
  const app = Fastify({
    logger: {
      level: "warn",
      stream: {
        write: (line: string) => {
          lines.push(JSON.parse(line));
        }
      }
    }
  });
  registerStallLog(app);
  t.after(() => app.close());
  return { app, lines, stalls: () => lines.filter((line) => line.msg === "handler blocked the event loop") };
}

test("a handler that computes for longer than STALL_MS is logged with its request id, method, route and time", async (t) => {
  const { app, stalls } = build(t);
  app.get("/slow", () => {
    busyWait(250);
    return { ok: true };
  });

  const res = await app.inject("/slow");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(stalls().length, 1);
  const [line] = stalls();
  assert.ok(line);
  assert.equal(line.level, 40);
  assert.ok(line.reqId);
  assert.equal(line.method, "GET");
  assert.equal(line.route, "/slow");
  assert.ok(line.blockedMs !== undefined && line.blockedMs >= STALL_MS);
  assert.equal(line.blockedMs, Math.round(line.blockedMs));
});

test("a fast handler logs nothing", async (t) => {
  const { app, stalls } = build(t);
  app.get("/fast", () => ({ ok: true }));

  const res = await app.inject("/fast");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(stalls(), []);
});

test("an async handler that only waits logs nothing", async (t) => {
  const { app, stalls } = build(t);
  app.get("/waits", async () => {
    await sleep(300);
    return { ok: true };
  });

  const res = await app.inject("/waits");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.deepEqual(stalls(), []);
});

test("an async handler that computes before its first await is logged and still resolves", async (t) => {
  const { app, stalls } = build(t);
  app.get("/async-slow", async () => {
    busyWait(250);
    await sleep(0);
    return { ok: true };
  });

  const res = await app.inject("/async-slow");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.deepEqual(stalls().map((line) => line.route), ["/async-slow"]);
});

test("a throwing handler still answers 500, and a slow one still logs", async (t) => {
  const { app, stalls } = build(t);
  app.get("/boom", () => {
    throw new Error("boom");
  });
  app.get("/rejects", async () => {
    throw new Error("boom");
  });
  app.get("/boom-slow", () => {
    busyWait(250);
    throw new Error("boom");
  });

  assert.equal((await app.inject("/boom")).statusCode, 500);
  assert.equal((await app.inject("/rejects")).statusCode, 500);
  assert.deepEqual(stalls(), []);
  assert.equal((await app.inject("/boom-slow")).statusCode, 500);
  assert.deepEqual(stalls().map((line) => line.route), ["/boom-slow"]);
});

test("routes added inside a plugin are wrapped under their full path and keep their instance as this", async (t) => {
  const { app, stalls } = build(t);
  let child: unknown;
  let seen: unknown;
  app.register(
    async (instance) => {
      child = instance;
      instance.get("/slow", function () {
        seen = this;
        busyWait(250);
        return { ok: true };
      });
    },
    { prefix: "/mod" }
  );

  const res = await app.inject("/mod/slow");

  assert.equal(res.statusCode, 200);
  assert.equal(seen, child);
  assert.deepEqual(stalls().map((line) => line.route), ["/mod/slow"]);
});

test("a plugin route at its prefix root logs one route name for both of its paths", async (t) => {
  const { app, stalls } = build(t);
  app.register(
    async (instance) => {
      instance.get("/", () => {
        busyWait(250);
        return { ok: true };
      });
    },
    { prefix: "/mod" }
  );

  await app.inject("/mod");
  await app.inject("/mod/");

  assert.deepEqual(stalls().map((line) => line.route), ["/mod", "/mod"]);
});

test("the logged route is the route pattern, not the requested URL with its parameters and query", async (t) => {
  const { app, stalls } = build(t);
  app.get("/items/:id", () => {
    busyWait(250);
    return { ok: true };
  });

  const res = await app.inject("/items/42?code=secret");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(stalls().map((line) => line.route), ["/items/:id"]);
});

test("checkEventLoop logs a max delay over STALL_MS once, in milliseconds, and resets the histogram", () => {
  const histogram = { max: 250.4e6, reset: mock.fn() };
  const warn = mock.fn();

  checkEventLoop(histogram, { warn });

  assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [[{ maxMs: 250 }, "event loop stalled"]]);
  assert.equal(histogram.reset.mock.callCount(), 1);
});

test("checkEventLoop logs nothing at or under STALL_MS but still resets the histogram", () => {
  for (const max of [20e6, STALL_MS * 1e6]) {
    const histogram = { max, reset: mock.fn() };
    const warn = mock.fn();

    checkEventLoop(histogram, { warn });

    assert.equal(warn.mock.callCount(), 0);
    assert.equal(histogram.reset.mock.callCount(), 1);
  }
});

test("registerStallLog checks the real event loop every 10 s until the app closes", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { app, lines } = build(t);
  await sleep(100);
  busyWait(250);
  await sleep(50);

  t.mock.timers.tick(9_999);
  assert.equal(lines.length, 0);
  t.mock.timers.tick(1);
  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.ok(line);
  assert.equal(line.level, 40);
  assert.equal(line.msg, "event loop stalled");
  assert.ok(line.maxMs !== undefined && line.maxMs >= STALL_MS);

  await sleep(100);
  busyWait(250);
  await sleep(50);
  await app.close();
  t.mock.timers.tick(10_000);
  assert.equal(lines.length, 1);
});

test("registerStallLog's interval does not keep the process alive", (t) => {
  const setIntervalSpy = t.mock.method(globalThis, "setInterval");

  build(t);

  assert.equal((setIntervalSpy.mock.calls[0]?.result as NodeJS.Timeout).hasRef(), false);
});

test("timeSync returns the function's result and logs nothing when it is fast", () => {
  const warn = mock.fn();

  assert.equal(timeSync({ warn }, "fast-job", () => 42), 42);

  assert.equal(warn.mock.callCount(), 0);
});

test("timeSync logs a slow job by name, in whole milliseconds", () => {
  const warn = mock.fn();

  timeSync({ warn }, "slow-job", () => busyWait(250));

  assert.equal(warn.mock.callCount(), 1);
  const [details, message] = warn.mock.calls[0]!.arguments as [{ job: string; blockedMs: number }, string];
  assert.equal(message, "job blocked the event loop");
  assert.equal(details.job, "slow-job");
  assert.ok(details.blockedMs >= STALL_MS);
  assert.equal(details.blockedMs, Math.round(details.blockedMs));
});

test("timeSync rethrows the very error the function threw, and still logs a slow one", () => {
  const warn = mock.fn();
  const boom = new Error("boom");

  assert.throws(() => timeSync({ warn }, "boom-job", () => { busyWait(250); throw boom; }), (error) => error === boom);

  assert.equal(warn.mock.callCount(), 1);
});

test("timeStep logs a fast startup step at info with its duration", () => {
  const info = mock.fn();
  const warn = mock.fn();

  assert.equal(timeStep({ info, warn }, "startup:fast", () => "done"), "done");

  assert.equal(warn.mock.callCount(), 0);
  const [details, message] = info.mock.calls[0]!.arguments as [{ step: string; ms: number }, string];
  assert.equal(message, "startup step");
  assert.equal(details.step, "startup:fast");
  assert.equal(details.ms, Math.round(details.ms));
});

test("timeStep logs a slow startup step as a blocked job instead", () => {
  const info = mock.fn();
  const warn = mock.fn();

  timeStep({ info, warn }, "startup:slow", () => busyWait(250));

  assert.equal(info.mock.callCount(), 0);
  const [details, message] = warn.mock.calls[0]!.arguments as [{ job: string; blockedMs: number }, string];
  assert.equal(message, "job blocked the event loop");
  assert.equal(details.job, "startup:slow");
  assert.ok(details.blockedMs >= STALL_MS);
});

test("timedMethods times each method under prefix:name and keeps results, errors and plain values", () => {
  const warn = mock.fn();
  const nope = new Error("nope");
  const target = {
    size: 3,
    fast: (n: number) => n + 1,
    slow: () => { busyWait(250); return "done"; },
    fail: (): never => { throw nope; }
  };

  const timed = timedMethods(target, { warn }, "books");

  assert.equal(timed.size, 3);
  assert.equal(timed.fast(1), 2);
  assert.equal(timed.slow(), "done");
  assert.throws(() => timed.fail(), (error) => error === nope);
  assert.deepEqual(warn.mock.calls.map((call) => (call.arguments[0] as { job: string }).job), ["books:slow"]);
});
