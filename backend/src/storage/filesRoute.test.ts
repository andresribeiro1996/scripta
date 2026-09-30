import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "files-route-"));
Object.assign(process.env, {
  JWT_ACCESS_SECRET: "a".repeat(64),
  JWT_REFRESH_SECRET: "b".repeat(64),
  AUTH_DB_PATH: join(dir, "auth.sqlite"),
  LIBRARY_DB_PATH: join(dir, "library.sqlite"),
  GALLERY_DB_PATH: join(dir, "gallery.sqlite"),
  AVATAR_STORAGE_PATH: join(dir, "avatar-files"),
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

const { buildApp } = await import("../app.js");
const { createObjectStore } = await import("./createObjectStore.js");

const id = "0b6f9c1e-3a4d-4e5f-8a7b-1c2d3e4f5a6b";
const app = buildApp();
after(() => app.close());

test("a path-traversal key is rejected with 400", async () => {
  const res = await app.inject({ url: "/files/..%2Fx.webp" });
  assert.equal(res.statusCode, 400);
});

test("a key outside the known prefixes is rejected with 400", async () => {
  const res = await app.inject({ url: `/files/other/${id}.webp` });
  assert.equal(res.statusCode, 400);
});

test("a valid key that isn't stored answers 404", async () => {
  const res = await app.inject({ url: `/files/gallery/${id}.webp` });
  assert.equal(res.statusCode, 404);
});

test("a stored key answers 200 with the image and the immutable cache header", async () => {
  await createObjectStore().put(`covers/${id}.webp`, Buffer.from("img"), "image/webp");
  const res = await app.inject({ url: `/files/covers/${id}.webp` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/webp");
  assert.equal(res.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.deepEqual(res.rawPayload, Buffer.from("img"));
});
