import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";
import Fastify from "fastify";

const dir = mkdtempSync(join(tmpdir(), "works-format-"));
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

const { worksFormat } = await import("./worksFormat.js");
const { buildApp } = await import("./app.js");
const { WorkResolutionError } = await import("./modules/library/index.js");
const { env } = await import("./config/env.js");

function logged() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    }
  });
  const server = Fastify({ logger: { level: "info", stream } });
  server.get("/things/:id", async (request, reply) => ({ works: worksFormat(request, reply) }));
  return { server, lines };
}

test("a request with the header gets the works format and logs nothing", async () => {
  const { server, lines } = logged();
  const res = await server.inject({ url: "/things/1", headers: { "x-scripta-works": "1" } });
  assert.deepEqual(res.json(), { works: true });
  assert.equal(res.headers.vary, "X-Scripta-Works");
  assert.equal(lines.some((line) => line.msg === "legacy client"), false);
  await server.close();
});

test("a request without the header gets today's format and logs its method and route", async () => {
  const { server, lines } = logged();
  const res = await server.inject({ url: "/things/1" });
  assert.deepEqual(res.json(), { works: false });
  assert.equal(res.headers.vary, "X-Scripta-Works");
  const legacy = lines.find((line) => line.msg === "legacy client");
  assert.equal(legacy?.method, "GET");
  assert.equal(legacy?.route, "/things/:id");
  await server.close();
});

test("an existing Vary value is kept", async () => {
  const server = Fastify();
  server.get("/v", async (request, reply) => {
    reply.header("vary", "Origin");
    return { works: worksFormat(request, reply) };
  });
  const res = await server.inject({ url: "/v" });
  assert.equal(res.headers.vary, "Origin, X-Scripta-Works");
  await server.close();
});

test("the app lets the web client send the header, caches the preflight, and answers a catalog outage with 503", async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  app.get("/catalog-down", async () => {
    throw new WorkResolutionError(new Error("down"));
  });
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/library",
    headers: { origin: env.FRONTEND_URL, "access-control-request-method": "GET", "access-control-request-headers": "x-scripta-works" }
  });
  assert.equal(preflight.statusCode, 204);
  assert.match(String(preflight.headers["access-control-allow-headers"]), /x-scripta-works/i);
  assert.equal(preflight.headers["access-control-max-age"], "86400");
  const down = await app.inject({ url: "/catalog-down" });
  assert.equal(down.statusCode, 503);
  assert.match(down.json().error, /catalog/i);
});
