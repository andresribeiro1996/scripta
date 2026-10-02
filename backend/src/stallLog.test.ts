import assert from "node:assert/strict";
import { mock, test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { STALL_MS, checkEventLoop, registerStallLog } from "./stallLog.js";

type LogLine = { level: number; msg: string; method?: string; route?: string; blockedMs?: number; maxMs?: number };

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

test("a handler that computes for longer than STALL_MS is logged with its method, route and time", async (t) => {
  const { app, lines } = build(t);
  app.get("/slow", () => {
    busyWait(250);
    return { ok: true };
  });

  const res = await app.inject("/slow");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.ok(line);
  assert.equal(line.level, 40);
  assert.equal(line.msg, "handler blocked the event loop");
  assert.equal(line.method, "GET");
  assert.equal(line.route, "/slow");
  assert.ok(line.blockedMs !== undefined && line.blockedMs >= STALL_MS);
  assert.equal(line.blockedMs, Math.round(line.blockedMs));
});

test("a fast handler logs nothing", async (t) => {
  const { app, lines } = build(t);
  app.get("/fast", () => ({ ok: true }));

  const res = await app.inject("/fast");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(lines, []);
});

test("an async handler that only waits logs nothing", async (t) => {
  const { app, lines } = build(t);
  app.get("/waits", async () => {
    await sleep(300);
    return { ok: true };
  });

  const res = await app.inject("/waits");

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.deepEqual(lines, []);
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
