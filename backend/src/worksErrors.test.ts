import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "works-errors-"));
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
const { WorkResolutionError } = await import("./modules/library/index.js");
const { env } = await import("./config/env.js");

test("the app caches the preflight and answers a catalog outage with 503", async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  app.get("/catalog-down", async () => {
    throw new WorkResolutionError(new Error("down"));
  });
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/library",
    headers: { origin: env.FRONTEND_URL, "access-control-request-method": "GET" }
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-max-age"], "86400");
  const down = await app.inject({ url: "/catalog-down" });
  assert.equal(down.statusCode, 503);
  assert.match(down.json().error, /catalog/i);
});
