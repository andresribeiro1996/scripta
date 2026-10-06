import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "works-app-"));
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

const { buildApp } = await import("../../app.js");

test("the app serves /works/:id and answers an unknown id with 404", async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const res = await app.inject({ url: "/works/not-a-work" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "No book with that id." });
});
