import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "arena-routes-test-"));
process.env.AUTH_DB_PATH ??= join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratch, "gallery.sqlite");
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);

const { applyArenaMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteArenaRepository } = await import("./adapters/sqlite/sqliteArenaRepository.js");
const { createArenaService } = await import("./service.js");
const { buildArenaRoutes } = await import("./routes.js");

test("GET /arenas/public allows 30 requests a minute per caller", async () => {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildArenaRoutes(createArenaService(createSqliteArenaRepository(db))));
  const list = (headers: Record<string, string> = {}, remoteAddress = "203.0.113.7") =>
    app.inject({ method: "GET", url: "/arenas/public", headers, remoteAddress });
  for (let request = 1; request <= 30; request++) assert.equal((await list()).statusCode, 200);
  assert.equal((await list()).statusCode, 429);
  assert.equal((await list({}, "203.0.113.8")).statusCode, 200);
  assert.equal((await list({ authorization: "Bearer reader" })).statusCode, 200);
  await app.close();
});
