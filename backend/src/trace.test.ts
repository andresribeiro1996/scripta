import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { test, type TestContext } from "node:test";
import { Readable } from "node:stream";
import { json } from "node:stream/consumers";
import { setTimeout as sleep } from "node:timers/promises";
import Fastify from "fastify";
import { currentTrace, registerTrace } from "./trace.js";

const dir = mkdtempSync(join(tmpdir(), "trace-"));
Object.assign(process.env, {
  JWT_ACCESS_SECRET: "a".repeat(64),
  JWT_REFRESH_SECRET: "b".repeat(64),
  AUTH_DB_PATH: join(dir, "auth.sqlite"),
  LIBRARY_DB_PATH: join(dir, "library.sqlite"),
  GALLERY_DB_PATH: join(dir, "gallery.sqlite"),
  COVERS_DB_PATH: join(dir, "covers.sqlite"),
  MURALS_DB_PATH: join(dir, "murals.sqlite"),
  SOCIALS_DB_PATH: join(dir, "socials.sqlite"),
  ARENA_DB_PATH: join(dir, "arena.sqlite"),
  TIERLISTS_DB_PATH: join(dir, "tierlists.sqlite"),
  QUIZZES_DB_PATH: join(dir, "quizzes.sqlite"),
  COMMUNITY_DB_PATH: join(dir, "community.sqlite"),
  WAITLIST_DB_PATH: join(dir, "waitlist.sqlite"),
  FILES_STORAGE_PATH: join(dir, "files"),
  R2_IMAGES_BUCKET: ""
});

const { buildApp } = await import("./app.js");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function build(t: TestContext) {
  const app = Fastify({ genReqId: () => randomUUID() });
  registerTrace(app);
  t.after(() => app.close());
  return app;
}

test("there is no trace outside a request, and a finished request leaves none behind", async (t) => {
  const app = build(t);
  app.get("/ping", () => ({ ok: true }));

  assert.equal(currentTrace(), undefined);
  await app.inject("/ping");

  assert.equal(currentTrace(), undefined);
});

test("a handler sees its request's id and route pattern, before and after an await", async (t) => {
  const app = build(t);
  app.get("/things/:id", async (request) => {
    const before = currentTrace();
    await sleep(5);
    return { requestId: request.id, before, after: currentTrace() };
  });

  const { requestId, before, after } = (await app.inject("/things/42")).json();

  assert.match(requestId, UUID);
  assert.deepEqual(before, { traceId: requestId, source: "GET /things/:id" });
  assert.deepEqual(after, before);
});

test("every stage of a request with a body runs inside its trace", async (t) => {
  const app = build(t);
  const seen: Record<string, boolean> = {};
  const record = (stage: string, requestId: string) => {
    seen[stage] = currentTrace()?.traceId === requestId;
  };
  app.addHook("onRequest", async (request) => record("onRequest", request.id));
  app.addHook("preParsing", async (request) => record("preParsing", request.id));
  app.addHook("preValidation", async (request) => record("preValidation", request.id));
  app.addHook("preHandler", async (request) => record("preHandler", request.id));
  app.addHook("preSerialization", async (request) => record("preSerialization", request.id));
  app.addHook("onSend", async (request) => record("onSend", request.id));
  app.addHook("onResponse", async (request) => record("onResponse", request.id));
  app.post("/things", async (request) => {
    record("handler", request.id);
    await sleep(5);
    record("after await", request.id);
    return { ok: true };
  });

  const res = await app.inject({ method: "POST", url: "/things", payload: { title: "Dune" } });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { onRequest: true, preParsing: true, preValidation: true, preHandler: true, handler: true, "after await": true, preSerialization: true, onSend: true, onResponse: true });
});

test("a body that arrives in pieces over a real socket does not lose the trace", async (t) => {
  const app = build(t);
  app.post("/things/:id", async (request) => {
    const before = currentTrace();
    await sleep(5);
    return { requestId: request.id, body: request.body, before, after: currentTrace() };
  });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const pieces = async function* () {
    for (const piece of ['{"title":', '"Dune",', '"author":"Herbert"}']) {
      yield piece;
      await sleep(20);
    }
  };

  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = httpRequest(`${address}/things/42`, { method: "POST", headers: { "content-type": "application/json" } }, resolve);
    req.on("error", reject);
    Readable.from(pieces()).pipe(req);
  });
  const { requestId, body: parsed, before, after } = (await json(response)) as { requestId: string; body: unknown; before: unknown; after: unknown };

  assert.deepEqual(parsed, { title: "Dune", author: "Herbert" });
  assert.deepEqual(before, { traceId: requestId, source: "POST /things/:id" });
  assert.deepEqual(after, before);
});

test("overlapping requests each see their own trace before and after they wait on each other", async (t) => {
  const app = build(t);
  let arrived = 0;
  let release!: () => void;
  const bothArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rendezvous = async () => {
    if (++arrived === 2) release();
    await bothArrived;
  };
  app.get("/a/:id", async (request) => {
    const before = currentTrace();
    await rendezvous();
    return { requestId: request.id, before, after: currentTrace() };
  });
  app.get("/b/:id", async (request) => {
    const before = currentTrace();
    await rendezvous();
    return { requestId: request.id, before, after: currentTrace() };
  });

  const [a, b] = (await Promise.all([app.inject("/a/1"), app.inject("/b/2")])).map((res) => res.json());

  assert.notEqual(a.requestId, b.requestId);
  assert.deepEqual(a.before, { traceId: a.requestId, source: "GET /a/:id" });
  assert.deepEqual(a.after, a.before);
  assert.deepEqual(b.before, { traceId: b.requestId, source: "GET /b/:id" });
  assert.deepEqual(b.after, b.before);
});

test("the route is the full pattern including a plugin's prefix, and an unmatched URL is recorded as requested", async (t) => {
  const app = build(t);
  app.register(
    async (scoped) => {
      scoped.get("/things/:id", () => ({ trace: currentTrace() }));
    },
    { prefix: "/api" }
  );
  app.setNotFoundHandler(() => ({ trace: currentTrace() }));

  assert.equal((await app.inject("/api/things/7")).json().trace.source, "GET /api/things/:id");
  assert.equal((await app.inject("/nowhere?x=1")).json().trace.source, "GET /nowhere?x=1");
});

test("the real app gives every request a UUID and runs its routes inside that trace", async (t) => {
  const app = buildApp();
  app.get("/probe/:id", (request) => ({ id: request.id, trace: currentTrace() }));
  t.after(() => app.close());

  const first = (await app.inject("/probe/1")).json();
  const second = (await app.inject("/probe/2")).json();

  assert.match(first.id, UUID);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.trace, { traceId: first.id, source: "GET /probe/:id" });
});
