import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

process.env.AUTH_DB_PATH = "/srv/volume/auth.sqlite";
process.env.LIBRARY_DB_PATH = "/srv/volume/library.sqlite";
process.env.GALLERY_DB_PATH = "/srv/volume/gallery.sqlite";
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
delete process.env.WAITLIST_DB_PATH;

const { env } = await import("./env.js");

test("the waitlist database defaults to the directory that holds the accounts database", () => {
  assert.equal(env.WAITLIST_DB_PATH, "/srv/volume/waitlist.sqlite");
});

const requiredEnv = {
  DOTENV_CONFIG_PATH: "/nonexistent/.env",
  JWT_ACCESS_SECRET: "a".repeat(64),
  JWT_REFRESH_SECRET: "b".repeat(64),
  AUTH_DB_PATH: "/data/auth.sqlite",
  LIBRARY_DB_PATH: "/data/library.sqlite",
  GALLERY_DB_PATH: "/data/gallery.sqlite"
};

function bootWithVolume(extra: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", "-e", `await import(${JSON.stringify(import.meta.resolve("./env.js"))})`], {
    env: { PATH: process.env.PATH, RAILWAY_VOLUME_MOUNT_PATH: "/data", ...requiredEnv, ...extra },
    encoding: "utf8"
  });
}

test("on Railway, a database outside the volume fails the boot and names the variable", () => {
  const result = bootWithVolume({});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MURALS_DB_PATH: must be under the volume at \/data/);
  assert.doesNotMatch(result.stderr, /AUTH_DB_PATH/);
});

const r2Env = {
  R2_ENDPOINT: "https://acct.r2.test",
  R2_ACCESS_KEY_ID: "AKID",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_IMAGES_BUCKET: "atmyshelf-images",
  R2_IMAGES_PUBLIC_URL: "https://images.test"
};
const volumeDatabases = {
  MURALS_DB_PATH: "/data/murals.sqlite",
  COVERS_DB_PATH: "/data/covers.sqlite",
  SOCIALS_DB_PATH: "/data/socials.sqlite",
  ARENA_DB_PATH: "/data/arena.sqlite",
  TIERLISTS_DB_PATH: "/data/tierlists.sqlite",
  QUIZZES_DB_PATH: "/data/quizzes.sqlite",
  COMMUNITY_DB_PATH: "/data/community.sqlite"
};

test("on Railway, missing R2 image variables fail the boot and are named in one issue", () => {
  const result = bootWithVolume(volumeDatabases);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_IMAGES_BUCKET, R2_IMAGES_PUBLIC_URL/);
  const partial = bootWithVolume({ ...volumeDatabases, ...r2Env, R2_IMAGES_BUCKET: "" });
  assert.equal(partial.status, 1);
  assert.match(partial.stderr, /R2_IMAGES_BUCKET/);
  assert.doesNotMatch(partial.stderr, /R2_ENDPOINT/);
});

test("on Railway, all five R2 image variables boot", () => {
  const result = bootWithVolume({ ...volumeDatabases, ...r2Env });
  assert.equal(result.status, 0, result.stderr);
});

test("off Railway, a bucket without the other R2 variables fails the boot and names them", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `await import(${JSON.stringify(import.meta.resolve("./env.js"))})`], {
    env: { PATH: process.env.PATH, ...requiredEnv, ...r2Env, R2_IMAGES_PUBLIC_URL: "" },
    encoding: "utf8"
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing R2_IMAGES_PUBLIC_URL/);
  assert.doesNotMatch(result.stderr, /R2_ENDPOINT/);
});
